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
export const GLANCE_PILL_GAP = 3;

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
