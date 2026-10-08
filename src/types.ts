import type { StudyRatioOrder } from './catalog';
import { DISTANCE_COLUMN_ID, type GeoapifyRegion } from './constants';
import { uniqueDatePropertyNames, parseDatePropertyNames } from './dates';
import {
	DEFAULT_HOME_LOG_TEMPLATE_FILE,
	DEFAULT_MISS_LOG_TEMPLATE_FILE,
	DEFAULT_NEW_RV_TEMPLATE_FILE,
	safeTemplateFileName,
} from './extras-sync';
import { normalizeCountyList } from './home-base';
import {
	DEFAULT_AVOID_MIN_TRIALS,
	DEFAULT_AVOID_SOFT_MAX,
	DEFAULT_TRY_MIN_HOMES,
	DEFAULT_TRY_SOFT_MIN,
	defaultAvailabilityGrid,
	migrateAvailabilityGrid,
	type AvailabilityGrid,
	type DigestDayScope,
	type DigestOrientation,
} from './schedule';
import { sanitizeSuggestionColor, type SuggestionColorChoice } from './suggestion-callout';
import {
	defaultUrgencyColors,
	sanitizeUrgencyColors,
	sanitizeUrgencyPalette,
	type UrgencyColors,
	type UrgencyPaletteId,
} from './urgency-palette';
import { sanitizeMapShade, type MapShadeMode } from './map-shade';
import { sanitizeCampaignListFilter, sanitizeGenderFilter, sanitizeReturnScope, type CampaignListFilter, type GenderFilter, type ReturnScope } from './status';

export type DistanceUnit = 'miles' | 'kilometers';

export type AttemptLogWidth = 'auto' | 'full' | 'column';

export interface RVLocatorSettings {
	geoapifyApiKey: string;
	/** `global` uses api.geoapify.com. `eu` is an explicit override. */
	geoapifyRegion: GeoapifyRegion;
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
	availabilityGrid: AvailabilityGrid;
	/** Days as rows, or days as columns, in the Attempt Log digest table. */
	digestOrientation: DigestOrientation;
	/** All seven weekdays, or only days with a May-go-out daypart. */
	digestDays: DigestDayScope;
	/**
	 * Return Suggestions color. `auto` follows the theme accent.
	 * Stored as a color name, never as an Obsidian callout id.
	 */
	suggestionColor: SuggestionColorChoice;
	/** Open RV notes (cssclass `rv-dashboard`) in Reading view. On by default. */
	openRvInReadingView: boolean;
	/** Attempt Log table headers read Mor, Aft, Eve. On by default. */
	abbreviateDayparts: boolean;
	/** `auto` is full width when days are columns, otherwise the dashboard column. */
	attemptLogWidth: AttemptLogWidth;
	/** Quick Facts grows to the note width. On by default. */
	wideQuickFacts: boolean;
	/** Hubs and Address grow to the note width. On by default. */
	wideHubsAddress: boolean;
	/** Visit buttons grow to the note width. On by default. */
	wideVisitButtons: boolean;
	centerDashboard: boolean;
	centerVisitNotes: boolean;
	centerSuggestions: boolean;
	urgencyPalette: UrgencyPaletteId;
	/** Low to high urgency. Used when {@link urgencyPalette} is `custom`. */
	urgencyCustomColors: UrgencyColors;
	/** How map pins are colored. Urgency bands unless this is changed. Nearness is not a mode. */
	mapShade: MapShadeMode;
	/** Directions built at click time. Stored Map Link text is left alone. */
	routeProvider: RouteProvider;
	/** Soft rate at or above this, with {@link digestTryMinHomes}, lands in Try. */
	digestTrySoftMin: number;
	/** Soft rate at or below this, with {@link digestAvoidMinTrials}, lands in Avoid. */
	digestAvoidSoftMax: number;
	/** Trials required before a cold slot can be Avoid. */
	digestAvoidMinTrials: number;
	/** Homes required before a soft slot can be Try. */
	digestTryMinHomes: number;
	/** Ask to adjust priority after this many visits. Default 3. */
	priorityNudgeEvery: number;
	/** Bases toolbar pieces hidden while a Glancable view is on screen. */
	glancableChrome: GlancableChromeFlags;
	glancablePaddingY: number;
	glancablePaddingX: number;
	/** 0 keeps the line as wide as the card. */
	glancableMaxLineChars: number;
	glancableFontScale: number;
	/** 0 keeps the density scale. 2 or more fits that many cards across. */
	glancableFitCount: number;
	glancableLines: GlancableLineFlags;
	/** Quick Facts header circles. On by default. */
	showUrgencyBadge: boolean;
	showPriorityBadge: boolean;
	showRouteBadge: boolean;
	/** New visits paint newest-first. Display only. On by default. */
	visitsNewestFirst: boolean;
	/** Visits after the newest few sit under ### Older Visits. On by default. */
	collapseOlderVisits: boolean;
	/** How many of the newest visits stay outside Older Visits. Default 3. */
	visibleVisitCount: number;
	/** Bottom line of a glancable card shows the current return bucket. On when the key is absent. */
	showCardReturnStatus: boolean;
	/** `short` is `Sat mor`. `long` is `Friday afternoon — `. Short when the key is absent. */
	cardReturnFormat: 'short' | 'long';
	/** Card title is the person's name. On when the key is absent. */
	cardTitleNameOnly: boolean;
	/**
	 * Last spoke, last attempted, and met share one line, and the card badges
	 * fit that stack. On when the key is missing. An explicit off stays off.
	 * A vault that stored `compactCardDates` still reads that key.
	 */
	compactMode: boolean;
	/** Note opened by the return-visit hub chip. Default Return Visits Hub. */
	returnHubNote: string;
	/** Glancable campaign cycle: all, uncovered, covered. */
	campaignListFilter: CampaignListFilter;
	/** When on, the core Page Preview plugin may preview RV Dashboard titles. Off by default. */
	dashboardPagePreview: boolean;
	/** Folder for notes created with New RV. Empty keeps Templater's folder. */
	newRvFolder: string;
	/** Append the Met date `YYYY-MM-DD` to a created RV's file name. Off by default. */
	appendMetDateToFilename: boolean;
	returnScope: ReturnScope;
	genderFilter: GenderFilter;
	/** Custom publication titles, added when someone types one that is not in the static list. */
	customPublications: string[];
	/** Custom media titles. */
	customMedia: string[];
	/** Custom lesson titles. Official lessons stay in the catalog. */
	customLessons: string[];
	/** Show the literature and media prompts on a study's at-home log. Off by default. */
	showStudyLiterature: boolean;
	/** Left-align return-suggestion bullets outside the attempt log. On by default. */
	leftAlignSuggestionBullets: boolean;
	/** Glanceable card icon scale. 1.2 is about 20% larger. */
	glancableIconScale: number;
	/** City and distance on their own line. Off by default. */
	splitCityLine: boolean;
	/** Study card and Quick Facts ratio. Lessons/Studies unless switched. */
	studyRatio: StudyRatioOrder;
	/** Study cards hide Last Spoke unless this was turned on. */
	studyShowSpoke: boolean;
	/** Study cards hide Last Attempted unless this was turned on. */
	studyShowAttempted: boolean;
}

export type PriorityBand = 1 | 2 | 3 | 4 | 5;

export type PriorityDays = Record<PriorityBand, number>;

export const SORT_CHIP_IDS = ['distance', 'priority', 'spoke', 'attempted', 'met', 'city', 'urgency', 'ideality'] as const;

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

export interface GlancableChromeFlags {
	/** Hide the whole Bases top bar. On when unset. A saved true or false is kept. */
	hideToolbar: boolean;
	hideViews: boolean;
	hideSort: boolean;
	hideFilter: boolean;
	hideProperties: boolean;
	hideSearch: boolean;
	/** Bases New. On by default so it does not compete with the plugin New button. */
	hideNew: boolean;
	hideCode: boolean;
}

/** P5 → 4d, P4 → 7d, P3 → 21d, P2 → 63d, P1 → 189d. */
export const DEFAULT_URGENCY_THRESHOLD_DAYS: PriorityDays = {
	1: 189,
	2: 63,
	3: 21,
	4: 7,
	5: 4,
};

/** P5 is 3 days or less, P4 is 5, P3 is 7, P2 is 21, P1 is 63. The cliff is days inside the floor. */
export const DEFAULT_IDEALITY_FLOOR_DAYS: PriorityDays = {
	1: 63,
	2: 21,
	3: 7,
	4: 5,
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
		city: true,
		urgency: true,
		ideality: false,
	};
}

export function defaultGlancableChrome(): GlancableChromeFlags {
	return {
		hideToolbar: true,
		hideViews: false,
		hideSort: false,
		hideFilter: false,
		hideProperties: false,
		hideSearch: false,
		hideNew: true,
		hideCode: false,
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

export const DEFAULT_PRIORITY_NUDGE_EVERY = 3;

export const DEFAULT_SETTINGS: RVLocatorSettings = {
	geoapifyApiKey: '',
	geoapifyRegion: 'global',
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
	availabilityGrid: defaultAvailabilityGrid(),
	digestOrientation: 'rows',
	digestDays: 'all',
	suggestionColor: 'auto',
	openRvInReadingView: true,
	abbreviateDayparts: true,
	attemptLogWidth: 'full',
	wideQuickFacts: true,
	wideHubsAddress: true,
	wideVisitButtons: true,
	centerDashboard: true,
	centerVisitNotes: true,
	centerSuggestions: true,
	urgencyPalette: 'default',
	urgencyCustomColors: defaultUrgencyColors(),
	mapShade: 'urgency',
	routeProvider: 'google',
	digestTrySoftMin: DEFAULT_TRY_SOFT_MIN,
	digestAvoidSoftMax: DEFAULT_AVOID_SOFT_MAX,
	digestAvoidMinTrials: DEFAULT_AVOID_MIN_TRIALS,
	digestTryMinHomes: DEFAULT_TRY_MIN_HOMES,
	priorityNudgeEvery: DEFAULT_PRIORITY_NUDGE_EVERY,
	glancableChrome: defaultGlancableChrome(),
	glancablePaddingY: DEFAULT_GLANCABLE_PADDING_Y,
	glancablePaddingX: DEFAULT_GLANCABLE_PADDING_X,
	glancableMaxLineChars: 0,
	glancableFontScale: DEFAULT_GLANCABLE_FONT_SCALE,
	glancableFitCount: 0,
	glancableLines: defaultGlancableLines(),
	showUrgencyBadge: true,
	showPriorityBadge: true,
	showRouteBadge: true,
	visitsNewestFirst: true,
	collapseOlderVisits: true,
	visibleVisitCount: 3,
	showCardReturnStatus: true,
	cardReturnFormat: 'short',
	cardTitleNameOnly: true,
	compactMode: true,
	returnHubNote: 'Return Visits Hub',
	campaignListFilter: 'all',
	dashboardPagePreview: false,
	newRvFolder: '',
	appendMetDateToFilename: false,
	returnScope: 'active',
	genderFilter: 'all',
	customPublications: [],
	customMedia: [],
	customLessons: [],
	showStudyLiterature: false,
	leftAlignSuggestionBullets: true,
	glancableIconScale: 1.2,
	splitCityLine: false,
	studyRatio: 'lessons-studies',
	studyShowSpoke: false,
	studyShowAttempted: false,
};

export type RouteProvider = 'google' | 'apple' | 'waze';

export function sanitizeRouteProvider(value: unknown): RouteProvider {
	if (value === 'apple' || value === 'waze') return value;
	return 'google';
}

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
	/**
	 * Set after the latest Attempt Log layout pass.
	 * 1 was the 1.2.8 open-the-callout rewrite. 2 moves the table and quote
	 * above the callout. Missing, or an older number, means that pass still needs to run.
	 */
	digestPolish?: number;
	/** Return Suggestions callout type the vault was last written with. */
	suggestionTypeApplied?: string;
	/** The one campaign, or absent when none is saved. Not a setting, so a tab reset leaves it. */
	campaign?: unknown;
}

export interface LatLon {
	lat: number;
	lon: number;
}

type SettingsInput = Partial<RVLocatorSettings> & {
	/** Previous string setting. "Last Spc" is rewritten to the real key `Last Spoke`. */
	weekdayDateProperties?: unknown;
	/** Compact dates, renamed to {@link RVLocatorSettings.compactMode}. */
	compactCardDates?: boolean;
};

/**
 * Missing means on. An explicit compact mode wins.
 * An explicit old compact-dates value is kept, including an explicit off.
 */
export function compactModeFrom(input: SettingsInput): boolean {
	if (typeof input.compactMode === 'boolean') return input.compactMode;
	if (typeof input.compactCardDates === 'boolean') return input.compactCardDates;
	return true;
}

export function mergeSettings(partial: SettingsInput | null | undefined): RVLocatorSettings {
	const input = partial ?? {};
	return {
		geoapifyApiKey: typeof input.geoapifyApiKey === 'string' ? input.geoapifyApiKey : DEFAULT_SETTINGS.geoapifyApiKey,
		geoapifyRegion: input.geoapifyRegion === 'eu' ? 'eu' : 'global',
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
		availabilityGrid: migrateAvailabilityGrid(input.availabilityGrid),
		digestOrientation: input.digestOrientation === 'columns' ? 'columns' : 'rows',
		digestDays: input.digestDays === 'may' ? 'may' : 'all',
		suggestionColor: sanitizeSuggestionColor(input.suggestionColor),
		openRvInReadingView: input.openRvInReadingView !== false,
		abbreviateDayparts: input.abbreviateDayparts !== false,
		attemptLogWidth: input.attemptLogWidth === 'auto' || input.attemptLogWidth === 'column' ? input.attemptLogWidth : 'full',
		wideQuickFacts: input.wideQuickFacts !== false,
		wideHubsAddress: input.wideHubsAddress !== false,
		wideVisitButtons: input.wideVisitButtons !== false,
		centerDashboard: input.centerDashboard !== false,
		centerVisitNotes: input.centerVisitNotes !== false,
		centerSuggestions: input.centerSuggestions !== false,
		urgencyPalette: sanitizeUrgencyPalette(input.urgencyPalette),
		urgencyCustomColors: sanitizeUrgencyColors(input.urgencyCustomColors),
		mapShade: sanitizeMapShade(input.mapShade),
		routeProvider: sanitizeRouteProvider(input.routeProvider),
		digestTrySoftMin: unitRate(input.digestTrySoftMin, DEFAULT_TRY_SOFT_MIN),
		digestAvoidSoftMax: unitRate(input.digestAvoidSoftMax, DEFAULT_AVOID_SOFT_MAX),
		digestAvoidMinTrials: wholeInRange(input.digestAvoidMinTrials, 1, 30, DEFAULT_AVOID_MIN_TRIALS),
		digestTryMinHomes: wholeInRange(input.digestTryMinHomes, 1, 30, DEFAULT_TRY_MIN_HOMES),
		priorityNudgeEvery: nudgeEvery(input.priorityNudgeEvery),
		glancableChrome: sanitizeGlancableChrome(input.glancableChrome),
		glancablePaddingY: boundedNumber(input.glancablePaddingY, 0, 64, DEFAULT_GLANCABLE_PADDING_Y),
		glancablePaddingX: boundedNumber(input.glancablePaddingX, 0, 64, DEFAULT_GLANCABLE_PADDING_X),
		glancableMaxLineChars: lineChars(input.glancableMaxLineChars),
		glancableFontScale: boundedNumber(input.glancableFontScale, 0.5, 2.5, DEFAULT_GLANCABLE_FONT_SCALE),
		glancableFitCount: fitCount(input.glancableFitCount),
		glancableLines: sanitizeGlancableLines(input.glancableLines),
		showUrgencyBadge: input.showUrgencyBadge !== false,
		showPriorityBadge: input.showPriorityBadge !== false,
		showRouteBadge: input.showRouteBadge !== false,
		visitsNewestFirst: input.visitsNewestFirst !== false,
		collapseOlderVisits: input.collapseOlderVisits !== false,
		visibleVisitCount: wholeInRange(input.visibleVisitCount, 1, 30, DEFAULT_SETTINGS.visibleVisitCount),
		showCardReturnStatus: input.showCardReturnStatus !== false,
		cardReturnFormat: input.cardReturnFormat === 'long' ? 'long' : 'short',
		cardTitleNameOnly: input.cardTitleNameOnly !== false,
		compactMode: compactModeFrom(input),
		returnHubNote: typeof input.returnHubNote === 'string' && input.returnHubNote.trim()
			? input.returnHubNote.trim()
			: DEFAULT_SETTINGS.returnHubNote,
		campaignListFilter: sanitizeCampaignListFilter(input.campaignListFilter),
		dashboardPagePreview: input.dashboardPagePreview === true,
		newRvFolder: folderSetting(input.newRvFolder),
		appendMetDateToFilename: input.appendMetDateToFilename === true,
		returnScope: sanitizeReturnScope(input.returnScope),
		genderFilter: sanitizeGenderFilter(input.genderFilter),
		customPublications: stringList(input.customPublications),
		customMedia: stringList(input.customMedia),
		customLessons: stringList(input.customLessons),
		showStudyLiterature: input.showStudyLiterature === true,
		leftAlignSuggestionBullets: input.leftAlignSuggestionBullets !== false,
		glancableIconScale: boundedNumber(input.glancableIconScale, 0.5, 2.5, DEFAULT_SETTINGS.glancableIconScale),
		splitCityLine: input.splitCityLine === true,
		studyRatio: input.studyRatio === 'studies-lessons' ? 'studies-lessons' : 'lessons-studies',
		studyShowSpoke: input.studyShowSpoke === true,
		studyShowAttempted: input.studyShowAttempted === true,
	};
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== 'string') continue;
		const text = item.trim();
		const key = text.toLowerCase();
		if (!text || seen.has(key)) continue;
		seen.add(key);
		out.push(text);
	}
	return out;
}

/**
 * Full width and Automatic are wide. Dashboard column is the narrow width.
 * Swapping digest rows and columns does not change this.
 */
export function attemptLogFullWidth(settings: Pick<RVLocatorSettings, 'attemptLogWidth' | 'digestOrientation'>): boolean {
	return settings.attemptLogWidth !== 'column';
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

function sanitizeGlancableChrome(value: unknown): GlancableChromeFlags {
	const defaults = defaultGlancableChrome();
	if (!value || typeof value !== 'object') return defaults;
	const raw = value as Record<string, unknown>;
	const next = { ...defaults };
	for (const key of Object.keys(defaults) as (keyof GlancableChromeFlags)[]) {
		if (typeof raw[key] === 'boolean') next[key] = raw[key];
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

function unitRate(value: unknown, fallback: number): number {
	const parsed = typeof value === 'number' ? value : Number.NaN;
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
	return Math.round(parsed * 1000) / 1000;
}

function wholeInRange(value: unknown, min: number, max: number, fallback: number): number {
	const parsed = typeof value === 'number' ? value : Number.NaN;
	if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
	return parsed;
}

function nudgeEvery(value: unknown): number {
	const parsed = typeof value === 'number'
		? value
		: typeof value === 'string' && value.trim() !== ''
			? Number(value)
			: Number.NaN;
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 30) return DEFAULT_PRIORITY_NUDGE_EVERY;
	return parsed;
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

function fitCount(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number.NaN;
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 8) return 0;
	return parsed;
}

function folderSetting(value: unknown): string {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim().replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
	if (!trimmed || trimmed.includes('..')) return '';
	return trimmed;
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
