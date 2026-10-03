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

/** One county per line, the same split the Home counties textarea uses. */
export function parseHomeCountyLines(value: string): string[] {
	return value.split(/\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

/**
 * Put home-region hits first. This is a sort, not a filter: a miss stays in the list.
 * County, city, and state matches outrank a formatted-line mention.
 */
export function preferHomeRegion<T extends {
	city?: string;
	county?: string;
	state?: string;
	formattedAddress?: string;
}>(hits: readonly T[], homeLines: readonly string[]): T[] {
	const tokens = homeRegionTokens(homeLines);
	if (tokens.length === 0) return [...hits];
	return hits
		.map((hit, index) => ({ hit, index, score: homeRegionScore(hit, tokens) }))
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((item) => item.hit);
}

function homeRegionTokens(lines: readonly string[]): string[] {
	const seen = new Set<string>();
	const tokens: string[] = [];
	for (const line of lines) {
		for (const part of line.split(',')) {
			const raw = part.trim().toLowerCase();
			const county = normalizeCounty(part);
			for (const token of [county, raw]) {
				if (!token || seen.has(token)) continue;
				seen.add(token);
				tokens.push(token);
			}
		}
	}
	return tokens;
}

function homeRegionScore(hit: { city?: string; county?: string; state?: string; formattedAddress?: string }, tokens: readonly string[]): number {
	let score = 0;
	const county = hit.county ? normalizeCounty(hit.county) : '';
	const city = hit.city?.trim().toLowerCase() ?? '';
	const state = hit.state?.trim().toLowerCase() ?? '';
	if (county && tokens.includes(county)) score += 3;
	if (city && tokens.includes(city)) score += 3;
	if (state && tokens.includes(state)) score += 2;
	const parts = (hit.formattedAddress ?? '').split(',').map((part) => part.trim().toLowerCase());
	for (const part of parts) {
		if (!part) continue;
		if (tokens.includes(part) || tokens.includes(normalizeCounty(part))) score += 2;
	}
	return score;
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
