import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { setIcon } from 'obsidian';
import { APP_TABS } from './app-bar';
import { ensureBarSpacer } from './bar-shell';
import { hostIsHidden } from './hub-cover';
import { expandOlderVisits, syncOlderVisitsChrome } from './visit-older';

/** The hub bottom bar, mounted on an RV note so the map does not jump. */
export interface NoteHubBarHost {
	noteMapLit(path: string): boolean;
	toggleMap(path: string): void;
	createNewRv(): void;
	openCampaign(): void;
	/** Find words in this note. Does not open the hub. */
	openSearch(path: string): void;
	/** Open this note's hub, including when the file was opened with no history. */
	openHub(path: string): void;
}

/**
 * Reserve the shared bar's height on this note. The five slots (APP_TABS)
 * live on the plugin shell, so a view swap cannot detach them.
 */
export function mountNoteHubBar(leaf: HTMLElement, path: string, _host: NoteHubBarHost): HTMLElement {
	leaf.classList.add('is-rv-note');
	leaf.querySelector(':scope > .rv-note-hub-bar')?.remove();
	const spacer = ensureBarSpacer(leaf);
	spacer.dataset.rvPath = path;
	spacer.dataset.rvTabs = String(APP_TABS.length);
	return spacer;
}

export function clearNoteHubBar(leaf: HTMLElement): void {
	closeNoteFind(leaf);
	leaf.querySelector(':scope > .rv-note-hub-bar')?.remove();
	leaf.querySelector(':scope > .rv-bar-spacer')?.remove();
	leaf.classList.remove('is-rv-note', 'is-finding');
}

/**
 * In-note find. The field uses the hub search classes and lives on the
 * persistent bar when one is passed. The leaf does not grow a second band.
 * Typing stays in the field. Matches are marks, not the document selection.
 */
export function openNoteFind(leaf: HTMLElement, bar?: HTMLElement | null): HTMLElement {
	const doc = leaf.ownerDocument;
	closeNoteFind(leaf);
	const row = doc.createElement('div');
	row.className = 'rv-locator-search-slot rv-note-find';
	const field = doc.createElement('div');
	field.className = 'rv-locator-search rv-suggest-host';
	const input = doc.createElement('input');
	input.type = 'search';
	input.className = 'rv-locator-search-input rv-note-find-input';
	input.setAttribute('aria-label', 'Find in note');
	input.placeholder = 'Find in note';
	const close = doc.createElement('button');
	close.type = 'button';
	close.className = 'rv-suggest-chevron rv-note-find-close';
	close.setAttribute('aria-label', 'Close find');
	setIcon(close, 'x');
	let step = 0;
	let composing = false;
	input.addEventListener('compositionstart', () => { composing = true; });
	input.addEventListener('compositionend', () => { composing = false; });
	const go = (delta: number): void => {
		const content = leaf.querySelector('.view-content') ?? leaf;
		step = revealNoteMatch(content, input.value, step + delta);
		if (composing) return;
		if (doc.activeElement !== input) input.focus();
	};
	input.addEventListener('input', (event) => {
		step = 0;
		if ((event as InputEvent).isComposing) composing = true;
		go(0);
	});
	input.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeNoteFind(leaf);
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			go(event.shiftKey ? -1 : 1);
		}
	});
	close.addEventListener('click', () => closeNoteFind(leaf));
	field.append(input, close);
	row.appendChild(field);
	const host = bar && bar.classList ? bar : leaf;
	host.appendChild(row);
	if (bar && bar.classList) bar.classList.add('is-search-open');
	input.focus();
	return row;
}

export function closeNoteFind(leaf: HTMLElement): void {
	const doc = leaf.ownerDocument;
	cancelFindFrame(leaf);
	clearFindMarks(leaf);
	clearEditorFind();
	releaseFindFolds();
	leaf.querySelectorAll('.rv-note-find').forEach((node) => node.remove());
	doc?.querySelectorAll('.rv-note-find').forEach((node) => node.remove());
	leaf.classList.remove('is-finding');
	const bar = doc?.querySelector('.rv-bar-shell');
	if (bar && !bar.querySelector('.rv-locator-search-slot')) bar.classList.remove('is-search-open');
}

const SKIP_FIND = '.rv-note-find, .rv-note-hub-bar, .rv-bar-shell, .rv-locator-search, script, style, .cm-embed-block, .cm-widget, .rv-note-find-mark';

interface FindHit {
	from: number;
	to: number;
}

/** Lowercase without changing indexes when a character expands. */
function foldUnits(text: string): string {
	let out = '';
	for (let index = 0; index < text.length; index += 1) {
		const ch = text[index] ?? '';
		const lower = ch.toLowerCase();
		out += lower.length === 1 ? lower : ch;
	}
	return out;
}

function findHits(text: string, needle: string): FindHit[] {
	const folded = foldUnits(text);
	const want = foldUnits(needle);
	if (!want) return [];
	const hits: FindHit[] = [];
	let from = 0;
	while (from <= folded.length) {
		const at = folded.indexOf(want, from);
		if (at < 0) break;
		hits.push({ from: at, to: at + want.length });
		from = at + Math.max(want.length, 1);
	}
	return hits;
}

function wrapIndex(index: number, count: number): number {
	if (count <= 0) return 0;
	return ((index % count) + count) % count;
}

function clearFindMarks(root: ParentNode): void {
	const el = root as Element;
	if (typeof el.querySelectorAll !== 'function') return;
	const marks = el.querySelectorAll('.rv-note-find-mark');
	const parents: Node[] = [];
	for (let index = 0; index < marks.length; index += 1) {
		const mark = marks[index];
		if (!mark || mark.nodeType !== 1) continue;
		const host = mark as HTMLElement;
		if (host.getAttribute('data-rv-find') === 'class') {
			host.classList.remove('rv-note-find-mark', 'rv-note-find-current');
			host.removeAttribute('data-rv-find');
			continue;
		}
		const parent = mark.parentNode;
		if (!parent) continue;
		while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
		parent.removeChild(mark);
		parents.push(parent);
	}
	for (const parent of parents) {
		if (typeof parent.normalize === 'function') parent.normalize();
	}
}

function asElement(node: Element | null): HTMLElement | null {
	return node && node.nodeType === 1 ? node as HTMLElement : null;
}

function shownElement(node: HTMLElement | null): node is HTMLElement {
	return node != null && !hostIsHidden(node);
}

/** Reading or preview when that mode is on screen. The editor only when it is the mode on screen. */
function shownReading(root: ParentNode): HTMLElement | null {
	const el = root as Element;
	if (typeof el.querySelector !== 'function') return null;
	const reading = asElement(el.querySelector('.markdown-reading-view, .markdown-preview-view'));
	return shownElement(reading) ? reading : null;
}

function shownEditor(root: ParentNode): HTMLElement | null {
	const el = root as Element;
	if (typeof el.querySelector !== 'function') return null;
	const editor = asElement(el.querySelector('.cm-content'));
	if (!shownElement(editor)) return null;
	const reading = shownReading(root);
	if (reading && reading !== editor && !reading.contains(editor)) return null;
	return editor;
}

interface TextPiece {
	node: Text;
	from: number;
	to: number;
}

function collectPieces(root: ParentNode): { text: string; pieces: TextPiece[] } {
	const doc = (root as Node).ownerDocument;
	const pieces: TextPiece[] = [];
	let text = '';
	if (!doc || typeof doc.createTreeWalker !== 'function') return { text, pieces };
	const walker = doc.createTreeWalker(root, 4);
	let current = walker.nextNode();
	while (current) {
		const node = current;
		current = walker.nextNode();
		if (node.nodeType !== 3) continue;
		const parent = (node as Text).parentElement;
		if (parent?.closest(SKIP_FIND)) continue;
		if (parent && hostIsHidden(parent)) continue;
		const value = node.textContent ?? '';
		if (!value) continue;
		const from = text.length;
		text += value;
		pieces.push({ node: node as Text, from, to: text.length });
	}
	return { text, pieces };
}

function wrapText(node: Text, start: number, end: number, current: boolean): HTMLElement | null {
	const doc = node.ownerDocument;
	const parent = node.parentNode;
	if (!doc || !parent) return null;
	let target = node;
	if (start > 0) target = node.splitText(start);
	const length = end - start;
	const size = target.textContent?.length ?? 0;
	if (length < size) target.splitText(length);
	const mark = doc.createElement('span');
	mark.className = current ? 'rv-note-find-mark rv-note-find-current' : 'rv-note-find-mark';
	parent.insertBefore(mark, target);
	mark.appendChild(target);
	return mark;
}

const NOTES_AREA = 'textarea.rv-native-notes-area, textarea.rv-visit-note, .rv-visit-notes-host textarea, .rv-lp-notes textarea';

function notesAreas(root: ParentNode): HTMLTextAreaElement[] {
	const el = root as Element;
	if (typeof el.querySelectorAll !== 'function') return [];
	const nodes = el.querySelectorAll(NOTES_AREA);
	const areas: HTMLTextAreaElement[] = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node || node.nodeType !== 1) continue;
		const area = node as HTMLTextAreaElement;
		if (area.tagName !== 'TEXTAREA') continue;
		if (area.closest('.rv-note-find, .rv-bar-shell, .rv-locator-search')) continue;
		const folded = area.closest('.rv-older-collapsed');
		if (!folded && hostIsHidden(area)) continue;
		areas.push(area);
	}
	return areas;
}

function areaMatches(root: ParentNode, needle: string): HTMLTextAreaElement[] {
	const want = foldUnits(needle);
	if (!want) return [];
	return notesAreas(root).filter((area) => foldUnits(area.value ?? '').includes(want));
}

const openedFolds = new Set<HTMLElement>();
let findFrame = 0;

function cancelFindFrame(node: Node): void {
	const view = node.ownerDocument?.defaultView;
	if (!findFrame || !view || typeof view.cancelAnimationFrame !== 'function') return;
	view.cancelAnimationFrame(findFrame);
	findFrame = 0;
}

/** Layout has the opened section's box before the mark and the scroll. */
function afterLayout(node: HTMLElement, run: () => void): void {
	const view = node.ownerDocument?.defaultView;
	const raf = view?.requestAnimationFrame?.bind(view);
	if (!raf) {
		run();
		return;
	}
	cancelFindFrame(node);
	findFrame = raf(() => {
		findFrame = 0;
		run();
	});
}

function elementOf(node: Node | null | undefined): HTMLElement | null {
	if (!node) return null;
	if (node.nodeType === 1) return node as HTMLElement;
	const parent = node.parentElement ?? node.parentNode;
	return parent && parent.nodeType === 1 ? parent as HTMLElement : null;
}

/**
 * Heading tap path: stored open, then every reading and preview host drops
 * `rv-older-collapsed` together. The note text is not written.
 */
function expandFold(node: HTMLElement): boolean {
	const collapsed = typeof node.closest === 'function' ? node.closest('.rv-older-collapsed') : null;
	if (!collapsed || collapsed.nodeType !== 1) return false;
	const host = collapsed as HTMLElement;
	const preview = host.closest('.markdown-reading-view, .markdown-preview-view');
	const root = preview && preview.nodeType === 1 ? preview as HTMLElement : host;
	const path = root.dataset?.rvNoteFile
		?? host.closest?.('[data-rv-note-file]')?.getAttribute('data-rv-note-file')
		?? '';
	expandOlderVisits(path, root);
	openedFolds.add(root);
	return true;
}

function releaseFindFolds(): void {
	openedFolds.forEach((host) => {
		if (!host.isConnected) return;
		const path = host.dataset?.rvNoteFile
			?? host.closest?.('[data-rv-note-file]')?.getAttribute('data-rv-note-file')
			?? '';
		syncOlderVisitsChrome(path, host);
	});
	openedFolds.clear();
}

function scrollFind(node: HTMLElement): void {
	try { node.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* The note is already in view. */ }
}

/** Paint now, or on the next frame when this hit had to open Older Visits. */
function presentFind(target: HTMLElement | null, paint: () => HTMLElement | null): void {
	const opened = target ? expandFold(target) : false;
	const finish = (): void => {
		const shown = paint();
		if (shown) scrollFind(shown);
	};
	if (opened && target) afterLayout(target, finish);
	else finish();
}

function markFindClass(host: HTMLElement, current: boolean): void {
	host.classList.add('rv-note-find-mark');
	host.classList.toggle('rv-note-find-current', current);
	host.setAttribute('data-rv-find', 'class');
}

function documentBefore(a: Node, b: Node): boolean {
	if (a === b || typeof a.compareDocumentPosition !== 'function') return false;
	return (a.compareDocumentPosition(b) & 4) !== 0;
}

function paintTextHits(
	pieces: readonly TextPiece[],
	hits: readonly FindHit[],
	currentHit: number,
): HTMLElement | null {
	const jobs: { node: Text; start: number; end: number; current: boolean }[] = [];
	hits.forEach((hit, hitIndex) => {
		for (const piece of pieces) {
			const start = Math.max(piece.from, hit.from);
			const end = Math.min(piece.to, hit.to);
			if (end <= start) continue;
			jobs.push({
				node: piece.node,
				start: start - piece.from,
				end: end - piece.from,
				current: hitIndex === currentHit,
			});
		}
	});
	let lead: HTMLElement | null = null;
	for (let jobIndex = jobs.length - 1; jobIndex >= 0; jobIndex -= 1) {
		const job = jobs[jobIndex];
		if (!job) continue;
		const mark = wrapText(job.node, job.start, job.end, job.current);
		if (job.current && mark) lead = mark;
	}
	return lead;
}

function textAnchor(pieces: readonly TextPiece[], hit: FindHit): Node | null {
	for (const piece of pieces) {
		if (hit.from < piece.to && hit.to > piece.from) return piece.node;
	}
	return pieces[0]?.node ?? null;
}

/** A class on the widget. The text node stays whole so a live embed is not rewritten. */
function paintWidgetMarks(root: ParentNode, needle: string, index: number): number {
	const el = root as Element;
	if (typeof el.querySelectorAll !== 'function') return 0;
	const blocks = el.querySelectorAll('.cm-embed-block, .cm-widget');
	const hits: HTMLElement[] = [];
	const want = foldUnits(needle);
	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		if (!block || block.nodeType !== 1) continue;
		const host = block as HTMLElement;
		if (host.parentElement?.closest('.cm-embed-block, .cm-widget')) continue;
		if (hostIsHidden(host)) continue;
		if (host.closest('.rv-note-find, .rv-bar-shell, .rv-locator-search')) continue;
		if (!foldUnits(host.textContent ?? '').includes(want)) continue;
		hits.push(host);
	}
	if (hits.length === 0) return 0;
	const at = wrapIndex(index, hits.length);
	hits.forEach((host, hitIndex) => {
		host.classList.add('rv-note-find-mark');
		if (hitIndex === at) host.classList.add('rv-note-find-current');
		host.setAttribute('data-rv-find', 'class');
	});
	try { hits[at]?.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* The note is already in view. */ }
	return at;
}

const currentMark = Decoration.mark({ class: 'rv-note-find-mark rv-note-find-current' });
const otherMark = Decoration.mark({ class: 'rv-note-find-mark' });
const setNoteFind = StateEffect.define<readonly { from: number; to: number; current: boolean }[] | null>();

const noteFindField = StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (!effect.is(setNoteFind)) continue;
			const hits = effect.value;
			if (!hits || hits.length === 0) return Decoration.none;
			return Decoration.set(hits.map((hit) => (hit.current ? currentMark : otherMark).range(hit.from, hit.to)), true);
		}
		return value.map(transaction.changes);
	},
	provide: (field) => EditorView.decorations.from(field),
});

let noteFindEditor: EditorView | null = null;

function clearEditorFind(): void {
	const view = noteFindEditor;
	noteFindEditor = null;
	if (!view) return;
	try {
		if (view.state.field(noteFindField, false) == null) return;
		view.dispatch({ effects: setNoteFind.of(null) });
	} catch {
		/* The editor was destroyed with the leaf. */
	}
}

function editorIn(root: ParentNode): EditorView | null {
	const el = root as Element;
	const cm = el.classList?.contains('cm-content') ? el : el.querySelector?.('.cm-content');
	if (!cm || cm.nodeType !== 1) return null;
	try {
		return EditorView.findFromDOM(cm as HTMLElement);
	} catch {
		return null;
	}
}

function embedRanges(view: EditorView): FindHit[] {
	const ranges: FindHit[] = [];
	view.dom.querySelectorAll('.cm-embed-block').forEach((node) => {
		if (node.nodeType !== 1) return;
		try {
			const from = view.posAtDOM(node, 0);
			const parent = node.parentNode;
			const next = node.nextSibling;
			const to = next ? view.posAtDOM(next, 0) : (parent ? view.posAtDOM(parent, parent.childNodes.length) : from);
			if (to > from) ranges.push({ from, to });
		} catch {
			/* A widget that is not in the document is already skipped. */
		}
	});
	return ranges;
}

function editorHits(view: EditorView, needle: string): FindHit[] {
	const blocked = embedRanges(view);
	return findHits(view.state.doc.toString(), needle).filter((hit) => (
		!blocked.some((block) => hit.from < block.to && hit.to > block.from)
	));
}

function paintEditorMatches(view: EditorView, hits: readonly FindHit[], currentHit: number): void {
	if (view.state.field(noteFindField, false) == null) {
		view.dispatch({ effects: StateEffect.appendConfig.of(noteFindField) });
	}
	noteFindEditor = view;
	if (hits.length === 0) {
		view.dispatch({ effects: setNoteFind.of(null) });
		return;
	}
	const painted = hits.map((hit, hitIndex) => ({ ...hit, current: hitIndex === currentHit }));
	const current = painted.find((hit) => hit.current);
	view.dispatch({ effects: setNoteFind.of(painted) });
	if (current) view.dispatch({ effects: EditorView.scrollIntoView(current.from, { y: 'center' }) });
}

function areaDocPos(view: EditorView, area: HTMLTextAreaElement): number {
	try {
		return view.posAtDOM(area, 0);
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
}

/** Editor text and visit-note values share one next/prev list, in document order. */
function paintEditorAndNotes(view: EditorView, root: ParentNode, needle: string, index: number): number | null {
	const hits = editorHits(view, needle);
	const areas = areaMatches(root, needle);
	if (hits.length === 0 && areas.length === 0) return null;
	const slots: { kind: 'doc' | 'area'; from: number; hitIndex: number; area?: HTMLTextAreaElement }[] = [];
	hits.forEach((hit, hitIndex) => slots.push({ kind: 'doc', from: hit.from, hitIndex }));
	areas.forEach((area) => slots.push({ kind: 'area', from: areaDocPos(view, area), hitIndex: -1, area }));
	slots.sort((left, right) => left.from - right.from || (left.kind === 'doc' ? -1 : 1));
	const at = wrapIndex(index, slots.length);
	const current = slots[at];
	const target = current?.kind === 'area' ? current.area ?? null : null;
	presentFind(target, () => {
		paintEditorMatches(view, hits, current?.kind === 'doc' ? current.hitIndex : -1);
		for (const area of areas) markFindClass(area, current?.kind === 'area' && current.area === area);
		return current?.kind === 'area' ? current.area ?? null : null;
	});
	return at;
}

interface FindSlot {
	kind: 'text' | 'area';
	node: Node;
	hitIndex?: number;
	area?: HTMLTextAreaElement;
}

function mergedSlots(pieces: readonly TextPiece[], hits: readonly FindHit[], areas: readonly HTMLTextAreaElement[]): FindSlot[] {
	const text: FindSlot[] = [];
	hits.forEach((hit, hitIndex) => {
		const node = textAnchor(pieces, hit);
		if (node) text.push({ kind: 'text', node, hitIndex });
	});
	const notes: FindSlot[] = areas.map((area) => ({ kind: 'area', node: area, area }));
	const slots: FindSlot[] = [];
	let textAt = 0;
	let noteAt = 0;
	while (textAt < text.length || noteAt < notes.length) {
		const left = text[textAt];
		const right = notes[noteAt];
		if (left && (!right || documentBefore(left.node, right.node))) {
			slots.push(left);
			textAt += 1;
		} else if (right) {
			slots.push(right);
			noteAt += 1;
		}
	}
	return slots;
}

function paintShownDom(root: ParentNode, needle: string, index: number): number {
	const { text, pieces } = collectPieces(root);
	const hits = findHits(text, needle);
	const areas = areaMatches(root, needle);
	if (hits.length === 0 && areas.length === 0) return paintWidgetMarks(root, needle, index);
	const slots = mergedSlots(pieces, hits, areas);
	const at = wrapIndex(index, slots.length);
	const current = slots[at];
	const target = elementOf(current?.kind === 'area' ? current.area : current?.node);
	presentFind(target, () => {
		const lead = paintTextHits(pieces, hits, current?.kind === 'text' ? current.hitIndex ?? -1 : -1);
		for (const area of areas) markFindClass(area, current?.kind === 'area' && current.area === area);
		return current?.kind === 'area' ? current.area ?? null : lead;
	});
	return at;
}

/**
 * Mark the nth match of `query` in the note. Returns the index used.
 * The find field stays focused. The document selection is not the highlight.
 * Reading view searches the preview that is on screen. Source and live preview
 * use the editor text when that editor is visible, and a visible widget when
 * the source text has no hit. Visit notes are the textarea value, in the same
 * next and previous list. A match may cross text nodes that CodeMirror split.
 */
export function revealNoteMatch(root: ParentNode, query: string, index: number): number {
	cancelFindFrame(root);
	clearFindMarks(root);
	const needle = query.trim().toLowerCase();
	if (!needle) {
		clearEditorFind();
		return 0;
	}
	const reading = shownReading(root);
	const editorEl = shownEditor(root);
	if (editorEl) clearFindMarks(editorEl);
	if (reading) clearFindMarks(reading);
	if (editorEl && !reading) {
		const editor = editorIn(editorEl);
		if (editor) {
			try {
				const mixed = paintEditorAndNotes(editor, editorEl, needle, index);
				if (mixed != null) return mixed;
			} catch {
				/* Reading view, or an editor that rejected the decoration. */
			}
		}
		clearEditorFind();
		return paintShownDom(editorEl, needle, index);
	}
	clearEditorFind();
	const surface = reading ?? editorEl ?? root;
	return paintShownDom(surface, needle, index);
}
