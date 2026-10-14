import type { EditorView } from '@codemirror/view';
import { MarkdownView, Menu, Modal, Notice, Platform, Plugin, TFile, WorkspaceLeaf, getFrontMatterInfo, parseYaml, setIcon, type App, type HoverParent, type IconName, type OpenViewState, type ViewState } from 'obsidian';
import { nextPresetSort, sortPresetChipLabel, visibleSortPresets, type NearbyScope } from './active-layout';
import { addressesMatchOneForOne, buildAutocompleteUrl, buildCountySuggestUrl, directionsUrl, normalizeAddress, openExternalUrl, parseGeocodeBody, recentAddresses, refreshBodyMapLink, type GeocodeBias } from './address';
import { ADDRESS_SUGGEST_HOME_RADIUS_M, type SuggestFetchResult } from './address-suggest';
import { collapseAttemptLog, decorateAttemptLog, DIGEST_POLISH_VERSION, upsertAttemptDigest } from './attempt-digest';
import { getCached, rememberResults, sanitizeCache } from './cache';
import {
	GLANCABLE_VIEW_TYPE,
	HOVER_SOURCE,
	REQUEST_GAP_MS,
} from './constants';
import { GeocodeRequestError, geocodeAddress } from './geocode-client';
import { applyGeocodeHit, assignProperty, ensureQuotedLocationList, fillCity, fillSuccessfulVisits, isLockedAddressName, locationPair, planGeocodeWork, readAddress, readProperty, removeProperty, type GeocodeWorkItem, type NoteSnapshot } from './frontmatter';
import { countyFilterParam, decideGeocodePick, hitInHomeCounties, mergeHomeFirst, preferHomeRegion } from './home-base';
import { HUB_STACK_BELOW_PX } from './hub-layout';
import { appendCompanionTaken, companionRecency, formatStoredCompanion, recentCompanionNames as collectRecentCompanionNames, stabilizeCompanionFrontmatter as quoteCompanionFrontmatter } from './companions';
import { resolveExtrasPlacement, type ExtrasPlacement } from './extras-sync';
import { appendLogLine, appendShareToFirstStamp, applyVisitBody, applyVisitFrontmatter, ensureAttemptLog, ensureDashboardLeadBlank, ensureVisitButtons, ensureVisitNotesHeading, formatFrontmatterDateTime, formatVisitStamp, insertHomeHeading, nextVisitNotesProperty, recordLoggedLessons, refreshHomeStampAges, restoreExactVisitClocks, shouldNudgePriority, unfoldDashboard, type VisitOutcome } from './visit-log';
import { applyVisitChangeFrontmatter, describeVisit, editVisit, hintFor, insertVisit, listVisits, removeVisit, resolveVisit, syncMet, visitFacts, type VisitChange, type VisitEntry, type VisitFacts, type VisitHint } from './visit-editor';
import { ConfirmActionModal, LiteraturePromptModal, VisitEditModal, VisitPickModal } from './visit-modals';
import { LESSONS, MEDIA_TITLES, PUBLICATION_TITLES, emptyShare, formatStudyFraction, rememberCustom, renameCustom, renameLabelInMarkdown, shareFromNewRvDraft, shareTitles, studyPrefill, type VisitShare } from './catalog';
import type { ShareFieldOptions } from './catalog-fields';
import { newestLessonProgress } from './visit-share';
import { decorateArchiveButton, decorateMapLink, decorateVisitControls, ensureIconAlias, VisitButtonLongPress, type VisitTarget } from './visit-controls';
import { applyLiveUrgency, decorateNoteChrome, jumpToDayInRoot, revealAttemptLogWhenReady, type NoteChromeHost } from './note-chrome';
import { campaignIsActive, isCovered, localDay, sanitizeCampaign, withCovered, withoutCovered, type CampaignRecord } from './campaign';
import { askCampaignCovered, CampaignModal } from './campaign-modal';
import { hubLabel, mergeHouseholdHubs, moveHubLeft } from './hub-row';
import { HubFileSuggestModal } from './hub-suggester';
import { SlotOverrideModal } from './override-modal';
import { formatSlotOverride, parseSlotOverrides, SLOT_OVERRIDE_PROPERTY, type SlotOverride } from './slot-override';
import { armVisitNoteFocus, blurNoteTitle, layoutVisitNotes, placeVisitNoteFocus } from './visit-display';
import { watchVisitSurface } from './visit-surface';
import { dispatchVisitPreviewRefresh, visitPreviewExtension } from './visit-live-preview';
import { pagePreviewDecision } from './page-preview';
import { shouldHideStatusBar } from './status-bar';
import { paintNoteGlanceCard } from './glance-card';
import { RvMapView, MAP_VIEW_TYPE, mountEmbeddedMap } from './map-view';
import { listedUsCounties } from './us-county-index';
import type { MapPin } from './map-pins';
import { buildMapPins, heatModeForSort, orderByHubSort, pinLookForHub } from './map-pins';
import { shadeHeats } from './map-shade';
import { EditAttributesModal, NewRvIdentityModal, type NewRvIdentity } from './new-rv-modal';
import { PrioritySliderModal } from './priority-modal';
import { applyStatusPriority, resolveStatus, sanitizeCampaignListFilter, sanitizeGender, sanitizeGenderFilter, sanitizeReturnScope, sanitizeSnoozeListFilter, statusForNewNote, type CampaignListFilter, type GenderFilter, type ReturnScope, type RvGender, type RvStatus, type SnoozeListFilter } from './status';
import { fitNotesBox, fitNotesBoxes, isNotesBox } from './notes-autosize';
import { clearVisitNoteCaches, focusVisitNoteField, mountVisitNotesInSection, noteValuesFromFrontmatter, releaseClosedVisitNotes, setActiveVisitNote } from './visit-notes-field';
import { applyExternalVisitNotes, bindVisitNoteFlush } from './visit-notes-store';
import { classifyVisitSection } from './visit-older';
import { calendarDaysSince, dateTextFromUnknown, formatDriveDate, formatGlanceableCounter, parseDriveInstant, stripStampAge } from './dates';
import { clearInkCache } from './color-math';
import { cardPersonTitle, collisionSuffixOnly, filenameCollision, sanitizeNoteName, stripFilenameStamp } from './note-name';
import { cacheStats, clearTileIndex, HOME_PAD_DEG, loadTileIndex } from './tile-index';
import { AccentDriftGate, calloutTypeForChoice, readAccentHsl } from './suggestion-callout';
import { navigatingToFile, withReadingPreview } from './reading-open';
import { isRvDashboardNote, refreshStampAgeLabels } from './rv-note-view';
import { NearbyGlancableView } from './glancable-view';
import { TEMPLATER_PLUGIN_ID, newRvLaunchError, newRvTemplateCandidates } from './new-rv-launch';
import { BulkGeocodeModal, CompanionSuggestModal, GeocodeSuggestModal, SuccessfulVisitsModal, VisitConfirmModal, collectNotes, coveragePronoun, type BulkGeocodeChoice, type CoverageDecision } from './modals';
import { PriorityNudgeModal, ReturnSuggestModal, UrgencySnoozeModal } from './score-modals';
import { fillToastText, watchBottomToast } from './chrome-inset';
import { basenameHasStamp, maskTitleElement, rvDisplayTitle } from './stamp-mask';
import { currentReturnBucket, coveredCampaignFor, daypartAt, headingNewestIndex, readAttemptLog, stampDateTime, suggestReturnDigest, type AttemptBuckets } from './schedule';
import { SNOOZE_LABEL_PROPERTY, SNOOZE_START_PROPERTY, URGENCY_SNOOZE_PROPERTY, formatSnoozeStart, formatSnoozeUntil, parseSnoozeUntil, snoozeActive, snoozeDaysLeft, type SnoozeChoice, type SnoozeWrite } from './snooze';
import { META_BIND_PLUGIN_ID, requiredSetupGaps, shouldPersistSetupWizardCompleted, shouldShowSetupNudge } from './setup-check';
import { SetupWizardModal, readSetupSnapshot, shouldAutoOpenSetupWizard } from './setup-wizard';
import { latLonFromUnknown, validLatLon } from './distance';
import { idealityScore, insidePriorityFloor } from './scoring';
import { urgencyColorsFor } from './urgency-palette';
import { CancelledError, RequestPacer } from './pacer';
import { redactSecrets } from './redact';
import { RVLocatorSettingTab, startExtrasSync } from './settings-tab';
import { DEFAULT_SETTINGS, attemptLogFullWidth, defaultNearbySort, mergeSettings, sanitizeNearbySort, type CacheEntry, type GeocodeHit, type NearbySortPreference, type RVLocatorSettings, type StoredPluginData } from './types';
import { NearbyVanillaView } from './vanilla-view';

function cacheValue(frontmatter: { [key: string]: unknown } | undefined, key: string): unknown {
	return frontmatter?.[key];
}

function frontmatterFromMarkdown(text: string): Record<string, unknown> | null {
	if (typeof text !== 'string') return null;
	const info = getFrontMatterInfo(text);
	const block = typeof info?.frontmatter === 'string' ? info.frontmatter : '';
	if (!info?.exists || !block.trim()) return null;
	const parsed: unknown = parseYaml(block);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	return parsed as Record<string, unknown>;
}

interface NearbyLayout {
	id: string;
	name: string;
	icon: IconName;
	mode: 'vanilla' | 'glancable';
	scope: NearbyScope;
}

/** Long enough to read the unfinished-setup notice and use its buttons. */
const SETUP_NUDGE_MS = 12_000;
/** How often the theme accent is re-read, and open notes' ages re-checked. */
const ACCENT_CHECK_MS = 5_000;
/** Reading view renders after file-open, so ages are refreshed again a little later. */
const AGE_REFRESH_DELAYS_MS = [0, 250, 1_000] as const;
/** Meta Bind mounts its textAreas after the section renders, sometimes well after. */
const NOTES_FIT_DELAYS_MS = [0, 250, 1_000, 2_500] as const;
/** How long to look for a new visit's notes box after the note re-renders. */
const FOCUS_ATTEMPTS = 80;
const FOCUS_STEP_MS = 100;
/**
 * The note's Home button is still dispatching its click when Templater asks
 * for a companion. Opening in that turn lets the click land on the suggester
 * and dismiss it, so the visit logs with nobody chosen.
 */
const COMPANION_PROMPT_DELAY_MS = 40;

const NEARBY_LAYOUTS: readonly NearbyLayout[] = [
	{ id: GLANCABLE_VIEW_TYPE, name: 'Return Visits', icon: 'smartphone', mode: 'glancable', scope: 'all' },
];

export default class RVLocatorPlugin extends Plugin {
	settings: RVLocatorSettings = DEFAULT_SETTINGS;
	nearbySort: NearbySortPreference = defaultNearbySort();
	geocodeCache: Record<string, CacheEntry> = {};
	pacer = new RequestPacer(REQUEST_GAP_MS);
	bulkRunning = false;
	bulkAborted = false;

	private viewRefreshers = new Set<() => void>();
	private attemptBuckets = new Map<string, { mtime: number; buckets: AttemptBuckets }>();
	private attemptPrefetch: Promise<void> | null = null;
	private persistQueued: Promise<void> = Promise.resolve();
	private creatingNewRv = false;
	private wizardOpen = false;
	private unloaded = false;
	/** A setup notice is already on screen, so another view open does not stack a second one. */
	private setupNudgeOpen = false;
	private digestKeyApplied = '';
	private digestPolish = 0;
	private digestRewrite: Promise<void> = Promise.resolve();
	private accentGate = new AccentDriftGate();
	/** Last file each leaf was switched for, so a later switch to editing is kept. */
	private readingViewFor = new WeakMap<WorkspaceLeaf, string>();
	private newRvDraft: NewRvIdentity | null = null;
	/** Note text for the campaign chip. The Log block does not have to be on screen. */
	private noteBodies = new Map<string, string>();
	private maskingStamps = false;
	private readonly stampHeaders = new WeakSet<HTMLElement>();
	private readonly visitSurfaces = new WeakSet<HTMLElement>();
	/** Picked Geoapify hit whose formatted address was submitted unchanged. */
	private verifiedNewRvHit: GeocodeHit | null = null;
	/** The next geocode of a note this plugin just created stays quiet. */
	private quietCreateGeocode = false;
	private glancePainters = new Set<(parent: HTMLElement, path: string) => boolean>();
	private glanceWidths = new Set<() => number>();
	private glanceLayouts = new Set<{ read: () => number; root: HTMLElement | null }>();
	/** Set while Add a housemate is creating a note. The template skips geocode. */
	housemateSourcePath: string | null = null;
	private homeBiasKey = '';
	private homeBiasPoint: GeocodeBias | null = null;
	/** Hub lists written before the metadata cache catches up, so the chip row updates immediately. */
	private hubOverride = new Map<string, unknown>();
	/** Dates written by a visit, used until the metadata cache catches up. */
	private visitPaint = new Map<string, { attempted: unknown; spoke: unknown }>();
	/** Frontmatter from metadataCache 'changed', not a read that raced the update. */
	private cachedFrontmatter = new Map<string, Record<string, unknown>>();
	/** New RV focus waits for the template prompt to close. No clock during the prompt. */
	private pendingNewRvPath: string | null = null;
	private armedNewRvPath: string | null = null;
	private armedNewRvEl: HTMLElement | null = null;
	private stopVisitFocus: (() => void) | null = null;
	private noteMapResize: ResizeObserver | null = null;
	/** Address typed into the custom box before the cache catches up. */
	private addressOverride = new Map<string, string>();
	/** Value already handed to an in-flight address write. Blocks blur+change doubles. */
	private addressCommit = new Map<string, string>();
	/** One campaign at a time. Null when none is saved. */
	campaign: CampaignRecord | null = null;
	/** Coverage answers collected beside the companion prompt, keyed by note path. */
	private coverageDecisions = new Map<string, CoverageDecision>();

	async onload(): Promise<void> {
		await this.loadPluginData();
		this.installReadingModeOpen();
		this.addSettingTab(new RVLocatorSettingTab(this.app, this));
		this.registerHoverLinkSource(HOVER_SOURCE, {
			display: 'RV Locator',
			defaultMod: false,
		});

		this.addCommand({
			id: 'new-rv',
			name: 'New RV',
			callback: () => { void this.createNewRv(); },
		});

		this.addCommand({
			id: 'geocode-current-note',
			name: 'Geocode current note',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const available = !!file && file.extension === 'md';
				if (available && !checking) void this.geocodeCurrent();
				return available;
			},
		});

		this.addCommand({
			id: 'bulk-geocode',
			name: 'Bulk geocode folder/vault',
			callback: () => {
				const modal = new BulkGeocodeModal(this.app, this, (choice, report) => this.runBulk(choice, report));
				modal.open();
			},
		});

		this.addCommand({
			id: 'fill-successful-visits',
			name: 'Fill Successful Visits from Visits',
			callback: () => {
				const modal = new SuccessfulVisitsModal(this.app, this, (choice, report) => this.runSuccessfulVisitsFill(choice, report));
				modal.open();
			},
		});

		this.addCommand({
			id: 'suggest-return-times',
			name: 'Suggest return times',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const available = !!file && file.extension === 'md';
				if (available && !checking && file) void this.suggestReturnFor(file.path, file.basename);
				return available;
			},
		});

		this.addCommand({
			id: 'log-past-visit',
			name: 'Log past visit',
			checkCallback: (checking) => {
				const file = this.activeMarkdownFile();
				if (file && !checking) this.promptPastVisit(file);
				return file != null;
			},
		});

		this.addCommand({
			id: 'edit-visit',
			name: 'Edit or delete a visit',
			checkCallback: (checking) => {
				const file = this.activeMarkdownFile();
				if (file && !checking) void this.pickVisit(file);
				return file != null;
			},
		});

		this.addCommand({
			id: 'archive-rv',
			name: 'Archive or unarchive RV',
			checkCallback: (checking) => {
				const file = this.activeMarkdownFile();
				if (file && !checking) this.confirmArchive(file);
				return file != null;
			},
		});

		this.addCommand({
			id: 'add-housemate',
			name: 'Add a housemate',
			checkCallback: (checking) => {
				const file = this.activeMarkdownFile();
				if (file && !checking) void this.addHousemate(file);
				return file != null;
			},
		});

		const registered = NEARBY_LAYOUTS.map((layout) => this.registerBasesView(layout.id, {
			name: layout.name,
			icon: layout.icon,
			factory: (controller, containerEl) => layout.mode === 'vanilla'
				? new NearbyVanillaView(controller, containerEl, this, layout.id, layout.scope)
				: new NearbyGlancableView(controller, containerEl, this, layout.id, layout.scope),
		}));
		if (registered.some((ok) => !ok)) {
			new Notice('Turn on the Bases core plugin to use Nearby.');
		}
		this.registerView(MAP_VIEW_TYPE, (leaf) => new RvMapView(leaf, this));
		bindVisitNoteFlush((path, writes) => {
			const file = this.app.vault.getFileByPath(path);
			if (!(file instanceof TFile) || this.unloaded) return;
			void this.app.fileManager.processFrontMatter(file, (data) => {
				for (const [key, value] of Object.entries(writes)) data[key] = value;
			});
		});
		const openVisitMenuFromStamp = (evt: Event): void => {
			const detail = (evt as CustomEvent<{ when?: number; event?: MouseEvent }>).detail;
			if (!detail || typeof detail.when !== 'number') return;
			const node = evt.target instanceof HTMLElement ? evt.target : null;
			const path = (node && this.pathForSurface(node)) || this.app.workspace.getActiveFile()?.path || '';
			if (!path) return;
			this.openVisitMenu(path, {
				when: new Date(detail.when),
				home: true,
				ordinal: 0,
				fileLine: null,
			}, detail.event ?? (evt as MouseEvent));
		};
		window.addEventListener('rv-open-visit-menu', openVisitMenuFromStamp);
		this.register(() => window.removeEventListener('rv-open-visit-menu', openVisitMenuFromStamp));
		this.registerEditorExtension(visitPreviewExtension(
			() => ({
				collapseOlder: this.settings.collapseOlderVisits,
				limit: this.settings.visibleVisitCount,
			}),
			(view) => this.pathForSurface(view.dom) || this.app.workspace.getActiveFile()?.path || '',
			(dom) => {
				const path = this.pathForSurface(dom) || this.app.workspace.getActiveFile()?.path || '';
				if (!path) return;
				const file = this.app.vault.getFileByPath(path);
				const front = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
				applyExternalVisitNotes(path, noteValuesFromFrontmatter(front ?? null));
				applyLiveUrgency(dom, path, this.noteChromeHost(), true);
			},
		));

		this.registerMarkdownPostProcessor((element, context) => {
			const path = context.sourcePath;
			const coveredFor = (when: Date, line = -1, domIndex = 0): string | null => {
				if (!this.noteBodies.has(path)) return null;
				const body = this.noteBodies.get(path) ?? '';
				const newestIndex = line >= 0 ? headingNewestIndex(body, when, line) : domIndex;
				return coveredCampaignFor(body, when, newestIndex);
			};
			applyLiveUrgency(element, path, this.noteChromeHost());
			const hasCallout = element.classList.contains('callout') || element.querySelector('.callout') != null;
			decorateAttemptLog(element, hasCallout ? this.suggestionCalloutType() : undefined);
			refreshStampAgeLabels(element);
			this.decorateOpenNote(element, path);
			if (this.pendingNewRvPath === path) {
				const file = this.app.vault.getFileByPath(path);
				if (file) this.armNewRvFocus(file);
			}
			const reading = element.closest('.markdown-preview-view, .markdown-reading-view');
			if (reading instanceof HTMLElement) reading.dataset.rvNoteFile = path;
			element.dataset.rvNoteFile = path;
			decorateVisitControls(
				element,
				() => context.getSectionInfo(element)?.lineStart ?? null,
				(target, evt) => this.openVisitMenu(path, target, evt),
				coveredFor,
			);
			applyLiveUrgency(element, path, this.noteChromeHost());
			const info = context.getSectionInfo(element);
			const body = this.noteBodies.get(path) ?? '';
			if (info && body) {
				classifyVisitSection(element, path, body, info.lineStart, info.lineEnd, {
					limit: this.settings.visibleVisitCount,
					collapseOlder: this.settings.collapseOlderVisits,
				});
			}
			mountVisitNotesInSection(element, context, this.app);
			const file = this.app.vault.getFileByPath(path);
			if (file && !this.noteBodies.has(path)) this.rememberNoteText(file);
			this.bindVisitSurface(element, path);
			const lastDelay = NOTES_FIT_DELAYS_MS[NOTES_FIT_DELAYS_MS.length - 1] ?? 2_500;
			for (const delay of NOTES_FIT_DELAYS_MS) {
				window.setTimeout(() => {
					if (this.unloaded || !element.isConnected) return;
					fitNotesBoxes(element);
					this.refreshVisitCards(path, element, delay === lastDelay, false);
				}, delay);
			}
		});

		this.registerDomEvent(document, 'input', (evt) => {
			if (isNotesBox(evt.target)) fitNotesBox(evt.target);
		});
		this.registerDomEvent(document, 'focusin', (evt) => {
			if (isNotesBox(evt.target)) fitNotesBox(evt.target);
		});
		this.registerDomEvent(window, 'resize', () => this.scheduleNotesFit());
		ensureIconAlias('rotate-ccw-clock', 'history');
		const longPress = new VisitButtonLongPress();
		this.registerDomEvent(document, 'touchstart', (evt) => longPress.start(evt), { passive: true });
		for (const type of ['touchend', 'touchmove', 'touchcancel'] as const) {
			this.registerDomEvent(document, type, () => longPress.cancel(), { passive: true });
		}
		this.registerDomEvent(document, 'mouseover', (evt) => longPress.hover(evt));
		this.registerDomEvent(document, 'click', (evt) => longPress.swallow(evt), { capture: true });
		this.registerDomEvent(document, 'contextmenu', (evt) => longPress.swallow(evt), { capture: true });
		this.registerDomEvent(document, 'mouseover', (evt) => this.suppressPagePreview(evt), { capture: true });
		this.applyLayoutClasses();

		this.registerEvent(this.app.vault.on('create', (file) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			void this.watchCreatedDigest(file);
		}));

		this.app.workspace.onLayoutReady(() => {
			void this.syncSetupCompletion();
			void this.applyDigestPolish();
			this.checkAccent();
			this.onNoteOpened(this.app.workspace.getActiveFile());
		});
		this.registerEvent(this.app.workspace.on('file-open', (file) => this.onNoteOpened(file)));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			const active = this.app.workspace.getActiveFile();
			setActiveVisitNote(active?.path ?? '');
			if (active) void this.openInReadingView(active, false);
			this.scheduleAgeRefresh();
			this.applyLayoutClasses();
			this.maskFilenameStamps();
		}));
		this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
			// The file string is the write that just landed. getFileCache() can
			// still be the previous frontmatter for this turn.
			let frontmatter: Record<string, unknown> | undefined;
			if (typeof data === 'string') frontmatter = frontmatterFromMarkdown(data) ?? undefined;
			if (!frontmatter && cache && typeof cache === 'object' && 'frontmatter' in cache) {
				const fromCache = (cache as { frontmatter?: Record<string, unknown> }).frontmatter;
				if (fromCache) frontmatter = fromCache;
			}
			if (file instanceof TFile && frontmatter) {
				this.cachedFrontmatter.set(file.path, { ...frontmatter });
				applyExternalVisitNotes(file.path, noteValuesFromFrontmatter(frontmatter));
			}
			const active = this.app.workspace.getActiveFile();
			if (!active || file.path === active.path) this.applyLayoutClasses();
			if (file instanceof TFile) this.rememberNoteText(file);
			this.maskFilenameStamps();
			const repaint = (): void => {
				if (this.unloaded) return;
				this.repaintOpenUrgency();
				this.refreshOpenNoteChrome();
			};
			repaint();
			window.requestAnimationFrame(repaint);
		}));
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'md') this.rememberNoteText(file);
		}));
		const onOpenVisit = (evt: Event): void => {
			const detail = (evt as CustomEvent<{ target?: VisitTarget; event?: MouseEvent }>).detail;
			const path = this.app.workspace.getActiveFile()?.path;
			if (!path || !detail?.target || !detail.event) return;
			this.openVisitMenu(path, detail.target, detail.event);
		};
		document.addEventListener('rv-open-visit', onOpenVisit);
		this.register(() => document.removeEventListener('rv-open-visit', onOpenVisit));
		this.installStampMask();
		this.registerEvent(this.app.workspace.on('css-change', () => {
			clearInkCache();
			for (const callback of this.viewRefreshers) callback();
			this.repaintOpenUrgency();
			window.requestAnimationFrame(() => this.repaintOpenUrgency());
		}));
		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.scheduleAgeRefresh();
			this.releaseClosedVisitNotes();
		}));
		this.registerEvent(this.app.workspace.on('css-change', () => {
			this.recolorOpenSuggestions();
			this.checkAccent();
		}));
		this.registerInterval(window.setInterval(() => {
			this.checkAccent();
			this.refreshOpenAges();
		}, ACCENT_CHECK_MS));
		this.digestKeyApplied = this.digestKey();
	}

	/** Body classes for the center-align toggles and the Attempt Log width. */
	applyLayoutClasses(): void {
		const on = !this.unloaded;
		const body = document.body;
		body.toggleClass('rv-center-dashboard', on && this.settings.centerDashboard);
		body.toggleClass('rv-center-visit-notes', on && this.settings.centerVisitNotes);
		body.toggleClass('rv-center-suggestions', on && this.settings.centerSuggestions);
		body.toggleClass('rv-attempt-log-wide', on && attemptLogFullWidth(this.settings));
		body.toggleClass('rv-wide-quick-facts', on && this.settings.wideQuickFacts);
		body.toggleClass('rv-wide-hubs', on && this.settings.wideHubsAddress);
		body.toggleClass('rv-wide-visit-buttons', on && this.settings.wideVisitButtons);
		body.toggleClass('rv-suggestions-outside-left', on && this.settings.leftAlignSuggestionBullets);
		body.toggleClass('rv-full-width-callout', on && this.settings.fullWidthCallout);
		body.toggleClass('rv-map-open', on && this.hubMapOpen);
		body.toggleClass('rv-hide-statusbar', on && shouldHideStatusBar(this.noteHidesStatusBar(), this.settings.hideStatusBar, this.standaloneBaseOpen()));
	}

	private noteHidesStatusBar(): boolean {
		const file = this.app.workspace.getActiveFile();
		if (!file) return false;
		const data = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!data) return false;
		const record = data as { cssclasses?: unknown; cssclass?: unknown };
		const classes = record.cssclasses ?? record.cssclass;
		const list: unknown[] = Array.isArray(classes) ? classes : typeof classes === 'string' ? classes.split(/[\s,]+/) : [];
		return list.some((item) => String(item).trim().toLowerCase() === 'rv-hide-statusbar');
	}

	private standaloneBaseOpen(): boolean {
		const leaf = this.app.workspace.getMostRecentLeaf();
		const root = leaf?.view?.containerEl;
		if (!(root instanceof HTMLElement)) return false;
		if (root.closest('.markdown-embed, .internal-embed')) return false;
		return root.querySelector('.rv-locator-view') != null;
	}

	/** Map earth, archive label, Quick Facts, and the shared Hub row. Meta Bind may remount, so this runs again. */
	private decorateOpenNote(element: HTMLElement, path: string): void {
		decorateMapLink(element, () => { void this.openMapSoon(path); });
		this.bindAddressMapClick(element, path);
		decorateArchiveButton(element, this.pathIsInactive(path));
		decorateNoteChrome(element, path, this.noteChromeHost());
		this.layoutOpenVisits(element, path);
		applyLiveUrgency(element, path, this.noteChromeHost(), true);
	}

	/** Address text is a link Obsidian may handle before the bubble listener. Capture it. */
	private bindAddressMapClick(element: HTMLElement, path: string): void {
		if (element.dataset.rvMapClicks === path) return;
		element.dataset.rvMapClicks = path;
		element.addEventListener('click', (event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			if (target.closest('a.rv-map-button, input, button, .rv-label-icon')) return;
			if (!target.closest('a.rv-address-link, .rv-address-field')) return;
			event.preventDefault();
			event.stopPropagation();
			void this.openMapSoon(path);
		}, true);
	}

	/**
	 * Page Preview stays off on the RV Dashboard and Glancable cards unless the
	 * setting is on. On uses core's `preview` source. A custom hover source
	 * does not open the core popover, and returning early left the hover closed.
	 */
	private suppressPagePreview(evt: MouseEvent): void {
		const target = evt.target;
		if (!(target instanceof Element)) return;
		const link = target.closest('a.internal-link, a.rv-locator-file-link');
		const inScope = link instanceof HTMLAnchorElement && !!link.closest('.rv-locator-glancable, .rv-dashboard');
		const decision = pagePreviewDecision(this.settings.dashboardPagePreview, inScope);
		if (!decision.suppress || !(link instanceof HTMLAnchorElement)) return;
		evt.stopPropagation();
		if (!decision.open) return;
		const raw = link.dataset.href || link.getAttribute('href') || '';
		const linktext = raw.replace(/\.md$/i, '').trim();
		if (!linktext) return;
		const found = this.previewParent(link);
		this.app.workspace.trigger('hover-link', {
			event: evt,
			source: 'preview',
			hoverParent: found.parent,
			targetEl: link,
			linktext,
			sourcePath: found.sourcePath,
		});
	}

	/** The markdown view when the link is in a note, otherwise the leaf that holds it. */
	private previewParent(link: Element): { parent: HoverParent; sourcePath: string } {
		const found: { leaf: WorkspaceLeaf | null; el: HTMLElement | null } = { leaf: null, el: null };
		this.app.workspace.iterateAllLeaves((leaf) => {
			const el = leaf.view?.containerEl;
			if (!el?.contains(link)) return;
			if (found.el && !found.el.contains(el)) return;
			found.el = el;
			found.leaf = leaf;
		});
		const leaf = found.leaf;
		if (leaf?.view instanceof MarkdownView) return { parent: leaf.view, sourcePath: leaf.view.file?.path ?? '' };
		if (leaf) return { parent: leaf, sourcePath: '' };
		return { parent: { hoverPopover: null }, sourcePath: '' };
	}

	private layoutOpenVisits(element: HTMLElement, path: string): void {
		if (!element.isConnected) return;
		const shown = this.pathForSurface(element) || path;
		const markdown = this.noteBodies.get(shown) ?? '';
		if (!markdown) return;
		element.dataset.rvNoteFile = shown;
		layoutVisitNotes(element, markdown, {
			newestFirst: this.settings.visitsNewestFirst,
			collapseOlder: this.settings.collapseOlderVisits,
			limit: this.settings.visibleVisitCount,
		});
	}

	/** Live Preview Older Visits reads settings at decoration time. Effects only, never the note. */
	private refreshVisitPreviewEditors(): void {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			const cm = (view.editor as { cm?: EditorView }).cm;
			if (!cm) continue;
			dispatchVisitPreviewRefresh(cm);
		}
	}

	/** Badge toggles and visit-order settings repaint notes that are already open. */
	private refreshOpenNoteChrome(): void {
		if (this.unloaded) return;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) continue;
			this.decorateOpenNote(view.containerEl, view.file.path);
		}
	}

	private onNoteOpened(file: TFile | null): void {
		setActiveVisitNote(file?.path ?? '');
		this.applyLayoutClasses();
		this.scheduleAgeRefresh();
		this.scheduleNotesFit();
		this.maybeSessionLocationNotice();
		this.maskFilenameStamps();
		if (this.noteMapOpen && file?.path !== this.mapFocusPath) {
			this.noteMapOpen = false;
			this.hubMapOpen = false;
			this.syncNoteMap();
		} else if (this.noteMapOpen) {
			this.syncNoteMap();
		}
		if (file) void this.openInReadingView(file, false);
		if (file && this.pendingNewRvPath === file.path) this.armNewRvFocus(file);
		else if (file && this.pendingNewRvPath && file.path !== this.pendingNewRvPath) {
			this.pendingNewRvPath = null;
			this.armedNewRvPath = null;
			this.armedNewRvEl = null;
			this.stopVisitFocus?.();
			this.stopVisitFocus = null;
		}
		if (!file) return;
		this.rememberNoteText(file);
		this.primeOpenUrgency(file);
		this.scheduleReadingDecorate(file);
	}

	/** Reading view paints section by section. Run the visit decorate pass again after each of those paints. */
	private scheduleReadingDecorate(file: TFile): void {
		const path = file.path;
		for (const delay of NOTES_FIT_DELAYS_MS) {
			window.setTimeout(() => {
				if (this.unloaded) return;
				this.refreshVisitCards(path, undefined, false, true);
			}, delay);
		}
	}

	/** Counter ink follows the palette and the theme on notes that are already open. */
	private repaintOpenUrgency(): void {
		if (this.unloaded) return;
		const host = this.noteChromeHost();
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) continue;
			applyLiveUrgency(view.containerEl, view.file.path, host, true);
		}
	}

	private rememberNoteText(file: TFile): void {
		void this.app.vault.cachedRead(file).then((text) => {
			if (this.unloaded) return;
			const previous = this.noteBodies.get(file.path);
			this.noteBodies.set(file.path, text);
			if (previous === text) return;
			this.redecorateVisits(file.path);
		});
	}

	private redecorateVisits(path: string): void {
		if (this.unloaded) return;
		this.refreshVisitCards(path, undefined, false, true);
	}

	/**
	 * Reading view renders one markdown block at a time, and virtualization
	 * swaps those blocks back in without another post-processor pass. Refresh
	 * the live preview surface so the note box, campaign chip, and counter ink
	 * catch a paragraph that arrives later or a heading that was recycled.
	 */
	private refreshVisitCards(path: string, fallback?: HTMLElement, chrome = false, notesFallback = false): void {
		if (this.unloaded || !path) return;
		const surfaces: HTMLElement[] = [];
		if (fallback?.isConnected) surfaces.push(fallback);
		for (const surface of surfaces) this.refreshVisitSurface(path, surface, chrome, notesFallback);
	}

	private refreshVisitSurface(path: string, surface: HTMLElement, chrome: boolean, notesFallback: boolean): void {
		const shown = this.pathForSurface(surface) || path;
		if (shown !== path) return;
		surface.dataset.rvNoteFile = shown;
		const coveredFor = (when: Date, line = -1, domIndex = 0): string | null => {
			if (!this.noteBodies.has(shown)) return null;
			const body = this.noteBodies.get(shown) ?? '';
			const newestIndex = line >= 0 ? headingNewestIndex(body, when, line) : domIndex;
			return coveredCampaignFor(body, when, newestIndex);
		};
		decorateVisitControls(
			surface,
			() => null,
			(target, evt) => this.openVisitMenu(shown, target, evt),
			coveredFor,
		);
		applyLiveUrgency(surface, shown, this.noteChromeHost(), true);
		if (chrome) this.decorateOpenNote(surface, shown);
		else this.layoutOpenVisits(surface, shown);
		this.bindVisitSurface(surface, shown);
		void notesFallback;
	}

	/** A closed markdown view drops its note cache. The open note keeps its own. */
	private releaseClosedVisitNotes(): void {
		const open = new Set<string>();
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file) open.add(view.file.path);
		}
		releaseClosedVisitNotes(open);
	}

	private pathForSurface(surface: HTMLElement): string {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.containerEl.contains(surface)) return view.file?.path ?? '';
		}
		return '';
	}

	/** Scroll and block mount. Our own card edits are ignored so this cannot loop. */
	private bindVisitSurface(start: HTMLElement, path: string): void {
		const surface = start.classList.contains('markdown-preview-view') || start.classList.contains('markdown-reading-view')
			? start
			: start.closest('.markdown-preview-view, .markdown-reading-view');
		if (!(surface instanceof HTMLElement) || this.visitSurfaces.has(surface)) return;
		this.visitSurfaces.add(surface);
		const watch = watchVisitSurface(surface, () => {
			if (this.unloaded) return;
			const livePath = this.pathForSurface(surface) || path;
			this.refreshVisitCards(livePath, surface, false, true);
		});
		this.registerDomEvent(surface, 'scroll', () => {
			if (!this.unloaded) watch.schedule();
		}, { passive: true });
		this.register(() => watch.stop());
	}

	/**
	 * The stamp stays on disk. Only the leaf tab title is rewritten, and only
	 * as text. The view header is contenteditable core UI, same as the
	 * breadcrumb, the inline title, the file explorer, search, and the quick
	 * switcher. None of those are rewritten.
	 */
	private installStampMask(): void {
		this.maskFilenameStamps();
		this.registerEvent(this.app.workspace.on('layout-change', () => this.maskFilenameStamps()));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.maskFilenameStamps()));
	}

	private stampPairs(): { stamped: string; display: string }[] {
		const pairs: { stamped: string; display: string }[] = [];
		const seen = new Set<string>();
		const add = (basename: string, rv: boolean): void => {
			if (!rv || !basenameHasStamp(basename) || seen.has(basename)) return;
			const display = rvDisplayTitle(basename);
			if (!display || display === basename) return;
			seen.add(basename);
			pairs.push({ stamped: basename, display });
		};
		for (const file of this.app.vault.getMarkdownFiles()) {
			const data = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
			add(file.basename, isRvDashboardNote(data));
		}
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) continue;
			const rendered = view.containerEl.querySelector('.rv-dashboard') != null;
			add(view.file.basename, rendered || isRvDashboardNote(this.app.metadataCache.getFileCache(view.file)?.frontmatter as Record<string, unknown> | undefined));
		}
		return pairs;
	}

	private maskFilenameStamps(): void {
		if (this.maskingStamps || this.unloaded) return;
		const pairs = this.stampPairs();
		if (pairs.length === 0) return;
		this.maskingStamps = true;
		try {
			this.app.workspace.iterateAllLeaves((leaf) => {
				const view = leaf.view;
				const file = view instanceof MarkdownView ? view.file : null;
				if (!file) return;
				const pair = pairs.find((item) => item.stamped === file.basename);
				if (!pair) return;
				const tab = (leaf as WorkspaceLeaf & { tabHeaderInnerTitleEl?: HTMLElement }).tabHeaderInnerTitleEl;
				if (tab) {
					maskTitleElement(tab, [pair]);
					this.watchStampHeader(tab);
				}
			});
		} finally {
			this.maskingStamps = false;
		}
	}

	/** Re-apply after Obsidian writes the filename back. Never watches the editor or the file explorer. */
	private watchStampHeader(header: HTMLElement): void {
		if (this.stampHeaders.has(header) || typeof MutationObserver === 'undefined') return;
		this.stampHeaders.add(header);
		const observer = new MutationObserver(() => {
			if (this.maskingStamps || this.unloaded) return;
			this.maskFilenameStamps();
		});
		observer.observe(header, { subtree: true, childList: true, characterData: true });
		this.register(() => observer.disconnect());
	}

	/** Accent vars on the leaf before the preview's first paint. */
	private primeOpenUrgency(file: TFile): void {
		const host = this.noteChromeHost();
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== file.path) continue;
			applyLiveUrgency(view.containerEl, file.path, host);
		}
	}

	private locationNoticeClaimed = false;
	private locationNoticePending = false;

	/** One no-location or desktop-testing notice per app launch. */
	notifyLocationOnce(text: string): void {
		const message = text.trim();
		if (!message || this.locationNoticeClaimed) return;
		this.locationNoticeClaimed = true;
		new Notice(message, 4500);
	}

	private maybeSessionLocationNotice(): void {
		if (this.locationNoticeClaimed || this.locationNoticePending) return;
		if (this.settings.distanceTest) {
			const lat = this.settings.testLatitude;
			const lon = this.settings.testLongitude;
			this.notifyLocationOnce(`Desktop distance testing is on, using ${lat}, ${lon} instead of this device. Distance is not written into notes.`);
			return;
		}
		const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
		if (!geo) {
			this.notifyLocationOnce('This desktop has no position, so distance shows a dash. Obsidian Mobile can use GPS. Distance is not written into notes.');
			return;
		}
		this.locationNoticePending = true;
		geo.getCurrentPosition(
			() => {
				this.locationNoticeClaimed = true;
				this.locationNoticePending = false;
			},
			() => {
				this.locationNoticePending = false;
				this.notifyLocationOnce('This desktop has no position, so distance shows a dash. Obsidian Mobile can use GPS. Distance is not written into notes.');
			},
			{ enableHighAccuracy: false, maximumAge: 60_000, timeout: 4_000 },
		);
	}

	/**
	 * Put preview into the open state before the leaf renders. A later mode
	 * toggle on the same file is left alone, so Live Preview stays available.
	 */
	private installReadingModeOpen(): void {
		const proto = WorkspaceLeaf.prototype;
		const openFile = proto.openFile;
		const setViewState = proto.setViewState;
		const plugin = this;
		proto.openFile = function (this: WorkspaceLeaf, file: TFile, openState?: OpenViewState) {
			return openFile.call(this, file, plugin.previewStateFor(file, openState));
		};
		proto.setViewState = function (this: WorkspaceLeaf, viewState: ViewState, eState?: unknown) {
			return setViewState.call(this, plugin.previewViewState(this, viewState), eState);
		};
		this.register(() => {
			proto.openFile = openFile;
			proto.setViewState = setViewState;
		});
	}

	private previewStateFor(file: TFile, openState?: OpenViewState): OpenViewState | undefined {
		if (!this.noteOpensInReading(file)) return openState;
		return withReadingPreview(openState);
	}

	private previewViewState(leaf: WorkspaceLeaf, viewState: ViewState): ViewState {
		const nextPath = typeof viewState.state?.file === 'string' ? viewState.state.file : '';
		const current = leaf.view instanceof MarkdownView ? leaf.view.file?.path ?? '' : '';
		if (!navigatingToFile(current, nextPath)) return viewState;
		const file = this.app.vault.getFileByPath(nextPath);
		if (!(file instanceof TFile) || !this.noteOpensInReading(file)) return viewState;
		return withReadingPreview(viewState);
	}

	private noteOpensInReading(file: TFile): boolean {
		if (!this.settings.openRvInReadingView || this.isTemplateNote(file)) return false;
		if (this.pendingNewRvPath === file.path) return true;
		const cached = this.cachedFrontmatter.get(file.path);
		const frontmatter = cached ?? this.app.metadataCache.getFileCache(file)?.frontmatter;
		return isRvDashboardNote(frontmatter);
	}

	/**
	 * Show an RV note in Reading view the first time a leaf displays it.
	 * `force` is for a new note whose template finished after it was opened.
	 * A leaf that already showed the note keeps the mode the user chose.
	 */
	private async openInReadingView(file: TFile, force: boolean): Promise<void> {
		if (this.unloaded) return;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== file.path) continue;
			if (!force && !this.noteOpensInReading(file)) continue;
			const seen = this.readingViewFor.get(leaf);
			this.readingViewFor.set(leaf, file.path);
			if (!force && seen === file.path) continue;
			if (view.getMode() === 'preview') continue;
			const state = leaf.getViewState();
			const inner = state.state && typeof state.state === 'object' ? state.state : {};
			try {
				await leaf.setViewState({ ...state, state: { ...inner, mode: 'preview', source: false } });
			} catch {
				/* Leave the leaf as it is. The visit focus still runs. */
			}
		}
	}

	private scheduleAgeRefresh(): void {
		for (const delay of AGE_REFRESH_DELAYS_MS) {
			window.setTimeout(() => this.refreshOpenAges(), delay);
		}
	}

	/**
	 * Every visit notes box in open notes grows to its text, up to five
	 * lines, or shrinks away space left from a narrower screen.
	 */
	private scheduleNotesFit(): void {
		for (const delay of NOTES_FIT_DELAYS_MS) {
			window.setTimeout(() => {
				if (this.unloaded) return;
				for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
					if (leaf.view instanceof MarkdownView) fitNotesBoxes(leaf.view.containerEl);
				}
			}, delay);
		}
	}

	/** Recompute the `x days ago` labels shown in every open note. Files are not written. */
	private refreshOpenAges(): void {
		if (this.unloaded) return;
		const today = new Date();
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView) refreshStampAgeLabels(leaf.view.containerEl, today);
		}
	}

	private recolorOpenSuggestions(): void {
		if (this.unloaded) return;
		const type = this.suggestionCalloutType();
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view instanceof MarkdownView) decorateAttemptLog(leaf.view.containerEl, type);
		}
	}

	/**
	 * With Automatic color, a settled accent change recolors Return
	 * Suggestions in notes that are already open. The files stay as they are.
	 * Changing a digest setting still rewrites the stored table.
	 */
	private checkAccent(): void {
		if (this.unloaded || this.settings.suggestionColor !== 'auto') return;
		const type = this.suggestionCalloutType();
		if (!this.accentGate.observe(type)) return;
		this.accentGate.markApplied(type);
		this.digestKeyApplied = this.digestKey();
		this.recolorOpenSuggestions();
		void this.persist();
	}

	/**
	 * Same path as Templater’s create-from-template after New RV is chosen.
	 * The template prompts for the householder and Address, then schedules geocode.
	 * This plugin does not write the note or Address itself.
	 */
	async createNewRv(): Promise<void> {
		if (this.creatingNewRv) return;
		const identity = await new Promise<NewRvIdentity | null>((resolve) => {
			new NewRvIdentityModal(this.app, {
				defaultPriority: this.settings.defaultNewRvPriority,
				companions: this.recentCompanionNames(),
				publications: [...PUBLICATION_TITLES, ...this.settings.customPublications],
				media: [...MEDIA_TITLES, ...this.settings.customMedia],
				lessons: [...LESSONS],
				customLessons: this.settings.customLessons,
				suggestHome: (query) => this.suggestAddressHome(query),
				suggestBroad: (query) => this.suggestAddressBroad(query),
				addressCache: () => this.addressSuggestCacheMap(),
			}, (value) => resolve(value)).open();
		});
		if (!identity || this.unloaded) return;
		this.newRvDraft = identity;
		this.housemateSourcePath = null;
		this.quietCreateGeocode = true;
		const verified = identity.verifiedHit;
		this.verifiedNewRvHit = verified && addressesMatchOneForOne(identity.address, verified.formattedAddress)
			? verified
			: null;
		await this.launchNewRvTemplate();
	}

	/** Another RV at this address. Same choices as New RV. The address starts filled in. */
	async addHousemate(file: TFile): Promise<void> {
		if (this.creatingNewRv) return;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const address = readAddress(frontmatter, this.settings.addressProperty) ?? '';
		const gender = housemateGender(readProperty(frontmatter, 'Gender'));
		const priority = finiteVisitCount(readProperty(frontmatter, 'Priority')) ?? this.settings.defaultNewRvPriority;
		const identity = await new Promise<NewRvIdentity | null>((resolve) => {
			new NewRvIdentityModal(this.app, {
				title: 'Add a housemate',
				intro: 'Same choices. The address starts filled in.',
				defaultPriority: this.settings.defaultNewRvPriority,
				companions: this.recentCompanionNames(),
				publications: [...PUBLICATION_TITLES, ...this.settings.customPublications],
				media: [...MEDIA_TITLES, ...this.settings.customMedia],
				lessons: [...LESSONS],
				customLessons: this.settings.customLessons,
				suggestHome: (query) => this.suggestAddressHome(query),
				suggestBroad: (query) => this.suggestAddressBroad(query),
				addressCache: () => this.addressSuggestCacheMap(),
				preset: {
					gender,
					address,
					priority: Math.max(0, Math.min(5, Math.round(priority))),
				},
			}, (value) => resolve(value)).open();
		});
		if (!identity || this.unloaded) return;
		this.newRvDraft = identity;
		this.verifiedNewRvHit = null;
		this.housemateSourcePath = file.path;
		await this.launchNewRvTemplate();
	}

	private async suggestAddresses(query: string): Promise<readonly GeocodeHit[]> {
		if (!this.settings.geoapifyApiKey.trim()) return [];
		try {
			const bias = await this.homeProximity();
			const hits = await this.lookupAddress(query, true, () => false, bias);
			return preferHomeRegion(hits, this.settings.homeCounties);
		} catch {
			return [];
		}
	}

	/** One unbiased lookup of the first home county, reused as a soft proximity bias. */
	private async homeProximity(): Promise<GeocodeBias | null> {
		const primary = this.settings.homeCounties.map((line) => line.trim()).find((line) => line.length > 0) ?? '';
		if (!primary || !this.settings.geoapifyApiKey.trim()) return null;
		if (this.homeBiasKey === primary) return this.homeBiasPoint;
		this.homeBiasKey = primary;
		try {
			const hits = await this.lookupAddress(primary, false);
			const hit = hits[0];
			this.homeBiasPoint = hit ? { lat: hit.lat, lon: hit.lon } : null;
		} catch {
			this.homeBiasPoint = null;
		}
		return this.homeBiasPoint;
	}

	private async launchNewRvTemplate(): Promise<void> {
		this.creatingNewRv = true;
		try {
			const templater = readTemplaterPlugin(this.app);
			const create = templater?.templater?.create_new_note_from_template;
			const pluginPresent = typeof create === 'function';
			const looked = newRvTemplateCandidates(
				templater?.settings?.templates_folder,
				this.settings.newRvTemplateFile,
			);
			const template = pluginPresent ? findTemplateFile(this.app, looked) : null;
			const message = newRvLaunchError(pluginPresent, template != null, looked);
			if (message || !template || !create || !templater?.templater) {
				this.quietCreateGeocode = false;
				new Notice(message ?? 'Templater could not start New RV.');
				return;
			}
			const sourcePath = this.housemateSourcePath;
			const draft = this.newRvDraft;
			const created = await create.call(templater.templater, template);
			if (!created) {
				this.quietCreateGeocode = false;
				new Notice('Templater did not create the New RV note.');
			}
			else if (created instanceof TFile) {
				try {
					await this.suffixCollidingName(created);
					if (draft) await this.writeNewRvShare(created, draft);
					await this.refreshAttemptDigest(created);
					if (sourcePath) await this.linkHousehold(sourcePath, created);
				} catch (error) {
					const reason = error instanceof Error && error.message ? error.message : 'New RV could not finish setup.';
					new Notice(reason);
				}
				this.pendingNewRvPath = created.path;
				await this.activateNewRvNote(created);
			} else this.quietCreateGeocode = false;
		} catch (error) {
			this.quietCreateGeocode = false;
			const reason = error instanceof Error && error.message ? error.message : 'Templater could not create the note.';
			new Notice(reason);
		} finally {
			this.creatingNewRv = false;
			this.newRvDraft = null;
			this.housemateSourcePath = null;
		}
	}

	private async writeNewRvShare(file: TFile, identity: NewRvIdentity): Promise<void> {
		const share = shareFromNewRvDraft(identity);
		if (!share) return;
		const publications = share.publicationList ?? [];
		const media = share.mediaList ?? [];
		const now = new Date();
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			const publication = publications[0];
			const shown = media[0];
			if (publications.length === 1 && publication) assignProperty(data, 'Left Publications', publication);
			else if (publications.length > 1) assignProperty(data, 'Left Publications', publications);
			if (media.length === 1 && shown) assignProperty(data, 'Shared Media', shown);
			else if (media.length > 1) assignProperty(data, 'Shared Media', media);
			recordLoggedLessons(data, share, formatFrontmatterDateTime(now));
		});
		await this.app.vault.process(file, (data) => {
			const info = getFrontMatterInfo(data);
			const head = data.slice(0, info.contentStart);
			const stamped = appendShareToFirstStamp(data.slice(info.contentStart), share);
			return head + refreshHomeStampAges(stamped, now);
		});
		await this.rememberShare(share);
	}

	/** One-shot gender and optional name for the New RV template. Cleared after it is read. */
	takeNewRvDraft(): NewRvIdentity | null {
		const draft = this.newRvDraft;
		this.newRvDraft = null;
		return draft;
	}

	onunload(): void {
		this.unloaded = true;
		clearVisitNoteCaches();
		document.body.classList.remove('rv-hide-backlinks', 'rv-hide-note-status');
		this.stopVisitFocus?.();
		this.stopVisitFocus = null;
		this.noteMapResize?.disconnect();
		this.noteMapResize = null;
		this.applyLayoutClasses();
		this.bulkAborted = true;
	}

	/**
	 * Templater folders (`templates_folder`, `user_scripts_folder`) plus the
	 * configured template file names. Empty Templater folders fall back to
	 * Templates/ and Scripts/.
	 */
	extrasPlacement(): ExtrasPlacement {
		const templater = readTemplaterPlugin(this.app);
		return resolveExtrasPlacement({
			templatesFolder: typeof templater?.settings?.templates_folder === 'string' ? templater.settings.templates_folder : '',
			scriptsFolder: typeof templater?.settings?.user_scripts_folder === 'string' ? templater.settings.user_scripts_folder : '',
			newRvFileName: this.settings.newRvTemplateFile,
			homeLogFileName: this.settings.homeLogTemplateFile,
			missLogFileName: this.settings.missLogTemplateFile,
		});
	}

	openSetupWizard(): void {
		if (this.wizardOpen) return;
		this.wizardOpen = true;
		const modal = new SetupWizardModal(this.app, () => this.loadSetupSnapshot(), {
			onDismiss: () => {
				this.wizardOpen = false;
				void this.markSetupWizardSeen();
			},
			onPlaceExtras: () => { this.syncExtrasFromGitHub(); },
			openCommunityPlugins: () => { this.openObsidianSettings('community-plugins'); },
			openTemplaterSettings: () => { this.openObsidianSettings(TEMPLATER_PLUGIN_ID); },
			openMetaBindSettings: () => { this.openObsidianSettings(META_BIND_PLUGIN_ID); },
			onSaveHomeCounties: async (counties) => {
				this.settings.homeCounties = counties;
				await this.saveSettings();
			},
			onSaveMayGoOut: async (grid) => {
				this.settings.availabilityGrid = grid;
				await this.saveSettings();
			},
			onSaveUrgencyColors: async ({ palette, custom }) => {
				this.settings.urgencyPalette = palette;
				this.settings.urgencyCustomColors = custom;
				await this.saveSettings();
			},
		}, this.settings.availabilityGrid, { palette: this.settings.urgencyPalette, custom: this.settings.urgencyCustomColors });
		modal.open();
	}

	syncExtrasFromGitHub(): void {
		startExtrasSync(this.app, this);
	}

	/**
	 * One companion for a home visit or a new note. Empty when they skip.
	 * Callers append the plain name to Taken only and leave Met With unchanged.
	 * New writes do not create wikilinks.
	 */
	async promptCompanion(path?: string, shareBox?: { share: VisitShare }): Promise<string | false> {
		await new Promise((resolve) => window.setTimeout(resolve, COMPANION_PROMPT_DELAY_MS));
		const campaign = path && this.shouldAskCoverage(path) ? this.campaign : null;
		const note = path ? this.app.vault.getFileByPath(path) : null;
		const frontmatter = note ? this.app.metadataCache.getFileCache(note)?.frontmatter : null;
		const gender = readProperty(frontmatter, 'Gender');
		const status = note ? resolveStatus(readProperty(frontmatter, 'Status'), finiteVisitCount(readProperty(frontmatter, 'Priority'))) : null;
		const study = status === 'Study';
		const defaults = path ? await this.studyDefaults(path) : studyPrefill(null);
		const picked = await new Promise<string | null | false>((resolve) => {
			const modal = new CompanionSuggestModal(
				this.app,
				this.recentCompanionNames(),
				resolve,
				campaign ? {
					name: campaign.name,
					pronoun: coveragePronoun(gender),
					onDecision: (decision) => {
						if (path) this.coverageDecisions.set(path, decision);
					},
				} : null,
				path ? {
					...this.shareFieldOptions(study, defaults),
					onShare: (share) => {
						if (shareBox) shareBox.share = share;
					},
				} : null,
			);
			modal.open();
		});
		if (picked === false) return false;
		if (typeof picked !== 'string') return '';
		const name = picked.trim();
		if (!name) return '';
		return formatStoredCompanion(name);
	}

	/** Quoted Taken / Met With wikilinks, after processFrontMatter may have flattened them. */
	stabilizeCompanionFrontmatter(markdown: string): string {
		return quoteCompanionFrontmatter(markdown);
	}

	private shareFieldOptions(
		study: boolean,
		defaults: { lesson: string; from: string; to: string },
		_forceLiterature = false,
	): ShareFieldOptions {
		return {
			publications: [...this.settings.customPublications, ...PUBLICATION_TITLES],
			media: [...this.settings.customMedia, ...MEDIA_TITLES],
			customLessons: this.settings.customLessons,
			lessons: [...LESSONS],
			showLiterature: true,
			literatureCollapsed: study,
			lessonExpanded: study,
			studyFirst: study,
			showLesson: false,
			optionalLesson: true,
			lessonPrefill: defaults,
			initial: emptyShare(),
		};
	}

	private async studyDefaults(path: string): Promise<{ lesson: string; from: string; to: string }> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return studyPrefill(null);
		try {
			return studyPrefill(newestLessonProgress(await this.app.vault.cachedRead(file)));
		} catch {
			return studyPrefill(null);
		}
	}

	private async promptLiterature(file: TFile, options?: { study?: boolean; campaign?: boolean }): Promise<VisitShare | false> {
		const study = options?.study === true;
		const defaults = await this.studyDefaults(file.path);
		const campaign = options?.campaign && campaignIsActive(this.campaign) ? this.campaign : null;
		const gender = readProperty(this.app.metadataCache.getFileCache(file)?.frontmatter, 'Gender');
		const fields = this.shareFieldOptions(study, defaults);
		if (study) {
			fields.askCompanion = true;
			fields.companions = this.recentCompanionNames();
		}
		return new Promise((resolve) => {
			new LiteraturePromptModal(
				this.app,
				fields,
				(share) => resolve(share),
				campaign ? {
					name: campaign.name,
					pronoun: coveragePronoun(gender),
					onDecision: (yes) => { this.coverageDecisions.set(file.path, yes ? 'yes' : 'no'); },
				} : null,
			).open();
		});
	}

	private async rememberShare(share: VisitShare): Promise<void> {
		let publications = this.settings.customPublications;
		for (const title of shareTitles(share.publications, share.publicationList)) {
			publications = rememberCustom(publications, title, PUBLICATION_TITLES);
		}
		let media = this.settings.customMedia;
		for (const title of shareTitles(share.media, share.mediaList)) {
			media = rememberCustom(media, title, MEDIA_TITLES);
		}
		const lessons = rememberCustom(
			rememberCustom(this.settings.customLessons, share.lesson, LESSONS.map((lesson) => lesson.title)),
			share.extraLesson ?? '',
			LESSONS.map((lesson) => lesson.title),
		);
		const changed = publications.length !== this.settings.customPublications.length
			|| media.length !== this.settings.customMedia.length
			|| lessons.length !== this.settings.customLessons.length;
		if (!changed) return;
		this.settings.customPublications = publications;
		this.settings.customMedia = media;
		this.settings.customLessons = lessons;
		await this.saveSettings();
	}

	/** Rename a custom catalog entry and every note that already stores that name. */
	async renameCatalogEntry(key: 'customPublications' | 'customMedia' | 'customLessons', from: string, to: string): Promise<void> {
		const nextName = to.trim();
		const previous = from.trim();
		if (!nextName || nextName.toLowerCase() === previous.toLowerCase()) return;
		this.settings[key] = renameCustom(this.settings[key], previous, nextName);
		await this.saveSettings();
		for (const file of this.app.vault.getMarkdownFiles()) {
			let markdown = '';
			try {
				markdown = await this.app.vault.read(file);
			} catch {
				continue;
			}
			const next = renameLabelInMarkdown(markdown, previous, nextName);
			if (next !== markdown) await this.app.vault.modify(file, next);
		}
	}

	/** Hub filters return to their defaults each time the hub view is created. */
	resetHubFilters(): void {
		if (this.settings.returnScope === 'active' && this.settings.genderFilter === 'all' && this.settings.campaignListFilter === 'all' && this.settings.snoozeListFilter === 'all') return;
		this.settings.returnScope = 'active';
		this.settings.genderFilter = 'all';
		this.settings.campaignListFilter = 'all';
		this.settings.snoozeListFilter = 'all';
		void this.saveSettings();
	}

	private recentAddressLabels(): string[] {
		const property = this.settings.addressProperty;
		const notes = this.app.vault.getMarkdownFiles().map((file) => {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const record: Record<string, unknown> = {
				'Last Spoke': cacheValue(frontmatter, 'Last Spoke'),
				'Last Attempted': cacheValue(frontmatter, 'Last Attempted'),
				Met: cacheValue(frontmatter, 'Met'),
			};
			return {
				address: readAddress(frontmatter, property) ?? '',
				recentAt: companionRecency(record, file.stat.mtime),
			};
		});
		return recentAddresses(notes);
	}

	private recentCompanionNames(): string[] {
		const notes = this.app.vault.getMarkdownFiles().map((file) => {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const record: Record<string, unknown> = {
				'Last Spoke': cacheValue(frontmatter, 'Last Spoke'),
				'Last Attempted': cacheValue(frontmatter, 'Last Attempted'),
				Met: cacheValue(frontmatter, 'Met'),
			};
			return {
				metWith: cacheValue(frontmatter, 'Met With'),
				taken: cacheValue(frontmatter, 'Taken'),
				recentAt: companionRecency(record, file.stat.mtime),
			};
		});
		return collectRecentCompanionNames(notes);
	}

	private loadSetupSnapshot() {
		const templater = readTemplaterPlugin(this.app);
		return readSetupSnapshot(this.app, this.settings, this.extrasPlacement(), templater?.settings ?? null);
	}

	/** One notice per Nearby or Glancable open, unless one is already visible. */
	nudgeIncompleteSetup(): void {
		if (this.setupNudgeOpen || this.unloaded || this.settings.setupIncompleteNudgeDismissed) return;
		this.setupNudgeOpen = true;
		void this.showSetupNudge();
	}

	private async showSetupNudge(): Promise<void> {
		try {
			const snapshot = await this.loadSetupSnapshot();
			if (this.unloaded) {
				this.setupNudgeOpen = false;
				return;
			}
			// Required gaps empty → the notice stays down, and a stale false flag is saved.
			if (shouldPersistSetupWizardCompleted(this.settings.setupWizardCompleted, snapshot, this.settings.geoapifyApiKey)) {
				await this.markSetupWizardSeen();
			}
			if (!shouldShowSetupNudge({
				wizardCompleted: this.settings.setupWizardCompleted,
				nudgeDismissed: this.settings.setupIncompleteNudgeDismissed,
				geoapifyApiKey: this.settings.geoapifyApiKey,
				snapshot,
			})) {
				this.setupNudgeOpen = false;
				return;
			}
			this.presentSetupNudge();
		} catch {
			this.setupNudgeOpen = false;
		}
	}

	private presentSetupNudge(): void {
		const notice = new Notice('RV Locator setup is not finished.', SETUP_NUDGE_MS);
		notice.containerEl.addClass('rv-locator-setup-nudge');
		const actions = notice.messageEl.createDiv({ cls: 'rv-locator-setup-nudge-actions' });
		const open = actions.createEl('button', { text: 'Open setup wizard', cls: 'mod-cta' });
		open.addEventListener('click', () => {
			notice.hide();
			this.openSetupWizard();
		});
		const dismiss = actions.createEl('button', { text: "Don't remind me again" });
		dismiss.addEventListener('click', () => {
			notice.hide();
			void this.dismissSetupNudge();
		});
		window.setTimeout(() => {
			this.setupNudgeOpen = false;
		}, SETUP_NUDGE_MS);
	}

	private async dismissSetupNudge(): Promise<void> {
		if (this.settings.setupIncompleteNudgeDismissed) return;
		this.settings.setupIncompleteNudgeDismissed = true;
		await this.saveSettings();
	}

	/**
	 * Required gaps empty → treat setup as complete and do not auto-open the wizard.
	 * A false `setupWizardCompleted` flag is saved in that case so Settings-only
	 * setup does not keep nagging. When a gap remains, the first launch still opens
	 * the wizard until Done (or a later empty-gap check) saves the flag.
	 */
	private async syncSetupCompletion(): Promise<void> {
		if (this.unloaded) return;
		try {
			const snapshot = await this.loadSetupSnapshot();
			if (this.unloaded) return;
			if (requiredSetupGaps(snapshot, this.settings.geoapifyApiKey).length === 0) {
				await this.markSetupWizardSeen();
				return;
			}
		} catch {
			// Snapshot failed; still offer the wizard when it has never been closed.
		}
		if (!shouldAutoOpenSetupWizard(this.settings.setupWizardCompleted, this.unloaded)) return;
		this.openSetupWizard();
	}

	/** Done closes the wizard and saves this flag, including when a gap remains. */
	private async markSetupWizardSeen(): Promise<void> {
		if (this.settings.setupWizardCompleted) return;
		this.settings.setupWizardCompleted = true;
		await this.saveSettings();
	}

	private openObsidianSettings(tabId: string): void {
		const setting = (this.app as App & {
			setting?: { open: () => void; openTabById: (id: string) => void };
		}).setting;
		if (!setting) {
			new Notice('Open Settings from the Obsidian menu.');
			return;
		}
		setting.open();
		setting.openTabById(tabId);
	}

	subscribeViewRefresh(callback: () => void): () => void {
		const safe = (): void => {
			try {
				callback();
			} catch {
				// One view must not reject settings or turn a repaint into a Notice.
			}
		};
		this.viewRefreshers.add(safe);
		return () => {
			this.viewRefreshers.delete(safe);
		};
	}

	async saveSettings(): Promise<void> {
		this.settings = mergeSettings(this.settings);
		const digestChanged = this.digestKeyApplied !== '' && this.digestKey() !== this.digestKeyApplied;
		if (digestChanged) this.accentGate.markApplied(this.suggestionCalloutType());
		await this.persist();
		this.digestKeyApplied = this.digestKey();
		this.applyLayoutClasses();
		this.refreshOpenNoteChrome();
		clearInkCache();
		this.refreshVisitPreviewEditors();
		this.repaintOpenUrgency();
		window.requestAnimationFrame(() => this.repaintOpenUrgency());
		for (const callback of this.viewRefreshers) callback();
		if (digestChanged) {
			this.recolorOpenSuggestions();
			await this.rewriteAllDigests();
		}
	}

	cachedAttemptBuckets(path: string): AttemptBuckets | null {
		const file = this.app.vault.getFileByPath(path);
		const cached = this.attemptBuckets.get(path);
		if (!cached) return null;
		if (file && cached.mtime !== file.stat.mtime) return null;
		return cached.buckets;
	}

	prefetchAttemptBuckets(paths: readonly string[]): void {
		const missing = paths.filter((path) => this.cachedAttemptBuckets(path) == null);
		if (missing.length === 0 || this.attemptPrefetch) return;
		this.attemptPrefetch = this.loadAttemptBuckets(missing).finally(() => {
			this.attemptPrefetch = null;
			for (const callback of this.viewRefreshers) callback();
		});
	}

	async suggestReturnFor(path: string, displayName: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			new Notice('That note is not in the vault.');
			return;
		}
		const buckets = await this.readAttemptBuckets(file);
		const digest = suggestReturnDigest({
			buckets,
			grid: this.settings.availabilityGrid,
			orientation: this.settings.digestOrientation,
			days: this.settings.digestDays,
			thresholds: this.digestThresholds(),
			overrides: this.slotOverridesFor(file),
			now: new Date(),
			abbreviate: this.settings.abbreviateDayparts,
		});
		new ReturnSuggestModal(this.app, displayName, digest.markdown).open();
	}

	snoozeUntilFor(path: string): Date | null {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return null;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return parseSnoozeUntil(readProperty(frontmatter, URGENCY_SNOOZE_PROPERTY));
	}

	private pathIsInactive(path: string): boolean {
		const file = this.app.vault.getFileByPath(path);
		return file ? this.noteIsInactive(file) : false;
	}

	private noteIsInactive(file: TFile): boolean {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const priority = finiteVisitCount(readProperty(frontmatter, 'Priority'));
		return resolveStatus(readProperty(frontmatter, 'Status'), priority) === 'Inactive';
	}

	private noteChromeHost(): NoteChromeHost {
		return {
			frontmatter: (path) => this.noteFrontmatter(path),
			settings: this.settings,
			snoozeUntil: (path) => this.snoozeUntilFor(path),
			setStatus: (path, status) => { void this.writeStatus(path, status); },
			setPriority: (path, priority) => {
				const file = this.app.vault.getFileByPath(path);
				if (file) void this.writePriority(file, priority);
			},
			openUrgency: (path, name, event) => { this.promptUrgencyMenu(path, name, event); },
			openPriority: (path, name) => { this.promptPriority(path, name); },
			openRoute: (path) => { void this.openRoute(path); },
			openHub: (path, target) => { void this.app.workspace.openLinkText(target, path); },
			addHub: (path) => { this.promptAddHub(path); },
			removeHub: (path, label) => { void this.removeHub(path, label); },
			moveHub: (path, label) => { void this.moveHub(path, label); },
			openSlotOverride: (path) => { this.openSlotOverride(path); },
			setAddress: (path, address) => { void this.writeAddress(path, address); },
			openMap: (path) => { void this.openMapSoon(path); },
			openCompanion: (path) => { void this.attachCompanion(path); },
			campaignMark: (path) => this.campaignMark(path),
			noteTitle: (path) => {
				const file = this.app.vault.getFileByPath(path);
				return cardPersonTitle(file?.basename ?? path, true);
			},
			openReturn: (path, name) => { void this.suggestReturnFor(path, name); },
			renameNote: (path) => { this.promptAttributes(path); },
			mapOpen: () => this.hubMapOpen,
			ghostIcon: (path) => this.ghostIconForCard(path),
		};
	}

	private pinVisitPaint(path: string, data: Record<string, unknown>): void {
		this.visitPaint.set(path, {
			attempted: readProperty(data, 'Last Attempted'),
			spoke: readProperty(data, 'Last Spoke'),
		});
	}

	private noteFrontmatter(path: string): Record<string, unknown> | null {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return null;
		const frontmatter = this.cachedFrontmatter.get(path) ?? this.app.metadataCache.getFileCache(file)?.frontmatter;
		const data: Record<string, unknown> | null = frontmatter ? { ...frontmatter } : null;
		if (this.hubOverride.has(path)) {
			const hub = this.hubOverride.get(path);
			const cached = hubLabelList(data ? readProperty(data, 'Hub') : null);
			const fresh = hubLabelList(hub);
			if (cached === fresh) this.hubOverride.delete(path);
			else if (data) data.Hub = hub;
			else return { Hub: hub };
		}
		if (this.addressOverride.has(path)) {
			const address = this.addressOverride.get(path) ?? '';
			const property = this.settings.addressProperty.trim() || 'Address';
			const cached = readProperty(data, property);
			const cachedText = typeof cached === 'string' ? cached : '';
			if (cachedText === address) this.addressOverride.delete(path);
			else if (data) data[property] = address;
		}
		const paint = this.visitPaint.get(path);
		if (paint) {
			const cachedAttempt = readProperty(data, 'Last Attempted');
			const cachedSpoke = readProperty(data, 'Last Spoke');
			const same = sameVisitStamp(cachedAttempt, paint.attempted) && sameVisitStamp(cachedSpoke, paint.spoke);
			if (same) this.visitPaint.delete(path);
			else if (data) {
				assignProperty(data, 'Last Attempted', paint.attempted);
				assignProperty(data, 'Last Spoke', paint.spoke);
			} else {
				return { 'Last Attempted': paint.attempted, 'Last Spoke': paint.spoke };
			}
		}
		return data;
	}

	private async writeAddress(path: string, address: string): Promise<void> {
		const next = address.replace(/\r?\n/g, ' ').trim();
		if (this.addressCommit.get(path) === next) return;
		this.addressCommit.set(path, next);
		try {
			const file = this.app.vault.getFileByPath(path);
			if (!file) return;
			const property = this.settings.addressProperty.trim() || 'Address';
			const previous = readAddress(await this.freshFrontmatter(file), property) ?? '';
			if (previous === next) return;
			this.addressOverride.set(path, next);
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				assignProperty(frontmatter as Record<string, unknown>, property, next);
			});
			await this.app.vault.process(file, (data) => {
				const info = getFrontMatterInfo(data);
				const stamp = formatVisitStamp(new Date());
				const line = `> - ${stamp} — address ${previous || 'blank'} → ${next || 'blank'}`;
				return data.slice(0, info.contentStart) + appendLogLine(ensureAttemptLog(data.slice(info.contentStart)), line);
			});
			if (next) void this.geocodeFile(file);
		} finally {
			if (this.addressCommit.get(path) === next) this.addressCommit.delete(path);
		}
	}

	/** One paced lookup after an address edit. The existing pacer spaces the request. */
	private async geocodeFile(file: TFile): Promise<void> {
		if (!this.settingsReady()) return;
		const address = readAddress(await this.freshFrontmatter(file), this.settings.addressProperty);
		if (!address) return;
		const cached = getCached(this.geocodeCache, address);
		if (cached) {
			await this.presentHits(file, address, cached, true);
			return;
		}
		try {
			const hits = await this.lookupAddress(address, false);
			await this.presentHits(file, address, hits, false);
		} catch (error) {
			new Notice(this.friendlyError(error));
		}
	}

	private async writeStatus(path: string, status: RvStatus): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			const priority = finiteVisitCount(readProperty(data, 'Priority')) ?? 0;
			const current = resolveStatus(readProperty(data, 'Status'), priority);
			const next = applyStatusPriority({ status: current, priority }, { status });
			assignProperty(data, 'Status', next.status);
			assignProperty(data, 'Priority', next.priority);
		});
		for (const callback of this.viewRefreshers) callback();
	}

	private async writePriority(file: TFile, priority: number): Promise<void> {
		const requested = Math.max(0, Math.min(5, Math.round(priority)));
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			const currentPriority = finiteVisitCount(readProperty(data, 'Priority')) ?? 0;
			const current = resolveStatus(readProperty(data, 'Status'), currentPriority);
			const next = applyStatusPriority({ status: current, priority: currentPriority }, { priority: requested });
			assignProperty(data, 'Status', next.status);
			assignProperty(data, 'Priority', next.priority);
		});
		for (const callback of this.viewRefreshers) callback();
	}

	private promptAddHub(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		new HubFileSuggestModal(this.app, (picked) => {
			void this.addHub(file, picked).catch((error: unknown) => new Notice(this.friendlyError(error)));
		}).open();
	}

	private async addHub(file: TFile, picked: TFile): Promise<void> {
		const label = picked.basename;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			const current = readProperty(data, 'Hub');
			const list: unknown[] = [];
			if (Array.isArray(current)) {
				for (const item of current) list.push(item);
			} else if (current != null && current !== '') {
				list.push(current);
			}
			if (list.some((item) => hubLabel(item) === label)) return;
			list.push(`[[${label}]]`);
			assignProperty(data, 'Hub', list);
			this.hubOverride.set(file.path, list.slice());
		});
		this.refreshOpenNoteChrome();
		for (const callback of this.viewRefreshers) callback();
	}

	private async removeHub(path: string, label: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			const current = readProperty(data, 'Hub');
			const list: unknown[] = [];
			if (Array.isArray(current)) {
				for (const item of current) {
					if (hubLabel(item) !== label) list.push(item);
				}
			} else if (current != null && current !== '' && hubLabel(current) !== label) {
				list.push(current);
			}
			assignProperty(data, 'Hub', list);
			this.hubOverride.set(file.path, list.slice());
		});
		this.refreshOpenNoteChrome();
		for (const callback of this.viewRefreshers) callback();
	}

	/** Fills a missing Status and renames the Hubs label. Does not guess Gender or overwrite Study. */
	private async polishStatusAndHub(file: TFile): Promise<void> {
		if (file.extension !== 'md' || this.isTemplateNote(file)) return;
		let text = '';
		try {
			text = await this.app.vault.read(file);
		} catch {
			return;
		}
		const frontmatter = frontmatterFromMarkdown(text);
		if (!frontmatter || !isRvDashboardNote(frontmatter)) return;
		if (readProperty(frontmatter, 'Status') == null) {
			await this.app.fileManager.processFrontMatter(file, (data) => {
				const record = data as Record<string, unknown>;
				if (readProperty(record, 'Status') != null) return;
				assignProperty(record, 'Status', statusForNewNote(finiteVisitCount(readProperty(record, 'Priority'))));
			});
		}
		if (!text.includes('**Hubs:**')) return;
		await this.app.vault.process(file, (data) => data.replaceAll('**Hubs:**', '**Hub:**'));
	}

	promptUrgencySnooze(path: string, displayName: string): void {
		this.openSnoozeModal(path, displayName);
	}

	/**
	 * Templater rvLog calls this after a visit is on disk.
	 * Refreshes that note's digest and may ask about priority.
	 * A miss never asks. Home asks when Successful Visits hits a multiple of N.
	 */
	async noteVisitLogged(file: TFile, outcome?: VisitOutcome): Promise<void> {
		if (outcome === 'home' || outcome === 'miss') await this.consumeCoverage(file.path, outcome);
		await this.enqueueDigestRewrite(file);
		this.scheduleOpenNoteRepaint();
		await this.maybeNudgePriority(file, outcome);
		if (outcome === 'home') await this.focusVisitNotes(file, null);
	}

	/** Templater newRv calls this after the new note is on disk. */
	async refreshAttemptDigest(file: TFile): Promise<void> {
		if (!(file instanceof TFile) || this.isTemplateNote(file)) return;
		await this.enqueueDigestRewrite(file);
	}

	private async loadAttemptBuckets(paths: readonly string[]): Promise<void> {
		for (const path of paths) {
			const file = this.app.vault.getFileByPath(path);
			if (!file) continue;
			try {
				await this.readAttemptBuckets(file);
			} catch {
				this.attemptBuckets.set(path, { mtime: file.stat.mtime, buckets: {} });
			}
		}
	}

	private async readAttemptBuckets(file: TFile): Promise<AttemptBuckets> {
		const cached = this.attemptBuckets.get(file.path);
		if (cached && cached.mtime === file.stat.mtime) return cached.buckets;
		const text = await this.app.vault.cachedRead(file);
		const buckets = readAttemptLog(text).buckets;
		this.attemptBuckets.set(file.path, { mtime: file.stat.mtime, buckets });
		return buckets;
	}

	setNearbySort(sort: NearbySortPreference): void {
		const next = sanitizeNearbySort(sort);
		if (this.nearbySort.property === next.property && this.nearbySort.direction === next.direction) return;
		this.nearbySort = next;
		void this.persist();
		for (const canvas of this.mapCanvases) canvas.refresh();
		for (const callback of this.viewRefreshers) callback();
	}

	async setReturnScope(scope: ReturnScope): Promise<void> {
		this.settings.returnScope = sanitizeReturnScope(scope);
		await this.saveSettings();
	}

	async setGenderFilter(filter: GenderFilter): Promise<void> {
		this.settings.genderFilter = sanitizeGenderFilter(filter);
		await this.saveSettings();
	}

	async setCampaignListFilter(filter: CampaignListFilter): Promise<void> {
		this.settings.campaignListFilter = sanitizeCampaignListFilter(filter);
		await this.saveSettings();
	}

	async setSnoozeListFilter(filter: SnoozeListFilter): Promise<void> {
		this.settings.snoozeListFilter = sanitizeSnoozeListFilter(filter);
		await this.saveSettings();
	}

	mapFocusPath: string | null = null;
	mapSelectedPath: string | null = null;
	/** In-view map. Fullscreen stays on the map that was toggled. */
	hubMapFullscreen = false;
	hubMapOpen = false;
	/** Map panel mounted beside the open note. The hub icon does not set this. */
	noteMapOpen = false;
	private hubFullscreenSync: (() => void) | null = null;
	/** Hub column is narrower than the stacked-map breakpoint. Width 0 does not set this. */
	hubPaneNarrow = false;
	/** Last GPS fix reported by a hub view, for address bias. */
	liveFix: { lat: number; lon: number } | null = null;
	private addressSuggestCache = new Map<string, GeocodeHit[]>();
	private mapCanvases = new Set<{ refresh(): void; focus(path: string | null, center: boolean, source?: 'follow' | 'card'): void }>();
	private hubScrollers = new Set<(path: string | null) => void>();

	/**
	 * Earth on a note opens the map beside that note, inside the same leaf.
	 * A workspace split replaces the note on the phone (the note width goes to 0).
	 * The hub map icon only toggles the embedded map.
	 */
	hideSplitMap(): void {
		this.hubMapOpen = false;
		this.noteMapOpen = false;
		this.setHubMapFullscreen(false);
		this.applyLayoutClasses();
		this.syncNoteMap();
		for (const callback of this.viewRefreshers) callback();
	}

	async openMapSoon(path?: string): Promise<void> {
		if (path && this.noteMapOpen && this.mapFocusPath === path) {
			this.noteMapOpen = false;
			this.hubMapOpen = false;
			this.setHubMapFullscreen(false);
			this.applyLayoutClasses();
			this.syncNoteMap();
			for (const callback of this.viewRefreshers) callback();
			this.refreshVisitCards(path, undefined, true);
			return;
		}
		if (path) {
			this.mapFocusPath = path;
			this.hubMapOpen = true;
			this.noteMapOpen = true;
		} else {
			this.hubMapOpen = !this.hubMapOpen;
		}
		if (!this.hubMapOpen) this.setHubMapFullscreen(false);
		this.applyLayoutClasses();
		if (path || !this.noteMapOpen) this.syncNoteMap();
		for (const callback of this.viewRefreshers) callback();
		if (path && this.hubMapOpen) this.focusMapPin(path, true);
	}

	private noteMapHandle: { destroy(): void; invalidateSize(): void } | null = null;
	private noteMapRatio = 0.42;

	/** The grip is a grid track beside the map, so both move as one size. */
	private bindNoteMapHandle(content: HTMLElement, handle: HTMLElement): void {
		if (handle.dataset.rvBound === '1') return;
		handle.dataset.rvBound = '1';
		if (!content.style.getPropertyValue('--rv-note-map')) {
			content.style.setProperty('--rv-note-map', `${Math.round(this.noteMapRatio * 100)}%`);
		}
		handle.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const startX = event.clientX;
			const startY = event.clientY;
			const start = this.noteMapRatio;
			const box = content.getBoundingClientRect();
			const side = content.classList.contains('is-note-map-side');
			const span = Math.max(1, side ? box.width : box.height);
			const move = (ev: PointerEvent): void => {
				const delta = side ? (startX - ev.clientX) / span : (startY - ev.clientY) / span;
				this.noteMapRatio = Math.min(0.72, Math.max(0.18, start + delta));
				content.style.setProperty('--rv-note-map', `${Math.round(this.noteMapRatio * 100)}%`);
			};
			const stop = (): void => {
				handle.ownerDocument.removeEventListener('pointermove', move);
				handle.ownerDocument.removeEventListener('pointerup', stop);
			};
			handle.ownerDocument.addEventListener('pointermove', move);
			handle.ownerDocument.addEventListener('pointerup', stop);
		});
	}

	/**
	 * Map beside the open note, in that note's leaf. The leaf's own width
	 * chooses side-by-side (~60/40) or stacked (note above, map below).
	 * Switching to another note closes the panel.
	 */
	private syncNoteMap(): void {
		const content = this.noteMapHost();
		if (!this.noteMapOpen || !content) {
			this.noteMapHandle?.destroy();
			this.noteMapHandle = null;
			this.noteMapResize?.disconnect();
			this.noteMapResize = null;
			this.clearNoteMap(content);
			return;
		}
		content.classList.add('is-note-map');
		this.watchNoteMapBox(content);
		let handle = content.querySelector(':scope > .rv-note-map-handle');
		if (!(handle instanceof HTMLElement)) {
			handle = content.createDiv('rv-note-map-handle');
			handle.setAttribute('role', 'separator');
			handle.setAttribute('aria-orientation', 'horizontal');
			handle.setAttribute('aria-label', 'Resize map');
		}
		if (handle instanceof HTMLElement) this.bindNoteMapHandle(content, handle);
		let map = content.querySelector(':scope > .rv-note-map');
		if (!(map instanceof HTMLElement) || !map.isConnected) {
			this.noteMapHandle?.destroy();
			this.noteMapHandle = null;
			map = content.createDiv('rv-note-map');
		}
		if (!(map instanceof HTMLElement)) return;
		if (!this.noteMapHandle) this.noteMapHandle = this.mountHubMap(map);
		for (const delay of [0, 250]) {
			window.setTimeout(() => {
				if (this.unloaded || !this.noteMapOpen) return;
				this.noteMapHandle?.invalidateSize();
			}, delay);
		}
	}

	/** Side-by-side at the hub breakpoint and wider. Narrow leaves stack. */
	private watchNoteMapBox(content: HTMLElement): void {
		const apply = (): void => {
			const box = content.getBoundingClientRect();
			const width = box.width > 0 ? box.width : content.clientWidth;
			content.classList.toggle('is-note-map-side', width >= HUB_STACK_BELOW_PX);
			this.syncNoteMapStatus(content);
		};
		apply();
		this.noteMapResize?.disconnect();
		if (typeof ResizeObserver === 'undefined') {
			this.noteMapResize = null;
			return;
		}
		this.noteMapResize = new ResizeObserver(() => apply());
		this.noteMapResize.observe(content);
	}

	private armNewRvFocus(file: TFile): void {
		void this.activateNewRvNote(file);
	}

	/**
	 * Templater leaves the bases file active. Open the new note, make it the
	 * active file, then focus its visit textarea once the preview has the box.
	 * The companion dialog is already closed: the template awaits it.
	 */
	private async activateNewRvNote(file: TFile): Promise<void> {
		if (this.unloaded) return;
		const found = this.app.vault.getFileByPath(file.path);
		const current = found instanceof TFile ? found : file;
		this.pendingNewRvPath = current.path;
		let leaf = this.app.workspace.getLeavesOfType('markdown')
			.find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === current.path);
		if (leaf) {
			if (this.app.workspace.getActiveFile()?.path !== current.path) {
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
			}
		} else {
			const next = this.app.workspace.getLeaf('tab');
			await next.openFile(current, { active: true, state: { mode: 'preview', source: false } });
			if (next.view instanceof MarkdownView && next.view.file?.path === current.path) leaf = next;
			else {
				leaf = this.app.workspace.getLeavesOfType('markdown')
					.find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === current.path);
			}
		}
		if (!leaf) return;
		await this.openInReadingView(current, true);
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		this.pendingNewRvPath = current.path;
		const sameWatch = this.armedNewRvPath === current.path && this.armedNewRvEl === view.containerEl && this.stopVisitFocus;
		if (!sameWatch) {
			this.stopVisitFocus?.();
			this.armedNewRvPath = current.path;
			this.armedNewRvEl = view.containerEl;
			this.stopVisitFocus = armVisitNoteFocus(view.containerEl, '', () => this.markdownRoot(current.path));
		}
		placeVisitNoteFocus(view.containerEl, '', 0);
	}

	/** Templater's post-create hook. Reading view and the visit note, even if geocode fails. */
	async focusNewRvNote(file: TFile | { path?: string } | null | undefined): Promise<void> {
		const note = file instanceof TFile ? file : this.asNoteFile(file ?? null);
		if (!note || this.unloaded) return;
		this.pendingNewRvPath = note.path;
		await this.activateNewRvNote(note);
	}

	private noteMapHost(): HTMLElement | null {
		const wanted = this.mapFocusPath;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (wanted && view.file?.path !== wanted) continue;
			return view.containerEl;
		}
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		return active?.containerEl ?? null;
	}

	/** A stacked in-note map sits on the status bar. Hide that bar the way the hub does. */
	private syncNoteMapStatus(content: HTMLElement | null): void {
		const body = content?.ownerDocument.body ?? document.body;
		if (!content || !this.noteMapOpen || !content.classList.contains('is-note-map')) {
			body.classList.remove('rv-hide-note-status');
			return;
		}
		const box = content.getBoundingClientRect();
		const width = box.width > 0 ? box.width : content.clientWidth;
		const windowWidth = content.ownerDocument.defaultView?.innerWidth ?? 0;
		const stacked = width > 0 ? width < HUB_STACK_BELOW_PX : windowWidth > 0 && windowWidth < HUB_STACK_BELOW_PX;
		body.classList.toggle('rv-hide-note-status', stacked);
	}

	private clearNoteMap(content: HTMLElement | null): void {
		const hosts = content ? [content] : [];
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView) hosts.push(view.containerEl);
		}
		for (const host of hosts) {
			host.classList.remove('is-note-map', 'is-note-map-side');
			host.querySelector(':scope > .rv-note-map-handle')?.remove();
			host.querySelector(':scope > .rv-note-map')?.remove();
		}
		this.syncNoteMapStatus(null);
	}

	hubMapIsFullscreen(): boolean {
		return this.hubMapFullscreen;
	}

	/** The in-view map only. */
	setHubMapFullscreen(on: boolean): void {
		this.hubMapFullscreen = on;
		this.hubFullscreenSync?.();
	}

	registerHubFullscreen(sync: () => void): () => void {
		this.hubFullscreenSync = sync;
		return () => {
			if (this.hubFullscreenSync === sync) this.hubFullscreenSync = null;
		};
	}

	notifyPin(path: string): void {
		this.mapSelectedPath = path;
		for (const scroll of this.hubScrollers) scroll(path);
		for (const canvas of this.mapCanvases) canvas.focus(path, false);
	}

	notifyMapCleared(): void {
		this.mapSelectedPath = null;
		for (const scroll of this.hubScrollers) scroll(null);
	}

	focusMapPin(path: string, center = true): void {
		this.mapSelectedPath = path;
		for (const canvas of this.mapCanvases) canvas.focus(path, center, 'follow');
		for (const scroll of this.hubScrollers) scroll(path);
	}

	/** Blank card body while the map is open. Centers and flashes the pin. No popup. */
	highlightMapPin(path: string): void {
		if (!this.hubMapOpen) return;
		this.mapSelectedPath = path;
		for (const canvas of this.mapCanvases) canvas.focus(path, true, 'card');
	}

	registerHubScroller(scroll: (path: string | null) => void): () => void {
		this.hubScrollers.add(scroll);
		return () => { this.hubScrollers.delete(scroll); };
	}

	tileCacheEpoch = 0;

	clearMapCache(): void {
		clearTileIndex();
		this.tileCacheEpoch += 1;
		for (const callback of this.viewRefreshers) callback();
	}

	attachMap(canvas: { refresh(): void; focus(path: string | null, center: boolean, source?: 'follow' | 'card'): void }): () => void {
		this.mapCanvases.add(canvas);
		return () => { this.mapCanvases.delete(canvas); };
	}

	mountHubMap(parent: HTMLElement): { destroy(): void; applyRenderedOrder(paths: readonly string[]): void; invalidateSize(): void } {
		const handle = mountEmbeddedMap(parent, this);
		return {
			destroy: () => { handle.destroy(); },
			applyRenderedOrder: (paths) => { handle.applyRenderedOrder(paths); },
			invalidateSize: () => { handle.invalidateSize(); },
		};
	}

	hubSort(): { property: string; direction: 'ASC' | 'DESC' } {
		return this.nearbySort;
	}

	cycleHubSort(property: string): void {
		const preset = visibleSortPresets(this.settings.sortChips).find((item) => item.property === property);
		if (!preset) return;
		this.setNearbySort(nextPresetSort(this.nearbySort, preset));
	}

	sortChoices(): { property: string; label: string; active: boolean }[] {
		return visibleSortPresets(this.settings.sortChips).map((preset) => {
			const active = this.nearbySort.property.toLowerCase() === preset.property.toLowerCase();
			return {
				property: preset.property,
				label: sortPresetChipLabel(preset, active ? this.nearbySort.direction : null),
				active,
			};
		});
	}

	noteLiveFix(fix: { lat: number; lon: number } | null): void {
		this.liveFix = fix;
	}

	addressSuggestCacheMap(): Map<string, GeocodeHit[]> {
		return this.addressSuggestCache;
	}

	async suggestAddressHome(query: string): Promise<SuggestFetchResult> {
		const bias = await this.suggestBias();
		const counties = this.settings.homeCounties.map((line) => line.trim()).filter((line) => line.length > 0);
		if (counties.length === 0) {
			const hits = await this.autocompleteAddress(query, bias, Boolean(bias));
			return { hits, allowBroad: Boolean(bias) };
		}
		const county = countyFilterParam(counties);
		const [sorted, bounded] = await Promise.all([
			this.autocompleteAddress(query, bias, false, null, true),
			this.autocompleteAddress(query, bias, false, county, false),
		]);
		const homeBounded = bounded.filter((hit) => hitInHomeCounties(hit, counties));
		return { hits: mergeHomeFirst(homeBounded, sorted), allowBroad: false };
	}

	async suggestAddressBroad(query: string): Promise<GeocodeHit[]> {
		const bias = await this.suggestBias();
		return this.autocompleteAddress(query, bias, false);
	}

	/** Distance-test point, then a live GPS fix, then one geocode of the first home county. */
	private async suggestBias(): Promise<GeocodeBias | null> {
		return this.currentMapFix() ?? this.liveFix ?? await this.homeProximity();
	}

	/**
	 * Autocomplete only. Full geocode search stays on the 750ms pacer.
	 * The home pass adds a circle filter. A broader pass keeps the bias and drops the circle.
	 */
	private async autocompleteAddress(
		query: string,
		bias: GeocodeBias | null,
		filterCircle: boolean,
		countyFilter: string | null = null,
		sortHome = true,
	): Promise<GeocodeHit[]> {
		const apiKey = this.settings.geoapifyApiKey.trim();
		const text = query.trim();
		if (!apiKey || text.length < 3) return [];
		try {
			const url = buildAutocompleteUrl(text, apiKey, this.settings.geoapifyRegion, {
				bias,
				filterRadiusM: filterCircle && bias ? ADDRESS_SUGGEST_HOME_RADIUS_M : null,
				countyFilter,
			});
			const response = await fetch(url);
			if (!response.ok) return [];
			const body: unknown = await response.json();
			const hits = parseGeocodeBody(body);
			return sortHome ? preferHomeRegion(hits, this.settings.homeCounties) : hits;
		} catch {
			return [];
		}
	}

	registerGlancePainter(paint: (parent: HTMLElement, path: string) => boolean): () => void {
		this.glancePainters.add(paint);
		return () => { this.glancePainters.delete(paint); };
	}

	registerGlanceWidth(read: () => number): () => void {
		this.glanceWidths.add(read);
		return () => { this.glanceWidths.delete(read); };
	}

	/** Leaf width for the map popup. The list card is hidden while the map is fullscreen. */
	registerGlanceLayout(read: () => number, root?: HTMLElement | null): () => void {
		const entry = { read, root: root ?? null };
		this.glanceLayouts.add(entry);
		return () => { this.glanceLayouts.delete(entry); };
	}

	/**
	 * Width the glancable grid uses. A fullscreen hub reports its own leaf.
	 * A note with no base falls back to the markdown leaf.
	 */
	glanceLayoutWidth(): number {
		let fullscreen = 0;
		let best = 0;
		for (const entry of this.glanceLayouts) {
			const width = entry.read();
			if (!(width > 1)) continue;
			if (entry.root?.classList.contains('is-map-fullscreen') && width > fullscreen) fullscreen = width;
			if (width > best) best = width;
		}
		if (fullscreen > 0) return fullscreen;
		if (best > 0) return best;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			const width = view.containerEl.clientWidth;
			if (width > best) best = width;
		}
		return best;
	}

	/** Test point while desktop distance testing is on, otherwise the latest GPS fix. */
	distanceFix(): { lat: number; lon: number } | null {
		return this.currentMapFix() ?? this.liveFix;
	}

	rememberLiveFix(fix: { lat: number; lon: number } | null): void {
		if (this.settings.distanceTest || !fix) return;
		this.liveFix = fix;
	}

	/** Width of a mounted list card, so the map popup can match it. */
	glanceCardWidth(): number {
		let best = 0;
		for (const read of this.glanceWidths) {
			const width = read();
			if (width > best) best = width;
		}
		return best;
	}

	paintGlanceCard(parent: HTMLElement, path: string): boolean {
		for (const paint of this.glancePainters) {
			if (paint(parent, path)) return true;
		}
		return paintNoteGlanceCard(parent, path, this);
	}

	listMapPins(): MapPin[] {
		const colors = urgencyColorsFor(this.settings.urgencyPalette, this.settings.urgencyCustomColors);
		const rows = this.app.vault.getMarkdownFiles().map((file) => {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const point = latLonFromUnknown(readProperty(frontmatter, this.settings.locationProperty));
			const priority = finiteVisitCount(readProperty(frontmatter, 'Priority')) ?? 0;
			const status = resolveStatus(readProperty(frontmatter, 'Status'), priority);
			const spoke = readProperty(frontmatter, 'Last Spoke');
			const raw = spoke instanceof Date ? spoke.toISOString() : typeof spoke === 'string' ? spoke : '';
			const days = raw ? calendarDaysSince(raw) : null;
			const lessons = lessonList(readProperty(frontmatter, 'Lessons Studied'));
			const studies = finiteVisitCount(readProperty(frontmatter, 'Studies')) ?? 0;
			const successful = finiteVisitCount(readProperty(frontmatter, 'Successful Visits'));
			const visits = finiteVisitCount(readProperty(frontmatter, 'Visits'));
			const cityName = this.settings.cityProperty.trim() || 'City';
			const city = readProperty(frontmatter, cityName);
			const cityText = typeof city === 'string' ? city : '';
			const attemptedDays = propertyDays(readProperty(frontmatter, 'Last Attempted'));
			const metDays = propertyDays(readProperty(frontmatter, 'Met'));
			const avoid = currentReturnBucket({
				buckets: this.cachedAttemptBuckets(file.path) ?? {},
				grid: this.settings.availabilityGrid,
				thresholds: this.digestThresholds(),
				overrides: this.slotOverridesFor(file),
			}) === 'Avoid';
			const ideality = idealityScore({
				days,
				priority,
				miles: null,
				thresholds: this.settings.urgencyThresholdDays,
				floors: this.settings.idealityFloorDays,
				territorySpan: this.settings.territorySpanMiles,
				holdDistance: true,
			});
			return {
				path: file.path,
				name: cardPersonTitle(file.basename, false),
				lat: point?.lat ?? Number.NaN,
				lon: point?.lon ?? Number.NaN,
				priority,
				days,
				inactive: status === 'Inactive',
				avoid,
				spokeDays: days,
				attemptedDays,
				metDays,
				city: cityText,
				ideality,
				gender: sanitizeGender(readProperty(frontmatter, 'Gender')),
				status,
				snoozed: this.snoozeActiveFor(file.path),
				card: {
					address: readAddress(frontmatter, this.settings.addressProperty) ?? '',
					city: cityText,
					study: status === 'Study',
					spoke: days == null ? '' : formatGlanceableCounter(days),
					attempted: counterText(readProperty(frontmatter, 'Last Attempted')),
					studied: counterText(readProperty(frontmatter, 'Last Studied')),
					met: counterText(readProperty(frontmatter, 'Met')),
					metWith: textProperty(readProperty(frontmatter, 'Met With')),
					visits: `${successful ?? '—'}/${visits ?? '—'}`,
					studyRatio: formatStudyFraction(lessons.length, studies, this.settings.studyRatio).ratio,
					literature: textProperty(readProperty(frontmatter, 'Left Publications')),
					media: textProperty(readProperty(frontmatter, 'Shared Media')),
					lessons,
					driveDates: driveDateRows(frontmatter),
				},
			};
		});
		const look = pinLookForHub(this.nearbySort.property, this.settings.returnScope, this.settings.genderFilter);
		const ordered = orderByHubSort(rows, this.nearbySort, this.currentMapFix() ?? this.liveFix, this.settings.urgencyThresholdDays);
		const heats = shadeHeats(heatModeForSort(this.nearbySort.property), ordered);
		return buildMapPins(
			ordered.map((row, index) => ({ ...row, shadeHeat: heats[index] ?? 0 })),
			this.settings.idealityFloorDays,
			this.settings.urgencyThresholdDays,
			colors,
			look,
			look === 'status' && this.settings.returnScope === 'archive',
		);
	}

	openMapNote(path: string): void {
		void this.app.workspace.openLinkText(path, path, true);
	}

	currentMapFix(): { lat: number; lon: number } | null {
		if (this.settings.distanceTest) {
			return validLatLon(this.settings.testLatitude, this.settings.testLongitude);
		}
		return null;
	}

	/** Directions from the chosen provider. The stored Map Link property is not read or rewritten. */
	async openRoute(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
		const address = readAddress(frontmatter, this.settings.addressProperty) ?? '';
		const cityName = this.settings.cityProperty.trim() || 'City';
		const city = readProperty(frontmatter, cityName);
		const cityText = typeof city === 'string' ? city : '';
		if (!address.trim()) {
			new Notice('This note has no address to open directions.');
			return;
		}
		const url = directionsUrl(this.settings.routeProvider, {
			address,
			city: cityText,
		});
		openExternalUrl(url);
	}

	openCampaignModal(): void {
		new CampaignModal(this.app, this.campaign, (next) => {
			this.campaign = next ? sanitizeCampaign({ ...next, covered: next.covered }) : null;
			void this.persist().then(() => {
				for (const callback of this.viewRefreshers) callback();
			});
		}).open();
	}

	/** `covered` or `open` while a campaign is active. Null when there is no active campaign. */
	campaignMark(path: string): 'covered' | 'open' | null {
		if (!campaignIsActive(this.campaign)) return null;
		return isCovered(this.campaign, path) ? 'covered' : 'open';
	}

	/** Label for the daypart override that is in effect right now. Null when this moment is not overridden. */
	cardOverrideLabel(path: string): string | null {
		if (!this.settings.showCardReturnStatus) return null;
		const file = this.app.vault.getFileByPath(path);
		if (!file) return null;
		const now = new Date();
		const hit = this.slotOverridesFor(file).find((item) => item.weekday === now.getDay() && item.daypart === daypartAt(now));
		if (!hit) return null;
		const reason = (hit.reason ?? '').trim();
		return reason || (hit.bucket === 'avoid' ? 'Avoid' : 'Try');
	}

	/** Open the note and flash the visit that falls on this date. */
	jumpCardDate(path: string, raw: string): void {
		const when = parseDriveInstant(raw) ?? stampDateTime(raw);
		if (!when) return;
		void this.openNoteDay(path, when);
	}

	/** Open the note and scroll to the Attempt Log, expanded the way Obsidian opens a callout. */
	openAttemptLog(path: string): void {
		void this.openNoteThen(path, (root) => { revealAttemptLogWhenReady(root); }, 0);
	}

	private async openNoteDay(path: string, when: Date): Promise<void> {
		await this.openNoteThen(path, (root) => { jumpToDayInRoot(root, when); });
	}

	private async openNoteThen(path: string, after: (root: HTMLElement) => void, delayMs = 60): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		const workspace = this.app.workspace as { getLeaf?: (split: boolean) => { openFile?: (file: TFile, openState?: OpenViewState) => Promise<void>; view?: { containerEl?: HTMLElement } } };
		const leaf = workspace.getLeaf?.(false);
		const preview = { state: { mode: 'preview', source: false } };
		if (leaf?.openFile) await leaf.openFile(file, preview);
		else await this.app.workspace.openLinkText(path, path, false, preview);
		const started = Date.now();
		const deliver = (): boolean => {
			const root = leaf?.view?.containerEl;
			if (!(root instanceof HTMLElement)) return false;
			after(root);
			return true;
		};
		if (delayMs > 0) {
			window.setTimeout(() => { deliver(); }, delayMs);
			return;
		}
		if (deliver()) return;
		const timer = window.setInterval(() => {
			if (deliver() || Date.now() - started >= 2_000) window.clearInterval(timer);
		}, 16);
	}

	/** Met With / Taken only. Does not insert a visit. */
	private async attachCompanion(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		const picked = await this.promptCompanion();
		if (typeof picked !== 'string' || !picked.trim()) return;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			assignProperty(data, 'Met With', picked);
			assignProperty(data, 'Taken', appendCompanionTaken(readProperty(data, 'Taken'), picked));
		});
	}

	/** Daypart bucket for the card's return line. Uses cached Attempt Log counts. */
	cardReturnBucket(path: string): 'Try' | 'Avoid' | 'Unsure' | 'Untried' {
		const file = this.app.vault.getFileByPath(path);
		return currentReturnBucket({
			buckets: this.cachedAttemptBuckets(path) ?? {},
			grid: this.settings.availabilityGrid,
			thresholds: this.digestThresholds(),
			overrides: file ? this.slotOverridesFor(file) : [],
		});
	}

	private shouldAskCoverage(path: string): boolean {
		return campaignIsActive(this.campaign) && !isCovered(this.campaign, path);
	}

	private coveragePronounFor(path: string): 'him' | 'her' | 'them' {
		const file = this.app.vault.getFileByPath(path);
		const gender = file ? readProperty(this.app.metadataCache.getFileCache(file)?.frontmatter, 'Gender') : null;
		return coveragePronoun(gender);
	}

	private async consumeCoverage(path: string, outcome: VisitOutcome): Promise<void> {
		if (outcome !== 'home') {
			this.coverageDecisions.delete(path);
			return;
		}
		const decision = this.coverageDecisions.get(path);
		this.coverageDecisions.delete(path);
		if (decision === 'yes') {
			await this.markCovered(path);
			return;
		}
		if (decision === 'no' || decision === 'skip') return;
		if (!this.shouldAskCoverage(path) || !this.campaign) return;
		const yes = await askCampaignCovered(this.app, this.campaign.name, this.coveragePronounFor(path));
		if (yes) await this.markCovered(path);
	}

	private async markCovered(path: string): Promise<void> {
		if (!this.campaign || isCovered(this.campaign, path)) return;
		this.campaign = withCovered(this.campaign, path);
		await this.persist();
		for (const callback of this.viewRefreshers) callback();
	}

	private slotOverridesFor(file: TFile): SlotOverride[] {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return parseSlotOverrides(readProperty(frontmatter, SLOT_OVERRIDE_PROPERTY));
	}

	private openSlotOverride(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		new SlotOverrideModal(this.app, this.slotOverridesFor(file), (next) => {
			void this.writeSlotOverrides(file, next);
		}).open();
	}

	private async writeSlotOverrides(file: TFile, overrides: readonly SlotOverride[]): Promise<void> {
		const lines = overrides.map((item) => formatSlotOverride(item));
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			if (lines.length === 0) removeProperty(data, SLOT_OVERRIDE_PROPERTY);
			else assignProperty(data, SLOT_OVERRIDE_PROPERTY, lines);
		});
		await this.enqueueDigestRewrite(file, overrides);
		for (const callback of this.viewRefreshers) callback();
	}

	private async moveHub(path: string, label: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		let moved = false;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			const current = readProperty(data, 'Hub');
			const list: unknown[] = [];
			if (Array.isArray(current)) {
				for (const item of current) list.push(item);
			} else if (current != null && current !== '') {
				list.push(current);
			}
			const next = moveHubLeft(list, label);
			if (!next) return;
			moved = true;
			assignProperty(data, 'Hub', next);
			this.hubOverride.set(file.path, next.slice());
		});
		if (moved) {
			this.refreshOpenNoteChrome();
			for (const callback of this.viewRefreshers) callback();
		}
	}

	promptUrgencyMenu(path: string, _displayName: string, event: MouseEvent): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		const inactive = this.noteIsInactive(file);
		const menu = new Menu();
		menu.addItem((item) => item.setTitle('Home').setIcon('door-open').onClick(() => {
			void this.writeVisit(file, 'home').catch((error: unknown) => new Notice(this.friendlyError(error)));
		}));
		menu.addItem((item) => item.setTitle('Not home').setIcon('door-closed').onClick(() => {
			void this.writeVisit(file, 'miss').catch((error: unknown) => new Notice(this.friendlyError(error)));
		}));
		menu.addItem((item) => item.setTitle('Log past visit').setIcon('rotate-ccw-clock').onClick(() => {
			this.promptPastVisit(file);
		}));
		menu.addItem((item) => item
			.setTitle(inactive ? 'Unarchive' : 'Archive')
			.setIcon(inactive ? 'archive-restore' : 'archive')
			.onClick(() => { this.confirmArchive(file); }));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle('Snooze').setIcon('moon').onClick(() => { this.openSnoozeModal(path, file.basename); }));
		menu.showAtMouseEvent(event);
	}

	private openSnoozeModal(path: string, displayName: string): void {
		const until = this.snoozeUntilFor(path);
		const label = this.snoozeLabelFor(path);
		new UrgencySnoozeModal(this.app, cardPersonTitle(displayName, true), { until, label }, (next) => {
			void this.applySnooze(path, next);
		}).open();
	}

	promptPriority(path: string, displayName: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const current = finiteVisitCount(readProperty(frontmatter, 'Priority')) ?? 0;
		new PrioritySliderModal(this.app, displayName, current, (priority) => {
			void this.writePriority(file, priority).catch((error: unknown) => new Notice(this.friendlyError(error)));
		}).open();
	}

	requestBulkStop(): void {
		this.bulkAborted = true;
	}

	previewBulk(files: TFile[], force: boolean): { pending: number; skipped: number } {
		return this.summarizeWork(files.map((file) => this.snapshot(file)), force);
	}

	async countBulk(files: TFile[], force: boolean): Promise<{ pending: number; skipped: number }> {
		return this.summarizeWork(await this.noteSnapshots(files), force);
	}

	private summarizeWork(notes: NoteSnapshot[], force: boolean): { pending: number; skipped: number } {
		const withAddress = notes.filter((note) => readAddress(note.frontmatter, this.settings.addressProperty)).length;
		const missingLocation = planGeocodeWork(notes, this.settings, false).length;
		return {
			pending: force ? withAddress : missingLocation,
			skipped: withAddress - missingLocation,
		};
	}

	async runBulk(choice: BulkGeocodeChoice, report: (message: string) => void): Promise<void> {
		if (this.bulkRunning) {
			new Notice('Bulk geocode is already running.');
			return;
		}
		if (!this.settingsReady()) return;

		const files = collectNotes(this.app, choice);
		if (choice.scope === 'folder' && !this.folderExists(choice.folderPath)) {
			new Notice('That folder was not found.');
			report('That folder was not found.');
			return;
		}

		report('Reading notes…');
		this.bulkRunning = true;
		this.bulkAborted = false;
		let migrated = 0;
		let cities = 0;
		try {
			const snapshots = await this.noteSnapshots(files);
			const filled = await this.writeMigrations(snapshots);
			migrated = filled.visits;
			cities = filled.cities;
			const withAddress = snapshots.filter((note) => readAddress(note.frontmatter, this.settings.addressProperty)).length;
			const work = planGeocodeWork(snapshots, this.settings, choice.force);
			const skipped = choice.force ? 0 : Math.max(0, withAddress - work.length);
			if (work.length === 0) {
				const message = `No notes need geocoding. Skipped ${skipped}. Filled Successful Visits on ${migrated}. Filled City on ${cities}.`;
				new Notice(message);
				report(message);
				return;
			}
			await this.geocodeQueue(work, choice.force, skipped, migrated, cities, report);
		} finally {
			this.bulkRunning = false;
		}
	}

	async runSuccessfulVisitsFill(choice: Pick<BulkGeocodeChoice, 'scope' | 'folderPath'>, report: (message: string) => void): Promise<void> {
		if (this.bulkRunning) {
			new Notice('A bulk run is already running.');
			return;
		}
		if (choice.scope === 'folder' && !this.folderExists(choice.folderPath)) {
			new Notice('That folder was not found.');
			report('That folder was not found.');
			return;
		}
		const files = collectNotes(this.app, choice);
		this.bulkRunning = true;
		this.bulkAborted = false;
		try {
			report('Reading notes…');
			const filled = await this.writeMigrations(await this.noteSnapshots(files));
			const message = `Filled Successful Visits on ${filled.visits}. Filled City on ${filled.cities}.`;
			report(message);
			new Notice(message, 8_000);
		} finally {
			this.bulkRunning = false;
		}
	}

	private async geocodeQueue(
		work: GeocodeWorkItem[],
		force: boolean,
		skipped: number,
		migrated: number,
		cities: number,
		report: (message: string) => void,
	): Promise<void> {
		const progress = new Notice(`Geocoding 0 of ${work.length}…`, 0);
		let updated = 0;
		let fromCache = 0;
		let noMatch = 0;
		let failed = 0;
		let passed = 0;
		let stopped = false;

		try {
			for (let index = 0; index < work.length; index += 1) {
				if (this.bulkAborted) {
					stopped = true;
					break;
				}
				const item = work[index];
				if (!item) continue;
				const message = `Geocoding ${index + 1} of ${work.length}…`;
				progress.setMessage(message);
				report(message);
				const outcome = await this.geocodeWorkItem(item, force);
				if (outcome === 'updated') updated += 1;
				else if (outcome === 'cached') {
					updated += 1;
					fromCache += 1;
				} else if (outcome === 'none') noMatch += 1;
				else if (outcome === 'passed') passed += 1;
				else if (outcome === 'stopped') {
					stopped = true;
					failed += 1;
					break;
				} else if (outcome === 'cancelled') {
					stopped = true;
					break;
				} else failed += 1;
			}
		} finally {
			progress.hide();
		}

		const summary = `Updated ${updated} (${fromCache} from saved lookups). Skipped ${skipped}. Picker skipped ${passed}. No match ${noMatch}. Failed ${failed}. Filled Successful Visits on ${migrated}. Filled City on ${cities}.${stopped ? ' Stopped early.' : ''}`;
		report(summary);
		new Notice(summary, 10_000);
	}

	private async geocodeCurrent(): Promise<void> {
		const quiet = this.quietCreateGeocode;
		this.quietCreateGeocode = false;
		if (this.housemateSourcePath) return;
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') {
			new Notice('Open a note to look up its address.');
			return;
		}
		if (!this.settingsReady()) return;

		// Read the file, not the metadata cache. Templater may have just written
		// Address, and the cache can still show the previous frontmatter.
		const address = readAddress(await this.freshFrontmatter(file), this.settings.addressProperty);
		if (!address) {
			new Notice(`This note has no “${this.settings.addressProperty}” to look up.`);
			return;
		}

		const cached = getCached(this.geocodeCache, address);
		if (cached) {
			await this.presentHits(file, address, cached, true, quiet);
			return;
		}

		const notice = new Notice('Looking up address…', 0);
		try {
			const hits = await this.lookupAddress(address, true);
			await this.presentHits(file, address, hits, false, quiet);
		} catch (error) {
			new Notice(this.friendlyError(error));
		} finally {
			notice.hide();
		}
	}

	private async presentHits(file: TFile, address: string, hits: GeocodeHit[], fromCache: boolean, quiet = false): Promise<void> {
		const verified = this.verifiedNewRvHit;
		this.verifiedNewRvHit = null;
		if (verified && addressesMatchOneForOne(address, verified.formattedAddress)) {
			const fresh = hits.find((hit) => addressesMatchOneForOne(hit.formattedAddress, verified.formattedAddress));
			await this.writeHit(file, address, fresh ?? verified, fresh ? hits : [verified, ...hits], !quiet);
			return;
		}
		const decision = decideGeocodePick(hits, this.settings.homeCounties);
		if (decision.hit) {
			await this.writeHit(file, address, decision.hit, hits, !quiet);
			if (quiet || this.pendingNewRvPath === file.path) this.armSettledVisitFocus(file);
			return;
		}
		this.openPicker(file, address, hits, fromCache, quiet);
	}

	promptVisit(path: string, displayName: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			new Notice('That note is not in the vault.');
			return;
		}
		const modal = new VisitConfirmModal(this.app, displayName, (answer) => {
			if (!answer) return;
			if (answer === 'past') {
				this.promptPastVisit(file);
				return;
			}
			if (answer === 'archive') {
				this.confirmArchive(file);
				return;
			}
			void this.writeVisit(file, answer).catch((error: unknown) => {
				new Notice(this.friendlyError(error));
			});
		});
		modal.open();
	}

	private async writeVisit(file: TFile, outcome: VisitOutcome): Promise<void> {
		if (outcome === 'miss') {
			await this.commitInstantMiss(file);
			return;
		}
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const study = resolveStatus(readProperty(frontmatter, 'Status'), finiteVisitCount(readProperty(frontmatter, 'Priority'))) === 'Study';
		const share = await this.promptLiterature(file, { study, campaign: true });
		if (share === false) {
			this.coverageDecisions.delete(file.path);
			return;
		}
		const companion = share.companion?.trim() ? formatStoredCompanion(share.companion) : '';
		await this.commitVisit(file, outcome, companion, share);
	}

	/** In-note Not home. Same instant write as the card and the hub. */
	async logNoteMiss(file: TFile | { path: string }): Promise<boolean> {
		const note = this.asNoteFile(file);
		if (!note) throw new Error('RV log: that note is not in the vault.');
		await this.commitInstantMiss(note);
		return true;
	}

	/** A Templater target can be a path-shaped object. The writers need a vault file. */
	private asNoteFile(file: TFile | { path?: string } | null | undefined): TFile | null {
		if (file instanceof TFile) return this.isLogTemplate(file) ? null : file;
		const path = file && typeof file.path === 'string' ? file.path : '';
		if (!path || this.isLogTemplatePath(path)) return null;
		const found = this.app.vault.getAbstractFileByPath(path);
		return found instanceof TFile ? found : null;
	}

	private isLogTemplate(file: TFile): boolean {
		return this.isLogTemplatePath(file.path);
	}

	private isLogTemplatePath(path: string): boolean {
		const base = path.split('/').pop() ?? '';
		return /RV Log (?:Home|Miss)\.md$/i.test(base) || /99 RV Log/i.test(base);
	}

	private missToast: { path: string; before: string; campaign: CampaignRecord | null; timer: number } | null = null;

	private async commitInstantMiss(file: TFile): Promise<void> {
		const before = await this.app.vault.read(file);
		const campaign = this.campaign ? { ...this.campaign, covered: [...this.campaign.covered] } : null;
		await this.commitVisit(file, 'miss', '', emptyShare(), true);
		this.showNotHomeToast(file, before, campaign);
	}

	/** Home and the rvLog.js fallback. Same clearance as Not home. */
	showRvToast(message: string): void {
		this.showLoggedToast(message);
	}

	/** Confirmation. Sits above the phone nav and the desktop status bar. */
	private showLoggedToast(message: string, undo?: () => void): void {
		document.querySelectorAll('.rv-nh-toast').forEach((node) => node.remove());
		const toast = document.createElement('div');
		toast.className = 'rv-nh-toast';
		const text = document.createElement('span');
		text.className = 'rv-toast-text';
		fillToastText(text, message);
		toast.append(text);
		if (undo) toast.append(this.undoButton(undo));
		this.mountToast(toast);
		window.setTimeout(() => toast.remove(), undo ? 6000 : 4500);
	}

	private undoButton(undo: () => void): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'mod-undo';
		const icon = document.createElement('span');
		icon.className = 'rv-toast-icon';
		setIcon(icon, 'undo-2');
		const label = document.createElement('span');
		label.textContent = 'Undo';
		button.append(icon, label);
		button.addEventListener('click', () => undo());
		return button;
	}

	/** Measure the nav, toolbar, and status bar, and keep the toast above them. */
	private mountToast(toast: HTMLElement): void {
		document.body.appendChild(toast);
		watchBottomToast(toast);
	}

	private showNotHomeToast(file: TFile, before: string, campaign: CampaignRecord | null): void {
		this.missToast?.timer && window.clearTimeout(this.missToast.timer);
		document.querySelectorAll('.rv-nh-toast').forEach((node) => node.remove());
		const toast = document.createElement('div');
		toast.className = 'rv-nh-toast';
		const text = document.createElement('span');
		text.className = 'rv-toast-text';
		const name = cardPersonTitle(file.basename, false);
		const nameEl = fillToastText(text, `Not home logged · ${name}`);
		const actions = document.createElement('span');
		actions.className = 'rv-toast-actions';
		const campaignOn = campaignIsActive(this.campaign);
		if (campaignOn && this.campaign) {
			const covered = document.createElement('button');
			covered.className = 'mod-covered';
			covered.type = 'button';
			const icon = document.createElement('span');
			icon.className = 'rv-toast-icon';
			setIcon(icon, 'book-check');
			const label = document.createElement('span');
			label.textContent = 'Covered';
			covered.append(icon, label);
			covered.addEventListener('click', () => {
				void this.coverInstantMiss(file, this.campaign?.name ?? '').then(() => covered.remove());
			});
			actions.appendChild(covered);
		}
		actions.append(this.undoButton(() => { void this.undoInstantMiss(); }));
		const timer = document.createElement('span');
		timer.className = 'rv-toast-timer';
		timer.appendChild(document.createElement('i'));
		toast.append(text, actions, timer);
		this.mountToast(toast);
		window.setTimeout(() => {
			if (nameEl && text.scrollWidth > text.clientWidth + 1) nameEl.remove();
		}, 0);
		const handle = window.setTimeout(() => {
			toast.remove();
			if (this.missToast?.path === file.path) this.missToast = null;
		}, 6000);
		this.missToast = { path: file.path, before, campaign, timer: handle };
	}

	private async coverInstantMiss(file: TFile, name: string): Promise<void> {
		if (!name) return;
		await this.app.vault.process(file, (data) => {
			const info = getFrontMatterInfo(data);
			const body = data.slice(info.contentStart);
			const lines = body.split('\n');
			for (let index = lines.length - 1; index >= 0; index -= 1) {
				const line = lines[index] ?? '';
				if (!/not home/i.test(line) || /covered /i.test(line)) continue;
				lines[index] = `${line.replace(/\s+$/, '')} — covered ${name}`;
				return data.slice(0, info.contentStart) + lines.join('\n');
			}
			return data;
		});
		await this.markCovered(file.path);
	}

	private async undoInstantMiss(): Promise<void> {
		const snap = this.missToast;
		if (!snap) return;
		window.clearTimeout(snap.timer);
		this.missToast = null;
		document.querySelectorAll('.rv-nh-toast').forEach((node) => node.remove());
		const file = this.app.vault.getFileByPath(snap.path);
		if (file) await this.app.vault.modify(file, snap.before);
		this.campaign = snap.campaign;
		await this.persist();
		for (const callback of this.viewRefreshers) callback();
		const undone = document.createElement('div');
		undone.className = 'rv-nh-toast';
		const undoneText = document.createElement('span');
		undoneText.className = 'rv-toast-text';
		fillToastText(undoneText, 'Undone');
		undone.append(undoneText);
		this.mountToast(undone);
		window.setTimeout(() => undone.remove(), 1600);
	}

	ghostIconForCard(path: string): 'hourglass' | 'moon' | 'ban' | null {
		if (this.snoozeActiveFor(path)) return 'moon';
		const file = this.app.vault.getFileByPath(path);
		const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
		const priority = finiteVisitCount(readProperty(frontmatter, 'Priority'));
		const days = propertyDays(readProperty(frontmatter, 'Last Spoke'));
		if (days != null && insidePriorityFloor(days, priority, this.settings.idealityFloorDays)) return 'hourglass';
		return null;
	}

	snoozeActiveFor(path: string): boolean {
		return snoozeActive(this.snoozeUntilFor(path), new Date());
	}

	snoozeLabelFor(path: string): string {
		const file = this.app.vault.getFileByPath(path);
		const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
		const label = readProperty(frontmatter, SNOOZE_LABEL_PROPERTY);
		return typeof label === 'string' ? label.trim() : '';
	}

	snoozeDaysLeftFor(path: string): number {
		const until = this.snoozeUntilFor(path);
		if (!until) return 0;
		return snoozeDaysLeft(until, new Date());
	}

	passesSnoozeFilter(path: string): boolean {
		const filter = this.settings.snoozeListFilter;
		if (filter !== 'snoozed' && filter !== 'awake') return true;
		const active = this.snoozeActiveFor(path);
		return filter === 'snoozed' ? active : !active;
	}

	private countySuggestCache: string[] = [];

	/** Bundled US counties ("Citrus County, FL"), filtered by what was typed. */
	knownCounties(query = ''): string[] {
		return listedUsCounties(query);
	}

	/** Fill the county cache when an API key is set. The chevron reads the cache. */
	warmCountySuggest(query: string): Promise<void> {
		const apiKey = this.settings.geoapifyApiKey.trim();
		const text = query.trim();
		if (!apiKey || text.length < 3) return Promise.resolve();
		const url = buildCountySuggestUrl(text, apiKey, this.settings.geoapifyRegion);
		return fetch(url).then(async (response) => {
			if (!response.ok) return;
			const hits = parseGeocodeBody(await response.json());
			const next = hits.map((hit) => hit.county || hit.formattedAddress).filter((name) => name.trim().length > 0);
			if (next.length > 0) this.countySuggestCache = next;
		}).then(() => undefined, () => undefined);
	}

	/** In-note Home. Same write as the card, including literature, media, and lessons. */
	async logNoteHome(file: TFile | { path: string }): Promise<boolean> {
		const note = this.asNoteFile(file);
		if (!note) throw new Error('RV log: that note is not in the vault.');
		const shareBox = { share: emptyShare() };
		const companion = await this.promptCompanion(note.path, shareBox);
		if (companion === false) return false;
		await this.commitVisit(note, 'home', companion, shareBox.share);
		return true;
	}

	/**
	 * `Name 2` when `Name` is already a note. `ignorePath` is the file being renamed.
	 * Templater's user script calls this before `tp.file.rename`.
	 */
	uniqueNewRvTitle(title: string, ignorePath?: string): string {
		const taken: string[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (ignorePath && file.path === ignorePath) continue;
			taken.push(file.basename);
		}
		return filenameCollision(title, taken);
	}

	/**
	 * Suffix only the file Templater just created. A stamp strip, or any name
	 * that is not `current 2`, is refused so an open note cannot be renamed.
	 */
	private async suffixCollidingName(file: TFile): Promise<void> {
		const next = this.uniqueNewRvTitle(file.basename, file.path);
		if (!collisionSuffixOnly(file.basename, next)) return;
		const folder = file.parent?.path ?? '';
		const dest = !folder || folder === '/' ? `${next}.md` : `${folder}/${next}.md`;
		if (dest === file.path || this.app.vault.getAbstractFileByPath(dest)) return;
		await this.app.fileManager.renameFile(file, dest);
	}

	private async commitVisit(file: TFile, outcome: VisitOutcome, companion: string, share: VisitShare, silent = false): Promise<void> {
		const before = silent ? '' : await this.app.vault.read(file);
		const campaignSnap = this.campaign ? { ...this.campaign, covered: [...this.campaign.covered] } : null;
		const now = new Date();
		const coveredName = this.coverageDecisions.get(file.path) === 'yes' ? (this.campaign?.name ?? '') : '';
		let notesProperty: string | null = null;
		let visitsAfter: VisitEntry[] = [];
		await this.app.vault.process(file, (data) => {
			const info = getFrontMatterInfo(data);
			const head = data.slice(0, info.contentStart);
			const body = data.slice(info.contentStart);
			if (outcome === 'home') notesProperty = nextVisitNotesProperty(body);
			const nextBody = applyVisitBody(body, outcome, now, companion, share, coveredName);
			visitsAfter = listVisits(nextBody);
			return head + nextBody;
		});
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			applyVisitFrontmatter(data, outcome, now, companion, share);
			syncMet(data, visitsAfter, now);
			this.pinVisitPaint(file.path, data);
		});
		await this.rememberShare(share);
		await this.restabilizeCompanions(file);
		await this.consumeCoverage(file.path, outcome);
		if (!silent) {
			const label = outcome === 'home' ? 'Home' : 'Not home';
			const name = cardPersonTitle(file.basename, true);
			this.showLoggedToast(`${label} logged on “${name}”.`, () => {
				void this.undoVisitWrite(file, before, campaignSnap);
			});
		}
		await this.afterVisitWrite(file, outcome, notesProperty);
	}

	/** Log past visit, from the priority badge, the note's button, or the command. */
	promptPastVisit(file: TFile): void {
		void this.openPastVisit(file);
	}

	private async openPastVisit(file: TFile): Promise<void> {
		const campaign = this.campaign;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const study = resolveStatus(readProperty(frontmatter, 'Status'), finiteVisitCount(readProperty(frontmatter, 'Priority'))) === 'Study';
		const defaults = await this.studyDefaults(file.path);
		new VisitEditModal(this.app, {
			title: `Log past visit on “${cardPersonTitle(file.basename, false)}”`,
			recentCompanions: this.recentCompanionNames(),
			campaign: campaign ? {
				name: campaign.name,
				start: campaign.start,
				end: campaign.end,
				pronoun: coveragePronoun(readProperty(frontmatter, 'Gender')),
			} : null,
			covered: true,
			share: this.shareFieldOptions(study, defaults),
			onCovered: (covered) => {
				this.coverageDecisions.set(file.path, covered ? 'yes' : 'no');
			},
			onSave: (facts) => {
				void this.writePastVisit(file, facts).catch((error: unknown) => {
					new Notice(this.friendlyError(error));
				});
			},
		}).open();
	}

	private async writePastVisit(file: TFile, facts: VisitFacts): Promise<void> {
		const companion = facts.home ? formatStoredCompanion(facts.companion) : '';
		const visit: VisitFacts = { ...facts, companion };
		let remaining: VisitFacts[] = [];
		let notesProperty: string | null = null;
		await this.app.vault.process(file, (data) => {
			const info = getFrontMatterInfo(data);
			const body = data.slice(info.contentStart);
			remaining = listVisits(body).map(visitFacts);
			notesProperty = visit.home ? nextVisitNotesProperty(data) : null;
			return data.slice(0, info.contentStart) + insertVisit(body, visit, { now: new Date(), notesProperty });
		});
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			applyVisitChangeFrontmatter(data, { added: visit, remaining });
			this.pinVisitPaint(file.path, data);
		});
		await this.restabilizeCompanions(file);
		await this.rememberShare({
			publications: visit.publications ?? '',
			media: visit.media ?? '',
			lesson: visit.lesson ?? '',
			lessonFrom: visit.lessonFrom ?? '',
			lessonTo: visit.lessonTo ?? '',
			extraLesson: visit.extraLesson ?? '',
			extraFrom: visit.extraFrom ?? '',
			extraTo: visit.extraTo ?? '',
		});
		await this.consumeCoverage(file.path, visit.home ? 'home' : 'miss');
		new Notice(`Logged ${describeVisit(visit)} on “${file.basename}”.`);
		await this.afterVisitWrite(file, visit.home ? 'home' : 'miss', notesProperty);
	}

	/** The card menu, the note badge, and rvLog.js all land here after the write. */
	private scheduleOpenNoteRepaint(): void {
		this.refreshOpenNoteChrome();
		this.repaintOpenUrgency();
		for (const delay of [0, 50, 200, 600, 1200]) {
			window.setTimeout(() => {
				if (this.unloaded) return;
				this.repaintOpenUrgency();
				this.refreshOpenNoteChrome();
			}, delay);
		}
	}

	/** Digest, open the new notes box, then the priority nudge. */
	private async afterVisitWrite(file: TFile, outcome: VisitOutcome, notesProperty: string | null): Promise<void> {
		await this.enqueueDigestRewrite(file);
		this.scheduleOpenNoteRepaint();
		for (const callback of this.viewRefreshers) {
			try {
				callback();
			} catch {
				/* A map refresh must not swallow the Not home toast. */
			}
		}
		if (outcome === 'home') await this.focusVisitNotes(file, notesProperty);
		await this.maybeNudgePriority(file, outcome);
	}

	private async restabilizeCompanions(file: TFile): Promise<void> {
		const current = await this.app.vault.read(file);
		const linked = this.stabilizeCompanionFrontmatter(current);
		if (linked !== current) await this.app.vault.modify(file, linked);
	}

	private activeMarkdownFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		return file && file.extension === 'md' ? file : null;
	}

	private async readVisits(file: TFile): Promise<{ list: VisitEntry[]; offset: number }> {
		const data = await this.app.vault.read(file);
		const info = getFrontMatterInfo(data);
		return {
			list: listVisits(data.slice(info.contentStart)),
			offset: data.slice(0, info.contentStart).split('\n').length - 1,
		};
	}

	private openVisitMenu(sourcePath: string, target: VisitTarget, evt: MouseEvent): void {
		const file = this.app.vault.getFileByPath(sourcePath);
		if (!file) return;
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle('Edit visit')
			.setIcon('pencil')
			.onClick(() => { void this.openVisitTarget(file, target, 'edit'); }));
		menu.addItem((item) => item
			.setTitle('Delete visit')
			.setIcon('trash-2')
			.setWarning(true)
			.onClick(() => { void this.openVisitTarget(file, target, 'delete'); }));
		menu.showAtMouseEvent(evt);
	}

	private async openVisitTarget(file: TFile, target: VisitTarget, action: 'edit' | 'delete'): Promise<void> {
		const { list, offset } = await this.readVisits(file);
		const entry = resolveVisit(list, {
			when: target.when,
			home: target.home,
			ordinal: target.ordinal,
			headingLine: target.fileLine == null ? null : target.fileLine - offset,
		});
		if (!entry) {
			new Notice('That visit is no longer on the note.');
			return;
		}
		const hint = hintFor(list, entry);
		if (action === 'edit') this.promptEditVisit(file, entry, hint);
		else this.confirmDeleteVisit(file, entry, hint);
	}

	private async pickVisit(file: TFile): Promise<void> {
		const { list } = await this.readVisits(file);
		if (list.length === 0) {
			new Notice(`No visits on “${file.basename}”.`);
			return;
		}
		new VisitPickModal(this.app, list, (entry) => this.promptEditVisit(file, entry, hintFor(list, entry))).open();
	}

	private promptEditVisit(file: TFile, entry: VisitEntry, hint: VisitHint): void {
		void this.openEditVisit(file, entry, hint);
	}

	private async openEditVisit(file: TFile, entry: VisitEntry, hint: VisitHint): Promise<void> {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const study = resolveStatus(readProperty(frontmatter, 'Status'), finiteVisitCount(readProperty(frontmatter, 'Priority'))) === 'Study';
		const defaults = await this.studyDefaults(file.path);
		const campaign = this.campaign;
		new VisitEditModal(this.app, {
			title: 'Edit visit',
			initial: visitFacts(entry),
			recentCompanions: this.recentCompanionNames(),
			campaign: campaign ? {
				name: campaign.name,
				start: campaign.start,
				end: campaign.end,
				pronoun: coveragePronoun(readProperty(frontmatter, 'Gender')),
			} : null,
			covered: Boolean(campaign && entry.covered === campaign.name),
			share: this.shareFieldOptions(study, defaults),
			onSave: (facts) => {
				void this.changeVisit(file, hint, facts).catch((error: unknown) => new Notice(this.friendlyError(error)));
			},
			onDelete: () => this.confirmDeleteVisit(file, entry, hint),
		}).open();
	}

	private confirmDeleteVisit(file: TFile, entry: VisitEntry, hint: VisitHint): void {
		const parts = entry.home
			? 'its stamp and notes, its Attempt Log line, and what it added to Visits, Successful Visits, Last Attempted, Last Spoke, and Taken'
			: 'its Attempt Log line, and what it added to Visits and Last Attempted';
		new ConfirmActionModal(this.app, {
			title: 'Delete visit',
			message: `Delete ${describeVisit(entry)}? This removes ${parts}. Met becomes the earliest visit that is not in the future. Met With is not changed.`,
			confirmText: 'Delete visit',
			warning: true,
			onConfirm: () => {
				void this.changeVisit(file, hint, null).catch((error: unknown) => new Notice(this.friendlyError(error)));
			},
		}).open();
	}

	/** Edit (`facts`) or delete (`null`) one visit, body and frontmatter together. */
	private async changeVisit(file: TFile, hint: VisitHint, facts: VisitFacts | null): Promise<void> {
		const added = facts ? { ...facts, companion: facts.home ? formatStoredCompanion(facts.companion) : '' } : null;
		let change: VisitChange | null = null;
		await this.app.vault.process(file, (data) => {
			const info = getFrontMatterInfo(data);
			const body = data.slice(info.contentStart);
			const list = listVisits(body);
			const entry = resolveVisit(list, hint);
			if (!entry) return data;
			change = {
				removed: visitFacts(entry),
				added,
				remaining: list.filter((other) => other !== entry).map(visitFacts),
				removedNotesProperty: entry.notesProperty,
			};
			const next = added ? editVisit(body, entry, added, new Date()) : removeVisit(body, entry);
			return data.slice(0, info.contentStart) + next;
		});
		const applied = change as VisitChange | null;
		if (!applied) {
			new Notice('That visit is no longer on the note.');
			return;
		}
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			applyVisitChangeFrontmatter(data, applied);
			this.pinVisitPaint(file.path, data);
		});
		await this.restabilizeCompanions(file);
		await this.syncEditedCoverage(file.path, applied);
		await this.enqueueDigestRewrite(file);
		for (const callback of this.viewRefreshers) callback();
		new Notice(added ? `Saved ${describeVisit(added)}.` : `Deleted the visit on “${file.basename}”.`);
	}

	private async syncEditedCoverage(path: string, change: VisitChange): Promise<void> {
		if (!this.campaign) return;
		const name = this.campaign.name;
		const before = change.removed?.covered ?? '';
		const after = change.added?.covered ?? '';
		const others = change.remaining.some((visit) => visit.covered === name);
		if (after === name) {
			await this.markCovered(path);
			return;
		}
		if (before === name && !others && isCovered(this.campaign, path)) {
			this.campaign = withoutCovered(this.campaign, path);
			await this.persist();
			for (const callback of this.viewRefreshers) callback();
		}
	}

	private promptAttributes(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		const current = stripFilenameStamp(file.basename);
		const suffix = file.basename.slice(current.length);
		const gender = sanitizeGender(readProperty(this.app.metadataCache.getFileCache(file)?.frontmatter, 'Gender')) ?? 'Man';
		new EditAttributesModal(this.app, { name: current, gender }, (next) => {
			if (!next) return;
			void this.applyAttributes(file, suffix, current, gender, next);
		}).open();
	}

	private async applyAttributes(
		file: TFile,
		suffix: string,
		current: string,
		gender: 'Man' | 'Woman',
		next: { name: string; gender: 'Man' | 'Woman' },
	): Promise<void> {
		if (next.gender !== gender) {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				assignProperty(frontmatter as Record<string, unknown>, 'Gender', next.gender);
			});
		}
		const name = sanitizeNoteName(stripFilenameStamp(next.name));
		if (!name || name === current) return;
		const renamed = this.app.vault.getFileByPath(file.path) ?? file;
		await this.applyRename(renamed, `${name}${suffix}`, current, name);
	}

	private async applyRename(file: TFile, nextBase: string, oldDisplay: string, newDisplay: string): Promise<void> {
		const parent = file.parent?.path ?? '';
		const dest = parent && parent !== '/' ? `${parent}/${nextBase}.md` : `${nextBase}.md`;
		await this.app.fileManager.renameFile(file, dest);
		const renamed = this.app.vault.getFileByPath(dest);
		if (!renamed) return;
		await this.app.vault.process(renamed, (data) => {
			const info = getFrontMatterInfo(data);
			const line = `> - ${formatVisitStamp(new Date())} — name ${oldDisplay} → ${newDisplay}`;
			return data.slice(0, info.contentStart) + appendLogLine(ensureAttemptLog(data.slice(info.contentStart)), line);
		});
		await this.reopenRenamedNote(renamed);
	}

	/**
	 * A rename leaves the open preview on Meta Bind's unloaded placeholders.
	 * Reopen the note and rebuild the preview so the fields bind to the new path.
	 */
	private async reopenRenamedNote(file: TFile): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		let leaf = leaves.find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === file.path);
		if (!leaf) leaf = this.app.workspace.getLeaf(false);
		if (!leaf) return;
		await leaf.openFile(file, { active: true, state: { mode: 'preview', source: false } });
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const preview = view.previewMode;
		if (preview && typeof preview.rerender === 'function') preview.rerender(true);
		const state = leaf.getViewState();
		const inner = state.state && typeof state.state === 'object' ? state.state : {};
		await leaf.setViewState({ ...state, state: { ...inner, mode: 'source', source: true } });
		await leaf.setViewState({ ...state, state: { ...inner, mode: 'preview', source: false } });
		this.openInReadingView(file, true);
		const shown = leaf.view instanceof MarkdownView ? leaf.view.containerEl : view.containerEl;
		const sweep = (afterLayout: boolean): void => { this.stripHiddenUnloaded(shown, afterLayout); };
		sweep(false);
		const win = shown.ownerDocument.defaultView;
		if (win && typeof win.requestAnimationFrame === 'function') {
			win.requestAnimationFrame(() => {
				if (this.unloaded) return;
				sweep(true);
				win.requestAnimationFrame(() => {
					if (!this.unloaded) sweep(true);
				});
			});
		}
	}

	/** Hidden Meta Bind leftovers after a rename. A parent that only contains the token stays. */
	private stripHiddenUnloaded(root: ParentNode, afterLayout: boolean): void {
		const nodes = root.querySelectorAll('*');
		for (const node of Array.from(nodes)) {
			if (!(node instanceof HTMLElement) || !node.isConnected) continue;
			let own = '';
			for (const child of Array.from(node.childNodes)) {
				if (child.nodeType === Node.TEXT_NODE) own += child.textContent ?? '';
			}
			if (own.trim() !== '[MB_UNLOADED]') continue;
			const styleAttr = (node.getAttribute('style') ?? '').replace(/\s/g, '').toLowerCase();
			const className = typeof node.className === 'string' ? node.className : '';
			let hidden = node.hidden
				|| node.getAttribute('aria-hidden') === 'true'
				|| styleAttr.includes('display:none')
				|| /unloaded|mb-hidden|is-hidden/i.test(className);
			const view = node.ownerDocument.defaultView;
			if (!hidden && view) {
				try {
					const style = view.getComputedStyle(node);
					hidden = style.display === 'none' || style.visibility === 'hidden';
					if (!hidden && afterLayout) hidden = node.getClientRects().length === 0;
				} catch {
					hidden = afterLayout && node.getClientRects().length === 0;
				}
			}
			if (hidden) node.remove();
		}
	}

	confirmArchive(file: TFile): void {
		const inactive = this.noteIsInactive(file);
		new ConfirmActionModal(this.app, inactive ? {
			title: 'Unarchive RV',
			message: `Set “${file.basename}” back to Active with Priority 1? The note and its visits stay.`,
			confirmText: 'Unarchive',
			warning: false,
			onConfirm: () => {
				void this.archiveRv(file, false).catch((error: unknown) => new Notice(this.friendlyError(error)));
			},
		} : {
			title: 'Archive RV',
			message: `Set Priority on “${file.basename}” to 0? The note and its visits stay. It moves to Inactive, and you can unarchive it at any time.`,
			confirmText: 'Archive',
			warning: true,
			onConfirm: () => {
				void this.archiveRv(file, true).catch((error: unknown) => new Notice(this.friendlyError(error)));
			},
		}).open();
	}

	private async archiveRv(file: TFile, archive: boolean): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			const priority = finiteVisitCount(readProperty(data, 'Priority')) ?? 0;
			const current = resolveStatus(readProperty(data, 'Status'), priority);
			const next = applyStatusPriority(
				{ status: current, priority },
				archive ? { status: 'Inactive', priority: 0 } : { status: 'Active', priority: 1 },
			);
			assignProperty(data, 'Status', next.status);
			assignProperty(data, 'Priority', next.priority);
		});
		for (const callback of this.viewRefreshers) callback();
		new Notice(archive ? `Archived “${file.basename}”. Priority is 0.` : `Unarchived “${file.basename}”. Priority is 1.`);
	}

	/**
	 * Open the note (or bring its tab forward) and put the caret in the new
	 * notes box. One scroll lands on that box. The source line is not scrolled
	 * first, so the preview does not jump away and come back. On iOS the
	 * keyboard may stay down, because focus here does not come straight from a tap.
	 */
	private async focusVisitNotes(file: TFile, property: string | null): Promise<void> {
		if (this.unloaded) return;
		let data = '';
		try {
			data = await this.app.vault.read(file);
		} catch {
			data = '';
		}
		const info = getFrontMatterInfo(data);
		const lines = data.split('\n');
		const name = property ?? highestNotesProperty(data.slice(info.contentStart));
		const fieldAt = name ? lines.findIndex((line) => line.includes(`INPUT[textArea:${name}]`)) : -1;
		const heading = fieldAt > 0
			? /^(?:###|#####)\s+(.+?)\s*$/.exec((lines[fieldAt - 1] ?? '').replace(/\r$/, ''))
			: null;
		const stamp = heading ? stripStampAge(heading[1] ?? '') : '';
		const ordinal = stamp
			? lines.slice(0, fieldAt - 1).filter((line) => line.includes(stamp) && /^#{3,5}\s/.test(line)).length
			: 0;

		let leaf = this.app.workspace.getLeavesOfType('markdown')
			.find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === file.path);
		if (leaf) {
			this.app.workspace.setActiveLeaf(leaf, { focus: false });
		} else {
			leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file, { active: true, state: { mode: 'preview', source: false } });
		}
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		this.openInReadingView(file, true);
		this.stopVisitFocus?.();
		this.stopVisitFocus = armVisitNoteFocus(view.containerEl, name ?? '', () => this.markdownRoot(file.path));
		if (!name || fieldAt < 1) return;
		for (let attempt = 0; attempt < FOCUS_ATTEMPTS; attempt += 1) {
			if (this.unloaded) return;
			await new Promise((resolve) => window.setTimeout(resolve, FOCUS_STEP_MS));
			blurNoteTitle(view.containerEl.ownerDocument);
			const area = focusVisitNoteField(view.containerEl, name) ?? placeVisitNoteFocus(view.containerEl, stamp, ordinal);
			if (!area) continue;
			fitNotesBox(area);
			area.scrollIntoView({ block: 'center' });
			if (area.ownerDocument.activeElement === area) return;
		}
		void ordinal;
	}

	/** The markdown leaf for `path`, after a preview remount replaces the old root. */
	private markdownRoot(path: string): HTMLElement | null {
		const leaf = this.app.workspace.getLeavesOfType('markdown')
			.find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === path);
		const view = leaf?.view;
		return view instanceof MarkdownView ? view.containerEl : null;
	}

	/** Pull the caret into the visit textarea once the note's preview has settled. */
	private armSettledVisitFocus(file: TFile, notesKey = ''): void {
		const root = this.markdownRoot(file.path);
		if (!root) return;
		this.stopVisitFocus?.();
		this.stopVisitFocus = armVisitNoteFocus(root, notesKey, () => this.markdownRoot(file.path));
		placeVisitNoteFocus(root, '', 0);
	}

	private openPicker(file: TFile, address: string, hits: GeocodeHit[], fromCache: boolean, quiet = false): void {
		const settleNotes = (): void => { this.armSettledVisitFocus(file); };
		const modal = new GeocodeSuggestModal(
			this.app,
			hits,
			fromCache,
			(hit) => {
				void this.writeHit(file, address, hit, hits, !quiet).catch((error: unknown) => {
					new Notice(this.friendlyError(error));
				}).finally(settleNotes);
			},
			async () => {
				const notice = new Notice('Looking up address…', 0);
				try {
					const fresh = await this.lookupAddress(address, true);
					hits = fresh;
					return fresh;
				} catch (error) {
					new Notice(this.friendlyError(error));
					return hits;
				} finally {
					notice.hide();
				}
			},
			() => { settleNotes(); },
		);
		modal.open();
	}

	private async geocodeWorkItem(item: GeocodeWorkItem, force: boolean): Promise<'updated' | 'cached' | 'none' | 'failed' | 'stopped' | 'cancelled' | 'passed'> {
		const file = this.app.vault.getFileByPath(item.path);
		if (!file) return 'failed';
		const cached = force ? undefined : getCached(this.geocodeCache, item.address);
		try {
			const results = cached ?? await this.lookupAddress(item.address, true, () => this.bulkAborted);
			if (results.length === 0) return 'none';
			const decision = decideGeocodePick(results, this.settings.homeCounties);
			let hit = decision.hit;
			if (!hit) {
				if (this.bulkAborted) return 'cancelled';
				hit = await this.askForHit(file, item.address, results, Boolean(cached));
				if (!hit) return this.bulkAborted ? 'cancelled' : 'passed';
			}
			await this.writeHit(file, item.address, hit, results, false);
			return cached ? 'cached' : 'updated';
		} catch (error) {
			if (error instanceof CancelledError) return 'cancelled';
			if (error instanceof GeocodeRequestError && (error.status === 401 || error.status === 403 || error.status === 429)) {
				new Notice(this.friendlyError(error));
				return 'stopped';
			}
			const message = error instanceof Error ? error.message : 'Geocoding failed.';
			console.error('RV Locator:', redactSecrets(message, this.settings.geoapifyApiKey));
			return 'failed';
		}
	}

	private askForHit(file: TFile, address: string, hits: GeocodeHit[], fromCache: boolean): Promise<GeocodeHit | null> {
		return new Promise((resolve) => {
			let settled = false;
			const finish = (hit: GeocodeHit | null) => {
				if (settled) return;
				settled = true;
				resolve(hit);
			};
			const modal = new GeocodeSuggestModal(
				this.app,
				hits,
				fromCache,
				(hit) => finish(hit),
				async () => {
					const notice = new Notice('Looking up address…', 0);
					try {
						const fresh = await this.lookupAddress(address, true, () => this.bulkAborted);
						hits = fresh;
						return fresh;
					} catch (error) {
						new Notice(this.friendlyError(error));
						return hits;
					} finally {
						notice.hide();
					}
				},
				() => finish(null),
			);
			modal.heading = `Choose a location for ${file.basename}`;
			modal.open();
		});
	}

	private async writeHit(file: TFile, queriedAddress: string, hit: GeocodeHit, results: GeocodeHit[], notify = true): Promise<void> {
		const pair = locationPair(hit);
		let mapLink = '';
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			applyGeocodeHit(data, hit, this.settings);
			const link = readProperty(data, this.settings.mapLinkProperty);
			mapLink = typeof link === 'string' ? link : '';
		});
		await this.app.vault.process(file, (data) => {
			let next = data;
			if (!isLockedAddressName(this.settings.locationProperty, this.settings.addressProperty)) {
				next = ensureQuotedLocationList(next, this.settings.locationProperty, pair, this.settings.addressProperty);
			}
			if (mapLink) next = refreshBodyMapLink(next, mapLink);
			return next;
		});
		this.remember([queriedAddress], results);
		await this.persist();
		if (notify) new Notice(`Saved coordinates on “${file.basename}”. Address was not changed.`);
	}

	async lookupAddress(
		address: string,
		ignoreCache: boolean,
		aborted: () => boolean = () => false,
		bias?: GeocodeBias | null,
	): Promise<GeocodeHit[]> {
		if (!ignoreCache && !bias) {
			const cached = getCached(this.geocodeCache, address);
			if (cached) return cached;
		}
		const results = await geocodeAddress(address, this.settings.geoapifyApiKey.trim(), {
			// Direct fetch only. Geoapify is not called through requestUrl or a geocode SDK.
			fetchImpl: fetch,
			sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
			pacer: this.pacer,
			aborted,
		}, this.settings.geoapifyRegion, bias);
		if (!bias) {
			this.remember([address], results);
			await this.persist();
		}
		return results;
	}

	/**
	 * Link every note at this address to the others, and copy the source note's
	 * already confirmed location onto the new note. Does not geocode.
	 */
	private async linkHousehold(sourcePath: string, created: TFile): Promise<void> {
		const source = this.app.vault.getFileByPath(sourcePath);
		if (!source) return;
		const sourceFrontmatter = await this.freshFrontmatter(source);
		const createdFrontmatter = await this.freshFrontmatter(created);
		const sourceAddress = readAddress(sourceFrontmatter, this.settings.addressProperty) ?? '';
		const createdAddress = readAddress(createdFrontmatter, this.settings.addressProperty) ?? '';
		const samePlace = sourceAddress.length > 0 && addressesMatchOneForOne(createdAddress, sourceAddress);
		if (samePlace) await this.copyConfirmedLocation(created, sourceFrontmatter);
		const key = normalizeAddress(createdAddress);
		const files = key
			? this.app.vault.getMarkdownFiles().filter((file) => {
				const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
				const noteAddress = readAddress(frontmatter, this.settings.addressProperty) ?? '';
				return normalizeAddress(noteAddress) === key;
			})
			: [];
		if (!files.some((file) => file.path === created.path)) files.push(created);
		if (samePlace && !files.some((file) => file.path === source.path)) files.push(source);
		const names = files.map((file) => file.basename);
		for (const file of files) {
			const others = names.filter((name) => name !== file.basename);
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const data = frontmatter as Record<string, unknown>;
				const next = mergeHouseholdHubs(readProperty(data, 'Hub'), others);
				assignProperty(data, 'Hub', next);
				this.hubOverride.set(file.path, next.slice());
			});
		}
		this.refreshOpenNoteChrome();
		for (const callback of this.viewRefreshers) callback();
	}

	private async copyConfirmedLocation(
		created: TFile,
		sourceFrontmatter: Record<string, unknown> | null,
	): Promise<void> {
		if (!sourceFrontmatter) return;
		const names = locationCopyNames(this.settings);
		await this.app.fileManager.processFrontMatter(created, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			for (const name of names) {
				const value = readProperty(sourceFrontmatter, name);
				if (value == null || value === '') continue;
				assignProperty(data, name, value);
			}
		});
		const point = latLonFromUnknown(readProperty(sourceFrontmatter, this.settings.locationProperty));
		if (!point) return;
		const pair = locationPair(point);
		await this.app.vault.process(created, (data) => ensureQuotedLocationList(
			data,
			this.settings.locationProperty,
			pair,
			this.settings.addressProperty,
		));
	}

	private friendlyError(error: unknown): string {
		if (error instanceof GeocodeRequestError && (error.status === 401 || error.status === 403)) {
			return 'Geoapify rejected the API key. Check RV Locator settings.';
		}
		if (error instanceof GeocodeRequestError && error.status === 429) {
			return 'Geoapify rate limit reached. Wait a moment and try again.';
		}
		const raw = error instanceof Error ? error.message : 'Geocoding failed.';
		return redactSecrets(raw, this.settings.geoapifyApiKey) || 'Geocoding failed.';
	}

	private settingsReady(): boolean {
		if (!this.settings.geoapifyApiKey.trim()) {
			new Notice('Add a Geoapify API key in RV Locator settings.');
			return false;
		}
		if (this.settings.addressProperty.trim().toLowerCase() === this.settings.locationProperty.trim().toLowerCase()) {
			new Notice('Address and location property names must be different.');
			return false;
		}
		return true;
	}

	private folderExists(folderPath: string): boolean {
		if (folderPath === '' || folderPath === '/') return true;
		return this.app.vault.getFolderByPath(folderPath) != null;
	}

	private async freshFrontmatter(file: TFile): Promise<Record<string, unknown> | null> {
		try {
			const text = await this.app.vault.read(file);
			return frontmatterFromMarkdown(text);
		} catch {
			return (await this.snapshotAsync(file)).frontmatter;
		}
	}

	private snapshot(file: TFile): NoteSnapshot {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!frontmatter) return { path: file.path, frontmatter: null };
		return { path: file.path, frontmatter: { ...frontmatter } };
	}

	private async noteSnapshots(files: TFile[]): Promise<NoteSnapshot[]> {
		const notes: NoteSnapshot[] = [];
		for (const file of files) notes.push(await this.snapshotAsync(file));
		return notes;
	}

	private async snapshotAsync(file: TFile): Promise<NoteSnapshot> {
		const cached = this.snapshot(file);
		if (cached.frontmatter) return cached;
		try {
			const text = await this.app.vault.cachedRead(file);
			return { path: file.path, frontmatter: frontmatterFromMarkdown(text) };
		} catch {
			return { path: file.path, frontmatter: null };
		}
	}

	private remember(addresses: string[], results: GeocodeHit[]): void {
		this.geocodeCache = rememberResults(this.geocodeCache, addresses, results);
	}

	private suggestionCalloutType(): string {
		const accent = this.settings.suggestionColor === 'auto' ? readAccentHsl() : null;
		return calloutTypeForChoice(this.settings.suggestionColor, accent);
	}

	private digestKey(): string {
		return JSON.stringify({
			grid: this.settings.availabilityGrid,
			orientation: this.settings.digestOrientation,
			days: this.settings.digestDays,
			thresholds: this.digestThresholds(),
			abbreviate: this.settings.abbreviateDayparts,
			suggestion: this.suggestionCalloutType(),
		});
	}

	private digestThresholds() {
		return {
			trySoftMin: this.settings.digestTrySoftMin,
			avoidSoftMax: this.settings.digestAvoidSoftMax,
			avoidMinTrials: this.settings.digestAvoidMinTrials,
			tryMinHomes: this.settings.digestTryMinHomes,
		};
	}

	private rewriteAllDigests(): Promise<void> {
		const run = this.digestRewrite.then(() => this.rewriteVaultDigests());
		this.digestRewrite = run.catch(() => undefined);
		return run;
	}

	/**
	 * Version bumps do not rewrite notes. Stamp ages and other display-only
	 * text are computed when the note renders. A digest setting the person
	 * changes still rewrites the stored table, because that table lives in
	 * the note.
	 */
	private applyDigestPolish(): Promise<void> {
		return Promise.resolve();
	}

	private async rewriteVaultDigests(collapseLog = false): Promise<void> {
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.unloaded) return;
			await this.rewriteDigestFile(file, collapseLog);
			if (collapseLog) await this.polishStatusAndHub(file);
		}
	}

	private isTemplateNote(file: TFile): boolean {
		const folder = this.extrasPlacement().templatesFolder.replace(/\/+$/, '');
		return folder.length > 0 && (file.path === folder || file.path.startsWith(`${folder}/`));
	}

	private enqueueDigestRewrite(file: TFile, overrides?: readonly SlotOverride[]): Promise<void> {
		const run = this.digestRewrite.then(() => this.rewriteDigestFile(file, false, overrides));
		this.digestRewrite = run.catch(() => undefined);
		return run;
	}

	/**
	 * Templater writes the New RV body after the prompts, which can be well after
	 * the vault create event. Poll until Attempt Log is present, then fill the digest.
	 */
	private async watchCreatedDigest(file: TFile): Promise<void> {
		const path = file.path;
		for (let attempt = 0; attempt < 180; attempt += 1) {
			if (this.unloaded) return;
			await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 800 : 1000));
			const current = this.app.vault.getFileByPath(path);
			if (!current || this.isTemplateNote(current)) return;
			let text = '';
			try {
				text = await this.app.vault.cachedRead(current);
			} catch {
				return;
			}
			if (!text.trim() || text.includes('<%')) continue;
			const hasLog = /\[!note\][^\n]*(?:Attempt Log|Log)/i.test(text);
			const hasVisit = /(?:success|\bhome\b|not home|\bmiss\b)/i.test(text);
			this.openInReadingView(current, true);
			if (this.pendingNewRvPath === current.path) this.armNewRvFocus(current);
			if (hasLog && hasVisit) {
				await this.refreshAttemptDigest(current);
				return;
			}
			if (attempt >= 8) return;
		}
	}

	private async rewriteDigestFile(file: TFile, collapseLog = false, overrides?: readonly SlotOverride[]): Promise<void> {
		if (file.extension !== 'md') return;
		if (this.isTemplateNote(file)) return;
		const current = this.app.vault.getFileByPath(file.path);
		if (!current) return;
		try {
			await this.app.vault.process(current, (data) => {
				const info = getFrontMatterInfo(data);
				let next = data.slice(0, info.contentStart) + ensureVisitButtons(ensureDashboardLeadBlank(unfoldDashboard(data.slice(info.contentStart))));
				next = restoreExactVisitClocks(next, frontmatterFromMarkdown(data));
				next = ensureVisitNotesHeading(next);
				if (collapseLog) next = collapseAttemptLog(next);
				const log = readAttemptLog(next);
				const saved = parseSlotOverrides(readProperty(frontmatterFromMarkdown(data), SLOT_OVERRIDE_PROPERTY));
				const digest = suggestReturnDigest({
					buckets: log.buckets,
					entries: log.entries,
					grid: this.settings.availabilityGrid,
					orientation: this.settings.digestOrientation,
					days: this.settings.digestDays,
					thresholds: this.digestThresholds(),
					overrides: overrides ?? saved,
					abbreviate: this.settings.abbreviateDayparts,
				});
				const rewritten = upsertAttemptDigest(next, digest, {
					collapse: collapseLog,
					suggestionType: this.suggestionCalloutType(),
				});
				return rewritten ?? next;
			});
		} catch {
			return;
		}
	}

	private async undoVisitWrite(file: TFile, before: string, campaign: CampaignRecord | null): Promise<void> {
		document.querySelectorAll('.rv-nh-toast').forEach((node) => node.remove());
		const current = this.app.vault.getFileByPath(file.path);
		if (current && before) await this.app.vault.modify(current, before);
		this.campaign = campaign;
		await this.persist();
		this.refreshOpenNoteChrome();
		for (const callback of this.viewRefreshers) callback();
	}

	private async applySnooze(path: string, choice: SnoozeChoice | SnoozeWrite | 'clear'): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			if (choice === 'clear') {
				removeProperty(data, URGENCY_SNOOZE_PROPERTY);
				removeProperty(data, SNOOZE_START_PROPERTY);
				removeProperty(data, SNOOZE_LABEL_PROPERTY);
				return;
			}
			if (typeof choice === 'string') {
				const now = new Date();
				assignProperty(data, URGENCY_SNOOZE_PROPERTY, formatSnoozeUntil(choice, now));
				assignProperty(data, SNOOZE_START_PROPERTY, formatSnoozeStart(now));
				removeProperty(data, SNOOZE_LABEL_PROPERTY);
				return;
			}
			assignProperty(data, URGENCY_SNOOZE_PROPERTY, choice.until);
			assignProperty(data, SNOOZE_START_PROPERTY, choice.start);
			if (choice.label) assignProperty(data, SNOOZE_LABEL_PROPERTY, choice.label);
			else removeProperty(data, SNOOZE_LABEL_PROPERTY);
		});
		this.refreshOpenNoteChrome();
		for (const callback of this.viewRefreshers) callback();
	}

	private async maybeNudgePriority(file: TFile, outcome?: VisitOutcome): Promise<void> {
		const text = await this.app.vault.read(file);
		const frontmatter = frontmatterFromMarkdown(text);
		const successful = finiteVisitCount(readProperty(frontmatter, 'Successful Visits'));
		const resolved = outcome ?? outcomeFromAttemptLog(text);
		if (!shouldNudgePriority(resolved, successful, this.settings.priorityNudgeEvery)) return;
		const current = finiteVisitCount(readProperty(frontmatter, 'Priority'));
		const priority = current == null ? this.settings.defaultNewRvPriority : Math.max(0, Math.min(5, Math.round(current)));
		const next = await new Promise<number | null>((resolve) => {
			const modal = new PriorityNudgeModal(this.app, priority, (value) => resolve(value));
			const previous = modal.onClose.bind(modal);
			modal.onClose = () => {
				previous();
				resolve(null);
			};
			modal.open();
		});
		if (next == null || next === priority) return;
		await this.writePriority(file, next);
	}

	private async loadPluginData(): Promise<void> {
		const data = await this.loadData() as StoredPluginData | null;
		this.settings = mergeSettings(data?.settings);
		this.campaign = sanitizeCampaign(data?.campaign);
		this.nearbySort = sanitizeNearbySort(data?.nearbySort);
		this.geocodeCache = sanitizeCache(data?.geocodeCache);
		this.digestPolish = data?.digestPolish === DIGEST_POLISH_VERSION ? DIGEST_POLISH_VERSION : 0;
		this.accentGate.markApplied(typeof data?.suggestionTypeApplied === 'string' ? data.suggestionTypeApplied : '');
	}

	private async writeMigrations(snapshots: readonly NoteSnapshot[]): Promise<{ visits: number; cities: number }> {
		let visits = 0;
		let cities = 0;
		for (const note of snapshots) {
			if (this.bulkAborted) break;
			if (!note.frontmatter) continue;
			const probe = { ...note.frontmatter };
			const visit = fillSuccessfulVisits(probe);
			const city = fillCity(probe, this.settings.addressProperty, this.settings.locationProperty);
			if (!visit && !city) continue;
			const file = this.app.vault.getFileByPath(note.path);
			if (!file) continue;
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const data = frontmatter as Record<string, unknown>;
				if (visit) fillSuccessfulVisits(data);
				if (city) fillCity(data, this.settings.addressProperty, this.settings.locationProperty);
			});
			if (visit) visits += 1;
			if (city) cities += 1;
		}
		return { visits, cities };
	}

	private persist(): Promise<void> {
		this.persistQueued = this.persistQueued.then(async () => {
			await this.saveData({
				settings: this.settings,
				geocodeCache: this.geocodeCache,
				nearbySort: this.nearbySort,
				digestPolish: this.digestPolish,
				suggestionTypeApplied: this.accentGate.applied,
				campaign: this.campaign,
			});
		}).catch((error: unknown) => {
			const message = error instanceof Error ? error.message : 'Could not save plugin data.';
			console.error('RV Locator: could not save plugin data.', redactSecrets(message, this.settings.geoapifyApiKey));
		});
		return this.persistQueued;
	}
}

interface TemplaterPluginHandle {
	/** Templater settings: `templates_folder` and `user_scripts_folder`. */
	settings?: { templates_folder?: unknown; user_scripts_folder?: unknown };
	templater?: {
		create_new_note_from_template?: (template: TFile) => Promise<TFile | undefined>;
	};
}

function readTemplaterPlugin(app: App): TemplaterPluginHandle | null {
	const host = app as App & {
		plugins?: {
			plugins?: Record<string, TemplaterPluginHandle | undefined>;
			getPlugin?: (id: string) => TemplaterPluginHandle | null;
		};
	};
	const plugins = host.plugins;
	if (!plugins) return null;
	return plugins.plugins?.[TEMPLATER_PLUGIN_ID] ?? plugins.getPlugin?.(TEMPLATER_PLUGIN_ID) ?? null;
}

function findTemplateFile(app: App, paths: readonly string[]): TFile | null {
	for (const path of paths) {
		const file = app.vault.getFileByPath(path);
		if (file?.extension === 'md') return file;
	}
	return null;
}

function outcomeFromAttemptLog(text: string): VisitOutcome | 'unknown' {
	const entries = readAttemptLog(text).entries;
	const last = entries[entries.length - 1];
	if (!last) return 'unknown';
	return last.home ? 'home' : 'miss';
}

function highestNotesProperty(body: string): string | null {
	let highest = 0;
	for (const match of body.matchAll(/`INPUT\[textArea:sVisit(\d+)Notes\]`/g)) {
		const index = Number(match[1]);
		if (Number.isInteger(index) && index > highest) highest = index;
	}
	return highest > 0 ? `sVisit${highest}Notes` : null;
}

function finiteVisitCount(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) ? parsed : null;
}

function textProperty(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).join(' · ');
	return '';
}

function propertyDays(value: unknown): number | null {
	const raw = dateTextFromUnknown(value);
	return raw ? calendarDaysSince(raw) : null;
}

/** Calendar-day match. Empty on both sides counts as the cache having caught up. */
function sameVisitStamp(cached: unknown, painted: unknown): boolean {
	const left = dateTextFromUnknown(cached).slice(0, 10);
	const right = dateTextFromUnknown(painted).slice(0, 10);
	if (!left && !right) return true;
	return left.length > 0 && left === right;
}

function lessonList(value: unknown): string[] {
	const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
	const names: string[] = [];
	for (const item of source) {
		if (typeof item !== 'string') continue;
		const text = item.trim();
		if (text) names.push(text);
	}
	return names;
}

function driveDateRows(frontmatter: { [key: string]: unknown } | undefined): { icon: string; dow: string; time: string; rest: string; days: string }[] {
	const specs: readonly [string, string][] = [
		['book-marked', 'Last Studied'],
		['message-circle', 'Last Spoke'],
		['clock', 'Last Attempted'],
		['home', 'Met'],
	];
	const rows: { icon: string; dow: string; time: string; rest: string; days: string }[] = [];
	for (const [icon, name] of specs) {
		const value = readProperty(frontmatter, name);
		const raw = value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '';
		if (!raw.trim()) continue;
		const display = formatDriveDate(raw);
		if (display.empty) continue;
		const days = calendarDaysSince(raw);
		rows.push({
			icon,
			dow: display.dow ?? '',
			time: display.time ?? '',
			rest: display.rest ?? '',
			days: days == null ? '' : formatGlanceableCounter(days),
		});
	}
	return rows;
}

function counterText(value: unknown): string {
	const raw = value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '';
	const days = raw ? calendarDaysSince(raw) : null;
	return days == null ? '' : formatGlanceableCounter(days);
}

function locationCopyNames(settings: RVLocatorSettings): string[] {
	const names = [
		'City',
		settings.cityProperty,
		settings.countyProperty,
		settings.stateProperty,
		settings.postcodeProperty,
		settings.countryProperty,
		settings.mapLinkProperty,
	];
	const address = settings.addressProperty.trim().toLowerCase();
	const location = settings.locationProperty.trim().toLowerCase();
	const seen = new Set<string>();
	const out: string[] = [];
	for (const name of names) {
		const trimmed = name.trim();
		const key = trimmed.toLowerCase();
		if (!trimmed || key === address || key === location || seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	return out;
}

function housemateGender(value: unknown): RvGender {
	return value === 'Woman' ? 'Woman' : 'Man';
}

function hubLabelList(value: unknown): string {
	const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
	return source.map((item) => hubLabel(item)).join('\n');
}
