import { normalizeCounty } from './home-base';
import { US_COUNTIES } from './us-counties';

const LISTED_COUNTY_KEYS = new Set<string>();
for (const entry of US_COUNTIES) {
	LISTED_COUNTY_KEYS.add(normalizeCounty(entry));
	const county = normalizeCounty((entry.split(',')[0] ?? entry).trim());
	if (county) LISTED_COUNTY_KEYS.add(county);
}

/** True for a bundled county, with or without the ", ST" suffix. */
export function isListedUsCounty(name: string): boolean {
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
