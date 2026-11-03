/** Chip flex gap. The visible gap is this plus Lucide's right-side padding. */
export const CHIP_GAP_PX = 4;

export const GLYPH_BOX_PX = 16;
export const GLYPH_VIEWBOX = 24;

/**
 * Empty units on the right of the 24 viewBox, from the live desktop and phone
 * measure. book-check shares the book-marked outline.
 */
export const GLYPH_EMPTY_RIGHT: Record<string, number> = {
	'book-open': 2,
	clapperboard: 3,
	'book-marked': 4,
	'book-check': 4,
};

/** Shift the glyph toward the label so the optical gap matches book-open. */
export const GLYPH_NUDGE_PX: Record<string, number> = {
	clapperboard: 0.67,
	'book-marked': 1.33,
	'book-check': 1.33,
};

const UNIT = GLYPH_BOX_PX / GLYPH_VIEWBOX;

export function opticalChipGapPx(icon: string): number {
	const empty = GLYPH_EMPTY_RIGHT[icon] ?? GLYPH_EMPTY_RIGHT['book-open'] ?? 2;
	const nudge = GLYPH_NUDGE_PX[icon] ?? 0;
	return CHIP_GAP_PX + empty * UNIT - nudge;
}

/** Modal names use margin-right 0.35em plus the same glyph padding. */
export function opticalModalGapPx(icon: string, emPx = 16): number {
	const empty = GLYPH_EMPTY_RIGHT[icon] ?? GLYPH_EMPTY_RIGHT['book-open'] ?? 2;
	const nudge = GLYPH_NUDGE_PX[icon] ?? 0;
	return 0.35 * emPx + empty * UNIT - nudge;
}
