/** Urgency band colors, low (band 0) to high (band 3). */
export type UrgencyColors = [string, string, string, string];

export const URGENCY_PALETTE_IDS = [
	'default',
	'pastel',
	'purple',
	'green',
	'blue',
	'pink',
	'color-blind',
	'sunset',
	'cotton-candy',
	'peach-blossom',
	'lavender-bloom',
	'ocean',
	'ember',
	'aurora',
	'accent',
	'custom',
] as const;

export type UrgencyPaletteId = (typeof URGENCY_PALETTE_IDS)[number];

export interface UrgencyPalette {
	id: Exclude<UrgencyPaletteId, 'custom'>;
	label: string;
	colors: UrgencyColors;
}

/**
 * Default urgency is a traffic light. Accent stays a separate preset for
 * links and chrome, and is not derived into these four bands.
 */
const DEFAULT_PALETTE: UrgencyPalette = {
	id: 'default',
	label: 'Traffic light',
	colors: ['#1f8a4c', '#d6a100', '#e06a00', '#d63c3c'],
};

export const URGENCY_PALETTES: readonly UrgencyPalette[] = [
	DEFAULT_PALETTE,
	{ id: 'pastel', label: 'Pastel traffic light', colors: ['#67a980', '#b59a3a', '#d08d58', '#da8484'] },
	{ id: 'purple', label: 'Pastel purple', colors: ['#a693c9', '#8d74bb', '#ab89f1', '#7852c9'] },
	{ id: 'green', label: 'Pastel green', colors: ['#72a883', '#518a65', '#5bac79', '#2e8d57'] },
	{ id: 'blue', label: 'Pastel blue', colors: ['#75a0cc', '#5b80ad', '#729edd', '#4c7dcc'] },
	{ id: 'pink', label: 'Pastel pink', colors: ['#c68ba7', '#aa6a87', '#e07ba8', '#ce5289'] },
	{ id: 'color-blind', label: 'Color-blind safe', colors: ['#46a5d9', '#a99f00', '#cf8f00', '#d55e00'] },
	{ id: 'sunset', label: 'Sunset', colors: ['#b29136', '#c3702a', '#cc4d3c', '#b73d6d'] },
	{ id: 'cotton-candy', label: 'Cotton Candy', colors: ['#14ac87', '#528fd3', '#9e62d1', '#cc2c77'] },
	{ id: 'peach-blossom', label: 'Peach Blossom', colors: ['#69a764', '#d27143', '#d74b65', '#cd2783'] },
	{ id: 'lavender-bloom', label: 'Lavender Bloom', colors: ['#58a0ca', '#8381e2', '#a55bda', '#cb2889'] },
	{ id: 'ocean', label: 'Ocean', colors: ['#00a79a', '#2e87e2', '#7360f2', '#cd2439'] },
	{ id: 'ember', label: 'Ember', colors: ['#bd8d00', '#ce6a00', '#db3e1f', '#cc2542'] },
	{ id: 'aurora', label: 'Aurora', colors: ['#00ab6a', '#0091b5', '#8859ed', '#c9167c'] },
	{
		id: 'accent',
		label: 'Theme accent',
		colors: [
			'color-mix(in srgb, var(--interactive-accent) 35%, var(--background-primary))',
			'color-mix(in srgb, var(--interactive-accent) 60%, var(--background-primary))',
			'color-mix(in srgb, var(--interactive-accent) 85%, var(--background-primary))',
			'var(--interactive-accent)',
		],
	},
];

export const URGENCY_LEVEL_LABELS: readonly string[] = ['Below 1', '1 to 2', '2 to 3', '3 and up'];

const HEX = /^#[0-9a-f]{6}$/i;

/** Traffic-light seed. Custom pickers and the default palette both start here. */
export function defaultUrgencyColors(): UrgencyColors {
	return ['#1f8a4c', '#d6a100', '#e06a00', '#d63c3c'];
}

/** Black or white ink so a digit or bang stays readable on an urgency fill. */
export function urgencyInk(color: string): string {
	const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
	if (!hex) {
		const mix = /(\d{1,3})%/.exec(color);
		if (mix && Number(mix[1]) < 55) return '#111111';
		return '#ffffff';
	}
	const value = Number.parseInt(hex[1] ?? '', 16);
	const red = (value >> 16) & 255;
	const green = (value >> 8) & 255;
	const blue = value & 255;
	const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
	return luminance > 0.62 ? '#111111' : '#ffffff';
}

export function sanitizeUrgencyPalette(value: unknown): UrgencyPaletteId {
	return typeof value === 'string' && (URGENCY_PALETTE_IDS as readonly string[]).includes(value)
		? value as UrgencyPaletteId
		: 'default';
}

/** Four `#rrggbb` colors. A missing or malformed level falls back to the default for that level. */
export function sanitizeUrgencyColors(value: unknown): UrgencyColors {
	const fallback = defaultUrgencyColors();
	if (!Array.isArray(value)) return fallback;
	return fallback.map((color, index) => {
		const raw: unknown = value[index];
		return typeof raw === 'string' && HEX.test(raw.trim()) ? raw.trim().toLowerCase() : color;
	}) as UrgencyColors;
}

export function urgencyColorsFor(palette: UrgencyPaletteId, custom: UrgencyColors): UrgencyColors {
	if (palette === 'custom') return [...custom];
	return [...paletteById(palette).colors];
}

/** Colors to seed the custom pickers with. The accent palette is not hex, so it seeds from the default. */
export function editableUrgencyColors(palette: UrgencyPaletteId, custom: UrgencyColors): UrgencyColors {
	const colors = urgencyColorsFor(palette, custom);
	return colors.every((color) => HEX.test(color)) ? colors : defaultUrgencyColors();
}

function paletteById(id: Exclude<UrgencyPaletteId, 'custom'>): UrgencyPalette {
	return URGENCY_PALETTES.find((palette) => palette.id === id) ?? DEFAULT_PALETTE;
}
