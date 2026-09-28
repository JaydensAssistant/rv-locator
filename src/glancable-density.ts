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

export function glancableColumns(containerPx: number, settings: DensityMeasure): 1 | 2 {
	if (!Number.isFinite(containerPx) || containerPx <= 0) return 1;
	const card = estimatedGlancableCardPx(settings);
	return containerPx >= card * 2 + GRID_GAP_PX ? 2 : 1;
}
