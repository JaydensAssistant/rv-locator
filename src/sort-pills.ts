/**
 * Vanilla sort row still caps a measured pill. Glancable pills share the
 * row instead ({@link glancePillsThatFit}).
 */
export const SORT_PILL_CAP_PX = 78;

/** Glancable bar: 2px top padding, two 40px rows, 2px between them. */
export const GLANCE_BAR_PAD_X = 4;
export const GLANCE_BAR_PAD_TOP = 2;
export const GLANCE_BAR_GAP = 2;
export const GLANCE_ROW_PX = 40;
export const GLANCE_PILL_GAP = 2;
/** Sort, search, map, campaign, filter, and new. They share the bar. */
export const GLANCE_CONTROL_COUNT = 6;
/** Gap between those control buttons. The open sort row uses the same gap. */
export const GLANCE_CONTROL_GAP = 4;

/** Border on each side of a glancable pill. The label uses the rest of the pill. */
export const GLANCE_PILL_BORDER_PX = 2;

/** Content box of one equal pill. The label has to fit inside this at 11px or larger. */
export function glancePillContentPx(viewWidth: number, count: number, pad = GLANCE_BAR_PAD_X, gap = GLANCE_PILL_GAP): number {
	return glancePillWidth(viewWidth, count, pad, gap) - GLANCE_PILL_BORDER_PX;
}

/** Width of one equal sort pill when `count` pills share the row. */
export function glancePillWidth(viewWidth: number, count: number, pad = GLANCE_BAR_PAD_X, gap = GLANCE_PILL_GAP): number {
	if (count <= 0 || viewWidth <= 0) return 0;
	const inner = viewWidth - pad * 2;
	const gaps = gap * Math.max(0, count - 1);
	return (inner - gaps) / count;
}

/**
 * Sort pills share the full row, so every one is fully visible when each
 * share is at least 1px. Filter pills sit past that row and scroll.
 */
export function glancePillsThatFit(viewWidth: number, count: number): number {
	const each = glancePillWidth(viewWidth, count);
	if (each < 1) return 0;
	return count;
}

/** Action row plus pill row. A phone safe-area inset is added by the caller. */
export function glanceBarHeight(safeAreaPx = 0): number {
	const inset = Number.isFinite(safeAreaPx) && safeAreaPx > 0 ? safeAreaPx : 0;
	return GLANCE_BAR_PAD_TOP + GLANCE_ROW_PX + GLANCE_BAR_GAP + GLANCE_ROW_PX + inset;
}

/**
 * Width of one control button when `count` of them share the bar.
 * Sort pills use this same width and do not shrink, so a narrow pane scrolls.
 */
export function controlButtonWidth(barWidth: number, padX = GLANCE_BAR_PAD_X * 2, count = GLANCE_CONTROL_COUNT, gap = GLANCE_CONTROL_GAP): number {
	if (count <= 0 || !(barWidth > 0)) return 0;
	const inner = barWidth - padX;
	const gaps = gap * Math.max(0, count - 1);
	const width = (inner - gaps) / count;
	return width > 0 ? width : 0;
}

export interface SortPillSize {
	flex: string;
	flexBasis: string;
	minWidth: string;
	width: string;
	height: string;
}

/** Fixed box matching one control button. `flex` starts at 0 so the pill cannot shrink. */
export function sortPillSize(controlWidth: number, height = GLANCE_ROW_PX): SortPillSize {
	const px = `${controlWidth}px`;
	return {
		flex: `0 0 ${px}`,
		flexBasis: px,
		minWidth: px,
		width: px,
		height: `${height}px`,
	};
}

/** Vertical wheel, shift-wheel, and a horizontal trackpad all move the sort row sideways. */
export function horizontalScrollDelta(deltaX: number, deltaY: number, shiftKey = false): number {
	if (shiftKey) return deltaX || deltaY;
	if (Math.abs(deltaX) > Math.abs(deltaY)) return deltaX;
	return deltaY;
}

/** Sort labels start at the pill's 12px and can drop to 10px before they clip. */
export const SORT_LABEL_FONT_MAX_PX = 12;
export const SORT_LABEL_FONT_MIN_PX = 10;

/**
 * Font size that keeps a control-width pill. The label stays at {@link SORT_LABEL_FONT_MAX_PX}
 * when it fits, scales down while it still clears {@link SORT_LABEL_FONT_MIN_PX}, and then clips.
 */
export function sortLabelFontPx(textWidth: number, available: number, max = SORT_LABEL_FONT_MAX_PX, min = SORT_LABEL_FONT_MIN_PX): number {
	if (!(textWidth > 0) || !(available > 0) || textWidth <= available) return max;
	const scaled = (available / textWidth) * max;
	if (scaled >= max) return max;
	if (scaled <= min) return min;
	return Math.round(scaled * 100) / 100;
}

/** Shrink the label toward 10px when the control-width pill cannot hold 12px. */
function fitSortLabel(pill: HTMLElement): void {
	const label = pill.querySelector(':scope > .rv-sort-label');
	if (!(label instanceof HTMLElement)) return;
	const available = pill.clientWidth;
	if (available <= 0) return;
	label.style.setProperty('font-size', `${SORT_LABEL_FONT_MAX_PX}px`, 'important');
	const style = getComputedStyle(pill);
	const pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
	const inner = available - pad;
	const size = sortLabelFontPx(label.scrollWidth, inner);
	label.style.setProperty('font-size', `${size}px`, 'important');
}

/**
 * Pull the sort row back inside the window. A flex remainder of 1px leaves
 * the last button past the edge at 1280, 700, and 400. One correction per
 * window width, so a border that will not move cannot shrink the row away.
 */
export function containSortRow(bar: HTMLElement): void {
	const view = bar.ownerDocument.defaultView;
	if (!view || typeof bar.getBoundingClientRect !== 'function') return;
	let right = bar.getBoundingClientRect().right;
	bar.querySelectorAll('button').forEach((node) => {
		if (!(node instanceof HTMLElement) || typeof node.getBoundingClientRect !== 'function') return;
		const edge = node.getBoundingClientRect().right;
		if (edge > right) right = edge;
	});
	const over = right - view.innerWidth;
	const stamp = String(view.innerWidth);
	if (over <= 0.5) {
		const cap = Number.parseFloat(bar.style.maxWidth);
		if (bar.dataset.rvSortContain && Number.isFinite(cap) && view.innerWidth > cap + 8) {
			bar.style.maxWidth = '';
			delete bar.dataset.rvSortContain;
		}
		return;
	}
	if (bar.dataset.rvSortContain === stamp) return;
	const width = bar.getBoundingClientRect().width;
	const next = Math.max(0, width - Math.ceil(over - 1e-6));
	if (!(next > 0) || next >= width) return;
	bar.dataset.rvSortContain = stamp;
	bar.style.maxWidth = `${next}px`;
}

/** Pin every sort pill to the control-button size of this bar. */
export function applyControlSizedPills(bar: HTMLElement, pills: HTMLElement): void {
	const style = getComputedStyle(bar);
	const padX = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
	const width = controlButtonWidth(bar.clientWidth, padX);
	if (width <= 0) return;
	const size = sortPillSize(width);
	bar.style.setProperty('--rv-control-btn', size.width);
	pills.querySelectorAll('.rv-locator-sort-preset').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		node.style.setProperty('flex', size.flex, 'important');
		node.style.setProperty('flex-basis', size.flexBasis, 'important');
		node.style.setProperty('min-width', size.minWidth, 'important');
		node.style.setProperty('width', size.width, 'important');
		node.style.setProperty('max-width', size.width, 'important');
		node.style.setProperty('height', size.height, 'important');
		node.style.setProperty('min-height', size.height, 'important');
		fitSortLabel(node);
	});
	const close = bar.querySelector(':scope > .rv-sort-close');
	if (close instanceof HTMLElement) {
		close.style.setProperty('flex', size.flex, 'important');
		close.style.setProperty('flex-basis', size.flexBasis, 'important');
		close.style.setProperty('min-width', size.minWidth, 'important');
		close.style.setProperty('width', size.width, 'important');
		close.style.setProperty('max-width', size.width, 'important');
		close.style.setProperty('height', size.height, 'important');
	}
}

/** Width that fits the longest pill. Zero when nothing was measured. */
export function equalPillWidth(widths: readonly number[]): number {
	let max = 0;
	for (const width of widths) {
		if (Number.isFinite(width) && width > max) max = width;
	}
	return max;
}

/** Measured width, never wider than {@link SORT_PILL_CAP_PX}. */
export function cappedPillWidth(measured: number, cap = SORT_PILL_CAP_PX): number {
	if (!Number.isFinite(measured) || measured <= 0) return 0;
	return Math.min(Math.ceil(measured), cap);
}

/** Sort pills share one width. Filter pills keep their own width. Glancable rows flex instead. */
export function equalizeSortPills(row: HTMLElement): void {
	if (row.classList.contains('rv-locator-sort-pills')) return;
	const pills = Array.from(row.querySelectorAll('.rv-locator-sort-preset:not(.is-filter)')).filter((node): node is HTMLElement => node instanceof HTMLElement);
	for (const pill of pills) {
		pill.style.width = 'max-content';
		pill.style.minWidth = 'max-content';
	}
	const width = cappedPillWidth(equalPillWidth(pills.map((pill) => pill.getBoundingClientRect().width)));
	if (width <= 0) return;
	const px = `${width}px`;
	for (const pill of pills) {
		pill.style.boxSizing = 'border-box';
		pill.style.width = px;
		pill.style.minWidth = px;
		pill.style.maxWidth = px;
	}
}
