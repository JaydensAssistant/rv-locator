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
 * Default urgency colors follow the accent, in three wider steps than the
 * five logging buttons (those step lightness by about 0.06).
 */
const ACCENT_URGENCY: UrgencyColors = [
	'color-mix(in srgb, var(--interactive-accent) 22%, var(--background-primary))',
	'color-mix(in srgb, var(--interactive-accent) 48%, var(--background-primary))',
	'color-mix(in srgb, var(--interactive-accent) 78%, var(--background-primary))',
	'var(--interactive-accent)',
];

const DEFAULT_PALETTE: UrgencyPalette = {
	id: 'default',
	label: 'Accent (default)',
	colors: ACCENT_URGENCY,
};

export const URGENCY_PALETTES: readonly UrgencyPalette[] = [
	DEFAULT_PALETTE,
	{ id: 'pastel', label: 'Pastel traffic light', colors: ['#8fd3a8', '#f3d77a', '#f5b07a', '#f29a9a'] },
	{ id: 'purple', label: 'Pastel purple', colors: ['#d4c6f1', '#b59ce6', '#9673d9', '#7650c7'] },
	{ id: 'green', label: 'Pastel green', colors: ['#c3e8cd', '#98d4ab', '#6cbd89', '#43a068'] },
	{ id: 'blue', label: 'Pastel blue', colors: ['#c5dcf4', '#9cc1ec', '#739fdf', '#4c7dcc'] },
	{ id: 'pink', label: 'Pastel pink', colors: ['#f6cfe0', '#efa9c8', '#e680ad', '#d5588f'] },
	{ id: 'color-blind', label: 'Color-blind safe', colors: ['#56b4e9', '#f0e442', '#e69f00', '#d55e00'] },
	{ id: 'sunset', label: 'Sunset', colors: ['#f9d77e', '#f59e5b', '#e3624f', '#b43a6b'] },
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

/** Hex seed for the custom pickers. The default palette itself is the accent mix. */
export function defaultUrgencyColors(): UrgencyColors {
	return ['#1f8a4c', '#d6a100', '#e06a00', '#d63c3c'];
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
