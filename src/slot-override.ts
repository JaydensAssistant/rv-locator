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

/**
 * Stored without a colon. `Tue evening: Avoid` is a YAML mapping (`key: value`),
 * so a saved mark came back as an object and the suggestion line ignored it.
 */
export function formatSlotOverride(override: SlotOverride): string {
	const day = WEEKDAY_SHORT[override.weekday] ?? 'Sun';
	const bucket = override.bucket === 'avoid' ? 'Avoid' : 'Try';
	return `${day} ${override.daypart} ${bucket}`;
}

const SLOT_MARK = /^([A-Za-z]+)\s+([A-Za-z]+)\s*(?::\s*|\s+)(try|avoid)$/i;

/** `Tue evening Avoid`, the older `Tue evening: Avoid`, and a YAML map of those. */
export function parseSlotOverrides(value: unknown): SlotOverride[] {
	const seen = new Set<string>();
	const overrides: SlotOverride[] = [];
	for (const text of overrideLines(value)) {
		const match = SLOT_MARK.exec(text.trim());
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

function overrideLines(value: unknown): string[] {
	if (typeof value === 'string') {
		const text = value.trim();
		return text ? [text] : [];
	}
	if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
	if (Array.isArray(value)) return value.flatMap((item) => overrideLines(item));
	if (value && typeof value === 'object') {
		const lines: string[] = [];
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			if (typeof item === 'string' || typeof item === 'number') lines.push(`${key} ${item}`.trim());
			else for (const nested of overrideLines(item)) lines.push(`${key} ${nested}`.trim());
		}
		return lines;
	}
	return [];
}

export function upsertSlotOverride(current: readonly SlotOverride[], next: SlotOverride): SlotOverride[] {
	const rest = current.filter((item) => item.weekday !== next.weekday || item.daypart !== next.daypart);
	return [...rest, next];
}

export function removeSlotOverride(current: readonly SlotOverride[], weekday: number, daypart: Daypart): SlotOverride[] {
	return current.filter((item) => item.weekday !== weekday || item.daypart !== daypart);
}
