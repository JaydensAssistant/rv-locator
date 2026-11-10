import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

	it('keeps an unedited past 5:56am visit at 5:56am', () => {
		// Save refuses a clock later than now. A fixed "Nov 10, 2026, 5:56am"
		// is still in the future on a US morning, so onSave never runs. The
		// fixture is two days ago at 5:56, which is past in every timezone.
		const when = new Date();
		when.setDate(when.getDate() - 2);
		when.setHours(5, 56, 0, 0);
		const stamp = formatVisitStamp(when);
		assert.equal(stampDateTime(stamp)?.getHours(), 5);
		assert.equal(stampDateTime(stamp)?.getMinutes(), 56);
		const note = [
			'### Recent Notes:',
			`##### ${stamp}`,
			'`INPUT[textArea:sVisit1Notes]`',
			'Home note.',
			'',
			'> [!example] Return Suggestions',
			'> > [!note]- Attempt Log',
			`> >- ${stamp} — success`,
		].join('\n');
		const entry = listVisits(note)[0];
		assert.ok(entry);
		assert.equal(formatVisitStamp(entry.when), stamp);
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
		assert.equal(formatVisitStamp(saved[0].when), stamp);
		const rewritten = editVisit(note, entry, { when: saved[0].when, home: true, companion: '' }, new Date());
		assert.match(rewritten, new RegExp(stamp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		assert.doesNotMatch(rewritten, /4:50am/);
		const ahead = new Date();
		ahead.setDate(ahead.getDate() + 1);
		ahead.setHours(5, 56, 0, 0);
		const refused: { when: Date }[] = [];
		const future = new VisitEditModal({} as never, {
			title: 'Edit visit',
			initial: { when: ahead, home: true, companion: '' },
			recentCompanions: [],
			onSave: (facts) => { refused.push(facts); },
		});
		future.open();
		clickLabeled(future.contentEl, 'Save');
		assert.equal(refused.length, 0);
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

type Box = { top: number; left: number; width: number; height: number; right: number; bottom: number };

function box(top: number, left: number, width: number, height: number): Box {
	return { top, left, width, height, right: left + width, bottom: top + height };
}

function overlaps(a: Box, b: Box): boolean {
	return a.bottom > b.top + 1 && a.top < b.bottom - 1 && a.right > b.left + 1 && a.left < b.right - 1;
}

/** JSDOM keeps `calc()` and `var()`. Resolve the lengths this layout uses. */
function usedPx(styleOf: (el: Element) => CSSStyleDeclaration, el: Element, prop: string): number | null {
	const raw = styleOf(el).getPropertyValue(prop).trim();
	return resolveLength(raw, el);
}

function customProp(el: Element, name: string): string {
	let node: Element | null = el;
	while (node) {
		const value = (node as HTMLElement).style?.getPropertyValue(name).trim();
		if (value) return value;
		node = node.parentElement;
	}
	return '';
}

function resolveLength(raw: string, el: Element): number | null {
	let text = raw.trim();
	if (!text || text === 'auto' || text === 'none') return null;
	text = text.replace(/env\([^)]*\)/g, '0px');
	for (let pass = 0; pass < 6 && text.includes('var('); pass += 1) {
		text = text.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\s*\)/g, (_match, name: string, fallback?: string) => {
			return customProp(el, name) || (fallback ?? '0px').trim();
		});
	}
	const body = text.startsWith('calc(') && text.endsWith(')') ? text.slice(5, -1) : text;
	if (body.includes('+')) {
		return body.split('+').reduce((sum, part) => sum + (resolveLength(part.trim(), el) ?? 0), 0);
	}
	const px = /^(-?\d+(?:\.\d+)?)px$/.exec(body.trim());
	if (px) return Number(px[1]);
	if (body.trim() === '0') return 0;
	return null;
}

function hitAt(
	doc: Document,
	styleOf: (el: Element) => CSSStyleDeclaration,
	boxes: Map<Element, Box>,
	x: number,
	y: number,
	hidden: Set<Element>,
): Element | null {
	let found: Element | null = null;
	const walk = (el: Element): void => {
		if (hidden.has(el) || styleOf(el).display === 'none' || styleOf(el).visibility === 'hidden') return;
		const rect = boxes.get(el);
		const target = styleOf(el).pointerEvents !== 'none';
		if (target && rect && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) found = el;
		for (const child of el.children) walk(child);
	};
	walk(doc.body);
	return found;
}

describe('dark phone layout', () => {
	it('keeps content off the map and the bar, and a tap hits the card under it', () => {
		const css = source('styles.css');
		const dom = new JSDOM(`<!DOCTYPE html>
<html class="theme-dark"><head><style>
  .view-content { position: absolute; inset: 0; }
  #note, #hub, #modal { position: absolute; top: 0; left: 0; width: 381px; }
  .sec { height: 80px; }
  ${css}
</style></head>
<body class="theme-dark is-phone">
  <div class="workspace-leaf-content is-note-map is-rv-note" id="note" style="height:798px;width:381px;--rv-note-map:316px;--rv-map-size:316px">
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
  <div class="rv-locator-view rv-locator-glancable is-hub-map is-stacked" id="hub" style="height:746px;width:381px;--rv-map-size:316px">
    <div class="rv-locator-stage">
      <div class="rv-locator-scroll" id="hub-scroll">
        <button class="rv-locator-card" data-rv-path="People/Yellow Lane.md" style="height:72px">Yellow Lane</button>
        <button class="rv-locator-card" data-rv-path="People/Red Lane.md" style="height:72px">Red Lane</button>
        <button class="rv-locator-card" data-rv-path="People/Eve Carter.md" style="height:72px">Eve Carter</button>
      </div>
      <div class="rv-map-spacer" id="hub-spacer"></div>
    </div>
  </div>
  <div class="modal-container" id="modal-layer">
    <div class="modal rv-locator-modal" id="modal" style="height:798px;box-sizing:border-box">
      <div class="rv-modal-actions is-footer" id="footer"><button type="button" id="update">Update</button></div>
    </div>
  </div>
  <div class="rv-bar-shell" id="bar"></div>
  <div class="rv-map-shell" id="shell"><div class="rv-hub-map"><div class="rv-map-stage"><div class="rv-map-pins"><button class="rv-map-pin" id="pin" data-rv-path="People/Red Lane.md" type="button">Red Lane</button></div></div></div></div>
  <div class="callout rv-locator-return-suggestions"><div class="callout-content" id="suggest-content"><ul><li>Come back Tuesday</li></ul>
    <div class="callout rv-locator-attempt-log"><div class="callout-content" id="log-content"><ul><li>Tried</li></ul></div></div>
  </div></div>
</body></html>`, { pretendToBeVisual: true });
		const doc = dom.window.document;
		const styleOf = (el: Element) => dom.window.getComputedStyle(el);
		const globals = globalThis as typeof globalThis & Record<string, unknown>;
		globals.HTMLElement = dom.window.HTMLElement;
		globals.Document = dom.window.Document;
		globals.document = doc;
		const noteSpacer = doc.getElementById('note-spacer');
		const hubSpacer = doc.getElementById('hub-spacer');
		const noteBody = doc.getElementById('note-body');
		const hubScroll = doc.getElementById('hub-scroll');
		const shell = doc.getElementById('shell');
		const pin = doc.getElementById('pin');
		const bar = doc.getElementById('bar');
		const modal = doc.getElementById('modal');
		const layer = doc.getElementById('modal-layer');
		assert.ok(noteSpacer && hubSpacer && noteBody && hubScroll && shell && pin && bar && modal && layer);
		const noteSpacerH = usedPx(styleOf, noteSpacer, 'height');
		const hubSpacerH = usedPx(styleOf, hubSpacer, 'height');
		assert.equal(noteSpacerH, 319);
		assert.equal(hubSpacerH, 319);
		const noteBodyH = 798 - 319;
		const noteBodyBox = box(0, 0, 381, noteBodyH);
		const noteSpacerBox = box(noteBodyH, 0, 381, 319);
		const hubScrollH = 746 - 319;
		const hubScrollBox = box(0, 0, 381, hubScrollH);
		const hubSpacerBox = box(hubScrollH, 0, 381, 319);
		noteSpacer.getBoundingClientRect = () => ({ ...noteSpacerBox, x: noteSpacerBox.left, y: noteSpacerBox.top, toJSON() { return {}; } });
		assert.equal(placeShellOver(shell, noteSpacer), true);
		const shellBox = box(Number.parseFloat(shell.style.top), Number.parseFloat(shell.style.left), Number.parseFloat(shell.style.width), Number.parseFloat(shell.style.height));
		assert.equal(shellBox.height, noteSpacerBox.height);
		assert.equal(shellBox.top, noteSpacerBox.top);
		assert.equal(overlaps(noteBodyBox, shellBox), false);
		assert.equal(overlaps(hubScrollBox, hubSpacerBox), false);
		const cards = [...doc.querySelectorAll('.rv-locator-card')];
		assert.equal(cards.length, 3);
		const boxes = new Map<Element, Box>();
		cards.forEach((card, index) => {
			const cardBox = box(index * 72, 0, 381, 72);
			boxes.set(card, cardBox);
			assert.equal(overlaps(cardBox, hubSpacerBox), false);
		});
		const pinBox = box(hubSpacerBox.top + 40, 40, 27, 27);
		boxes.set(pin, pinBox);
		boxes.set(shell, shellBox);
		const hidden = new Set<Element>([doc.getElementById('note')!, shell]);
		const yellow = cards[0];
		const point = boxes.get(yellow)!;
		for (const _delay of [100, 150, 250, 400]) {
			const hit = hitAt(doc, styleOf, boxes, point.left + 8, point.top + 8, hidden);
			assert.equal(hit?.getAttribute('data-rv-path'), 'People/Yellow Lane.md');
		}
		assert.equal(doc.querySelector('.rv-hub-swap-cover'), null);
		const pinHit = hitAt(doc, styleOf, boxes, pinBox.left + 8, pinBox.top + 8, new Set([doc.getElementById('hub')!]));
		assert.equal(pinHit?.getAttribute('data-rv-path'), 'People/Red Lane.md');
		const barH = usedPx(styleOf, bar, 'min-height');
		const pad = usedPx(styleOf, modal, 'padding-bottom');
		assert.equal(barH, 52);
		assert.equal(pad, 52);
		const barBox = box(798 - 52, 0, 381, 52);
		const footerBottom = 798 - (pad ?? 0);
		assert.equal(footerBottom > barBox.top + 1, false);
		assert.equal(styleOf(layer).zIndex, '80');
		assert.equal(styleOf(bar).zIndex, '32');
		assert.equal(styleOf(shell).pointerEvents, 'none');
		assert.equal(styleOf(pin).pointerEvents, 'auto');
		assert.equal(styleOf(doc.getElementById('suggest-content')!).paddingLeft, '12px');
		assert.equal(styleOf(doc.getElementById('log-content')!).paddingLeft, '12px');
	});
});
