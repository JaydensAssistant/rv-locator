import { Platform, setIcon, TFile, type QueryController } from 'obsidian';
import { hubUsesStackedMap, revealHubCard } from './hub-layout';
import type { NearbyScope } from './active-layout';
import { GLANCABLE_VIEW_TYPE, NON_AFFILIATION_NOTICE } from './constants';
import { domInstanceOf } from './dom';
import { compactBadgePx, fittedFontScale, glancableColumns, type CompactLineKind } from './glancable-density';
import { CHROME_PIECES, chromeControlHint, classifyChromeControl, type ChromePiece } from './glancable-chrome';
import type { CellModel, ColumnModel, RowModel } from './model';
import type RVLocatorPlugin from './main';
import { glancableLineId } from './glancable-lines';
import { NearbyBasesView } from './nearby-view';
import { rowPriority, rowUrgency } from './row-score';
import { urgencyAccentColor, urgencyBand, urgencyBangShapes, urgencyMark } from './scoring';
import { urgencyColorsFor, urgencyInk } from './urgency-palette';
import { cardPersonTitle } from './note-name';
import { cardReturnLead } from './schedule';
import { calendarDaysSince, formatGlanceableCounter } from './dates';
import { readProperty } from './frontmatter';
import { glanceRecordFromNote, matchesGlanceQuery, parseGlanceQuery, type GlanceQuery } from './glance-search';
import { formatStudyFraction } from './catalog';
import { resolveStatus, statusIcon } from './status';
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
	private hubMapApi: { destroy(): void } | null = null;
	private hubMapRatio = 0.42;
	private stackedLayout = false;
	private searchOpen = false;
	private hubScrollerStop: (() => void) | null = null;
	private hubFullscreenStop: (() => void) | null = null;

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
	}

	override onunload(): void {
		this.clearBasesChrome();
		super.onunload();
	}

	protected override afterRender(): void {
		this.syncBasesChrome();
		this.ensureSearchField();
		this.syncHubMapMount();
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
		if (this.stageEl?.isConnected) return;
		const stage = this.root.createDiv('rv-locator-stage');
		this.root.insertBefore(stage, this.scrollEl);
		stage.appendChild(this.scrollEl);
		this.stageEl = stage;
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
		if (!text) return groups;
		this.loadSearchBodies();
		const query = this.queryFor(text);
		return groups
			.map((group) => ({
				label: group.label,
				rows: group.rows.filter((row) => matchesGlanceQuery(this.recordFor(row), query)),
			}))
			.filter((group) => group.rows.length > 0);
	}

	protected paint(): void {
		this.applyDensity();
		const groups = this.sortedGroups();
		groups.forEach((group, groupIndex) => {
			if (group.label) {
				this.scrollEl.createDiv({ cls: 'rv-locator-group-label', text: group.label });
			}
			const grid = this.scrollEl.createDiv('rv-locator-card-grid');
			group.rows.forEach((row, rowIndex) => {
				this.paintCard(grid, row, `${groupIndex}:${rowIndex}:${row.path}`);
			});
		});
		this.applyColumnSnap();
		this.watchLayout();
	}

	/**
	 * Search replaces the pills and the other bar buttons.
	 * Closing it brings that bar back. The field is created once so typing keeps focus.
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

	private paintCard(parent: HTMLElement, row: RowModel, key: string): void {
		const card = parent.createDiv('rv-locator-card');
		card.setAttr('data-rv-path', row.path);
		card.addEventListener('click', (event) => {
			const target = event.target;
			if (target instanceof Element && target.closest('a, button')) return;
			this.plugin.focusMapPin(row.path, true);
		});
		const rank = priorityRank(this.cellNamed(row, 'Priority'));
		const priority = rowPriority(row);
		const urgency = rowUrgency(row, this.plugin.settings, new Date(), this.plugin.snoozeUntilFor(row.path));
		const band = priority != null && priority > 0 ? urgencyBand(urgency) : 0;
		card.setAttr('data-urgency-band', String(band));
		if (priority === 0) card.addClass('is-priority-zero');
		const urgencyColor = urgencyAccentColor(urgency, priority, urgencyColorsFor(this.plugin.settings.urgencyPalette, this.plugin.settings.urgencyCustomColors));
		card.style.setProperty('--rv-urgency-accent', urgencyColor);
		card.style.setProperty('--rv-urgency-ink', urgencyInk(urgencyColor));
		if (rank) card.setAttr('data-priority', rank);
		if (this.lineOn('name')) {
			const name = card.createDiv('rv-locator-card-name');
			name.setAttr('data-line', glancableLineId(0));
			const statusIconEl = name.createSpan('rv-locator-status-icon');
			setIcon(statusIconEl, statusIcon(row.status));
			statusIconEl.setAttr('aria-label', row.status);
			statusIconEl.querySelector('svg')?.removeAttribute('aria-label');
			this.paintCampaignMark(name, row.path);
			const link = name.createEl('a', {
				cls: 'rv-locator-file-link',
				text: cardPersonTitle(row.name, this.plugin.settings.cardTitleNameOnly),
				href: row.path,
				attr: { 'aria-label': row.name },
			});
			this.bindFileLink(link, row.path);
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

		const foot = card.createDiv('rv-locator-card-foot');
		foot.setAttr('data-line', glancableLineId(5));
		if (this.lineOn('met-with')) {
			const metWith = this.cellNamed(row, 'Met With');
			const metText = metWith && metWith.kind !== 'empty' && metWith.text && metWith.text !== '—'
				? metWith.text
				: '';
			this.plainSlot(foot, 'user', metText || '—', metText ? `Met With ${metText}` : 'Met With', !metText);
		}
		const ratio = this.lineOn('visits')
			? (study ? studyRatio(note, this.plugin.settings.studyRatio) : visitRatio(this.cellNamed(row, 'Successful Visits'), this.cellNamed(row, 'Visits')))
			: null;
		const overrideLabel = this.plugin.settings.showCardReturnStatus ? this.plugin.cardOverrideLabel(row.path) : null;
		if (overrideLabel) {
			foot.createSpan({
				cls: 'rv-locator-slot rv-locator-override-label',
				text: overrideLabel,
				attr: { 'aria-label': `Return override ${overrideLabel}` },
			});
		} else if (ratio && !this.plugin.settings.showCardReturnStatus) {
			const ratioEl = foot.createSpan({
				cls: 'rv-locator-slot rv-locator-visits',
				attr: { 'aria-label': ratio.title },
			});
			ratioEl.createSpan({ cls: 'rv-locator-slot-text', text: `# ${ratio.text}` });
		}
		if (!overrideLabel && ratio && this.plugin.settings.showCardReturnStatus) {
			const line = foot.createSpan('rv-locator-return-inline');
			line.createSpan({
				cls: 'rv-locator-return-visits',
				text: `# ${ratio.text}`,
				attr: { 'aria-label': ratio.title },
			});
			line.createSpan({
				cls: 'rv-locator-return-when',
				text: cardReturnLead(new Date(), this.plugin.settings.cardReturnFormat),
			});
			line.createSpan({
				cls: 'rv-locator-return-bucket',
				text: this.plugin.cardReturnBucket(row.path),
			});
		}
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
		const urgencyButton = actions.createEl('button', {
			cls: 'rv-locator-urgency',
			attr: {
				type: 'button',
				'data-band': String(marks.band),
				'aria-label': urgencyTitle(urgency, priority),
			},
		});
		mountUrgencyGlyph(urgencyButton, marks.glyphs);
		urgencyButton.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.plugin.promptUrgencyMenu(row.path, row.name, event);
		});
		if (showRank && rank) {
			const pill = actions.createEl('button', {
				cls: 'rv-locator-priority-pill',
				text: rank,
				attr: {
					type: 'button',
					'aria-label': `Priority ${rank}. Change priority`,
				},
			});
			pill.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.plugin.promptPriority(row.path, row.name);
			});
		}
		if (showMap) this.renderRouteButton(actions, row.path);
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

	private renderRouteButton(parent: HTMLElement, path: string): void {
		const button = parent.createEl('button', {
			cls: 'rv-locator-map-pin',
			attr: { type: 'button', 'aria-label': 'Directions' },
		});
		setIcon(button, 'route');
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.plugin.openRoute(path);
		});
	}

	private syncHubMap(): void {
		const map = this.hubMapEl;
		const open = this.plugin.hubMapOpen && map != null;
		const full = open && this.plugin.hubMapIsFullscreen();
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
				this.hubMapRatio = Math.min(0.72, Math.max(0.18, next));
				this.syncHubMap();
			};
			const stop = (): void => {
				handle.ownerDocument.removeEventListener('pointermove', move);
				handle.ownerDocument.removeEventListener('pointerup', stop);
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
		this.root.style.setProperty('--rv-control-size', `calc(28px * ${fitted})`);
		this.root.style.setProperty(
			'--rv-line-max',
			settings.glancableMaxLineChars > 0 ? `${settings.glancableMaxLineChars}ch` : '100%',
		);
	}

	private applyColumnSnap(): void {
		const fit = this.plugin.settings.glancableFitCount;
		const columns = fit >= 2 ? fit : glancableColumns(this.scrollEl.clientWidth, this.plugin.settings);
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
	private syncBasesChrome(): void {
		const host = basesChromeHost(this.root);
		if (this.chromeHost && this.chromeHost !== host) this.clearBasesChrome();
		this.chromeHost = host;
		if (!host) return;
		host.classList.add('rv-glancable-host');
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
 * viewBox-only svg inside this flex button can resolve to 0×0. Filled marks
 * set fill to currentColor inline so an app or theme rule of
 * `svg { fill: none }` (the map pin is a stroke icon) cannot blank the bars.
 * Band 0's inner ring stays a stroke.
 */
export function mountUrgencyGlyph(host: HTMLElement, glyphs: string): void {
	const shapes = urgencyBangShapes(glyphs);
	if (shapes.length === 0) return;
	const svg = makeSvg(host, 'svg', {
		viewBox: '0 0 28 28',
		width: '28',
		height: '28',
		fill: 'currentColor',
		'aria-hidden': 'true',
		focusable: 'false',
	}, 'rv-urgency-glyph');
	svg.style.display = 'block';
	svg.style.flex = '0 0 auto';
	svg.style.width = 'calc(var(--rv-control-size, 28px) * 0.7)';
	svg.style.height = 'calc(var(--rv-control-size, 28px) * 0.7)';
	svg.style.overflow = 'visible';
	svg.style.color = 'inherit';
	svg.style.setProperty('fill', 'currentColor');
	for (const shape of shapes) {
		const node = makeSvg(svg, shape.kind, shape.attr);
		if (shape.attr.fill === 'none') {
			node.style.setProperty('fill', 'none');
			node.style.setProperty('stroke', 'currentColor');
			node.style.setProperty('stroke-width', 'calc(var(--rv-control-size, 28px) * 0.08)');
		} else {
			node.style.setProperty('fill', 'currentColor');
		}
	}
}

function makeSvg(parent: Element, tag: 'svg' | 'rect' | 'circle', attr: Record<string, string>, cls?: string): SVGElement {
	const creator = parent as Element & {
		createSvg?: (name: 'svg' | 'rect' | 'circle', info?: { cls?: string; attr?: Record<string, string> }) => SVGElement;
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
