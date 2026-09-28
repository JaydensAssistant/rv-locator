import { DISTANCE_COLUMN_ID } from './constants';
import { uniqueDatePropertyNames, parseDatePropertyNames } from './dates';
import {
	DEFAULT_HOME_LOG_TEMPLATE_FILE,
	DEFAULT_MISS_LOG_TEMPLATE_FILE,
	DEFAULT_NEW_RV_TEMPLATE_FILE,
	safeTemplateFileName,
} from './extras-sync';
import { normalizeCountyList } from './home-base';

export type DistanceUnit = 'miles' | 'kilometers';

export interface RVLocatorSettings {
	geoapifyApiKey: string;
	addressProperty: string;
	locationProperty: string;
	mapLinkProperty: string;
	cityProperty: string;
	countyProperty: string;
	stateProperty: string;
	postcodeProperty: string;
	countryProperty: string;
	distanceUnit: DistanceUnit;
	/** Note property keys whose dates show a weekday in Nearby (Glancable). */
	datePropertiesForWeekday: string[];
	/** When true, Nearby uses testLatitude/testLongitude instead of device GPS. In-memory only. */
	distanceTest: boolean;
	testLatitude: number;
	testLongitude: number;
	/** County names. Empty means geocode always opens the confirm picker. */
	homeCounties: string[];
	/** When true, a companion appended to Taken is stored as a wikilink when a note basename matches. */
	linkCompanionsToNotes: boolean;
	/** Priority written on a new RV note. Integer 0–5. */
	defaultNewRvPriority: number;
	/** File name inside Templater's template folder for the New RV template. */
	newRvTemplateFile: string;
	/** File name for the Meta Bind Home template. */
	homeLogTemplateFile: string;
	/** File name for the Meta Bind Not home template. */
	missLogTemplateFile: string;
	/** The first-run setup wizard has been closed. Settings can open it again. */
	setupWizardCompleted: boolean;
	/** User chose Don't remind me on the unfinished-setup notice. Does not mark setup complete. */
	setupIncompleteNudgeDismissed: boolean;
}

export const DEFAULT_NEW_RV_PRIORITY = 3;

export const DEFAULT_SETTINGS: RVLocatorSettings = {
	geoapifyApiKey: '',
	addressProperty: 'Address',
	locationProperty: 'Location',
	mapLinkProperty: 'Map Link',
	cityProperty: '',
	countyProperty: '',
	stateProperty: '',
	postcodeProperty: '',
	countryProperty: '',
	distanceUnit: 'miles',
	datePropertiesForWeekday: ['Last Spoke', 'Met', 'Last Attempted'],
	distanceTest: false,
	/** Orlando-area point near the sample vault, used only while distance testing is on. */
	testLatitude: 28.54,
	testLongitude: -81.38,
	homeCounties: [],
	linkCompanionsToNotes: false,
	defaultNewRvPriority: DEFAULT_NEW_RV_PRIORITY,
	newRvTemplateFile: DEFAULT_NEW_RV_TEMPLATE_FILE,
	homeLogTemplateFile: DEFAULT_HOME_LOG_TEMPLATE_FILE,
	missLogTemplateFile: DEFAULT_MISS_LOG_TEMPLATE_FILE,
	setupWizardCompleted: false,
	setupIncompleteNudgeDismissed: false,
};

export interface NearbySortPreference {
	property: string;
	direction: 'ASC' | 'DESC';
}

/** Opening Nearby uses the last preset. First run is Nearest (live distance, nearest first). */
export function defaultNearbySort(): NearbySortPreference {
	return { property: DISTANCE_COLUMN_ID, direction: 'ASC' };
}

export function sanitizeNearbySort(value: unknown): NearbySortPreference {
	if (!value || typeof value !== 'object') return defaultNearbySort();
	const raw = value as { property?: unknown; direction?: unknown };
	const property = typeof raw.property === 'string' ? raw.property.trim() : '';
	if (!property) return defaultNearbySort();
	if (raw.direction !== 'ASC' && raw.direction !== 'DESC') return defaultNearbySort();
	return { property, direction: raw.direction };
}

export interface GeocodeHit {
	lat: number;
	lon: number;
	formattedAddress: string;
	/** Street name from Geoapify, without the house number. */
	street?: string;
	housenumber?: string;
	addressLine1?: string;
	city?: string;
	county?: string;
	state?: string;
	postcode?: string;
	country?: string;
	resultType?: string;
	/** Geoapify `rank.confidence`, from 0 to 1. `1` and `1.00` are the same JSON number. Omitted when the response has no confidence. */
	confidence?: number;
}

export interface CacheEntry {
	results: GeocodeHit[];
	cachedAt: number;
}

export interface StoredPluginData {
	settings?: Partial<RVLocatorSettings>;
	geocodeCache?: Record<string, CacheEntry>;
	/** Last Nearby sort. Missing data opens on Nearest. */
	nearbySort?: NearbySortPreference;
}

export interface LatLon {
	lat: number;
	lon: number;
}

type SettingsInput = Partial<RVLocatorSettings> & {
	/** Previous string setting. "Last Spc" is rewritten to the real key `Last Spoke`. */
	weekdayDateProperties?: unknown;
};

export function mergeSettings(partial: SettingsInput | null | undefined): RVLocatorSettings {
	const input = partial ?? {};
	return {
		geoapifyApiKey: typeof input.geoapifyApiKey === 'string' ? input.geoapifyApiKey : DEFAULT_SETTINGS.geoapifyApiKey,
		addressProperty: nonEmptyString(input.addressProperty, DEFAULT_SETTINGS.addressProperty),
		locationProperty: nonEmptyString(input.locationProperty, DEFAULT_SETTINGS.locationProperty),
		mapLinkProperty: typeof input.mapLinkProperty === 'string' ? input.mapLinkProperty : DEFAULT_SETTINGS.mapLinkProperty,
		cityProperty: typeof input.cityProperty === 'string' ? input.cityProperty : DEFAULT_SETTINGS.cityProperty,
		countyProperty: typeof input.countyProperty === 'string' ? input.countyProperty : DEFAULT_SETTINGS.countyProperty,
		stateProperty: typeof input.stateProperty === 'string' ? input.stateProperty : DEFAULT_SETTINGS.stateProperty,
		postcodeProperty: typeof input.postcodeProperty === 'string' ? input.postcodeProperty : DEFAULT_SETTINGS.postcodeProperty,
		countryProperty: typeof input.countryProperty === 'string' ? input.countryProperty : DEFAULT_SETTINGS.countryProperty,
		distanceUnit: input.distanceUnit === 'kilometers' ? 'kilometers' : 'miles',
		datePropertiesForWeekday: mergeDateProperties(input),
		distanceTest: input.distanceTest === true,
		testLatitude: finiteCoord(input.testLatitude, 90, DEFAULT_SETTINGS.testLatitude),
		testLongitude: finiteCoord(input.testLongitude, 180, DEFAULT_SETTINGS.testLongitude),
		homeCounties: normalizeCountyList(input.homeCounties),
		linkCompanionsToNotes: input.linkCompanionsToNotes === true,
		defaultNewRvPriority: sanitizeNewRvPriority(input.defaultNewRvPriority),
		newRvTemplateFile: safeTemplateFileName(input.newRvTemplateFile, DEFAULT_NEW_RV_TEMPLATE_FILE),
		homeLogTemplateFile: safeTemplateFileName(input.homeLogTemplateFile, DEFAULT_HOME_LOG_TEMPLATE_FILE),
		missLogTemplateFile: safeTemplateFileName(input.missLogTemplateFile, DEFAULT_MISS_LOG_TEMPLATE_FILE),
		setupWizardCompleted: input.setupWizardCompleted === true,
		setupIncompleteNudgeDismissed: input.setupIncompleteNudgeDismissed === true,
	};
}

export function sanitizeNewRvPriority(value: unknown): number {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string' && value.trim() !== ''
			? Number(value)
			: Number.NaN;
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 5) return DEFAULT_NEW_RV_PRIORITY;
	return parsed;
}

function finiteCoord(value: unknown, limit: number, fallback: number): number {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string' && value.trim() !== ''
			? Number(value)
			: Number.NaN;
	if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return fallback;
	return parsed;
}

function mergeDateProperties(input: SettingsInput): string[] {
	let names: string[];
	if (Array.isArray(input.datePropertiesForWeekday)) {
		names = uniqueDatePropertyNames(input.datePropertiesForWeekday);
	} else if (typeof input.weekdayDateProperties === 'string') {
		names = uniqueDatePropertyNames(parseDatePropertyNames(input.weekdayDateProperties));
	} else {
		return [...DEFAULT_SETTINGS.datePropertiesForWeekday];
	}
	if (names.length > 0 && !names.some((name) => name.toLowerCase() === 'last attempted')) {
		names = [...names, 'Last Attempted'];
	}
	return names;
}

function nonEmptyString(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	return trimmed || fallback;
}
