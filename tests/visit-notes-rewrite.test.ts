import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { refreshVisitPreviewEffect, visitPreviewExtension } from '../src/visit-live-preview';
import { clearVisitNoteCaches, mountVisitNotesInSection } from '../src/visit-notes-field';
import { applyExternalVisitNotes, bindVisitNoteFlush, flushVisitNotes, visitNoteValue } from '../src/visit-notes-store';
import { classifyVisitSection, clearOlderVisitsState, olderVisitsOpen } from '../src/visit-older';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const host = globalThis as typeof globalThis & Record<string, unknown>;
host.window = window;
host.document = window.document;
host.HTMLElement = window.HTMLElement;
host.HTMLTextAreaElement = window.HTMLTextAreaElement;
host.Element = window.Element;
host.Node = window.Node;
host.Document = window.Document;
host.DocumentFragment = window.DocumentFragment;
host.Range = window.Range;
host.MutationObserver = window.MutationObserver;
host.NodeFilter = window.NodeFilter;
host.getComputedStyle = window.getComputedStyle.bind(window);
host.getSelection = window.getSelection.bind(window);
host.requestAnimationFrame = window.requestAnimationFrame.bind(window);
host.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const DALE = 'RVs/Dale Red.md';
const NEWEST = 'Sun, 5:23pm — Jun 28, 2026';
const OLDER = 'Thu, 2:10pm — Jul 2, 2026';
const DALE_NOTE = [
	`##### ${NEWEST}`,
	'`INPUT[textArea:sVisit2Notes]`',
	`##### ${OLDER}`,
	'`INPUT[textArea:sVisit1Notes]`',
].join('\n');

interface NoteCtx {
	sourcePath: string;
	frontmatter: Record<string, string>;
	addChild(child: { load: () => void }): void;
}

function ctx(path: string, frontmatter: Record<string, string> = {}): NoteCtx {
	return {
		sourcePath: path,
		frontmatter,
		addChild(child) { child.load(); },
	};
}

function section(key: string, stamp: string): HTMLElement {
	const block = window.document.createElement('div');
	block.className = 'markdown-preview-section';
	const heading = window.document.createElement('h5');
	heading.className = 'rv-visit-stamp';
	heading.textContent = stamp;
	const paragraph = window.document.createElement('p');
	paragraph.textContent = `\`INPUT[textArea:${key}]\``;
	block.append(heading, paragraph);
	return block;
}

function areaIn(root: ParentNode, key: string): HTMLTextAreaElement {
	const area = root.querySelector(`textarea.rv-native-notes-area[data-rv-notes-key="${key}"]`);
	assert.ok(area instanceof window.HTMLTextAreaElement);
	return area;
}

function typeInto(area: HTMLTextAreaElement, value: string): void {
	area.focus();
	area.value = value;
	area.setSelectionRange(value.length, value.length);
	area.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('visit notes rewrite', () => {
	it('keeps two tabs on one note in agreement and does not echo a write to its author', async () => {
		clearVisitNoteCaches();
		clearOlderVisitsState();
		const writes: string[] = [];
		bindVisitNoteFlush((_path, batch) => {
			writes.push(batch.sVisit2Notes ?? '');
		});
		const left = window.document.createElement('div');
		left.className = 'markdown-reading-view';
		const right = window.document.createElement('div');
		right.className = 'markdown-reading-view';
		const leftSection = section('sVisit2Notes', NEWEST);
		const rightSection = section('sVisit2Notes', NEWEST);
		left.appendChild(leftSection);
		right.appendChild(rightSection);
		const frontmatter = { sVisit2Notes: 'shared' };
		mountVisitNotesInSection(leftSection, ctx(DALE, frontmatter));
		mountVisitNotesInSection(rightSection, ctx(DALE, frontmatter));
		const author = areaIn(left, 'sVisit2Notes');
		const other = areaIn(right, 'sVisit2Notes');
		assert.equal(author.value, 'shared');
		assert.equal(other.value, 'shared');
		author.focus();
		author.setSelectionRange(2, 2);
		typeInto(author, 'shared plus');
		assert.equal(author, areaIn(left, 'sVisit2Notes'));
		assert.equal(author.selectionStart, 'shared plus'.length);
		assert.equal(other.value, 'shared plus');
		mountVisitNotesInSection(leftSection, ctx(DALE, frontmatter));
		assert.equal(areaIn(left, 'sVisit2Notes'), author);
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert.deepEqual(writes, ['shared plus']);
		clearVisitNoteCaches();
	});

	it('keeps each note\'s cache when the open file changes', () => {
		clearVisitNoteCaches();
		const ada = section('sVisit1Notes', OLDER);
		const dale = section('sVisit2Notes', NEWEST);
		mountVisitNotesInSection(ada, ctx('RVs/Ada.md', { sVisit1Notes: 'ada note' }));
		mountVisitNotesInSection(dale, ctx(DALE, { sVisit2Notes: 'dale note' }));
		typeInto(areaIn(ada, 'sVisit1Notes'), 'ada typed');
		typeInto(areaIn(dale, 'sVisit2Notes'), 'dale typed');
		assert.equal(visitNoteValue('RVs/Ada.md', 'sVisit1Notes'), 'ada typed');
		assert.equal(visitNoteValue(DALE, 'sVisit2Notes'), 'dale typed');
		const returned = section('sVisit1Notes', OLDER);
		mountVisitNotesInSection(returned, ctx('RVs/Ada.md', {}));
		assert.equal(areaIn(returned, 'sVisit1Notes').value, 'ada typed');
		clearVisitNoteCaches();
	});

	it('keeps Dale Red keys after a Live Preview save and a switch to Reading with Older Visits', async () => {
		clearVisitNoteCaches();
		clearOlderVisitsState();
		const flushed: Record<string, string>[] = [];
		bindVisitNoteFlush((_path, batch) => {
			flushed.push({ ...batch });
		});
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: DALE_NOTE,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 1 }), () => DALE),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
		const live = areaIn(view.dom, 'sVisit2Notes');
		assert.equal(view.dom.querySelector('textarea[data-rv-notes-key="sVisit1Notes"]'), null);
		typeInto(live, 'newest box');
		flushVisitNotes(DALE);
		assert.equal(flushed.at(-1)?.sVisit2Notes, 'newest box');
		assert.equal(view.state.doc.toString(), DALE_NOTE);
		view.destroy();
		parent.remove();

		const preview = window.document.createElement('div');
		preview.className = 'markdown-reading-view';
		preview.dataset.rvNoteFile = DALE;
		const newest = section('sVisit2Notes', NEWEST);
		const older = section('sVisit1Notes', OLDER);
		preview.append(newest, older);
		classifyVisitSection(newest, DALE, DALE_NOTE, 0, 1, { limit: 1, collapseOlder: true });
		classifyVisitSection(older, DALE, DALE_NOTE, 2, 3, { limit: 1, collapseOlder: true });
		mountVisitNotesInSection(newest, ctx(DALE, { sVisit2Notes: 'newest box', sVisit1Notes: '' }));
		mountVisitNotesInSection(older, ctx(DALE, { sVisit2Notes: 'newest box', sVisit1Notes: '' }));
		assert.equal(areaIn(newest, 'sVisit2Notes').value, 'newest box');
		assert.equal(areaIn(older, 'sVisit1Notes').value, '');
		assert.equal(newest.classList.contains('rv-older-section'), false);
		assert.equal(older.classList.contains('rv-older-section'), true);
		assert.equal(older.classList.contains('rv-older-first'), true);
		assert.equal(preview.classList.contains('rv-older-collapsed'), true);
		assert.equal(older.querySelector('h3.rv-older-visits')?.textContent, 'Older Visits');
		assert.equal(olderVisitsOpen(DALE, preview), false);
		const header = older.querySelector('h3.rv-older-visits');
		assert.ok(header instanceof window.HTMLElement);
		header.click();
		assert.equal(olderVisitsOpen(DALE, preview), true);
		assert.equal(preview.classList.contains('rv-older-collapsed'), false);
		header.click();
		assert.equal(preview.classList.contains('rv-older-collapsed'), true);
		clearVisitNoteCaches();
		clearOlderVisitsState();
	});

	it('leaves the same textarea in place for undo after a save, in Reading and Live Preview', async () => {
		clearVisitNoteCaches();
		const reading = section('sVisit2Notes', NEWEST);
		mountVisitNotesInSection(reading, ctx(DALE, { sVisit2Notes: 'before' }));
		const readingArea = areaIn(reading, 'sVisit2Notes');
		typeInto(readingArea, 'before saved');
		flushVisitNotes(DALE);
		mountVisitNotesInSection(reading, ctx(DALE, { sVisit2Notes: 'before saved' }));
		assert.equal(areaIn(reading, 'sVisit2Notes'), readingArea);
		const undo = new window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' });
		readingArea.dispatchEvent(undo);
		assert.equal(undo.defaultPrevented, false);
		const redo = new window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyRedo' });
		readingArea.dispatchEvent(redo);
		assert.equal(redo.defaultPrevented, false);

		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: DALE_NOTE,
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 }), () => DALE),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const live = areaIn(view.dom, 'sVisit2Notes');
		typeInto(live, 'live saved');
		flushVisitNotes(DALE);
		view.dispatch({ effects: refreshVisitPreviewEffect.of(null), selection: { anchor: 0 } });
		assert.equal(areaIn(view.dom, 'sVisit2Notes'), live);
		const liveUndo = new window.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyUndo' });
		live.dispatchEvent(liveUndo);
		assert.equal(liveUndo.defaultPrevented, false);
		assert.equal(view.state.selection.main.anchor, 0);
		assert.equal(view.state.doc.toString(), DALE_NOTE);
		view.destroy();
		clearVisitNoteCaches();
	});

	it('accepts a paste on the textarea and flushes that text once', async () => {
		clearVisitNoteCaches();
		const writes: string[] = [];
		bindVisitNoteFlush((_path, batch) => {
			if (batch.sVisit1Notes != null) writes.push(batch.sVisit1Notes);
		});
		const block = section('sVisit1Notes', OLDER);
		mountVisitNotesInSection(block, ctx(DALE, { sVisit1Notes: '' }));
		const area = areaIn(block, 'sVisit1Notes');
		const paste = new window.Event('paste', { bubbles: true, cancelable: true });
		area.dispatchEvent(paste);
		assert.equal(paste.defaultPrevented, false);
		typeInto(area, 'pasted line');
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert.deepEqual(writes, ['pasted line']);
		clearVisitNoteCaches();
	});

	it('reloads a note from frontmatter after the cache is dropped', () => {
		clearVisitNoteCaches();
		applyExternalVisitNotes(DALE, { sVisit2Notes: 'on disk' });
		const block = section('sVisit2Notes', NEWEST);
		mountVisitNotesInSection(block, ctx(DALE, { sVisit2Notes: 'on disk' }));
		assert.equal(areaIn(block, 'sVisit2Notes').value, 'on disk');
		clearVisitNoteCaches();
		const again = section('sVisit2Notes', NEWEST);
		mountVisitNotesInSection(again, ctx(DALE, { sVisit2Notes: 'on disk' }));
		assert.equal(areaIn(again, 'sVisit2Notes').value, 'on disk');
		clearVisitNoteCaches();
	});

	it('ignores an external change while the box is quiet or focused, then applies it on blur', async () => {
		clearVisitNoteCaches();
		const block = section('sVisit2Notes', NEWEST);
		mountVisitNotesInSection(block, ctx(DALE, { sVisit2Notes: 'start' }));
		const area = areaIn(block, 'sVisit2Notes');
		window.document.body.appendChild(block);
		typeInto(area, 'typing');
		area.dispatchEvent(new window.Event('focus', { bubbles: true }));
		applyExternalVisitNotes(DALE, { sVisit2Notes: 'echo' });
		assert.equal(area.value, 'typing');
		flushVisitNotes(DALE);
		await new Promise((resolve) => setTimeout(resolve, 1100));
		applyExternalVisitNotes(DALE, { sVisit2Notes: 'from the other tab' });
		assert.equal(area.value, 'typing');
		area.blur();
		area.dispatchEvent(new window.Event('blur', { bubbles: true }));
		assert.equal(area.value, 'from the other tab');
		clearVisitNoteCaches();
	});

	it('keeps the reading textarea through an IME composition', () => {
		clearVisitNoteCaches();
		const block = section('sVisit2Notes', NEWEST);
		mountVisitNotesInSection(block, ctx(DALE, { sVisit2Notes: '' }));
		const area = areaIn(block, 'sVisit2Notes');
		area.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
		area.value = '日';
		area.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertCompositionText' }));
		mountVisitNotesInSection(block, ctx(DALE, { sVisit2Notes: '' }));
		assert.equal(areaIn(block, 'sVisit2Notes'), area);
		assert.equal(area.value, '日');
		area.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true, data: '日本語' }));
		assert.equal(areaIn(block, 'sVisit2Notes'), area);
		clearVisitNoteCaches();
	});

	it('maps Live Preview decorations through an IME composition instead of replacing the textarea', async () => {
		clearVisitNoteCaches();
		applyExternalVisitNotes(DALE, { sVisit2Notes: 'base' });
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: DALE_NOTE,
				extensions: visitPreviewExtension(() => ({ collapseOlder: false, limit: 3 }), () => DALE),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const area = areaIn(view.dom, 'sVisit2Notes');
		view.contentDOM.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
		view.dispatch({
			changes: { from: 0, to: 0, insert: 'あ' },
			userEvent: 'input.type.compose',
		});
		assert.equal(areaIn(view.dom, 'sVisit2Notes'), area);
		assert.equal(area.value, 'base');
		view.contentDOM.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.equal(areaIn(view.dom, 'sVisit2Notes'), area);
		const strip = view.dom.querySelector('.rv-item-strip');
		assert.ok(strip instanceof window.HTMLElement);
		assert.equal(strip.classList.contains('is-ghost'), true);
		view.destroy();
		clearVisitNoteCaches();
	});

	it('credits Meta Bind and does not carry the old caret or tail machinery', () => {
		const readme = readFileSync('README.md', 'utf8');
		assert.match(readme, /Meta Bind/);
		assert.match(readme, /GPL-3\.0/);
		const field = readFileSync('src/visit-notes-field.ts', 'utf8');
		const display = readFileSync('src/visit-display.ts', 'utf8');
		const controls = readFileSync('src/visit-controls.ts', 'utf8');
		const live = readFileSync('src/visit-live-preview.ts', 'utf8');
		assert.doesNotMatch(field, /rememberCaret|placeRebuiltCaret|holdVisitNote|restoreHeldNote/);
		assert.doesNotMatch(display, /rememberRecentTail|restoreRecentTail|layoutVisitNotesNow/);
		assert.doesNotMatch(controls, /ensureNoteBox|absorbFollowingNotes|readingDomIsStale/);
		assert.doesNotMatch(live, /onLiveVisitHost|VisitCardWidget|ignoreEvent\(/);
		const css = readFileSync('styles.css', 'utf8');
		assert.match(css, /textarea\.rv-native-notes-area \{[^}]*padding:\s*0 12px/);
		assert.match(css, /\.theme-light textarea\.rv-native-notes-area[\s\S]*background:\s*#fff/);
		assert.match(css, /\.theme-dark textarea\.rv-native-notes-area[\s\S]*color-mix\(in srgb, var\(--background-primary/);
		assert.match(css, /h5\.rv-visit-stamp,[\s\S]*margin-bottom:\s*0/);
	});
});
