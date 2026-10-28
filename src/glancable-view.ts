import { Platform, setIcon, TFile, type QueryController } from 'obsidian';
import { hubUsesStackedMap, placeGlanceStage, revealHubCard, stackedEmbedCap } from './hub-layout';
import { CARD_BLANK_IGNORE, cardBlankOpensPin } from './map-pins';
import type { NearbyScope } from './active-layout';
import { GLANCABLE_VIEW_TYPE, NON_AFFILIATION_NOTICE } from './constants';
import { domInstanceOf } from './dom';
import { compactBadgePx, elementScrollbarGutterPx, fittedFontScale, glancableCardColumns, glancableCardWidthPx, type CompactLineKind } from './glancable-density';
import { CHROME_PIECES, chromeControlHint, classifyChromeControl, type ChromePiece } from './glancable-chrome';
import type { CellModel, ColumnModel, RowModel } from './model';
import type RVLocatorPlugin from './main';
import { glancableLineId } from './glancable-lines';
import { NearbyBasesView } from './nearby-view';
import { rowPriority, rowUrgency } from './row-score';
import { badgeLineOpticalKey, urgencyOpticalKey } from './badge-glyph';
import { urgencyAccentColor, urgencyBand, urgencyBangShapes, urgencyMark } from './scoring';
import { paintUrgencyInk } from './color-math';
import { urgencyColorsFor } from './urgency-palette';
import { cardPersonTitle } from './note-name';
import { cardReturnLead } from './schedule';
import { SNOOZE_SLATE, snoozeCardCaption } from './snooze';
import { calendarDaysSince, formatGlanceableCounter } from './dates';
import { readProperty } from './frontmatter';
import { glanceRecordFromNote, matchesGlanceQuery, parseGlanceQuery, type GlanceQuery } from './glance-search';
import { formatStudyFraction } from './catalog';
import { resolveStatus, sanitizeGender, statusIcon } from './status';
import { ageCaption, appendPersonMeta } from './person-meta';
import { paintGlanceFoot } from './glance-foot';
import type { GlancableChromeFlags, GlancableLineId } from './types';

export class NearbyGlancableView extends NearbyBasesView {
	readonly type: string;
	private layoutObserver: ResizeObserver | null = null;
	private chromeHost: HTMLElement | null = null;
	private glanceQuery = '';
	private searchInput: HTMLInputElement | null = null;
	private bodyCache = new Map<string, { mtime: number; body: string }>();
	private bodiesLoading = false;
	private parsedKey = '';
	private parsedQuery: GlanceQuery | null = null;
	private stageEl: HTMLElement | null = null;
	private hubMapEl: HTMLElement | null = null;
	private hubMapHandle: HTMLElement | null = null;
	private hubMapApi: { destroy(): void; applyRenderedOrder(paths: readonly string[]): void; invalidateSize(): void } | null = null;
	private renderedPaths: readonly string[] | null = null;
	private hubMapRatio = 0.42;
	private stackedLayout = false;
	private searchOpen = false;
	private hubScrollerStop: (() => void) | null = null;
	private hubFullscreenStop: (() => void) | null = null;
	private hubFillNodes: HTMLElement[] = [];

	constructor(
		controller: QueryController,
		parentEl: HTMLElement,
		plugin: RVLocatorPlugin,
		viewType: string = GLANCABLE_VIEW_TYPE,
		scope: NearbyScope = 'active',
	) {
		super(controller, parentEl, plugin, 'glancable', scope);
		this.type = viewType;
		this.quietBanner = true;
		this.register(this.plugin.registerGlancePainter((parent, path) => this.paintCardForPath(parent, path)));
		this.register(this.plugin.registerGlanceWidth(() => this.listCardWidth()));
		this.register(this.plugin.registerGlanceLayout(() => {
			this.rememberScrollbar();
			const width = this.root.clientWidth || this.root.parentElement?.clientWidth || 0;
			return width > 1 ? width : 0;
		}, this.root));
	}

	override onunload(): void {
		this.root.ownerDocument.body.classList.remove('rv-hide-backlinks');
		this.clearBasesChrome();
		super.onunload();
	}

	protected override afterRender(): void {
		this.syncBasesChrome();
		this.ensureSearchField();
		this.syncHubMapMount();
		this.snapCardFrames();
	}

	protected override afterChrome(): void {
		this.ensureStage();
		this.ensureHubScroller();
		this.syncHubMapMount();
	}

	protected override paintListTail(): void {
		const note = this.scrollEl.createDiv('rv-locator-list-disclaimer');
		note.setText(NON_AFFILIATION_NOTICE);
	}

	protected override openGlanceSearch(): void {
		this.searchReplacesBar(true);
		this.searchInput?.focus();
	}

	/** Pin taps scroll this hub on desktop and on the phone stack. */
	private ensureHubScroller(): void {
		if (this.hubScrollerStop) return;
		this.hubScrollerStop = this.plugin.registerHubScroller((path) => this.flashCard(path));
		this.register(() => {
			this.hubScrollerStop?.();
			this.hubScrollerStop = null;
		});
	}

	/**
	 * Map inside this view. A phone, or a view narrower than
	 * {@link HUB_STACK_BELOW_PX}, stacks the map under the cards.
	 * A wide view puts the map to the right. The view's own width is the
	 * measure, so a base embedded in a note uses the embed, not the window.
	 * The map stays closed until the map icon opens it.
	 */
	private syncHubMapMount(): void {
		this.ensureStage();
		this.stackedLayout = this.readStacked();
		if (this.plugin.hubMapOpen) this.ensureHubMap();
		else this.removeHubMap();
		this.syncHubMap();
	}

	/** Width of this view. An embedded base is the embed, not the window. */
	private readStacked(): boolean {
		const width = this.root.clientWidth || this.root.parentElement?.clientWidth || 0;
		const stacked = hubUsesStackedMap(
			Boolean(Platform.isMobile || Platform.isMobileApp),
			width,
			this.plugin.hubPaneNarrow,
		);
		if (width > 0) this.plugin.hubPaneNarrow = stacked;
		return stacked;
	}

	private ensureStage(): void {
		const root = this.root;
		const scroll = this.scrollEl;
		if (!root?.isConnected || !scroll) return;
		const current = this.stageEl;
		if (current?.isConnected && current.parentElement === root && scroll.parentElement === current) return;
		this.stageEl = placeGlanceStage(root, scroll, current);
	}

	private ensureHubMap(): void {
		this.ensureHubFullscreenSync();
		this.ensureStage();
		if (this.hubMapEl) return;
		const stage = this.stageEl ?? this.root;
		const handle = stage.createDiv('rv-hub-map-handle');
		handle.setAttr('role', 'separator');
		handle.setAttr('aria-orientation', 'horizontal');
		handle.setAttr('aria-label', 'Resize map');
		const map = stage.createDiv('rv-hub-map');
		stage.appendChild(handle);
		stage.appendChild(map);
		this.hubMapEl = map;
		this.hubMapHandle = handle;
		this.hubMapApi = this.plugin.mountHubMap(map);
		if (this.renderedPaths) this.hubMapApi.applyRenderedOrder(this.renderedPaths);
		this.bindHubHandle(handle);
	}

	private ensureHubFullscreenSync(): void {
		if (this.hubFullscreenStop) return;
		this.hubFullscreenStop = this.plugin.registerHubFullscreen(() => this.syncHubMap());
		this.register(() => {
			this.hubFullscreenStop?.();
			this.hubFullscreenStop = null;
		});
	}

	private removeHubMap(): void {
		this.hubMapApi?.destroy();
		this.hubMapApi = null;
		this.hubMapEl?.remove();
		this.hubMapHandle?.remove();
		this.hubMapEl = null;
		this.hubMapHandle = null;
	}

	protected override sortedGroups() {
		const groups = super.sortedGroups();
		const text = this.glanceQuery.trim();
		if (text) this.loadSearchBodies();
		const query = text ? this.queryFor(text) : null;
		return groups
			.map((group) => ({
				label: group.label,
				rows: group.rows.filter((row) => {
					if (!this.plugin.passesSnoozeFilter(row.path)) return false;
					if (!query) return true;
					return matchesGlanceQuery(this.recordFor(row), query);
				}),
			}))
			.filter((group) => group.rows.length > 0);
	}

	protected override renderBody(): void {
		super.renderBody();
		if (this.totalRows() === 0) this.publishPinOrder([]);
		this.sizeEmbedFrame();
	}

	protected paint(): void {
		this.applyDensity();
		const groups = this.sortedGroups();
		const paths: string[] = [];
		groups.forEach((group, groupIndex) => {
			if (group.label) {
				this.scrollEl.createDiv({ cls: 'rv-locator-group-label', text: group.label });
			}
			const grid = this.scrollEl.createDiv('rv-locator-card-grid');
			group.rows.forEach((row, rowIndex) => {
				paths.push(row.path);
				this.paintCard(grid, row, `${groupIndex}:${rowIndex}:${row.path}`);
			});
		});
		this.publishPinOrder(paths);
		this.applyColumnSnap();
		this.snapCardFrames();
		this.watchLayout();
	}

	/** Rank on the map follows this exact card order, after sort, filters, and search. */
	private publishPinOrder(paths: readonly string[]): void {
		this.renderedPaths = paths;
		this.hubMapApi?.applyRenderedOrder(paths);
	}

	/**
	 * Search replaces the toolbar button row.
	 * The field is created once so typing keeps focus.
	 */
	private searchReplacesBar(open: boolean): void {
		this.searchOpen = open;
		this.root.toggleClass('is-search-open', open);
		if (!open) this.clearSearch();
	}

	/** Search replaces the pills. The field is created once so typing keeps focus. */
	private ensureSearchField(): void {
		if (this.searchInput) return;
		const slot = this.searchSlot ?? this.sortEl.createDiv('rv-locator-search-slot');
		this.searchSlot = slot;
		if (slot.parentElement !== this.sortEl) this.sortEl.appendChild(slot);
		const row = slot.createDiv('rv-locator-search');
		const input = row.createEl('input', {
			cls: 'rv-locator-search-input',
			attr: {
				type: 'search',
				placeholder: 'Search',
				'aria-label': 'Search return visits',
				value: this.glanceQuery,
			},
		});
		input.value = this.glanceQuery;
		this.searchInput = input;
		input.addEventListener('focus', () => slot.addClass('is-focused'));
		input.addEventListener('blur', () => slot.removeClass('is-focused'));
		input.addEventListener('input', () => {
			this.glanceQuery = input.value;
			this.renderBody();
		});
		input.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			this.searchReplacesBar(false);
		});
		const clear = row.createEl('button', {
			cls: 'rv-locator-toolbar-quiet',
			attr: { type: 'button', 'aria-label': 'Close search', title: 'Close search' },
		});
		setIcon(clear, 'x');
		clear.addEventListener('click', () => {
			this.searchReplacesBar(false);
		});
	}

	private clearSearch(): void {
		this.glanceQuery = '';
		this.parsedKey = '';
		this.parsedQuery = null;
		if (this.searchInput) this.searchInput.value = '';
		this.renderBody();
	}

	private queryFor(text: string): GlanceQuery {
		if (this.parsedKey !== text || !this.parsedQuery) {
			this.parsedQuery = parseGlanceQuery(text, new Date());
			this.parsedKey = text;
		}
		return this.parsedQuery;
	}

	private recordFor(row: RowModel) {
		const file = this.app.vault.getAbstractFileByPath(row.path);
		const frontmatter = file instanceof TFile
			? (this.app.metadataCache.getFileCache(file)?.frontmatter ?? null) as Record<string, unknown> | null
			: null;
		return glanceRecordFromNote({
			name: row.name,
			address: row.addressText || row.addressStreet || '',
			city: row.addressCity || '',
			frontmatter,
			body: this.bodyCache.get(row.path)?.body ?? '',
		});
	}

	private loadSearchBodies(): void {
		if (this.bodiesLoading) return;
		const files: TFile[] = [];
		for (const group of this.groups) {
			for (const row of group.rows) {
				const file = this.app.vault.getAbstractFileByPath(row.path);
				if (!(file instanceof TFile)) continue;
				const cached = this.bodyCache.get(file.path);
				if (!cached || cached.mtime !== file.stat.mtime) files.push(file);
			}
		}
		if (files.length === 0) return;
		this.bodiesLoading = true;
		void Promise.all(files.map(async (file) => {
			try {
				const body = await this.app.vault.cachedRead(file);
				this.bodyCache.set(file.path, { mtime: file.stat.mtime, body });
			} catch {
				// Frontmatter still searches name, address, dates, and logged titles.
			}
		})).then(() => {
			this.bodiesLoading = false;
			if (this.glanceQuery.trim()) this.renderBody();
		});
	}

	/** Painted width of a list card in this view. The map popup copies it. */
	listCardWidth(): number {
		const card = this.scrollEl?.querySelector('.rv-locator-card');
		if (!(card instanceof HTMLElement) || typeof card.getBoundingClientRect !== 'function') return 0;
		const width = card.getBoundingClientRect().width;
		return width > 1 ? Math.round(width) : 0;
	}

	/** The map popup asks for the list card. Density comes from this view, not a separate scale. */
	paintCardForPath(parent: HTMLElement, path: string): boolean {
		let found: RowModel | null = null;
		for (const group of this.groups) {
			const row = group.rows.find((item) => item.path === path);
			if (row) {
				found = row;
				break;
			}
		}
		if (!found) return false;
		const font = this.root.style.getPropertyValue('--rv-font-scale') || '1';
		const icon = this.root.style.getPropertyValue('--rv-icon-scale') || String(this.plugin.settings.glancableIconScale);
		const size = this.root.style.getPropertyValue('--rv-control-size');
		parent.style.setProperty('--rv-font-scale', font);
		parent.style.setProperty('--rv-icon-scale', icon);
		if (size) parent.style.setProperty('--rv-control-size', size);
		this.paintCard(parent, found, `map:${path}`);
		return true;
	}

	private paintCard(parent: HTMLElement, row: RowModel, key: string): void {
		const card = parent.createDiv('rv-locator-card');
		card.setAttr('data-rv-path', row.path);
		card.addEventListener('click', (event) => {
			const target = event.target;
			const onControl = target instanceof Element && target.closest(CARD_BLANK_IGNORE) != null;
			if (!cardBlankOpensPin(this.plugin.hubMapOpen, onControl)) return;
			event.preventDefault();
			this.plugin.highlightMapPin(row.path);
		});
		const rank = priorityRank(this.cellNamed(row, 'Priority'));
		const priority = rowPriority(row);
		const urgency = rowUrgency(row, this.plugin.settings, new Date(), this.plugin.snoozeUntilFor(row.path));
		const band = priority != null && priority > 0 ? urgencyBand(urgency) : 0;
		card.setAttr('data-urgency-band', String(band));
		if (priority === 0) card.addClass('is-priority-zero');
		const urgencyColor = urgencyAccentColor(urgency, priority, urgencyColorsFor(this.plugin.settings.urgencyPalette, this.plugin.settings.urgencyCustomColors));
		card.style.setProperty('--rv-urgency-accent', urgencyColor);
		paintUrgencyInk(card, urgencyColor);
		if (rank) card.setAttr('data-priority', rank);
		if (this.lineOn('name')) {
			const name = card.createDiv('rv-locator-card-name');
			name.setAttr('data-line', glancableLineId(0));
			this.paintCampaignMark(name, row.path);
			const statusIconEl = name.createSpan('rv-locator-status-icon');
			setIcon(statusIconEl, statusIcon(row.status));
			statusIconEl.setAttr('aria-label', row.status);
			statusIconEl.querySelector('svg')?.removeAttribute('aria-label');
			const link = name.createEl('a', {
				cls: 'rv-locator-file-link',
				text: cardPersonTitle(row.name, true),
				href: row.path,
				attr: { 'aria-label': row.name },
			});
			this.bindFileLink(link, row.path);
			const facts = this.plugin.noteFrontmatter(row.path);
			appendPersonMeta(
				name,
				ageCaption(readProperty(facts, 'Age'), readProperty(facts, 'Age Exact')),
				sanitizeGender(readProperty(facts, 'Gender')),
			);
		}

		const showStreet = this.lineOn('street') && Boolean(row.addressStreet);
		const showCity = this.lineOn('city') && Boolean(row.addressCity);
		const showDistance = this.lineOn('distance');
		const splitCity = this.plugin.settings.splitCityLine && showStreet && (showCity || showDistance);
		if (showStreet || showCity || showDistance) {
			const place = card.createDiv('rv-locator-place');
			place.setAttr('data-line', glancableLineId(1));
			const earth = place.createSpan('rv-locator-place-earth');
			setIcon(earth, 'earth');
			place.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				void this.plugin.openMapSoon(row.path);
			});
			if (showStreet && row.addressStreet) {
				place.createSpan({
					cls: 'rv-locator-card-street',
					text: row.addressStreet,
					attr: { 'aria-label': row.addressText || row.addressStreet },
				});
			}
			const cityHost = splitCity ? card.createDiv('rv-locator-place rv-locator-city-line') : place;
			if (splitCity) {
				const building = cityHost.createSpan('rv-locator-place-earth');
				setIcon(building, 'building-2');
			}
			if (showCity && row.addressCity && !splitCity) {
				place.createSpan({
					cls: 'rv-locator-city-lg',
					text: row.addressCity,
					attr: { 'aria-label': row.addressText || row.addressCity },
				});
			}
			if (showCity && row.addressCity && splitCity) {
				cityHost.createSpan({
					cls: 'rv-locator-city-lg',
					text: row.addressCity,
					attr: { 'aria-label': row.addressText || row.addressCity },
				});
			}
			if (showDistance && !splitCity) {
				const distance = this.distanceLabel(row);
				const live = distance !== '—';
				const distEl = place.createSpan({
					cls: `rv-locator-distance-lg${live ? ' is-live' : ' is-missing'}`,
					text: live ? `· ${distance}` : '· —',
					attr: { 'aria-label': live ? `Distance ${distance}` : 'Distance unavailable' },
				});
				this.rememberDistance(key, distEl, row);
			}
			if (showDistance && splitCity) {
				const distance = this.distanceLabel(row);
				const live = distance !== '—';
				const distEl = cityHost.createSpan({
					cls: `rv-locator-distance-lg${live ? ' is-live' : ' is-missing'}`,
					text: live ? `· ${distance}` : '· —',
					attr: { 'aria-label': live ? `Distance ${distance}` : 'Distance unavailable' },
				});
				this.rememberDistance(key, distEl, row);
			}
		}

		const note = this.noteFrontmatter(row.path);
		const study = resolveStatus(readProperty(note, 'Status'), priority) === 'Study';
		const showSpoke = this.lineOn('last-spoke') && (!study || this.plugin.settings.studyShowSpoke);
		const showAttempted = this.lineOn('last-attempted') && (!study || this.plugin.settings.studyShowAttempted);
		const showStudied = study;
		const showMet = this.lineOn('met');
		const compactDates = this.plugin.settings.compactMode;
		if (showSpoke || showAttempted || showMet || showStudied) {
			const when = card.createDiv(compactDates ? 'rv-locator-when is-compact' : 'rv-locator-when');
			if (showStudied) this.frontmatterDateSlot(when, readProperty(note, 'Last Studied'), 'book-marked', 'Last Studied', glancableLineId(2), compactDates, row.path);
			if (showSpoke) this.iconSlot(when, row, 'Last Spoke', 'message-circle', 'Last Spoke', glancableLineId(2), compactDates);
			if (showAttempted) this.iconSlot(when, row, 'Last Attempted', 'clock', 'Last Attempted', glancableLineId(3), compactDates);
			if (showMet) this.iconSlot(when, row, 'Met', 'home', 'Met', glancableLineId(4), compactDates);
		}

		const snoozed = this.plugin.snoozeActiveFor(row.path);
		if (snoozed) {
			card.addClass('is-snoozed');
			card.style.setProperty('--rv-urgency-accent', SNOOZE_SLATE);
			paintUrgencyInk(card, SNOOZE_SLATE);
		}
		const foot = card.createDiv('rv-locator-card-foot');
		foot.setAttr('data-line', glancableLineId(5));
		const metWith = this.cellNamed(row, 'Met With');
		const metText = metWith && metWith.kind !== 'empty' && metWith.text && metWith.text !== '—'
			? metWith.text
			: '';
		const ratio = this.lineOn('visits')
			? (study ? studyRatio(note, this.plugin.settings.studyRatio) : visitRatio(this.cellNamed(row, 'Successful Visits'), this.cellNamed(row, 'Visits')))
			: null;
		const overrideLabel = this.plugin.settings.showCardReturnStatus && !snoozed ? this.plugin.cardOverrideLabel(row.path) : null;
		if (overrideLabel) foot.addClass('rv-locator-override-label');
		paintGlanceFoot(foot, {
			showPerson: this.lineOn('met-with'),
			metWith: metText,
			ratio: ratio?.text ?? '',
			ratioTitle: ratio?.title ?? '',
			daypart: cardReturnLead(new Date(), this.plugin.settings.cardReturnFormat),
			bucket: overrideLabel || this.plugin.cardReturnBucket(row.path),
			showReturn: this.plugin.settings.showCardReturnStatus,
			snoozed,
			snoozeLabel: snoozed ? snoozeCardCaption(this.plugin.snoozeLabelFor(row.path)) : '',
			snoozeDays: snoozed ? `${this.plugin.snoozeDaysLeftFor(row.path)}d` : '',
			onOpen: () => { this.plugin.openAttemptLog(row.path); },
		});
		const lines: CompactLineKind[] = [];
		if (this.lineOn('name')) lines.push('name');
		if (showStreet || showCity || showDistance) lines.push('place');
		if (splitCity) lines.push('place');
		if (compactDates && (showSpoke || showAttempted || showMet || showStudied)) lines.push('dates');
		if (this.lineOn('met-with') || this.lineOn('visits')) lines.push('foot');
		this.paintActions(card, rank, row, urgency, priority, compactDates ? lines : null);
	}

	private paintCampaignMark(parent: HTMLElement, path: string): void {
		const mark = this.plugin.campaignMark(path);
		if (!mark) return;
		const label = mark === 'covered' ? 'Covered this campaign' : 'Not covered this campaign';
		const icon = parent.createSpan({
			cls: 'rv-locator-campaign-mark',
			attr: { 'aria-label': label },
		});
		setIcon(icon, mark === 'covered' ? 'book-check' : 'book-alert');
		icon.querySelector('svg')?.removeAttribute('aria-label');
	}

	private paintActions(
		parent: HTMLElement,
		rank: string | null,
		row: RowModel,
		urgency: number | null,
		priority: number | null,
		compactLines: readonly CompactLineKind[] | null,
	): void {
		const showRank = rank != null;
		const locationName = this.plugin.settings.locationProperty.trim() || 'Location';
		const location = this.cellNamed(row, locationName);
		const hasLocation = Boolean(location && location.kind !== 'empty' && location.text && location.text !== '—');
		const showMap = Boolean(row.addressText) || hasLocation;
		const marks = urgencyMark(urgency, priority);
		let badges = 1;
		if (showRank && rank) badges += 1;
		if (showMap) badges += 1;
		parent.style.setProperty('--rv-badge-count', String(badges));
		parent.addClass('has-actions');
		if (compactLines) {
			parent.addClass('is-compact-mode');
			const scale = Number(this.root.style.getPropertyValue('--rv-font-scale')) || 1;
			const size = compactBadgePx(scale, this.plugin.settings.glancablePaddingY, compactLines, badges);
			parent.style.setProperty('--rv-control-size', `${size}px`);
		}
		const actions = parent.createSpan('rv-locator-card-actions');
		const urgencyLabel = urgencyTitle(urgency, priority);
		const urgencyButton = this.plugin.ghostIconForCard(row.path) === 'moon'
			? appendBadge(actions, { kind: 'icon', icon: 'moon', band: marks.band, label: urgencyLabel })
			: appendBadge(actions, { kind: 'urgency', glyphs: marks.glyphs, band: marks.band, label: urgencyLabel });
		urgencyButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.plugin.promptUrgencyMenu(row.path, row.name, event);
		});
		if (showRank && rank) {
			const pill = appendBadge(actions, {
				kind: 'priority',
				rank,
				label: `Priority ${rank}. Change priority`,
			});
			pill.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.plugin.promptPriority(row.path, row.name);
			});
		}
		if (showMap) {
			const route = appendBadge(actions, { kind: 'icon', icon: 'route', label: 'Directions' });
			route.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				void this.plugin.openRoute(row.path);
			});
		}
	}

	private noteFrontmatter(path: string): Record<string, unknown> | null {
		const file = this.plugin.app.vault.getFileByPath(path);
		if (!file) return null;
		return this.plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
	}

	private frontmatterDateSlot(
		parent: HTMLElement,
		value: unknown,
		icon: string,
		label: string,
		lineId: string,
		compact: boolean,
		path: string,
	): void {
		const raw = value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : '';
		const days = raw ? calendarDaysSince(raw, new Date()) : null;
		const text = days == null ? '—' : (compact ? formatGlanceableCounter(days) : raw);
		this.plainSlot(parent, icon, text, label, days == null, '', lineId, raw ? path : '', raw);
	}

	private iconSlot(parent: HTMLElement, row: RowModel, name: string, icon: string, label: string, lineId: string, compact = false): void {
		const cell = this.cellNamed(row, name);
		const text = cell && cell.kind !== 'empty' && cell.text && cell.text !== '—' ? cell.text : null;
		if (!cell || text == null) {
			this.plainSlot(parent, icon, '—', label, true, '', lineId);
			return;
		}
		const slot = parent.createSpan({
			cls: 'rv-locator-slot is-dated',
			attr: { 'aria-label': cell.title || label, 'data-line': lineId, role: 'link' },
		});
		const iconEl = slot.createSpan('rv-locator-slot-icon');
		setIcon(iconEl, icon);
		slot.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.plugin.jumpCardDate(row.path, cell.title || text);
		});
		if (compact) {
			const days = cell.daysSince;
			slot.createSpan({ cls: 'rv-locator-slot-text', text: days == null ? '—' : formatGlanceableCounter(days) });
			return;
		}
		if (cell.dow) {
			this.renderDriveDate(slot, cell);
			return;
		}
		slot.createSpan({ cls: 'rv-locator-slot-text', text });
	}

	private plainSlot(parent: HTMLElement, icon: string, text: string, title: string, empty: boolean, extra = '', lineId = '', jumpPath = '', jumpRaw = ''): void {
		const slot = parent.createSpan({
			cls: `rv-locator-slot${empty ? ' is-empty' : ''}${jumpRaw ? ' is-dated' : ''}${extra ? ` ${extra}` : ''}`,
			attr: { 'aria-label': title, ...(lineId ? { 'data-line': lineId } : {}), ...(jumpRaw ? { role: 'link' } : {}) },
		});
		if (jumpPath && jumpRaw) {
			slot.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.plugin.jumpCardDate(jumpPath, jumpRaw);
			});
		}
		const iconEl = slot.createSpan('rv-locator-slot-icon');
		setIcon(iconEl, icon);
		slot.createSpan({ cls: 'rv-locator-slot-text', text });
	}

	private syncHubMap(): void {
		const map = this.hubMapEl;
		const open = this.plugin.hubMapOpen && map != null;
		const full = open && this.plugin.hubMapIsFullscreen();
		if (full && !this.root.classList.contains('is-map-fullscreen')) this.rememberScrollbar();
		this.root.toggleClass('is-stacked', this.stackedLayout);
		this.root.toggleClass('is-search-open', this.searchOpen);
		this.root.toggleClass('is-hub-map', open);
		this.root.toggleClass('is-side-map', open && !this.stackedLayout && !full);
		this.root.toggleClass('is-map-fullscreen', full);
		map?.toggleClass('is-fullscreen', full);
		this.hubMapHandle?.setAttr('aria-orientation', this.stackedLayout ? 'horizontal' : 'vertical');
		const size = `${Math.round(this.hubMapRatio * 100)}%`;
		if (this.root.style.getPropertyValue('--rv-map-size') !== size) {
			this.root.style.setProperty('--rv-map-size', size);
		}
		this.sizeEmbedFrame();
		this.hubMapApi?.invalidateSize();
		const view = this.root.ownerDocument.defaultView;
		const width = view?.innerWidth ?? 0;
		const leaf = this.root.clientWidth || width;
		const narrowWindow = width > 0 && width < 1100;
		const narrowLeaf = leaf > 0 && leaf < 1100 && (width === 0 || leaf > width * 0.7);
		this.root.ownerDocument.body.classList.toggle('rv-hide-backlinks', this.stackedLayout || narrowWindow || narrowLeaf);
	}

	/**
	 * A stacked embed is one screen tall, like the standalone hub.
	 * A desktop side map keeps the list-column height via min-height 70vh.
	 */
	private sizeEmbedFrame(): void {
		const embed = this.root.closest('.bases-embed, .block-language-base, .internal-embed, .markdown-embed');
		if (!(embed instanceof HTMLElement)) return;
		const fullBase = embed.closest('.rv-locator-full-base');
		if (fullBase instanceof HTMLElement) {
			embed.classList.remove('is-embed-capped');
			embed.style.removeProperty('--rv-embed-cap');
			embed.style.removeProperty('height');
			embed.style.removeProperty('max-height');
			embed.style.setProperty('overflow', 'visible', 'important');
			concealRawBaseEmbed(fullBase);
			return;
		}
		const release = (): void => {
			embed.classList.remove('is-embed-capped');
			embed.style.removeProperty('--rv-embed-cap');
			embed.style.removeProperty('height');
			embed.style.removeProperty('max-height');
		};
		if (!this.wideHubFrame() || !this.stackedLayout) {
			release();
			return;
		}
		const view = this.root.ownerDocument.defaultView;
		const viewport = view?.visualViewport?.height ?? view?.innerHeight ?? 0;
		const chrome = embedChromePx(this.root.ownerDocument);
		const rect = typeof embed.getBoundingClientRect === 'function' ? embed.getBoundingClientRect() : null;
		const top = rect ? rect.top : 0;
		const fromFrame = top > 1 ? Math.round(viewport - Math.max(0, top)) : stackedEmbedCap(viewport, chrome);
		const cap = Math.max(160, fromFrame);
		embed.style.setProperty('width', '100%', 'important');
		embed.style.setProperty('scrollbar-gutter', 'auto', 'important');
		if (embed.dataset.rvCapScroll !== '1') {
			embed.dataset.rvCapScroll = '1';
			const scroller = embed.closest('.markdown-preview-view, .cm-scroller, .view-content');
			scroller?.addEventListener('scroll', () => { this.sizeEmbedFrame(); }, { passive: true });
			view?.requestAnimationFrame?.(() => { this.sizeEmbedFrame(); });
		}
		embed.classList.add('is-embed-capped');
		embed.style.setProperty('--rv-embed-cap', `${cap}px`);
		embed.style.height = `${cap}px`;
		embed.style.maxHeight = `${cap}px`;
	}

	private bindHubHandle(handle: HTMLElement): void {
		handle.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const startX = event.clientX;
			const startY = event.clientY;
			const start = this.hubMapRatio;
			const box = this.stageEl ?? this.root;
			const height = box.clientHeight || 1;
			const width = box.clientWidth || 1;
			const stacked = this.stackedLayout;
			const move = (ev: PointerEvent): void => {
				const delta = stacked ? (startY - ev.clientY) / height : (startX - ev.clientX) / width;
				const next = start + delta;
				this.hubMapRatio = Math.min(0.72, Math.max(0, next));
				this.syncHubMap();
			};
			const stop = (): void => {
				handle.ownerDocument.removeEventListener('pointermove', move);
				handle.ownerDocument.removeEventListener('pointerup', stop);
				if (this.hubMapRatio < 0.08) {
					this.hubMapRatio = 0.42;
					this.plugin.hideSplitMap();
				}
			};
			handle.ownerDocument.addEventListener('pointermove', move);
			handle.ownerDocument.addEventListener('pointerup', stop);
		});
	}

	private flashCard(path: string | null): void {
		this.scrollEl.querySelectorAll('.rv-card-flash').forEach((node) => node.classList.remove('rv-card-flash'));
		if (!path) return;
		const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(path) : path.replace(/"/g, '');
		const card = this.scrollEl.querySelector(`[data-rv-path="${escaped}"]`);
		if (!(card instanceof HTMLElement)) return;
		revealHubCard(this.scrollEl, card);
		window.setTimeout(() => card.classList.remove('rv-card-flash'), 1600);
	}

	private mapCell(row: RowModel): CellModel | undefined {
		const wanted = this.plugin.settings.mapLinkProperty.trim().toLowerCase();
		const column = this.columns.find((item) => {
			const name = item.name.trim().toLowerCase();
			const label = item.displayName.trim().toLowerCase();
			return (wanted && (name === wanted || label === wanted)) || name === 'map link' || label === 'map link';
		});
		if (!column) return undefined;
		return row.cells.find((cell) => cell.id === column.id);
	}

	private cellNamed(row: RowModel, name: string): CellModel | undefined {
		const column = this.columnNamed(name);
		if (!column) return undefined;
		return row.cells.find((cell) => cell.id === column.id);
	}

	private lineOn(id: GlancableLineId): boolean {
		return this.plugin.settings.glancableLines[id] !== false;
	}

	private applyDensity(): void {
		const settings = this.plugin.settings;
		const fitted = fittedFontScale(this.scrollEl?.clientWidth ?? 0, settings, settings.glancableFitCount);
		this.root.style.setProperty('--rv-pad-y', `${settings.glancablePaddingY}px`);
		this.root.style.setProperty('--rv-pad-x', `${settings.glancablePaddingX}px`);
		this.root.style.setProperty('--rv-font-scale', String(fitted));
		this.root.style.setProperty('--rv-icon-scale', String(settings.glancableIconScale));
		this.root.style.setProperty('--rv-control-size', `${Math.round(28 * fitted)}px`);
		this.root.style.setProperty(
			'--rv-line-max',
			settings.glancableMaxLineChars > 0 ? `${settings.glancableMaxLineChars}ch` : '100%',
		);
	}

	/** Card rows and the blocks above them land on whole pixels, with no badge transform. */
	private snapCardFrames(): void {
		if (!this.scrollEl) return;
		snapEdges(this.scrollEl);
		for (const node of Array.from(this.scrollEl.children)) {
			if (!(node instanceof HTMLElement)) continue;
			if (node.classList.contains('rv-locator-card-grid')) {
				for (const card of Array.from(node.children)) {
					if (card instanceof HTMLElement) snapFlowBox(card, true);
				}
				continue;
			}
			snapFlowBox(node, false);
		}
	}

	/** The list scroller's own scrollbar. A hidden scroller is not a measurement, and a side map is not a gutter. */
	private rememberScrollbar(): void {
		if (this.root.classList.contains('is-map-fullscreen')) return;
		const scroll = this.scrollEl;
		if (!scroll || scroll.clientWidth <= 1) return;
		this.plugin.rememberGlanceScrollbar(elementScrollbarGutterPx(scroll));
	}

	private applyColumnSnap(): void {
		this.rememberScrollbar();
		const scroll = this.scrollEl;
		const gutter = elementScrollbarGutterPx(scroll);
		const column = scroll.offsetWidth > 1 ? scroll.offsetWidth : scroll.clientWidth + gutter;
		const settings = this.plugin.settings;
		const card = glancableCardWidthPx(column, gutter, settings, settings.glancableFitCount);
		const columns = Number.isFinite(card)
			? glancableCardColumns(column, gutter, settings, settings.glancableFitCount)
			: 1;
		const template = columns >= 2 ? `repeat(${columns}, minmax(0, 1fr))` : 'minmax(0, 1fr)';
		for (const node of Array.from(this.scrollEl.querySelectorAll('.rv-locator-card-grid'))) {
			(node as HTMLElement).style.gridTemplateColumns = template;
		}
	}

	private watchLayout(): void {
		if (this.layoutObserver || typeof ResizeObserver === 'undefined') return;
		this.layoutObserver = new ResizeObserver(() => {
			this.applyColumnSnap();
			if (this.plugin.settings.glancableFitCount !== 0) this.applyDensity();
			this.syncHubMapMount();
			this.snapCardFrames();
		});
		this.layoutObserver.observe(this.scrollEl);
		this.layoutObserver.observe(this.root);
		this.register(() => {
			this.layoutObserver?.disconnect();
			this.layoutObserver = null;
		});
	}

	private columnNamed(name: string): ColumnModel | undefined {
		const wanted = name.trim().toLowerCase();
		return this.columns.find((column) => column.name.trim().toLowerCase() === wanted);
	}

	/**
	 * Tag the Bases toolbar that owns this view. The class stays off every
	 * other leaf, and onunload removes it when Glancable is no longer showing.
	 */
	private fillHubToFrame(): void {
		this.clearHubFill();
		fillHubFrame(this.root, this.hubFillNodes);
	}

	private clearHubFill(): void {
		for (const node of this.hubFillNodes) node.classList.remove('rv-hub-fill');
		this.hubFillNodes = [];
	}

	/**
	 * A base opened on its own, or a note whose cssclass is rv-locator-full-base.
	 * Any other embed keeps Obsidian's normal base frame.
	 */
	private wideHubFrame(): boolean {
		if (typeof this.root.closest !== 'function') return true;
		const embed = this.root.closest('.bases-embed, .block-language-base, .internal-embed, .markdown-embed');
		if (!(embed instanceof HTMLElement)) return true;
		const host = embed.closest('.markdown-preview-view, .markdown-source-view, .markdown-reading-view, .workspace-leaf-content');
		return host instanceof HTMLElement && host.classList.contains('rv-locator-full-base');
	}

	private syncBasesChrome(): void {
		const host = basesChromeHost(this.root);
		if (this.chromeHost && this.chromeHost !== host) this.clearBasesChrome();
		this.chromeHost = host;
		if (!host) return;
		host.classList.add('rv-glancable-host');
		if (this.wideHubFrame()) this.fillHubToFrame();
		else this.clearHubFill();
		const flags = this.plugin.settings.glancableChrome;
		for (const piece of CHROME_PIECES) {
			host.toggleAttribute(hideAttr(piece), hidePiece(flags, piece));
		}
		host.toggleAttribute('data-rv-hide-toolbar', flags.hideToolbar);
		tagChromeControls(host);
		collapseBasesBar(host, flags.hideToolbar);
	}

	private clearBasesChrome(): void {
		const host = this.chromeHost;
		this.chromeHost = null;
		this.clearHubFill();
		if (!host) return;
		host.classList.remove('rv-glancable-host');
		host.removeAttribute('data-rv-hide-toolbar');
		for (const piece of CHROME_PIECES) host.removeAttribute(hideAttr(piece));
		host.querySelectorAll('[data-rv-chrome]').forEach((node) => {
			node.removeAttribute('data-rv-chrome');
		});
	}

}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Bands 0–3. Built with createElementNS in the button's own document
 * (Obsidian's createSvg when that helper is on the node). DOMParser markup
 * never becomes a painted child here: a parsed SVG can fail to import, and a
 * viewBox-only svg inside this flex button can resolve to 0×0. Stems, dots,
 * the ring, and the dash are 2px strokes. Inline stroke and currentColor keep
 * a theme rule of `svg { fill: none }` from blanking them.
 */
const STROKE_TARGET_PX = 2;

function strokeLabel(px: number): string {
	const rounded = Math.round(px * 1000) / 1000;
	return `${rounded}px`;
}

/**
 * Next specified width so a border that is currently `specifiedPx` and paints
 * at `usedPx` paints at 2 CSS px. One step from a declared 2px used as
 * 1.01587px is 3.938px. A declared 3.938px that paints at 3.04762px is not
 * done: zoom is not that divisor, so the next step is 2.584px.
 */
export function correctedStrokePx(usedPx: number, specifiedPx = STROKE_TARGET_PX): string {
	if (!Number.isFinite(usedPx) || usedPx <= 0.01) return '2px';
	if (!Number.isFinite(specifiedPx) || specifiedPx <= 0) return '2px';
	if (Math.abs(usedPx - STROKE_TARGET_PX) <= 0.05) return strokeLabel(specifiedPx);
	const next = specifiedPx * (STROKE_TARGET_PX / usedPx);
	if (!Number.isFinite(next) || next <= 0) return '2px';
	return strokeLabel(Math.min(8, Math.max(0.5, next)));
}

/**
 * Used border of `host` after `specifiedPx` is applied.
 * getComputedStyle already includes the zoom that changes the border, so this
 * does not multiply by currentCSSZoom or an ancestor transform. When the
 * computed width is still the specified width, a 2px probe in the same
 * parent supplies the painted ratio (its border box versus the unzoomed
 * offset width) and that ratio is applied once.
 */
function usedBorderPx(host: HTMLElement, specifiedPx: number): number {
	const view = host.ownerDocument.defaultView;
	if (!view || typeof view.getComputedStyle !== 'function') return specifiedPx;
	host.style.setProperty('border-width', strokeLabel(specifiedPx), 'important');
	const computed = Number.parseFloat(view.getComputedStyle(host).borderTopWidth);
	if (Number.isFinite(computed) && computed > 0 && Math.abs(computed - specifiedPx) > 0.02) return computed;
	const probed = probeBorderRatio(host);
	if (probed > 0 && Math.abs(probed - 1) > 0.02) return specifiedPx * probed;
	return Number.isFinite(computed) && computed > 0 ? computed : specifiedPx;
}

function probeBorderRatio(host: HTMLElement): number {
	const doc = host.ownerDocument;
	const view = doc.defaultView;
	if (!view || typeof view.getComputedStyle !== 'function') return 1;
	const probe = doc.createElement('span');
	probe.setAttribute('aria-hidden', 'true');
	probe.style.position = 'absolute';
	probe.style.left = '0';
	probe.style.top = '0';
	probe.style.width = '0';
	probe.style.height = '0';
	probe.style.padding = '0';
	probe.style.margin = '0';
	probe.style.borderStyle = 'solid';
	probe.style.borderWidth = '2px';
	probe.style.boxSizing = 'content-box';
	probe.style.pointerEvents = 'none';
	probe.style.visibility = 'hidden';
	const parent = host.parentElement ?? host;
	parent.appendChild(probe);
	let ratio = 1;
	try {
		const computed = Number.parseFloat(view.getComputedStyle(probe).borderTopWidth);
		if (Number.isFinite(computed) && computed > 0 && Math.abs(computed - 2) > 0.02) ratio = computed / 2;
		else {
			const offset = probe.offsetWidth;
			const painted = probe.getBoundingClientRect().width;
			if (offset > 0.5 && painted > 0) ratio = painted / offset;
		}
	} finally {
		probe.remove();
	}
	return ratio > 0 ? ratio : 1;
}

/** Specified width whose painted border is 2 CSS px. Measured, then adjusted again. */
function badgeStrokePx(host: HTMLElement): string {
	if (!host.isConnected) return '2px';
	let specified = STROKE_TARGET_PX;
	for (let pass = 0; pass < 4; pass += 1) {
		const used = usedBorderPx(host, specified);
		if (!Number.isFinite(used) || used <= 0.01) return '2px';
		if (Math.abs(used - STROKE_TARGET_PX) <= 0.05) return strokeLabel(specified);
		const next = Number.parseFloat(correctedStrokePx(used, specified));
		if (!Number.isFinite(next) || Math.abs(next - specified) < 0.01) return strokeLabel(specified);
		specified = next;
	}
	return strokeLabel(specified);
}

/** Keep the painted badge and map-pin ring at 2 CSS px. Ghosts stay dashed. Measured once per host. */
export function pinBadgeStroke(host: HTMLElement): void {
	const ghost = host.classList.contains('is-ghost');
	const style = ghost ? 'dashed' : 'solid';
	const cached = host.dataset.rvStrokePx;
	if (
		cached
		&& host.style.getPropertyValue('border-width') === cached
		&& host.style.getPropertyValue('border-style') === style
	) return;
	const px = cached || badgeStrokePx(host);
	host.dataset.rvStrokePx = px;
	applyBadgeStroke(host, px);
}

function applyBadgeStroke(host: HTMLElement, px: string): void {
	const ghost = host.classList.contains('is-ghost');
	host.style.setProperty('border-style', ghost ? 'dashed' : 'solid', 'important');
	host.style.setProperty('border-width', px, 'important');
	host.querySelectorAll('line, circle.is-ring').forEach((node) => {
		if (!(node instanceof Element) || !('style' in node)) return;
		const mark = node as Element & { style: CSSStyleDeclaration };
		mark.style.setProperty('stroke-width', px, 'important');
		mark.setAttribute('vector-effect', 'non-scaling-stroke');
		mark.style.setProperty('vector-effect', 'non-scaling-stroke');
		mark.style.setProperty('stroke-linecap', 'round');
	});
}

export type BadgeIconName = 'route' | 'moon' | 'hourglass' | 'ban';

export type BadgeFace =
	| { kind: 'urgency'; glyphs: string; band: number; label: string }
	| { kind: 'priority'; rank: string; label: string }
	| { kind: 'icon'; icon: BadgeIconName; label: string; band?: number };

/**
 * One badge for Quick Facts, glancable cards, and the map popup.
 * Same element, same SVG or digit, same optical factor, same stroke.
 */
export function appendBadge(parent: HTMLElement, face: BadgeFace): HTMLElement {
	const button = parent.ownerDocument.createElement('button');
	button.type = 'button';
	button.setAttribute('aria-label', face.label);
	parent.appendChild(button);
	if (face.kind === 'priority') {
		button.className = 'rv-locator-priority-pill';
		button.textContent = face.rank;
		pinBadgeStroke(button);
		return button;
	}
	if (face.kind === 'icon') {
		button.className = face.icon === 'route' ? 'rv-locator-map-pin' : 'rv-locator-urgency';
		if (face.band != null) button.dataset.band = String(face.band);
		if (face.icon !== 'route' && face.icon !== 'moon') button.classList.add('is-ghost');
		tagBadgeIcon(button, face.icon);
		setIcon(button, face.icon);
		pinBadgeStroke(button);
		if (face.icon === 'moon') paintSnoozeBadge(button);
		return button;
	}
	button.className = 'rv-locator-urgency';
	button.dataset.band = String(face.band);
	mountUrgencyGlyph(button, face.glyphs);
	return button;
}

const SNAP_EDGES = ['margin-top', 'margin-bottom', 'padding-top', 'padding-bottom'] as const;

function px(value: number): string {
	return String(Math.round(value * 100) / 100);
}

/**
 * Nearest border-box height that still centers an even badge stack.
 * 100.39 stays 100. A parity nudge never adds a pixel past the nearer side.
 */
export function wholeCardHeight(height: number, border: number, stack: number): number {
	const nearest = Math.max(1, Math.round(height));
	const edge = Math.round(border);
	const centered = (value: number): boolean => stack <= 0 || (value >= edge + stack && (value - edge - stack) % 2 === 0);
	if (centered(nearest)) return nearest;
	const lower = nearest - 1;
	const upper = nearest + 1;
	const lowerOk = lower >= 1 && centered(lower);
	const upperOk = centered(upper);
	if (lowerOk && upperOk) return Math.abs(height - lower) <= Math.abs(upper - height) ? lower : upper;
	if (lowerOk) return lower;
	if (upperOk) return upper;
	return nearest;
}

/**
 * Pin a card to the nearest whole pixel once per width.
 * Clearing the pin on every resize pass would paint the fractional height,
 * then grow it, so a later frame must not measure again at the same width.
 */
export function snapFlowBox(el: HTMLElement, card = false): void {
	if (!card) return;
	const widthNow = Math.round(el.getBoundingClientRect().width);
	if (widthNow < 1) return;
	if (el.dataset.rvSnapWidth === String(widthNow) && el.style.height) return;
	el.style.height = '';
	el.style.minHeight = '';
	const rect = el.getBoundingClientRect();
	if (rect.height < 1) return;
	const next = wholeCardHeight(rect.height, verticalBorder(el), badgeStack(el));
	el.style.height = `${next}px`;
	el.dataset.rvSnapWidth = String(Math.round(el.getBoundingClientRect().width));
	const actions = el.querySelector(':scope > .rv-locator-card-actions');
	if (actions instanceof HTMLElement) snapActionsColumn(actions);
}

/**
 * The action rail is pinned to the card's right edge. A fractional card width
 * leaves that edge off the pixel, so the rail's own top and left are rounded
 * and its height is a whole pixel that still centers the stack.
 */
function snapActionsColumn(actions: HTMLElement): void {
	actions.style.transform = '';
	const rect = actions.getBoundingClientRect();
	if (rect.width < 1 || rect.height < 1) return;
	const dx = Math.round(rect.left) - rect.left;
	const dy = Math.round(rect.top) - rect.top;
	const heightOff = Math.abs(rect.height - Math.round(rect.height)) >= 0.05;
	if (Math.abs(dx) >= 0.05) {
		const current = parseFloat(actions.style.marginLeft) || 0;
		actions.style.marginLeft = `${px(current + dx)}px`;
	}
	if (Math.abs(dy) < 0.05 && !heightOff) return;
	const current = parseFloat(actions.style.top) || 0;
	if (Math.abs(dy) >= 0.05) actions.style.top = `${px(current + dy)}px`;
	actions.style.bottom = 'auto';
	const badges = Array.from(actions.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
	const gap = Math.round(parseFloat(getComputedStyle(actions).rowGap || getComputedStyle(actions).gap) || 4);
	let stack = gap * Math.max(0, badges.length - 1);
	for (const badge of badges) {
		const height = badge.getBoundingClientRect().height;
		stack += height > 0 ? Math.round(height) : 28;
	}
	let height = Math.max(Math.round(rect.height), stack);
	if (stack > 0 && (height - stack) % 2 !== 0) height += 1;
	actions.style.height = `${height}px`;
}

/** An absolute popup's own top and left, corrected onto the pixel grid. */
export function snapAbsoluteOrigin(el: HTMLElement): void {
	const rect = el.getBoundingClientRect();
	if (rect.width < 1 || rect.height < 1) return;
	const dx = Math.round(rect.left) - rect.left;
	const dy = Math.round(rect.top) - rect.top;
	const left = parseFloat(el.style.left) || 0;
	const top = parseFloat(el.style.top) || 0;
	if (Math.abs(dx) >= 0.05) el.style.left = `${px(left + dx)}px`;
	if (Math.abs(dy) >= 0.05) el.style.top = `${px(top + dy)}px`;
}

function snapEdges(el: HTMLElement): void {
	const style = getComputedStyle(el);
	for (const name of SNAP_EDGES) {
		const value = parseFloat(style.getPropertyValue(name));
		if (!Number.isFinite(value) || Math.abs(value - Math.round(value)) < 0.05) continue;
		const rounded = `${Math.round(value)}px`;
		if (el.style.getPropertyValue(name) !== rounded) el.style.setProperty(name, rounded);
	}
}

function verticalBorder(el: HTMLElement): number {
	const style = getComputedStyle(el);
	const top = parseFloat(style.borderTopWidth) || 0;
	const bottom = parseFloat(style.borderBottomWidth) || 0;
	return top + bottom;
}

function badgeStack(card: HTMLElement): number {
	const actions = card.querySelector(':scope > .rv-locator-card-actions');
	if (!(actions instanceof HTMLElement)) return 0;
	const badges = Array.from(actions.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
	if (badges.length === 0) return 0;
	const gap = parseFloat(getComputedStyle(actions).rowGap || getComputedStyle(actions).gap) || 4;
	let stack = Math.round(gap) * (badges.length - 1);
	for (const badge of badges) {
		const height = badge.getBoundingClientRect().height;
		stack += height > 0 ? Math.round(height) : 28;
	}
	return stack;
}

function paintSnoozeBadge(button: HTMLElement): void {
	button.style.setProperty('color', SNOOZE_SLATE, 'important');
	button.style.setProperty('border-color', SNOOZE_SLATE, 'important');
	button.querySelectorAll('svg').forEach((node) => {
		if (!(node instanceof SVGElement)) return;
		node.style.setProperty('color', SNOOZE_SLATE, 'important');
		node.style.setProperty('stroke', SNOOZE_SLATE, 'important');
	});
}

/** Line-icon badges opt into their optical factor. Pin heads do not. */
export function tagBadgeIcon(host: HTMLElement, icon: string): void {
	const key = badgeLineOpticalKey(icon);
	if (key) host.dataset.rvGlyph = key;
	else delete host.dataset.rvGlyph;
}

export function mountUrgencyGlyph(host: HTMLElement, glyphs: string): void {
	const shapes = urgencyBangShapes(glyphs);
	if (shapes.length === 0) {
		pinBadgeStroke(host);
		return;
	}
	const svg = makeSvg(host, 'svg', {
		viewBox: '0 0 28 28',
		width: '28',
		height: '28',
		fill: 'none',
		'aria-hidden': 'true',
		focusable: 'false',
	}, 'rv-urgency-glyph');
	const opticalKey = urgencyOpticalKey(glyphs);
	svg.dataset.rvGlyph = opticalKey;
	svg.style.display = 'block';
	svg.style.flex = '0 0 auto';
	const ink = host.classList.contains('rv-pin-head')
		? '0.7'
		: `var(--rv-badge-ink, 0.53) * var(--rv-opt-${opticalKey}, 1)`;
	svg.style.width = `calc(var(--rv-control-size, 28px) * ${ink})`;
	svg.style.height = `calc(var(--rv-control-size, 28px) * ${ink})`;
	svg.style.overflow = 'visible';
	svg.style.color = 'inherit';
	svg.style.setProperty('fill', 'none');
	for (const shape of shapes) {
		const node = makeSvg(svg, shape.kind, shape.attr);
		if (shape.attr.fill === 'none' || shape.kind === 'line') {
			node.style.setProperty('fill', 'none', 'important');
			node.style.setProperty('stroke', 'currentColor', 'important');
			node.setAttribute('vector-effect', 'non-scaling-stroke');
			node.style.setProperty('vector-effect', 'non-scaling-stroke');
			node.style.setProperty('stroke-width', '2px', 'important');
			node.style.setProperty('stroke-linecap', 'round');
		} else {
			node.style.setProperty('fill', 'currentColor');
		}
	}
	if (host.classList.contains('rv-pin-head')) {
		host.style.removeProperty('border-style');
		host.style.removeProperty('border-width');
		host.style.removeProperty('border-color');
		return;
	}
	pinBadgeStroke(host);
}

function makeSvg(parent: Element, tag: 'svg' | 'rect' | 'circle' | 'line', attr: Record<string, string>, cls?: string): SVGElement {
	const creator = parent as Element & {
		createSvg?: (name: 'svg' | 'rect' | 'circle' | 'line', info?: { cls?: string; attr?: Record<string, string> }) => SVGElement;
	};
	if (typeof creator.createSvg === 'function') {
		return creator.createSvg(tag, { cls, attr });
	}
	const doc = parent.ownerDocument;
	const node = doc.createElementNS(SVG_NS, tag);
	if (cls) node.setAttribute('class', cls);
	for (const [key, value] of Object.entries(attr)) node.setAttribute(key, value);
	parent.appendChild(node);
	return node;
}

/** Hide the Bases bar without leaving its header's min-height as a gap. */
function collapseBasesBar(host: HTMLElement, hide: boolean): void {
	if (typeof host.querySelectorAll !== 'function') return;
	host.querySelectorAll('.bases-toolbar, .bases-header').forEach((node) => {
		if (!(node instanceof HTMLElement) || node.classList.contains('view-header')) return;
		const props = ['display', 'height', 'min-height', 'margin', 'padding', 'border', 'overflow'];
		if (!hide) {
			for (const prop of props) node.style.removeProperty(prop);
			return;
		}
		node.style.setProperty('display', 'none', 'important');
		node.style.setProperty('height', '0', 'important');
		node.style.setProperty('min-height', '0', 'important');
		node.style.setProperty('margin', '0', 'important');
		node.style.setProperty('padding', '0', 'important');
		node.style.setProperty('border', '0', 'important');
		node.style.setProperty('overflow', 'hidden', 'important');
	});
}

/**
 * Stretch every wrapper between the hub and its frame so the bottom bar
 * sits on the frame, not above a padding gap. An embed stops at the embed.
 * A base opened on its own stops at the leaf.
 */
function embedChromePx(doc: Document): number {
	if (typeof doc.querySelector !== 'function' || typeof getComputedStyle !== 'function') return 0;
	const style = getComputedStyle(doc.documentElement);
	const header = cssPx(style, '--header-height');
	const safe = cssPx(style, '--safe-area-inset-bottom');
	const nav = doc.querySelector('.mobile-navbar, .mobile-toolbar');
	const navPx = nav instanceof HTMLElement ? nav.getBoundingClientRect().height : 0;
	return header + safe + navPx;
}

function cssPx(style: CSSStyleDeclaration, name: string): number {
	const value = Number.parseFloat(style.getPropertyValue(name));
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function fillHubFrame(root: HTMLElement, marked: HTMLElement[]): void {
	if (typeof root.closest !== 'function') return;
	const embed = root.closest('.bases-embed, .block-language-base, .internal-embed, .markdown-embed');
	const leaf = root.closest('.workspace-leaf-content');
	const stop = embed ?? leaf;
	let node: HTMLElement | null = root.parentElement;
	while (node) {
		node.classList.add('rv-hub-fill');
		marked.push(node);
		if (node === stop) break;
		node = node.parentElement;
	}
}

function basesChromeHost(root: HTMLElement): HTMLElement | null {
	const marked = root.closest('.bases-embed, .block-language-base, .workspace-leaf-content');
	if (domInstanceOf(marked, HTMLElement) && marked.querySelector('.bases-toolbar, .view-header')) return marked;
	const viewContent = root.closest('.view-content');
	const parent = viewContent?.parentElement ?? null;
	if (parent?.querySelector('.bases-toolbar, .view-header')) return parent;
	if (domInstanceOf(viewContent, HTMLElement) && viewContent.querySelector('.bases-toolbar')) return viewContent;
	return root.parentElement;
}

function tagChromeControls(host: HTMLElement): void {
	const scopes = [host.querySelector('.bases-toolbar'), host.querySelector('.view-header')];
	for (const scope of scopes) {
		if (!domInstanceOf(scope, HTMLElement)) continue;
		const nodes = scope.querySelectorAll('.bases-toolbar-item, button, a, .search-input-container, .edit-block-button, .view-action');
		nodes.forEach((node) => {
			if (!domInstanceOf(node, HTMLElement)) return;
			if (node.closest('.rv-locator-view')) return;
			const piece = classifyChromeControl(chromeControlHint(node));
			if (piece) node.setAttribute('data-rv-chrome', piece);
			else node.removeAttribute('data-rv-chrome');
		});
	}
}

function hideAttr(piece: ChromePiece): string {
	return `data-rv-hide-${piece}`;
}

function hidePiece(flags: GlancableChromeFlags, piece: ChromePiece): boolean {
	switch (piece) {
		case 'views': return flags.hideViews;
		case 'sort': return flags.hideSort;
		case 'filter': return flags.hideFilter;
		case 'properties': return flags.hideProperties;
		case 'search': return flags.hideSearch;
		case 'new': return flags.hideNew;
		case 'code': return flags.hideCode;
	}
}

function urgencyTitle(urgency: number | null, priority: number | null): string {
	if (priority == null || priority <= 0) return 'Priority 0. No urgency color.';
	if (urgency == null) return 'Urgency. Snooze for today, 7 days, or 14 days.';
	if (urgency < 1) return `Urgency ${urgency.toFixed(2)}. Snooze for today, 7 days, or 14 days.`;
	return `Urgency ${urgency.toFixed(2)}. Snooze for today, 7 days, or 14 days.`;
}

function priorityRank(cell: CellModel | undefined): string | null {
	if (!cell || cell.kind === 'empty' || !cell.text) return null;
	const parsed = Number(cell.text);
	if (!Number.isFinite(parsed)) return null;
	const rank = Math.round(parsed);
	if (rank < 0 || rank > 5) return null;
	return String(rank);
}

function studyRatio(note: Record<string, unknown> | null, order: 'lessons-studies' | 'studies-lessons'): { text: string; title: string } {
	const lessons = Array.isArray(readProperty(note, 'Lessons Studied'))
		? (readProperty(note, 'Lessons Studied') as unknown[]).filter((item) => typeof item === 'string' && item.trim()).length
		: (typeof readProperty(note, 'Lessons Studied') === 'string' && String(readProperty(note, 'Lessons Studied')).trim() ? 1 : 0);
	const studies = Number(readProperty(note, 'Studies'));
	const count = Number.isFinite(studies) ? studies : 0;
	const fraction = formatStudyFraction(lessons, count, order);
	const label = order === 'studies-lessons' ? 'Studies/Lessons' : 'Lessons/Studies';
	return { text: fraction.ratio, title: `${label} ${fraction.withDecimal}` };
}

function visitRatio(successful: CellModel | undefined, visits: CellModel | undefined): { text: string; title: string } {
	const home = countText(successful);
	const total = countText(visits);
	const homeLabel = home === '—' ? 'Successful Visits missing' : `${home} Successful Visits`;
	const totalLabel = total === '—' ? 'Visits missing' : `${total} Visits`;
	return { text: `${home}/${total}`, title: `${homeLabel} of ${totalLabel}` };
}

function countText(cell: CellModel | undefined): string {
	if (!cell || cell.kind === 'empty' || !cell.text || cell.text === '—') return '—';
	const count = Number(cell.text);
	if (!Number.isFinite(count)) return cell.text;
	return Number.isInteger(count) ? String(count) : cell.text;
}

/** Hide a raw `![[file.base]]` line once the embed is the full-base view. */
export function concealRawBaseEmbed(root: HTMLElement): number {
	let hidden = 0;
	if (typeof root.querySelectorAll !== 'function') return 0;
	root.querySelectorAll('p, .cm-line, .el-p').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (node.querySelector('.internal-embed, .bases-embed, .bases-view, .markdown-embed')) return;
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (!/^!\[\[[^\]]+\.base\]\]$/.test(text)) return;
		node.classList.add('rv-base-source-hidden');
		node.style.display = 'none';
		hidden += 1;
	});
	return hidden;
}
