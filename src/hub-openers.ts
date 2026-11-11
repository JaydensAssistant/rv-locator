import { hostIsHidden } from './hub-cover';

/** One hub view that can open search or the sort row. */
export interface HubOpener {
	root: HTMLElement;
	open: () => boolean;
}

interface LeafWorkspace {
	activeLeaf?: { view?: { containerEl?: HTMLElement } } | null;
	getMostRecentLeaf?: () => { view?: { containerEl?: HTMLElement } } | null;
}

function isElement(node: unknown): node is HTMLElement {
	if (!node || typeof node !== 'object') return false;
	return (node as HTMLElement).nodeType === 1;
}

function boxArea(node: HTMLElement): number {
	if (typeof node.getBoundingClientRect !== 'function') return 0;
	try {
		const rect = node.getBoundingClientRect();
		return Math.max(0, rect.width) * Math.max(0, rect.height);
	} catch {
		return 0;
	}
}

/** The leaf on screen. A view container counts, and so does `.workspace-leaf.mod-active`. */
export function activeLeafElement(workspace: LeafWorkspace | null | undefined, doc?: Document | null): HTMLElement | null {
	const leaf = workspace?.activeLeaf ?? workspace?.getMostRecentLeaf?.() ?? null;
	const el = leaf?.view?.containerEl;
	if (isElement(el)) return el;
	const found = doc?.querySelector?.('.workspace-leaf.mod-active');
	return isElement(found) ? found : null;
}

/** Connected, on screen, and inside the active leaf. A cover is not the live hub. */
export function hubRootShown(root: HTMLElement, active: HTMLElement | null): boolean {
	if (!root || root.isConnected === false) return false;
	if (typeof root.closest === 'function' && root.closest('.rv-hub-swap-cover')) return false;
	if (hostIsHidden(root)) return false;
	if (!active) {
		const leaf = root.closest?.('.workspace-leaf');
		return Boolean(leaf && leaf.classList.contains('mod-active'));
	}
	if (active === root || active.contains(root)) return true;
	const leaf = typeof root.closest === 'function' ? root.closest('.workspace-leaf') : null;
	const activeLeaf = active.classList?.contains('workspace-leaf') ? active : active.closest?.('.workspace-leaf');
	return Boolean(leaf && activeLeaf && leaf === activeLeaf);
}

/**
 * The visible hub in the active leaf. A larger box wins, and a later one
 * wins a tie, so a stale opener registered first is not the one that runs.
 */
export function pickShownHubOpener<T extends HubOpener>(openers: Iterable<T>, active: HTMLElement | null): T | null {
	let chosen: T | null = null;
	let chosenArea = -1;
	for (const entry of openers) {
		if (!hubRootShown(entry.root, active)) continue;
		const area = boxArea(entry.root);
		if (!chosen || area >= chosenArea) {
			chosen = entry;
			chosenArea = area;
		}
	}
	return chosen;
}

/** Search and sort registrations. A detached view is dropped the next time one is asked. */
export class HubOpenerList {
	private readonly entries = new Set<HubOpener>();

	register(root: HTMLElement, open: () => boolean): () => void {
		const entry: HubOpener = { root, open };
		this.entries.add(entry);
		return () => { this.entries.delete(entry); };
	}

	get size(): number {
		return this.entries.size;
	}

	ask(active: HTMLElement | null): boolean {
		for (const entry of this.entries) {
			if (!entry.root?.isConnected) this.entries.delete(entry);
		}
		const pool: HubOpener[] = [];
		for (const entry of this.entries) pool.push(entry);
		while (pool.length > 0) {
			const chosen = pickShownHubOpener(pool, active);
			if (!chosen) return false;
			const at = pool.indexOf(chosen);
			if (at >= 0) pool.splice(at, 1);
			try {
				if (chosen.open()) return true;
			} catch {
				this.entries.delete(chosen);
			}
		}
		return false;
	}
}
