/** Stack the map in the hub below this width, and on a real phone. */
export const HUB_STACK_BELOW_PX = 600;

/** Visible drag strip, and the two-row bar without a safe-area inset. */
export const STACKED_HANDLE_PX = 14;
export const STACKED_BAR_PX = 84;
export const DEFAULT_MAP_RATIO = 0.42;

/**
 * Standalone on an 844px phone leaves a 734px hub (cards 363, handle 14, map 273, bar 84).
 * Used when the header, nav, and safe area cannot be measured.
 */
export const MOBILE_CHROME_FALLBACK_PX = 110;

/** Visible height for a stacked embed: the viewport minus header, nav, and safe area. */
export function stackedEmbedCap(viewportPx: number, chromePx: number): number {
	const chrome = chromePx > 0 ? chromePx : MOBILE_CHROME_FALLBACK_PX;
	return Math.max(0, viewportPx - chrome);
}

/** Map is `mapRatio` of the stage. The handle is the rest of the stage after the cards. */
export function stackedStageSplit(stagePx: number, handlePx = STACKED_HANDLE_PX, mapRatio = DEFAULT_MAP_RATIO): { cards: number; map: number } {
	const map = Math.round(stagePx * mapRatio);
	const cards = stagePx - handlePx - map;
	return { cards, map };
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
	card.classList.add('rv-card-flash');
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
