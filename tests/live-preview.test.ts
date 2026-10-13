import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { decorateVisitControls } from '../src/visit-controls';
import { layoutVisitNotes } from '../src/visit-display';
import { clearOlderVisitsState } from '../src/visit-older';
import {
	collapseVisitGapLines,
	lockHiddenMetaBindFields,
	planLivePreviewVisits,
	refreshVisitPreviewEffect,
	setOlderVisitsOpen,
	visitPreviewExtension,
} from '../src/visit-live-preview';
import { clearVisitNoteCaches, mountVisitNotesInSection } from '../src/visit-notes-field';
import { applyExternalVisitNotes } from '../src/visit-notes-store';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const host = globalThis as typeof globalThis & Record<string, unknown>;
host.window = window;
host.document = window.document;
host.HTMLElement = window.HTMLElement;
host.HTMLTextAreaElement = window.HTMLTextAreaElement;
host.HTMLInputElement = window.HTMLInputElement;
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
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 3 }), () => 'note.md'),
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
		assert.match(view.dom.textContent ?? '', /Thu, 4pm/);
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
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 }), () => 'Dale.md'),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
		const area = view.dom.querySelector('textarea.rv-native-notes-area');
		assert.ok(area instanceof window.HTMLTextAreaElement);
		assert.equal(area.dataset.rvNotesKey, 'sVisit1Notes');
		assert.equal(view.dom.querySelector('.rv-visit-note-box'), null);
		assert.match(view.dom.querySelector('.is-campaign')?.textContent ?? '', /Convention/);
		const heading = view.dom.querySelector('.cm-line.rv-lp-visit-heading');
		assert.ok(heading);
		assert.match(heading.textContent ?? '', /Sun, 9:05am/);
		assert.ok(heading.querySelector('.rv-cal'));
		assert.ok(heading.querySelector('.rv-stamp-when'));
		assert.ok(heading.querySelector('.rv-stamp-count'));
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
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 }), () => 'Dale.md'),
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
		clearVisitNoteCaches();
		applyExternalVisitNotes('Dale.md', { sVisit1Notes: 'from the hub' });
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 }), () => 'Dale.md'),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
		const area = view.dom.querySelector('textarea.rv-native-notes-area');
		assert.ok(area instanceof window.HTMLTextAreaElement);
		assert.equal(area.value, 'from the hub');
		assert.equal(area.dataset.rvNotesKey, 'sVisit1Notes');
		const heading = view.dom.querySelector('.cm-line.rv-lp-visit-heading');
		assert.match(heading?.textContent ?? '', /Sun, 9:05am/);
		assert.equal(view.dom.querySelector('.rv-stamp-with')?.textContent, 'with Mom');
		view.destroy();
		clearVisitNoteCaches();
	});

	it('keeps the same live-preview textarea when the document around it changes', async () => {
		const doc = [
			'> [!note]- Attempt Log',
			'> - Sun, 9:05am — Oct 11, 2026 — success with Mom',
			'',
			'##### Sun, 9:05am — Oct 11, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
		].join('\n');
		clearVisitNoteCaches();
		applyExternalVisitNotes('Dale.md', { sVisit1Notes: 'from the hub' });
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 }), () => 'Dale.md'),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
		const area = view.dom.querySelector('textarea.rv-native-notes-area');
		assert.ok(area instanceof window.HTMLTextAreaElement);
		area.focus();
		area.value = 'from the hub';
		area.setSelectionRange(2, 2);
		area.dispatchEvent(new window.Event('input', { bubbles: true }));
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
		assert.equal(view.dom.querySelector('textarea.rv-native-notes-area'), area);
		assert.equal(area.selectionStart, 2);
		const outside = view.state.doc.toString().indexOf('Attempt Log');
		view.dispatch({
			changes: { from: outside + 'Attempt Log'.length, to: outside + 'Attempt Log'.length, insert: ' ' },
			selection: { anchor: 0 },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(view.dom.querySelector('textarea.rv-native-notes-area'), area);
		assert.equal(area.selectionStart, 2);
		const needle = '`INPUT[textArea:sVisit1Notes]`';
		const at = view.state.doc.toString().lastIndexOf(needle);
		view.dispatch({
			changes: { from: at + needle.length, to: at + needle.length, insert: ' ' },
			selection: { anchor: 0 },
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const kept = view.dom.querySelector('textarea.rv-native-notes-area');
		assert.equal(kept, area);
		assert.equal(area.value, 'from the hub');
		assert.equal(area.selectionStart, 2);
		view.destroy();
		clearVisitNoteCaches();
	});

	it('binds a visit box to the key in its own declaration', () => {
		clearVisitNoteCaches();
		applyExternalVisitNotes('Dale.md', { sVisit1Notes: 'thu', sVisit2Notes: 'sun' });
		const section = window.document.createElement('div');
		section.className = 'markdown-preview-section';
		const paragraph = window.document.createElement('p');
		paragraph.textContent = '`INPUT[textArea:sVisit1Notes]`';
		section.appendChild(paragraph);
		window.document.body.appendChild(section);
		try {
			mountVisitNotesInSection(section, {
				sourcePath: 'Dale.md',
				addChild(child) { child.load(); },
			}, {
				vault: { getFileByPath: () => ({ path: 'Dale.md' }) },
				metadataCache: { getFileCache: () => ({ frontmatter: { sVisit1Notes: 'thu', sVisit2Notes: 'sun' } }) },
			} as never);
			const area = paragraph.querySelector('textarea.rv-native-notes-area');
			assert.ok(area instanceof window.HTMLTextAreaElement);
			assert.equal(area.dataset.rvNotesKey, 'sVisit1Notes');
			assert.equal(area.value, 'thu');
			assert.equal(paragraph.classList.contains('mb-none'), true);
			assert.equal(section.querySelector('.rv-visit-note-box'), null);
		} finally {
			section.remove();
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
		applyExternalVisitNotes('Dale.md', {
			sVisit1Notes: 'sVisit1Notes',
			sVisit2Notes: 'sVisit2Notes',
			sVisit3Notes: 'thu',
		});
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 1 }), () => 'Dale.md'),
			}),
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 0));
			view.dispatch({ effects: setOlderVisitsOpen.of(true) });
			view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
			await new Promise((resolve) => setTimeout(resolve, 0));
			const headings = Array.from(view.dom.querySelectorAll('.cm-line.rv-lp-visit-heading'));
			assert.equal(headings.length, 3);
			assert.ok(headings[1]?.querySelector('.rv-cal'));
			assert.match(headings[1]?.querySelector('.rv-stamp-when')?.textContent ?? '', /Sun, 5:23pm/);
			assert.match(headings[1]?.textContent ?? '', /Enjoy Life Forever/);
			assert.match(headings[2]?.querySelector('.rv-stamp-when')?.textContent ?? '', /Thu, 2:10pm/);
			const bound = Array.from(view.dom.querySelectorAll('textarea.rv-native-notes-area')).map((node) => (
				node instanceof window.HTMLTextAreaElement ? node.dataset.rvNotesKey : ''
			));
			assert.deepEqual(bound, keys);
			const thu = view.dom.querySelector('textarea.rv-native-notes-area[data-rv-notes-key="sVisit3Notes"]');
			assert.ok(thu instanceof window.HTMLTextAreaElement);
			assert.equal(thu.value, 'thu');
			assert.equal(view.state.doc.toString(), doc);
		} finally {
			view.destroy();
			parent.remove();
			clearVisitNoteCaches();
		}
	});

	it('rebuilds older heading widgets when the fold opens', async () => {
		clearOlderVisitsState();
		const doc = stamps.map((stamp, index) => (
			index === 3
				? `##### ${stamp} · «book» «Enjoy Life Forever»\n\`INPUT[textArea:sVisit${index + 1}Notes]\``
				: `##### ${stamp}\n\`INPUT[textArea:sVisit${index + 1}Notes]\``
		)).join('\n');
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 3 }), () => 'older-open.md'),
			}),
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 0));
			assert.equal(view.dom.querySelectorAll('.rv-lp-stamp').length, 3);
			view.dispatch({ effects: setOlderVisitsOpen.of(true) });
			const painted = Array.from(view.dom.querySelectorAll('.rv-lp-stamp'));
			assert.equal(painted.length, 5);
			for (const stamp of painted) {
				assert.ok(stamp.querySelector('.rv-cal'), 'calendar tile');
				assert.ok(stamp.querySelector('.rv-stamp-when'), 'time');
				assert.ok(stamp.querySelector('.rv-stamp-count'), 'day pill');
				assert.ok(stamp.querySelector('.rv-visit-more'), 'menu');
			}
			assert.match(painted[3]?.textContent ?? '', /Enjoy Life Forever/);
			assert.equal(view.dom.querySelector('.cm-line.rv-lp-visit-heading .rv-lp-stamp') != null, true);
			assert.equal(view.state.doc.toString(), doc);
		} finally {
			view.destroy();
			parent.remove();
			clearOlderVisitsState();
		}
	});

	it('centers Recent Notes and gives it the reading chevron', async () => {
		clearOlderVisitsState();
		const doc = [
			'### Recent Notes:',
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
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 }), () => 'recent.md'),
			}),
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 0));
			const heading = view.dom.querySelector('h3.rv-visit-notes-heading');
			assert.ok(heading instanceof window.HTMLElement);
			assert.match(heading.textContent ?? '', /Recent Notes:/);
			assert.ok(heading.querySelector('.collapse-indicator svg'));
			assert.equal(view.state.doc.toString(), doc);
		} finally {
			view.destroy();
			parent.remove();
		}
	});

	it('draws an empty-material heading after Older Visits opens and when the cursor is on it', async () => {
		clearOlderVisitsState();
		const doc = [
			'##### Sun, 11:23pm — Oct 11, 2026 · «lesson» «How Can the Bible Help You?»',
			'`INPUT[textArea:sVisit1Notes]`',
			'',
			'##### Wed, 5:30pm — Aug 26, 2026',
			'`INPUT[textArea:sVisit2Notes]`',
			'',
			'##### Sat, 10:15am — Aug 15, 2026',
			'`INPUT[textArea:sVisit3Notes]`',
		].join('\n');
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: [
					visitPreviewExtension(() => ({ collapseOlder: true, limit: 1 }), () => 'empty-material.md'),
				],
			}),
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 0));
			const visible = view.dom.querySelector('.rv-lp-stamp');
			assert.ok(visible?.querySelector('.rv-cal'));
			assert.ok(visible?.querySelector('.rv-stamp-when'));
			view.dispatch({ effects: setOlderVisitsOpen.of(true) });
			await new Promise((resolve) => setTimeout(resolve, 0));
			const painted = Array.from(view.dom.querySelectorAll('.rv-lp-stamp'));
			assert.equal(painted.length, 3);
			for (const stamp of painted) {
				assert.ok(stamp.querySelector('.rv-cal'), 'calendar tile');
				assert.ok(stamp.querySelector('.rv-stamp-when'), 'time');
				assert.ok(stamp.querySelector('.rv-stamp-count'), 'day pill');
			}
			const ghosts = view.dom.querySelectorAll('.rv-item-strip.is-ghost');
			assert.equal(ghosts.length, 2);
			const line = view.state.doc.line(4);
			view.dispatch({ selection: { anchor: line.from + 8 } });
			assert.ok(view.dom.querySelectorAll('.rv-lp-stamp')[1]?.querySelector('.rv-cal'));
			assert.equal(view.state.doc.toString(), doc);
		} finally {
			view.destroy();
			parent.remove();
			clearOlderVisitsState();
		}
	});

	it('shows the same heading row in Reading when a visit has no strip material', () => {
		const root = window.document.createElement('div');
		root.className = 'markdown-rendered';
		root.innerHTML = '<h5>Wed, 5:30pm — Aug 26, 2026</h5><p>Quick chat at the door.</p>';
		decorateVisitControls(root, () => null, () => {});
		const heading = root.querySelector('h5.rv-visit-stamp');
		assert.ok(heading instanceof window.HTMLElement);
		assert.ok(heading.querySelector('.rv-cal'));
		assert.ok(heading.querySelector('.rv-stamp-when'));
		assert.ok(heading.querySelector('.rv-stamp-count'));
		const ghost = root.querySelector('.rv-item-strip');
		assert.ok(ghost instanceof window.HTMLElement);
		assert.equal(ghost.classList.contains('is-ghost'), true);
		assert.equal(ghost.previousElementSibling, heading);
	});

	it('collapses only the blank editor line under a visit note', () => {
		const root = window.document.createElement('div');
		root.innerHTML = [
			'<div class="cm-line rv-lp-visit-heading"><div class="rv-lp-stamp">Sun</div></div>',
			'<div class="rv-lp-notes"><textarea class="rv-native-notes-area"></textarea></div>',
			'<div class="cm-line"><br></div>',
			'<div class="cm-line">A real paragraph.</div>',
		].join('');
		collapseVisitGapLines(root);
		const lines = root.querySelectorAll('.cm-line');
		assert.equal(lines[1]?.classList.contains('rv-lp-gap'), true);
		assert.equal(lines[0]?.classList.contains('rv-lp-gap'), false);
		assert.equal(lines[2]?.classList.contains('rv-lp-gap'), false);
	});

	it('keeps closed Older Visits text areas hidden and inert', async () => {
		const doc = [
			'##### Wed, 3pm — Sep 3, 2026',
			'`INPUT[textArea:sVisit1Notes]`',
			'',
			'##### Thu, 2:10pm — Jul 2, 2026',
			'`INPUT[textArea:sVisit2Notes]`',
		].join('\n');
		clearVisitNoteCaches();
		clearOlderVisitsState();
		applyExternalVisitNotes('Dale.md', { sVisit1Notes: 'new', sVisit2Notes: 'old' });
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 1 }), () => 'Dale.md'),
			}),
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 0));
			const visible = view.dom.querySelector('textarea.rv-native-notes-area:not([disabled])');
			assert.ok(visible instanceof window.HTMLTextAreaElement, 'visible box');
			assert.equal(visible.dataset.rvNotesKey, 'sVisit1Notes');
			const locked = view.dom.querySelector('textarea.rv-native-notes-area[disabled]');
			assert.ok(locked instanceof window.HTMLTextAreaElement, 'locked box');
			assert.equal(locked.dataset.rvNotesKey, 'sVisit2Notes');
			assert.equal(locked.tabIndex, -1);
			const line = view.dom.querySelector('.cm-line.rv-older-hidden');
			assert.ok(line instanceof window.HTMLElement, 'hidden line');
			const foreignHost = window.document.createElement('div');
			const foreign = window.document.createElement('textarea');
			foreign.className = 'mb-input';
			foreignHost.appendChild(foreign);
			line.insertAdjacentElement('afterend', foreignHost);
			lockHiddenMetaBindFields(view.dom);
			assert.equal(foreign.disabled, true);
			assert.equal(foreignHost.classList.contains('rv-mb-locked'), true);
			assert.equal(view.state.doc.toString(), doc);
		} finally {
			view.destroy();
			parent.remove();
			clearVisitNoteCaches();
		}
	});
});
