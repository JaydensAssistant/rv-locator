import type { GeocodeHit } from './types';

const STREET_SUFFIXES = new Set([
	'street', 'st', 'avenue', 'ave', 'road', 'rd', 'drive', 'dr', 'lane', 'ln',
	'boulevard', 'blvd', 'court', 'ct', 'place', 'pl', 'circle', 'cir', 'way',
	'trail', 'trl', 'parkway', 'pkwy', 'highway', 'hwy', 'terrace', 'ter',
	'loop', 'alley', 'aly', 'plaza', 'plz', 'square', 'sq', 'run', 'path',
	'pike', 'route', 'rte', 'expressway', 'expy', 'crossing', 'xing', 'point', 'pt',
]);

const DIRECTIONALS: Record<string, string> = {
	n: 'n',
	north: 'n',
	s: 's',
	south: 's',
	e: 'e',
	east: 'e',
	w: 'w',
	west: 'w',
	ne: 'ne',
	northeast: 'ne',
	nw: 'nw',
	northwest: 'nw',
	se: 'se',
	southeast: 'se',
	sw: 'sw',
	southwest: 'sw',
};

export interface GeocodePick {
	/** The one in-county candidate whose street words match. Absent means show the picker. */
	hit: GeocodeHit | null;
}

/**
 * Auto-pick only when the home-base list is non-empty, exactly one result is in
 * that list, and that result's street words match the typed address.
 * Anything else, including an empty home list, stays on the confirm modal.
 */
export function decideGeocodePick(
	typedAddress: string,
	hits: readonly GeocodeHit[],
	homeCounties: readonly string[],
): GeocodePick {
	const homes = homeCounties.map(normalizeCounty).filter((name) => name.length > 0);
	if (homes.length === 0) return { hit: null };
	const inHome = hits.filter((hit) => {
		const county = hit.county ? normalizeCounty(hit.county) : '';
		return county.length > 0 && homes.includes(county);
	});
	if (inHome.length !== 1) return { hit: null };
	const only = inHome[0];
	if (!only || !streetTokensMatch(typedAddress, only)) return { hit: null };
	return { hit: only };
}

/** "Orange" and "Orange County" are the same home-base entry. */
export function normalizeCounty(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\./g, '')
		.replace(/\s+/g, ' ')
		.replace(/\s+county$/, '')
		.trim();
}

export function normalizeCountyList(value: unknown): string[] {
	const chunks: string[] = [];
	const source = Array.isArray(value) ? value : [value];
	for (const item of source) {
		if (typeof item !== 'string') continue;
		for (const part of item.split(/[\n,]/)) chunks.push(part);
	}
	const seen = new Set<string>();
	const names: string[] = [];
	for (const item of chunks) {
		const trimmed = item.trim();
		if (!trimmed) continue;
		const key = normalizeCounty(trimmed);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		names.push(trimmed);
	}
	return names;
}

/**
 * Significant street words must be the same list, in order.
 * Suffixes (`Lane` / `Ln`) are ignored only as the last word.
 * Directionals stay, so `N Oak` does not match `Oak`.
 * Extra words fail the match: `Oak Lane` is not `Oak Hammock Lane` or `Red Oak Lane`.
 * A typed house number must be the same number on the candidate.
 */
export function streetTokensMatch(typedAddress: string, hit: GeocodeHit): boolean {
	const typedLine = firstSegment(typedAddress);
	const candidateLine = candidateStreetLine(hit);
	const typedNumber = leadingHouseNumber(typedLine);
	const candidateNumber = (hit.housenumber?.trim().toLowerCase()
		|| leadingHouseNumber(candidateLine)
		|| leadingHouseNumber(hit.formattedAddress)
		|| '');
	if (typedNumber && candidateNumber !== typedNumber) return false;
	const left = significantStreetTokens(typedLine);
	const right = significantStreetTokens(candidateLine);
	if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
	return left.every((token, index) => token === right[index]);
}

export function candidateStreetLine(hit: GeocodeHit): string {
	const street = hit.street?.trim() ?? '';
	const number = hit.housenumber?.trim() ?? '';
	if (street && number) return `${number} ${street}`;
	if (street) return street;
	const line = hit.addressLine1?.trim() ?? '';
	if (line) return line;
	return firstSegment(hit.formattedAddress);
}

function firstSegment(address: string): string {
	const segment = address.split(',')[0] ?? address;
	return segment.trim();
}

function leadingHouseNumber(raw: string): string {
	const match = /^\s*(\d+[a-z]?)\b/i.exec(raw);
	return match?.[1]?.toLowerCase() ?? '';
}

function significantStreetTokens(raw: string): string[] {
	const cleaned = raw
		.toLowerCase()
		.replace(/[#.'’]/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
	const words = cleaned.split(/\s+/).filter((word) => word.length > 0);
	let start = 0;
	if (words[0] && /^\d+[a-z]?$/.test(words[0])) start = 1;
	const body = words.slice(start).map((word) => DIRECTIONALS[word] ?? word);
	const last = body[body.length - 1];
	if (last && STREET_SUFFIXES.has(last)) body.pop();
	return body;
}
