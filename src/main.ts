import { Notice, Plugin, TFile, getFrontMatterInfo, parseYaml, type App, type IconName } from 'obsidian';
import type { NearbyScope } from './active-layout';
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
import { applyGeocodeHit, ensureQuotedLocationList, fillCity, fillSuccessfulVisits, isLockedAddressName, locationPair, planGeocodeWork, readAddress, type GeocodeWorkItem, type NoteSnapshot } from './frontmatter';
import { decideGeocodePick } from './home-base';
import { companionRecency, formatStoredCompanion, recentCompanionNames as collectRecentCompanionNames, type CompanionNoteRef } from './companions';
import { resolveExtrasPlacement, type ExtrasPlacement } from './extras-sync';
import { applyVisitBody, applyVisitFrontmatter, type VisitOutcome } from './visit-log';
import { NearbyGlancableView } from './glancable-view';
import { TEMPLATER_PLUGIN_ID, newRvLaunchError, newRvTemplateCandidates } from './new-rv-launch';
import { BulkGeocodeModal, CompanionSuggestModal, GeocodeSuggestModal, SuccessfulVisitsModal, VisitConfirmModal, collectNotes, type BulkGeocodeChoice } from './modals';
import { META_BIND_PLUGIN_ID } from './setup-check';
import { SetupWizardModal, readSetupSnapshot } from './setup-wizard';
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
	private persistQueued: Promise<void> = Promise.resolve();
	private creatingNewRv = false;
	private wizardOpen = false;
	private unloaded = false;

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

		const registered = NEARBY_LAYOUTS.map((layout) => this.registerBasesView(layout.id, {
			name: layout.name,
			icon: layout.icon,
			factory: (controller, containerEl) => layout.mode === 'vanilla'
				? new NearbyVanillaView(controller, containerEl, this, layout.id, layout.scope)
				: new NearbyGlancableView(controller, containerEl, this, layout.id, layout.scope),
		}));
		if (registered.some((ok) => !ok)) {
			new Notice('Enable the Bases core plugin to use RV Locator nearby views.');
		}

		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded || this.settings.setupWizardCompleted) return;
			this.openSetupWizard();
		});
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
		});
		modal.open();
	}

	syncExtrasFromGitHub(): void {
		startExtrasSync(this.app, this);
	}

	/**
	 * One companion for a home visit or a new note. Empty when they skip.
	 * Wikilink form follows `linkCompanionsToNotes`.
	 */
	async promptCompanion(): Promise<string> {
		const picked = await new Promise<string | null>((resolve) => {
			const modal = new CompanionSuggestModal(this.app, this.recentCompanionNames(), resolve);
			modal.open();
		});
		const name = picked?.trim() ?? '';
		if (!name) return '';
		return formatStoredCompanion(name, this.settings.linkCompanionsToNotes, this.companionNoteRefs());
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

	private companionNoteRefs(): CompanionNoteRef[] {
		return this.app.vault.getMarkdownFiles().map((file) => ({
			path: file.path,
			basename: file.basename,
		}));
	}

	private loadSetupSnapshot() {
		const templater = readTemplaterPlugin(this.app);
		return readSetupSnapshot(this.app, this.settings, this.extrasPlacement(), templater?.settings ?? null);
	}

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
		await this.persist();
		for (const callback of this.viewRefreshers) callback();
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
			new Notice('A bulk run is already going.');
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
			new Notice('Open a Markdown note to geocode.');
			return;
		}
		if (!this.settingsReady()) return;

		// Read the file, not the metadata cache. Templater may have just written
		// Address, and the cache can still show the previous frontmatter.
		const address = readAddress(await this.freshFrontmatter(file), this.settings.addressProperty);
		if (!address) {
			new Notice(`This note has no “${this.settings.addressProperty}” text to geocode.`);
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
		const label = outcome === 'home' ? 'Home' : 'Not home';
		new Notice(`${label} logged on “${file.basename}”. Address was not changed.`);
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
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			applyGeocodeHit(frontmatter as Record<string, unknown>, hit, this.settings);
		});
		if (!isLockedAddressName(this.settings.locationProperty, this.settings.addressProperty)) {
			await this.app.vault.process(file, (data) => ensureQuotedLocationList(
				data,
				this.settings.locationProperty,
				pair,
				this.settings.addressProperty,
			));
		}
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

	private async loadPluginData(): Promise<void> {
		const data = await this.loadData() as StoredPluginData | null;
		this.settings = mergeSettings(data?.settings);
		this.nearbySort = sanitizeNearbySort(data?.nearbySort);
		this.geocodeCache = sanitizeCache(data?.geocodeCache);
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
