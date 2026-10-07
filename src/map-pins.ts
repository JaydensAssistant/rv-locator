import { interpolatePalette, type MapShadeMode } from './map-shade';
import { urgencyAccentColor, urgencyMark, urgencyScore, insidePriorityFloor } from './scoring';
import { statusIcon, type GenderFilter, type ReturnScope, type RvGender, type RvStatus } from './status';
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
	gender?: RvGender | null;
	status?: RvStatus;
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
	/** Glancable date rows: bold clock, muted calendar, urgency day count. */
	driveDates?: readonly { icon: string; dow: string; time: string; rest: string; days: string }[];
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
	/** Status icon when the hub is filtered by status. Null keeps the glyph. */
	shadeIcon: string | null;
	/** Gender mark when the hub is filtered to men or women. */
	markText: string | null;
	card: MapPinCard;
}

export type PinLook = 'urgency' | 'priority' | 'heat' | 'gender' | 'status';

/** Pin color follows the hub sort. A narrowed gender or status filter takes over. */
export function pinLookForHub(property: string, scope: ReturnScope, gender: GenderFilter): PinLook {
	if (gender === 'men' || gender === 'women') return 'gender';
	if (scope === 'studies' || scope === 'rvs' || scope === 'archive') return 'status';
	const key = property.trim().toLowerCase();
	if (key === 'note.priority') return 'priority';
	if (key === 'note.last spoke' || key === 'note.last attempted' || key === 'note.met' || key === 'note.city' || key === 'rv-locator.ideality') {
		return 'heat';
	}
	return 'urgency';
}

export function heatModeForSort(property: string): MapShadeMode {
	const key = property.trim().toLowerCase();
	if (key === 'note.priority') return 'priority';
	if (key === 'note.last spoke') return 'spoke';
	if (key === 'note.last attempted') return 'attempted';
	if (key === 'note.met') return 'met';
	if (key === 'note.city') return 'city';
	if (key === 'rv-locator.ideality') return 'ideality';
	return 'urgency';
}

/** Discrete priority colors sampled across the urgency palette. Not a continuous heat. */
export function priorityPinColor(priority: number, colors: readonly string[]): string {
	const rank = Math.max(1, Math.min(5, Math.round(priority)));
	return interpolatePalette((rank - 1) / 4, colors);
}

const STATUS_PIN_COLOR: Record<RvStatus, string> = {
	Active: '#1f8a4c',
	Study: '#4c7dcc',
	Inactive: '#8b8b8b',
};

/** Active RVs with coordinates. A pin inside its priority floor is marked fresh. */
export function buildMapPins(
	rows: readonly MapPinSource[],
	floors: PriorityDays,
	thresholds: PriorityDays,
	colors: readonly string[],
	shade: MapShadeMode | PinLook = 'urgency',
	includeInactive = false,
): MapPin[] {
	const look: PinLook = shade === 'urgency' || shade === 'priority' || shade === 'heat' || shade === 'gender' || shade === 'status'
		? shade
		: 'heat';
	const pins: MapPin[] = [];
	for (const row of rows) {
		if ((row.inactive || row.priority <= 0) && !includeInactive) continue;
		if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
		const urgency = urgencyScore(row.days, row.priority, thresholds);
		const mark = urgencyMark(urgency, row.priority);
		const fresh = row.days != null && insidePriorityFloor(row.days, row.priority, floors);
		const genderMark = row.gender === 'Woman' ? '♀' : '♂';
		const status = row.status ?? (row.inactive ? 'Inactive' : 'Active');
		pins.push({
			path: row.path,
			name: row.name,
			lat: row.lat,
			lon: row.lon,
			priority: row.priority,
			urgency,
			days: row.days,
			color: pinColor(look, row, urgency, colors, status),
			glyph: mark.glyphs,
			fresh,
			stateIcon: pinStateIcon(fresh, row.avoid === true),
			shadeIcon: look === 'status' ? statusIcon(status) : null,
			markText: look === 'gender' ? genderMark : null,
			card: row.card,
		});
	}
	return pins;
}

function pinColor(look: PinLook, row: MapPinSource, urgency: number | null, colors: readonly string[], status: RvStatus): string {
	if (look === 'gender') return row.gender === 'Woman' ? '#ec4899' : '#3b82f6';
	if (look === 'status') return STATUS_PIN_COLOR[status];
	if (look === 'priority') return priorityPinColor(row.priority, colors);
	if (look === 'urgency') return urgencyAccentColor(urgency, row.priority, colors);
	return interpolatePalette(row.shadeHeat ?? 0, colors);
}

export interface ClusterAppearance {
	/** Color of the most urgent pin. Priority breaks a tie. */
	color: string;
	/** Every pin in the cluster is a ghost (cooldown or avoid). */
	ghost: boolean;
}

/** Cluster chrome follows the hottest pin. A ghost cluster is only all ghosts. */
export function clusterAppearance(pins: readonly MapPin[]): ClusterAppearance {
	let best: MapPin | null = null;
	for (const pin of pins) {
		if (!best) {
			best = pin;
			continue;
		}
		const urgency = pin.urgency ?? -1;
		const bestUrgency = best.urgency ?? -1;
		if (urgency > bestUrgency || (urgency === bestUrgency && pin.priority > best.priority)) best = pin;
	}
	return {
		color: best?.color ?? '',
		ghost: pins.length > 0 && pins.every((pin) => pin.stateIcon != null),
	};
}

/** Movement under this many pixels is a tap, not a pan. */
export const MAP_CLICK_SLOP_PX = 5;

/** True when the pointer did not move far enough to count as a drag. */
export function mapPressIsClick(dx: number, dy: number, slop = MAP_CLICK_SLOP_PX): boolean {
	return dx * dx + dy * dy <= slop * slop;
}

export function lonToTileX(lon: number, zoom: number): number {
	return ((lon + 180) / 360) * 2 ** zoom;
}

export function latToTileY(lat: number, zoom: number): number {
	const clamped = Math.max(-85, Math.min(85, lat));
	const rad = (clamped * Math.PI) / 180;
	return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** zoom;
}
