import { parseDisplayAddress } from './address-display';
import { geocodeEndpoint, type GeoapifyRegion } from './constants';
import type { GeocodeHit } from './types';

export interface AddressParts {
	housenumber?: string;
	street?: string;
	addressLine1?: string;
	city?: string;
	county?: string;
	state?: string;
	postcode?: string;
	country?: string;
	formatted?: string;
}

/**
 * Collapse an address into a stable cache key.
 * Case and repeated whitespace do not cause another lookup.
 */
export function normalizeAddress(address: string): string {
	return address
		.trim()
		.toLowerCase()
		.replace(/[\r\n]+/g, ' ')
		.replace(/\s*,\s*/g, ', ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Address text placed in the Geoapify `text` parameter. Case is preserved. */
export function addressForQuery(address: string): string {
	return address.replace(/[\r\n]+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * Build a forward-geocode URL.
 * `text` is the address string only. Do not append names, phones, or note bodies.
 */
export function buildGeocodeUrl(address: string, apiKey: string, region: GeoapifyRegion = 'global'): string {
	const text = addressForQuery(address);
	if (!text) {
		throw new Error('Address is empty.');
	}
	if (!apiKey.trim()) {
		throw new Error('API key is empty.');
	}
	const url = new URL(geocodeEndpoint(region));
	url.searchParams.set('text', text);
	url.searchParams.set('format', 'json');
	url.searchParams.set('limit', '5');
	url.searchParams.set('apiKey', apiKey.trim());
	return url.toString();
}

/**
 * Single-line address written back to the note.
 * Geoapify's `formatted` line is used when it already includes the street.
 * A city-only formatted line is replaced by the street-level parts when those exist.
 */
export function formatSpecificAddress(parts: AddressParts): string {
	const formatted = parts.formatted?.trim() ?? '';
	const composed = composeAddress(parts);
	const street = streetLine(parts);
	if (formatted && street && formattedIncludesStreet(formatted, parts)) return formatted;
	if (street && composed) return composed;
	if (formatted) return formatted;
	return composed;
}

function composeAddress(parts: AddressParts): string {
	const line = streetLine(parts);
	const ordered = [line, parts.city, parts.county, parts.state, parts.postcode, parts.country];
	const out: string[] = [];
	for (const part of ordered) {
		const text = (part ?? '').trim();
		if (!text) continue;
		if (out.some((existing) => existing.toLowerCase() === text.toLowerCase())) continue;
		out.push(text);
	}
	return out.join(', ');
}

function streetLine(parts: AddressParts): string {
	const street = [parts.housenumber, parts.street].filter(isNonEmpty).join(' ').trim();
	return street || parts.addressLine1?.trim() || '';
}

function formattedIncludesStreet(formatted: string, parts: AddressParts): boolean {
	const street = streetLine(parts).toLowerCase();
	return street.length > 0 && formatted.toLowerCase().includes(street);
}

/**
 * Google Maps search text.
 * A bare street (no comma-separated locality, and the City token is not already
 * in the string) gets `, City` appended. Address itself is never rewritten.
 * An empty City leaves the address unchanged. A line that already parses to a
 * city is left alone, even when City disagrees with that locality.
 */
export function mapsSearchQuery(address: string, city?: string | null): string {
	const query = collapseAddress(address);
	const extra = collapseAddress(city ?? '');
	if (!query || !extra) return query;
	if (addressAlreadyNamesCity(query, extra)) return query;
	return `${query}, ${extra}`;
}

/**
 * Google Maps search for the note’s Address text.
 * Location stays a coordinate pair for distance. Map Link does not use lat/lon,
 * because a coordinate pin is a poor way to find the house in the field.
 * Pass the note’s City so a street-only Address still searches in that city.
 */
export function googleMapsAddressLink(address: string, city?: string | null): string {
	const query = mapsSearchQuery(address, city);
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

const BODY_MAP_LINK = /\[🗺️\]\(https?:\/\/[^)\s]+\)/g;

/**
 * Point the note's map icon at the current Map Link.
 * Address text is left unchanged. Other links are left unchanged.
 */
export function refreshBodyMapLink(markdown: string, url: string): string {
	if (!url.trim()) return markdown;
	return markdown.replace(BODY_MAP_LINK, `[🗺️](${url})`);
}

function collapseAddress(value: string): string {
	return value.replace(/[\r\n]+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

function addressAlreadyNamesCity(address: string, city: string): boolean {
	if (parseDisplayAddress(address)?.city) return true;
	const token = city.toLowerCase();
	if (!token) return true;
	const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?:^|[,\\s])${escaped}(?:$|[,\\s])`, 'i').test(address);
}

export function parseGeocodeBody(body: unknown): GeocodeHit[] {
	if (!body || typeof body !== 'object') return [];
	const results = (body as { results?: unknown }).results;
	if (!Array.isArray(results)) return [];
	const hits: GeocodeHit[] = [];
	for (const item of results) {
		const hit = parseResult(item);
		if (hit) hits.push(hit);
	}
	return hits;
}

function parseResult(item: unknown): GeocodeHit | null {
	if (!item || typeof item !== 'object') return null;
	const record = item as Record<string, unknown>;
	const lat = asFiniteNumber(record.lat);
	const lon = asFiniteNumber(record.lon);
	if (lat == null || lon == null) return null;
	if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

	const parts: AddressParts = {
		housenumber: asNonEmptyString(record.housenumber),
		street: asNonEmptyString(record.street),
		addressLine1: asNonEmptyString(record.address_line1),
		city: asNonEmptyString(record.city),
		county: asNonEmptyString(record.county),
		state: asNonEmptyString(record.state),
		postcode: asNonEmptyString(record.postcode),
		country: asNonEmptyString(record.country),
		formatted: asNonEmptyString(record.formatted),
	};
	const formattedAddress = formatSpecificAddress(parts);
	if (!formattedAddress) return null;

	const hit: GeocodeHit = {
		lat,
		lon,
		formattedAddress,
	};
	if (parts.street) hit.street = parts.street;
	if (parts.housenumber) hit.housenumber = parts.housenumber;
	if (parts.addressLine1) hit.addressLine1 = parts.addressLine1;
	if (parts.city) hit.city = parts.city;
	if (parts.county) hit.county = parts.county;
	if (parts.state) hit.state = parts.state;
	if (parts.postcode) hit.postcode = parts.postcode;
	if (parts.country) hit.country = parts.country;

	const resultType = asNonEmptyString(record.result_type);
	if (resultType) hit.resultType = resultType;

	const confidence = readConfidence(record.rank);
	if (confidence != null) hit.confidence = confidence;
	return hit;
}

function readConfidence(rank: unknown): number | undefined {
	if (!rank || typeof rank !== 'object') return undefined;
	const value = asFiniteNumber((rank as { confidence?: unknown }).confidence);
	if (value == null) return undefined;
	return value;
}

function asFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function asNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function isNonEmpty(value: string | undefined): value is string {
	return Boolean(value && value.trim());
}
