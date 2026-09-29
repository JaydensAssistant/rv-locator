/**
 * Return Suggestions callout color.
 *
 * The setting stores a color name. The note stores an Obsidian callout type.
 * Automatic reads the theme accent and picks the nearest type.
 *
 * Hue is degrees. Saturation and lightness are 0–100.
 * Bands are contiguous and cover the wheel. Dark red is the red hue with
 * lightness under 32, not a second hue. A missing accent falls back to
 * purple (`example`), which is the historical Return Suggestions color.
 *
 * - saturation < 12 → grey → `quote`
 * - hue ≤ 15 or ≥ 350, lightness < 32 → dark red → `danger`
 * - hue ≤ 15 or ≥ 350, lightness ≥ 32 → red → `failure`
 * - hue (15, 70] → yellow/orange → `warning`
 * - hue (70, 165] → green → `success`
 * - hue (165, 255] → blue → `info`
 * - hue (255, 315] → purple → `example`
 * - hue (315, 350) → red/purple → `bug`
 */

export interface AccentHsl {
	h: number;
	s: number;
	l: number;
}

export const SUGGESTION_COLOR_OPTIONS = [
	{ id: 'auto', label: 'Automatic (match accent)' },
	{ id: 'purple', label: 'Purple' },
	{ id: 'blue', label: 'Blue' },
	{ id: 'green', label: 'Green' },
	{ id: 'yellow', label: 'Yellow/Orange' },
	{ id: 'red', label: 'Red' },
	{ id: 'dark-red', label: 'Dark red' },
	{ id: 'red-purple', label: 'Red/purple' },
	{ id: 'grey', label: 'Grey' },
] as const;

export type SuggestionColorChoice = (typeof SUGGESTION_COLOR_OPTIONS)[number]['id'];

const CALLOUT_BY_COLOR: Record<Exclude<SuggestionColorChoice, 'auto'>, string> = {
	purple: 'example',
	blue: 'info',
	green: 'success',
	yellow: 'warning',
	red: 'failure',
	'dark-red': 'danger',
	'red-purple': 'bug',
	grey: 'quote',
};

const COLOR_IDS = new Set<string>(SUGGESTION_COLOR_OPTIONS.map((option) => option.id));

export function sanitizeSuggestionColor(value: unknown): SuggestionColorChoice {
	if (typeof value === 'string' && COLOR_IDS.has(value)) return value as SuggestionColorChoice;
	return 'auto';
}

/** A fixed color wins. Automatic uses the accent, or purple when the accent is missing. */
export function calloutTypeForChoice(choice: unknown, accent?: AccentHsl | null): string {
	const color = sanitizeSuggestionColor(choice);
	if (color === 'auto') return calloutTypeForAccent(accent);
	return CALLOUT_BY_COLOR[color];
}

export function calloutTypeForAccent(accent: AccentHsl | null | undefined): string {
	if (!accent || !Number.isFinite(accent.h) || !Number.isFinite(accent.s) || !Number.isFinite(accent.l)) {
		return 'example';
	}
	const saturation = clamp(accent.s, 0, 100);
	const lightness = clamp(accent.l, 0, 100);
	const hue = ((accent.h % 360) + 360) % 360;
	if (saturation < 12) return 'quote';
	const red = hue <= 15 || hue >= 350;
	if (red && lightness < 32) return 'danger';
	if (red) return 'failure';
	if (hue <= 70) return 'warning';
	if (hue <= 165) return 'success';
	if (hue <= 255) return 'info';
	if (hue <= 315) return 'example';
	return 'bug';
}

/**
 * Theme accent from `--accent-h`, `--accent-s`, and `--accent-l`.
 * Obsidian stores hue in degrees and the other two as percentages.
 * A value without `%` that is at most 1 is treated as a 0–1 fraction.
 */
export function readAccentHsl(style?: { getPropertyValue(name: string): string } | null): AccentHsl | null {
	const source = style === undefined ? accentStyle() : style;
	if (!source) return null;
	const hueRaw = source.getPropertyValue('--accent-h');
	const satRaw = source.getPropertyValue('--accent-s');
	const lightRaw = source.getPropertyValue('--accent-l');
	const h = parseHue(hueRaw);
	const s = parsePercent(satRaw);
	const l = parsePercent(lightRaw);
	if (h == null || s == null || l == null) return null;
	return { h, s, l };
}

/**
 * Decides when an accent change should recolor Return Suggestions on every note.
 * A new type has to be read twice in a row, so a half-loaded theme during
 * startup or a theme switch does not rewrite the vault. `applied` is the type
 * the notes were last written with; empty means unknown, which never rewrites.
 */
export class AccentDriftGate {
	private pending = '';

	constructor(public applied = '') {}

	/** True when `type` has settled on a value that differs from `applied`. */
	observe(type: string): boolean {
		if (!type || !this.applied || type === this.applied) {
			this.pending = '';
			return false;
		}
		if (this.pending !== type) {
			this.pending = type;
			return false;
		}
		this.pending = '';
		return true;
	}

	markApplied(type: string): void {
		this.applied = type;
		this.pending = '';
	}
}

function accentStyle(): { getPropertyValue(name: string): string } | null {
	if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
	return getComputedStyle(document.body);
}

function parseHue(raw: string): number | null {
	const text = raw.trim();
	if (!text) return null;
	const value = Number.parseFloat(text);
	return Number.isFinite(value) ? value : null;
}

function parsePercent(raw: string): number | null {
	const text = raw.trim();
	if (!text) return null;
	const value = Number.parseFloat(text);
	if (!Number.isFinite(value)) return null;
	if (!text.includes('%') && Math.abs(value) <= 1) return value * 100;
	return value;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
