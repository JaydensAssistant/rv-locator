import { parseDisplayAddress } from './address-display';
import { autocompleteEndpoint, geocodeEndpoint, type GeoapifyRegion } from './constants';
import { countyNameKey } from './home-base';
import type { GeocodeHit, RouteProvider } from './types';

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

/** Soft Geoapify proximity. This is a bias, not a filter, so other places can still return. */
export interface GeocodeBias {
	lat: number;
	lon: number;
}

/**
 * Build a forward-geocode URL.
 * `text` is the address string only. Do not append names, phones, or note bodies.
 * `bias` adds `bias=proximity:lon,lat` when present. It does not switch the host.
 */
export function buildGeocodeUrl(
	address: string,
	apiKey: string,
	region: GeoapifyRegion = 'global',
	bias?: GeocodeBias | null,
): string {
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
	if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon)) {
		url.searchParams.set('bias', `proximity:${bias.lon},${bias.lat}`);
	}
	return url.toString();
}

/**
 * Autocomplete type-ahead. The default limit is 5.
 * A home-county pass passes `placeFilter` (`place:id|place:id`) and uses limit 10.
 * Autocomplete does not accept `county:` filters, so `countyFilter` is ignored.
 * A circle filter is the no-county home pass.
 */
export function buildAutocompleteUrl(
	address: string,
	apiKey: string,
	region: GeoapifyRegion = 'global',
	options?: { bias?: GeocodeBias | null; filterRadiusM?: number | null; countyFilter?: string | null; placeFilter?: string | null; limit?: number },
): string {
	const text = addressForQuery(address);
	if (!text) throw new Error('Address is empty.');
	if (!apiKey.trim()) throw new Error('API key is empty.');
	const url = new URL(autocompleteEndpoint(region));
	url.searchParams.set('text', text);
	url.searchParams.set('format', 'json');
	const place = options?.placeFilter?.trim() ?? '';
	const requested = options?.limit;
	const limit = place ? 10 : (requested && requested > 0 ? Math.round(requested) : 5);
	url.searchParams.set('limit', String(limit));
	url.searchParams.set('apiKey', apiKey.trim());
	const bias = options?.bias;
	if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon)) {
		url.searchParams.set('bias', `proximity:${bias.lon},${bias.lat}`);
	}
	if (place) {
		url.searchParams.set('filter', place);
	} else if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon)) {
		const radius = options?.filterRadiusM;
		if (radius && radius > 0) {
			url.searchParams.set('filter', `circle:${bias.lon},${bias.lat},${Math.round(radius)}`);
		}
	}
	return url.toString();
}

/** Place id of the county result that matches `county`. Other results are ignored. */
export function readCountyPlaceId(body: unknown, county: string): string | null {
	const wanted = countyNameKey(county);
	if (!wanted || !body || typeof body !== 'object') return null;
	const results = (body as { results?: unknown }).results;
	if (!Array.isArray(results)) return null;
	for (const item of results) {
		if (!item || typeof item !== 'object') continue;
		const row = item as Record<string, unknown>;
		const id = typeof row.place_id === 'string' ? row.place_id.trim() : '';
		if (!id) continue;
		const fields = [row.county, row.name, row.formatted, row.address_line1];
		const matched = fields.some((value) => typeof value === 'string' && countyNameKey(value) === wanted);
		if (matched) return id;
	}
	return null;
}

/**
 * "Citrus County, Florida" stays as written. A bare county name gains "County"
 * so the geocode search can resolve a place id.
 */
export function countyGeocodeText(line: string): string {
	const trimmed = line.trim().replace(/\s+/g, ' ');
	if (!trimmed) return '';
	if (/county/i.test(trimmed)) return trimmed;
	const comma = trimmed.indexOf(',');
	const name = (comma >= 0 ? trimmed.slice(0, comma) : trimmed).trim();
	const rest = comma >= 0 ? trimmed.slice(comma + 1).trim() : '';
	const head = `${name} County`;
	return rest ? `${head}, ${rest}` : head;
}

/**
 * County place ids come from geocode search. Autocomplete rejects `type=county`.
 */
export function buildCountySuggestUrl(text: string, apiKey: string, region: GeoapifyRegion = 'global'): string {
	const query = countyGeocodeText(text);
	if (!query) throw new Error('Address is empty.');
	if (!apiKey.trim()) throw new Error('API key is empty.');
	const url = new URL(geocodeEndpoint(region));
	url.searchParams.set('text', query);
	url.searchParams.set('type', 'county');
	url.searchParams.set('format', 'json');
	url.searchParams.set('limit', '5');
	url.searchParams.set('apiKey', apiKey.trim());
	return url.toString();
}

/**
 * Turn-by-turn from the note's Address and City text.
 * Location coordinates are for distance only. A coordinate pin is a worse
 * destination than the address Google, Apple, or Waze would look up themselves.
 */
export function directionsUrl(
	provider: RouteProvider,
	input: { lat?: number | null; lon?: number | null; address?: string | null; city?: string | null },
): string {
	const address = input.address ?? '';
	const city = input.city;
	const query = mapsSearchQuery(address, city);
	if (provider === 'apple') return `https://maps.apple.com/?daddr=${encodeURIComponent(query)}`;
	if (provider === 'waze') return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
	return googleMapsDirectionsLink(address, city);
}

/**
 * One tap can reach `shell.openExternal` twice: a second listener on the same
 * node, or the phone dispatching a second trusted click. The same URL inside
 * this window is the duplicate. A later, different tap still opens.
 */
const EXTERNAL_OPEN_WINDOW_MS = 500;
let lastExternalOpen = { url: '', at: 0 };

export function claimExternalOpen(url: string, now = Date.now()): boolean {
	const target = url.trim();
	if (!target) return false;
	if (target === lastExternalOpen.url && now - lastExternalOpen.at < EXTERNAL_OPEN_WINDOW_MS) return false;
	lastExternalOpen = { url: target, at: now };
	return true;
}

/**
 * Open a web URL in the system browser.
 * `window.open(url, '_blank', 'noopener')` stays on about:blank in Obsidian's
 * Electron shell, so Maps never loads. Desktop uses `shell.openExternal`.
 */
export function openExternalUrl(url: string): void {
	const target = url.trim();
	if (!claimExternalOpen(target)) return;
	if (openWithElectron(target)) return;
	const opened = window.open(target, '_blank');
	if (opened) opened.opener = null;
}

type AddressClickHost = HTMLElement & {
	rvAddressBound?: boolean;
	rvAddressOpen?: (path: string) => void;
};

/**
 * One listener per element. Decorating the same note again, or with a new
 * path, updates the path the existing listener reads. A second listener on
 * the same click is ignored.
 */
export function bindAddressDirections(element: HTMLElement, open: (path: string) => void): void {
	const host = element as AddressClickHost;
	host.rvAddressOpen = open;
	if (host.rvAddressBound) return;
	host.rvAddressBound = true;
	element.addEventListener('click', (event) => {
		handleAddressDirectionsClick(event, (path) => { host.rvAddressOpen?.(path); });
	}, true);
}

export function handleAddressDirectionsClick(event: Event, open: (path: string) => void): void {
	const target = event.target;
	if (!(target instanceof Element)) return;
	if (target.closest('a.rv-map-button, input, button, .rv-label-icon')) return;
	if (!target.closest('a.rv-address-link, .rv-address-field')) return;
	const marked = event as Event & { rvAddressOpened?: boolean };
	if (marked.rvAddressOpened) return;
	marked.rvAddressOpened = true;
	event.preventDefault();
	event.stopPropagation();
	if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
	const anchor = target.closest('a.rv-address-link');
	if (anchor instanceof HTMLElement) {
		anchor.setAttribute('href', '#');
		anchor.removeAttribute('target');
	}
	const root = target.closest('[data-rv-route-path]');
	const path = root instanceof HTMLElement ? root.dataset.rvRoutePath ?? '' : '';
	if (!path) return;
	open(path);
}

function openWithElectron(url: string): boolean {
	try {
		const requireFn = (globalThis as { require?: (id: string) => { shell?: { openExternal?: (target: string) => void } } }).require;
		const open = requireFn?.('electron')?.shell?.openExternal;
		if (typeof open !== 'function') return false;
		open(url);
		return true;
	} catch {
		return false;
	}
}

/** Same characters, one for one, after trimming and collapsing whitespace. */
export function addressesMatchOneForOne(left: string, right: string): boolean {
	return collapseSpaces(left) === collapseSpaces(right);
}

function collapseSpaces(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** Street and city, for a one-line suggestion. The stored value stays the full address. */
export function abbreviateAddress(formatted: string): string {
	const parts = formatted.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
	if (parts.length <= 2) return parts.join(', ');
	return `${parts[0]}, ${parts[1]}`;
}

/** How many stored addresses the New RV chevron offers before a lookup. */
export const RECENT_ADDRESS_LIMIT = 24;

/**
 * Newest addresses first. The same address, ignoring case and spacing, is kept once
 * from the newest note.
 */
export function recentAddresses(
	notes: readonly { address: string; recentAt: number }[],
	limit = RECENT_ADDRESS_LIMIT,
): string[] {
	const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : RECENT_ADDRESS_LIMIT;
	const sorted = [...notes].sort((a, b) => b.recentAt - a.recentAt);
	const seen = new Set<string>();
	const labels: string[] = [];
	for (const note of sorted) {
		const label = note.address.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
		if (!label) continue;
		const key = normalizeAddress(label);
		if (seen.has(key)) continue;
		seen.add(key);
		labels.push(label);
		if (labels.length >= cap) return labels;
	}
	return labels;
}

/**
 * Address chevron before a lookup shows stored addresses, most recent first.
 * A finished lookup replaces that list. Hits stay in lookup order.
 */
export function addressChevronLabels(
	recent: readonly string[],
	lookupHits: readonly string[],
	query: string,
): string[] {
	const hits = lookupHits.map((item) => item.trim()).filter(Boolean);
	if (hits.length > 0) return hits;
	const labels = recent.map((item) => item.trim()).filter(Boolean);
	const needle = query.trim().toLowerCase();
	if (!needle) return labels;
	return labels.filter((item) => item.toLowerCase().includes(needle));
}

/**
 * Enter or leaving the field selects a hit only when the text matches one.
 * Several remaining hits do not count as a choice.
 */
export function matchingAddress<T extends { formattedAddress: string }>(hits: readonly T[], typed: string): T | null {
	const needle = typed.replace(/\s+/g, ' ').trim().toLowerCase();
	if (!needle) return null;
	const exact = hits.find((hit) => {
		const full = hit.formattedAddress.replace(/\s+/g, ' ').trim().toLowerCase();
		return addressesMatchOneForOne(hit.formattedAddress, typed) || abbreviateAddress(hit.formattedAddress).toLowerCase() === needle || full === needle;
	});
	if (exact) return exact;
	const partial = hits.filter((hit) => {
		const full = hit.formattedAddress.toLowerCase();
		return full.includes(needle) || abbreviateAddress(hit.formattedAddress).toLowerCase().includes(needle);
	});
	return partial.length === 1 ? partial[0] ?? null : null;
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

/** Turn-by-turn starts in Google Maps. OpenStreetMap is the basemap, not the route. */
export function googleMapsDirectionsLink(address: string, city?: string | null): string {
	const query = mapsSearchQuery(address, city);
	return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
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
