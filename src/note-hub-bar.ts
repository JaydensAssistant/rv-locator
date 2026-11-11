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
	leaf.querySelectorAll('.rv-note-find').forEach((node) => node.remove());
	doc?.querySelectorAll('.rv-note-find').forEach((node) => node.remove());
	leaf.classList.remove('is-finding');
	const bar = doc?.querySelector('.rv-bar-shell');
	if (bar && !bar.querySelector('.rv-locator-search-slot')) bar.classList.remove('is-search-open');
}

/**
 * Select the nth match of `query` in the note. Returns the index used.
 * The find field itself is not a match.
 */
export function revealNoteMatch(root: ParentNode, query: string, index: number): number {
	const needle = query.trim().toLowerCase();
	const doc = (root as Node).ownerDocument ?? null;
	if (!needle || !doc) return 0;
	const hits: { node: Text; start: number }[] = [];
	const walker = doc.createTreeWalker(root, 4);
	let current = walker.nextNode();
	while (current) {
		const node = current;
		current = walker.nextNode();
		if (node.nodeType !== 3) continue;
		const parent = node.parentElement;
		if (parent?.closest('.rv-note-find, .rv-note-hub-bar, .rv-bar-shell, .rv-locator-search, script, style')) continue;
		const text = node.textContent ?? '';
		const folded = text.toLowerCase();
		let from = 0;
		while (from <= folded.length) {
			const at = folded.indexOf(needle, from);
			if (at < 0) break;
			hits.push({ node: node as Text, start: at });
			from = at + Math.max(needle.length, 1);
		}
	}
	if (hits.length === 0) return 0;
	const at = ((index % hits.length) + hits.length) % hits.length;
	const hit = hits[at];
	if (!hit) return 0;
	try {
		const range = doc.createRange();
		range.setStart(hit.node, hit.start);
		range.setEnd(hit.node, Math.min(hit.node.textContent?.length ?? 0, hit.start + needle.length));
		const selection = doc.getSelection?.();
		selection?.removeAllRanges();
		selection?.addRange(range);
		hit.node.parentElement?.scrollIntoView?.({ block: 'center' });
	} catch {
		return at;
	}
	return at;
}
