import { defaultAvailabilityGrid } from './schedule';
import {
	DEFAULT_IDEALITY_FLOOR_DAYS,
	DEFAULT_SETTINGS,
	DEFAULT_URGENCY_THRESHOLD_DAYS,
	defaultGlancableChrome,
	defaultGlancableLines,
	defaultSortChips,
	type RVLocatorSettings,
	type SortChipId,
} from './types';
import { defaultUrgencyColors } from './urgency-palette';

export type SettingsTabId = 'everyday' | 'urgency' | 'nearby' | 'templates' | 'advanced';

const NEARBY_CHIPS: readonly SortChipId[] = ['distance', 'priority', 'spoke', 'attempted', 'met', 'city', 'urgency'];

/**
 * Copy one tab's defaults onto `settings`. Every other tab, the API key,
 * and the active campaign stay as they are. The Geoapify key is a credential,
 * so Everyday reset leaves it in place.
 */
export function resetSettingsTab(settings: RVLocatorSettings, tab: SettingsTabId): RVLocatorSettings {
	const next: RVLocatorSettings = {
		...settings,
		sortChips: { ...settings.sortChips },
		glancableChrome: { ...settings.glancableChrome },
		glancableLines: { ...settings.glancableLines },
		urgencyThresholdDays: { ...settings.urgencyThresholdDays },
		idealityFloorDays: { ...settings.idealityFloorDays },
		urgencyCustomColors: [...settings.urgencyCustomColors] as RVLocatorSettings['urgencyCustomColors'],
		availabilityGrid: { ...settings.availabilityGrid },
		datePropertiesForWeekday: [...settings.datePropertiesForWeekday],
		homeCounties: [...settings.homeCounties],
	};
	if (tab === 'everyday') applyEveryday(next);
	else if (tab === 'urgency') applyUrgency(next);
	else if (tab === 'nearby') applyNearby(next);
	else if (tab === 'templates') applyTemplates(next);
	else applyAdvanced(next);
	return next;
}

function applyEveryday(next: RVLocatorSettings): void {
	next.geoapifyRegion = DEFAULT_SETTINGS.geoapifyRegion;
	next.homeCounties = [];
	next.availabilityGrid = defaultAvailabilityGrid();
	next.digestOrientation = DEFAULT_SETTINGS.digestOrientation;
	next.digestDays = DEFAULT_SETTINGS.digestDays;
	next.suggestionColor = DEFAULT_SETTINGS.suggestionColor;
	next.openRvInReadingView = DEFAULT_SETTINGS.openRvInReadingView;
	next.abbreviateDayparts = DEFAULT_SETTINGS.abbreviateDayparts;
	next.attemptLogWidth = DEFAULT_SETTINGS.attemptLogWidth;
	next.wideQuickFacts = DEFAULT_SETTINGS.wideQuickFacts;
	next.wideHubsAddress = DEFAULT_SETTINGS.wideHubsAddress;
	next.wideVisitButtons = DEFAULT_SETTINGS.wideVisitButtons;
	next.centerDashboard = DEFAULT_SETTINGS.centerDashboard;
	next.centerVisitNotes = DEFAULT_SETTINGS.centerVisitNotes;
	next.centerSuggestions = DEFAULT_SETTINGS.centerSuggestions;
	next.showUrgencyBadge = DEFAULT_SETTINGS.showUrgencyBadge;
	next.showPriorityBadge = DEFAULT_SETTINGS.showPriorityBadge;
	next.showRouteBadge = DEFAULT_SETTINGS.showRouteBadge;
	next.glancablePaddingY = DEFAULT_SETTINGS.glancablePaddingY;
	next.glancablePaddingX = DEFAULT_SETTINGS.glancablePaddingX;
	next.glancableMaxLineChars = DEFAULT_SETTINGS.glancableMaxLineChars;
	next.glancableFontScale = DEFAULT_SETTINGS.glancableFontScale;
	next.glancableFitCount = DEFAULT_SETTINGS.glancableFitCount;
	next.glancableLines = defaultGlancableLines();
	next.defaultNewRvPriority = DEFAULT_SETTINGS.defaultNewRvPriority;
	next.priorityNudgeEvery = DEFAULT_SETTINGS.priorityNudgeEvery;
	next.visitsNewestFirst = DEFAULT_SETTINGS.visitsNewestFirst;
	next.collapseOlderVisits = DEFAULT_SETTINGS.collapseOlderVisits;
	next.visibleVisitCount = DEFAULT_SETTINGS.visibleVisitCount;
	next.showCardReturnStatus = DEFAULT_SETTINGS.showCardReturnStatus;
	next.campaignListFilter = DEFAULT_SETTINGS.campaignListFilter;
	next.dashboardPagePreview = DEFAULT_SETTINGS.dashboardPagePreview;
}

function applyUrgency(next: RVLocatorSettings): void {
	next.urgencyPalette = DEFAULT_SETTINGS.urgencyPalette;
	next.urgencyCustomColors = defaultUrgencyColors();
	next.urgencyThresholdDays = { ...DEFAULT_URGENCY_THRESHOLD_DAYS };
}

function applyNearby(next: RVLocatorSettings): void {
	next.distanceUnit = DEFAULT_SETTINGS.distanceUnit;
	next.datePropertiesForWeekday = [...DEFAULT_SETTINGS.datePropertiesForWeekday];
	const chips = defaultSortChips();
	for (const id of NEARBY_CHIPS) next.sortChips[id] = chips[id];
}

function applyTemplates(next: RVLocatorSettings): void {
	next.newRvTemplateFile = DEFAULT_SETTINGS.newRvTemplateFile;
	next.homeLogTemplateFile = DEFAULT_SETTINGS.homeLogTemplateFile;
	next.missLogTemplateFile = DEFAULT_SETTINGS.missLogTemplateFile;
	next.returnHubNote = DEFAULT_SETTINGS.returnHubNote;
}

function applyAdvanced(next: RVLocatorSettings): void {
	next.newRvFolder = DEFAULT_SETTINGS.newRvFolder;
	next.appendMetDateToFilename = DEFAULT_SETTINGS.appendMetDateToFilename;
	next.addressProperty = DEFAULT_SETTINGS.addressProperty;
	next.locationProperty = DEFAULT_SETTINGS.locationProperty;
	next.mapLinkProperty = DEFAULT_SETTINGS.mapLinkProperty;
	next.cityProperty = DEFAULT_SETTINGS.cityProperty;
	next.countyProperty = DEFAULT_SETTINGS.countyProperty;
	next.stateProperty = DEFAULT_SETTINGS.stateProperty;
	next.postcodeProperty = DEFAULT_SETTINGS.postcodeProperty;
	next.countryProperty = DEFAULT_SETTINGS.countryProperty;
	next.digestTrySoftMin = DEFAULT_SETTINGS.digestTrySoftMin;
	next.digestAvoidSoftMax = DEFAULT_SETTINGS.digestAvoidSoftMax;
	next.digestAvoidMinTrials = DEFAULT_SETTINGS.digestAvoidMinTrials;
	next.digestTryMinHomes = DEFAULT_SETTINGS.digestTryMinHomes;
	next.territorySpanMiles = DEFAULT_SETTINGS.territorySpanMiles;
	next.idealityFloorDays = { ...DEFAULT_IDEALITY_FLOOR_DAYS };
	next.homeLikelihoodEnabled = DEFAULT_SETTINGS.homeLikelihoodEnabled;
	next.sortChips.ideality = defaultSortChips().ideality;
	next.glancableChrome = defaultGlancableChrome();
	next.distanceTest = DEFAULT_SETTINGS.distanceTest;
	next.testLatitude = DEFAULT_SETTINGS.testLatitude;
	next.testLongitude = DEFAULT_SETTINGS.testLongitude;
}
