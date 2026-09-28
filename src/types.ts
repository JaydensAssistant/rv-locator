import { DISTANCE_COLUMN_ID } from './constants';
import { uniqueDatePropertyNames, parseDatePropertyNames } from './dates';
import {
	DEFAULT_HOME_LOG_TEMPLATE_FILE,
	DEFAULT_MISS_LOG_TEMPLATE_FILE,
	DEFAULT_NEW_RV_TEMPLATE_FILE,
	safeTemplateFileName,
} from './extras-sync';
import { normalizeCountyList } from './home-base';
import {
	DEFAULT_GO_OUT_MULTIPLIER,
	DEFAULT_WILLING_MULTIPLIER,
	defaultAvailabilityGrid,
	type AvailabilityGrid,
	type AvailabilityLevel,
	type AvailabilityMultipliers,
} from './schedule';

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
	/** Days since Last Spoke that make urgency 1, by priority 1–5. */
	urgencyThresholdDays: PriorityDays;
	/** Soft ideality fade window in days, by priority 1–5. */
	idealityFloorDays: PriorityDays;
	/** Distance that makes the ideality distance weight 1. Miles. Not shown in the setup wizard. */
	territorySpanMiles: number;
	/** Per sort chip. Ideality starts hidden. */
	sortChips: SortChipFlags;
	/** Multiply ideality by the current weekday × daypart home rate. Off by default. */
	homeLikelihoodEnabled: boolean;
	/** Requires home likelihood. Distance weight stays 1 so the slot, not miles, ranks the RV. */
	idealityPlannerEnabled: boolean;
	availabilityMultipliers: AvailabilityMultipliers;
	availabilityGrid: AvailabilityGrid;
	glancablePaddingY: number;
	glancablePaddingX: number;
	/** 0 keeps the line as wide as the card. */
	glancableMaxLineChars: number;
	glancableFontScale: number;
	glancableLines: GlancableLineFlags;
}

export type PriorityBand = 1 | 2 | 3 | 4 | 5;

export type PriorityDays = Record<PriorityBand, number>;

export const SORT_CHIP_IDS = ['distance', 'priority', 'spoke', 'attempted', 'met', 'urgency', 'ideality'] as const;

export type SortChipId = (typeof SORT_CHIP_IDS)[number];

export type SortChipFlags = Record<SortChipId, boolean>;

export const GLANCABLE_LINE_IDS = [
	'name',
	'street',
	'city',
	'distance',
	'last-spoke',
	'last-attempted',
	'met',
	'met-with',
	'visits',
] as const;

export type GlancableLineId = (typeof GLANCABLE_LINE_IDS)[number];

export type GlancableLineFlags = Record<GlancableLineId, boolean>;

/** P5 → 4d, P4 → 7d, P3 → 21d, P2 → 63d, P1 → 189d. */
export const DEFAULT_URGENCY_THRESHOLD_DAYS: PriorityDays = {
	1: 189,
	2: 63,
	3: 21,
	4: 7,
	5: 4,
};

/** P5 < 3d, P4 < 4d, P3 < 7d, P2 < 14d, P1 < 6 weeks. */
export const DEFAULT_IDEALITY_FLOOR_DAYS: PriorityDays = {
	1: 42,
	2: 14,
	3: 7,
	4: 4,
	5: 3,
};

export const DEFAULT_TERRITORY_SPAN_MILES = 15;

export const DEFAULT_GLANCABLE_PADDING_Y = 8;
export const DEFAULT_GLANCABLE_PADDING_X = 10;
export const DEFAULT_GLANCABLE_FONT_SCALE = 1;

export const DEFAULT_NEW_RV_PRIORITY = 4;

export function defaultSortChips(): SortChipFlags {
	return {
		distance: true,
		priority: true,
		spoke: true,
		attempted: true,
		met: true,
		urgency: true,
		ideality: false,
	};
}

export function defaultGlancableLines(): GlancableLineFlags {
	return {
		name: true,
		street: true,
		city: true,
		distance: true,
		'last-spoke': true,
		'last-attempted': true,
		met: true,
		'met-with': true,
		visits: true,
	};
}

export function defaultAvailabilityMultipliers(): AvailabilityMultipliers {
	return {
		goOut: DEFAULT_GO_OUT_MULTIPLIER,
		willing: DEFAULT_WILLING_MULTIPLIER,
	};
}

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
	defaultNewRvPriority: DEFAULT_NEW_RV_PRIORITY,
	newRvTemplateFile: DEFAULT_NEW_RV_TEMPLATE_FILE,
	homeLogTemplateFile: DEFAULT_HOME_LOG_TEMPLATE_FILE,
	missLogTemplateFile: DEFAULT_MISS_LOG_TEMPLATE_FILE,
	setupWizardCompleted: false,
	setupIncompleteNudgeDismissed: false,
	urgencyThresholdDays: { ...DEFAULT_URGENCY_THRESHOLD_DAYS },
	idealityFloorDays: { ...DEFAULT_IDEALITY_FLOOR_DAYS },
	territorySpanMiles: DEFAULT_TERRITORY_SPAN_MILES,
	sortChips: defaultSortChips(),
	homeLikelihoodEnabled: false,
	idealityPlannerEnabled: false,
	availabilityMultipliers: defaultAvailabilityMultipliers(),
	availabilityGrid: defaultAvailabilityGrid(),
	glancablePaddingY: DEFAULT_GLANCABLE_PADDING_Y,
	glancablePaddingX: DEFAULT_GLANCABLE_PADDING_X,
	glancableMaxLineChars: 0,
	glancableFontScale: DEFAULT_GLANCABLE_FONT_SCALE,
	glancableLines: defaultGlancableLines(),
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
		defaultNewRvPriority: sanitizeNewRvPriority(input.defaultNewRvPriority),
		newRvTemplateFile: safeTemplateFileName(input.newRvTemplateFile, DEFAULT_NEW_RV_TEMPLATE_FILE),
		homeLogTemplateFile: safeTemplateFileName(input.homeLogTemplateFile, DEFAULT_HOME_LOG_TEMPLATE_FILE),
		missLogTemplateFile: safeTemplateFileName(input.missLogTemplateFile, DEFAULT_MISS_LOG_TEMPLATE_FILE),
		setupWizardCompleted: input.setupWizardCompleted === true,
		setupIncompleteNudgeDismissed: input.setupIncompleteNudgeDismissed === true,
		urgencyThresholdDays: sanitizePriorityDays(input.urgencyThresholdDays, DEFAULT_URGENCY_THRESHOLD_DAYS),
		idealityFloorDays: sanitizePriorityDays(input.idealityFloorDays, DEFAULT_IDEALITY_FLOOR_DAYS),
		territorySpanMiles: positiveNumber(input.territorySpanMiles, DEFAULT_TERRITORY_SPAN_MILES, 500),
		sortChips: sanitizeSortChips(input.sortChips),
		homeLikelihoodEnabled: input.homeLikelihoodEnabled === true,
		idealityPlannerEnabled: input.idealityPlannerEnabled === true,
		availabilityMultipliers: sanitizeMultipliers(input.availabilityMultipliers),
		availabilityGrid: sanitizeAvailabilityGrid(input.availabilityGrid),
		glancablePaddingY: boundedNumber(input.glancablePaddingY, 0, 64, DEFAULT_GLANCABLE_PADDING_Y),
		glancablePaddingX: boundedNumber(input.glancablePaddingX, 0, 64, DEFAULT_GLANCABLE_PADDING_X),
		glancableMaxLineChars: lineChars(input.glancableMaxLineChars),
		glancableFontScale: boundedNumber(input.glancableFontScale, 0.5, 2.5, DEFAULT_GLANCABLE_FONT_SCALE),
		glancableLines: sanitizeGlancableLines(input.glancableLines),
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

const PRIORITY_BANDS: readonly PriorityBand[] = [1, 2, 3, 4, 5];

function sanitizePriorityDays(value: unknown, fallback: PriorityDays): PriorityDays {
	const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	const next = { ...fallback };
	for (const band of PRIORITY_BANDS) {
		next[band] = positiveNumber(raw[band] ?? raw[String(band)], fallback[band], 3650);
	}
	return next;
}

function sanitizeSortChips(value: unknown): SortChipFlags {
	const defaults = defaultSortChips();
	if (!value || typeof value !== 'object') return defaults;
	const raw = value as Record<string, unknown>;
	const next = { ...defaults };
	for (const id of SORT_CHIP_IDS) {
		if (typeof raw[id] === 'boolean') next[id] = raw[id];
	}
	return next;
}

function sanitizeGlancableLines(value: unknown): GlancableLineFlags {
	const defaults = defaultGlancableLines();
	if (!value || typeof value !== 'object') return defaults;
	const raw = value as Record<string, unknown>;
	const next = { ...defaults };
	for (const id of GLANCABLE_LINE_IDS) {
		if (typeof raw[id] === 'boolean') next[id] = raw[id];
	}
	return next;
}

function sanitizeMultipliers(value: unknown): AvailabilityMultipliers {
	const defaults = defaultAvailabilityMultipliers();
	if (!value || typeof value !== 'object') return defaults;
	const raw = value as { goOut?: unknown; willing?: unknown };
	return {
		goOut: boundedNumber(raw.goOut, 0, 10, defaults.goOut),
		willing: boundedNumber(raw.willing, 0, 10, defaults.willing),
	};
}

function sanitizeAvailabilityGrid(value: unknown): AvailabilityGrid {
	const grid = defaultAvailabilityGrid();
	if (!value || typeof value !== 'object') return grid;
	const raw = value as Record<string, unknown>;
	for (const key of Object.keys(grid)) {
		const level = raw[key];
		if (isAvailabilityLevel(level)) grid[key] = level;
	}
	return grid;
}

function isAvailabilityLevel(value: unknown): value is AvailabilityLevel {
	return value === 'off' || value === 'willing' || value === 'go-out';
}

function positiveNumber(value: unknown, fallback: number, max: number): number {
	return boundedNumber(value, Number.MIN_VALUE, max, fallback);
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string' && value.trim() !== ''
			? Number(value)
			: Number.NaN;
	if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
	return parsed;
}

function lineChars(value: unknown): number {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string' && value.trim() !== ''
			? Number(value)
			: Number.NaN;
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 200) return 0;
	return parsed;
}
