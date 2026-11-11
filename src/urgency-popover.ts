import { setIcon, type IconName } from 'obsidian';

/** Measured row. 12px + 20.8px line + 12px, with the divider inside the row. */
export const URGENCY_ROW_PX = 44.8;
/** The popover's border box. Right edges line up with the ring. */
export const URGENCY_POPOVER_WIDTH = 188;
const GAP_PX = 4;
const MARGIN_PX = 12;

export interface UrgencyPopoverItem {
	title: string;
	icon: IconName;
	run: () => void;
}

export interface UrgencyAnchorBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface UrgencyViewport {
	left: number;
	top: number;
	width: number;
	height: number;
	/** Y the popover stays above: the tab bar, or the map when that is the floor. */
	floor: number;
}

export interface UrgencyPlacement {
	left: number;
	top: number;
	maxHeight: number;
	up: boolean;
}

/**
 * 4px from the ring, right edges aligned, opening down-left.
 * A floor collision flips it up. A left-edge collision opens to the right.
 * The height caps to the viewport so a short screen scrolls inside the popover.
 */
export function placeUrgencyPopover(
	anchor: UrgencyAnchorBox,
	size: { width: number; height: number },
	view: UrgencyViewport,
): UrgencyPlacement {
	const minLeft = view.left + MARGIN_PX;
	const minTop = view.top + MARGIN_PX;
	const maxRight = view.left + view.width - MARGIN_PX;
	const floor = Math.min(view.top + view.height - MARGIN_PX, view.floor);
	const anchorRight = anchor.left + anchor.width;
	const anchorBottom = anchor.top + anchor.height;
	let left = anchorRight - size.width;
	let top = anchorBottom + GAP_PX;
	let maxHeight = size.height;
	let up = false;
	if (top + size.height > floor) {
		up = true;
		top = anchor.top - GAP_PX - size.height;
	}
	if (up && top < minTop) {
		maxHeight = Math.max(0, anchor.top - GAP_PX - minTop);
		top = minTop;
	} else if (!up && top + maxHeight > floor) {
		maxHeight = Math.max(0, floor - top);
	}
	if (left < minLeft) left = anchor.left;
	if (left + size.width > maxRight) left = Math.max(minLeft, maxRight - size.width);
	if (left < minLeft) left = minLeft;
	return { left, top, maxHeight, up };
}

/** Tab bar top, or the map top when the ring sits above an open map. */
export function urgencyFloor(doc: Document, anchorBottom: number): number {
	const view = doc.defaultView;
	const visual = view?.visualViewport;
	const height = visual && visual.height > 0 ? visual.height : (view?.innerHeight ?? 0);
	const top = visual?.offsetTop ?? 0;
	let floor = top + height;
	const bar = doc.querySelector('.rv-bar-shell:not(.is-away)');
	const barBox = rectOf(bar);
	if (barBox) floor = Math.min(floor, barBox.top);
	if (doc.body?.classList.contains('rv-map-open')) {
		const mapBox = rectOf(doc.querySelector('.rv-map-shell'));
		if (mapBox && anchorBottom <= mapBox.top + 1) floor = Math.min(floor, mapBox.top);
	}
	return floor;
}

function rectOf(node: Element | null): { top: number; height: number } | null {
	if (!node || typeof (node as HTMLElement).getBoundingClientRect !== 'function') return null;
	const box = (node as HTMLElement).getBoundingClientRect();
	if (!box || !(box.height > 0)) return null;
	return box;
}

const closers = new Set<() => void>();

/** One popover. A later open, a menu dismiss, or a surface change drops it. */
export function closeUrgencyPopovers(doc?: Document | null): void {
	for (const close of [...closers]) close();
	if (!doc || typeof doc.querySelectorAll !== 'function') return;
	doc.querySelectorAll('.rv-urgency-popover').forEach((node) => node.remove());
}

function insidePopover(pop: HTMLElement, target: EventTarget | null): boolean {
	if (!target || typeof (target as Node).nodeType !== 'number') return false;
	try {
		return pop.contains(target as Node);
	} catch {
		return false;
	}
}

/**
 * Custom popover anchored to the ring. Obsidian's Menu has no phone opt-out
 * of `.menu.mod-sheet`, so this does not use Menu.
 */
export function openUrgencyPopover(
	anchor: HTMLElement,
	items: readonly UrgencyPopoverItem[],
	accent: string,
): HTMLElement {
	const doc = anchor.ownerDocument;
	closeUrgencyPopovers(doc);
	const pop = doc.createElement('div');
	pop.className = 'rv-urgency-popover';
	pop.setAttribute('role', 'menu');
	if (accent.trim()) pop.style.setProperty('--rv-urgency-accent', accent.trim());
	for (const item of items) {
		const row = doc.createElement('button');
		row.type = 'button';
		row.className = 'rv-urgency-popover-row';
		row.setAttribute('role', 'menuitem');
		row.setAttribute('aria-label', item.title);
		row.dataset.rvIcon = item.icon;
		const glyph = doc.createElement('span');
		glyph.className = 'rv-urgency-popover-icon';
		setIcon(glyph, item.icon);
		const label = doc.createElement('span');
		label.className = 'rv-urgency-popover-label';
		label.textContent = item.title;
		row.append(glyph, label);
		row.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			close();
			item.run();
		});
		pop.appendChild(row);
	}
	(doc.body ?? doc.documentElement).appendChild(pop);
	const anchorBox = anchor.getBoundingClientRect();
	const measured = pop.getBoundingClientRect();
	const width = measured.width > 1 ? measured.width : URGENCY_POPOVER_WIDTH;
	const height = measured.height > 1 ? measured.height : items.length * URGENCY_ROW_PX;
	const view = doc.defaultView;
	const visual = view?.visualViewport;
	const placed = placeUrgencyPopover(
		anchorBox,
		{ width, height },
		{
			left: visual?.offsetLeft ?? 0,
			top: visual?.offsetTop ?? 0,
			width: visual && visual.width > 0 ? visual.width : (view?.innerWidth ?? 0),
			height: visual && visual.height > 0 ? visual.height : (view?.innerHeight ?? 0),
			floor: urgencyFloor(doc, anchorBox.bottom),
		},
	);
	pop.style.left = `${placed.left}px`;
	pop.style.top = `${placed.top}px`;
	if (placed.maxHeight + 0.5 < height) pop.style.maxHeight = `${placed.maxHeight}px`;

	let closed = false;
	const close = (): void => {
		if (closed) return;
		closed = true;
		closers.delete(close);
		pop.remove();
		doc.removeEventListener('pointerdown', onPointer, true);
		doc.removeEventListener('keydown', onKey);
		doc.removeEventListener('scroll', onScroll, true);
	};
	const onPointer = (event: Event): void => {
		if (insidePopover(pop, event.target)) return;
		close();
	};
	const onKey = (event: Event): void => {
		if ((event as KeyboardEvent).key !== 'Escape') return;
		event.preventDefault();
		close();
	};
	const onScroll = (event: Event): void => {
		if (insidePopover(pop, event.target)) return;
		close();
	};
	closers.add(close);
	doc.addEventListener('pointerdown', onPointer, true);
	doc.addEventListener('keydown', onKey);
	doc.addEventListener('scroll', onScroll, true);
	return pop;
}
