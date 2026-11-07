import { ACTIVE_EXCLUDED_FOLDER, matchesNearbyScope, visiblePropertyText } from './active-layout';
import { displayCity, parseDisplayAddress } from './address-display';
import { calendarDaysSince, formatDriveDate, parseFlexibleDate, showsElapsedDays } from './dates';
import { latLonFromUnknown, roundCoord } from './distance';
import { readProperty } from './frontmatter';
import type { CellModel, ColumnModel, GroupModel, RowModel } from './model';
import type { Sortable } from './sort';
import { matchesGenderFilter, matchesReturnScope, resolveStatus, sanitizeGender, type CampaignListFilter, type GenderFilter, type ReturnScope } from './status';

export interface HubCacheFile {
	path: string;
	name: string;
	folder: string;
	frontmatter: Record<string, unknown> | null;
}

export interface HubCacheOptions {
	returnScope: ReturnScope;
	genderFilter: GenderFilter;
	campaignListFilter: CampaignListFilter;
	campaignMark: (path: string) => 'covered' | 'open' | null;
	addressProperty: string;
	locationProperty: string;
	cityProperty: string;
}

const DATE_NAMES = ['Last Spoke', 'Last Attempted', 'Met', 'Last Studied'] as const;

/** Columns the card painter looks up by name. The same ids Bases uses. */
export function hubCacheColumns(locationProperty: string): ColumnModel[] {
	const location = locationProperty.trim() || 'Location';
	const specs: Array<[string, string, boolean, boolean]> = [
		['file.name', 'name', true, false],
		['note.Priority', 'Priority', false, false],
		['note.Last Spoke', 'Last Spoke', false, true],
		['note.Last Attempted', 'Last Attempted', false, true],
		['note.Met', 'Met', false, true],
		['note.Last Studied', 'Last Studied', false, true],
		['note.Visits', 'Visits', false, false],
		['note.Successful Visits', 'Successful Visits', false, false],
		['note.Address', 'Address', false, false],
		['note.Met With', 'Met With', false, false],
		[`note.${location}`, location, false, false],
	];
	return specs.map(([id, name, isFileName, isDate]) => ({
		id,
		name,
		displayName: name === 'name' ? 'Name' : name,
		isDistance: false,
		isFileName,
		isDate,
		weekday: isDate,
	}));
}

/**
 * Hub rows from vault frontmatter, the same cache the map and urgency paint use.
 * A glancable view can paint these before Bases delivers `onDataUpdated`.
 */
export function hubGroupsFromCache(files: readonly HubCacheFile[], options: HubCacheOptions): { columns: ColumnModel[]; groups: GroupModel[] } {
	const columns = hubCacheColumns(options.locationProperty);
	const rows = files.flatMap((file) => {
		const row = rowFromFile(file, options);
		return row ? [row] : [];
	});
	return {
		columns,
		groups: rows.length > 0 ? [{ label: null, rows }] : [],
	};
}

export interface CardPaintExtra {
	locationProperty?: string;
	snoozed?: boolean;
	campaign?: string | null;
	age?: string;
}

/** Visible card identity. An unchanged key means the card node can stay. */
export function cardPaintKey(row: RowModel, extra: CardPaintExtra = {}): string {
	const location = (extra.locationProperty ?? 'Location').trim() || 'Location';
	const locationId = `note.${location}`.toLowerCase();
	const cell = (id: string): string => {
		const found = row.cells.find((item) => item.id.toLowerCase() === id.toLowerCase());
		if (!found) return '';
		if (id.toLowerCase() === locationId) {
			return found.kind !== 'empty' && found.text && found.text !== '—' ? '1' : '0';
		}
		return `${found.text}\u001f${found.daysSince ?? ''}`;
	};
	return [
		row.path,
		row.name,
		row.status,
		row.gender ?? '',
		extra.age ?? '',
		extra.snoozed ? '1' : '0',
		extra.campaign ?? '',
		row.addressStreet ?? '',
		row.addressCity ?? '',
		row.addressText,
		cell('note.Priority'),
		cell('note.Last Spoke'),
		cell('note.Last Attempted'),
		cell('note.Met'),
		cell('note.Last Studied'),
		cell('note.Met With'),
		cell('note.Visits'),
		cell('note.Successful Visits'),
		cell(`note.${location}`),
	].join('\u001e');
}

function rowFromFile(file: HubCacheFile, options: HubCacheOptions): RowModel | null {
	const note = file.frontmatter;
	const folder = file.folder.trim();
	const priority = finiteRank(readProperty(note, 'Priority'));
	const hub = texts(readProperty(note, 'Hub'));
	if (!matchesNearbyScope('all', { folder, priority, hubTexts: hub })) return null;
	if (folder === ACTIVE_EXCLUDED_FOLDER) return null;
	if (!matchesReturnScope(options.returnScope, readProperty(note, 'Status'), priority)) return null;
	if (!matchesGenderFilter(options.genderFilter, readProperty(note, 'Gender'))) return null;
	const mark = options.campaignMark(file.path);
	if (!matchesCampaign(options.campaignListFilter, mark)) return null;
	const addressName = options.addressProperty.trim() || 'Address';
	const locationName = options.locationProperty.trim() || 'Location';
	const cityName = options.cityProperty.trim() || 'City';
	const addressText = shown(readProperty(note, addressName));
	const parsed = parseDisplayAddress(addressText);
	const point = latLonFromUnknown(readProperty(note, locationName));
	const cells: CellModel[] = [
		textCell('file.name', file.name, 'file'),
		priorityCell(priority),
		...DATE_NAMES.map((name) => dateCell(`note.${name}`, name, readProperty(note, name))),
		textCell('note.Visits', countText(readProperty(note, 'Visits'))),
		textCell('note.Successful Visits', countText(readProperty(note, 'Successful Visits'))),
		textCell('note.Address', addressText),
		textCell('note.Met With', shown(readProperty(note, 'Met With'))),
		textCell(`note.${locationName}`, point ? `${roundCoord(point.lat)}, ${roundCoord(point.lon)}` : ''),
	];
	return {
		path: file.path,
		name: file.name,
		lat: point?.lat ?? null,
		lon: point?.lon ?? null,
		addressText,
		addressStreet: parsed?.street ?? null,
		addressCity: displayCity(shown(readProperty(note, cityName)), addressText),
		status: resolveStatus(readProperty(note, 'Status'), priority),
		gender: sanitizeGender(readProperty(note, 'Gender')),
		cells,
		sortKeys: sortKeysFor(file, note, priority, addressText, cityName),
	};
}

function matchesCampaign(filter: CampaignListFilter, mark: 'covered' | 'open' | null): boolean {
	if (filter === 'uncovered') return mark === 'open';
	if (filter === 'covered') return mark === 'covered';
	return true;
}

function priorityCell(priority: number | null): CellModel {
	if (priority == null) return textCell('note.Priority', '');
	const text = String(priority);
	return { id: 'note.Priority', text, title: text, kind: 'text', numeric: true };
}

function dateCell(id: string, name: string, raw: unknown): CellModel {
	const text = raw instanceof Date ? raw.toISOString() : typeof raw === 'string' ? raw.trim() : '';
	if (!text) return { id, text: '—', title: 'No date', kind: 'empty', numeric: false };
	const display = formatDriveDate(text);
	const days = showsElapsedDays(name, name) ? calendarDaysSince(text) : null;
	return {
		id,
		text: display.empty ? text : display.text,
		title: display.title || text,
		kind: display.empty ? 'empty' : 'text',
		numeric: false,
		...(display.dow ? { dow: display.dow, rest: display.rest, time: display.time } : {}),
		...(days != null ? { daysSince: days } : {}),
	};
}

function sortKeysFor(
	file: HubCacheFile,
	note: Record<string, unknown> | null,
	priority: number | null,
	addressText: string,
	cityName: string,
): Record<string, Sortable> {
	const keys: Record<string, Sortable> = {
		'file.name': { kind: 'text', value: file.name },
		'note.Priority': priority == null ? { kind: 'empty' } : { kind: 'number', value: priority },
		'note.Visits': numberSort(readProperty(note, 'Visits')),
		'note.Successful Visits': numberSort(readProperty(note, 'Successful Visits')),
	};
	for (const name of DATE_NAMES) keys[`note.${name}`] = dateSort(readProperty(note, name));
	const city = displayCity(shown(readProperty(note, cityName)), addressText);
	keys['note.City'] = city ? { kind: 'text', value: city } : { kind: 'empty' };
	return keys;
}

function dateSort(raw: unknown): Sortable {
	const text = raw instanceof Date ? raw.toISOString() : typeof raw === 'string' ? raw.trim() : '';
	if (!text) return { kind: 'empty' };
	const date = parseFlexibleDate(text);
	return date ? { kind: 'date', value: date.getTime() } : { kind: 'text', value: text };
}

function numberSort(value: unknown): Sortable {
	if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number', value };
	if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return { kind: 'number', value: Number(value) };
	return { kind: 'empty' };
}

function textCell(id: string, text: string, kind: CellModel['kind'] = 'text'): CellModel {
	if (!text) return { id, text: '', title: '', kind: 'empty', numeric: false };
	return { id, text, title: text, kind, numeric: false };
}

function countText(value: unknown): string {
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value === 'string' && value.trim()) return value.trim();
	return '';
}

function shown(value: unknown): string {
	return texts(value).map((item) => visiblePropertyText(item)).filter(Boolean).join(', ');
}

function texts(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap((item) => texts(item));
	if (typeof value === 'string') {
		const text = value.trim();
		return text ? [text] : [];
	}
	return [];
}

function finiteRank(value: unknown): number | null {
	const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
	if (!Number.isFinite(parsed)) return null;
	return parsed;
}
