import { MarkdownView, Menu, Notice, Plugin, TFile, getFrontMatterInfo, parseYaml, type App, type HoverParent, type IconName, type WorkspaceLeaf } from 'obsidian';
import type { NearbyScope } from './active-layout';
import { addressesMatchOneForOne, googleMapsAddressLink, normalizeAddress, recentAddresses, refreshBodyMapLink, type GeocodeBias } from './address';
import { collapseAttemptLog, decorateAttemptLog, DIGEST_POLISH_VERSION, upsertAttemptDigest } from './attempt-digest';
import { getCached, rememberResults, sanitizeCache } from './cache';
import {
	GLANCABLE_VIEW_TYPE,
	HOVER_SOURCE,
	REQUEST_GAP_MS,
} from './constants';
import { GeocodeRequestError, geocodeAddress } from './geocode-client';
import { applyGeocodeHit, assignProperty, ensureQuotedLocationList, fillCity, fillSuccessfulVisits, isLockedAddressName, locationPair, planGeocodeWork, readAddress, readProperty, removeProperty, type GeocodeWorkItem, type NoteSnapshot } from './frontmatter';
import { decideGeocodePick, preferHomeRegion } from './home-base';
import { companionRecency, formatStoredCompanion, recentCompanionNames as collectRecentCompanionNames, stabilizeCompanionFrontmatter as quoteCompanionFrontmatter } from './companions';
import { resolveExtrasPlacement, type ExtrasPlacement } from './extras-sync';
import { applyVisitBody, applyVisitFrontmatter, ensureDashboardLeadBlank, ensureVisitButtons, ensureVisitNotesHeading, nextVisitNotesProperty, refreshHomeStampAges, restoreExactVisitClocks, shouldNudgePriority, unfoldDashboard, type VisitOutcome } from './visit-log';
import { applyVisitChangeFrontmatter, describeVisit, editVisit, hintFor, insertVisit, listVisits, removeVisit, resolveVisit, syncMet, visitFacts, type VisitChange, type VisitEntry, type VisitFacts, type VisitHint } from './visit-editor';
import { ConfirmActionModal, LiteraturePromptModal, VisitEditModal, VisitPickModal } from './visit-modals';
import { LESSONS, MEDIA_TITLES, PUBLICATION_TITLES, emptyShare, rememberCustom, renameCustom, renameLabelInMarkdown, type VisitShare } from './catalog';
import type { ShareFieldOptions } from './catalog-fields';
import { newestLessonEnd } from './visit-share';
import { decorateArchiveButton, decorateMapLink, decorateVisitControls, ensureIconAlias, VisitButtonLongPress, type VisitTarget } from './visit-controls';
import { decorateNoteChrome, type NoteChromeHost } from './note-chrome';
import { campaignIsActive, isCovered, sanitizeCampaign, withCovered, type CampaignRecord } from './campaign';
import { askCampaignCovered, CampaignModal } from './campaign-modal';
import { hubLabel, mergeHouseholdHubs, moveHubLeft } from './hub-row';
import { HubFileSuggestModal } from './hub-suggester';
import { SlotOverrideModal } from './override-modal';
import { formatSlotOverride, parseSlotOverrides, SLOT_OVERRIDE_PROPERTY, type SlotOverride } from './slot-override';
import { layoutVisitNotes } from './visit-display';
import { pagePreviewDecision } from './page-preview';
import { RvMapView, MAP_VIEW_TYPE } from './map-view';
import type { MapPin } from './map-pins';
import { buildMapPins } from './map-pins';
import { NewRvIdentityModal, type NewRvIdentity } from './new-rv-modal';
import { PrioritySliderModal } from './priority-modal';
import { applyStatusPriority, resolveStatus, sanitizeCampaignListFilter, sanitizeGenderFilter, sanitizeReturnScope, statusForNewNote, type CampaignListFilter, type GenderFilter, type ReturnScope, type RvGender, type RvStatus } from './status';
import { fitNotesBox, fitNotesBoxes, isNotesBox } from './notes-autosize';
import { stripStampAge } from './dates';
import { AccentDriftGate, calloutTypeForChoice, readAccentHsl } from './suggestion-callout';
import { isRvDashboardNote, refreshStampAgeLabels } from './rv-note-view';
import { NearbyGlancableView } from './glancable-view';
import { TEMPLATER_PLUGIN_ID, newRvLaunchError, newRvTemplateCandidates } from './new-rv-launch';
import { BulkGeocodeModal, CompanionSuggestModal, GeocodeSuggestModal, SuccessfulVisitsModal, VisitConfirmModal, collectNotes, coveragePronoun, type BulkGeocodeChoice, type CoverageDecision } from './modals';
import { PriorityNudgeModal, ReturnSuggestModal, UrgencySnoozeModal } from './score-modals';
import { currentReturnBucket, readAttemptLog, suggestReturnDigest, type AttemptBuckets } from './schedule';
import { URGENCY_SNOOZE_PROPERTY, formatSnoozeUntil, parseSnoozeUntil, snoozeActive, type SnoozeChoice } from './snooze';
import { META_BIND_PLUGIN_ID, requiredSetupGaps, shouldPersistSetupWizardCompleted, shouldShowSetupNudge } from './setup-check';
import { SetupWizardModal, readSetupSnapshot, shouldAutoOpenSetupWizard } from './setup-wizard';
import { latLonFromUnknown, validLatLon } from './distance';
import { calendarDaysSince } from './dates';
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
	const info = getFrontMatterInfo(text);
	if (!info.exists || !info.frontmatter.trim()) return null;
	const parsed: unknown = parseYaml(info.frontmatter);
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
const FOCUS_ATTEMPTS = 40;
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
	/** Picked Geoapify hit whose formatted address was submitted unchanged. */
	private verifiedNewRvHit: GeocodeHit | null = null;
	/** Set while Add a housemate is creating a note. The template skips geocode. */
	housemateSourcePath: string | null = null;
	private homeBiasKey = '';
	private homeBiasPoint: GeocodeBias | null = null;
	/** Hub lists written before the metadata cache catches up, so the chip row updates immediately. */
	private hubOverride = new Map<string, unknown>();
	/** Address typed into the custom box before the cache catches up. */
	private addressOverride = new Map<string, string>();
	/** One campaign at a time. Null when none is saved. */
	campaign: CampaignRecord | null = null;
	/** Coverage answers collected beside the companion prompt, keyed by note path. */
	private coverageDecisions = new Map<string, CoverageDecision>();

	async onload(): Promise<void> {
		await this.loadPluginData();
		this.addSettingTab(new RVLocatorSettingTab(this.app, this));
		this.registerHoverLinkSource(HOVER_SOURCE, {
			display: 'RV Locator',
			defaultMod: false,
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

		this.registerMarkdownPostProcessor((element, context) => {
			const hasCallout = element.classList.contains('callout') || element.querySelector('.callout') != null;
			decorateAttemptLog(element, hasCallout ? this.suggestionCalloutType() : undefined);
			refreshStampAgeLabels(element);
			this.decorateOpenNote(element, context.sourcePath);
			decorateVisitControls(
				element,
				() => context.getSectionInfo(element)?.lineStart ?? null,
				(target, evt) => this.openVisitMenu(context.sourcePath, target, evt),
			);
			for (const delay of NOTES_FIT_DELAYS_MS) {
				window.setTimeout(() => {
					if (this.unloaded) return;
					fitNotesBoxes(element);
					this.decorateOpenNote(element, context.sourcePath);
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
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleAgeRefresh()));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleAgeRefresh()));
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
	private applyLayoutClasses(): void {
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
	}

	/** Map earth, archive label, Quick Facts, and the shared Hub row. Meta Bind may remount, so this runs again. */
	private decorateOpenNote(element: HTMLElement, path: string): void {
		decorateMapLink(element, () => { void this.openMapSoon(path); });
		decorateArchiveButton(element, this.pathIsInactive(path));
		decorateNoteChrome(element, path, this.noteChromeHost());
		this.layoutOpenVisits(element, path);
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
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		void this.app.vault.cachedRead(file).then((markdown) => {
			if (this.unloaded) return;
			layoutVisitNotes(element, markdown, {
				newestFirst: this.settings.visitsNewestFirst,
				collapseOlder: this.settings.collapseOlderVisits,
				limit: this.settings.visibleVisitCount,
			});
		});
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
		this.scheduleAgeRefresh();
		this.scheduleNotesFit();
		if (!file) return;
		window.setTimeout(() => this.openInReadingView(file, false), 0);
	}

	/**
	 * Show an RV note in Reading view. Only the first open of a file in a leaf
	 * is switched, so choosing editing afterwards is kept until the next open.
	 * `force` is for a new note whose template finished after it was opened.
	 */
	private openInReadingView(file: TFile, force: boolean): void {
		if (this.unloaded) return;
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== file.path) continue;
			const previous = this.readingViewFor.get(leaf);
			this.readingViewFor.set(leaf, file.path);
			if (!force && previous === file.path) continue;
			if (!this.settings.openRvInReadingView || this.isTemplateNote(file)) continue;
			if (!isRvDashboardNote(this.app.metadataCache.getFileCache(file)?.frontmatter)) continue;
			if (view.getMode() === 'preview') continue;
			const state = leaf.getViewState();
			void leaf.setViewState({ ...state, state: { ...state.state, mode: 'preview' } });
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
	 * With Automatic color, a settled accent change rewrites Return
	 * Suggestions on every RV note to the nearest callout type. Also catches
	 * an accent changed while Obsidian was closed.
	 */
	private checkAccent(): void {
		if (this.unloaded || this.settings.suggestionColor !== 'auto') return;
		const type = this.suggestionCalloutType();
		if (!this.accentGate.observe(type)) return;
		this.accentGate.markApplied(type);
		this.digestKeyApplied = this.digestKey();
		this.recolorOpenSuggestions();
		void this.persist();
		void this.rewriteAllDigests();
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
				recentAddresses: this.recentAddressLabels(),
				lookupAddress: (query) => this.suggestAddresses(query),
				publications: [...PUBLICATION_TITLES, ...this.settings.customPublications],
				media: [...MEDIA_TITLES, ...this.settings.customMedia],
			}, (value) => resolve(value)).open();
		});
		if (!identity || this.unloaded) return;
		this.newRvDraft = identity;
		this.housemateSourcePath = null;
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
				intro: 'Same choices as a new RV. The address starts from this note.',
				defaultPriority: this.settings.defaultNewRvPriority,
				companions: this.recentCompanionNames(),
				recentAddresses: this.recentAddressLabels(),
				lookupAddress: (query) => this.suggestAddresses(query),
				publications: [...PUBLICATION_TITLES, ...this.settings.customPublications],
				media: [...MEDIA_TITLES, ...this.settings.customMedia],
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
				new Notice(message ?? 'Templater could not start New RV.');
				return;
			}
			const sourcePath = this.housemateSourcePath;
			const created = await create.call(templater.templater, template);
			if (!created) new Notice('Templater did not create the New RV note.');
			else if (created instanceof TFile) {
				const draft = this.newRvDraft;
				if (draft) await this.writeNewRvShare(created, draft);
				await this.refreshAttemptDigest(created);
				if (sourcePath) await this.linkHousehold(sourcePath, created);
			}
		} catch (error) {
			const reason = error instanceof Error && error.message ? error.message : 'Templater could not create the note.';
			new Notice(reason);
		} finally {
			this.creatingNewRv = false;
			this.newRvDraft = null;
			this.housemateSourcePath = null;
		}
	}

	private async writeNewRvShare(file: TFile, identity: NewRvIdentity): Promise<void> {
		if (!identity.publications && !identity.media) return;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			if (identity.publications) assignProperty(data, 'Left Publications', identity.publications);
			if (identity.media) assignProperty(data, 'Shared Media', identity.media);
		});
		await this.rememberShare({ ...emptyShare(), publications: identity.publications, media: identity.media });
	}

	/** One-shot gender and optional name for the New RV template. Cleared after it is read. */
	takeNewRvDraft(): NewRvIdentity | null {
		const draft = this.newRvDraft;
		this.newRvDraft = null;
		return draft;
	}

	onunload(): void {
		this.unloaded = true;
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
		const lessonFrom = path && study ? await this.newestLessonEnd(path) : '';
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
					...this.shareFieldOptions(study, lessonFrom),
					onShare: (share) => {
						if (shareBox) shareBox.share = share;
					},
				} : null,
			);
			modal.open();
		});
		if (picked === false) return false;
		const name = picked?.trim() ?? '';
		if (!name) return '';
		return formatStoredCompanion(name);
	}

	/** Quoted Taken / Met With wikilinks, after processFrontMatter may have flattened them. */
	stabilizeCompanionFrontmatter(markdown: string): string {
		return quoteCompanionFrontmatter(markdown);
	}

	private shareFieldOptions(study: boolean, lessonFrom = '', forceLiterature = false): ShareFieldOptions {
		return {
			publications: [...this.settings.customPublications, ...PUBLICATION_TITLES],
			media: [...this.settings.customMedia, ...MEDIA_TITLES],
			customLessons: this.settings.customLessons,
			lessons: [...LESSONS],
			showLiterature: forceLiterature || !study || this.settings.showStudyLiterature,
			showLesson: study,
			initial: { ...emptyShare(), lessonFrom },
		};
	}

	private async newestLessonEnd(path: string): Promise<string> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return '';
		try {
			return newestLessonEnd(await this.app.vault.cachedRead(file));
		} catch {
			return '';
		}
	}

	private async promptLiterature(_file: TFile): Promise<VisitShare | false> {
		return new Promise((resolve) => {
			new LiteraturePromptModal(this.app, this.shareFieldOptions(false), (share) => resolve(share)).open();
		});
	}

	private async rememberShare(share: VisitShare): Promise<void> {
		const publications = rememberCustom(this.settings.customPublications, share.publications, PUBLICATION_TITLES);
		const media = rememberCustom(this.settings.customMedia, share.media, MEDIA_TITLES);
		const lessons = rememberCustom(this.settings.customLessons, share.lesson, LESSONS.map((lesson) => lesson.title));
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
		if (this.settings.returnScope === 'active' && this.settings.genderFilter === 'all' && this.settings.campaignListFilter === 'all') return;
		this.settings.returnScope = 'active';
		this.settings.genderFilter = 'all';
		this.settings.campaignListFilter = 'all';
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
		this.viewRefreshers.add(callback);
		return () => {
			this.viewRefreshers.delete(callback);
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
		};
	}

	private noteFrontmatter(path: string): Record<string, unknown> | null {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return null;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
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
		return data;
	}

	private async writeAddress(path: string, address: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		const property = this.settings.addressProperty.trim() || 'Address';
		const next = address.replace(/\r?\n/g, ' ').trim();
		this.addressOverride.set(path, next);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			assignProperty(frontmatter as Record<string, unknown>, property, next);
		});
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
		const until = this.snoozeUntilFor(path);
		const modal = new UrgencySnoozeModal(this.app, displayName, snoozeActive(until, new Date()), (choice) => {
			void this.applySnooze(path, choice);
		});
		modal.open();
	}

	/**
	 * Templater rvLog calls this after a visit is on disk.
	 * Refreshes that note's digest and may ask about priority.
	 * A miss never asks. Home asks when Successful Visits hits a multiple of N.
	 */
	async noteVisitLogged(file: TFile, outcome?: VisitOutcome): Promise<void> {
		if (outcome === 'home' || outcome === 'miss') await this.consumeCoverage(file.path, outcome);
		await this.enqueueDigestRewrite(file);
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

	mapFocusPath: string | null = null;

	/** Earth on a card, beside Address, or on the hub. The external route icon stays a maps link. */
	async openMapSoon(path?: string): Promise<void> {
		this.mapFocusPath = path ?? null;
		const leaves = this.app.workspace.getLeavesOfType(MAP_VIEW_TYPE);
		const existing = leaves[0];
		if (existing) {
			await this.app.workspace.revealLeaf(existing);
			const view = existing.view;
			if (view instanceof RvMapView) view.recenter();
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: MAP_VIEW_TYPE, active: true });
		void this.app.workspace.revealLeaf(leaf);
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
			return {
				path: file.path,
				name: file.basename,
				lat: point?.lat ?? Number.NaN,
				lon: point?.lon ?? Number.NaN,
				priority,
				days: raw ? calendarDaysSince(raw) : null,
				inactive: status === 'Inactive',
			};
		});
		return buildMapPins(rows, this.settings.idealityFloorDays, this.settings.urgencyThresholdDays, colors);
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

	/** Quick Facts route badge. Stored Map Link when it is a URL, otherwise a Google Maps search. */
	async openRoute(path: string): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		const frontmatter = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
		const stored = readProperty(frontmatter, this.settings.mapLinkProperty);
		const storedUrl = typeof stored === 'string' && /^https?:\/\//i.test(stored.trim()) ? stored.trim() : '';
		const address = readAddress(frontmatter, this.settings.addressProperty) ?? '';
		const cityName = this.settings.cityProperty.trim() || 'City';
		const city = readProperty(frontmatter, cityName);
		const cityText = typeof city === 'string' ? city : '';
		const url = storedUrl || (address ? googleMapsAddressLink(address, cityText) : '');
		if (!url) {
			new Notice('This note has no address to open in Google Maps.');
			return;
		}
		window.open(url, '_blank', 'noopener');
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
		const yes = await askCampaignCovered(this.app, this.campaign.name);
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
		menu.addItem((item) => item.setTitle('Snooze today').setIcon('moon').onClick(() => { void this.applySnooze(path, 'today'); }));
		menu.addItem((item) => item.setTitle('Snooze 7 days').setIcon('moon').onClick(() => { void this.applySnooze(path, '7'); }));
		menu.addItem((item) => item.setTitle('Snooze 14 days').setIcon('moon').onClick(() => { void this.applySnooze(path, '14'); }));
		menu.showAtMouseEvent(event);
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
			await this.presentHits(file, address, cached, true);
			return;
		}

		const notice = new Notice('Looking up address…', 0);
		try {
			const hits = await this.lookupAddress(address, true);
			await this.presentHits(file, address, hits, false);
		} catch (error) {
			new Notice(this.friendlyError(error));
		} finally {
			notice.hide();
		}
	}

	private async presentHits(file: TFile, address: string, hits: GeocodeHit[], fromCache: boolean): Promise<void> {
		const verified = this.verifiedNewRvHit;
		this.verifiedNewRvHit = null;
		if (verified && addressesMatchOneForOne(address, verified.formattedAddress)) {
			const fresh = hits.find((hit) => addressesMatchOneForOne(hit.formattedAddress, verified.formattedAddress));
			await this.writeHit(file, address, fresh ?? verified, fresh ? hits : [verified, ...hits]);
			return;
		}
		const decision = decideGeocodePick(hits, this.settings.homeCounties);
		if (decision.hit) {
			await this.writeHit(file, address, decision.hit, hits);
			return;
		}
		this.openPicker(file, address, hits, fromCache);
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
		const now = new Date();
		const shareBox = { share: emptyShare() };
		let companion = '';
		if (outcome === 'home') {
			const picked = await this.promptCompanion(file.path, shareBox);
			if (picked === false) {
				this.coverageDecisions.delete(file.path);
				return;
			}
			companion = picked;
		} else {
			const share = await this.promptLiterature(file);
			if (share === false) return;
			shareBox.share = share;
		}
		let notesProperty: string | null = null;
		let visitsAfter: VisitEntry[] = [];
		await this.app.vault.process(file, (data) => {
			const info = getFrontMatterInfo(data);
			const head = data.slice(0, info.contentStart);
			const body = data.slice(info.contentStart);
			if (outcome === 'home') notesProperty = nextVisitNotesProperty(body);
			const nextBody = applyVisitBody(body, outcome, now, companion, shareBox.share);
			visitsAfter = listVisits(nextBody);
			return head + nextBody;
		});
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			applyVisitFrontmatter(data, outcome, now, companion, shareBox.share);
			syncMet(data, visitsAfter, now);
		});
		await this.rememberShare(shareBox.share);
		await this.restabilizeCompanions(file);
		await this.consumeCoverage(file.path, outcome);
		const label = outcome === 'home' ? 'Home' : 'Not home';
		new Notice(`${label} logged on “${file.basename}”. Address was not changed.`);
		await this.afterVisitWrite(file, outcome, notesProperty);
	}

	/** Log past visit, from the priority badge, the note's button, or the command. */
	promptPastVisit(file: TFile): void {
		const campaign = this.shouldAskCoverage(file.path) ? this.campaign : null;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const study = resolveStatus(readProperty(frontmatter, 'Status'), finiteVisitCount(readProperty(frontmatter, 'Priority'))) === 'Study';
		new VisitEditModal(this.app, {
			title: `Log past visit on “${file.basename}”`,
			recentCompanions: this.recentCompanionNames(),
			campaignName: campaign?.name,
			share: this.shareFieldOptions(study, '', true),
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
			applyVisitChangeFrontmatter(frontmatter as Record<string, unknown>, { added: visit, remaining });
		});
		await this.restabilizeCompanions(file);
		await this.rememberShare({
			publications: visit.publications ?? '',
			media: visit.media ?? '',
			lesson: visit.lesson ?? '',
			lessonFrom: visit.lessonFrom ?? '',
			lessonTo: visit.lessonTo ?? '',
		});
		await this.consumeCoverage(file.path, visit.home ? 'home' : 'miss');
		new Notice(`Logged ${describeVisit(visit)} on “${file.basename}”.`);
		await this.afterVisitWrite(file, visit.home ? 'home' : 'miss', notesProperty);
	}

	/** Digest, open the new notes box, then the priority nudge. */
	private async afterVisitWrite(file: TFile, outcome: VisitOutcome, notesProperty: string | null): Promise<void> {
		await this.enqueueDigestRewrite(file);
		for (const callback of this.viewRefreshers) callback();
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
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const study = resolveStatus(readProperty(frontmatter, 'Status'), finiteVisitCount(readProperty(frontmatter, 'Priority'))) === 'Study';
		new VisitEditModal(this.app, {
			title: 'Edit visit',
			initial: visitFacts(entry),
			recentCompanions: this.recentCompanionNames(),
			share: this.shareFieldOptions(study, entry.lessonFrom ?? '', true),
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
			applyVisitChangeFrontmatter(frontmatter as Record<string, unknown>, applied);
		});
		await this.restabilizeCompanions(file);
		await this.enqueueDigestRewrite(file);
		for (const callback of this.viewRefreshers) callback();
		new Notice(added ? `Saved ${describeVisit(added)}.` : `Deleted the visit on “${file.basename}”.`);
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
		const data = await this.app.vault.read(file);
		const info = getFrontMatterInfo(data);
		const lines = data.split('\n');
		const name = property ?? highestNotesProperty(data.slice(info.contentStart));
		if (!name) return;
		const fieldAt = lines.findIndex((line) => line.includes(`INPUT[textArea:${name}]`));
		if (fieldAt < 1) return;
		const heading = /^(?:###|#####)\s+(.+?)\s*$/.exec((lines[fieldAt - 1] ?? '').replace(/\r$/, ''));
		const stamp = heading ? stripStampAge(heading[1] ?? '') : '';
		if (!stamp) return;
		const ordinal = lines.slice(0, fieldAt - 1).filter((line) => line.includes(stamp) && /^#{3,5}\s/.test(line)).length;

		let leaf = this.app.workspace.getLeavesOfType('markdown')
			.find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === file.path);
		if (leaf) {
			this.app.workspace.setActiveLeaf(leaf, { focus: false });
		} else {
			leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file, { active: true });
		}
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;

		let steady = 0;
		let placed: HTMLTextAreaElement | null = null;
		for (let attempt = 0; attempt < FOCUS_ATTEMPTS && steady < 3; attempt += 1) {
			if (this.unloaded) return;
			await new Promise((resolve) => window.setTimeout(resolve, FOCUS_STEP_MS));
			const area = notesBoxAfterStamp(view.containerEl, stamp, ordinal);
			if (!area) continue;
			if (area.ownerDocument.activeElement === area) {
				steady += 1;
			} else {
				steady = 0;
				area.focus({ preventScroll: true });
				const end = area.value.length;
				area.setSelectionRange(end, end);
			}
			if (placed === area) continue;
			fitNotesBox(area);
			area.scrollIntoView({ block: 'center' });
			placed = area;
		}
	}

	private openPicker(file: TFile, address: string, hits: GeocodeHit[], fromCache: boolean): void {
		const modal = new GeocodeSuggestModal(
			this.app,
			hits,
			fromCache,
			(hit) => {
				void this.writeHit(file, address, hit, hits).catch((error: unknown) => {
					new Notice(this.friendlyError(error));
				});
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
	 * First launch of this digest shape rewrites every RV note. Return
	 * Suggestions wraps the voice lines, and Attempt Log is nested inside it
	 * with the daypart table above the bullets. The suggestions callout type
	 * follows the color setting. Visible `%%` and HTML digest markers are
	 * removed. An opened Attempt Log is collapsed once. Later Home and Not
	 * home writes leave a fold the person set after that.
	 */
	private applyDigestPolish(): Promise<void> {
		if (this.digestPolish >= DIGEST_POLISH_VERSION) return Promise.resolve();
		const run = this.digestRewrite.then(async () => {
			if (this.unloaded || this.digestPolish >= DIGEST_POLISH_VERSION) return;
			const type = this.suggestionCalloutType();
			await this.rewriteVaultDigests(this.digestPolish < 10);
			if (this.unloaded) return;
			this.digestPolish = DIGEST_POLISH_VERSION;
			this.accentGate.markApplied(type);
			await this.persist();
		});
		this.digestRewrite = run.catch(() => undefined);
		return run;
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
			const hasLog = /\[!note\][^\n]*Attempt Log/i.test(text);
			const hasVisit = /(?:success|\bhome\b|not home|\bmiss\b)/i.test(text);
			if (hasLog && hasVisit) {
				await this.refreshAttemptDigest(current);
				this.openInReadingView(current, true);
				await this.focusVisitNotes(current, 'sVisit1Notes');
				return;
			}
			if (attempt >= 2) return;
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
				next = refreshHomeStampAges(next, new Date());
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

	private async applySnooze(path: string, choice: SnoozeChoice | 'clear'): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			const data = frontmatter as Record<string, unknown>;
			if (choice === 'clear') {
				removeProperty(data, URGENCY_SNOOZE_PROPERTY);
				return;
			}
			assignProperty(data, URGENCY_SNOOZE_PROPERTY, formatSnoozeUntil(choice, new Date()));
		});
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

/** The first textarea rendered after the `ordinal`th heading showing `stamp`. */
function notesBoxAfterStamp(root: HTMLElement, stamp: string, ordinal: number): HTMLTextAreaElement | null {
	const headings = Array.from(root.querySelectorAll('h3, h5, .cm-line.HyperMD-header'))
		.filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').includes(stamp));
	const heading = headings[ordinal] ?? headings[headings.length - 1];
	if (!heading) return null;
	const areas = Array.from(root.querySelectorAll('textarea'));
	for (const area of areas) {
		if (heading.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING) {
			return area;
		}
	}
	return null;
}

function finiteVisitCount(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) ? parsed : null;
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
