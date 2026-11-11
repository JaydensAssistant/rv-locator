import { BasesView, HoverPopover, Keymap, Platform, setIcon, type HoverParent, type QueryController } from 'obsidian';
import { nextPresetSort, sortDirectionArrow, sortPresetChipLabel, sortPresetShortLabel, visibleSortPresets, type NearbyScope } from './active-layout';
import { refillKeepingFocus } from './keep-focus';
import { applyControlSizedPills, equalizeSortPills, horizontalScrollDelta } from './sort-pills';
import { GENDER_FILTER_LABEL, RETURN_SCOPE_LABEL, SNOOZE_FILTER_LABEL, nextCampaignListFilter, nextGenderFilter, nextReturnScope, nextSnoozeListFilter, type CampaignListFilter } from './status';
import { DISTANCE_COLUMN_ID, GEOAPIFY_ATTRIBUTION, HOVER_SOURCE, IDEALITY_COLUMN_ID, NON_AFFILIATION_NOTICE, OSM_ATTRIBUTION } from './constants';
import { formatGlanceableCounter } from './dates';
import { Notice } from 'obsidian';
import { domInstanceOf } from './dom';
import { formatDistance, haversineMeters, milesFromMeters, validLatLon } from './distance';
import { LivePosition, type GeoState } from './live-position';
import { readProperty } from './frontmatter';
import { buildViewModel, iconForColumn, type CellModel, type ColumnModel, type GroupModel, type RowModel } from './model';
import type RVLocatorPlugin from './main';
import { heldGlanceColumns, heldGlanceGroups } from './glance-hold';
import { hubCacheColumns } from './hub-cache';
import { annotateRowScores } from './row-score';
import { APP_TABS, appendAppSlot, dismissOpenMenus, keepMenuOnScreen } from './app-bar';
import { ensureBarSpacer } from './bar-shell';
import { armHoverTooltip } from './title-fit';
import { cycleSort, sortRowsBy, type ActiveSort } from './sort';
import type { BasesPropertyId } from 'obsidian';
import type { LatLon } from './types';

export abstract class NearbyBasesView extends BasesView implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	protected root: HTMLElement;
	protected bannerEl!: HTMLElement;
	protected bannerText!: HTMLElement;
	private toastedBanner = '';
	protected scrollEl!: HTMLElement;
	protected sortEl!: HTMLElement;
	/** Glancable search sits in the sort bar and replaces the pills while it is open. */
	protected searchSlot: HTMLElement | null = null;
	private sortMenuOpen = false;
	private sortSizeObserver: ResizeObserver | null = null;
	/** Sort chips live here so they can scroll without moving the New button. */
	protected sortButtonsEl!: HTMLElement;
	protected groups: GroupModel[] = [];
	protected columns: ColumnModel[] = [];
	protected localSort: ActiveSort;
	protected geoState: GeoState = { status: 'pending', fix: null };
	protected distanceEls = new Map<string, HTMLElement>();
	protected distanceRows = new Map<string, RowModel>();
	private position: LivePosition;
	private chromeReady = false;
	/** Glancable uses a one-line banner so the cards stay the focus. */
	protected quietBanner = false;
	private geoTimer: number | null = null;
	private unsubSettings: (() => void) | null = null;
	private resultsObserver: MutationObserver | null = null;
	private resultsWatchEl: HTMLElement | null = null;
	private resultsWatchRegistered = false;
	private writingResultCount = false;
	private resultRetry: number | null = null;
	private resultFollowUps = 0;
	private resultQueued = false;
	/** True after Bases has delivered this view's query. A hold is not that delivery. */
	protected glanceDataSeen = false;
	/** Cold first paint came from vault frontmatter, so a refresh can re-read it. */
	private glanceFromCache = false;
	private sortPaintStampSeen = '';

	protected constructor(
		controller: QueryController,
		parentEl: HTMLElement,
		protected plugin: RVLocatorPlugin,
		protected mode: 'vanilla' | 'glancable',
		protected scope: NearbyScope,
	) {
		super(controller);
		this.localSort = { ...plugin.nearbySort };
		this.root = parentEl.createDiv(`rv-locator-view rv-locator-${mode}`);
		const win = this.root.win ?? window;
		this.position = new LivePosition(win, (state) => {
			this.geoState = state;
			this.plugin.noteLiveFix(state.fix);
			this.onGeoChanged();
		});
		this.syncPositionSource();
		this.register(() => this.stopLiveUpdates());
		this.unsubSettings = this.plugin.subscribeViewRefresh(() => {
			if (!this.root?.isConnected) return;
			this.localSort = { ...this.plugin.nearbySort };
			this.syncPositionSource();
			if (this.data) this.onDataUpdated();
			else if (this.mode === 'glancable' && !this.glanceDataSeen && this.totalRows() === 0) return;
			else this.renderBody();
		});
		this.register(() => this.unsubSettings?.());
		const deferOpenBookkeeping = (): void => {
			if (!this.root?.isConnected) return;
			this.plugin.nudgeIncompleteSetup();
			if (this.mode === 'glancable') this.plugin.resetHubFilters();
		};
		if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(deferOpenBookkeeping);
		else deferOpenBookkeeping();
		if (this.mode === 'glancable') {
			const stopSort = this.plugin.registerHubSortOpener?.(() => {
				const root = this.root;
				if (!root?.isConnected || root.ownerDocument == null) return false;
				if (typeof root.closest === 'function' && root.closest('.rv-hub-swap-cover')) return false;
				if (!this.chromeReady) this.ensureChrome();
				if (!this.sortEl?.isConnected) return false;
				this.sortMenuOpen = true;
				this.sortPaintStampSeen = '';
				this.paintSortPresets();
				return true;
			});
			if (stopSort) this.register(stopSort);
		}
	}

	override onunload(): void {
		this.releaseSortSize();
		this.stopLiveUpdates();
	}

	onDataUpdated(): void {
		this.glanceDataSeen = true;
		this.rebuildModel();
		this.renderChrome();
	}

	protected abstract paint(): void;

	protected renderBody(): void {
		if (!this.chromeReady) this.ensureChrome();
		this.paintSortPresets();
		this.fillScroll();
		this.syncResultCount();
		this.armResultFollowUps();
		this.afterRender();
	}

	/**
	 * Replace the list. Glancable overrides this so an unchanged card stays
	 * the same node and the scroll offset is left alone.
	 */
	protected fillScroll(): void {
		const top = this.scrollEl.scrollTop;
		const left = this.scrollEl.scrollLeft;
		const live = this.scrollEl;
		const doc = live.ownerDocument;
		const canStage = doc != null && typeof doc.createElement === 'function' && typeof live.replaceChildren === 'function';
		if (!canStage) {
			this.fillScrollInPlace();
			return;
		}
		const bucket = doc.createElement('div');
		this.distanceEls.clear();
		this.distanceRows.clear();
		const saved = this.scrollEl;
		this.scrollEl = bucket;
		try {
			this.paintScrollContents();
		} finally {
			this.scrollEl = saved;
		}
		const nodes = Array.from(bucket.childNodes);
		const kept = nodes.length === 0 && this.mode === 'glancable' && !this.glanceDataSeen && live.querySelector('.rv-locator-card') != null;
		if (!kept) live.replaceChildren(...nodes);
		if (live.scrollTop !== top) live.scrollTop = top;
		if (live.scrollLeft !== left) live.scrollLeft = left;
		this.afterListSwap();
	}

	/** A test double with no document. Production always stages into a real element. */
	private fillScrollInPlace(): void {
		const top = this.scrollEl.scrollTop;
		const left = this.scrollEl.scrollLeft;
		this.scrollEl.empty();
		this.distanceEls.clear();
		this.distanceRows.clear();
		this.paintScrollContents();
		if (this.scrollEl.scrollTop !== top) this.scrollEl.scrollTop = top;
		if (this.scrollEl.scrollLeft !== left) this.scrollEl.scrollLeft = left;
		this.afterListSwap();
	}

	private paintScrollContents(): void {
		if (this.totalRows() === 0) {
			if (!(this.mode === 'glancable' && !this.glanceDataSeen)) {
				this.scrollEl.createDiv({
					cls: 'rv-locator-empty',
					text: 'No notes match this view.',
				});
				this.root.removeClass('is-glance-pending');
			}
		} else {
			this.paint();
			this.root.removeClass('is-glance-pending');
		}
		this.paintListTail();
	}

	/** Glancable snaps cards and rings after the new list is in the live scroller. */
	protected afterListSwap(): void {}

	/** Glancable retags the Bases toolbar after each paint. */
	protected afterRender(): void {}

	/** Sort bar and scroller, once, before the first cards. */
	protected openChrome(): void {
		if (!this.chromeReady) this.ensureChrome();
		this.paintSortPresets();
	}

	/** The file whose list this view may replay. Empty in tests that share one slot. */
	protected glanceMemoryKey(): string {
		return '';
	}

	/**
	 * This view's own cached rows. A keyed base does not borrow the hub's list.
	 * The caller paints. This does not build cards.
	 */
	protected loadCachedModel(key = this.glanceMemoryKey()): boolean {
		const held = heldGlanceGroups(key);
		if (held) {
			this.glanceFromCache = false;
			this.groups = held;
			this.columns = heldGlanceColumns(key) ?? hubCacheColumns(this.plugin.settings.locationProperty);
			return true;
		}
		if (key.toLowerCase().endsWith('.base')) return false;
		const cached = this.readHubCache();
		if (!cached) return false;
		this.columns = cached.columns;
		this.groups = cached.groups;
		this.glanceFromCache = true;
		this.groups = this.rankedGroups();
		return true;
	}

	/**
	 * Paint cards before the first browser frame. A warm hub replays its own
	 * last list. A cold hub paints the vault cache. Bases reconciles later.
	 */
	protected adoptHeldGlance(): void {
		if (this.mode !== 'glancable') return;
		if (this.loadCachedModel(this.glanceMemoryKey())) {
			this.renderBody();
			return;
		}
		if (!this.glanceDataSeen) this.root.addClass('is-glance-pending');
	}

	/** A hidden embed was shown. Bases data wins once it has arrived; otherwise the cache. */
	protected resumeAfterShow(): void {
		if (this.glanceDataSeen || this.chromeReady) this.renderBody();
		else this.adoptHeldGlance();
	}

	/** Re-read vault frontmatter until Bases has delivered this view. */
	protected refreshHubCacheGroups(): void {
		if (!this.glanceFromCache || this.glanceDataSeen) return;
		const cached = this.readHubCache();
		if (!cached) return;
		this.columns = cached.columns;
		this.groups = cached.groups;
	}

	private readHubCache(): { columns: ColumnModel[]; groups: GroupModel[] } | null {
		const read = this.plugin.hubCacheModel;
		if (typeof read !== 'function') return null;
		const cached = read.call(this.plugin);
		if (!cached || cached.groups.every((group) => group.rows.length === 0)) return null;
		return cached;
	}

	/** Last thing in the scrolling list. Glancable puts the disclaimer here. */
	protected paintListTail(): void {}

	/** Glancable opens the search field in place of the pills. */
	protected openGlanceSearch(): void {}

	/**
	 * Full list in the persisted sort, including B53 snooze order. Search and
	 * the snooze filter are applied later. The vault-cache open uses this so
	 * the cover and the live hub paint the same order.
	 */
	protected rankedGroups(): GroupModel[] {
		const sorts = this.effectiveSorts();
		const fix = this.positionFix();
		const now = new Date();
		if (this.plugin.settings.homeLikelihoodEnabled) {
			const paths = this.groups.flatMap((group) => group.rows.map((row) => row.path));
			this.plugin.prefetchAttemptBuckets(paths);
		}
		return this.groups.map((group) => ({
			label: group.label,
			rows: sortRowsBy(
				group.rows.map((row) => this.withScores(row, now)),
				sorts,
				fix,
				DISTANCE_COLUMN_ID,
			),
		}));
	}

	protected sortedGroups(): GroupModel[] {
		return this.rankedGroups();
	}

	private withScores(row: RowModel, now: Date): RowModel {
		const meters = this.metersFor(row);
		const miles = meters == null ? null : milesFromMeters(meters);
		const buckets = this.plugin.settings.homeLikelihoodEnabled
			? this.plugin.cachedAttemptBuckets(row.path)
			: null;
		return annotateRowScores(row, miles, this.plugin.settings, buckets, now, this.plugin.snoozeUntilFor(row.path));
	}

	/** Last-used sort, persisted on the plugin. Nearest re-sorts in this view as the fix moves. */
	protected effectiveSorts(): ActiveSort[] {
		const sort = this.localSort ?? { property: DISTANCE_COLUMN_ID, direction: 'ASC' };
		return [{ property: this.resolveSortProperty(sort.property), direction: sort.direction }];
	}

	protected distanceLabel(row: RowModel): string {
		const meters = this.metersFor(row);
		if (meters == null) return '—';
		return formatDistance(meters, this.plugin.settings.distanceUnit);
	}

	protected cycleColumn(property: string): void {
		const next = cycleSort(this.localSort, property);
		this.plugin.setNearbySort(next ?? { property: DISTANCE_COLUMN_ID, direction: 'ASC' });
	}

	protected baseSortDirection(property: string): 'ASC' | 'DESC' | null {
		const sort = this.effectiveSorts()[0];
		if (!sort) return null;
		return sort.property === property ? sort.direction : null;
	}

	protected renderCell(parent: HTMLElement, cell: CellModel, path: string): void {
		if (cell.kind === 'empty') {
			parent.createSpan({ cls: 'rv-locator-empty-value', text: cell.text });
			return;
		}
		if (cell.kind === 'file') {
			const link = parent.createEl('a', {
				cls: 'rv-locator-file-link',
				text: cell.text,
				href: path,
				title: cell.title,
			});
			this.bindFileLink(link, path);
			return;
		}
		if (cell.kind === 'url') {
			const link = parent.createEl('a', {
				cls: 'rv-locator-icon-link',
				href: cell.text,
				title: cell.title,
				attr: {
					rel: 'noopener',
					target: '_blank',
					'aria-label': 'Open link',
				},
			});
			setIcon(link, 'external-link');
			return;
		}
		if (cell.dow) {
			this.renderDriveDate(parent, cell);
			return;
		}
		parent.createSpan({ cls: 'rv-locator-text', text: cell.text, title: cell.title });
	}

	protected renderDriveDate(parent: HTMLElement, cell: CellModel): void {
		const wrap = parent.createSpan({ cls: 'rv-locator-date', title: cell.title });
		const clock = wrap.createSpan('rv-locator-clock');
		clock.createSpan({ cls: 'rv-locator-dow', text: cell.dow ?? '' });
		if (cell.time) clock.createSpan({ cls: 'rv-locator-time', text: `, ${cell.time}` });
		if (cell.rest) wrap.createSpan({ cls: 'rv-locator-cal', text: cell.rest });
		if (cell.daysSince != null) {
			const days = cell.daysSince;
			parent.createSpan({
				cls: 'rv-locator-days',
				text: formatGlanceableCounter(days),
				attr: { title: formatGlanceableCounter(days) },
			});
		}
	}

	/** Device GPS, or the settings test point while desktop distance testing is on. */
	protected positionFix(): LatLon | null {
		const settings = this.plugin.settings;
		if (settings.distanceTest) return validLatLon(settings.testLatitude, settings.testLongitude);
		return this.geoState.fix;
	}

	protected bindFileLink(link: HTMLElement, path: string): void {
		const open = (evt: MouseEvent) => {
			if (evt.button !== 0 && evt.button !== 1) return;
			evt.preventDefault();
			const modified = Keymap.isModEvent(evt) || evt.button === 1;
			if (!modified && this.plugin.hubMapOpen) {
				this.plugin.keepMapWithNote(path);
				return;
			}
			void this.app.workspace.openLinkText(path, '', modified);
		};
		link.addEventListener('click', open);
		link.addEventListener('auxclick', open);
		link.addEventListener('mouseover', (evt) => {
			this.app.workspace.trigger('hover-link', {
				event: evt,
				source: HOVER_SOURCE,
				hoverParent: this,
				targetEl: link,
				linktext: path,
			});
		});
	}

	protected rememberDistance(key: string, el: HTMLElement, row: RowModel): void {
		this.distanceEls.set(key, el);
		this.distanceRows.set(key, row);
	}

	private rebuildModel(): void {
		if (!this.data) {
			this.columns = [];
			this.groups = [];
			return;
		}
		try {
			this.applyModel();
		} catch (error) {
			console.error('RV Locator: could not build the nearby view.', error);
			this.columns = [];
			this.groups = [];
		}
	}

	private applyModel(): void {
		if (!this.data) return;
		const model = buildViewModel({
			result: this.data,
			order: this.readOrder(),
			allProperties: this.allProperties ?? [],
			displayName: (id) => this.config.getDisplayName(id),
			settings: this.plugin.settings,
			mode: this.mode,
			scope: this.scope,
			returnScope: this.mode === 'glancable' ? this.plugin.settings.returnScope : undefined,
			genderFilter: this.mode === 'glancable' ? this.plugin.settings.genderFilter : undefined,
			campaignListFilter: this.mode === 'glancable' ? this.plugin.settings.campaignListFilter : undefined,
			campaignMark: (path) => this.plugin.campaignMark(path),
			noteValue: (file, name) => readProperty(this.plugin.noteFrontmatter(file.path), name),
		});
		this.columns = model.columns;
		this.groups = model.groups;
	}

	private renderChrome(): void {
		this.ensureChrome();
		this.renderBanner();
		this.renderBody();
	}

	private ensureChrome(): void {
		if (this.chromeReady) return;
		this.chromeReady = true;
		this.bannerEl = this.root.createDiv('rv-locator-banner');
		const icon = this.bannerEl.createSpan('rv-locator-banner-icon');
		setIcon(icon, 'locate');
		this.bannerText = this.bannerEl.createSpan('rv-locator-banner-text');
		this.bannerEl.hide();
		this.sortEl = this.root.createDiv('rv-locator-sortbar');
		this.scrollEl = this.root.createDiv('rv-locator-scroll');
		if (this.mode !== 'glancable') {
			const attr = this.root.createDiv('rv-locator-attr');
			attr.createSpan({ cls: 'rv-locator-disclaimer', text: NON_AFFILIATION_NOTICE });
			attr.createSpan({ cls: 'rv-locator-attr-credits', text: `${OSM_ATTRIBUTION} · ${GEOAPIFY_ATTRIBUTION}` });
		}
		this.afterChrome();
	}

	/** Phone hub inserts the map stack once the scroll column exists. */
	protected afterChrome(): void {}

	private renderBanner(): void {
		if (!this.chromeReady) return;
		const message = this.bannerMessage();
		if (!message) {
			this.bannerEl.hide();
			this.bannerEl.removeClass('is-test');
			return;
		}
		if (message.test || message.error) {
			this.bannerEl.hide();
			this.plugin.notifyLocationOnce(message.text);
			return;
		}
		this.bannerText.setText(message.text);
		this.bannerEl.toggleClass('is-quiet', this.quietBanner && !message.test);
		this.bannerEl.toggleClass('is-test', message.test);
		this.bannerEl.toggleClass('is-error', message.error && !message.test);
		this.bannerEl.show();
	}

	private bannerMessage(): { text: string; error: boolean; test: boolean } | null {
		if (this.plugin.settings.distanceTest) {
			const lat = this.plugin.settings.testLatitude;
			const lon = this.plugin.settings.testLongitude;
			return {
				text: `Desktop distance testing is on, using ${lat}, ${lon} instead of this device. Distance is not written into notes.`,
				error: false,
				test: true,
			};
		}
		if (this.geoState.status === 'ready') return null;
		if (this.quietBanner && this.geoState.status === 'pending') return null;
		if (this.geoState.status === 'denied') {
			return {
				text: this.quietBanner
					? 'Location access is denied, so distance shows a dash.'
					: 'Location access is denied. Allow location for Obsidian to show distance. Distance is not written into notes.',
				error: true,
				test: false,
			};
		}
		if (this.geoState.status === 'unsupported' || this.geoState.status === 'unavailable') {
			if (this.quietBanner) {
				const where = Platform.isMobile || Platform.isMobileApp
					? 'No position yet. Distance shows a dash.'
					: 'No position on this desktop. Distance shows a dash.';
				return { text: where, error: false, test: false };
			}
			const where = Platform.isMobile || Platform.isMobileApp
				? 'This device has no position, so distance shows a dash.'
				: 'This desktop has no position, so distance shows a dash. Obsidian Mobile can use GPS.';
			return {
				text: `${where} Distance is not written into notes.`,
				error: true,
				test: false,
			};
		}
		return {
			text: 'Looking for your position. Distance stays in this view and is not written into notes.',
			error: false,
			test: false,
		};
	}

	private onGeoChanged(): void {
		this.renderBanner();
		if (!this.chromeReady) return;
		const sortedBy = this.effectiveSorts()[0]?.property;
		if (sortedBy === DISTANCE_COLUMN_ID || sortedBy === IDEALITY_COLUMN_ID) {
			const win = this.root.win ?? window;
			if (this.geoTimer != null) return;
			this.geoTimer = win.setTimeout(() => {
				this.geoTimer = null;
				this.renderBody();
			}, 400);
			return;
		}
		this.patchDistances();
	}

	private patchDistances(): void {
		for (const [key, el] of this.distanceEls) {
			const row = this.distanceRows.get(key);
			if (el.hasClass('rv-locator-distance-lg')) {
				const distance = row ? this.distanceLabel(row) : '—';
				const live = distance !== '—';
				el.setText(live ? `· ${distance}` : '· —');
				el.toggleClass('is-live', live);
				el.toggleClass('is-missing', !live);
				el.setAttr('aria-label', live ? `Distance ${distance}` : 'Distance unavailable');
				armHoverTooltip(el, live ? distance : 'No position', { touch: false });
				continue;
			}
			el.setText(row ? this.distanceLabel(row) : '—');
		}
	}

	private metersFor(row: RowModel): number | null {
		const fix = this.positionFix();
		if (!fix || row.lat == null || row.lon == null) return null;
		return haversineMeters(fix, { lat: row.lat, lon: row.lon });
	}

	protected totalRows(): number {
		return this.sortedGroups().reduce((sum, group) => sum + group.rows.length, 0);
	}

	private readOrder(): BasesPropertyId[] {
		try {
			return this.config.getOrder() ?? [];
		} catch {
			return [];
		}
	}

	private resolveSortProperty(property: string): string {
		const folded = property.trim().toLowerCase();
		const column = this.columns.find((item) => item.id.toLowerCase() === folded);
		return column?.id ?? property;
	}

	private sortPaintStamp(): string {
		const settings = this.plugin.settings;
		const chips = visibleSortPresets(settings.sortChips).map((preset) => preset.id).join(',');
		return [
			this.localSort.property,
			this.localSort.direction,
			this.sortMenuOpen ? '1' : '0',
			this.mode,
			chips,
			this.plugin.hubMapOpen ? '1' : '0',
			settings.returnScope,
			settings.genderFilter,
			settings.campaignListFilter,
			settings.snoozeListFilter,
		].join('|');
	}

	private paintSortPresets(): void {
		if (!this.sortEl?.isConnected) return;
		const stamp = this.sortPaintStamp();
		const sortRow = this.root.ownerDocument?.querySelector('.rv-bar-shell > .rv-bar-sort');
		if (stamp === this.sortPaintStampSeen && this.sortEl.querySelector('.rv-locator-sort-scroll, .rv-app-bar, .rv-bar-spacer')) {
			if (!this.sortMenuOpen || sortRow) return;
		}
		this.sortPaintStampSeen = stamp;
		this.releaseSortSize();
		const savedScroll = this.sortButtonsEl?.scrollLeft ?? 0;
		const search = this.searchSlot;
		const searchHosted = search?.closest('.rv-bar-shell') instanceof HTMLElement;
		const glancable = this.mode === 'glancable';
		refillKeepingFocus(this.sortEl, searchHosted ? null : search, () => {
		if (glancable) {
			this.paintGlancableTabs();
			if (search && !searchHosted && search.parentElement !== this.sortEl) this.sortEl.appendChild(search);
			return;
		}
		this.sortButtonsEl = this.sortEl.createDiv('rv-locator-sort-scroll');
		const pillHost = this.sortButtonsEl;
		const current = this.localSort;
		for (const preset of visibleSortPresets(this.plugin.settings.sortChips)) {
			const active = current.property.toLowerCase() === preset.property.toLowerCase();
			const label = sortPresetChipLabel(preset, active ? current.direction : null);
			const button = pillHost.createEl('button', {
				cls: `rv-locator-sort-preset${active ? ' is-active' : ''}`,
				attr: {
					type: 'button',
					'aria-pressed': active ? 'true' : 'false',
					'aria-label': label,
				},
			});
			const marks = button;
			const icon = marks.createSpan('rv-sort-icon');
			setIcon(icon, sortPresetIcon(preset.id));
			if (active) {
				button.addClass(current.direction === 'ASC' ? 'is-asc' : 'is-desc');
				const arrow = marks.createSpan('rv-sort-arrow');
				arrow.setAttr('aria-hidden', 'true');
				setIcon(arrow, sortDirectionArrow(current.direction));
			}
			button.createSpan({ cls: 'rv-sort-label', text: sortPresetShortLabel(preset) });
			button.addEventListener('click', () => {
				this.plugin.setNearbySort(nextPresetSort(this.localSort, preset));
			});
		}
		this.paintSortExtras();
		equalizeSortPills(pillHost);
		if (search && search.parentElement !== this.sortEl) this.sortEl.appendChild(search);
		});
		if (this.sortButtonsEl) this.sortButtonsEl.scrollLeft = savedScroll;
		if (glancable && this.sortMenuOpen) {
			this.bindSortWheel(this.sortButtonsEl);
			this.watchSortPillSize();
		}
	}

	/** A vertical wheel scrolls the pill track. The track is only wider than the pane. */
	private bindSortWheel(track: HTMLElement): void {
		track.addEventListener('wheel', (event) => {
			if (track.scrollWidth <= track.clientWidth) return;
			const delta = horizontalScrollDelta(event.deltaX, event.deltaY, event.shiftKey);
			if (!delta) return;
			event.preventDefault();
			track.scrollLeft += delta;
		}, { passive: false });
	}

	private watchSortPillSize(): void {
		const pills = this.sortButtonsEl.querySelector('.rv-locator-sort-pills');
		if (!(pills instanceof HTMLElement)) return;
		const apply = (): void => { applyControlSizedPills(this.sortEl, pills); };
		apply();
		if (typeof ResizeObserver !== 'function') return;
		this.sortSizeObserver = new ResizeObserver(() => apply());
		this.sortSizeObserver.observe(this.sortEl);
	}

	private releaseSortSize(): void {
		this.sortSizeObserver?.disconnect();
		this.sortSizeObserver = null;
	}

	protected paintSortExtras(): void {
		// Ideality planner was removed in 1.2.6. It may return later.
	}

	/** The shared bar stays outside this view. Sort options fill its one row. */
	private paintGlancableTabs(): void {
		if (!this.sortEl?.isConnected || this.sortEl.ownerDocument == null) return;
		// The cover stops above the real bar. A spacer here is a second empty band.
		if (typeof this.root.closest === 'function' && this.root.closest('.rv-hub-swap-cover')) {
			this.sortEl.querySelector(':scope > .rv-bar-spacer')?.remove();
			return;
		}
		ensureBarSpacer(this.sortEl);
		if (!this.sortMenuOpen) {
			const file = this.plugin.app.workspace.getActiveFile?.();
			if (file) this.plugin.syncAppBarFromActive();
			else if (this.plugin.barIsHeld()) this.plugin.followAppBar();
			else this.plugin.syncAppBar('hub', '');
		} else {
			this.plugin.followAppBar();
		}
		const surface = this.plugin.barSurface();
		if (this.sortMenuOpen && surface === 'hub') {
			const bar = this.plugin.sortBarHost();
			bar.replaceChildren();
			this.sortButtonsEl = bar;
			this.barSlot(bar, 'Close', 'x', false, () => {
				this.sortMenuOpen = false;
				this.paintSortPresets();
			});
			const order = ['urgency', 'distance', 'attempted', 'spoke', 'priority', 'met', 'city', 'ideality'];
			const presets = visibleSortPresets(this.plugin.settings.sortChips)
				.slice()
				.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
			const current = this.localSort;
			for (const preset of presets) {
				const active = current.property.toLowerCase() === preset.property.toLowerCase();
				this.barSlot(bar, sortPresetShortLabel(preset), sortPresetIcon(preset.id), active, () => {
					this.plugin.setNearbySort(nextPresetSort(this.localSort, preset));
					this.paintSortPresets();
				});
			}
			bar.createDiv('rv-app-divider');
			const settings = this.plugin.settings;
			const campaignLabel: Record<CampaignListFilter, string> = { all: 'All', uncovered: 'Uncovered', covered: 'Covered' };
			this.barSlot(bar, SNOOZE_FILTER_LABEL[settings.snoozeListFilter], 'moon', settings.snoozeListFilter !== 'all', (event) => {
				this.cycleFilter(event, () => { void this.plugin.setSnoozeListFilter(nextSnoozeListFilter(this.plugin.settings.snoozeListFilter)); });
			}, settings.snoozeListFilter !== 'all', 'is-filter');
			this.barSlot(bar, RETURN_SCOPE_LABEL[settings.returnScope], 'layers', settings.returnScope !== 'active', (event) => {
				this.cycleFilter(event, () => { void this.plugin.setReturnScope(nextReturnScope(this.plugin.settings.returnScope)); });
			}, settings.returnScope !== 'active', 'is-filter');
			this.barSlot(bar, GENDER_FILTER_LABEL[settings.genderFilter], 'user', settings.genderFilter !== 'all', (event) => {
				this.cycleFilter(event, () => { void this.plugin.setGenderFilter(nextGenderFilter(this.plugin.settings.genderFilter)); });
			}, settings.genderFilter !== 'all', 'is-filter');
			this.barSlot(bar, campaignLabel[settings.campaignListFilter], 'flag', settings.campaignListFilter !== 'all', (event) => {
				this.cycleFilter(event, () => { void this.plugin.setCampaignListFilter(nextCampaignListFilter(this.plugin.settings.campaignListFilter)); });
			}, settings.campaignListFilter !== 'all', 'is-filter');
			return;
		}
		if (this.sortMenuOpen && surface !== 'hub') this.sortMenuOpen = false;
		this.plugin.closeBarSort();
	}

	private barSlot(
		bar: HTMLElement,
		label: string,
		icon: string,
		on: boolean,
		action: (event: MouseEvent) => void,
		dot = false,
		extra = '',
	): void {
		const button = appendAppSlot(bar, label, icon, { on, dot, extra });
		button.addEventListener('click', (event) => {
			event.preventDefault();
			action(event);
		});
	}

	/** One tap moves to the next saved value. The choice menu stays closed. */
	private cycleFilter(event: MouseEvent, apply: () => void): void {
		const slot = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
		if (slot && typeof slot.scrollIntoView === 'function') {
			try { slot.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* The slot is already on screen. */ }
		}
		dismissOpenMenus(event.view?.document ?? this.root.ownerDocument);
		apply();
		this.paintSortPresets();
		keepMenuOnScreen(slot);
	}

	private syncPositionSource(): void {
		if (this.plugin.settings.distanceTest) {
			this.position.stop();
			return;
		}
		this.position.start();
	}

	/**
	 * Bases counts `this.data` before Active, All, or Inactive drops rows, and
	 * the public view API cannot change that total.
	 *
	 * The visible "N results" control is a toolbar item beside the layout name.
	 * The view container (`.bases-view`) is the pane under that toolbar, so a
	 * search that starts there never sees the label. The label is also not a
	 * `.text-button-label`. Find it by its text in the toolbar above this view,
	 * then write it again whenever Bases repaints that toolbar.
	 */
	private syncResultCount(): void {
		this.paintResultCount();
		this.ensureResultsWatch();
	}

	private paintResultCount(): void {
		const count = this.totalRows();
		const text = count === 1 ? '1 result' : `${count} results`;
		const labels = this.findResultLabels();
		if (labels.length === 0) return;
		this.writingResultCount = true;
		try {
			for (const label of labels) writeResultLabel(label, text);
		} finally {
			this.writingResultCount = false;
		}
	}

	private findResultLabels(): HTMLElement[] {
		const host = this.resultsHost();
		if (!host) return [];
		const toolbar = toolbarForHost(host);
		if (toolbar) {
			const labels = deepestResultLabels(toolbar, this.root);
			if (labels.length > 0) return labels;
		}
		return deepestResultLabels(host, this.root);
	}

	/**
	 * The factory container is the pane below the toolbar. Climb to the embed
	 * or leaf that owns both, and do not stop on `.bases-view`.
	 */
	private resultsHost(): HTMLElement | null {
		return this.root.closest('.bases-embed, .block-language-base, .view-content')
			?? this.root.parentElement?.parentElement
			?? this.root.parentElement;
	}

	private ensureResultsWatch(): void {
		const host = this.resultsHost();
		if (!host) return;
		if (this.resultsObserver && this.resultsWatchEl === host && host.isConnected) return;
		this.resultsObserver?.disconnect();
		this.resultsWatchEl = host;
		this.resultsObserver = new MutationObserver((mutations) => {
			if (this.writingResultCount) return;
			if (!mutations.some((record) => !this.root.contains(record.target))) return;
			this.queueResultPaint();
		});
		this.resultsObserver.observe(host, {
			subtree: true,
			childList: true,
			characterData: true,
		});
		if (!this.resultsWatchRegistered) {
			this.resultsWatchRegistered = true;
			this.register(() => this.releaseResultsWatch());
		}
	}

	/** Coalesce a toolbar rewrite into one pass after Bases finishes the frame. */
	private queueResultPaint(): void {
		if (this.resultQueued) return;
		this.resultQueued = true;
		const win = this.root.win ?? window;
		win.requestAnimationFrame(() => {
			this.resultQueued = false;
			if (!this.root.isConnected) return;
			this.paintResultCount();
			this.afterRender();
		});
	}

	/** Bases often sets the unfiltered total after `onDataUpdated` returns. */
	private armResultFollowUps(): void {
		this.resultFollowUps = 0;
		this.scheduleResultFollowUp();
	}

	private scheduleResultFollowUp(): void {
		if (this.resultFollowUps >= RESULT_FOLLOW_UP_DELAYS.length) return;
		const win = this.root.win ?? window;
		if (this.resultRetry != null) win.clearTimeout(this.resultRetry);
		const delay = RESULT_FOLLOW_UP_DELAYS[this.resultFollowUps] ?? 0;
		this.resultFollowUps += 1;
		this.resultRetry = win.setTimeout(() => {
			this.resultRetry = null;
			if (!this.root.isConnected) return;
			this.syncResultCount();
			this.scheduleResultFollowUp();
		}, delay);
	}

	private releaseResultsWatch(): void {
		this.resultsObserver?.disconnect();
		this.resultsObserver = null;
		this.resultsWatchEl = null;
		this.resultQueued = false;
		if (this.resultRetry != null) {
			const win = this.root.win ?? window;
			win.clearTimeout(this.resultRetry);
			this.resultRetry = null;
		}
	}

	private stopLiveUpdates(): void {
		this.position.stop();
		if (this.geoTimer != null) {
			const win = this.root.win ?? window;
			win.clearTimeout(this.geoTimer);
			this.geoTimer = null;
		}
	}

	protected headerButton(parent: HTMLElement, column: ColumnModel, sample: RowModel | undefined): void {
		const direction = this.baseSortDirection(column.id);
		const active = this.localSort?.property === column.id;
		const button = parent.createEl('button', {
			cls: `rv-locator-th-btn${active || direction ? ' is-active' : ''}`,
			title: `Sort by ${column.displayName}`,
			attr: { type: 'button' },
		});
		const icon = button.createSpan('rv-locator-th-icon');
		setIcon(icon, iconForColumn(column, sample?.sortKeys[column.id]));
		button.createSpan({ cls: 'rv-locator-th-label', text: column.displayName });
		const sortIcon = button.createSpan('rv-locator-th-sort');
		setIcon(sortIcon, direction === 'ASC' ? 'arrow-up' : 'arrow-down');
		if (!direction) sortIcon.addClass('is-idle');
		button.addEventListener('click', () => this.cycleColumn(column.id));
		const aria = direction === 'ASC' ? 'ascending' : direction === 'DESC' ? 'descending' : 'none';
		parent.setAttr('aria-sort', aria);
	}
}

const RESULT_COUNT_TEXT = /^\d+ results?$/i;
const RESULT_FOLLOW_UP_DELAYS = [0, 60, 180, 500];

function normalizeResultText(raw: string): string {
	return raw.replace(/\s+/g, ' ').trim();
}

function isResultCountText(raw: string): boolean {
	return RESULT_COUNT_TEXT.test(normalizeResultText(raw));
}

function toolbarForHost(host: HTMLElement): HTMLElement | null {
	let found: HTMLElement | null = null;
	host.querySelectorAll('.bases-toolbar').forEach((toolbar) => {
		if (found) return;
		if (!domInstanceOf(toolbar, HTMLElement)) return;
		if (toolbar.closest('.bases-embed, .block-language-base, .view-content') !== host) return;
		found = toolbar;
	});
	return found;
}

function deepestResultLabels(scope: HTMLElement, viewRoot: HTMLElement): HTMLElement[] {
	const matches: HTMLElement[] = [];
	scope.querySelectorAll('*').forEach((node) => {
		if (!domInstanceOf(node, HTMLElement)) return;
		if (viewRoot.contains(node)) return;
		if (!isResultCountText(node.textContent ?? '')) return;
		matches.push(node);
	});
	return matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
}

function writeResultLabel(el: HTMLElement, text: string): void {
	const current = normalizeResultText(el.textContent ?? '');
	if (!isResultCountText(current)) return;
	if (current !== text) writeResultText(el, text);
	let node: HTMLElement | null = el;
	for (let depth = 0; depth < 4 && node; depth += 1) {
		syncResultAttribute(node, 'aria-label', text);
		syncResultAttribute(node, 'title', text);
		node = node.parentElement;
	}
}

function syncResultAttribute(el: HTMLElement, name: string, text: string): void {
	const value = el.getAttribute(name);
	if (!value || !isResultCountText(value) || normalizeResultText(value) === text) return;
	el.setAttribute(name, text);
}

/** Update the count in place so an icon inside the same control stays put. */
function writeResultText(el: HTMLElement, text: string): void {
	const count = text.split(' ')[0] ?? text;
	const word = text.slice(count.length).trim();
	const texts: Text[] = [];
	const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let current = walker.nextNode();
	while (current) {
		if (domInstanceOf(current, Text)) texts.push(current);
		current = walker.nextNode();
	}
	const numeric = texts.find((node) => /^\s*\d+\s*$/.test(node.textContent ?? ''));
	const label = texts.find((node) => /^\s*results?\s*$/i.test(node.textContent ?? ''));
	const whole = texts.find((node) => isResultCountText(node.textContent ?? ''));
	if (numeric) {
		numeric.textContent = replaceToken(numeric.textContent ?? '', numeric.textContent?.trim() ?? '', count);
		if (label) {
			const token = label.textContent?.trim() ?? '';
			label.textContent = replaceToken(label.textContent ?? '', token, word);
		}
		return;
	}
	if (whole) {
		whole.textContent = text;
		return;
	}
	if (el.childElementCount === 0) el.textContent = text;
}

function replaceToken(raw: string, token: string, next: string): string {
	if (!token) return next;
	const index = raw.indexOf(token);
	if (index < 0) return next;
	return raw.slice(0, index) + next + raw.slice(index + token.length);
}

function sortPresetIcon(id: string): string {
	const icons: Record<string, string> = {
		ideality: 'sparkles',
		urgency: 'siren',
		distance: 'ruler',
		priority: 'gauge',
		spoke: 'message-circle',
		attempted: 'clock',
		met: 'door-open',
		city: 'building-2',
	};
	return icons[id] ?? 'arrow-up-down';
}
