import { formatSpecificAddress, googleMapsLink } from './address';
import { parseDisplayAddress } from './address-display';
import { latLonFromUnknown, roundCoord } from './distance';
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

/**
 * Write geocode output onto a frontmatter object.
 * Location, Map Link, City, and optional place fields can change.
 * The Address property is never written or cleared.
 * Returns the address already stored on the note, for the lookup cache.
 */
export function applyGeocodeHit(
	frontmatter: Record<string, unknown>,
	hit: GeocodeHit,
	settings: RVLocatorSettings,
): string {
	const formatted = hit.formattedAddress.trim() || formatSpecificAddress(hit);
	const lat = roundCoord(hit.lat);
	const lon = roundCoord(hit.lon);
	// Two numeric list items. Obsidian stores this as a YAML sequence, either a
	// block list or a flow list [lat, lon]. Both parse back to a length-2 array.
	// Bases map `coordinates: note.Location` reads that list. Never one string.
	const location: [number, number] = [lat, lon];
	if (!isAddressName(settings.locationProperty, settings)) {
		assignProperty(frontmatter, settings.locationProperty, location);
	}
	if (settings.mapLinkProperty.trim() && !isAddressName(settings.mapLinkProperty, settings)) {
		assignProperty(frontmatter, settings.mapLinkProperty, googleMapsLink(lat, lon));
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
	const name = property.trim().toLowerCase();
	if (!name) return false;
	return name === 'address' || name === settings.addressProperty.trim().toLowerCase();
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
