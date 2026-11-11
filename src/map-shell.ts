/** One map, owned by the plugin, outside every view. Views only leave a spacer. */

export const MAP_SHELL_CLASS = 'rv-map-shell';
export const MAP_SPACER_CLASS = 'rv-map-spacer';

const GRIP_PX = 3;
const MIN_BOX = 2;

export interface MapShell {
	root: HTMLElement;
	map: HTMLElement;
	grip: HTMLElement;
}

function ownerDoc(node: unknown): Document | null {
	if (node == null || typeof node !== 'object') return null;
	const doc = (node as { ownerDocument?: unknown }).ownerDocument;
	if (doc == null || typeof (doc as Document).createElement !== 'function') return null;
	return doc as Document;
}

/** The shell is a child of the workspace container, never of a leaf or a view. */
export function createMapShell(container: HTMLElement): MapShell {
	const host = ownerDoc(container) ? container : (typeof document !== 'undefined' ? document.body : null);
	const doc = ownerDoc(host);
	if (!host || !doc) {
		const fallback = typeof document !== 'undefined' ? document : null;
		const root = fallback ? fallback.createElement('div') : ({} as HTMLElement);
		const grip = fallback ? fallback.createElement('div') : ({} as HTMLElement);
		const map = fallback ? fallback.createElement('div') : ({} as HTMLElement);
		if (fallback) {
			root.className = MAP_SHELL_CLASS;
			grip.className = 'rv-hub-map-handle';
			map.className = 'rv-hub-map';
			root.append(grip, map);
		}
		return { root, map, grip };
	}
	const found = host.querySelector(`:scope > .${MAP_SHELL_CLASS}`);
	if (found instanceof HTMLElement) {
		const map = found.querySelector(':scope > .rv-hub-map');
		const grip = found.querySelector(':scope > .rv-hub-map-handle');
		if (map instanceof HTMLElement && grip instanceof HTMLElement) return { root: found, map, grip };
	}
	const root = doc.createElement('div');
	root.className = MAP_SHELL_CLASS;
	const grip = doc.createElement('div');
	grip.className = 'rv-hub-map-handle';
	grip.setAttribute('role', 'separator');
	grip.setAttribute('aria-orientation', 'horizontal');
	grip.setAttribute('aria-label', 'Resize map');
	const map = doc.createElement('div');
	map.className = 'rv-hub-map';
	root.append(grip, map);
	host.appendChild(root);
	return { root, map, grip };
}

/** The one pixel band. Both custom properties stay equal. */
export function shellBandPx(shell: HTMLElement): number {
	const raw = shell.style.getPropertyValue('--rv-map-size').trim() || shell.style.getPropertyValue('--rv-note-map').trim();
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) && parsed >= MIN_BOX ? parsed : 0;
}

/**
 * Write the band from the pane and the saved ratio.
 * A later call keeps that pixel value. Drag passes `force` to replace it.
 * A pane of 0 does not invent a height, and nothing here reads the map's box.
 */
export function writeShellBand(shell: HTMLElement, panePx: number, ratio: number, force = false): number {
	const current = shellBandPx(shell);
	if (!force && current >= MIN_BOX) return current;
	const computed = panePx > 0 && Number.isFinite(ratio) ? Math.round(panePx * ratio) : 0;
	const next = computed >= MIN_BOX ? computed : current;
	if (next < MIN_BOX) return current;
	const value = `${next}px`;
	shell.style.setProperty('--rv-map-size', value);
	shell.style.setProperty('--rv-note-map', value);
	return next;
}

export function copyShellBand(host: HTMLElement, bandPx: number): void {
	if (bandPx < MIN_BOX) return;
	const value = `${bandPx}px`;
	if (host.style.getPropertyValue('--rv-map-size') !== value) host.style.setProperty('--rv-map-size', value);
	if (host.style.getPropertyValue('--rv-note-map') !== value) host.style.setProperty('--rv-note-map', value);
}

/** The slot a view reserves. The shell is not a child of this node. */
export function ensureMapSpacer(host: HTMLElement): HTMLElement {
	const doc = ownerDoc(host);
	if (!host || !doc || typeof host.querySelector !== 'function') {
		const spacer = (typeof document !== 'undefined' ? document : doc)?.createElement('div');
		if (spacer) spacer.className = MAP_SPACER_CLASS;
		return spacer ?? ({} as HTMLElement);
	}
	const sitting = host.querySelector(':scope > .rv-map-spacer');
	if (sitting instanceof HTMLElement) return sitting;
	const spacer = doc.createElement('div');
	spacer.className = MAP_SPACER_CLASS;
	spacer.setAttribute('aria-hidden', 'true');
	host.appendChild(spacer);
	return spacer;
}

/** Reserve the grip plus the band. Side-by-side reserves width. */
export function sizeMapSpacer(spacer: HTMLElement, bandPx: number, side: boolean, fullscreen = false): void {
	if (fullscreen) {
		spacer.style.flex = '1 1 auto';
		spacer.style.width = '100%';
		spacer.style.maxWidth = 'none';
		spacer.style.height = '100%';
		spacer.style.maxHeight = 'none';
		return;
	}
	if (bandPx < MIN_BOX || typeof spacer.style?.setProperty !== 'function') return;
	const span = `${bandPx + GRIP_PX}px`;
	if (side) {
		spacer.style.setProperty('flex', `0 0 ${span}`, 'important');
		spacer.style.setProperty('width', span, 'important');
		spacer.style.setProperty('max-width', span, 'important');
		spacer.style.setProperty('min-width', span, 'important');
		spacer.style.setProperty('height', '100%', 'important');
		spacer.style.setProperty('max-height', 'none', 'important');
	} else {
		spacer.style.setProperty('flex', `0 0 ${span}`, 'important');
		spacer.style.setProperty('width', '100%', 'important');
		spacer.style.setProperty('max-width', 'none', 'important');
		spacer.style.setProperty('height', span, 'important');
		spacer.style.setProperty('max-height', span, 'important');
		spacer.style.setProperty('min-height', span, 'important');
		spacer.style.setProperty('align-self', 'stretch', 'important');
	}
}

/** Give the shell a band before its spacer has a box. Never replace a size already set. */
export function holdShellSize(shell: HTMLElement, bandPx: number, side: boolean): void {
	if (bandPx < MIN_BOX) return;
	const span = bandPx + GRIP_PX;
	if (side) {
		const width = Number.parseFloat(shell.style.width);
		if (!(width >= MIN_BOX)) shell.style.width = `${span}px`;
		return;
	}
	const height = Number.parseFloat(shell.style.height);
	if (!(height >= MIN_BOX)) shell.style.height = `${span}px`;
}

export function markShellSide(shell: HTMLElement, side: boolean): void {
	shell.classList.toggle('is-side', side);
	const grip = shell.querySelector(':scope > .rv-hub-map-handle');
	if (grip instanceof HTMLElement) grip.setAttribute('aria-orientation', side ? 'vertical' : 'horizontal');
}

function boxHidden(node: HTMLElement): boolean {
	let current: HTMLElement | null = node;
	while (current) {
		if (current.style?.display === 'none') return true;
		if (current.classList?.contains('is-hidden') === true) return true;
		if (typeof current.hasAttribute === 'function' && current.hasAttribute('hidden')) return true;
		const parent: HTMLElement | null = current.parentElement;
		if (!parent || parent === current) break;
		current = parent;
	}
	return false;
}

/** The spacer that currently owns the map slot. A cover spacer is only a fallback. */
export function visibleMapSpacer(doc: Document): HTMLElement | null {
	if (doc == null || typeof doc.querySelectorAll !== 'function') return null;
	const nodes = doc.querySelectorAll('.rv-map-spacer');
	let cover: HTMLElement | null = null;
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!(node instanceof HTMLElement) || !node.isConnected || boxHidden(node)) continue;
		const rect = node.getBoundingClientRect();
		if (rect.width < MIN_BOX || rect.height < MIN_BOX) continue;
		if (node.closest('.rv-hub-swap-cover')) {
			cover = node;
			continue;
		}
		return node;
	}
	return cover;
}

/**
 * Move the shell onto the spacer's box. A spacer without a box leaves the
 * shell where it was. The shell's parent does not change.
 */
export function placeShellOver(shell: HTMLElement, spacer: HTMLElement | null): boolean {
	if (!(spacer instanceof HTMLElement) || !spacer.isConnected) return false;
	const rect = spacer.getBoundingClientRect();
	if (rect.width < MIN_BOX || rect.height < MIN_BOX) return false;
	shell.style.left = `${rect.left}px`;
	shell.style.top = `${rect.top}px`;
	shell.style.width = `${rect.width}px`;
	shell.style.height = `${rect.height}px`;
	shell.style.minHeight = `${rect.height}px`;
	shell.style.maxHeight = `${rect.height}px`;
	return true;
}

export function hideMapShell(shell: HTMLElement | null): void {
	if (!shell) return;
	shell.style.display = 'none';
}

export function showMapShell(shell: HTMLElement): void {
	shell.style.removeProperty('display');
}

export function destroyMapShell(shell: HTMLElement | null): void {
	shell?.remove();
}

export function removeMapSpacers(doc: Document): void {
	const nodes = doc.querySelectorAll('.rv-map-spacer');
	for (let index = nodes.length - 1; index >= 0; index -= 1) nodes[index]?.remove();
}
