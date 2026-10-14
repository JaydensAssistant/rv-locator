import { urgencyBangShapes, type UrgencyBangShape } from './scoring';

/** Visible ink is this fraction of the badge diameter. One rule for every badge. */
export const BADGE_INK = 0.53;

/**
 * Lucide line icons are not one content box on the 24px viewBox.
 * Moon is drawn in 20px. Route, hourglass, and ban use 22px.
 * {@link LINE_ICON_INK} stays the moon box. The SVG is drawn larger than that
 * box so the ink, not the viewBox, is {@link BADGE_INK}.
 */
export const LINE_ICON_INK = 20 / 24;

/** Ink box of each Lucide badge icon, as a fraction of its 24px viewBox. */
export const LINE_ICON_INK_BY_ICON = {
	moon: 20 / 24,
	route: 22 / 24,
	hourglass: 22 / 24,
	ban: 22 / 24,
} as const;

/** Cap height of a medium digit, as a fraction of the em square. Not the font box. */
export const DIGIT_CAP_INK = 0.72;

/**
 * Optical correction on top of {@link BADGE_INK}. 1 is equal ink.
 * Dense or solid marks sit under 1. Open or thin line icons sit over 1.
 * Tune this table; the matching `--rv-opt-*` defaults in styles.css must stay in step.
 */
export const BADGE_OPTICAL = {
	digit: 0.92,
	bang: 0.94,
	ring: 1.06,
	dash: 0.94,
	route: 1.08,
	moon: 1.08,
	hourglass: 1.1,
	ban: 1.06,
} as const;

export type BadgeOpticalKey = keyof typeof BADGE_OPTICAL;

const LINE_ICON_KEYS = ['route', 'moon', 'hourglass', 'ban'] as const;
export type BadgeLineIcon = (typeof LINE_ICON_KEYS)[number];

/** Lucide badge icons that take an optical factor. Anything else stays at equal ink. */
export function badgeLineOpticalKey(icon: string): BadgeLineIcon | null {
	return (LINE_ICON_KEYS as readonly string[]).includes(icon) ? icon as BadgeLineIcon : null;
}

/** Which optical factor sizes this urgency mark. Bangs are the filled urgency glyph. */
export function urgencyOpticalKey(glyphs: string): 'bang' | 'ring' | 'dash' {
	if (glyphs === '○') return 'ring';
	if (glyphs === '—' || glyphs === '-') return 'dash';
	return 'bang';
}

const BADGE_BOX = 28;

/** How much of the 28 viewBox the drawn ink actually covers. */
export function urgencyInkFraction(glyphs: string): number {
	return shapeInkFraction(urgencyBangShapes(glyphs));
}

export function shapeInkFraction(shapes: readonly UrgencyBangShape[], box = BADGE_BOX): number {
	let minX = box;
	let minY = box;
	let maxX = 0;
	let maxY = 0;
	for (const shape of shapes) {
		if (shape.kind === 'rect') {
			const x = Number(shape.attr.x);
			const y = Number(shape.attr.y);
			const width = Number(shape.attr.width);
			const height = Number(shape.attr.height);
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x + width);
			maxY = Math.max(maxY, y + height);
		} else if (shape.kind === 'line') {
			const x1 = Number(shape.attr.x1);
			const y1 = Number(shape.attr.y1);
			const x2 = Number(shape.attr.x2);
			const y2 = Number(shape.attr.y2);
			minX = Math.min(minX, x1, x2);
			minY = Math.min(minY, y1, y2);
			maxX = Math.max(maxX, x1, x2);
			maxY = Math.max(maxY, y1, y2);
		} else {
			const cx = Number(shape.attr.cx);
			const cy = Number(shape.attr.cy);
			const radius = Number(shape.attr.r);
			const stroke = Number(shape.attr['stroke-width'] ?? 0);
			const outer = radius + stroke / 2;
			minX = Math.min(minX, cx - outer);
			minY = Math.min(minY, cy - outer);
			maxX = Math.max(maxX, cx + outer);
			maxY = Math.max(maxY, cy + outer);
		}
	}
	if (maxX < minX || maxY < minY) return 0;
	return Math.max(maxX - minX, maxY - minY) / box;
}
