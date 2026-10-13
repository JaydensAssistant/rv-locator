import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { layoutVisitNotes } from '../src/visit-display';
import {
	onLiveVisitHost,
	planLivePreviewVisits,
	refreshVisitPreviewEffect,
	setOlderVisitsOpen,
	visitPreviewExtension,
} from '../src/visit-live-preview';
import { clearVisitNoteCaches, mountRawVisitNotes } from '../src/visit-notes-field';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const host = globalThis as typeof globalThis & Record<string, unknown>;
host.window = window;
host.document = window.document;
host.HTMLElement = window.HTMLElement;
host.Element = window.Element;
host.Node = window.Node;
host.Document = window.Document;
host.DocumentFragment = window.DocumentFragment;
host.Range = window.Range;
host.getComputedStyle = window.getComputedStyle.bind(window);
host.getSelection = window.getSelection.bind(window);
host.requestAnimationFrame = window.requestAnimationFrame.bind(window);
host.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
host.MutationObserver = window.MutationObserver;
host.NodeFilter = window.NodeFilter;

const proto = window.HTMLElement.prototype as HTMLElement & Record<string, (...args: never[]) => unknown>;
proto.addClass = function addClass(this: HTMLElement, cls: string) {
	this.classList.add(...cls.split(/\s+/).filter(Boolean));
};
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

const stamps = [
	'Mon, 9am — Sep 1, 2026',
	'Tue, 2pm — Sep 2, 2026',
	'Wed, 3pm — Sep 3, 2026',
	'Thu, 4pm — Sep 4, 2026',
	'Fri, 5pm — Sep 5, 2026',
];
const note = stamps.map((stamp) => `##### ${stamp}\nnotes`).join('\n');

describe('live preview older visits', () => {
	it('plans a widget and hidden lines without touching the text', () => {
		const plan = planLivePreviewVisits(note, { collapseOlder: true, limit: 3 });
		assert.equal(plan.widgetAt != null, true);
		const hidden = plan.hiddenLines.map((from) => note.slice(from, note.indexOf('\n', from)));
		assert.deepEqual(hidden.filter((line) => line.startsWith('#####')), [
			'##### Thu, 4pm — Sep 4, 2026',
			'##### Fri, 5pm — Sep 5, 2026',
		]);
		assert.equal(note.includes('Older Visits'), false);
	});

	it('keeps the document byte-identical when the live preview pass runs repeatedly', async () => {
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: note,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 3 })),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const before = view.state.doc.toString();
		assert.equal(before.includes('Older Visits'), false);
		for (let pass = 0; pass < 6; pass += 1) {
			const refresh = view.state.update({ effects: refreshVisitPreviewEffect.of(null) });
			assert.equal(refresh.docChanged, false);
			assert.equal(refresh.changes.empty, true);
			view.dispatch(refresh);
			const toggle = view.state.update({ effects: setOlderVisitsOpen.of(pass % 2 === 0) });
			assert.equal(toggle.docChanged, false);
			assert.equal(toggle.changes.empty, true);
			view.dispatch(toggle);
		}
		assert.equal(view.state.doc.toString(), before);
		assert.equal(Buffer.from(view.state.doc.toString(), 'utf8').equals(Buffer.from(before, 'utf8')), true);
		assert.match(view.dom.textContent ?? '', /Older Visits/);
		assert.equal((view.dom.textContent ?? '').includes('##### Thu'), true);
		const hidden = view.dom.querySelectorAll('.rv-older-hidden');
		assert.ok(hidden.length >= 2);
		view.dispatch({ effects: setOlderVisitsOpen.of(true) });
		assert.equal(view.state.doc.toString(), before);
		assert.equal(view.dom.querySelector('.rv-older-hidden'), null);
		view.destroy();

		const preview = window.document.createElement('div');
		preview.className = 'markdown-source-view';
		const content = window.document.createElement('div');
		content.className = 'cm-content';
		content.textContent = note;
		preview.appendChild(content);
		const text = content.textContent;
		const children = content.childNodes.length;
		for (let pass = 0; pass < 4; pass += 1) {
			layoutVisitNotes(preview, note, { newestFirst: true, collapseOlder: true, limit: 3 });
		}
		assert.equal(content.textContent, text);
		assert.equal(content.childNodes.length, children);
		assert.equal(preview.querySelector('.rv-older-visits'), null);
	});

	it('puts the note in the card and reads the campaign from the note text', async () => {
		const doc = [
			'##### Sun, 9:05am — Oct 11, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
			'',
			'> [!note]- Log',
			'> - Sun, 9:05am — Oct 11, 2026 — success — covered Convention',
		].join('\n');
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 })),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
		const box = view.dom.querySelector('.rv-visit-note-box');
		assert.ok(box);
		assert.match(box?.textContent ?? '', /sVisit1Notes/);
		assert.match(view.dom.querySelector('.is-campaign')?.textContent ?? '', /Convention/);
		assert.ok(view.dom.querySelector('.cm-line.rv-lp-card-source'));
		assert.equal(view.state.doc.toString(), doc);
		view.destroy();
	});

	it('hides the first meta-bind button fence when the cursor is at the start', async () => {
		const doc = [
			'```meta-bind-button',
			'id: rv-log-past',
			'hidden: true',
			'```',
			'',
			'##### Sun, 9:05am — Oct 11, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
		].join('\n');
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 })),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
		assert.equal(view.state.selection.main.from, 0);
		assert.ok(view.dom.querySelector('.cm-line.rv-mb-hidden'));
		assert.equal(view.state.doc.toString(), doc);
		view.destroy();
	});

	it('mounts the native notes textarea inside the live preview card', async () => {
		const doc = [
			'> [!note]- Attempt Log',
			'> - Sun, 9:05am — Oct 11, 2026 — success with Mom',
			'',
			'##### Sun, 9:05am — Oct 11, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
		].join('\n');
		onLiveVisitHost((root) => {
			mountRawVisitNotes(root, (key) => (key === 'sVisit1Notes' ? 'from the hub' : ''), () => {});
		});
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 })),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
		const area = view.dom.querySelector('textarea.rv-native-notes-area');
		assert.ok(area instanceof window.HTMLTextAreaElement);
		assert.equal(area.value, 'from the hub');
		assert.equal(view.dom.querySelector('.rv-lp-visit')?.textContent?.includes('INPUT[textArea'), false);
		assert.equal(view.dom.querySelector('.rv-lp-visit .rv-stamp-with')?.textContent, 'with Mom');
		onLiveVisitHost(null);
		view.destroy();
	});

	it('leaves a moved live-preview caret alone until the card is actually rebuilt', async () => {
		const doc = [
			'> [!note]- Attempt Log',
			'> - Sun, 9:05am — Oct 11, 2026 — success with Mom',
			'',
			'##### Sun, 9:05am — Oct 11, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
		].join('\n');
		const read = (key: string): string => (key === 'sVisit1Notes' ? 'from the hub' : '');
		onLiveVisitHost((root) => {
			mountRawVisitNotes(root, read, () => {});
		});
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 })),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
		const area = view.dom.querySelector('textarea.rv-native-notes-area');
		assert.ok(area instanceof window.HTMLTextAreaElement);
		const typed = 'from the hub';
		area.focus();
		area.value = typed;
		area.setSelectionRange(4, 4);
		area.dispatchEvent(new window.Event('input', { bubbles: true }));
		area.setSelectionRange(2, 2);
		area.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true }));
		const card = area.closest('.rv-lp-visit');
		assert.ok(card instanceof window.HTMLElement);
		mountRawVisitNotes(card, read, () => {});
		const same = card.querySelector('textarea.rv-native-notes-area');
		assert.equal(same, area);
		assert.equal(area.selectionStart, 2);
		assert.equal(area.selectionEnd, 2);
		const outside = view.state.doc.toString().indexOf('Attempt Log');
		assert.ok(outside >= 0);
		view.dispatch({
			changes: { from: outside + 'Attempt Log'.length, to: outside + 'Attempt Log'.length, insert: ' ' },
			selection: { anchor: 0 },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const skipped = view.dom.querySelector('textarea.rv-native-notes-area');
		assert.equal(skipped, area);
		assert.equal(area.selectionStart, 2);
		assert.equal(area.selectionEnd, 2);
		const needle = '`INPUT[textArea:sVisit1Notes]`';
		const at = view.state.doc.toString().lastIndexOf(needle);
		assert.ok(at >= 0);
		view.dispatch({
			changes: { from: at + needle.length, to: at + needle.length, insert: ' ' },
			selection: { anchor: 0 },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const rebuilt = view.dom.querySelector('textarea.rv-native-notes-area');
		assert.ok(rebuilt instanceof window.HTMLTextAreaElement);
		assert.notEqual(rebuilt, area);
		assert.equal(rebuilt.value, typed);
		assert.equal(rebuilt.selectionStart, 2);
		assert.equal(rebuilt.selectionEnd, 2);
		assert.notEqual(rebuilt.selectionStart, rebuilt.value.length);
		onLiveVisitHost(null);
		view.destroy();
	});

	it('binds a visit box to its own key when the tagged heading was not recognised', () => {
		clearVisitNoteCaches();
		const editor = window.document.createElement('div');
		editor.className = 'cm-editor';
		const missed = window.document.createElement('h5');
		missed.textContent = 'Sun, 5:23pm — Jun 28, 2026 · «book» «Tract» · «film» «Video»';
		const missedNote = window.document.createElement('p');
		missedNote.textContent = '`INPUT[textArea:sVisit2Notes]`';
		const heading = window.document.createElement('h5');
		heading.className = 'rv-visit-stamp';
		heading.textContent = 'Thu, 2:10pm — Jul 2, 2026';
		const box = window.document.createElement('div');
		box.className = 'rv-visit-note-box';
		const paragraph = window.document.createElement('p');
		paragraph.textContent = '`INPUT[textArea:sVisit1Notes]`';
		box.appendChild(paragraph);
		editor.append(missed, missedNote, heading, box);
		window.document.body.appendChild(editor);
		try {
			mountRawVisitNotes(editor, () => 'thu', () => {}, ['sVisit2Notes', 'sVisit1Notes'], 'Dale.md');
			const area = box.querySelector('textarea.rv-native-notes-area');
			assert.ok(area instanceof window.HTMLTextAreaElement);
			assert.equal(area.dataset.rvNoteKey, 'sVisit1Notes');
			assert.equal(area.value, 'thu');
		} finally {
			editor.remove();
			clearVisitNoteCaches();
		}
	});

	it('frames a tagged older visit and pairs each box with its own key', async () => {
		const sun = 'Sun, 5:23pm — Jun 28, 2026 · «book» «Enjoy Life Forever» · «film» «Why Study the Bible»';
		const doc = [
			'##### Wed, 3pm — Sep 3, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
			'',
			`##### ${sun}`,
			'`INPUT[textArea:sVisit2Notes]`',
			'',
			'##### Thu, 2:10pm — Jul 2, 2026',
			'`INPUT[textArea:sVisit3Notes]`',
		].join('\n');
		const keys = ['sVisit1Notes', 'sVisit2Notes', 'sVisit3Notes'];
		clearVisitNoteCaches();
		onLiveVisitHost((root) => {
			mountRawVisitNotes(root, (key) => (key === 'sVisit3Notes' ? 'thu' : key), () => {}, keys, 'Dale.md');
		});
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 1 })),
			}),
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 0));
			view.dispatch({ effects: setOlderVisitsOpen.of(true) });
			view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
			await new Promise((resolve) => setTimeout(resolve, 0));
			const cards = Array.from(view.dom.querySelectorAll('.rv-lp-visit'));
			assert.equal(cards.length, 3);
			assert.match(cards[1]?.textContent ?? '', /«book»/);
			assert.match(cards[2]?.textContent ?? '', /Thu, 2:10pm/);
			const bound = Array.from(view.dom.querySelectorAll('textarea.rv-native-notes-area')).map((node) => (
				node instanceof window.HTMLTextAreaElement ? node.dataset.rvNoteKey : ''
			));
			assert.deepEqual(bound, keys);
			const thu = view.dom.querySelector('textarea.rv-native-notes-area[data-rv-note-key="sVisit3Notes"]');
			assert.ok(thu instanceof window.HTMLTextAreaElement);
			assert.equal(thu.value, 'thu');
			const raw = Array.from(view.dom.querySelectorAll('.cm-line:not(.rv-lp-card-source)')).map((node) => node.textContent ?? '');
			assert.equal(raw.some((line) => line.includes('«book»')), false);
			assert.equal(view.state.doc.toString(), doc);
		} finally {
			onLiveVisitHost(null);
			view.destroy();
			parent.remove();
			clearVisitNoteCaches();
		}
	});
});
