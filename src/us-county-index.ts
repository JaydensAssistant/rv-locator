import { countyNameKey, normalizeCounty } from './home-base';
import { US_COUNTIES } from './us-counties';

const LISTED_COUNTY_KEYS = new Set<string>();
const EXACT_COUNTY = new Map<string, string>();
const COUNTIES_BY_NAME = new Map<string, string[]>();
let countyIndexReady = false;

function ensureCountyIndex(): void {
	if (countyIndexReady) return;
	countyIndexReady = true;
	for (const entry of US_COUNTIES) {
		const full = entry.trim();
		EXACT_COUNTY.set(full.toLowerCase(), full);
		LISTED_COUNTY_KEYS.add(normalizeCounty(full));
		const head = normalizeCounty((full.split(',')[0] ?? full).trim());
		if (head) LISTED_COUNTY_KEYS.add(head);
		const key = countyNameKey(full);
		const list = COUNTIES_BY_NAME.get(key);
		if (list) list.push(full);
		else COUNTIES_BY_NAME.set(key, [full]);
	}
}

/**
 * Bundled "Name, ST" when the text names exactly one county.
 * "Citrus" and "Citrus County, FL" both become "Citrus County, FL".
 * "Marion" matches several states, so it stays unresolved.
 */
export function canonicalUsCounty(value: string): string | null {
	ensureCountyIndex();
	const trimmed = value.replace(/\s+/g, ' ').trim();
	if (!trimmed) return null;
	const exact = EXACT_COUNTY.get(trimmed.toLowerCase());
	if (exact) return exact;
	const matches = COUNTIES_BY_NAME.get(countyNameKey(trimmed)) ?? [];
	return matches.length === 1 ? matches[0] ?? null : null;
}

/** Dedupe key. A unique county uses its canonical spelling. An ambiguous name uses the county name. */
export function countyStorageKey(value: string): string {
	const canonical = canonicalUsCounty(value);
	if (canonical) return canonical.toLowerCase();
	return countyNameKey(value);
}

/** True for a bundled county, with or without the ", ST" suffix. */
export function isListedUsCounty(name: string): boolean {
	ensureCountyIndex();
	const key = normalizeCounty(name);
	if (!key) return false;
	if (LISTED_COUNTY_KEYS.has(key)) return true;
	const head = normalizeCounty((name.split(',')[0] ?? name).trim());
	return head.length > 0 && LISTED_COUNTY_KEYS.has(head);
}

/** Bundled "County, ST" names. An empty query returns the full list. */
export function listedUsCounties(query = ''): string[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...US_COUNTIES];
	return US_COUNTIES.filter((entry) => entry.toLowerCase().includes(needle));
}
