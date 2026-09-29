import { MarkdownView, Notice, Plugin, TFile, getFrontMatterInfo, parseYaml, type App, type IconName, type WorkspaceLeaf } from 'obsidian';
import type { NearbyScope } from './active-layout';
import { refreshBodyMapLink } from './address';
import { collapseAttemptLog, decorateAttemptLog, DIGEST_POLISH_VERSION, upsertAttemptDigest } from './attempt-digest';
import { getCached, rememberResults, sanitizeCache } from './cache';
import {
	GLANCABLE_ALL_VIEW_TYPE,
	GLANCABLE_INACTIVE_VIEW_TYPE,
	GLANCABLE_VIEW_TYPE,
	HOVER_SOURCE,
	REQUEST_GAP_MS,
	VANILLA_ALL_VIEW_TYPE,
	VANILLA_INACTIVE_VIEW_TYPE,
	VANILLA_VIEW_TYPE,
} from './constants';
import { GeocodeRequestError, geocodeAddress } from './geocode-client';
import { applyGeocodeHit, assignProperty, ensureQuotedLocationList, fillCity, fillSuccessfulVisits, isLockedAddressName, locationPair, planGeocodeWork, readAddress, readProperty, removeProperty, type GeocodeWorkItem, type NoteSnapshot } from './frontmatter';
import { decideGeocodePick } from './home-base';
import { companionRecency, formatStoredCompanion, recentCompanionNames as collectRecentCompanionNames, stabilizeCompanionFrontmatter as quoteCompanionFrontmatter } from './companions';
import { resolveExtrasPlacement, type ExtrasPlacement } from './extras-sync';
import { applyVisitBody, applyVisitFrontmatter, ensureDashboardLeadBlank, ensureVisitNotesHeading, refreshHomeStampAges, shouldNudgePriority, unfoldDashboard, type VisitOutcome } from './visit-log';
import { AccentDriftGate, calloutTypeForChoice, readAccentHsl } from './suggestion-callout';
import { isRvDashboardNote, refreshStampAgeLabels } from './rv-note-view';
import { NearbyGlancableView } from './glancable-view';
import { TEMPLATER_PLUGIN_ID, newRvLaunchError, newRvTemplateCandidates } from './new-rv-launch';
import { BulkGeocodeModal, CompanionSuggestModal, GeocodeSuggestModal, SuccessfulVisitsModal, VisitConfirmModal, collectNotes, type BulkGeocodeChoice } from './modals';
import { PriorityNudgeModal, ReturnSuggestModal, UrgencySnoozeModal } from './score-modals';
import { readAttemptLog, suggestReturnDigest, type AttemptBuckets } from './schedule';
import { URGENCY_SNOOZE_PROPERTY, formatSnoozeUntil, parseSnoozeUntil, snoozeActive, type SnoozeChoice } from './snooze';
import { META_BIND_PLUGIN_ID, requiredSetupGaps, shouldPersistSetupWizardCompleted, shouldShowSetupNudge } from './setup-check';
import { SetupWizardModal, readSetupSnapshot, shouldAutoOpenSetupWizard } from './setup-wizard';
import { CancelledError, RequestPacer } from './pacer';
import { redactSecrets } from './redact';
import { RVLocatorSettingTab, startExtrasSync } from './settings-tab';
import { DEFAULT_SETTINGS, defaultNearbySort, mergeSettings, sanitizeNearbySort, type CacheEntry, type GeocodeHit, type NearbySortPreference, type RVLocatorSettings, type StoredPluginData } from './types';
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

const NEARBY_LAYOUTS: readonly NearbyLayout[] = [
	{ id: VANILLA_VIEW_TYPE, name: 'Active (Vanilla)', icon: 'table', mode: 'vanilla', scope: 'active' },
	{ id: VANILLA_ALL_VIEW_TYPE, name: 'All (Vanilla)', icon: 'table', mode: 'vanilla', scope: 'all' },
	{ id: VANILLA_INACTIVE_VIEW_TYPE, name: 'Inactive (Vanilla)', icon: 'archive', mode: 'vanilla', scope: 'inactive' },
	{ id: GLANCABLE_VIEW_TYPE, name: 'Active (Glancable)', icon: 'smartphone', mode: 'glancable', scope: 'active' },
	{ id: GLANCABLE_ALL_VIEW_TYPE, name: 'All (Glancable)', icon: 'smartphone', mode: 'glancable', scope: 'all' },
	{ id: GLANCABLE_INACTIVE_VIEW_TYPE, name: 'Inactive (Glancable)', icon: 'archive', mode: 'glancable', scope: 'inactive' },
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

		this.registerMarkdownPostProcessor((element) => {
			const hasCallout = element.classList.contains('callout') || element.querySelector('.callout') != null;
			decorateAttemptLog(element, hasCallout ? this.suggestionCalloutType() : undefined);
			refreshStampAgeLabels(element);
		});

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

	private onNoteOpened(file: TFile | null): void {
		this.scheduleAgeRefresh();
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
			const created = await create.call(templater.templater, template);
			if (!created) new Notice('Templater did not create the New RV note.');
			else if (created instanceof TFile) await this.refreshAttemptDigest(created);
		} catch (error) {
			const reason = error instanceof Error && error.message ? error.message : 'Templater could not create the note.';
			new Notice(reason);
		} finally {
			this.creatingNewRv = false;
		}
	}

	onunload(): void {
		this.unloaded = true;
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
		}, this.settings.availabilityGrid);
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
	async promptCompanion(): Promise<string> {
		const picked = await new Promise<string | null>((resolve) => {
			const modal = new CompanionSuggestModal(this.app, this.recentCompanionNames(), resolve);
			modal.open();
		});
		const name = picked?.trim() ?? '';
		if (!name) return '';
		return formatStoredCompanion(name);
	}

	/** Quoted Taken / Met With wikilinks, after processFrontMatter may have flattened them. */
	stabilizeCompanionFrontmatter(markdown: string): string {
		return quoteCompanionFrontmatter(markdown);
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
			now: new Date(),
		});
		new ReturnSuggestModal(this.app, displayName, digest.markdown).open();
	}

	snoozeUntilFor(path: string): Date | null {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return null;
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return parseSnoozeUntil(readProperty(frontmatter, URGENCY_SNOOZE_PROPERTY));
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
		await this.enqueueDigestRewrite(file);
		await this.maybeNudgePriority(file, outcome);
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
			void this.writeVisit(file, answer).catch((error: unknown) => {
				new Notice(this.friendlyError(error));
			});
		});
		modal.open();
	}

	private async writeVisit(file: TFile, outcome: VisitOutcome): Promise<void> {
		const now = new Date();
		const companion = outcome === 'home' ? await this.promptCompanion() : '';
		await this.app.vault.process(file, (data) => {
			const info = getFrontMatterInfo(data);
			const head = data.slice(0, info.contentStart);
			return head + applyVisitBody(data.slice(info.contentStart), outcome, now);
		});
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			applyVisitFrontmatter(frontmatter as Record<string, unknown>, outcome, now, companion);
		});
		const current = await this.app.vault.read(file);
		const linked = this.stabilizeCompanionFrontmatter(current);
		if (linked !== current) await this.app.vault.modify(file, linked);
		const label = outcome === 'home' ? 'Home' : 'Not home';
		new Notice(`${label} logged on “${file.basename}”. Address was not changed.`);
		await this.noteVisitLogged(file);
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

	async lookupAddress(address: string, ignoreCache: boolean, aborted: () => boolean = () => false): Promise<GeocodeHit[]> {
		if (!ignoreCache) {
			const cached = getCached(this.geocodeCache, address);
			if (cached) return cached;
		}
		const results = await geocodeAddress(address, this.settings.geoapifyApiKey.trim(), {
			// Direct fetch only. Geoapify is not called through requestUrl or a geocode SDK.
			fetchImpl: fetch,
			sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
			pacer: this.pacer,
			aborted,
		});
		this.remember([address], results);
		await this.persist();
		return results;
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
			await this.rewriteVaultDigests(true);
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
		}
	}

	private isTemplateNote(file: TFile): boolean {
		const folder = this.extrasPlacement().templatesFolder.replace(/\/+$/, '');
		return folder.length > 0 && (file.path === folder || file.path.startsWith(`${folder}/`));
	}

	private enqueueDigestRewrite(file: TFile): Promise<void> {
		const run = this.digestRewrite.then(() => this.rewriteDigestFile(file));
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
				return;
			}
			if (attempt >= 2) return;
		}
	}

	private async rewriteDigestFile(file: TFile, collapseLog = false): Promise<void> {
		if (file.extension !== 'md') return;
		if (this.isTemplateNote(file)) return;
		const current = this.app.vault.getFileByPath(file.path);
		if (!current) return;
		try {
			await this.app.vault.process(current, (data) => {
				const info = getFrontMatterInfo(data);
				let next = data.slice(0, info.contentStart) + ensureDashboardLeadBlank(unfoldDashboard(data.slice(info.contentStart)));
				next = refreshHomeStampAges(next, new Date());
				next = ensureVisitNotesHeading(next);
				if (collapseLog) next = collapseAttemptLog(next);
				const log = readAttemptLog(next);
				const digest = suggestReturnDigest({
					buckets: log.buckets,
					entries: log.entries,
					grid: this.settings.availabilityGrid,
					orientation: this.settings.digestOrientation,
					days: this.settings.digestDays,
					thresholds: this.digestThresholds(),
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
		await this.app.fileManager.processFrontMatter(file, (data) => {
			assignProperty(data as Record<string, unknown>, 'Priority', next);
		});
	}

	private async loadPluginData(): Promise<void> {
		const data = await this.loadData() as StoredPluginData | null;
		this.settings = mergeSettings(data?.settings);
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

function finiteVisitCount(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
	const parsed = Number(value.trim());
	return Number.isFinite(parsed) ? parsed : null;
}
