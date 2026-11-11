import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { setIcon } from 'obsidian';
import { APP_TABS } from './app-bar';
import { ensureBarSpacer } from './bar-shell';

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
	const go = (delta: number): void => {
		const content = leaf.querySelector('.view-content') ?? leaf;
		step = revealNoteMatch(content, input.value, step + delta);
		if (doc.activeElement !== input) input.focus();
	};
	input.addEventListener('input', () => {
		step = 0;
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
	clearFindMarks(leaf);
	clearEditorFind();
	leaf.querySelectorAll('.rv-note-find').forEach((node) => node.remove());
	doc?.querySelectorAll('.rv-note-find').forEach((node) => node.remove());
	leaf.classList.remove('is-finding');
	const bar = doc?.querySelector('.rv-bar-shell');
	if (bar && !bar.querySelector('.rv-locator-search-slot')) bar.classList.remove('is-search-open');
}

const SKIP_FIND = '.rv-note-find, .rv-note-hub-bar, .rv-bar-shell, .rv-locator-search, script, style, .cm-embed-block, .rv-note-find-mark';

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
		if (!mark) continue;
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

function searchSurface(root: ParentNode): ParentNode {
	const el = root as Element;
	if (typeof el.querySelector !== 'function') return root;
	return el.querySelector('.cm-content') ?? root;
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

function paintDomMatches(root: ParentNode, needle: string, index: number): number {
	const { text, pieces } = collectPieces(root);
	const hits = findHits(text, needle);
	if (hits.length === 0) return 0;
	const at = wrapIndex(index, hits.length);
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
				current: hitIndex === at,
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
	try { lead?.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* The note is already in view. */ }
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

function paintEditorMatches(view: EditorView, needle: string, index: number): number {
	if (view.state.field(noteFindField, false) == null) {
		view.dispatch({ effects: StateEffect.appendConfig.of(noteFindField) });
	}
	const blocked = embedRanges(view);
	const hits = findHits(view.state.doc.toString(), needle).filter((hit) => (
		!blocked.some((block) => hit.from < block.to && hit.to > block.from)
	));
	noteFindEditor = view;
	if (hits.length === 0) {
		view.dispatch({ effects: setNoteFind.of(null) });
		return 0;
	}
	const at = wrapIndex(index, hits.length);
	const painted = hits.map((hit, hitIndex) => ({ ...hit, current: hitIndex === at }));
	const current = painted[at];
	view.dispatch({ effects: setNoteFind.of(painted) });
	if (current) view.dispatch({ effects: EditorView.scrollIntoView(current.from, { y: 'center' }) });
	return at;
}

/**
 * Mark the nth match of `query` in the note. Returns the index used.
 * The find field stays focused. The document selection is not the highlight.
 * Source and live preview use the editor text and skip embed widgets.
 * A match may cross text nodes that CodeMirror split.
 */
export function revealNoteMatch(root: ParentNode, query: string, index: number): number {
	clearFindMarks(root);
	const surface = searchSurface(root);
	if (surface !== root) clearFindMarks(surface);
	const needle = query.trim().toLowerCase();
	if (!needle) {
		clearEditorFind();
		return 0;
	}
	const editor = editorIn(surface);
	if (editor) {
		try {
			return paintEditorMatches(editor, needle, index);
		} catch {
			/* Reading view, or an editor that rejected the decoration. */
		}
	} else {
		clearEditorFind();
	}
	return paintDomMatches(surface, needle, index);
}
