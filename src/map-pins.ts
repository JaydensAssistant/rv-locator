import { urgencyAccentColor, urgencyMark, urgencyScore, insidePriorityFloor } from './scoring';
import type { PriorityDays } from './types';

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
	card: MapPinCard;
}

/** Active RVs with coordinates. A pin inside its priority floor is marked fresh. */
export function buildMapPins(
	rows: readonly MapPinSource[],
	floors: PriorityDays,
	thresholds: PriorityDays,
	colors: readonly string[],
): MapPin[] {
	const pins: MapPin[] = [];
	for (const row of rows) {
		if (row.inactive || row.priority <= 0) continue;
		if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
		const urgency = urgencyScore(row.days, row.priority, thresholds);
		const mark = urgencyMark(urgency, row.priority);
		pins.push({
			path: row.path,
			name: row.name,
			lat: row.lat,
			lon: row.lon,
			priority: row.priority,
			urgency,
			days: row.days,
			color: urgencyAccentColor(urgency, row.priority, colors),
			glyph: mark.glyphs,
			fresh: row.days != null && insidePriorityFloor(row.days, row.priority, floors),
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
