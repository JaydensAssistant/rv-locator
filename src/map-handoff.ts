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

/** The painted map the cover or the park is showing. A spacer is not a map. */
export function paintedHandoffMap(doc: Document): HTMLElement | null {
	const nodes = doc.querySelectorAll('.rv-hub-swap-cover .rv-hub-map, .rv-hub-swap-cover .rv-note-map, .rv-map-park .rv-hub-map, .rv-map-park .rv-note-map');
	let fallback: HTMLElement | null = null;
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!(node instanceof HTMLElement) || node.classList.contains('rv-map-spacer')) continue;
		if (!fallback) fallback = node;
		if (node.querySelector('.rv-map-stage')) return node;
	}
	return fallback;
}

/** Drop the blank reservation and put the painted map in the stage the user sees. */
export function placeHandedMap(map: HTMLElement, stage: HTMLElement): void {
	map.classList.remove('rv-note-map', 'rv-map-spacer');
	map.classList.add('rv-hub-map');
	const spacers = stage.querySelectorAll(':scope > .rv-map-spacer');
	for (let index = 0; index < spacers.length; index += 1) spacers[index]?.remove();
	stage.appendChild(map);
	seatMapGrip(stage, map);
}

function isMapGrip(node: Element | null): node is HTMLElement {
	return node instanceof HTMLElement && (
		node.classList.contains('rv-map-grip')
		|| node.classList.contains('rv-hub-map-handle')
		|| node.classList.contains('rv-note-map-handle')
	);
}

/**
 * Keep the divider on screen while the map moves. The same node is pinned,
 * then seated in the next stage. It is not removed and not recreated.
 */
export function liftMapGrip(grip: HTMLElement): void {
	if (!isMapGrip(grip)) return;
	const doc = grip.ownerDocument;
	if (grip.classList.contains('is-pinned') && grip.parentElement === doc.body) return;
	const rect = grip.getBoundingClientRect();
	grip.classList.add('rv-map-grip', 'is-pinned');
	grip.style.position = 'fixed';
	grip.style.left = `${rect.left}px`;
	grip.style.top = `${rect.top}px`;
	grip.style.width = `${Math.max(rect.width, 1)}px`;
	grip.style.height = '3px';
	grip.style.zIndex = '81';
	grip.style.margin = '0';
	doc.body.appendChild(grip);
}

/** Put the one grip into this stage. A pinned grip is reused. */
export function seatMapGrip(stage: HTMLElement, before: Element | null): HTMLElement {
	const doc = stage.ownerDocument;
	const pinned = doc.querySelector('body > .rv-map-grip.is-pinned, .rv-map-grip.is-pinned');
	let grip = pinned instanceof HTMLElement ? pinned : null;
	if (!grip) {
		const local = stage.querySelector(':scope > .rv-map-grip, :scope > .rv-hub-map-handle, :scope > .rv-note-map-handle');
		if (local instanceof HTMLElement) grip = local;
	}
	if (!grip) {
		grip = doc.createElement('div');
		grip.setAttribute('role', 'separator');
		grip.setAttribute('aria-orientation', 'horizontal');
		grip.setAttribute('aria-label', 'Resize map');
	}
	// A collapsed stage has no box for an in-flow grip. Leave the pinned
	// divider on screen until the band has a height, or that frame has neither.
	const band = before instanceof HTMLElement ? before.querySelector('.rv-map-stage') : null;
	if (band instanceof HTMLElement && grip.classList.contains('is-pinned') && band.getBoundingClientRect().height < 2) {
		return grip;
	}
	const hub = stage.closest('.rv-locator-view, .rv-locator-stage, .rv-locator-glancable');
	grip.classList.remove('is-pinned', 'rv-map-grip');
	grip.style.position = '';
	grip.style.left = '';
	grip.style.top = '';
	grip.style.width = '';
	grip.style.height = '';
	grip.style.zIndex = '';
	grip.style.margin = '';
	grip.className = hub ? 'rv-hub-map-handle' : 'rv-note-map-handle';
	if (before && before.parentElement === stage) stage.insertBefore(grip, before);
	else if (grip.parentElement !== stage) stage.appendChild(grip);
	return grip;
}

/** The hub's own grip. A handed map keeps the grip it already had. */
export function ensureHubMapHandle(stage: HTMLElement): HTMLElement {
	const map = stage.querySelector(':scope > .rv-hub-map, :scope > .rv-note-map');
	return seatMapGrip(stage, map);
}

/**
 * Keep the band the cover just showed. A percent height on the live stage
 * collapses, and the band is then only the theme background.
 */
export function lockHandedMapBand(map: HTMLElement, heightPx: number): void {
	const stage = map.querySelector('.rv-map-stage');
	if (!(stage instanceof HTMLElement)) return;
	const height = Math.round(heightPx);
	if (height < 2) return;
	const px = `${height}px`;
	stage.style.setProperty('height', px, 'important');
	stage.style.setProperty('min-height', px, 'important');
	map.style.setProperty('min-height', px, 'important');
	map.style.setProperty('flex', `0 0 ${px}`, 'important');
}

/** The live hub has to be a map hub before the cover leaves, or the moved node stays `display: none`. */
export function markHandedMapHost(stage: HTMLElement): void {
	const view = stage.closest('.rv-locator-glancable') ?? stage.closest('.rv-locator-view');
	if (!(view instanceof HTMLElement)) return;
	view.classList.add('is-hub-map');
	const body = stage.ownerDocument?.body;
	const phone = body?.classList.contains('is-phone') === true || body?.classList.contains('is-mobile') === true;
	if (phone || view.classList.contains('is-stacked')) view.classList.add('is-stacked');
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
	holder.style.zIndex = '80';
	doc.body.appendChild(holder);
	const grip = el.previousElementSibling;
	if (isMapGrip(grip)) liftMapGrip(grip);
	holder.appendChild(el);
	return holder;
}

/**
 * Take the parked map and keep it in the document. The caller moves it into
 * the next stage. The node stays in the sized park until that move. Parking
 * it on the body first is the frame where the stage is 0px and the grip is gone.
 */
export function claimParkedMap(doc: Document, className: 'rv-hub-map' | 'rv-note-map'): HTMLElement | null {
	const el = doc.querySelector(`.${MAP_PARK_CLASS} .rv-hub-map, .${MAP_PARK_CLASS} .rv-note-map`);
	if (!(el instanceof HTMLElement)) return null;
	el.classList.remove('rv-hub-map', 'rv-note-map');
	el.classList.add(className);
	return el;
}

/** Drop a park once its map has moved into the next stage. */
export function retireEmptyMapPark(doc: Document): void {
	const holders = doc.querySelectorAll(`.${MAP_PARK_CLASS}`);
	for (let index = 0; index < holders.length; index += 1) {
		const holder = holders[index];
		if (holder && !holder.querySelector('.rv-hub-map, .rv-note-map')) holder.remove();
	}
}

/** Reuse the same map node in the next stage. */
export function moveMapToStage(map: HTMLElement, stage: HTMLElement, className: 'rv-hub-map' | 'rv-note-map'): void {
	map.classList.remove('rv-hub-map', 'rv-note-map');
	map.classList.add(className);
	stage.appendChild(map);
}
