import { hostIsHidden } from './hub-cover';

/** Fixed holder that keeps a map on screen while its view is swapped. */
export const MAP_PARK_CLASS = 'rv-map-park';

export interface MapStay {
	hubMapOpen: boolean;
	noteMapOpen: boolean;
}

/**
 * Settled flags after a leaf change. An open map stays open across a hub and
 * a note. Any other destination, or a map that is already off, leaves it off.
 */
export function mapStayForOpen(current: MapStay, destination: 'hub' | 'note' | 'other'): MapStay {
	const on = current.hubMapOpen || current.noteMapOpen;
	if (!on || destination === 'other') return { hubMapOpen: false, noteMapOpen: false };
	if (destination === 'hub') return { hubMapOpen: true, noteMapOpen: false };
	return { hubMapOpen: false, noteMapOpen: true };
}

/** The map that is still in a live view, not the one already parked or inside the hub cover. */
export function visibleMapNode(doc: Document): HTMLElement | null {
	const nodes = doc.querySelectorAll('.rv-note-map, .rv-hub-map');
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!(node instanceof HTMLElement)) continue;
		if (node.classList.contains('rv-map-spacer')) continue;
		if (node.closest('.rv-hub-swap-cover')) continue;
		if (hostIsHidden(node)) continue;
		return node;
	}
	return null;
}

/**
 * The hub stage the user is looking at. A hidden markdown mode also has cards,
 * and handing the map to that stage leaves the visible band as an empty spacer.
 */
export function shownHubStage(doc: Document): HTMLElement | null {
	const cards = doc.querySelectorAll('.rv-locator-card');
	let spacerStage: HTMLElement | null = null;
	let fallback: HTMLElement | null = null;
	for (let index = 0; index < cards.length; index += 1) {
		const card = cards[index];
		if (!(card instanceof HTMLElement) || card.closest('.rv-hub-swap-cover')) continue;
		const stage = card.closest('.rv-locator-stage');
		if (!(stage instanceof HTMLElement) || hostIsHidden(stage)) continue;
		if (!fallback) fallback = stage;
		if (stage.querySelector(':scope > .rv-map-spacer')) spacerStage = stage;
	}
	if (spacerStage) return spacerStage;
	if (fallback) return fallback;
	const spacers = doc.querySelectorAll('.rv-map-spacer');
	for (let index = 0; index < spacers.length; index += 1) {
		const spacer = spacers[index];
		if (!(spacer instanceof HTMLElement) || spacer.closest('.rv-hub-swap-cover')) continue;
		if (hostIsHidden(spacer)) continue;
		const stage = spacer.closest('.rv-locator-stage');
		if (stage instanceof HTMLElement) return stage;
	}
	return null;
}

/** Drop the blank reservation and put the painted map in the stage the user sees. */
export function placeHandedMap(map: HTMLElement, stage: HTMLElement): void {
	map.classList.remove('rv-note-map', 'rv-map-spacer');
	map.classList.add('rv-hub-map');
	const spacers = stage.querySelectorAll(':scope > .rv-map-spacer');
	for (let index = 0; index < spacers.length; index += 1) spacers[index]?.remove();
	stage.appendChild(map);
}

/** Lift a map out of the view that is about to be replaced. The node stays connected. */
export function parkMapNode(el: HTMLElement): HTMLElement {
	const doc = el.ownerDocument;
	const rect = el.getBoundingClientRect();
	const holder = doc.createElement('div');
	holder.className = MAP_PARK_CLASS;
	holder.style.position = 'fixed';
	holder.style.left = `${rect.left}px`;
	holder.style.top = `${rect.top}px`;
	holder.style.width = `${Math.max(rect.width, 1)}px`;
	holder.style.height = `${Math.max(rect.height, 1)}px`;
	holder.style.zIndex = '60';
	doc.body.appendChild(holder);
	holder.appendChild(el);
	return holder;
}

/**
 * Take the parked map and keep it in the document. The caller moves it into
 * the next stage. Removing the holder first would drop the node.
 */
export function claimParkedMap(doc: Document, className: 'rv-hub-map' | 'rv-note-map'): HTMLElement | null {
	const el = doc.querySelector(`.${MAP_PARK_CLASS} .rv-hub-map, .${MAP_PARK_CLASS} .rv-note-map`);
	if (!(el instanceof HTMLElement)) return null;
	const holder = el.parentElement;
	el.classList.remove('rv-hub-map', 'rv-note-map');
	el.classList.add(className);
	(holder?.parentElement ?? doc.body).appendChild(el);
	holder?.remove();
	return el;
}

/** Reuse the same map node in the next stage. */
export function moveMapToStage(map: HTMLElement, stage: HTMLElement, className: 'rv-hub-map' | 'rv-note-map'): void {
	map.classList.remove('rv-hub-map', 'rv-note-map');
	map.classList.add(className);
	stage.appendChild(map);
}
