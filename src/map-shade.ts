/** Card-list sorts that can color the map. Nearness is omitted on purpose. */
export const MAP_SHADE_MODES = ['urgency', 'ideality', 'priority', 'spoke', 'attempted', 'met', 'city'] as const;

export type MapShadeMode = (typeof MAP_SHADE_MODES)[number];

export function sanitizeMapShade(value: unknown): MapShadeMode {
	return MAP_SHADE_MODES.includes(value as MapShadeMode) ? value as MapShadeMode : 'urgency';
}

export interface ShadeRow {
	priority: number;
	spokeDays: number | null;
	attemptedDays: number | null;
	metDays: number | null;
	city: string;
	ideality: number | null;
}

/** 0 is the cool end of the palette, 1 is the hot end. Urgency keeps its own bands. */
export function shadeHeats(mode: MapShadeMode, rows: readonly ShadeRow[]): number[] {
	if (mode === 'urgency' || rows.length === 0) return rows.map(() => 0);
	if (mode === 'city') return cityHeats(rows.map((row) => row.city));
	const raw = rows.map((row) => shadeRaw(mode, row));
	const numbers = raw.filter((value): value is number => value != null && Number.isFinite(value));
	if (numbers.length === 0) return rows.map(() => 0);
	const min = Math.min(...numbers);
	const max = Math.max(...numbers);
	return raw.map((value) => {
		if (value == null || !Number.isFinite(value) || max <= min) return 0;
		return (value - min) / (max - min);
	});
}

function shadeRaw(mode: MapShadeMode, row: ShadeRow): number | null {
	if (mode === 'priority') return row.priority;
	if (mode === 'spoke') return row.spokeDays;
	if (mode === 'attempted') return row.attemptedDays;
	if (mode === 'met') return row.metDays;
	if (mode === 'ideality') return row.ideality;
	return null;
}

function cityHeats(cities: readonly string[]): number[] {
	const names = [...new Set(cities.map((city) => city.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
	if (names.length <= 1) return cities.map(() => 0);
	return cities.map((city) => {
		const index = names.indexOf(city.trim());
		if (index < 0) return 0;
		return index / (names.length - 1);
	});
}

/** Walk the urgency palette. `t` 0 is the first color, 1 is the last. */
export function interpolatePalette(t: number, colors: readonly string[]): string {
	if (colors.length === 0) return '#888888';
	const first = colors[0] ?? '#888888';
	if (colors.length === 1) return first;
	const clamped = Math.max(0, Math.min(1, t));
	const scaled = clamped * (colors.length - 1);
	const index = Math.min(colors.length - 2, Math.floor(scaled));
	const local = scaled - index;
	return mixHex(colors[index] ?? first, colors[index + 1] ?? first, local);
}

function mixHex(from: string, to: string, t: number): string {
	const left = hexRgb(from);
	const right = hexRgb(to);
	if (!left || !right) return from;
	const channel = (index: number) => Math.round((left[index] ?? 0) + ((right[index] ?? 0) - (left[index] ?? 0)) * t);
	return `#${[channel(0), channel(1), channel(2)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function hexRgb(value: string): [number, number, number] | null {
	const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
	if (!match) return null;
	const hex = match[1] ?? '';
	return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}
