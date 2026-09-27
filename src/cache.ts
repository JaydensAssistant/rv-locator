import { CACHE_LIMIT } from './constants';
import { normalizeAddress } from './address';
import type { CacheEntry, GeocodeHit } from './types';

export function getCached(cache: Record<string, CacheEntry>, address: string): GeocodeHit[] | undefined {
	const entry = cache[normalizeAddress(address)];
	if (!entry || !Array.isArray(entry.results)) return undefined;
	return entry.results;
}

export function rememberResults(
	cache: Record<string, CacheEntry>,
	addresses: readonly string[],
	results: GeocodeHit[],
	now = Date.now(),
): Record<string, CacheEntry> {
	let next = cache;
	for (const address of addresses) {
		const key = normalizeAddress(address);
		if (!key) continue;
		next = {
			...next,
			[key]: {
				results,
				cachedAt: now,
			},
		};
	}
	return trimCache(next, CACHE_LIMIT);
}

export function trimCache(cache: Record<string, CacheEntry>, max: number): Record<string, CacheEntry> {
	const entries = Object.entries(cache);
	if (entries.length <= max) return cache;
	entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt || a[0].localeCompare(b[0]));
	return Object.fromEntries(entries.slice(entries.length - max));
}

export function sanitizeCache(raw: unknown): Record<string, CacheEntry> {
	if (!raw || typeof raw !== 'object') return {};
	const out: Record<string, CacheEntry> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== 'object') continue;
		const record = value as { results?: unknown; cachedAt?: unknown };
		if (!Array.isArray(record.results) || typeof record.cachedAt !== 'number') continue;
		const results: GeocodeHit[] = [];
		for (const item of record.results) {
			const hit = coerceStoredHit(item);
			if (hit) results.push(hit);
		}
		out[key] = { results, cachedAt: record.cachedAt };
	}
	return trimCache(out, CACHE_LIMIT);
}

function coerceStoredHit(item: unknown): GeocodeHit | null {
	if (!item || typeof item !== 'object') return null;
	const record = item as Partial<GeocodeHit>;
	if (typeof record.lat !== 'number' || typeof record.lon !== 'number') return null;
	if (!Number.isFinite(record.lat) || !Number.isFinite(record.lon)) return null;
	if (Math.abs(record.lat) > 90 || Math.abs(record.lon) > 180) return null;
	if (typeof record.formattedAddress !== 'string' || !record.formattedAddress.trim()) return null;
	const hit: GeocodeHit = {
		lat: record.lat,
		lon: record.lon,
		formattedAddress: record.formattedAddress.trim(),
	};
	copyOptional(hit, 'street', record.street);
	copyOptional(hit, 'housenumber', record.housenumber);
	copyOptional(hit, 'addressLine1', record.addressLine1);
	copyOptional(hit, 'city', record.city);
	copyOptional(hit, 'county', record.county);
	copyOptional(hit, 'state', record.state);
	copyOptional(hit, 'postcode', record.postcode);
	copyOptional(hit, 'country', record.country);
	copyOptional(hit, 'resultType', record.resultType);
	if (typeof record.confidence === 'number' && Number.isFinite(record.confidence)) {
		hit.confidence = record.confidence;
	}
	return hit;
}

function copyOptional(
	hit: GeocodeHit,
	key: 'street' | 'housenumber' | 'addressLine1' | 'city' | 'county' | 'state' | 'postcode' | 'country' | 'resultType',
	value: unknown,
): void {
	if (typeof value === 'string' && value.trim()) {
		hit[key] = value.trim();
	}
}
