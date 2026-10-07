import { interpolatePalette, type MapShadeMode } from './map-shade';
import { urgencyAccentColor, urgencyMark, urgencyScore, insidePriorityFloor } from './scoring';
import type { PriorityDays } from './types';

/** Ghost pin while the return is inside its cool-down floor. Not the Last Attempted clock. */
export const COOLDOWN_PIN_ICON = 'hourglass';
/** Ghost pin when the current daypart is Avoid. Cooldown wins if both apply. */
export const AVOID_PIN_ICON = 'ban';

export type PinStateIcon = typeof COOLDOWN_PIN_ICON | typeof AVOID_PIN_ICON;

/** Cooldown wins when the pin is both cooling down and in Avoid. */
export function pinStateIcon(cooldown: boolean, avoid: boolean): PinStateIcon | null {
	if (cooldown) return COOLDOWN_PIN_ICON;
	if (avoid) return AVOID_PIN_ICON;
	return null;
}

export interface MapPinSource {
	path: string;
	name: string;
	lat: number;
	lon: number;
	priority: number;
	/** Days since Last Spoke. Null when that date is missing. */
	days: number | null;
	/** Inactive notes are not pins. Study and Active are. */
	inactive: boolean;
	/** Current daypart is Avoid, before the cooldown-wins rule. */
	avoid?: boolean;
	/** 0–1 heat used when the map is not shaded by urgency bands. */
	shadeHeat?: number;
	card: MapPinCard;
}

/** Facts the pin popup shares with the list card and Quick Facts. */
export interface MapPinCard {
	address: string;
	city: string;
	study: boolean;
	spoke: string;
	attempted: string;
	studied: string;
	met: string;
	metWith: string;
	visits: string;
	studyRatio: string;
	literature: string;
	media: string;
	lessons: readonly string[];
}

export interface MapPin {
	path: string;
	name: string;
	lat: number;
	lon: number;
	priority: number;
	urgency: number | null;
	days: number | null;
	color: string;
	glyph: string;
	/** Inside the priority floor: same size, ghost fill, dotted urgency ring. */
	fresh: boolean;
	/** Ghost icon. Null keeps the urgency mark. Cooldown's hourglass wins over Avoid's ban. */
	stateIcon: PinStateIcon | null;
	card: MapPinCard;
}

/** Active RVs with coordinates. A pin inside its priority floor is marked fresh. */
export function buildMapPins(
	rows: readonly MapPinSource[],
	floors: PriorityDays,
	thresholds: PriorityDays,
	colors: readonly string[],
	shade: MapShadeMode = 'urgency',
): MapPin[] {
	const pins: MapPin[] = [];
	for (const row of rows) {
		if (row.inactive || row.priority <= 0) continue;
		if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
		const urgency = urgencyScore(row.days, row.priority, thresholds);
		const mark = urgencyMark(urgency, row.priority);
		const fresh = row.days != null && insidePriorityFloor(row.days, row.priority, floors);
		pins.push({
			path: row.path,
			name: row.name,
			lat: row.lat,
			lon: row.lon,
			priority: row.priority,
			urgency,
			days: row.days,
			color: shade === 'urgency'
				? urgencyAccentColor(urgency, row.priority, colors)
				: interpolatePalette(row.shadeHeat ?? 0, colors),
			glyph: mark.glyphs,
			fresh,
			stateIcon: pinStateIcon(fresh, row.avoid === true),
			card: row.card,
		});
	}
	return pins;
}

export function lonToTileX(lon: number, zoom: number): number {
	return ((lon + 180) / 360) * 2 ** zoom;
}

export function latToTileY(lat: number, zoom: number): number {
	const clamped = Math.max(-85, Math.min(85, lat));
	const rad = (clamped * Math.PI) / 180;
	return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** zoom;
}
