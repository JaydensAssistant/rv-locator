import { urgencyBangShapes, type UrgencyBangShape } from './scoring';

/** Visible ink is this fraction of the badge diameter. One rule for every badge. */
export const BADGE_INK = 0.53;

/**
 * Lucide line icons sit in a 20px box on a 24px viewBox.
 * The SVG is drawn larger than the ink so the ink, not the viewBox, is {@link BADGE_INK}.
 */
export const LINE_ICON_INK = 20 / 24;

/** Cap height of a medium digit, as a fraction of the em square. Not the font box. */
export const DIGIT_CAP_INK = 0.72;

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
	if (maxX <= minX || maxY <= minY) return 0;
	return Math.max(maxX - minX, maxY - minY) / box;
}
