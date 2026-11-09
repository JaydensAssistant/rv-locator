/** Stack the map in the hub below this width, and on a real phone. */
export const HUB_STACK_BELOW_PX = 600;

/**
 * A hub or base leaf. The note-map grid belongs only on a markdown note
 * that is showing the note map, never on the leaf that holds this view.
 */
export function leafHoldsHub(content: HTMLElement): boolean {
	if (typeof content.querySelector !== 'function') return false;
	return content.querySelector(':scope > .view-content .rv-locator-view, :scope > .view-content .rv-locator-glancable, :scope > .view-content .bases-embed, :scope > .view-content .block-language-base') != null;
}

/**
 * Note-map leaf classes. A width of 0 is an unmeasured or fullscreen frame:
 * keep the side class already on the leaf instead of dropping the layout.
 * A hub or base leaf loses the class instead of gaining it.
 */
export function applyNoteMapFrame(content: HTMLElement, width: number): void {
	if (leafHoldsHub(content)) {
		content.classList.remove('is-note-map', 'is-note-map-side');
		return;
	}
	content.classList.add('is-note-map');
	if (width > 0) content.classList.toggle('is-note-map-side', width >= HUB_STACK_BELOW_PX);
}

/** The 3px bar. The 44px hit is a pseudo-element, not this layout height. */
export const STACKED_HANDLE_PX = 3;
export const STACKED_BAR_PX = 84;
export const DEFAULT_MAP_RATIO = 0.42;

/**
 * Standalone on an 844px phone leaves a 734px hub (cards 374, handle 3, map 273, bar 84).
 * Used when the header, nav, and safe area cannot be measured.
 */
export const MOBILE_CHROME_FALLBACK_PX = 110;

/** Visible height for a stacked embed: the viewport minus header, nav, and safe area. */
export function stackedEmbedCap(viewportPx: number, chromePx: number): number {
	const chrome = chromePx > 0 ? chromePx : MOBILE_CHROME_FALLBACK_PX;
	return Math.max(0, viewportPx - chrome);
}

/**
 * Height of a hub embed so the sort bar stays inside the preview.
 * A laid-out embed top already includes the markdown pad. A top of 0
 * still has to give that pad back, or the bar is clipped.
 */
export function hubEmbedCapPx(viewportPx: number, embedTopPx: number, previewPadPx: number): number {
	const viewport = Math.max(0, viewportPx);
	const top = Math.max(0, embedTopPx);
	const pad = Math.max(0, previewPadPx);
	const occupied = top > 1 ? top : pad;
	return Math.max(160, Math.round(viewport - occupied));
}

/**
 * One pane for the note and the hub: the leaf under its header when stacked,
 * the leaf width when the map sits beside the list. Both bands use this.
 */
export function mapPanePx(leaf: HTMLElement, side: boolean): number {
	const box = typeof leaf.getBoundingClientRect === 'function' ? leaf.getBoundingClientRect() : { width: 0, height: 0 };
	const width = box.width > 0 ? box.width : leaf.clientWidth;
	if (side) return width > 0 ? width : 0;
	const header = typeof leaf.querySelector === 'function'
		? leaf.querySelector(':scope > .view-header, :scope > .workspace-leaf-content > .view-header')
		: null;
	const headerPx = header instanceof HTMLElement ? (header.getBoundingClientRect().height || header.offsetHeight || 0) : 0;
	const height = box.height > 0 ? box.height : leaf.clientHeight;
	return Math.max(0, height - headerPx);
}

/** Pixel band for a shared split. Zero means the pane is not laid out yet. */
export function mapBandPx(panePx: number, ratio: number): number {
	if (!(panePx > 0) || !Number.isFinite(ratio)) return 0;
	return Math.max(0, Math.round(panePx * ratio));
}

/** Write the shared band. A measured pane is pixels; an unmeasured one is the same percent. */
export function writeMapBand(host: HTMLElement, panePx: number, ratio: number, prop: '--rv-map-size' | '--rv-note-map'): void {
	const px = mapBandPx(panePx, ratio);
	const share = Number.isFinite(ratio) ? ratio : DEFAULT_MAP_RATIO;
	const next = px > 0 ? `${px}px` : `${Math.round(share * 100)}%`;
	// One band for the hub and the note. Writing both names keeps the handoff from
	// falling back to a percent on the name the other view was using.
	if (host.style.getPropertyValue('--rv-map-size') !== next) host.style.setProperty('--rv-map-size', next);
	if (host.style.getPropertyValue('--rv-note-map') !== next) host.style.setProperty('--rv-note-map', next);
	void prop;
}

/** Map is `mapRatio` of the stage. The handle is the rest of the stage after the cards. */
export function stackedStageSplit(stagePx: number, handlePx = STACKED_HANDLE_PX, mapRatio = DEFAULT_MAP_RATIO): { cards: number; map: number } {
	const map = Math.round(stagePx * mapRatio);
	const cards = stagePx - handlePx - map;
	return { cards, map };
}

/**
 * Put the glance scroller inside a stage that is a child of the view root.
 * A disconnected previous stage must not be an insertBefore anchor.
 */
export function placeGlanceStage(root: HTMLElement, scroll: HTMLElement, current: HTMLElement | null): HTMLElement {
	const stage = current ?? root.createDiv('rv-locator-stage');
	if (scroll.parentElement !== root && scroll.parentElement !== stage) root.appendChild(scroll);
	if (stage.parentElement !== root) root.appendChild(stage);
	if (scroll.parentElement === root) root.insertBefore(stage, scroll);
	if (scroll.parentElement !== stage) stage.appendChild(scroll);
	return stage;
}

/** Desktop embedded side map. 70vh of the viewport, never a zero-height column. */
export function sideMapMinPx(viewportPx: number): number {
	return Math.round(viewportPx * 0.7);
}

/**
 * Phone hub, or a narrow pane. A width of 0 has not been measured, so the
 * caller can keep the last known narrow state instead of treating it as wide.
 */
export function hubUsesStackedMap(isMobile: boolean, width: number, knownNarrow = false): boolean {
	if (isMobile) return true;
	if (width > 0) return width < HUB_STACK_BELOW_PX;
	return knownNarrow;
}

/**
 * Width for the stack decision. A narrow window is stacked even when the split
 * map leaf has squeezed the hub column. A wide window adds that leaf's width
 * so the two columns together can stay a split.
 */
export function hubStackMeasure(hubWidth: number, splitWidth: number, frameWidth = 0): number {
	const frame = Math.max(0, frameWidth);
	if (frame > 0 && frame < HUB_STACK_BELOW_PX) return frame;
	const columns = Math.max(0, hubWidth) + Math.max(0, splitWidth);
	if (columns > 0) return columns;
	return frame;
}

/** Park the split leaf while stacked, and bring it back only after the hub is wide. */
export function splitMapLeafAction(stacked: boolean, splitOpen: boolean, parked: boolean): 'park' | 'restore' | 'keep' {
	if (stacked && splitOpen) return 'park';
	if (!stacked && parked && !splitOpen) return 'restore';
	return 'keep';
}

/**
 * Scroll the Glancable hub to one card and flash it.
 * Cards are `[data-rv-path]` inside `.rv-locator-scroll` (overflow-y: auto),
 * which is the scroll child of `.rv-locator-view`. That column is the hub
 * scroller. An ancestor that actually overflows, such as Bases `.view-content`,
 * is moved as well.
 */
export function revealHubCard(scrollEl: HTMLElement, card: HTMLElement): void {
	const containers: HTMLElement[] = [];
	const add = (node: HTMLElement | null): void => {
		if (!node || containers.includes(node)) return;
		containers.push(node);
	};
	const marked = card.closest('.rv-locator-scroll');
	if (isElement(marked)) add(marked);
	if (scrollEl.classList.contains('rv-locator-scroll') || containers.length === 0) add(scrollEl);
	let node: HTMLElement | null = card.parentElement;
	const view = card.ownerDocument?.defaultView ?? null;
	while (node) {
		if (node !== scrollEl && nodeOverflows(node, view)) add(node);
		if (node.classList.contains('workspace-leaf-content')) break;
		node = node.parentElement;
	}
	for (const container of containers) {
		const top = offsetInContainer(container, card);
		const room = Math.max(0, (container.clientHeight || 0) - (card.offsetHeight || 0));
		container.scrollTop = Math.max(0, top - room / 2);
	}
	if (typeof card.scrollIntoView === 'function') {
		try {
			card.scrollIntoView({ block: 'center', inline: 'nearest' });
		} catch {
			/* A layout test document has no scrolling view. */
		}
	}
	shadeHubCard(card);
}

/** The RV-188 full-card shade. A jump never draws an outline. */
export function shadeHubCard(card: HTMLElement): void {
	card.classList.remove('rv-card-flash');
	if (!card.dataset.rvLandAt) card.dataset.rvLandAt = String(Date.now());
	card.classList.add('rv-card-land');
	if (card.dataset.rvLandTimer === '1') return;
	card.dataset.rvLandTimer = '1';
	const view = card.ownerDocument?.defaultView;
	const clear = (): void => {
		card.classList.remove('rv-card-land');
		delete card.dataset.rvLandTimer;
	};
	if (view && typeof view.setTimeout === 'function') view.setTimeout(clear, 2000);
}

function isElement(node: unknown): node is HTMLElement {
	return typeof HTMLElement === 'function' && node instanceof HTMLElement;
}

function nodeOverflows(node: HTMLElement, view: Window | null): boolean {
	if ((node.scrollHeight || 0) <= (node.clientHeight || 0) + 1) return false;
	const style = view?.getComputedStyle?.(node);
	if (!style) return node.classList.contains('rv-locator-scroll') || node.classList.contains('view-content');
	const y = `${style.overflowY} ${style.overflow}`;
	return /auto|scroll|overlay/.test(y);
}

/**
 * Scroll offset that puts `card` at `desiredTop` in the viewport, then clamps
 * so the card stays fully inside the scroller. A last card that cannot be
 * centered stays on screen instead of sliding past the bottom.
 */
export function landingScrollFor(scrollEl: HTMLElement, card: HTMLElement, desiredTop: number): number {
	const scrollRect = scrollEl.getBoundingClientRect();
	const cardRect = card.getBoundingClientRect();
	const current = scrollEl.scrollTop || 0;
	const viewHeight = scrollEl.clientHeight || scrollRect.height || 0;
	const cardHeight = cardRect.height || card.offsetHeight || 0;
	const cardOffset = current + (cardRect.top - scrollRect.top);
	const max = Math.max(0, (scrollEl.scrollHeight || 0) - viewHeight);
	let next = cardOffset - (desiredTop - scrollRect.top);
	if (viewHeight > 0 && cardHeight > 0 && cardHeight <= viewHeight) {
		const minScroll = Math.max(0, cardOffset + cardHeight - viewHeight);
		const maxScroll = Math.max(0, cardOffset);
		const low = Math.min(minScroll, max);
		const high = Math.min(Math.max(minScroll, maxScroll), max);
		next = Math.max(low, Math.min(high, next));
	}
	if (!Number.isFinite(next)) return current;
	return Math.max(0, Math.min(max, next));
}

/** The card is fully inside the scroller, so the landing scroll has taken. */
export function hubLandingReady(scrollEl: HTMLElement, card: HTMLElement): boolean {
	if ((scrollEl.clientHeight || 0) <= 1) return false;
	const cardRect = card.getBoundingClientRect();
	const box = scrollEl.getBoundingClientRect();
	if (cardRect.height <= 0 || box.height <= 0) return false;
	return cardRect.top >= box.top - 2 && cardRect.bottom <= box.bottom + 2;
}

function offsetInContainer(container: HTMLElement, card: HTMLElement): number {
	if (typeof card.getBoundingClientRect === 'function' && typeof container.getBoundingClientRect === 'function') {
		const cardRect = card.getBoundingClientRect();
		const boxRect = container.getBoundingClientRect();
		const delta = cardRect.top - boxRect.top;
		if (Number.isFinite(delta) && (cardRect.height > 0 || boxRect.height > 0 || delta !== 0)) {
			return delta + (container.scrollTop || 0);
		}
	}
	let top = 0;
	let node: HTMLElement | null = card;
	const seen = new Set<HTMLElement>();
	while (node && node !== container && !seen.has(node)) {
		seen.add(node);
		top += node.offsetTop || 0;
		const next: HTMLElement | null = node.offsetParent instanceof HTMLElement ? node.offsetParent : node.parentElement;
		if (!next || next === container) break;
		node = next;
	}
	return top;
}
