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
