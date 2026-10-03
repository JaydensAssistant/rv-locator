export const PLUGIN_ID = 'rv-locator';

/** Existing ids stay the Active layouts so a saved Base keeps filtering Priority > 0. */
export const VANILLA_VIEW_TYPE = 'rv-locator-nearby-vanilla';
export const VANILLA_ALL_VIEW_TYPE = 'rv-locator-nearby-vanilla-all';
export const VANILLA_INACTIVE_VIEW_TYPE = 'rv-locator-nearby-vanilla-inactive';
export const GLANCABLE_VIEW_TYPE = 'rv-locator-nearby-glancable';
export const GLANCABLE_ALL_VIEW_TYPE = 'rv-locator-nearby-glancable-all';
export const GLANCABLE_INACTIVE_VIEW_TYPE = 'rv-locator-nearby-glancable-inactive';

/** Virtual column id. This is never written to note frontmatter. */
export const DISTANCE_COLUMN_ID = 'rv-locator.distance';

/** Virtual sort ids. Scores stay in the view and are never written to notes. */
export const URGENCY_COLUMN_ID = 'rv-locator.urgency';
export const IDEALITY_COLUMN_ID = 'rv-locator.ideality';

/**
 * Global Geoapify host. It is the default because it is closer for most
 * vaults. `api-eu.geoapify.com` stays available when the region setting is EU.
 */
export const GEOCODE_ENDPOINT = 'https://api.geoapify.com/v1/geocode/search';
export const GEOCODE_ENDPOINT_EU = 'https://api-eu.geoapify.com/v1/geocode/search';

export type GeoapifyRegion = 'global' | 'eu';

export function geocodeEndpoint(region: GeoapifyRegion | undefined): string {
	return region === 'eu' ? GEOCODE_ENDPOINT_EU : GEOCODE_ENDPOINT;
}

/** About 1.3 requests/second, under Geoapify's free-tier burst of ~5/second. */
export const REQUEST_GAP_MS = 750;

export const GEO_WATCH_INTERVAL_MS = 20_000;
export const CACHE_LIMIT = 2000;

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
export const GEOAPIFY_ATTRIBUTION = 'Powered by Geoapify';
export const PRIVACY_NOTICE = 'Addresses are sent to Geoapify to look up coordinates.';

export const HOVER_SOURCE = 'rv-locator';
