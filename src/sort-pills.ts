/**
 * Equal sort-pill width, capped so about four fit beside the hub buttons
 * on a phone. Filter pills are not in this measure.
 */
export const SORT_PILL_CAP_PX = 78;

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

/** Sort pills share one width. Filter pills keep their own width. */
export function equalizeSortPills(row: HTMLElement): void {
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
