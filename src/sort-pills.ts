/** Width that fits the longest pill. Zero when nothing was measured. */
export function equalPillWidth(widths: readonly number[]): number {
	let max = 0;
	for (const width of widths) {
		if (Number.isFinite(width) && width > max) max = width;
	}
	return max;
}

/** Every hub sort and filter pill becomes as wide as the longest label. */
export function equalizeSortPills(row: HTMLElement): void {
	const pills = Array.from(row.querySelectorAll('.rv-locator-sort-preset')).filter((node): node is HTMLElement => node instanceof HTMLElement);
	for (const pill of pills) {
		pill.style.width = 'max-content';
		pill.style.minWidth = 'max-content';
	}
	const width = equalPillWidth(pills.map((pill) => pill.getBoundingClientRect().width));
	if (width <= 0) return;
	const px = `${Math.ceil(width)}px`;
	for (const pill of pills) {
		pill.style.boxSizing = 'border-box';
		pill.style.width = px;
		pill.style.minWidth = px;
	}
}
