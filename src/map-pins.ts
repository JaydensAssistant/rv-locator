import { DISTANCE_COLUMN_ID, IDEALITY_COLUMN_ID, URGENCY_COLUMN_ID } from './constants';
import { interpolatePalette, type MapShadeMode } from './map-shade';
import { SNOOZE_SLATE } from './snooze';
import { urgencyAccentColor, urgencyMark, urgencyScore, insidePriorityFloor } from './scoring';
import { sortRowsBy, type Sortable } from './sort';
import { statusIcon, type GenderFilter, type ReturnScope, type RvGender, type RvStatus } from './status';
import type { LatLon, PriorityDays } from './types';

/** Ghost pin while the return is inside its cool-down floor. Not the Last Attempted clock. */
export const COOLDOWN_PIN_ICON = 'hourglass';
/** Ghost pin when the current daypart is Avoid. Cooldown wins if both apply. */
export const AVOID_PIN_ICON = 'ban';
/** Snoozed pin. Slate moon, not the green urgency mark. */
export const SNOOZE_PIN_ICON = 'moon';

export type PinStateIcon = typeof COOLDOWN_PIN_ICON | typeof AVOID_PIN_ICON | typeof SNOOZE_PIN_ICON;

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
	/** Active snooze. The pin is slate with a moon, not the urgency mark. */
	snoozed?: boolean;
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
	/** Ghost icon. Null keeps the urgency mark. Cooldown's hourglass wins over Avoid's ban. A snooze is the moon. */
	stateIcon: PinStateIcon | null;
	/** Snooze paint. The moon is not a dashed ghost. */
	snoozed: boolean;
	/** Status icon when the hub is filtered by status. Null keeps the glyph. */
	shadeIcon: string | null;
	/** Gender mark when the hub is filtered to men or women. */
	markText: string | null;
	/**
	 * Place in the active hub sort. 0 is the top of the list and paints above
	 * a higher number where pins overlap.
	 */
	rank: number;
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
		const snoozed = row.snoozed === true;
		pins.push({
			path: row.path,
			name: row.name,
			lat: row.lat,
			lon: row.lon,
			priority: row.priority,
			urgency,
			days: row.days,
			color: snoozed ? SNOOZE_SLATE : urgencyAccentColor(urgency, row.priority, colors),
			glyph: mark.glyphs,
			fresh,
			stateIcon: snoozed ? SNOOZE_PIN_ICON : pinStateIcon(fresh, row.avoid === true),
			snoozed,
			shadeIcon: null,
			markText: null,
			rank: pins.length,
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

/**
 * Pin order is the card list. Rank is the index in that rendered array.
 * A card with no coordinates keeps its index so later pins stay below it.
 * A path with no pin, or a pin the list filtered out, is left out.
 */
export function rankPinsFromRenderedList<T extends { path: string; rank: number }>(pins: readonly T[], paths: readonly string[]): T[] {
	const byPath = new Map(pins.map((pin) => [pin.path, pin]));
	const ranked: T[] = [];
	paths.forEach((path, index) => {
		const pin = byPath.get(path);
		if (!pin) return;
		ranked.push({ ...pin, rank: index });
	});
	return ranked;
}

/** Right-edge control column and the bottom credit strip. Popup stays clear of both. */
export const MAP_CONTROL_INSET_PX = 8;
export const MAP_CONTROL_PX = 40;
export const MAP_CONTROL_GAP_PX = 8;
export const MAP_CREDIT_STRIP_PX = 14;

/** Visible map, in stage coordinates. A fullscreen stage can start above the window. */
export interface PopupViewport {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function popupClearOfChrome(
	anchor: { x: number; y: number },
	card: { width: number; height: number },
	stage: { width: number; height: number },
	visible?: PopupViewport,
): { left: number; top: number } {
	const view = visible ?? { left: 0, top: 0, width: stage.width, height: stage.height };
	const column = MAP_CONTROL_INSET_PX + MAP_CONTROL_PX + MAP_CONTROL_INSET_PX;
	const minLeft = view.left + 4;
	const minTop = view.top + 4;
	const limitRight = Math.max(minLeft + 1, Math.min(stage.width - column, view.left + view.width));
	const limitBottom = Math.max(minTop + 1, Math.min(stage.height - MAP_CREDIT_STRIP_PX, view.top + view.height));
	let left = anchor.x + 28;
	if (left + card.width > limitRight) left = anchor.x - 28 - card.width;
	if (left + card.width > limitRight) left = limitRight - card.width;
	if (left < minLeft) left = minLeft;
	if (left + card.width > limitRight) left = Math.max(minLeft, limitRight - card.width);
	const below = anchor.y + 18;
	const above = anchor.y - card.height - 12;
	let top = above >= minTop ? above : below;
	if (top + card.height > limitBottom) top = above >= minTop ? above : limitBottom - card.height;
	if (top + card.height > limitBottom) top = limitBottom - card.height;
	if (top < minTop) top = minTop;
	if (top + card.height > limitBottom) top = Math.max(minTop, limitBottom - card.height);
	return { left, top };
}

/**
 * Pins stack by urgency only. A hotter band paints above a cooler one.
 * A snoozed pin stays at the bottom, including inside a red cluster.
 * The number stays under the map controls (z-index 30).
 */
export function pinUrgencyZ(urgency: number | null, selected = false, snoozed = false): number {
	if (snoozed) return 0;
	const heat = urgency == null || !Number.isFinite(urgency) ? 0 : Math.max(0, Math.round(urgency * 10));
	const layer = Math.min(20, 1 + heat);
	return selected ? Math.min(24, layer + 4) : layer;
}

/** @deprecated Sort order no longer paints pins. Urgency does. */
export function pinStackZ(rank: number, selected = false): number {
	const place = Number.isFinite(rank) ? Math.max(0, Math.trunc(rank)) : 0;
	return selected ? 24 : Math.max(1, 8 - Math.min(place, 7));
}

export const STACK_GROUP_PX = 12;
/** A tap on the teardrop or its count badge. The badge sits above the tip. */
export const STACK_TAP_PX = 64;
export const STACK_DRAW_CAP = 5;

export interface StackMember {
	path: string;
	x: number;
	y: number;
	urgency: number | null;
	priority: number;
	/** A snoozed pin sorts under every awake pin in the same cluster. */
	snoozed?: boolean;
}

function hotter(a: StackMember, b: StackMember): number {
	const leftSnooze = a.snoozed === true ? 1 : 0;
	const rightSnooze = b.snoozed === true ? 1 : 0;
	if (leftSnooze !== rightSnooze) return leftSnooze - rightSnooze;
	const left = a.urgency ?? -1;
	const right = b.urgency ?? -1;
	if (left !== right) return right - left;
	return b.priority - a.priority;
}

/** Anchors within `px` of each other are one stack. The first member is the hottest. */
export function groupPinStacks<T extends StackMember>(placed: readonly T[], px = STACK_GROUP_PX): T[][] {
	const pending = [...placed];
	const groups: T[][] = [];
	while (pending.length > 0) {
		const seed = pending.shift();
		if (!seed) break;
		const group = [seed];
		let grew = true;
		while (grew) {
			grew = false;
			for (let index = pending.length - 1; index >= 0; index -= 1) {
				const item = pending[index];
				if (!item) continue;
				const near = group.some((member) => Math.hypot(member.x - item.x, member.y - item.y) <= px);
				if (!near) continue;
				group.push(item);
				pending.splice(index, 1);
				grew = true;
			}
		}
		group.sort(hotter);
		groups.push(group);
	}
	return groups;
}

export function stackCountLabel(total: number): string | null {
	if (total < 4) return null;
	return total > 99 ? '99+' : String(total);
}

/** Draw at most the five hottest pins. The count, when shown, sits on the top one. */
export function pinsToDraw<T extends StackMember>(group: readonly T[]): { drawn: T[]; label: string | null } {
	const ordered = [...group].sort(hotter);
	return { drawn: ordered.slice(0, STACK_DRAW_CAP), label: stackCountLabel(group.length) };
}

/** A tap at zoom 12 or below on a pin that overlaps another zooms in instead of opening. */
export function tapZoomsStack(zoom: number, overlaps: number): boolean {
	return zoom <= CLUSTER_ZOOM_MAX && overlaps > 1;
}

/** At a closer zoom the tap opens the hottest pin in the overlap, which is the top one. */
export function tapOpensTop(zoom: number, overlaps: number): boolean {
	return zoom > CLUSTER_ZOOM_MAX && overlaps > 1;
}

export interface PinSortFacts {
	name: string;
	lat: number;
	lon: number;
	priority: number;
	days: number | null;
	attemptedDays: number | null;
	metDays: number | null;
	city: string;
	ideality: number | null;
}

/**
 * Same order as the hub pills. Rank 0 is the first row. Distance uses the
 * live fix. Spoke, attempted, and met use days-ago so oldest and newest match.
 */
export function orderByHubSort<T extends PinSortFacts>(
	rows: readonly T[],
	sort: { property: string; direction: 'ASC' | 'DESC' },
	fix: LatLon | null,
	thresholds: PriorityDays,
): T[] {
	const wrapped = rows.map((row) => ({
		lat: Number.isFinite(row.lat) ? row.lat : null,
		lon: Number.isFinite(row.lon) ? row.lon : null,
		sortKeys: pinSortKeys(row, thresholds),
		row,
	}));
	return sortRowsBy(wrapped, [sort], fix, DISTANCE_COLUMN_ID).map((item) => item.row);
}

function pinSortKeys(row: PinSortFacts, thresholds: PriorityDays): Record<string, Sortable> {
	const urgency = urgencyScore(row.days, row.priority, thresholds);
	return {
		[URGENCY_COLUMN_ID]: numberKey(urgency),
		[IDEALITY_COLUMN_ID]: numberKey(row.ideality),
		'note.Priority': numberKey(row.priority),
		'note.Last Spoke': olderDateKey(row.days),
		'note.Last Attempted': olderDateKey(row.attemptedDays),
		'note.Met': olderDateKey(row.metDays),
		'note.City': row.city.trim() ? { kind: 'text', value: row.city.trim() } : { kind: 'empty' },
		'file.name': { kind: 'text', value: row.name },
	};
}

function numberKey(value: number | null): Sortable {
	if (value == null || !Number.isFinite(value)) return { kind: 'empty' };
	return { kind: 'number', value };
}

/** More days ago is an earlier date, so ascending puts the oldest first. */
function olderDateKey(days: number | null): Sortable {
	if (days == null || !Number.isFinite(days)) return { kind: 'empty' };
	return { kind: 'date', value: -days };
}

/** Clusters draw at this zoom and below. The next zoom paints each pin. */
export const CLUSTER_ZOOM_MAX = 12;
export const PIN_REVEAL_ZOOM = 13;

/** Zoom just far enough that a clustered pin is drawn on its own. */
export function zoomToRevealPin(zoom: number): number {
	if (zoom <= CLUSTER_ZOOM_MAX) return PIN_REVEAL_ZOOM;
	return zoom;
}

/**
 * Blank card body highlights a pin only while the hub map is open.
 * A control (title, address, badge, button, Quick Facts) never does.
 */
export function cardBlankOpensPin(mapOpen: boolean, onControl: boolean): boolean {
	return mapOpen && !onControl;
}

/** Clicks on these keep their own action and do not highlight a pin. */
export const CARD_BLANK_IGNORE = 'a, button, [role="link"], .rv-locator-place, .rv-locator-card-name, .rv-locator-when, .rv-locator-card-foot, .rv-locator-card-actions, .rv-locator-slot';

/** Movement under this many pixels is a tap, not a pan. */
export const MAP_CLICK_SLOP_PX = 5;

/** True when the pointer did not move far enough to count as a drag. */
export function mapPressIsClick(dx: number, dy: number, slop = MAP_CLICK_SLOP_PX): boolean {
	return dx * dx + dy * dy <= slop * slop;
}

/** Teardrop outline. The 1.5px inset keeps a 3px stroke inside the 42×54 box. */
export function dropPath(W = 42, H = 54, s = 1.5): string {
	const cx = W / 2;
	const cy = W / 2;
	const r = W / 2 - s;
	const d = (H - s) - cy;
	const phi = Math.acos(r / d);
	const lx = cx - r * Math.sin(phi);
	const rx = cx + r * Math.sin(phi);
	const y = cy + r * Math.cos(phi);
	const n = (value: number): string => String(Math.round(value * 100) / 100);
	return `M${n(cx)} ${n(H - s)} L${n(lx)} ${n(y)} A${n(r)} ${n(r)} 0 1 1 ${n(rx)} ${n(y)} Z`;
}

export function lonToTileX(lon: number, zoom: number): number {
	return ((lon + 180) / 360) * 2 ** zoom;
}

export function latToTileY(lat: number, zoom: number): number {
	const clamped = Math.max(-85, Math.min(85, lat));
	const rad = (clamped * Math.PI) / 180;
	return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** zoom;
}
