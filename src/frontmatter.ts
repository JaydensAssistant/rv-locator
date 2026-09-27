import { formatSpecificAddress, googleMapsAddressLink } from './address';
import { parseDisplayAddress } from './address-display';
import { coordString, latLonFromUnknown, roundCoord } from './distance';
import type { GeocodeHit, RVLocatorSettings } from './types';

export function readProperty(frontmatter: Record<string, unknown> | null | undefined, name: string): unknown {
	if (!frontmatter) return undefined;
	const wanted = name.trim();
	if (!wanted) return undefined;
	if (Object.prototype.hasOwnProperty.call(frontmatter, wanted)) {
		return frontmatter[wanted];
	}
	const found = Object.keys(frontmatter).find((key) => key.toLowerCase() === wanted.toLowerCase());
	return found ? frontmatter[found] : undefined;
}

export function assignProperty(frontmatter: Record<string, unknown>, name: string, value: unknown): void {
	const wanted = name.trim();
	if (!wanted) return;
	const existing = Object.keys(frontmatter).find((key) => key.toLowerCase() === wanted.toLowerCase());
	frontmatter[existing ?? wanted] = value;
}

export function removeProperty(frontmatter: Record<string, unknown>, name: string): void {
	const wanted = name.trim();
	if (!wanted) return;
	const existing = Object.keys(frontmatter).find((key) => key.toLowerCase() === wanted.toLowerCase());
	if (existing) delete frontmatter[existing];
}

export function readAddress(frontmatter: Record<string, unknown> | null | undefined, property: string): string | null {
	const raw = readProperty(frontmatter, property);
	if (typeof raw !== 'string') return null;
	const address = raw.trim();
	return address ? address : null;
}

export function hasCoordinates(value: unknown): boolean {
	return latLonFromUnknown(value) != null;
}

export const SUCCESSFUL_VISITS_PROPERTY = 'Successful Visits';
export const VISITS_PROPERTY = 'Visits';
export const CITY_PROPERTY = 'City';

/**
 * City string to store. Prefer the geocoder's city, then a parse of the full address.
 * Returns null when neither is available. Does not invent a city.
 */
export function cityFromGeocode(formattedAddress: string, geocoderCity: string | undefined): string | null {
	const fromResult = geocoderCity?.trim() ?? '';
	if (fromResult) return fromResult;
	return parseDisplayAddress(formattedAddress)?.city ?? null;
}

/**
 * Fill `City` when it is missing, the note already has an address and a location list,
 * and the address parses to a city. Does not change Visits, Successful Visits, or Last Attempted.
 */
export function fillCity(
	frontmatter: Record<string, unknown>,
	addressProperty = 'Address',
	locationProperty = 'Location',
): boolean {
	if (!isAbsent(readProperty(frontmatter, CITY_PROPERTY))) return false;
	const address = readAddress(frontmatter, addressProperty);
	if (!address) return false;
	if (!hasCoordinates(readProperty(frontmatter, locationProperty))) return false;
	const city = parseDisplayAddress(address)?.city;
	if (!city) return false;
	assignProperty(frontmatter, CITY_PROPERTY, city);
	return true;
}

/**
 * When Successful Visits is absent and Visits is a number, copy that number.
 * Does not create Last Attempted, does not change Visits, and does not invent a count.
 * Returns true only when the property was written.
 */
export function fillSuccessfulVisits(frontmatter: Record<string, unknown>): boolean {
	const existing = readProperty(frontmatter, SUCCESSFUL_VISITS_PROPERTY);
	if (!isAbsent(existing)) return false;
	const visits = finiteNumber(readProperty(frontmatter, VISITS_PROPERTY));
	if (visits == null) return false;
	assignProperty(frontmatter, SUCCESSFUL_VISITS_PROPERTY, visits);
	return true;
}

function isAbsent(value: unknown): boolean {
	if (value == null) return true;
	if (typeof value === 'string' && !value.trim()) return true;
	return false;
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return null;
	const text = value.trim();
	if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

export interface NoteSnapshot {
	path: string;
	frontmatter: Record<string, unknown> | null;
}

export interface GeocodeWorkItem {
	path: string;
	address: string;
}

export function planGeocodeWork(
	notes: readonly NoteSnapshot[],
	settings: Pick<RVLocatorSettings, 'addressProperty' | 'locationProperty'>,
	force: boolean,
): GeocodeWorkItem[] {
	const items: GeocodeWorkItem[] = [];
	for (const note of notes) {
		const address = readAddress(note.frontmatter, settings.addressProperty);
		if (!address) continue;
		if (!force && hasCoordinates(readProperty(note.frontmatter, settings.locationProperty))) continue;
		items.push({ path: note.path, address });
	}
	return items;
}

/** True when `property` is the note address, which geocode must not write. */
export function isLockedAddressName(property: string, addressProperty: string): boolean {
	const name = property.trim().toLowerCase();
	if (!name) return false;
	return name === 'address' || name === addressProperty.trim().toLowerCase();
}

/** Two coordinate strings, latitude then longitude, for a list/text Location property. */
export function locationPair(hit: Pick<GeocodeHit, 'lat' | 'lon'>): [string, string] {
	return [coordString(roundCoord(hit.lat)), coordString(roundCoord(hit.lon))];
}

/**
 * Write geocode output onto a frontmatter object.
 * Location, Map Link, City, and optional place fields can change.
 * Location is a two-item list of strings so YAML can quote them (`"lat"`, `"lon"`).
 * The Address property is never written or cleared.
 * Returns the address already stored on the note, for the lookup cache.
 */
export function applyGeocodeHit(
	frontmatter: Record<string, unknown>,
	hit: GeocodeHit,
	settings: RVLocatorSettings,
): string {
	const formatted = hit.formattedAddress.trim() || formatSpecificAddress(hit);
	const pair = locationPair(hit);
	const storedAddress = readAddress(frontmatter, settings.addressProperty) ?? '';
	// List of strings, not numbers. A list/text property (and Bases) rejects bare
	// YAML numbers, and a bare negative longitude (`- -82.5`) can fail the YAML
	// round-trip so the whole frontmatter write is discarded.
	if (!isAddressName(settings.locationProperty, settings)) {
		assignProperty(frontmatter, settings.locationProperty, pair);
	}
	const mapAddress = storedAddress || formatted;
	if (mapAddress && settings.mapLinkProperty.trim() && !isAddressName(settings.mapLinkProperty, settings)) {
		assignProperty(frontmatter, settings.mapLinkProperty, googleMapsAddressLink(mapAddress));
	}
	const city = cityFromGeocode(formatted || hit.formattedAddress, hit.city);
	if (city && !isAddressName(CITY_PROPERTY, settings)) assignProperty(frontmatter, CITY_PROPERTY, city);
	const extraCity = settings.cityProperty.trim();
	if (extraCity && extraCity.toLowerCase() !== CITY_PROPERTY.toLowerCase()) {
		writeExtra(frontmatter, extraCity, city ?? undefined, settings);
	}
	writeExtra(frontmatter, settings.countyProperty, hit.county, settings);
	writeExtra(frontmatter, settings.stateProperty, hit.state, settings);
	writeExtra(frontmatter, settings.postcodeProperty, hit.postcode, settings);
	writeExtra(frontmatter, settings.countryProperty, hit.country, settings);
	return readAddress(frontmatter, settings.addressProperty) || '';
}

function isAddressName(property: string, settings: RVLocatorSettings): boolean {
	return isLockedAddressName(property, settings.addressProperty);
}

function yamlDoubleQuote(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function locationBlock(key: string, values: readonly [string, string]): string {
	return `${key}:\n  - ${yamlDoubleQuote(values[0])}\n  - ${yamlDoubleQuote(values[1])}`;
}

/**
 * Force `property` inside frontmatter to a block list of double-quoted strings.
 * Does not change any other key. Refuses to rewrite Address.
 * Notes with no frontmatter get a frontmatter block added at the top.
 */
export function ensureQuotedLocationList(
	markdown: string,
	property: string,
	values: readonly [string, string],
	addressProperty = 'Address',
): string {
	if (isLockedAddressName(property, addressProperty)) return markdown;
	const keyName = property.trim();
	if (!keyName) return markdown;
	const split = splitFrontmatter(markdown);
	if (!split) {
		const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
		const block = locationBlock(keyName, values).replace(/\n/g, newline);
		const body = markdown.length === 0 ? '' : markdown.startsWith(newline) ? markdown : `${newline}${markdown}`;
		return `---${newline}${block}${newline}---${body}`;
	}
	const nextFrontmatter = upsertLocationBlock(split.frontmatter, split.newline, keyName, values);
	const next = `---${split.newline}${nextFrontmatter}${split.newline}---${split.rest}`;
	return next === markdown ? markdown : next;
}

interface FrontmatterSplit {
	frontmatter: string;
	newline: string;
	rest: string;
}

function splitFrontmatter(markdown: string): FrontmatterSplit | null {
	const newline = markdown.startsWith('---\r\n') ? '\r\n' : markdown.startsWith('---\n') ? '\n' : null;
	if (!newline) return null;
	const start = 3 + newline.length;
	const close = `${newline}---`;
	let from = start;
	while (from < markdown.length) {
		const end = markdown.indexOf(close, from);
		if (end < 0) return null;
		const after = end + close.length;
		const nextChar = markdown[after];
		if (nextChar === undefined || nextChar === '\n' || nextChar === '\r') {
			return {
				frontmatter: markdown.slice(start, end),
				newline,
				rest: markdown.slice(after),
			};
		}
		from = after;
	}
	return null;
}

function upsertLocationBlock(
	frontmatter: string,
	newline: string,
	property: string,
	values: readonly [string, string],
): string {
	const lines = frontmatter.split(/\r?\n/);
	const wanted = property.trim().toLowerCase();
	const index = lines.findIndex((line) => topLevelKey(line)?.toLowerCase() === wanted);
	const block = locationBlock(index >= 0 ? (topLevelKey(lines[index] ?? '') ?? property) : property, values)
		.replace(/\n/g, newline);
	if (index < 0) {
		const trimmed = frontmatter.replace(/(?:\r?\n)+$/, '');
		if (!trimmed.trim()) return block;
		return `${trimmed}${newline}${block}`;
	}
	let end = index + 1;
	while (end < lines.length) {
		const line = lines[end] ?? '';
		if (line.trim() === '') {
			const next = lines[end + 1] ?? '';
			if (next.trim() === '' || !/^\s/.test(next)) break;
			end += 1;
			continue;
		}
		if (/^\s/.test(line)) {
			end += 1;
			continue;
		}
		break;
	}
	return [...lines.slice(0, index), ...block.split(/\r?\n/), ...lines.slice(end)].join(newline);
}

function topLevelKey(line: string): string | null {
	if (/^\s/.test(line)) return null;
	const match = /^([^:#][^:]*?)\s*:/.exec(line);
	const key = match?.[1]?.trim() ?? '';
	return key ? key : null;
}

function writeExtra(
	frontmatter: Record<string, unknown>,
	property: string,
	value: string | undefined,
	settings: RVLocatorSettings,
): void {
	if (!property.trim() || isAddressName(property, settings)) return;
	if (value && value.trim()) {
		assignProperty(frontmatter, property, value.trim());
		return;
	}
	removeProperty(frontmatter, property);
}
