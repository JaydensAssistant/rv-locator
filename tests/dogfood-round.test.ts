import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { applyLiveUrgency, type NoteChromeHost } from '../src/note-chrome';
import { iconizeModal } from '../src/modal-chrome';
import { mountAlwaysChevron } from '../src/suggest-field';
import { DEFAULT_SETTINGS } from '../src/types';
import { applyHeadPin } from '../src/visit-paint-guard';
import { concealCollapsedVisitNotes, layoutVisitNotes } from '../src/visit-display';
import { recentFoldLineStarts, setRecentNotesOpenState, visitPreviewExtension } from '../src/visit-live-preview';
import { fillItemStrip } from '../src/visit-controls';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const hostGlobals = globalThis as typeof globalThis & Record<string, unknown>;
hostGlobals.window = window;
hostGlobals.document = window.document;
hostGlobals.HTMLElement = window.HTMLElement;
hostGlobals.Element = window.Element;
hostGlobals.Node = window.Node;
hostGlobals.Document = window.Document;
hostGlobals.KeyboardEvent = window.KeyboardEvent;
hostGlobals.MouseEvent = window.MouseEvent;
hostGlobals.PointerEvent = window.PointerEvent;
hostGlobals.HTMLInputElement = window.HTMLInputElement;
hostGlobals.HTMLButtonElement = window.HTMLButtonElement;
hostGlobals.HTMLTextAreaElement = window.HTMLTextAreaElement;
hostGlobals.MutationObserver = window.MutationObserver;
hostGlobals.getComputedStyle = window.getComputedStyle.bind(window);
hostGlobals.requestAnimationFrame = window.requestAnimationFrame.bind(window);

const proto = window.HTMLElement.prototype as HTMLElement & Record<string, (...args: never[]) => unknown>;
proto.createEl = function createEl(this: HTMLElement, tag: string, spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
	const el = this.ownerDocument.createElement(tag);
	if (typeof spec === 'string') el.className = spec;
	else if (spec) {
		if (spec.cls) el.className = spec.cls;
		if (spec.text) el.textContent = spec.text;
		if (spec.attr) {
			for (const [key, value] of Object.entries(spec.attr)) el.setAttribute(key, value);
		}
	}
	this.appendChild(el);
	return el;
};
proto.createSpan = function createSpan(this: HTMLElement, spec?: string | { cls?: string; text?: string }) {
	return this.createEl('span', typeof spec === 'string' ? { cls: spec } : spec);
};
proto.createDiv = function createDiv(this: HTMLElement, spec?: string | { cls?: string; text?: string }) {
	return this.createEl('div', typeof spec === 'string' ? { cls: spec } : spec);
};

const css = readFileSync('styles.css', 'utf8');
const main = readFileSync('src/main.ts', 'utf8');

function chromeHost(): NoteChromeHost {
	return {
		frontmatter: () => ({
			Status: 'Active',
			Priority: 5,
			'Last Spoke': '2020-01-01T08:00:00',
			'Last Attempted': '2020-01-01T08:00:00',
		}),
		settings: { ...DEFAULT_SETTINGS, distanceTest: true },
		snoozeUntil: () => null,
		setStatus: () => {},
		setPriority: () => {},
		openUrgency: () => {},
		openPriority: () => {},
		openRoute: () => {},
		openHub: () => {},
		addHub: () => {},
		removeHub: () => {},
		moveHub: () => {},
		openSlotOverride: () => {},
		setAddress: () => {},
		openMap: () => {},
		openCompanion: () => {},
		campaignMark: () => null,
		noteTitle: () => 'Ada',
		renameNote: () => {},
		mapOpen: () => false,
		ghostIcon: () => null,
	};
}

describe('dogfood round', () => {
	it('RV-B26 closes the literature list on the chevron, an outside tap, Escape, and a pick', () => {
		const parent = window.document.createElement('div');
		const input = window.document.createElement('input');
		parent.appendChild(input);
		window.document.body.appendChild(parent);
		let picked = '';
		mountAlwaysChevron(input, () => ['Listen to God', 'Enjoy Life Forever'], (value) => { picked = value; });
		const button = parent.querySelector('button');
		const panel = parent.querySelector('.rv-suggest-panel');
		assert.ok(button instanceof window.HTMLButtonElement);
		assert.ok(panel instanceof window.HTMLElement);
		button.click();
		assert.equal(panel.hidden, false);
		button.click();
		assert.equal(panel.hidden, true);
		assert.equal(panel.style.getPropertyPriority('display'), 'important');
		assert.equal(panel.style.getPropertyValue('display'), 'none');
		button.click();
		window.document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(panel.hidden, true);
		button.click();
		window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		assert.equal(panel.hidden, true);
		button.click();
		const row = panel.querySelector('.rv-suggest-option');
		assert.ok(row instanceof window.HTMLElement);
		row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(picked, 'Listen to God');
		assert.equal(panel.hidden, true);
		assert.match(css, /\.rv-suggest-panel\[hidden\] \{\s*display:\s*none !important;/);
		parent.remove();
	});

	it('RV-B27 a title that fits stays on one line and keeps the other entry', () => {
		const strip = window.document.createElement('div');
		strip.className = 'rv-item-strip';
		window.document.body.appendChild(strip);
		fillItemStrip(strip, '· «book» «Listen to God Brochure» · «book» «What Happens at a Bible Study? Brochure»', '');
		const box = { left: 12, width: 350, top: 80, height: 24, right: 362, bottom: 104, x: 12, y: 80, toJSON() { return {}; } };
		strip.getBoundingClientRect = () => box;
		const chips = Array.from(strip.querySelectorAll('.rv-item'));
		assert.equal(chips.length, 2);
		const icon = chips[1]?.querySelector('.rv-item-icon');
		assert.ok(icon instanceof window.HTMLElement);
		icon.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		assert.equal(window.document.querySelector('.rv-strip-overlay'), null);
		assert.equal(chips[0]?.classList.contains('is-dropped'), false);
		assert.equal(chips[1]?.classList.contains('is-open'), true);
		const stem = chips[1]?.querySelector('.rv-fit-stem')?.textContent ?? '';
		assert.ok(stem.length > 8);
		assert.equal(strip.style.fontSize, '');
		strip.remove();
	});

	it('RV-B28 leaves each map pin on its own urgency color', () => {
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		const dash = window.document.createElement('div');
		dash.className = 'rv-dashboard';
		dash.style.setProperty('--rv-urgency-accent', '#112233');
		const map = window.document.createElement('div');
		map.className = 'rv-map';
		const pin = window.document.createElement('button');
		pin.className = 'rv-map-pin is-drop';
		pin.style.setProperty('--rv-urgency-accent', '#112233');
		pin.style.setProperty('--rv-urgency-ink', '#112233');
		pin.style.setProperty('--pin-color', '#112233');
		map.appendChild(pin);
		preview.append(dash, map);
		window.document.body.appendChild(preview);
		applyLiveUrgency(preview, 'People/Ada.md', chromeHost(), true);
		assert.equal(pin.style.getPropertyValue('--rv-urgency-ink').toLowerCase(), '#112233');
		assert.notEqual(dash.style.getPropertyValue('--rv-urgency-accent').toLowerCase(), '#112233');
		preview.remove();
	});

	it('RV-B29 shades a selected pin instead of ringing it', () => {
		assert.match(css, /\.rv-map-pin\.is-drop\.is-selected,\s*\.rv-map \.rv-map-pins > button\.rv-map-pin\.is-drop\.rv-pin-flash[\s\S]*outline:\s*none !important/);
		assert.match(css, /\.theme-light \.rv-map \.rv-map-pins > button\.rv-map-pin\.is-drop\.is-selected \.rv-pin-shape path[\s\S]*93%, #000/);
		assert.match(css, /\.rv-map-pin\.is-drop\.is-selected \.rv-pin-shape path[\s\S]*91%, #fff/);
	});

	it('RV-B30 collapses only Recent Notes', () => {
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		const notesWrap = window.document.createElement('div');
		notesWrap.className = 'el-h3';
		const notes = window.document.createElement('h3');
		notes.textContent = 'Recent Notes:';
		notesWrap.appendChild(notes);
		preview.appendChild(notesWrap);
		const stamps = ['Mon, 9am — Sep 1, 2026', 'Tue, 2pm — Sep 2, 2026', 'Wed, 3pm — Sep 3, 2026', 'Thu, 4pm — Sep 4, 2026'];
		const sections = stamps.map((stamp) => {
			const section = window.document.createElement('div');
			section.className = 'el-h5';
			const heading = window.document.createElement('h5');
			heading.className = 'rv-visit-stamp';
			heading.textContent = stamp;
			section.appendChild(heading);
			preview.appendChild(section);
			return section;
		});
		const callout = window.document.createElement('div');
		callout.className = 'callout rv-locator-return-suggestions';
		callout.textContent = 'Return Suggestions';
		preview.appendChild(callout);
		window.document.body.appendChild(preview);
		layoutVisitNotes(preview, `### Recent Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		const stop = preview.querySelector('.rv-notes-fold-stop');
		const older = preview.querySelector('.rv-older-visits-wrap');
		assert.ok(stop instanceof window.HTMLElement);
		assert.ok(older instanceof window.HTMLElement);
		assert.equal(stop.compareDocumentPosition(older) & window.Node.DOCUMENT_POSITION_FOLLOWING, window.Node.DOCUMENT_POSITION_FOLLOWING);
		notesWrap.classList.add('is-collapsed');
		let cursor = notesWrap.nextElementSibling;
		while (cursor instanceof window.HTMLElement) {
			cursor.style.display = 'none';
			cursor = cursor.nextElementSibling;
		}
		concealCollapsedVisitNotes(preview);
		assert.notEqual(older.style.display, 'none');
		assert.notEqual(callout.style.display, 'none');
		assert.equal(sections[0]?.style.display, 'none');
		const markdown = [
			'### Recent Notes:',
			'##### Mon, 9am — Sep 1, 2026',
			'recent body',
			'##### Tue, 2pm — Sep 2, 2026',
			'##### Wed, 3pm — Sep 3, 2026',
			'##### Thu, 4pm — Sep 4, 2026',
			'older body',
			'',
			'> [!example] Return Suggestions',
			'> Try Friday',
		].join('\n');
		const hidden = recentFoldLineStarts(markdown, false, 3).map((from) => {
			const end = markdown.indexOf('\n', from);
			return markdown.slice(from, end === -1 ? undefined : end);
		});
		assert.equal(hidden.some((line) => line.includes('Thu, 4pm')), false);
		assert.equal(hidden.some((line) => line.includes('Return Suggestions')), false);
		assert.equal(hidden.some((line) => line.includes('recent body')), true);
		preview.remove();
	});

	it('RV-B30 a live preview chevron hides recent lines and leaves Older Visits up', async () => {
		const markdown = [
			'### Recent Notes:',
			'##### Mon, 9am — Sep 1, 2026',
			'recent body',
			'##### Tue, 2pm — Sep 2, 2026',
			'##### Wed, 3pm — Sep 3, 2026',
			'##### Thu, 4pm — Sep 4, 2026',
			'older body',
			'',
			'> [!example] Return Suggestions',
		].join('\n');
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		setRecentNotesOpenState('rv-b30.md', true);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: markdown,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 3 }), () => 'rv-b30.md'),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const heading = view.dom.querySelector('h3.rv-visit-notes-heading');
		assert.ok(heading instanceof window.HTMLElement);
		heading.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		const folded = Array.from(view.dom.querySelectorAll('.rv-recent-folded')).map((node) => node.textContent ?? '');
		assert.equal(folded.some((text) => text.includes('recent body') || text.includes('Mon, 9am')), true);
		assert.equal(folded.some((text) => text.includes('Thu, 4pm') || text.includes('Return Suggestions')), false);
		assert.match(view.dom.textContent ?? '', /Older Visits|Thu, 4pm/);
		assert.match(css, /\.cm-line\.rv-recent-folded,\s*\.rv-recent-folded \{\s*display:\s*none !important;/);
		view.destroy();
		parent.remove();
	});

	it('RV-B31 keeps a new priority when a stale cache event arrives', () => {
		const stored = { Priority: 1, Status: 'Active', 'Urgency Snooze': '2026-01-01' };
		const cleared = applyHeadPin(stored, { Priority: 4, Status: 'Study', 'Urgency Snooze': '' });
		assert.equal(cleared, false);
		assert.equal(stored.Priority, 4);
		assert.equal(stored.Status, 'Study');
		assert.equal('Urgency Snooze' in stored, false);
		const matched = { Priority: 4, Status: 'Study' };
		assert.equal(applyHeadPin(matched, { Priority: 4, Status: 'Study', 'Urgency Snooze': '' }), true);
		const pins = main.slice(main.indexOf('listMapPins():'), main.indexOf('listMapPins():') + 500);
		assert.match(pins, /noteFrontmatter\(file\.path\)/);
		assert.match(main.slice(main.indexOf('private async writePriority'), main.indexOf('private promptAddHub')), /scheduleOpenNoteRepaint\(\)/);
		assert.match(main.slice(main.indexOf('private async writeStatus'), main.indexOf('private async writePriority')), /scheduleOpenNoteRepaint\(\)/);
	});

	it('RV-B32 paints every modal button icon heavy enough to read on its fill', () => {
		assert.match(css, /\.rv-locator-modal button \.rv-modal-icon svg,\s*\.rv-locator-modal button \.rv-campaign-icon svg[\s\S]*stroke-width:\s*2\.75 !important/);
		assert.match(css, /\.rv-locator-modal button\.mod-cta \.rv-modal-icon[\s\S]*color:\s*var\(--rv-modal-ink, #fff\)/);
		assert.match(css, /\.theme-light \.rv-study-change-modal button \.rv-modal-icon/);
		assert.match(css, /\.rv-locator-modal \.rv-gender-choice button > svg/);
		const root = window.document.createElement('div');
		root.className = 'rv-locator-modal';
		const save = window.document.createElement('button');
		save.className = 'mod-cta';
		save.textContent = 'Log visit';
		const cancel = window.document.createElement('button');
		cancel.textContent = 'Cancel';
		root.append(save, cancel);
		iconizeModal(root);
		assert.ok(save.querySelector('.rv-modal-icon'));
		assert.ok(cancel.querySelector('.rv-modal-icon'));
		root.remove();
	});

	it('RV-B33 RV-B34 the Day box keeps the full date and opens the native picker', () => {
		assert.match(css, /\.rv-when-row \.setting-item-control > input\[type="date"\] \{[^}]*min-width:\s*8\.25rem !important/);
		assert.match(css, /\.rv-when-row \.setting-item-control > select:not\(\.is-measuring\) \{[^}]*flex:\s*1 1 2\.75rem !important/);
		const root = window.document.createElement('div');
		root.className = 'rv-locator-modal';
		const input = window.document.createElement('input');
		input.type = 'date';
		let opened = 0;
		input.showPicker = () => { opened += 1; };
		root.appendChild(input);
		window.document.body.appendChild(root);
		iconizeModal(root);
		input.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		input.dispatchEvent(new window.Event('pointerup', { bubbles: true }));
		assert.equal(opened, 2);
		root.remove();
	});
});
