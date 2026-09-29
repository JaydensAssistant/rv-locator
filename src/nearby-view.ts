import { BasesView, HoverPopover, Keymap, Platform, setIcon, type HoverParent, type QueryController } from 'obsidian';
import { nextPresetSort, sortPresetChipLabel, visibleSortPresets, type NearbyScope } from './active-layout';
import { DISTANCE_COLUMN_ID, GEOAPIFY_ATTRIBUTION, HOVER_SOURCE, IDEALITY_COLUMN_ID, OSM_ATTRIBUTION } from './constants';
import { formatDistance, haversineMeters, milesFromMeters, validLatLon } from './distance';
import { LivePosition, type GeoState } from './live-position';
import { readProperty } from './frontmatter';
import { buildViewModel, iconForColumn, type CellModel, type ColumnModel, type GroupModel, type RowModel } from './model';
import type RVLocatorPlugin from './main';
import { annotateRowScores } from './row-score';
import { cycleSort, sortRowsBy, type ActiveSort } from './sort';
import type { BasesPropertyId } from 'obsidian';
import type { LatLon } from './types';

export abstract class NearbyBasesView extends BasesView implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	protected root: HTMLElement;
	protected bannerEl!: HTMLElement;
	protected bannerText!: HTMLElement;
	protected scrollEl!: HTMLElement;
	protected sortEl!: HTMLElement;
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
			this.onGeoChanged();
		});
		this.syncPositionSource();
		this.register(() => this.stopLiveUpdates());
		this.unsubSettings = this.plugin.subscribeViewRefresh(() => {
			this.localSort = { ...this.plugin.nearbySort };
			this.syncPositionSource();
			if (this.data) this.onDataUpdated();
			else this.renderBody();
		});
		this.register(() => this.unsubSettings?.());
		this.plugin.nudgeIncompleteSetup();
	}

	override onunload(): void {
		this.stopLiveUpdates();
	}

	onDataUpdated(): void {
		this.rebuildModel();
		this.renderChrome();
	}

	protected abstract paint(): void;

	protected renderBody(): void {
		if (!this.chromeReady) this.ensureChrome();
		this.paintSortPresets();
		const top = this.scrollEl.scrollTop;
		const left = this.scrollEl.scrollLeft;
		this.scrollEl.empty();
		this.distanceEls.clear();
		this.distanceRows.clear();
		if (this.totalRows() === 0) {
			this.scrollEl.createDiv({
				cls: 'rv-locator-empty',
				text: 'No notes match this view.',
			});
		} else {
			this.paint();
		}
		this.scrollEl.scrollTop = top;
		this.scrollEl.scrollLeft = left;
		this.syncResultCount();
		this.armResultFollowUps();
	}

	protected sortedGroups(): GroupModel[] {
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
			const label = days === 1 ? '1 calendar day' : `${days} calendar days`;
			parent.createSpan({
				cls: 'rv-locator-days',
				text: `${days}d`,
				attr: { title: label },
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
			const newLeaf = Keymap.isModEvent(evt) || evt.button === 1;
			void this.app.workspace.openLinkText(path, '', newLeaf);
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
			noteValue: (file, name) => readProperty(this.app.metadataCache.getFileCache(file)?.frontmatter, name),
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
		const attr = this.root.createDiv('rv-locator-attr');
		attr.setText(`${OSM_ATTRIBUTION} · ${GEOAPIFY_ATTRIBUTION}`);
	}

	private renderBanner(): void {
		if (!this.chromeReady) return;
		const message = this.bannerMessage();
		if (!message) {
			this.bannerEl.hide();
			this.bannerEl.removeClass('is-test');
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
				el.setAttr('title', live ? distance : 'No position');
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

	private totalRows(): number {
		return this.groups.reduce((sum, group) => sum + group.rows.length, 0);
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

	private paintSortPresets(): void {
		this.sortEl.empty();
		const current = this.localSort;
		for (const preset of visibleSortPresets(this.plugin.settings.sortChips)) {
			const active = current.property.toLowerCase() === preset.property.toLowerCase();
			const button = this.sortEl.createEl('button', {
				cls: `rv-locator-sort-preset${active ? ' is-active' : ''}`,
				text: sortPresetChipLabel(preset, active ? current.direction : null),
				attr: {
					type: 'button',
					'aria-pressed': active ? 'true' : 'false',
				},
			});
			button.addEventListener('click', () => {
				this.plugin.setNearbySort(nextPresetSort(current, preset));
			});
		}
		this.paintSortExtras();
		const create = this.sortEl.createEl('button', {
			cls: 'rv-locator-new-rv',
			attr: {
				type: 'button',
				'aria-label': 'New RV',
				title: 'New RV',
			},
		});
		setIcon(create, 'plus');
		create.addEventListener('click', () => {
			void this.plugin.createNewRv();
		});
	}

	protected paintSortExtras(): void {
		// Ideality planner was removed in 1.2.6. It may return later.
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
		setIcon(sortIcon, direction === 'ASC' ? 'chevron-up' : 'chevron-down');
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
		if (!toolbar.instanceOf(HTMLElement)) return;
		if (toolbar.closest('.bases-embed, .block-language-base, .view-content') !== host) return;
		found = toolbar;
	});
	return found;
}

function deepestResultLabels(scope: HTMLElement, viewRoot: HTMLElement): HTMLElement[] {
	const matches: HTMLElement[] = [];
	scope.querySelectorAll('*').forEach((node) => {
		if (!node.instanceOf(HTMLElement)) return;
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
		if (current.instanceOf(Text)) texts.push(current);
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
