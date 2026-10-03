import type { Daypart } from './schedule';

export const SLOT_OVERRIDE_PROPERTY = 'Availability Override';

export interface SlotOverride {
	weekday: number;
	daypart: Daypart;
	bucket: 'try' | 'avoid';
}

const WEEKDAY: Record<string, number> = {
	sun: 0, sunday: 0,
	mon: 1, monday: 1,
	tue: 2, tues: 2, tuesday: 2,
	wed: 3, wednesday: 3,
	thu: 4, thur: 4, thurs: 4, thursday: 4,
	fri: 5, friday: 5,
	sat: 6, saturday: 6,
};

const DAYPART: Record<string, Daypart> = {
	morning: 'morning', mor: 'morning',
	afternoon: 'afternoon', aft: 'afternoon',
	evening: 'evening', eve: 'evening',
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function formatSlotOverride(override: SlotOverride): string {
	const day = WEEKDAY_SHORT[override.weekday] ?? 'Sun';
	const bucket = override.bucket === 'avoid' ? 'Avoid' : 'Try';
	return `${day} ${override.daypart}: ${bucket}`;
}

/** `Tue evening: Avoid` and the short daypart names. Unknown lines are dropped. */
export function parseSlotOverrides(value: unknown): SlotOverride[] {
	const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
	const seen = new Set<string>();
	const overrides: SlotOverride[] = [];
	for (const item of source) {
		const text = typeof item === 'string' ? item.trim() : '';
		const match = /^([A-Za-z]+)\s+([A-Za-z]+)\s*:\s*(try|avoid)$/i.exec(text);
		if (!match) continue;
		const weekday = WEEKDAY[(match[1] ?? '').toLowerCase()];
		const daypart = DAYPART[(match[2] ?? '').toLowerCase()];
		if (weekday == null || !daypart) continue;
		const bucket = (match[3] ?? '').toLowerCase() === 'avoid' ? 'avoid' : 'try';
		const key = `${weekday}:${daypart}`;
		if (seen.has(key)) continue;
		seen.add(key);
		overrides.push({ weekday, daypart, bucket });
	}
	return overrides;
}

export function upsertSlotOverride(current: readonly SlotOverride[], next: SlotOverride): SlotOverride[] {
	const rest = current.filter((item) => item.weekday !== next.weekday || item.daypart !== next.daypart);
	return [...rest, next];
}

export function removeSlotOverride(current: readonly SlotOverride[], weekday: number, daypart: Daypart): SlotOverride[] {
	return current.filter((item) => item.weekday !== weekday || item.daypart !== daypart);
}
