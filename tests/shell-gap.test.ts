import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { editVisit, listVisits } from '../src/visit-editor';
import { formatVisitStamp } from '../src/visit-log';
import { readVisitControls, VisitEditModal } from '../src/visit-modals';
import { createMapShell, ensureMapSpacer, placeShellOver, sizeMapSpacer, visibleMapSpacer } from '../src/map-shell';
import { createBarShell, ensureBarSpacer } from '../src/bar-shell';
import { stampDateTime } from '../src/schedule';

function source(file: string): string {
	return readFileSync(file, 'utf8');
}

function clickLabeled(root: { text?: string; click?: () => void; children?: unknown[] }, text: string): void {
	const stack: Array<{ text?: string; click?: () => void; children?: unknown[] }> = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		if (current.text === text && typeof current.click === 'function') {
			current.click();
			return;
		}
		if (Array.isArray(current.children)) stack.push(...(current.children as Array<{ text?: string; click?: () => void; children?: unknown[] }>));
	}
	throw new Error(`no button ${text}`);
}

describe('map band stays in the flow', () => {
	it('reserves the remembered band and does not touch a missing host', () => {
		const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
		const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
		hostGlobals.HTMLElement = dom.window.HTMLElement;
		hostGlobals.Document = dom.window.Document;
		const doc = dom.window.document;
		hostGlobals.document = doc;
		const host = doc.createElement('div');
		doc.body.append(host);
		const spacer = ensureMapSpacer(host);
		sizeMapSpacer(spacer, 316, false);
		assert.equal(spacer.style.getPropertyValue('height'), '319px');
		assert.equal(spacer.style.getPropertyPriority('height'), 'important');
		const shell = createMapShell(doc.body);
		spacer.getBoundingClientRect = () => ({ top: 400, left: 0, width: 381, height: 319, right: 381, bottom: 719, x: 0, y: 400, toJSON() { return {}; } });
		assert.equal(placeShellOver(shell.root, spacer), true);
		assert.equal(shell.root.style.height, '319px');
		assert.equal(shell.root.style.top, '400px');
		const missing = createMapShell(undefined as unknown as HTMLElement);
		assert.equal(missing.root.className, 'rv-map-shell');
		assert.equal(ensureMapSpacer(undefined as unknown as HTMLElement).className, 'rv-map-spacer');
		assert.equal(ensureBarSpacer(undefined as unknown as HTMLElement).className, 'rv-bar-spacer');
		assert.equal(createBarShell(undefined as unknown as HTMLElement).className, 'rv-bar-shell');
		assert.equal(visibleMapSpacer(undefined as unknown as Document), null);
	});

	it('keeps an unedited 5:56am visit at 5:56am', () => {
		const parsed = stampDateTime('Tue, 5:56am — Nov 10, 2026');
		assert.ok(parsed);
		assert.equal(parsed.getHours(), 5);
		assert.equal(parsed.getMinutes(), 56);
		const note = [
			'### Recent Notes:',
			'##### Tue, 5:56am — Nov 10, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
			'Home note.',
			'',
			'> [!example] Return Suggestions',
			'> > [!note]- Attempt Log',
			'> >- Tue, 5:56am — Nov 10, 2026 — success',
		].join('\n');
		const entry = listVisits(note)[0];
		assert.ok(entry);
		assert.equal(formatVisitStamp(entry.when), 'Tue, 5:56am — Nov 10, 2026');
		const saved: { when: Date }[] = [];
		const modal = new VisitEditModal({} as never, {
			title: 'Edit visit',
			initial: entry,
			recentCompanions: [],
			onSave: (facts) => { saved.push(facts); },
		});
		modal.open();
		clickLabeled(modal.contentEl, 'Save');
		assert.equal(saved.length, 1);
		assert.equal(formatVisitStamp(saved[0].when), 'Tue, 5:56am — Nov 10, 2026');
		const rewritten = editVisit(note, entry, { when: saved[0].when, home: true, companion: '' }, new Date(2026, 10, 10, 6, 0, 0));
		assert.match(rewritten, /Tue, 5:56am — Nov 10, 2026/);
		assert.doesNotMatch(rewritten, /4:50am/);
		const editedDom = new JSDOM('<!DOCTYPE html><body><input type="date" value="2026-11-10"><select aria-label="Hour"><option value="4" selected>4</option></select><select aria-label="Minute"><option value="50" selected>50</option></select><select aria-label="AM or PM"><option value="AM" selected>AM</option></select></body>');
		(globalThis as typeof globalThis & Record<string, unknown>).HTMLElement = editedDom.window.HTMLElement;
		const edited = readVisitControls(editedDom.window.document.body, { dateText: '2026-11-10', hour: 5, minute: 56 });
		assert.equal(edited.hour, 4);
		assert.equal(edited.minute, 50);
	});

	it('opens the live hub sort row and a hub pin, and does not mount the swap cover', () => {
		const main = source('src/main.ts');
		const hook = main.slice(main.indexOf('proto.openFile = function'), main.indexOf('proto.setViewState = function'));
		assert.doesNotMatch(hook, /holdLeafForHubPaint/);
		assert.match(main, /registerHubSortOpener/);
		assert.match(source('src/nearby-view.ts'), /registerHubSortOpener/);
		assert.match(source('src/map-view.ts'), /this\.host\.openMapNote\(path\)/);
		const css = source('styles.css');
		assert.match(css, /\.callout\.rv-locator-attempt-log > \.callout-content,\s*\n\.callout\.rv-locator-attempt-log > \.callout-title \{[^}]*padding-left:\s*12px !important/);
		assert.match(css, /\.modal\.rv-locator-modal \{[^}]*padding-bottom:\s*calc\(52px \+ env\(safe-area-inset-bottom, 0px\)\)/);
	});
});

describe('dark phone layout', () => {
	it('keeps content off the map and the bar, and a tap hits the card under it', async () => {
		const cssPath = path.join(process.cwd(), 'styles.css');
		const file = path.join(tmpdir(), 'rv-shell-gap.html');
		const html = `<!DOCTYPE html>
<html class="theme-dark">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #1e1e1e; color: #ddd; }
  .view-content { position: absolute; inset: 0; }
  .workspace { width: 381px; height: 798px; position: relative; }
  #note, #hub, #modal { position: absolute; top: 0; left: 0; width: 381px; }
  .sec { height: 80px; }
</style>
<link rel="stylesheet" href="${cssPath}">
</head>
<body class="theme-dark is-phone">
<div class="workspace">
  <div class="workspace-leaf-content is-note-map is-rv-note" id="note" style="height:798px;--rv-note-map:316px;--rv-map-size:316px">
    <div class="view-header">Note</div>
    <div class="view-content" id="note-body">
      <div class="sec">Visit Facts</div>
      <div class="sec">Recent Notes</div>
      <div class="sec">Return Suggestions</div>
      <div class="sec">Attempt Log</div>
    </div>
    <div class="rv-map-spacer" id="note-spacer"></div>
    <div class="rv-bar-spacer" id="note-bar"></div>
  </div>
  <div class="rv-locator-view rv-locator-glancable is-hub-map is-stacked" id="hub" style="position:absolute;top:0;left:0;width:381px;height:746px;--rv-map-size:316px">
    <div class="rv-locator-stage">
      <div class="rv-locator-scroll" id="hub-scroll">
        <button class="rv-locator-card" data-rv-path="People/Yellow Lane.md" style="height:72px">Yellow Lane</button>
        <button class="rv-locator-card" data-rv-path="People/Red Lane.md" style="height:72px">Red Lane</button>
        <button class="rv-locator-card" data-rv-path="People/Eve Carter.md" style="height:72px">Eve Carter</button>
      </div>
      <div class="rv-map-spacer" id="hub-spacer"></div>
    </div>
    <div class="rv-locator-sortbar"><div class="rv-bar-spacer"></div></div>
  </div>
  <div class="modal-container" id="modal-layer">
    <div class="modal rv-locator-modal rv-snooze-modal" id="modal" style="display:flex;flex-direction:column;height:798px;box-sizing:border-box">
      <p>Snooze</p>
      <div class="rv-modal-actions is-footer" id="footer"><button type="button" id="update">Update</button></div>
    </div>
  </div>
  <div class="rv-bar-shell" id="bar"><div class="rv-bar-row rv-app-bar"><button class="rv-app-slot rv-bar-tab-hub" id="sort">Sort</button><button class="rv-app-slot">New</button></div></div>
  <div class="rv-map-shell" id="shell"><div class="rv-hub-map"><div class="rv-map-stage"><div class="rv-map-pins"><button class="rv-map-pin" id="pin" data-rv-path="People/Red Lane.md" type="button">Red Lane</button></div></div></div></div>
</div>
<pre id="out">pending</pre>
<script>
try {
const overlaps = (a, b) => a.bottom > b.top + 1 && a.top < b.bottom - 1 && a.right > b.left + 1 && a.left < b.right - 1;
const noteSpacer = document.getElementById('note-spacer');
const shell = document.getElementById('shell');
const noteBox = noteSpacer.getBoundingClientRect();
shell.style.left = noteBox.left + 'px';
shell.style.top = noteBox.top + 'px';
shell.style.width = noteBox.width + 'px';
shell.style.height = noteBox.height + 'px';
const shellBox = shell.getBoundingClientRect();
const noteBody = document.getElementById('note-body').getBoundingClientRect();
const hubSpacer = document.getElementById('hub-spacer').getBoundingClientRect();
const hubScroll = document.getElementById('hub-scroll').getBoundingClientRect();
const bar = document.getElementById('bar');
const barSlot = document.getElementById('note-bar').getBoundingClientRect();
bar.style.left = barSlot.left + 'px';
bar.style.top = barSlot.top + 'px';
bar.style.width = barSlot.width + 'px';
const barBox = bar.getBoundingClientRect();
const update = document.getElementById('update').getBoundingClientRect();
const footer = document.getElementById('footer').getBoundingClientRect();
const modalZ = getComputedStyle(document.getElementById('modal-layer')).zIndex;
const suggestions = document.querySelector('.callout');
const opened = [];
document.querySelectorAll('.rv-locator-card').forEach((card) => {
  card.addEventListener('click', () => opened.push(card.getAttribute('data-rv-path')));
});
document.getElementById('modal-layer').remove();
document.getElementById('hub').style.visibility = 'hidden';
const pin = document.getElementById('pin');
pin.style.left = '40px';
pin.style.top = '40px';
const pinHit = document.elementFromPoint(pin.getBoundingClientRect().left + 8, pin.getBoundingClientRect().top + 8);
document.getElementById('hub').style.visibility = '';
document.getElementById('note').style.visibility = 'hidden';
shell.style.visibility = 'hidden';
const yellow = document.querySelector('[data-rv-path="People/Yellow Lane.md"]');
const point = yellow.getBoundingClientRect();
const hit = document.elementFromPoint(point.left + 8, point.top + 8);
const taps = [100, 150, 250, 400].map((delay) => {
  const card = document.elementFromPoint(point.left + 8, point.top + 8);
  const path = card && card.closest('[data-rv-path]') ? card.closest('[data-rv-path]').getAttribute('data-rv-path') : '';
  if (card && card.click) card.click();
  return { delay, path, cards: document.querySelectorAll('.rv-locator-card').length, cover: document.querySelector('.rv-hub-swap-cover') != null };
});
{
  document.getElementById('sort').addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'rv-bar-sort';
    row.textContent = 'Gender Scope Snoozed';
    bar.appendChild(row);
    bar.classList.add('is-sort-open');
  });
  document.getElementById('sort').click();
  const suggest = document.createElement('div');
  suggest.className = 'callout rv-locator-return-suggestions';
  suggest.innerHTML = '<div class="callout-content"><ul><li>Come back Tuesday</li></ul><div class="callout rv-locator-attempt-log"><div class="callout-content"><ul><li>Tue, 5:56am</li></ul></div></div></div>';
  document.body.appendChild(suggest);
  const suggestPad = getComputedStyle(suggest.querySelector('.callout-content')).paddingLeft;
  const logPad = getComputedStyle(suggest.querySelector('.rv-locator-attempt-log > .callout-content')).paddingLeft;
  const report = {
    noteSpacerH: Math.round(noteBox.height),
    shellH: Math.round(shellBox.height),
    shellTop: Math.round(shellBox.top),
    spacerTop: Math.round(noteBox.top),
    noteOverlap: overlaps(noteBody, shellBox),
    hubSpacerH: Math.round(hubSpacer.height),
    hubOverlap: overlaps(hubScroll, hubSpacer),
    barH: Math.round(barBox.height),
    footerUnderBar: footer.bottom > barBox.top + 1,
    updateUnderBar: update.bottom > barBox.top + 1,
    modalZ,
    barZ: getComputedStyle(bar).zIndex,
    hit: hit && hit.closest('[data-rv-path]') ? hit.closest('[data-rv-path]').getAttribute('data-rv-path') : '',
    hitTag: hit ? hit.className : 'none',
    yellowTop: Math.round(point.top),
    innerH: window.innerHeight,
    pinHit: pinHit && pinHit.closest('.rv-map-pin') ? pinHit.getAttribute('data-rv-path') : '',
    taps,
    opened,
    sort: document.querySelector('.rv-bar-sort') != null,
    suggestPad,
    logPad,
  };
  document.getElementById('out').textContent = JSON.stringify(report);
}
} catch (error) {
  document.getElementById('out').textContent = JSON.stringify({ error: String(error), stack: error && error.stack });
}
</script>
</body>
</html>`;
		writeFileSync(file, html);
		const raw = await new Promise<string>((resolve, reject) => {
			const child = spawn('google-chrome', [
				'--headless=new',
				'--disable-gpu',
				'--no-sandbox',
				'--no-first-run',
				`--user-data-dir=${path.join(tmpdir(), `rv-shell-gap-chrome-${Date.now()}`)}`,
				'--window-size=381,798',
				'--virtual-time-budget=3000',
				'--dump-dom',
				file,
			], { stdio: ['ignore', 'pipe', 'pipe'] });
			let out = '';
			const kill = () => { if (!child.killed) child.kill('SIGKILL'); };
			const timer = setTimeout(kill, 8000);
			child.stdout.on('data', (chunk) => {
				out += String(chunk);
				if (out.includes('</pre>') && !out.includes('>pending</pre>')) kill();
			});
			child.on('error', (error) => { clearTimeout(timer); reject(error); });
			child.on('close', () => { clearTimeout(timer); resolve(out); });
		});
		const match = raw.match(/<pre id="out">([\s\S]*?)<\/pre>/);
		assert.ok(match, raw.slice(0, 500));
		const report = JSON.parse(match[1].replace(/&quot;/g, '"')) as {
			noteSpacerH: number;
			shellH: number;
			shellTop: number;
			spacerTop: number;
			noteOverlap: boolean;
			hubSpacerH: number;
			hubOverlap: boolean;
			barH: number;
			footerUnderBar: boolean;
			updateUnderBar: boolean;
			hit: string;
			pinHit: string;
			taps: { delay: number; path: string; cards: number; cover: boolean }[];
			sort: boolean;
			suggestPad: string;
			logPad: string;
		};
		assert.equal(report.noteSpacerH, 319);
		assert.equal(report.shellH, 319);
		assert.equal(report.shellTop, report.spacerTop);
		assert.equal(report.noteOverlap, false);
		assert.equal(report.hubSpacerH, 319);
		assert.equal(report.hubOverlap, false);
		assert.ok(report.barH >= 52);
		assert.equal(report.footerUnderBar, false);
		assert.equal(report.updateUnderBar, false);
		assert.equal(report.hit, 'People/Yellow Lane.md', JSON.stringify(report));
		assert.equal(report.pinHit, 'People/Red Lane.md');
		assert.equal(report.taps.length, 4);
		for (const tap of report.taps) {
			assert.equal(tap.path, 'People/Yellow Lane.md');
			assert.equal(tap.cards, 3);
			assert.equal(tap.cover, false);
		}
		assert.equal(report.sort, true);
		assert.equal(report.suggestPad, '12px');
		assert.equal(report.logPad, '12px');
	});
});
