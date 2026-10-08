/**
 * Default card width matches the old 680px two-column breakpoint
 * (34ch of meta text, today's horizontal padding, and the action rail).
 * A shorter line or a smaller font snaps to two columns in a narrower pane.
 */
const CARD_LINE_GAP_PX = 3;

/** Rendered height of one glancable line before the font scale, from styles.css. */
const COMPACT_LINE_PX: Record<CompactLineKind, number> = {
	name: 20 * 1.15,
	place: 13 * 1.25,
	dates: 12 * 1.2,
	foot: 13 * 1.25,
};

export type CompactLineKind = 'name' | 'place' | 'dates' | 'foot';

/**
 * Badge diameter that fits inside the lines actually on the card.
 * Four default lines hold the natural 28px circle. Fewer lines scale it down.
 */
export function compactBadgePx(fontScale: number, padY: number, lines: readonly CompactLineKind[], badgeCount: number): number {
	const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
	const count = Math.max(1, Math.floor(badgeCount));
	const text = lines.reduce((sum, kind) => sum + (COMPACT_LINE_PX[kind] ?? 16) * scale, 0);
	const gaps = Math.max(0, lines.length - 1) * CARD_LINE_GAP_PX;
	const stack = Math.max(0, padY) * 2 + text + gaps;
	const natural = 28 * scale;
	const slack = Math.max(0, count - 1) * 2;
	const fit = (stack - slack) / count;
	if (!Number.isFinite(fit) || fit <= 0) return Math.round(natural * 10) / 10;
	return Math.round(Math.min(natural, Math.max(8, fit)) * 10) / 10;
}

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
