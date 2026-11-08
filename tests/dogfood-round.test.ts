import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { bindAddressDirections, claimExternalOpen, handleAddressDirectionsClick, openExternalUrl } from '../src/address';
import { applyLiveUrgency, type NoteChromeHost } from '../src/note-chrome';
import { iconizeModal } from '../src/modal-chrome';
import { mountAlwaysChevron, suggestEscapeShouldHold } from '../src/suggest-field';
import { DEFAULT_SETTINGS } from '../src/types';
import { applyHeadPin } from '../src/visit-paint-guard';
import { concealCollapsedVisitNotes, layoutVisitNotes } from '../src/visit-display';
import { concealHeadingFoldMarks, concealRecentFoldWidgets, lockHiddenMetaBindFields, planLivePreviewVisits, recentFoldLineStarts, setRecentNotesOpenState, visitPreviewExtension } from '../src/visit-live-preview';
import { clearOlderVisitsState, concealPlainOlderHeadings, markPreviewOlderVisits, olderVisitsOpen, setOlderVisitsOpenState } from '../src/visit-older';
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

function visibleEditorText(root: ParentNode): string {
	const parts: string[] = [];
	const walk = (node: Node): void => {
		if (node instanceof window.HTMLElement) {
			if (node.classList.contains('rv-recent-folded')) return;
			if (node.style?.display === 'none') return;
		}
		if (node.nodeType === window.Node.TEXT_NODE) parts.push(node.textContent ?? '');
		node.childNodes.forEach(walk);
	};
	walk(root);
	return parts.join(' ');
}

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
		let reached = 0;
		const hear = (): void => { reached += 1; };
		window.document.addEventListener('keydown', hear);
		window.document.addEventListener('keyup', hear);
		const down = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		const up = new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true, cancelable: true });
		window.document.dispatchEvent(down);
		window.document.dispatchEvent(up);
		assert.equal(panel.hidden, true);
		assert.equal(down.defaultPrevented, true);
		assert.equal(up.defaultPrevented, true);
		assert.equal(reached, 0);
		const downClosed = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		const upClosed = new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true, cancelable: true });
		window.document.dispatchEvent(downClosed);
		window.document.dispatchEvent(upClosed);
		assert.equal(downClosed.defaultPrevented, false);
		assert.equal(upClosed.defaultPrevented, false);
		assert.equal(reached, 2);
		window.document.removeEventListener('keydown', hear);
		window.document.removeEventListener('keyup', hear);
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
		const noteBody = window.document.createElement('p');
		noteBody.className = 'el-p';
		noteBody.textContent = 'First visit. Left the long video link.';
		sections[0]?.after(noteBody);
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
		assert.equal(noteBody.style.display, 'none');
		assert.ok(stop instanceof window.HTMLElement);
		assert.equal(noteBody.compareDocumentPosition(stop) & window.Node.DOCUMENT_POSITION_FOLLOWING, window.Node.DOCUMENT_POSITION_FOLLOWING);
		assert.equal(stop.compareDocumentPosition(callout) & window.Node.DOCUMENT_POSITION_FOLLOWING, window.Node.DOCUMENT_POSITION_FOLLOWING);
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

	it('RV-B30 draws Older Visits in the first older section and leaves Return Suggestions up', async () => {
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view markdown-reading-view';
		const sizer = window.document.createElement('div');
		sizer.className = 'markdown-preview-sizer';
		preview.appendChild(sizer);
		const notesSection = window.document.createElement('div');
		notesSection.className = 'markdown-preview-section';
		const notesWrap = window.document.createElement('div');
		notesWrap.className = 'el-h3';
		const notes = window.document.createElement('h3');
		notes.textContent = 'Recent Notes:';
		notesWrap.appendChild(notes);
		notesSection.appendChild(notesWrap);
		sizer.appendChild(notesSection);
		const stamps = [
			'Fri, 9am — Apr 2, 2026',
			'Thu, 2pm — Mar 20, 2026',
			'Wed, 3pm — Feb 2, 2026',
			'Thu, 4pm — Jan 8, 2026',
			'Thu, 5pm — Mar 12, 2026',
		];
		const sections = stamps.map((stamp) => {
			const section = window.document.createElement('div');
			section.className = 'markdown-preview-section';
			const wrap = window.document.createElement('div');
			wrap.className = 'el-h5';
			const heading = window.document.createElement('h5');
			heading.className = 'rv-visit-stamp';
			heading.textContent = stamp;
			wrap.appendChild(heading);
			section.appendChild(wrap);
			sizer.appendChild(section);
			return section;
		});
		const calloutSection = window.document.createElement('div');
		calloutSection.className = 'markdown-preview-section';
		const callout = window.document.createElement('div');
		callout.className = 'callout rv-locator-return-suggestions';
		const title = window.document.createElement('div');
		title.className = 'callout-title';
		title.textContent = 'Return Suggestions';
		callout.appendChild(title);
		calloutSection.appendChild(callout);
		const trailing = window.document.createElement('div');
		trailing.className = 'markdown-preview-section';
		const tail = window.document.createElement('p');
		tail.textContent = 'A note after the suggestions.';
		trailing.appendChild(tail);
		sizer.append(calloutSection, trailing);
		window.document.body.appendChild(preview);
		const markdown = `### Recent Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`;
		const options = { newestFirst: true, collapseOlder: true, limit: 3 };
		layoutVisitNotes(preview, markdown, options);
		const firstOlder = sections[3];
		const hiddenOlder = sections[4];
		assert.ok(firstOlder instanceof window.HTMLElement);
		assert.ok(hiddenOlder instanceof window.HTMLElement);
		assert.equal(firstOlder.classList.contains('rv-older-first'), true);
		const placed = preview.querySelector('h3.rv-older-visits');
		assert.ok(placed instanceof window.HTMLElement);
		assert.equal(preview.querySelectorAll('h3.rv-older-visits').length, 1);
		assert.equal(firstOlder.contains(placed), true);
		const strayWrap = placed.closest('.rv-older-visits-wrap');
		assert.ok(strayWrap instanceof window.HTMLElement);
		hiddenOlder.style.display = 'none';
		hiddenOlder.classList.remove('rv-older-first');
		const strayRule = strayWrap.previousElementSibling;
		if (strayRule instanceof window.HTMLElement && strayRule.classList.contains('rv-older-rule')) hiddenOlder.appendChild(strayRule);
		hiddenOlder.appendChild(strayWrap);
		firstOlder.classList.add('rv-older-first');
		layoutVisitNotes(preview, markdown, options);
		const heading = preview.querySelector('h3.rv-older-visits');
		assert.ok(heading instanceof window.HTMLElement);
		assert.equal(preview.querySelectorAll('h3.rv-older-visits').length, 1);
		assert.equal(firstOlder.contains(heading), true);
		assert.equal(hiddenOlder.contains(heading), false);
		assert.equal(heading.closest('.rv-older-visits-wrap')?.parentElement, firstOlder);
		assert.equal(heading.classList.contains('is-open'), false);
		heading.click();
		assert.equal(heading.classList.contains('is-open'), true);
		let bubbled = false;
		preview.addEventListener('click', () => { bubbled = true; });
		let sibling = notesSection.nextElementSibling;
		while (sibling instanceof window.HTMLElement) {
			sibling.style.display = 'none';
			sibling = sibling.nextElementSibling;
		}
		notes.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(bubbled, false);
		assert.equal(notesWrap.classList.contains('is-collapsed'), true);
		for (const recent of sections.slice(0, 3)) {
			assert.equal(recent.classList.contains('rv-recent-folded'), true);
			assert.equal(recent.style.display, 'none');
		}
		assert.equal(firstOlder.classList.contains('rv-recent-folded'), false);
		assert.notEqual(firstOlder.style.display, 'none');
		assert.equal(calloutSection.classList.contains('rv-recent-folded'), false);
		assert.notEqual(calloutSection.style.display, 'none');
		assert.equal(trailing.classList.contains('rv-recent-folded'), false);
		assert.notEqual(trailing.style.display, 'none');
		assert.equal(hiddenOlder.classList.contains('rv-recent-folded'), false);
		preview.remove();
	});

	it('opens a new RV in Reading once and keeps the Recent Notes chevron gray', () => {
		const main = readFileSync('src/main.ts', 'utf8');
		const activate = main.slice(main.indexOf('private async activateNewRvNote'), main.indexOf('private releaseNewRvCover'));
		assert.match(activate, /this\.pendingNewRvPath = null/);
		assert.equal(activate.includes('this.pendingNewRvPath = current.path'), false);
		assert.match(activate, /await this\.openInReadingView\(current, true\)/);
		const watch = main.slice(main.indexOf('private async watchCreatedDigest'), main.indexOf('private async rewriteDigestFile'));
		const gate = watch.indexOf('if (this.pendingNewRvPath === current.path)');
		const force = watch.indexOf('openInReadingView(current, true)');
		assert.ok(gate >= 0 && force > gate);
		const css = readFileSync('styles.css', 'utf8');
		assert.match(css, /\.view-content \.is-collapsed h3\.rv-visit-notes-heading > \.collapse-indicator svg\.svg-icon[\s\S]{0,500}color:\s*var\(--collapse-icon-color, var\(--text-faint\)\) !important/);
		assert.doesNotMatch(css, /h3\.rv-visit-notes-heading[\s\S]{0,240}--collapse-icon-color-collapsed/);
	});

	it('RV-B30 a live preview chevron hides recent lines and leaves Older Visits up', async () => {
		const markdown = [
			'### Recent Notes:',
			'##### Mon, 9am — Sep 1, 2026',
			'First visit. Left the long video link.',
			'`INPUT[textArea:sVisit1Notes]`',
			'##### Tue, 2pm — Sep 2, 2026',
			'She said "come back Tuesday".',
			'`INPUT[textArea:sVisit2Notes]`',
			'##### Wed, 3pm — Sep 3, 2026',
			'Short title, one chip.',
			'`INPUT[textArea:sVisit3Notes]`',
			'##### Thu, 4pm — Sep 4, 2026',
			'older kept',
			'`INPUT[textArea:sVisit4Notes]`',
			'',
			'> [!example] Return Suggestions',
			'> Try Friday',
			'',
			'### Later Heading',
			'stays visible',
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
		const shown = visibleEditorText(view.dom);
		assert.equal(shown.includes('First visit'), false);
		assert.equal(shown.includes('come back Tuesday'), false);
		assert.equal(shown.includes('Short title, one chip'), false);
		assert.equal(shown.includes('sVisit1Notes'), false);
		assert.equal(view.dom.querySelector('[data-rv-notes-key="sVisit1Notes"]'), null);
		assert.match(shown, /Older Visits|Thu, 4pm/);
		assert.match(shown, /Return Suggestions/);
		assert.match(shown, /Later Heading/);
		assert.match(shown, /stays visible/);
		const older = view.dom.querySelector('.rv-older-visits, .rv-older-visits-widget');
		assert.ok(older instanceof window.HTMLElement);
		assert.equal(older.classList.contains('rv-recent-folded'), false);
		assert.equal(older.closest('.rv-recent-folded'), null);
		assert.match(css, /\.cm-line\.rv-recent-folded,\s*\.rv-recent-folded \{\s*display:\s*none !important;/);
		const collapsed = view.dom.querySelector('h3.rv-visit-notes-heading');
		assert.ok(collapsed instanceof window.HTMLElement);
		collapsed.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.ok(view.dom.querySelector('[data-rv-notes-key="sVisit1Notes"]'));
		assert.match(visibleEditorText(view.dom), /First visit/);
		view.destroy();
		parent.remove();
	});

	it('RV-B30 hides recent note lines when the note has no Older Visits or Return Suggestions', async () => {
		const markdown = [
			'### Recent Notes:',
			'##### Mon, 9am — Sep 1, 2026',
			'only recent',
			'`INPUT[textArea:sVisit1Notes]`',
			'### After Notes',
			'after body',
		].join('\n');
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		setRecentNotesOpenState('rv-b30-plain.md', true);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: markdown,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 3 }), () => 'rv-b30-plain.md'),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const heading = view.dom.querySelector('h3.rv-visit-notes-heading');
		assert.ok(heading instanceof window.HTMLElement);
		heading.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
		const shown = visibleEditorText(view.dom);
		assert.equal(shown.includes('only recent'), false);
		assert.equal(shown.includes('sVisit1Notes'), false);
		assert.match(shown, /After Notes/);
		assert.match(shown, /after body/);
		const bare = [
			'### Recent Notes:',
			'##### Mon, 9am — Sep 1, 2026',
			'nothing after',
		].join('\n');
		const hidden = recentFoldLineStarts(bare, false, 3).map((from) => {
			const end = bare.indexOf('\n', from);
			return bare.slice(from, end === -1 ? undefined : end);
		});
		assert.equal(hidden.some((line) => line.includes('nothing after')), true);
		assert.equal(hidden.some((line) => line.includes('Recent Notes')), false);
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
		assert.match(css, /select\[aria-label="AM or PM"\]:not\(\.is-measuring\) \{[^}]*flex:\s*0 0 4\.5rem !important;/);
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
		assert.equal(opened, 1);
		root.remove();
	});

	it('RV-210 one address tap opens directions once', () => {
		const calls: string[] = [];
		const previous = (globalThis as { require?: unknown }).require;
		(globalThis as { require?: (id: string) => unknown }).require = () => ({
			shell: { openExternal: (url: string) => { calls.push(url); } },
		});
		try {
			const url = 'https://www.google.com/maps/dir/?api=1&destination=1%20Main';
			openExternalUrl(url);
			openExternalUrl(url);
			assert.deepEqual(calls, [url]);
			assert.equal(claimExternalOpen(url, Date.now() + 500), true);
		} finally {
			(globalThis as { require?: unknown }).require = previous;
		}
		const parent = window.document.createElement('div');
		const child = window.document.createElement('div');
		const link = window.document.createElement('a');
		link.className = 'rv-address-link';
		link.setAttribute('href', 'https://maps.example/search');
		const earth = window.document.createElement('a');
		earth.className = 'rv-map-button';
		child.append(link, earth);
		parent.append(child);
		parent.dataset.rvRoutePath = 'People/Eve.md';
		child.dataset.rvRoutePath = 'People/Eve.md';
		const opens: string[] = [];
		let listens = 0;
		const original = child.addEventListener.bind(child);
		child.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
			if (type === 'click') listens += 1;
			original(type, listener, options);
		}) as typeof child.addEventListener;
		bindAddressDirections(parent, (path) => { opens.push(path); });
		bindAddressDirections(child, (path) => { opens.push(`child:${path}`); });
		bindAddressDirections(child, (path) => { opens.push(`again:${path}`); });
		assert.equal(listens, 1);
		const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
		link.dispatchEvent(event);
		assert.deepEqual(opens, ['People/Eve.md']);
		assert.equal(link.getAttribute('href'), '#');
		handleAddressDirectionsClick(event, (path) => { opens.push(`second:${path}`); });
		assert.deepEqual(opens, ['People/Eve.md']);
		earth.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
		assert.deepEqual(opens, ['People/Eve.md']);
	});

	it('RV-B30 live preview keeps Older Visits, the callout, and the paragraph on their own fold', async () => {
		const markdown = [
			'### Recent Notes:',
			'##### Mon, 9am — Sep 1, 2026',
			'recent one',
			'`INPUT[textArea:sVisit1Notes]`',
			'##### Tue, 2pm — Sep 2, 2026',
			'recent two',
			'`INPUT[textArea:sVisit2Notes]`',
			'##### Wed, 3pm — Sep 3, 2026',
			'recent three',
			'`INPUT[textArea:sVisit3Notes]`',
			'### Older Visits',
			'##### Thu, 4pm — Sep 4, 2026',
			'older one',
			'`INPUT[textArea:sVisit4Notes]`',
			'##### Fri, 5pm — Sep 5, 2026',
			'older two',
			'`INPUT[textArea:sVisit5Notes]`',
			'',
			'> [!example] Return Suggestions',
			'> Try Friday evening',
			'',
			'The trailing paragraph stays.',
		].join('\n');
		const plan = planLivePreviewVisits(markdown, { collapseOlder: true, limit: 3 });
		const hiddenText = plan.hiddenLines.map((from) => {
			const end = markdown.indexOf('\n', from);
			return markdown.slice(from, end === -1 ? undefined : end);
		});
		assert.equal(hiddenText.some((line) => line.includes('Return Suggestions')), false);
		assert.equal(hiddenText.some((line) => line.includes('Try Friday')), false);
		assert.equal(hiddenText.some((line) => line.includes('trailing paragraph')), false);
		assert.equal(hiddenText.some((line) => line.includes('### Older Visits')), false);
		assert.equal(hiddenText.some((line) => line.includes('older one')), true);
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		setOlderVisitsOpenState('rv-b30-sections.md', true);
		setRecentNotesOpenState('rv-b30-sections.md', true);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: markdown,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 3 }), () => 'rv-b30-sections.md'),
			}),
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 0));
			const heading = view.dom.querySelector('h3.rv-visit-notes-heading');
			assert.ok(heading instanceof window.HTMLElement);
			heading.click();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const shown = visibleEditorText(view.dom);
			assert.equal(shown.includes('recent one'), false);
			assert.equal(shown.includes('recent two'), false);
			assert.equal(shown.includes('recent three'), false);
			assert.match(shown, /older one/);
			assert.match(shown, /older two/);
			assert.match(shown, /Return Suggestions/);
			assert.match(shown, /trailing paragraph/);
			assert.equal((shown.match(/Older Visits/g) ?? []).length, 1);
			assert.equal(view.dom.querySelectorAll('.rv-older-visits-widget').length, 1);
			assert.equal(view.dom.querySelector('.cm-line.rv-older-hidden'), null);
			const olderHeading = view.dom.querySelector('h3.rv-older-visits');
			assert.ok(olderHeading instanceof window.HTMLElement);
			assert.equal(olderHeading.classList.contains('is-open'), true);
			assert.equal(olderVisitsOpen('rv-b30-sections.md'), true);
			const reopen = view.dom.querySelector('h3.rv-visit-notes-heading');
			assert.ok(reopen instanceof window.HTMLElement);
			reopen.click();
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.equal(olderVisitsOpen('rv-b30-sections.md'), true);
			assert.match(visibleEditorText(view.dom), /older one/);
			assert.equal(view.dom.querySelector('.cm-line.rv-older-hidden'), null);
			const host = window.document.createElement('div');
			const hiddenLine = window.document.createElement('div');
			hiddenLine.className = 'cm-line rv-older-hidden';
			const field = window.document.createElement('div');
			field.className = 'mb-input';
			const embed = window.document.createElement('div');
			embed.className = 'cm-embed-block';
			embed.classList.add('rv-older-hidden');
			const callout = window.document.createElement('div');
			callout.className = 'callout';
			const title = window.document.createElement('div');
			title.className = 'callout-title';
			title.textContent = 'Return Suggestions';
			callout.appendChild(title);
			embed.appendChild(callout);
			const mark = window.document.createElement('span');
			mark.className = 'cm-fold-indicator';
			mark.textContent = '>';
			const notesLine = window.document.createElement('div');
			notesLine.className = 'cm-line rv-lp-notes-heading';
			notesLine.appendChild(mark);
			const dots = window.document.createElement('div');
			dots.className = 'cm-foldPlaceholder';
			dots.textContent = '...';
			host.append(hiddenLine, field, embed, notesLine, dots);
			lockHiddenMetaBindFields(host);
			assert.equal(embed.classList.contains('rv-older-hidden'), false);
			assert.equal(field.classList.contains('rv-mb-locked'), true);
			concealHeadingFoldMarks(host);
			assert.equal(mark.style.display, 'none');
			assert.equal(dots.style.display, 'none');
			host.remove();
		} finally {
			view.destroy();
			parent.remove();
			clearOlderVisitsState();
			setRecentNotesOpenState('rv-b30-sections.md', true);
		}
	});

	it('RV-B26 the first Escape closes the open list when the sheet is already listening', () => {
		const root = window.document.createElement('div');
		window.document.body.appendChild(root);
		let closed = 0;
		const close = (): void => {
			if (suggestEscapeShouldHold(root)) return;
			closed += 1;
		};
		const onKey = (event: Event): void => {
			if (!(event instanceof window.KeyboardEvent) || event.key !== 'Escape') return;
			close();
		};
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('keyup', onKey, true);
		const fields = ['Publisher', 'Literature', 'Media'].map((label) => {
			const host = window.document.createElement('div');
			const input = window.document.createElement('input');
			input.setAttribute('aria-label', label);
			host.appendChild(input);
			root.appendChild(host);
			mountAlwaysChevron(input, () => ['Alpha', 'Beta'], () => {});
			const button = host.querySelector('button');
			const panel = host.querySelector('.rv-suggest-panel');
			assert.ok(button instanceof window.HTMLButtonElement);
			assert.ok(panel instanceof window.HTMLElement);
			return { button, panel };
		});
		const sheet = readFileSync('src/visit-modals.ts', 'utf8');
		assert.match(sheet, /suggestEscapeShouldHold\(this\.contentEl\)/);
		try {
			for (const field of fields) {
				closed = 0;
				field.button.click();
				assert.equal(field.panel.hidden, false);
				const down = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
				const up = new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true, cancelable: true });
				window.dispatchEvent(down);
				window.dispatchEvent(up);
				assert.equal(field.panel.hidden, true);
				assert.equal(closed, 0);
				const downAgain = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
				const upAgain = new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true, cancelable: true });
				window.dispatchEvent(downAgain);
				assert.equal(closed, 1);
				window.dispatchEvent(upAgain);
				assert.ok(closed >= 1);
			}
			closed = 0;
			fields[0]?.button.click();
			assert.equal(fields[0]?.panel.hidden, false);
			close();
			assert.equal(closed, 1);
		} finally {
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('keyup', onKey, true);
			root.remove();
		}
	});

	it('a missed Escape keyup still lets the next Escape close the sheet', async () => {
		const root = window.document.createElement('div');
		window.document.body.appendChild(root);
		let closed = 0;
		const close = (): void => {
			if (suggestEscapeShouldHold(root)) return;
			closed += 1;
		};
		const onKey = (event: Event): void => {
			if (!(event instanceof window.KeyboardEvent) || event.key !== 'Escape') return;
			close();
		};
		window.addEventListener('keydown', onKey, true);
		const host = window.document.createElement('div');
		const input = window.document.createElement('input');
		host.appendChild(input);
		root.appendChild(host);
		mountAlwaysChevron(input, () => ['Alpha'], () => {});
		const button = host.querySelector('button');
		const panel = host.querySelector('.rv-suggest-panel');
		assert.ok(button instanceof window.HTMLButtonElement);
		assert.ok(panel instanceof window.HTMLElement);
		try {
			button.click();
			assert.equal(panel.hidden, false);
			window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			assert.equal(panel.hidden, true);
			assert.equal(closed, 0);
			await new Promise((resolve) => setTimeout(resolve, 0));
			window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			assert.equal(closed, 1);
		} finally {
			window.removeEventListener('keydown', onKey, true);
			root.remove();
		}
	});

	it('RV-B30 the plain Older Visits line stays hidden while the chevron shows', () => {
		const preview = window.document.createElement('div');
		preview.className = 'markdown-preview-view';
		const plainWrap = window.document.createElement('div');
		plainWrap.className = 'el-h3';
		const plain = window.document.createElement('h3');
		plain.textContent = 'Older Visits';
		plainWrap.appendChild(plain);
		preview.appendChild(plainWrap);
		const section = window.document.createElement('div');
		section.className = 'el-h5';
		const stamp = window.document.createElement('h5');
		stamp.className = 'rv-visit-stamp';
		stamp.textContent = 'Thu, 4pm — Sep 4, 2026';
		section.appendChild(stamp);
		preview.appendChild(section);
		window.document.body.appendChild(preview);
		setOlderVisitsOpenState('eve-b30.md', true, preview);
		markPreviewOlderVisits(preview, { limit: 0, collapseOlder: true }, 'eve-b30.md');
		const chevron = preview.querySelector('h3.rv-older-visits');
		assert.ok(chevron instanceof window.HTMLElement);
		assert.equal(chevron.classList.contains('is-open'), true);
		assert.equal(chevron.closest('.rv-older-source-hidden'), null);
		assert.equal(plainWrap.classList.contains('rv-older-source-hidden'), true);
		const live = window.document.createElement('div');
		const livePlain = window.document.createElement('h3');
		livePlain.textContent = 'Older Visits';
		const widget = window.document.createElement('div');
		widget.className = 'rv-older-visits-widget';
		const liveChevron = window.document.createElement('h3');
		liveChevron.className = 'rv-older-visits';
		liveChevron.textContent = 'Older Visits';
		widget.appendChild(liveChevron);
		live.append(livePlain, widget);
		concealPlainOlderHeadings(live);
		assert.equal(livePlain.classList.contains('rv-older-source-hidden'), true);
		assert.equal(liveChevron.classList.contains('rv-older-source-hidden'), false);
		assert.match(css, /\.rv-older-source-hidden \{\s*display:\s*none !important;/);
		assert.match(css, /\.cm-line\.rv-lp-older-heading \{\s*font-size:\s*0 !important;\s*line-height:\s*0 !important;/);
		assert.match(css, /\.cm-line\.rv-lp-older-heading \.rv-older-visits \{\s*font-size:\s*var\(--h3-size, 1\.1em\) !important;/);
		preview.remove();
		clearOlderVisitsState();
	});

	it('RV-B30 a folded Recent Notes line hides later note lines and stops at the next section', () => {
		const root = window.document.createElement('div');
		const notes = window.document.createElement('div');
		notes.className = 'cm-line rv-lp-notes-heading';
		notes.textContent = '### Recent Notes:';
		const folded = window.document.createElement('div');
		folded.className = 'cm-line rv-recent-folded';
		folded.textContent = '##### Mon, 9am — Sep 1, 2026';
		const sentence = window.document.createElement('div');
		sentence.className = 'cm-line';
		sentence.textContent = 'She asked us to come back Friday.';
		const older = window.document.createElement('div');
		older.className = 'cm-line rv-lp-older-heading';
		older.textContent = '### Older Visits';
		const kept = window.document.createElement('div');
		kept.className = 'cm-line';
		kept.textContent = 'older body';
		root.append(notes, folded, sentence, older, kept);
		concealRecentFoldWidgets(root);
		assert.equal(notes.classList.contains('rv-recent-folded'), false);
		assert.equal(sentence.classList.contains('rv-recent-folded'), true);
		assert.equal(older.classList.contains('rv-recent-folded'), false);
		assert.equal(kept.classList.contains('rv-recent-folded'), false);
	});

	it('RV-B30 collapsing Recent Notes hides the notes when they are the last lines', async () => {
		const sentences = [
			'She was home and took the tract.',
			'We talked about the video.',
			'She asked us to come back Friday.',
		];
		const markdown = [
			'### Recent Notes:',
			'##### Mon, 9am — Sep 1, 2026',
			...sentences,
		].join('\n');
		const level3 = [
			'### Recent Notes:',
			'### Mon, 9am — Sep 1, 2026',
			...sentences,
		].join('\n');
		for (const [doc, path] of [[markdown, 'eve-eof.md'], [level3, 'eve-level3.md']] as const) {
			const hidden = recentFoldLineStarts(doc, false, 3).map((from) => {
				const end = doc.indexOf('\n', from);
				return doc.slice(from, end === -1 ? undefined : end);
			});
			for (const sentence of sentences) assert.equal(hidden.some((line) => line.includes(sentence)), true);
			assert.equal(hidden.some((line) => line.includes('Recent Notes')), false);
		}
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		setRecentNotesOpenState('eve-eof.md', true);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: markdown,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 3 }), () => 'eve-eof.md'),
			}),
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 0));
			const heading = view.dom.querySelector('h3.rv-visit-notes-heading');
			assert.ok(heading instanceof window.HTMLElement);
			heading.click();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const shown = visibleEditorText(view.dom);
			for (const sentence of sentences) assert.equal(shown.includes(sentence), false);
			assert.match(shown, /Recent Notes/);
		} finally {
			view.destroy();
			parent.remove();
			setRecentNotesOpenState('eve-eof.md', true);
		}
	});
});
