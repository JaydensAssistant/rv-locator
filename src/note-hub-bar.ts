import { setIcon, type IconName } from 'obsidian';

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

const NOTE_TABS: readonly { label: string; icon: IconName; id: string }[] = [
	{ id: 'hub', label: 'Hub', icon: 'house' },
	{ id: 'search', label: 'Search', icon: 'search' },
	{ id: 'campaign', label: 'Campaign', icon: 'flag' },
	{ id: 'map', label: 'Map', icon: 'earth' },
	{ id: 'new', label: 'New', icon: 'plus' },
];

/** Same five slots as the hub and bases. */
export function mountNoteHubBar(leaf: HTMLElement, path: string, host: NoteHubBarHost): HTMLElement {
	const found = leaf.querySelector(':scope > .rv-note-hub-bar');
	let bar: HTMLElement;
	if (found instanceof HTMLElement && found.querySelector('.rv-app-slot')) {
		bar = found;
	} else {
		found?.remove();
		const doc = leaf.ownerDocument;
		bar = doc.createElement('div');
		bar.className = 'rv-locator-sortbar rv-note-hub-bar rv-app-bar';
		const current = (): string => bar.dataset.rvPath ?? '';
		for (const tab of NOTE_TABS) {
			const button = doc.createElement('button');
			button.type = 'button';
			button.className = `rv-app-slot rv-note-tab-${tab.id}`;
			button.setAttribute('aria-label', tab.label);
			if (tab.id === 'map') button.classList.add('rv-note-bar-earth');
			setIcon(button, tab.icon);
			const label = doc.createElement('span');
			label.className = 'rv-app-label';
			label.textContent = tab.label;
			button.appendChild(label);
			button.addEventListener('click', () => {
				const note = current();
				if (tab.id === 'hub') host.openHub(note);
				else if (tab.id === 'search') host.openSearch(note);
				else if (tab.id === 'campaign') host.openCampaign();
				else if (tab.id === 'map') host.toggleMap(note);
				else host.createNewRv();
			});
			bar.appendChild(button);
		}
		leaf.appendChild(bar);
	}
	bar.dataset.rvPath = path;
	const map = bar.querySelector('.rv-note-bar-earth');
	if (map instanceof HTMLElement) {
		map.dataset.rvPath = path;
		const on = host.noteMapLit(path);
		map.classList.toggle('is-on', on);
		map.setAttribute('aria-pressed', on ? 'true' : 'false');
	}
	return bar;
}

export function clearNoteHubBar(leaf: HTMLElement): void {
	leaf.querySelector(':scope > .rv-note-find')?.remove();
	leaf.querySelector(':scope > .rv-note-hub-bar')?.remove();
	leaf.classList.remove('is-rv-note', 'is-finding');
}

/** In-note find. The field sits on the bar and walks the note text. */
export function openNoteFind(leaf: HTMLElement): void {
	const doc = leaf.ownerDocument;
	const bar = leaf.querySelector(':scope > .rv-note-hub-bar');
	let row = leaf.querySelector(':scope > .rv-note-find, :scope > .rv-note-hub-bar > .rv-note-find');
	if (!(row instanceof HTMLElement)) {
		row = doc.createElement('div');
		row.className = 'rv-note-find';
		const input = doc.createElement('input');
		input.type = 'search';
		input.className = 'rv-note-find-input';
		input.setAttribute('aria-label', 'Find in note');
		input.placeholder = 'Find in note';
		const close = doc.createElement('button');
		close.type = 'button';
		close.className = 'rv-note-find-close';
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
		row.append(input, close);
		if (bar instanceof HTMLElement) bar.insertBefore(row, bar.firstChild);
		else leaf.appendChild(row);
	}
	leaf.classList.add('is-finding');
	const field = row.querySelector('input');
	if (field instanceof HTMLElement && field.tagName === 'INPUT') field.focus();
}

export function closeNoteFind(leaf: HTMLElement): void {
	leaf.querySelectorAll('.rv-note-find').forEach((node) => node.remove());
	leaf.classList.remove('is-finding');
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
		if (parent?.closest('.rv-note-find, .rv-note-hub-bar, script, style')) continue;
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
