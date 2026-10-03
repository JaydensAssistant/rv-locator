/**
 * Default card width matches the old 680px two-column breakpoint
 * (34ch of meta text, today's horizontal padding, and the action rail).
 * A shorter line or a smaller font snaps to two columns in a narrower pane.
 */
const DEFAULT_TEXT_CHARS = 34;
const CHAR_PX = 7.4;
const ACTION_RAIL_PX = 64;
const GRID_GAP_PX = 8;

export interface DensityMeasure {
	glancableFontScale: number;
	glancablePaddingX: number;
	glancableMaxLineChars: number;
}

export function estimatedGlancableCardPx(settings: DensityMeasure): number {
	const scale = Number.isFinite(settings.glancableFontScale) && settings.glancableFontScale > 0
		? settings.glancableFontScale
		: 1;
	const chars = settings.glancableMaxLineChars > 0 ? settings.glancableMaxLineChars : DEFAULT_TEXT_CHARS;
	const text = chars * CHAR_PX * scale;
	const pad = Math.max(0, settings.glancablePaddingX) * 2;
	return text + pad + ACTION_RAIL_PX;
}

/**
 * Scale on top of the current density so `count` cards fit the pane.
 * 0 and 1 leave the density scale alone.
 */
export function fittedFontScale(containerPx: number, settings: DensityMeasure, count: number): number {
	const base = Number.isFinite(settings.glancableFontScale) && settings.glancableFontScale > 0
		? settings.glancableFontScale
		: 1;
	if (!Number.isInteger(count) || count < 2) return base;
	if (!Number.isFinite(containerPx) || containerPx <= 0) return base;
	const card = estimatedGlancableCardPx(settings);
	const gaps = (count - 1) * GRID_GAP_PX;
	const slot = (containerPx - gaps) / count;
	if (!Number.isFinite(card) || card <= 0 || !Number.isFinite(slot) || slot <= 0) return base;
	const fitted = base * (slot / card);
	return Math.min(2.5, Math.max(0.4, Math.round(fitted * 100) / 100));
}

/** How many cards fit side by side. A wide pane is not capped at two. */
export function glancableColumns(containerPx: number, settings: DensityMeasure): number {
	if (!Number.isFinite(containerPx) || containerPx <= 0) return 1;
	const card = estimatedGlancableCardPx(settings);
	if (!Number.isFinite(card) || card <= 0) return 1;
	return Math.max(1, Math.floor((containerPx + GRID_GAP_PX) / (card + GRID_GAP_PX)));
}
