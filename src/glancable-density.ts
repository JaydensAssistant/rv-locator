/**
 * Default card width matches the old 680px two-column breakpoint
 * (34ch of meta text, today's horizontal padding, and the action rail).
 * A shorter line or a smaller font snaps to two columns in a narrower pane.
 */
const CARD_LINE_GAP_PX = 3;

/** Rendered height of one glancable line before the font scale, from styles.css. */
const COMPACT_LINE_PX: Record<CompactLineKind, number> = {
	name: 23,
	place: 17,
	dates: 17,
	foot: 17,
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
	if (!Number.isFinite(fit) || fit <= 0) return Math.round(natural);
	return Math.round(Math.min(natural, Math.max(8, fit)));
}

const DEFAULT_TEXT_CHARS = 34;
const CHAR_PX = 7.4;
const ACTION_RAIL_PX = 64;
const GRID_GAP_PX = 8;
/** Horizontal padding on `.rv-locator-glancable .rv-locator-scroll` (`6px 10px 10px`). */
export const GLANCE_SCROLL_PAD_X = 10;

/**
 * Scrollbar this element actually reserves (`offsetWidth - clientWidth`).
 * Overlay scrollbars are 0. A column split is not a scrollbar, so anything
 * past a real bar is ignored.
 */
export function elementScrollbarGutterPx(el: HTMLElement | null | undefined): number {
	if (!el) return 0;
	const outer = el.offsetWidth;
	const inner = el.clientWidth;
	if (!(outer > 1) || !(inner >= 0) || outer + 0.5 < inner) return 0;
	const bar = outer - inner;
	if (!(bar > 0) || bar > 40) return 0;
	return bar;
}

/**
 * Grid width the list uses. `leafPx` is the full leaf, as if no side map were
 * open. A classic scrollbar comes off, which is 400 in a 412px leaf with a
 * 12px bar. An overlay bar of 0 leaves the leaf unchanged, so 1236 stays 1236.
 */
export function glanceGridOuterPx(leafPx: number, scrollbarPx: number): number {
	if (!Number.isFinite(leafPx) || leafPx <= 1) return 0;
	const bar = Number.isFinite(scrollbarPx) && scrollbarPx > 0 ? scrollbarPx : 0;
	return Math.max(0, leafPx - bar);
}

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

/**
 * Width one list card gets from the glancable grid.
 * `containerPx` is the view width. Scroll padding and the column gap come off
 * before the columns share what's left, which is 400 in a 1236px leaf and 380
 * in a 400px one.
 */
export function glancableCardSlotPx(containerPx: number, settings: DensityMeasure, fitCount = 0): number {
	const columns = fitCount >= 2 ? fitCount : glancableColumns(containerPx, settings);
	const content = Math.max(0, containerPx - GLANCE_SCROLL_PAD_X * 2);
	const gaps = Math.max(0, columns - 1) * GRID_GAP_PX;
	if (columns < 1 || content <= 0) return estimatedGlancableCardPx(settings);
	return (content - gaps) / columns;
}

/**
 * One card width for the list, the base popup, and the note-map popup.
 * `leafPx` is the full leaf (fullscreen ignores a side map). `gutterPx` is the
 * scrollbar that leaf actually reserves.
 */
export function glancableCardWidthPx(leafPx: number, gutterPx: number, settings: DensityMeasure, fitCount = 0): number {
	return glancableCardSlotPx(glanceGridOuterPx(leafPx, gutterPx), settings, fitCount);
}

/** Column count that shares {@link glancableCardWidthPx}'s grid width. */
export function glancableCardColumns(leafPx: number, gutterPx: number, settings: DensityMeasure, fitCount = 0): number {
	const grid = glanceGridOuterPx(leafPx, gutterPx);
	return fitCount >= 2 ? fitCount : glancableColumns(grid, settings);
}

/** How many cards fit side by side. A wide pane is not capped at two. */
export function glancableColumns(containerPx: number, settings: DensityMeasure): number {
	if (!Number.isFinite(containerPx) || containerPx <= 0) return 1;
	const card = estimatedGlancableCardPx(settings);
	if (!Number.isFinite(card) || card <= 0) return 1;
	return Math.max(1, Math.floor((containerPx + GRID_GAP_PX) / (card + GRID_GAP_PX)));
}
