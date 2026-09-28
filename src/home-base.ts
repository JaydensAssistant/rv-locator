import type { GeocodeHit } from './types';

export interface GeocodePick {
	/** The one in-home hit that may be saved without asking. Absent means show the picker. */
	hit: GeocodeHit | null;
}

/**
 * Geoapify `rank.confidence` is a number from 0 to 1.
 * JSON `1` and `1.00` are the same value. Anything else, including a missing
 * confidence, is not an automatic match.
 */
export function isFullConfidence(confidence: number | undefined): boolean {
	if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return false;
	return Math.abs(confidence - 1) <= 1e-9;
}

/**
 * Auto-pick only when the home-base list is non-empty, exactly one result is in
 * that set, and that result's Geoapify `rank.confidence` is 1.00.
 * Zero or two-or-more in-home hits, a missing confidence, or an empty home list
 * stays on the confirm modal. Street text is not compared.
 */
export function decideGeocodePick(
	hits: readonly GeocodeHit[],
	homeCounties: readonly string[],
): GeocodePick {
	const homes = homeCounties.map(normalizeCounty).filter((name) => name.length > 0);
	if (homes.length === 0) return { hit: null };
	const inHome = hits.filter((hit) => inHomeCounty(hit, homes));
	if (inHome.length !== 1) return { hit: null };
	const only = inHome[0];
	if (!only || !isFullConfidence(only.confidence)) return { hit: null };
	return { hit: only };
}

function inHomeCounty(hit: GeocodeHit, homes: readonly string[]): boolean {
	const county = hit.county ? normalizeCounty(hit.county) : '';
	return county.length > 0 && homes.includes(county);
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

/** One county per line, the same split the Home base counties textarea uses. */
export function parseHomeCountyLines(value: string): string[] {
	return value.split(/\n/).map((line) => line.trim()).filter((line) => line.length > 0);
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
