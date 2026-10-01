import {
	BooleanValue,
	DateValue,
	ListValue,
	NullValue,
	NumberValue,
	StringValue,
	parsePropertyId,
	type BasesEntry,
	type BasesPropertyId,
	type BasesQueryResult,
	type TFile,
	type Value,
} from 'obsidian';
import { ACTIVE_SORT, matchesNearbyScope, parsePriority, resolveNearbyOrder, visiblePropertyText, type NearbyScope } from './active-layout';
import { matchesGenderFilter, matchesReturnScope, resolveStatus, sanitizeGender, type GenderFilter, type ReturnScope, type RvGender, type RvStatus } from './status';
import { DISTANCE_COLUMN_ID } from './constants';
import {
	calendarDaysSince,
	formatDriveDate,
	formatShortDate,
	isBooleanWord,
	isWeekdayProperty,
	parseFlexibleDate,
	showsElapsedDays,
} from './dates';
import { displayCity, parseDisplayAddress } from './address-display';
import { CITY_PROPERTY } from './frontmatter';
import { latLonFromUnknown, roundCoord } from './distance';
import type { RVLocatorSettings } from './types';
import type { Sortable } from './sort';

export interface ColumnModel {
	id: string;
	name: string;
	displayName: string;
	isDistance: boolean;
	isFileName: boolean;
	/** Last Spoke, Met, and the other configured datetime properties. Never a checkbox. */
	isDate: boolean;
	weekday: boolean;
}

export interface CellModel {
	id: string;
	text: string;
	title: string;
	kind: 'file' | 'url' | 'text' | 'empty';
	numeric: boolean;
	dow?: string;
	/** Calendar date, such as `Sep 9, 2026`. Smaller and not bold. */
	rest?: string;
	/** Rounded hour label, such as `2pm`. Bold with the weekday. */
	time?: string;
	/** Calendar days since Last Spoke, Last Attempted, or Met. Omitted when there is no date. */
	daysSince?: number;
	/** List items in note order. Glancable shows the last two for Taken. */
	parts?: string[];
}

export interface RowModel {
	path: string;
	name: string;
	lat: number | null;
	lon: number | null;
	addressText: string;
	/** Street line for display. Null when the stored address does not parse. */
	addressStreet: string | null;
	/** City for display, same row as Distance. Null when the stored address does not parse. */
	addressCity: string | null;
	status: RvStatus;
	gender: RvGender | null;
	cells: CellModel[];
	sortKeys: Record<string, Sortable>;
}

export interface GroupModel {
	label: string | null;
	rows: RowModel[];
}

export interface ViewModel {
	columns: ColumnModel[];
	groups: GroupModel[];
}

export function buildViewModel(args: {
	result: BasesQueryResult;
	order: BasesPropertyId[];
	allProperties: BasesPropertyId[];
	displayName: (id: BasesPropertyId) => string;
	settings: RVLocatorSettings;
	mode: 'vanilla' | 'glancable';
	/** Active, All, or Inactive. Does not write the Base file. */
	scope: NearbyScope;
	/** In-view cycle. When set, it replaces the Active / All / Inactive priority test. */
	returnScope?: ReturnScope;
	genderFilter?: GenderFilter;
	/**
	 * Frontmatter fallback when Bases has not materialized a property
	 * (a bare view order often only asks for the file name).
	 */
	noteValue?: (file: TFile, propertyName: string) => unknown;
}): ViewModel {
	const weekdayNames = args.settings.datePropertiesForWeekday;
	const resolved = resolveNearbyOrder(args.order, args.allProperties);
	const order = resolved.filter((id) => id.toLowerCase() !== 'note.taken');
	const columns = order.flatMap((id) => {
		try {
			return [columnFromId(id, args.displayName, args.mode, weekdayNames)];
		} catch {
			return [];
		}
	});

	const locationId = resolveNoteProperty(args.settings.locationProperty, args.allProperties);
	const addressId = resolveNoteProperty(args.settings.addressProperty, args.allProperties);
	const cityId = resolveNoteProperty(CITY_PROPERTY, args.allProperties);
	const groups = readGroups(args.result).flatMap((group) => {
		const rows = group.entries
			.filter((entry) => entryMatchesScope(entry, args.scope, args.noteValue, args.returnScope, args.genderFilter))
			.map((entry) => rowFromEntry(entry, columns, args.settings, locationId, addressId, cityId, args.noteValue));
		if (rows.length === 0) return [];
		return [{ label: group.label, rows }];
	});

	return { columns, groups };
}

function columnFromId(
	id: string,
	displayName: (id: BasesPropertyId) => string,
	mode: 'vanilla' | 'glancable',
	weekdayNames: readonly string[],
): ColumnModel {
	if (id === DISTANCE_COLUMN_ID) {
		return {
			id,
			name: 'Distance',
			displayName: 'Distance',
			isDistance: true,
			isFileName: false,
			isDate: false,
			weekday: false,
		};
	}
	const propertyId = id as BasesPropertyId;
	const parsed = parsePropertyId(propertyId);
	const label = safeDisplayName(displayName, propertyId, parsed.name);
	const isDate = parsed.type === 'note' && isWeekdayProperty(parsed.name, label, weekdayNames);
	return {
		id,
		name: parsed.name,
		displayName: label,
		isDistance: false,
		isFileName: parsed.type === 'file' && (parsed.name === 'name' || parsed.name === 'basename'),
		isDate,
		weekday: mode === 'glancable' && isDate,
	};
}

function entryMatchesScope(
	entry: BasesEntry,
	scope: NearbyScope,
	noteValue: NoteValueReader | undefined,
	returnScope?: ReturnScope,
	genderFilter?: GenderFilter,
): boolean {
	const priority = priorityOf(mergedValue(entry, 'note.Priority', noteValue));
	const hub = {
		folder: folderOf(entry),
		priority,
		hubTexts: textsOf(mergedValue(entry, 'note.Hub', noteValue)),
	};
	if (!matchesNearbyScope('all', hub)) return false;
	if (returnScope) {
		const status = noteValue?.(entry.file, 'Status');
		const gender = noteValue?.(entry.file, 'Gender');
		return matchesReturnScope(returnScope, status, priority) && matchesGenderFilter(genderFilter ?? 'all', gender);
	}
	return matchesNearbyScope(scope, hub);
}

function folderOf(entry: BasesEntry): string {
	const fromProperty = safeString(safeGet(entry, 'file.folder')).trim();
	if (fromProperty) return fromProperty;
	return entry.file.parent?.path ?? '';
}

function priorityOf(value: Value | null): number | null {
	if (!value || isBlank(value) || value instanceof BooleanValue) return null;
	if (value instanceof NumberValue) return parsePriority(Number(value.toString()));
	return parsePriority(safeString(value));
}

function textsOf(value: Value | null): string[] {
	if (!value || isBlank(value)) return [];
	if (value instanceof ListValue) {
		const out: string[] = [];
		const count = value.length();
		for (let index = 0; index < count; index += 1) {
			out.push(...textsOf(value.get(index)));
		}
		return out;
	}
	const text = safeString(value).trim();
	return text ? [text] : [];
}

function readGroups(result: BasesQueryResult): { label: string | null; entries: BasesEntry[] }[] {
	const grouped = result.groupedData;
	if (!grouped || grouped.length === 0) {
		return [{ label: null, entries: result.data ?? [] }];
	}
	return grouped.map((group) => {
		const labeled = group.hasKey() && group.key ? group.key.toString().trim() : '';
		return {
			label: labeled || null,
			entries: group.entries ?? [],
		};
	});
}

function resolveNoteProperty(name: string, allProperties: readonly BasesPropertyId[]): BasesPropertyId {
	const wanted = name.trim().toLowerCase();
	const found = allProperties.find((id) => {
		const parsed = parsePropertyId(id);
		return parsed.type === 'note' && parsed.name.toLowerCase() === wanted;
	});
	return found ?? noteId(name);
}

type NoteValueReader = (file: TFile, propertyName: string) => unknown;

function rowFromEntry(
	entry: BasesEntry,
	columns: ColumnModel[],
	settings: RVLocatorSettings,
	locationId: BasesPropertyId,
	addressId: BasesPropertyId,
	cityId: BasesPropertyId,
	noteValue: NoteValueReader | undefined,
): RowModel {
	const coords = latLonFromBasesValue(mergedValue(entry, locationId, noteValue))
		?? latLonFromUnknown(noteValue?.(entry.file, settings.locationProperty));
	const addressValue = mergedValue(entry, addressId, noteValue);
	const addressText = displayText(addressValue).text;
	const displayAddress = parseDisplayAddress(addressText);
	const storedCity = displayText(mergedValue(entry, cityId, noteValue)).text;
	const cells: CellModel[] = [];
	const sortKeys: Record<string, Sortable> = {};

	for (const column of columns) {
		if (column.isDistance) continue;
		const value = mergedValue(entry, column.id as BasesPropertyId, noteValue);
		const cell = cellFromValue(entry, column, value, settings);
		cells.push(cell);
		sortKeys[column.id] = sortableFromValue(value, cell, column.isDate);
	}

	for (const sort of ACTIVE_SORT) {
		if (sortKeys[sort.property]) continue;
		const value = mergedValue(entry, sort.property as BasesPropertyId, noteValue);
		const datetime = columns.some((column) => column.id === sort.property && column.isDate)
			|| isConfiguredDateId(sort.property, settings);
		sortKeys[sort.property] = sortableFromValue(value, null, datetime);
	}
	if (!sortKeys['note.City']) {
		const city = displayCity(storedCity, addressText);
		sortKeys['note.City'] = city ? { kind: 'text', value: city } : { kind: 'empty' };
	}

	return {
		path: entry.file.path,
		name: entry.file.basename || entry.file.name,
		lat: coords?.lat ?? null,
		lon: coords?.lon ?? null,
		addressText,
		addressStreet: displayAddress?.street ?? null,
		addressCity: displayCity(storedCity, addressText),
		status: resolveStatus(noteValue?.(entry.file, 'Status'), priorityOf(mergedValue(entry, 'note.Priority', noteValue))),
		gender: sanitizeGender(noteValue?.(entry.file, 'Gender')),
		cells,
		sortKeys,
	};
}

function cellFromValue(entry: BasesEntry, column: ColumnModel, value: Value | null, settings: RVLocatorSettings): CellModel {
	if (column.isFileName) {
		const name = entry.file.basename || entry.file.name;
		return {
			id: column.id,
			text: name,
			title: name,
			kind: 'file',
			numeric: false,
		};
	}

	// Met and Last Spoke are datetimes. A missing value still renders as an em dash.
	if (column.isDate) {
		const shown = value && !isBlank(value) ? displayText(value).text : '';
		return dateCell(column, value, shown);
	}

	if (isBlank(value)) {
		return { id: column.id, text: '', title: '', kind: 'empty', numeric: false };
	}

	const parsed = parsePropertyId(column.id as BasesPropertyId);
	if (parsed.type === 'note' && parsed.name.toLowerCase() === settings.locationProperty.trim().toLowerCase()) {
		const coords = latLonFromBasesValue(value);
		if (coords) {
			const text = `${roundCoord(coords.lat)}, ${roundCoord(coords.lon)}`;
			return { id: column.id, text, title: text, kind: 'text', numeric: false };
		}
	}

	const shown = displayText(value);
	if (!shown.text) {
		return { id: column.id, text: '', title: '', kind: 'empty', numeric: false };
	}

	if (parsed.name.toLowerCase() === 'priority') {
		const priority = parsePriority(value instanceof NumberValue ? Number(value.toString()) : shown.text);
		if (priority == null) {
			return { id: column.id, text: shown.text, title: shown.text, kind: 'text', numeric: false };
		}
		const text = Number.isInteger(priority) ? String(priority) : String(priority);
		return { id: column.id, text, title: text, kind: 'text', numeric: true };
	}

	if (isHttpUrl(shown.text)) {
		return { id: column.id, text: shown.text, title: shown.text, kind: 'url', numeric: false };
	}

	const date = dateFromBasesValue(value) ?? parseFlexibleDate(shown.text);
	if (date && (value instanceof DateValue || looksLikeDateOnly(shown.text))) {
		const text = formatShortDate(date);
		return { id: column.id, text, title: text, kind: 'text', numeric: false };
	}

	const numeric = value instanceof NumberValue || /^-?\d+(?:\.\d+)?$/.test(shown.text);
	const parts = listParts(value);
	return {
		id: column.id,
		text: shown.text,
		title: shown.text,
		kind: 'text',
		numeric,
		...(parts ? { parts } : {}),
	};
}

function listParts(value: Value | null): string[] | undefined {
	if (!(value instanceof ListValue)) return undefined;
	const parts: string[] = [];
	const count = value.length();
	for (let index = 0; index < count; index += 1) {
		const text = visiblePropertyText(safeString(value.get(index)));
		if (text) parts.push(text);
	}
	return parts;
}

function dateCell(column: ColumnModel, value: Value | null, shown: string): CellModel {
	if (value instanceof BooleanValue || isBooleanWord(shown)) return emptyDateCell(column.id);
	const display = formatDriveDate(shown);
	if (!display.empty) return driveCell(column, display, display.title, shown);
	const fromValue = value && !isBlank(value) ? dateFromBasesValue(value) : null;
	if (fromValue) {
		const iso = `${fromValue.getFullYear()}-${String(fromValue.getMonth() + 1).padStart(2, '0')}-${String(fromValue.getDate()).padStart(2, '0')}`;
		const fallback = formatDriveDate(iso);
		if (!fallback.empty) return driveCell(column, fallback, shown.trim() || fallback.text, iso);
	}
	return emptyDateCell(column.id);
}

function driveCell(column: ColumnModel, display: ReturnType<typeof formatDriveDate>, title: string, raw: string): CellModel {
	const cell: CellModel = {
		id: column.id,
		text: display.text,
		title,
		kind: 'text',
		numeric: false,
		dow: display.dow,
		rest: display.rest,
		time: display.time,
	};
	if (isElapsedColumn(column)) {
		const days = calendarDaysSince(raw);
		if (days != null) cell.daysSince = days;
	}
	return cell;
}

function isElapsedColumn(column: ColumnModel): boolean {
	return showsElapsedDays(column.name, column.displayName);
}

function emptyDateCell(id: string): CellModel {
	return { id, text: '—', title: 'No date', kind: 'empty', numeric: false };
}

function isConfiguredDateId(propertyId: string, settings: RVLocatorSettings): boolean {
	try {
		const parsed = parsePropertyId(propertyId as BasesPropertyId);
		return parsed.type === 'note' && isWeekdayProperty(parsed.name, parsed.name, settings.datePropertiesForWeekday);
	} catch {
		return false;
	}
}

function sortableFromValue(value: Value | null, cell: CellModel | null, datetime: boolean): Sortable {
	if (isBlank(value) || cell?.kind === 'empty') return { kind: 'empty' };
	if (datetime && (value instanceof BooleanValue || isBooleanWord(safeString(value)))) return { kind: 'empty' };
	if (!datetime && value instanceof ListValue && cell == null) {
		return { kind: 'number', value: value.length() };
	}
	const raw = safeString(value).trim();
	const date = dateFromBasesValue(value) ?? parseFlexibleDate(raw) ?? (cell?.text ? parseFlexibleDate(cell.text) : null);
	if (date && (datetime || value instanceof DateValue || looksLikeDateOnly(raw))) return { kind: 'date', value: date.getTime() };
	if (value instanceof NumberValue) {
		const parsed = Number(value.toString());
		if (Number.isFinite(parsed)) return { kind: 'number', value: parsed };
	}
	const text = cell?.text?.trim() || raw;
	if (/^-?\d+(?:\.\d+)?$/.test(text)) return { kind: 'number', value: Number(text) };
	return { kind: 'text', value: text };
}

function displayText(value: Value | null): { text: string } {
	if (!value || isBlank(value)) return { text: '' };
	if (value instanceof ListValue) {
		const parts: string[] = [];
		const count = value.length();
		for (let index = 0; index < count; index += 1) {
			const item = value.get(index);
			const text = visiblePropertyText(safeString(item));
			if (text) parts.push(text);
		}
		return { text: parts.join(', ') };
	}
	return { text: visiblePropertyText(safeString(value)) };
}

export function latLonFromBasesValue(value: Value | null): { lat: number; lon: number } | null {
	if (!value || value instanceof NullValue || isErrorValue(value)) return null;
	if (value instanceof ListValue && value.length() >= 2) {
		const lat = coerceNumber(value.get(0));
		const lon = coerceNumber(value.get(1));
		if (lat == null || lon == null) return null;
		if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
		return { lat, lon };
	}
	const match = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(safeString(value));
	if (!match) return null;
	const lat = Number(match[1]);
	const lon = Number(match[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
	return { lat, lon };
}

function dateFromBasesValue(value: Value | null): Date | null {
	if (!value || !(value instanceof DateValue)) return null;
	const parsed = parseFlexibleDate(safeString(value));
	if (parsed) return parsed;
	const maybe = value as unknown as { date?: unknown; value?: unknown };
	if (maybe.date instanceof Date && !Number.isNaN(maybe.date.getTime())) return maybe.date;
	if (maybe.value instanceof Date && !Number.isNaN(maybe.value.getTime())) return maybe.value;
	return null;
}

function coerceNumber(value: Value | null): number | null {
	if (!value || value instanceof NullValue || isErrorValue(value)) return null;
	const parsed = Number(safeString(value));
	return Number.isFinite(parsed) ? parsed : null;
}

function isBlank(value: Value | null | undefined): boolean {
	if (!value || value instanceof NullValue || isErrorValue(value)) return true;
	if (value instanceof ListValue) return value.length() === 0;
	const text = safeString(value).trim();
	return !text;
}

function isErrorValue(value: Value): boolean {
	return value.constructor?.name === 'ErrorValue';
}

function mergedValue(entry: BasesEntry, propertyId: BasesPropertyId, noteValue: NoteValueReader | undefined): Value | null {
	const bases = safeGet(entry, propertyId);
	if (bases && !isBlank(bases)) return bases;
	if (!noteValue) return bases;
	let name = '';
	try {
		const parsed = parsePropertyId(propertyId);
		if (parsed.type !== 'note') return bases;
		name = parsed.name;
	} catch {
		return bases;
	}
	return coerceFrontmatter(noteValue(entry.file, name)) ?? bases;
}

function coerceFrontmatter(raw: unknown): Value | null {
	if (raw == null) return null;
	if (typeof raw === 'number' && Number.isFinite(raw)) return new NumberValue(raw);
	if (typeof raw === 'boolean') return new BooleanValue(raw);
	if (typeof raw === 'string') {
		const text = raw.trim();
		return text ? new StringValue(text) : null;
	}
	if (Array.isArray(raw)) {
		const items: Value[] = [];
		for (const item of raw) {
			const coerced = coerceFrontmatter(item);
			if (coerced) items.push(coerced);
		}
		return items.length > 0 ? new ListValue(items) : null;
	}
	if (typeof raw === 'object') {
		const link = raw as { path?: unknown; link?: unknown };
		if (typeof link.link === 'string' && link.link.trim()) return new StringValue(link.link.trim());
		if (typeof link.path === 'string' && link.path.trim()) return new StringValue(link.path.trim());
	}
	return null;
}

function safeGet(entry: BasesEntry, propertyId: BasesPropertyId): Value | null {
	try {
		return entry.getValue(propertyId);
	} catch {
		return null;
	}
}

function safeString(value: Value | null): string {
	if (!value) return '';
	try {
		const text = value.toString();
		if (!text || text === 'null' || text === 'undefined') return '';
		return text;
	} catch {
		return '';
	}
}

function safeDisplayName(displayName: (id: BasesPropertyId) => string, id: BasesPropertyId, fallback: string): string {
	try {
		const name = displayName(id);
		return name?.trim() ? name : fallback;
	} catch {
		return fallback;
	}
}

function noteId(name: string): BasesPropertyId {
	return `note.${name}` as BasesPropertyId;
}

function isHttpUrl(text: string): boolean {
	try {
		const url = new URL(text);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function looksLikeDateOnly(text: string): boolean {
	return /^\d{4}-\d{2}-\d{2}(?:$|[T\s])/.test(text.trim());
}

export function iconForColumn(column: ColumnModel, sample: Sortable | undefined): string {
	if (column.isDistance) return 'locate';
	if (column.isFileName) return 'file-text';
	if (column.isDate || column.weekday || sample?.kind === 'date') return 'clock';
	if (sample?.kind === 'number') return 'hash';
	if (/address/i.test(column.name) || /address/i.test(column.displayName)) return 'map-pin';
	if (/link|url|map/i.test(column.name) || /link|url|map/i.test(column.displayName)) return 'link';
	if (/\bmet with\b/i.test(column.name) || /\bmet with\b/i.test(column.displayName)) return 'user';
	return 'align-left';
}
