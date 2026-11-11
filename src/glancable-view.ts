import { Platform, setIcon, type QueryController } from 'obsidian';
import { armIconTooltip } from './title-fit';
import { embedCapCss, hubEmbedCapPx, hubLandingReady, hubUsesStackedMap, landingScrollExact, mapPanePx, placeGlanceStage, revealHubCard, shadeHubCard, stackedEmbedCap, viewportHeightPx } from './hub-layout';
import { CARD_BLANK_IGNORE, cardBlankOpensPin } from './map-pins';
import type { NearbyScope } from './active-layout';
import { GLANCABLE_VIEW_TYPE, NON_AFFILIATION_NOTICE } from './constants';
import { domInstanceOf } from './dom';
import { compactBadgePx, elementScrollbarGutterPx, fittedFontScale, glanceSnapToken, glancableCardColumns, glancableCardWidthPx, type CompactLineKind } from './glancable-density';
import { CHROME_PIECES, chromeControlHint, classifyChromeControl, type ChromePiece } from './glancable-chrome';
import type { CellModel, ColumnModel, GroupModel, RowModel } from './model';
import type RVLocatorPlugin from './main';
import { glancableLineId } from './glancable-lines';
import { rememberGlanceGroups } from './glance-hold';
import { HUB_ARRIVAL_CHEAP, HUB_FIRST_PAINT } from './hub-open';
import { hostIsHidden, isHubSwapFile, markHubFill } from './hub-cover';
import { copyShellBand, ensureMapSpacer, markShellSide, sizeMapSpacer } from './map-shell';
import { cardPaintKey } from './hub-cache';
import { NearbyBasesView } from './nearby-view';
import { displayedUrgency, rowPriority, rowSpokeDays } from './row-score';
import { badgeLineOpticalKey, urgencyOpticalKey } from './badge-glyph';
import { urgencyAccentColor, urgencyBand, urgencyBangShapes, urgencyMark } from './scoring';
import { paintUrgencyInk } from './color-math';
import { urgencyColorsFor } from './urgency-palette';
import { cardPersonTitle } from './note-name';
import { cardReturnLead } from './schedule';
import { SNOOZE_SLATE, snoozeCardCaption } from './snooze';
import { calendarDaysSince, formatGlanceableCounter } from './dates';
import { readProperty } from './frontmatter';
import { matchesHubSearch, type HubSearchFields } from './glance-search';
import { formatStudyFraction } from './catalog';
import { resolveStatus, sanitizeGender, statusIcon } from './status';
import { ageCaption, ageYears, appendPersonMeta } from './person-meta';
import { paintGlanceFoot } from './glance-foot';
import type { GlancableChromeFlags, GlancableLineId } from './types';

export class NearbyGlancableView extends NearbyBasesView {
	readonly type: string;
	private layoutObserver: ResizeObserver | null = null;
	private chromeHost: HTMLElement | null = null;
	private glanceQuery = '';
	private searchInput: HTMLInputElement | null = null;
	private stageEl: HTMLElement | null = null;
	private hubMapEl: HTMLElement | null = null;
	private hubMapHandle: HTMLElement | null = null;
	private hubMapApi: { destroy(): void; applyRenderedOrder(paths: readonly string[]): void; invalidateSize(): void } | null = null;
	private renderedPaths: readonly string[] | null = null;
	private stackedLayout = false;
	private glanceFrame = 0;
	private fillToken = 0;
	private fillIdle = 0;
	private fillTimer: ReturnType<typeof setTimeout> | number = 0;
	private fillEpoch = 0;
	private leftHub = false;
	private sawNote = false;
	private searchOpen = false;
	private hubScrollerStop: (() => void) | null = null;
	private hubFullscreenStop: (() => void) | null = null;
	private hubFillNodes: HTMLElement[] = [];
	private hiddenWatch: MutationObserver | null = null;
	private dropSearch: (() => void) | null = null;

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
		this.register(this.plugin.watchMapSplit(() => { this.syncHubMap(); }));
		this.register(this.plugin.registerGlanceWidth(() => this.listCardWidth()));
		this.register(this.plugin.registerGlanceLayout(() => {
			this.rememberScrollbar();
			const width = this.root.clientWidth || this.root.parentElement?.clientWidth || 0;
			return width > 1 ? width : 0;
		}, this.root));
		this.stackedLayout = this.readStacked();
		this.root.toggleClass('is-stacked', this.stackedLayout);
		this.markAppLeaf();
		const dropLanding = this.plugin.registerHubLander?.(() => this.landArrival());
		if (dropLanding) this.register(dropLanding);
		if (!parentEl.closest('.rv-hub-swap-cover')) {
			const adopt = this.plugin.registerLiveHub?.((el, api) => {
				if (hostIsHidden(this.root)) return;
				this.adoptHubMap(el, api);
			});
			if (adopt) this.register(adopt);
		}
		const stopSearch = this.plugin.registerHubSearch?.(this.root, () => {
			if (this.root.closest('.rv-hub-swap-cover') || hostIsHidden(this.root)) return false;
			this.openGlanceSearch();
			return true;
		});
		this.dropSearch = typeof stopSearch === 'function' ? stopSearch : null;
		if (this.dropSearch) this.register(this.dropSearch);
		const pause = this.plugin.registerHubQuiesce?.(() => this.cancelScheduledFill());
		if (typeof pause === 'function') this.register(pause);
		const leave = this.plugin.registerHubLeave?.(() => this.leaveSurface());
		if (typeof leave === 'function') this.register(leave);
		const refit = this.plugin.registerEmbedRefit?.(() => this.sizeEmbedFrame());
		if (typeof refit === 'function') this.register(refit);
		// A markdown file builds both reading and live-preview modes. The hidden
		// mode's embed is 0×0. Painting cards there is the cheap ghost that still
		// delays the real hub. Paint when that mode is actually shown.
		// This view's own cards are appended here, before the constructor
		// returns and before any await.
		this.onOpen();
	}

	/**
	 * Synchronous open. The first visible cards of this view's own model are
	 * in the scroller before the call returns. Nothing here awaits or yields.
	 */
	onOpen(): void {
		if (hostIsHidden(this.root)) {
			this.deferUntilShown();
			return;
		}
		if (this.scrollEl?.querySelector('.rv-locator-card')) return;
		this.adoptHeldGlance();
	}

	override onunload(): void {
		this.dropSearch?.();
		this.dropSearch = null;
		this.cancelScheduledFill();
		this.stageEl?.querySelector(':scope > .rv-map-spacer')?.remove();
		this.root.querySelector(':scope > .rv-map-spacer')?.remove();
		this.hubMapEl = null;
		this.hubMapHandle = null;
		this.root.ownerDocument.body.classList.remove('rv-hide-backlinks');
		this.clearBasesChrome();
		super.onunload();
	}

	/**
	 * The hidden markdown mode stays in the leaf. Watch its style until Obsidian
	 * shows it, then paint once. A timer would keep waking a mode the user never opens.
	 */
	private deferUntilShown(): void {
		if (this.leftHub || this.hiddenWatch) return;
		const mode = this.root.closest('.markdown-source-view, .markdown-reading-view, .markdown-preview-view');
		const target = mode instanceof HTMLElement ? mode : this.root.parentElement;
		if (!target) return;
		const observer = new MutationObserver(() => {
			if (!this.hubReturned()) {
				if (this.root?.isConnected) this.root.setAttribute('hidden', '');
				return;
			}
			this.root.removeAttribute('hidden');
			if (hostIsHidden(this.root)) return;
			observer.disconnect();
			this.hiddenWatch = null;
			this.resumeAfterShow();
		});
		this.hiddenWatch = observer;
		observer.observe(target, { attributes: true, attributeFilter: ['style', 'class'] });
		const leaf = this.root.closest('.workspace-leaf-content');
		if (leaf instanceof HTMLElement && leaf !== target) {
			observer.observe(leaf, { attributes: true, attributeFilter: ['style', 'class'] });
		}
		this.register(() => {
			observer.disconnect();
			if (this.hiddenWatch === observer) this.hiddenWatch = null;
		});
	}

	protected override afterRender(): void {
		this.syncBasesChrome();
		this.ensureSearchField();
		this.syncHubMapMount();
		if (!this.root.closest('.rv-hub-swap-cover') && !hostIsHidden(this.root) && this.plugin.takeHubSearch?.()) {
			this.openGlanceSearch();
		}
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
		const body = this.root.ownerDocument?.body;
		const phone = Boolean(Platform.isMobile || Platform.isMobileApp)
			|| body?.classList.contains('is-phone') === true
			|| body?.classList.contains('is-mobile') === true;
		const width = this.root.clientWidth || this.root.parentElement?.clientWidth || 0;
		const frame = this.root.ownerDocument?.defaultView?.innerWidth ?? 0;
		const stacked = hubUsesStackedMap(phone, width, this.plugin.hubPaneNarrow, frame);
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
		if (hostIsHidden(this.root)) return;
		this.ensureHubFullscreenSync();
		this.ensureStage();
		const stage = this.stageEl ?? this.root;
		const shell = this.plugin.ensureMapShell();
		const side = !this.stackedLayout && !this.plugin.hubMapIsFullscreen();
		const pane = this.root.closest('.workspace-leaf-content')
			?? this.root.closest('.workspace-leaf')
			?? this.root;
		const band = this.plugin.sharedMapBand(mapPanePx(pane instanceof HTMLElement ? pane : this.root, side));
		const fullscreen = this.plugin.hubMapIsFullscreen();
		const spacerHost = !side && !fullscreen ? this.root : stage;
		const other = spacerHost === this.root ? this.stageEl : this.root;
		other?.querySelector(':scope > .rv-map-spacer')?.remove();
		const spacer = spacerHost === stage ? ensureMapSpacer(stage) : ensureMapSpacer(this.root);
		if (spacerHost === this.root && this.sortEl?.parentElement === this.root) this.root.insertBefore(spacer, this.sortEl);
		sizeMapSpacer(spacer, band, side, fullscreen);
		copyShellBand(this.root, band);
		markShellSide(shell.root, side);
		this.hubMapEl = shell.map;
		this.hubMapHandle = shell.grip;
		this.hubMapApi = shell.handle;
		this.deferPaintedOrder(shell.map);
		this.plugin.followMapShell();
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
		this.stageEl?.querySelector(':scope > .rv-map-spacer')?.remove();
		this.root.querySelector(':scope > .rv-map-spacer')?.remove();
		this.hubMapEl = null;
		this.hubMapHandle = null;
		if (!this.plugin.hubMapOpen && !this.plugin.noteMapOpen) {
			this.hubMapApi = null;
			this.plugin.releaseMapShell();
		}
	}

	/**
	 * A map that already has tiles keeps that frame on the open path.
	 * Reordering pins waits one frame so hub open does not paint the map twice.
	 */
	private deferPaintedOrder(_map: HTMLElement): void {
		const paths = this.renderedPaths;
		if (!paths || !this.hubMapApi) return;
		this.publishPinOrder(paths);
	}

	/** The leaf that owns this hub or bases view hides its Obsidian header buttons. */
	private markAppLeaf(): void {
		const leaf = typeof this.root.closest === 'function' ? this.root.closest('.workspace-leaf-content') : null;
		if (leaf instanceof HTMLElement) leaf.classList.add('is-rv-app');
	}

	/** The cover is handing this view the map it already painted. */
	private adoptHubMap(_el: HTMLElement, api: { destroy(): void; applyRenderedOrder(paths: readonly string[]): void; invalidateSize(): void } | null): void {
		if (hostIsHidden(this.root) || this.root.closest('.rv-hub-swap-cover')) return;
		const shell = this.plugin.ensureMapShell();
		this.hubMapEl = shell.map;
		this.hubMapHandle = shell.grip;
		if (api) this.hubMapApi = api;
		this.syncHubMap();
		api?.invalidateSize();
	}

	protected override sortedGroups() {
		return this.filterGlanceGroups(super.sortedGroups());
	}

	/** Current search and snooze filter, keeping the ranked order. */
	private filterGlanceGroups(groups: readonly GroupModel[]): GroupModel[] {
		const text = this.glanceQuery.trim();
		return groups
			.map((group) => ({
				label: group.label,
				rows: group.rows.filter((row) => {
					if (!this.plugin.passesSnoozeFilter(row.path)) return false;
					if (!text) return true;
					return matchesHubSearch(this.hubFields(row), text);
				}),
			}))
			.filter((group) => group.rows.length > 0);
	}

	protected override glanceMemoryKey(): string {
		const read = this.plugin.glanceSurfacePath;
		if (typeof read !== 'function') return '';
		const path = read.call(this.plugin, this.root);
		return typeof path === 'string' ? path : '';
	}

	protected override renderBody(): void {
		if (!this.hubReturned()) {
			if (this.root?.isConnected) this.root.setAttribute('hidden', '');
			return;
		}
		this.root.removeAttribute('hidden');
		this.cancelScheduledFill();
		if (hostIsHidden(this.root)) {
			this.deferUntilShown();
			return;
		}
		super.renderBody();
		if (this.totalRows() === 0 && this.glanceCards().length === 0) this.publishPinOrder([]);
	}

	/** A hidden mode was shown. A list we hid for a note stays hidden. */
	protected override resumeAfterShow(): void {
		if (!this.hubReturned()) {
			if (this.root?.isConnected) this.root.setAttribute('hidden', '');
			return;
		}
		this.root.removeAttribute('hidden');
		super.resumeAfterShow();
	}

	/**
	 * A note open hid this list. Stay hidden until the leaf has shown a note
	 * and is a hub again. A brand-new view has not left, so it paints.
	 */
	private hubReturned(): boolean {
		if (!this.leftHub) return true;
		if (this.hostingNote()) {
			this.sawNote = true;
			return false;
		}
		if (!this.sawNote) return false;
		this.leftHub = false;
		this.sawNote = false;
		return true;
	}

	/** The leaf's file is an ordinary note, not the hub and not a base. */
	private hostingNote(): boolean {
		const read = this.plugin.glanceSurfacePath;
		if (typeof read !== 'function') return false;
		let path = '';
		try { path = read.call(this.plugin, this.root); } catch { return false; }
		if (typeof path !== 'string' || path.length === 0) return false;
		const vault = this.plugin.app?.vault as { getFileByPath?: (next: string) => { extension?: string } | null } | undefined;
		const file = vault?.getFileByPath?.(path) ?? null;
		const extension = typeof file?.extension === 'string' ? file.extension : path.split('.').pop() ?? '';
		const front = this.plugin.noteFrontmatter;
		const fm = typeof front === 'function' ? front.call(this.plugin, path) : null;
		return !isHubSwapFile(extension, fm as Record<string, unknown> | null);
	}

	/** Cancel the idle fill and hide the list. The nodes stay until Obsidian detaches them. */
	private leaveSurface(): void {
		this.leftHub = true;
		this.cancelScheduledFill();
		if (this.root?.isConnected) this.root.setAttribute('hidden', '');
		this.clearHubFill();
	}

	private cancelScheduledFill(): void {
		this.fillToken += 1;
		const view = this.root?.ownerDocument?.defaultView as (Window & {
			cancelIdleCallback?: (id: number) => void;
		}) | null;
		if (this.fillIdle) {
			view?.cancelIdleCallback?.(this.fillIdle);
			this.fillIdle = 0;
		}
		if (this.fillTimer) {
			const clear = view?.clearTimeout ?? clearTimeout;
			clear(this.fillTimer as never);
			this.fillTimer = 0;
		}
	}

	/**
	 * This view's own model, painted here. The open turn appends the visible
	 * slice only. Another view's list is never moved in.
	 */
	protected override adoptHeldGlance(): void {
		if (hostIsHidden(this.root)) {
			this.deferUntilShown();
			return;
		}
		if (!this.loadCachedModel(this.glanceMemoryKey())) {
			if (!this.glanceDataSeen) this.root.addClass('is-glance-pending');
			return;
		}
		this.paintFirstCards();
	}

	/** Title, urgency color, and the foot. Decorations and the rest of the list wait. */
	private paintFirstCards(): void {
		this.openChrome();
		const rows = this.openingRows();
		if (rows.length === 0) {
			if (!this.glanceDataSeen) this.root.addClass('is-glance-pending');
			return;
		}
		const grid = this.ensureCardGrid();
		const count = this.arrivalPaintCount(rows);
		const opening = rows.slice(0, count);
		if (this.plugin.peekHubArrival?.()) {
			for (const row of opening) this.paintCard(grid, row, `open:${row.path}`);
		} else {
			for (const row of opening) this.paintStubCard(grid, row);
		}
		this.root.removeClass('is-glance-pending');
		this.publishPinOrder(rows.map((row) => row.path));
		this.syncHubMapMount();
		if (this.directHubOpensAtTop() && this.scrollEl) this.scrollEl.scrollTop = 0;
		this.landArrival();
		if (typeof this.root.closest === 'function' && this.root.closest('.rv-hub-swap-cover')) this.watchLayout();
		this.scheduleCardFill(rows);
	}

	/**
	 * Cached rank order, then this view's search and snooze filter.
	 * The sort itself is not run here.
	 */
	private openingRows(): RowModel[] {
		const text = this.glanceQuery.trim();
		const rows: RowModel[] = [];
		for (const group of this.groups) {
			for (const row of group.rows) {
				if (!this.plugin.passesSnoozeFilter(row.path)) continue;
				if (text && !matchesHubSearch(this.hubFields(row), text)) continue;
				rows.push(row);
			}
		}
		return rows;
	}

	private paintStubCard(parent: HTMLElement, row: RowModel): void {
		const card = parent.createDiv('rv-locator-card is-stub');
		card.setAttr('data-rv-path', row.path);
		const live = this.liveRank(row);
		const priority = live.priority;
		const band = priority != null && priority > 0 ? urgencyBand(live.urgency) : 0;
		card.setAttr('data-urgency-band', String(band));
		if (priority === 0) card.addClass('is-priority-zero');
		const urgencyColor = urgencyAccentColor(live.urgency, priority, urgencyColorsFor(this.plugin.settings.urgencyPalette, this.plugin.settings.urgencyCustomColors));
		card.style.setProperty('--rv-urgency-accent', urgencyColor);
		const name = card.createDiv('rv-locator-card-name');
		const link = name.createEl('a', {
			cls: 'rv-locator-file-link',
			text: cardPersonTitle(row.name, true),
			href: row.path,
			attr: { 'aria-label': row.name },
		});
		this.bindFileLink(link, row.path);
		const foot = card.createDiv('rv-locator-card-foot rv-foot-line');
		const bucket = this.plugin.cardReturnBucket(row.path);
		const daypart = cardReturnLead(new Date(), this.plugin.settings.cardReturnFormat);
		foot.createSpan({ cls: 'rv-locator-return-bucket', text: bucket || daypart || 'Return' });
	}

	/** One slice stays under a frame. Stubs are replaced, then missing cards go in at their sorted index. */
	private scheduleCardFill(rows: readonly RowModel[]): void {
		const token = ++this.fillToken;
		const epoch = typeof this.plugin.hubWorkEpoch === 'number' ? this.plugin.hubWorkEpoch : 0;
		this.fillEpoch = epoch;
		const refreshed = new Set<string>();
		const step = (): void => {
			const liveEpoch = typeof this.plugin.hubWorkEpoch === 'number' ? this.plugin.hubWorkEpoch : 0;
			if (token !== this.fillToken || liveEpoch !== this.fillEpoch || this.leftHub) return;
			if (!this.root?.isConnected || !this.scrollEl?.isConnected) return;
			if (hostIsHidden(this.root) || this.root.hasAttribute('hidden')) return;
			const start = performance.now();
			const host = this.ensureCardGrid();
			const stub = host.querySelector('.rv-locator-card.is-stub');
			const stale = stub instanceof HTMLElement ? null : this.staleCard(host, rows, refreshed);
			let pending = false;
			if (stub instanceof HTMLElement) {
				const path = stub.getAttribute('data-rv-path') ?? '';
				const row = rows.find((item) => item.path === path);
				if (row) this.replaceStub(stub, row);
				else stub.classList.remove('is-stub');
				pending = true;
			} else if (stale) {
				refreshed.add(stale.row.path);
				this.replaceStub(stale.card, stale.row);
				pending = true;
			} else {
				const missing = this.missingRow(host, rows);
				if (missing) {
					this.placeCard(host, missing, rows);
					pending = true;
				}
			}
			const elapsed = performance.now() - start;
			const sink = (globalThis as { __rvOpenSlice?: (ms: number) => void }).__rvOpenSlice;
			sink?.(elapsed);
			if (this.plugin.peekHubArrival?.()) this.landArrival();
			if (pending) {
				this.scheduleSlice(step);
				return;
			}
			this.publishPinOrder(rows.map((row) => row.path));
			this.scheduleGlanceFrame();
			this.landArrival();
		};
		this.scheduleSlice(step);
	}

	private staleCard(host: HTMLElement, rows: readonly RowModel[], skip: ReadonlySet<string>): { card: HTMLElement; row: RowModel } | null {
		for (const row of rows) {
			if (skip.has(row.path)) continue;
			const card = host.querySelector(`[data-rv-path="${row.path.replace(/"/g, '')}"]`);
			if (!(card instanceof HTMLElement) || card.classList.contains('is-stub')) continue;
			if (card.getAttribute('data-rv-paint') !== this.paintSignature(row)) return { card, row };
		}
		return null;
	}

	private missingRow(host: HTMLElement, rows: readonly RowModel[]): RowModel | null {
		const placed = new Set<string>();
		host.querySelectorAll('.rv-locator-card').forEach((node) => {
			if (!(node instanceof HTMLElement)) return;
			const path = node.getAttribute('data-rv-path') ?? '';
			if (path) placed.add(path);
		});
		return rows.find((row) => !placed.has(row.path)) ?? null;
	}

	private placeCard(host: HTMLElement, row: RowModel, rows: readonly RowModel[]): void {
		const holder = host.ownerDocument.createElement('div');
		const index = rows.indexOf(row);
		this.paintCard(holder, row, `0:${index}:${row.path}`);
		const fresh = holder.firstElementChild;
		if (!(fresh instanceof HTMLElement)) return;
		const order = new Map(rows.map((item, at) => [item.path, at]));
		const at = order.get(row.path) ?? rows.length;
		let cursor: ChildNode | null = null;
		for (const child of Array.from(host.children)) {
			if (!(child instanceof HTMLElement) || !child.classList.contains('rv-locator-card')) continue;
			const path = child.getAttribute('data-rv-path') ?? '';
			if ((order.get(path) ?? -1) > at) {
				cursor = child;
				break;
			}
		}
		host.insertBefore(fresh, cursor);
	}

	private replaceStub(stub: HTMLElement, row: RowModel): void {
		const holder = stub.ownerDocument.createElement('div');
		this.paintCard(holder, row, `0:${row.path}`);
		const fresh = holder.firstElementChild;
		if (fresh instanceof HTMLElement) {
			this.carryCardLand(stub, fresh);
			stub.replaceWith(fresh);
		} else stub.classList.remove('is-stub');
	}

	/** How many cards an open paints before the first yield. An arrival includes its card. */
	private arrivalPaintCount(rows: readonly RowModel[]): number {
		const path = this.plugin.peekHubArrival?.() ?? '';
		if (!path) return HUB_FIRST_PAINT;
		const index = rows.findIndex((row) => row.path === path);
		if (index < 0) return HUB_FIRST_PAINT;
		if (rows.length <= HUB_ARRIVAL_CHEAP) return rows.length;
		return Math.max(HUB_FIRST_PAINT, index + 1);
	}

	/** The shade is on the card, not on one DOM node. A stub swap keeps it. */
	private carryCardLand(from: HTMLElement, to: HTMLElement): void {
		if (!from.classList.contains('rv-card-land')) return;
		to.classList.add('rv-card-land');
		if (from.dataset.rvLandAt) to.dataset.rvLandAt = from.dataset.rvLandAt;
		const delay = from.style.getPropertyValue('--rv-land-delay');
		if (delay) to.style.setProperty('--rv-land-delay', delay);
		shadeHubCard(to);
	}

	private scheduleSlice(run: () => void): void {
		const view = this.root.ownerDocument?.defaultView as (Window & {
			requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
			cancelIdleCallback?: (id: number) => void;
		}) | null;
		if (this.fillIdle && view?.cancelIdleCallback) {
			view.cancelIdleCallback(this.fillIdle);
			this.fillIdle = 0;
		}
		if (this.fillTimer) {
			(view?.clearTimeout ?? clearTimeout)(this.fillTimer as never);
			this.fillTimer = 0;
		}
		if (view && typeof view.requestIdleCallback === 'function') {
			this.fillIdle = view.requestIdleCallback(() => {
				this.fillIdle = 0;
				run();
			}, { timeout: 48 });
			return;
		}
		const timer = view?.setTimeout ?? setTimeout;
		this.fillTimer = timer(() => {
			this.fillTimer = 0;
			run();
		}, 0);
	}

	/** Cards are in the live scroller. Measuring and pin rings wait for the next frame. */
	protected override afterListSwap(): void {
		this.watchLayout();
		this.scheduleGlanceFrame();
		this.landArrival();
	}

	/**
	 * Keep each card node when its paint key still matches. A Bases delivery
	 * that paints the same list must not empty the scroller or move scroll.
	 */
	protected override fillScroll(): void {
		this.refreshHubCacheGroups();
		const ranked = this.rankedGroups();
		rememberGlanceGroups(ranked, this.columns, this.glanceMemoryKey());
		const groups = this.filterGlanceGroups(ranked);
		const rows = groups.flatMap((group) => group.rows);
		const labeled = groups.some((group) => group.label);
		const cards = this.glanceCards();
		if (rows.length === 0 && cards.length > 0 && !this.glanceDataSeen) return;
		if (labeled || rows.length === 0) {
			super.fillScroll();
			return;
		}
		if (this.cardsMatch(cards, rows)) {
			this.root.removeClass('is-glance-pending');
			if (!this.scrollEl.querySelector('.rv-locator-list-disclaimer')) this.paintListTail();
			this.applyDensity();
			this.publishPinOrder(rows.map((row) => row.path));
			this.afterListSwap();
			return;
		}
		// Painting every card whose snooze or score changed is the long task
		// on hub→base (about 195ms for a full list). The first screen is
		// synchronous. The rest is one card per idle slice, and leaving cancels it.
		if (cards.length === 0 || this.staleCardCount(cards, rows) > HUB_FIRST_PAINT) {
			this.dropCardsOutside(rows);
			this.orderExistingCards(rows);
			const count = this.arrivalPaintCount(rows);
			if (this.glanceCards().length === 0) this.patchGlanceCards(rows.slice(0, count), false);
			this.root.removeClass('is-glance-pending');
			if (!this.scrollEl.querySelector('.rv-locator-list-disclaimer')) this.paintListTail();
			this.applyDensity();
			this.publishPinOrder(rows.map((row) => row.path));
			if (this.plugin.peekHubArrival?.()) this.landArrival();
			if (count < rows.length) this.scheduleCardFill(rows);
			else this.afterListSwap();
			return;
		}
		const atTop = this.directHubOpensAtTop();
		const top = atTop ? 0 : this.scrollEl.scrollTop;
		const left = this.scrollEl.scrollLeft;
		this.patchGlanceCards(rows);
		this.root.removeClass('is-glance-pending');
		if (!this.scrollEl.querySelector('.rv-locator-list-disclaimer')) this.paintListTail();
		this.applyDensity();
		this.publishPinOrder(rows.map((row) => row.path));
		if (atTop || this.directHubOpensAtTop()) this.scrollEl.scrollTop = 0;
		else if (this.scrollEl.scrollTop !== top) this.scrollEl.scrollTop = top;
		if (this.scrollEl.scrollLeft !== left) this.scrollEl.scrollLeft = left;
		this.afterListSwap();
	}

	/** Column snap and badge rings read layout. They run after the card frame, not inside it. */
	private scheduleGlanceFrame(): void {
		const frame = ++this.glanceFrame;
		const run = (): void => {
			if (frame !== this.glanceFrame || !this.scrollEl?.isConnected) return;
			this.watchLayout();
			this.settleGlanceLayout();
			this.strokeHubRings();
			this.sizeEmbedFrame();
		};
		const view = this.root.ownerDocument?.defaultView;
		if (view && typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(run);
		else run();
	}

	/** Cards are in the document. A stroke measured in the fragment is not kept. */
	private strokeHubRings(): void {
		this.dropDuplicateCards();
		if (!this.scrollEl) return;
		rememberPaintedStroke(this.scrollEl);
		pinBadgeRings(this.scrollEl);
	}

	/**
	 * One card per path. A second grid (the cover snapshot left in the scroller,
	 * or a hidden markdown mode that became visible) paints the same card again,
	 * about a 6px gap below the first.
	 */
	private dropDuplicateCards(): void {
		const scroll = this.scrollEl;
		if (!scroll || typeof scroll.querySelectorAll !== 'function') return;
		const seen = new Set<string>();
		scroll.querySelectorAll('.rv-locator-card').forEach((node) => {
			if (!(node instanceof HTMLElement)) return;
			const path = node.getAttribute('data-rv-path') ?? '';
			if (!path) return;
			if (seen.has(path)) node.remove();
			else seen.add(path);
		});
	}

	/** A Quick Switcher open of the hub starts at the top. A return does not. */
	private directHubOpensAtTop(): boolean {
		if (this.root.closest('.rv-hub-swap-cover')) return false;
		if (hostIsHidden(this.root)) return false;
		return this.plugin.hubOpensAtTop() && !this.plugin.peekHubArrival();
	}

	/** Hub link from an RV: scroll to that card and tint it, then let the tint fade. */
	private landArrival(): void {
		if (hostIsHidden(this.root)) return;
		if (this.directHubOpensAtTop() && this.scrollEl) this.scrollEl.scrollTop = 0;
		const path = this.plugin.peekHubArrival();
		if (!path || !this.scrollEl) return;
		const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(path) : path.replace(/"/g, '');
		let card = this.scrollEl.querySelector(`[data-rv-path="${escaped}"]`);
		if (!(card instanceof HTMLElement)) {
			this.paintThroughArrival(path);
			card = this.scrollEl.querySelector(`[data-rv-path="${escaped}"]`);
		}
		if (!(card instanceof HTMLElement)) return;
		const scrolled = card.closest('.rv-locator-scroll');
		const scroller = scrolled instanceof HTMLElement ? scrolled : this.scrollEl;
		if (scroller.clientHeight <= 1) {
			shadeHubCard(card);
			return;
		}
		const swap = this.root.ownerDocument.querySelector('.rv-hub-swap-cover');
		const inCover = Boolean(this.root.closest('.rv-hub-swap-cover'));
		if (!inCover && swap instanceof HTMLElement) {
			const coverCard = swap.querySelector(`[data-rv-path="${escaped}"]`);
			if (coverCard instanceof HTMLElement) {
				const desired = coverCard.getBoundingClientRect().top;
				const plan = landingScrollExact(scroller, card, desired);
				if (!plan.reaches) {
					shadeHubCard(card);
					return;
				}
				scroller.scrollTop = plan.scroll;
			} else {
				revealHubCard(this.scrollEl, card);
			}
		} else if (!inCover) {
			const max = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
			const cardRect = card.getBoundingClientRect();
			const box = scroller.getBoundingClientRect();
			const outside = cardRect.height > 0 && (cardRect.top < box.top - 2 || cardRect.bottom > box.bottom + 2);
			if (outside && max <= 0.5) {
				shadeHubCard(card);
				return;
			}
			revealHubCard(this.scrollEl, card);
		} else {
			revealHubCard(this.scrollEl, card);
		}
		shadeHubCard(card);
		const cover = this.root.closest('.rv-hub-swap-cover');
		if (card.classList.contains('is-stub')) return;
		if (!cover && !hubLandingReady(scroller, card)) return;
		if (!cover) this.plugin.takeHubArrival();
	}

	/** Cards up to the return target, in this turn, so the shade does not wait on idle slices. */
	private paintThroughArrival(path: string): void {
		const rows = this.openingRows();
		const index = rows.findIndex((row) => row.path === path);
		if (index < 0) return;
		const host = this.ensureCardGrid();
		const through = rows.slice(0, this.arrivalPaintCount(rows));
		for (const row of through) {
			const selector = `[data-rv-path="${row.path.replace(/"/g, '')}"]`;
			const existing = host.querySelector(selector);
			if (existing instanceof HTMLElement && !existing.classList.contains('is-stub')) continue;
			if (existing instanceof HTMLElement) this.replaceStub(existing, row);
			else this.placeCard(host, row, rows);
		}
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
	}

	/** Rank on the map follows this exact card order, after sort, filters, and search. */
	private publishPinOrder(paths: readonly string[]): void {
		this.renderedPaths = paths;
		if (!this.hubMapApi) return;
		this.plugin.deferMapPinScan = true;
		this.hubMapApi.applyRenderedOrder(paths);
	}

	/**
	 * Search replaces the toolbar button row.
	 * The field is created once so typing keeps focus.
	 */
	private searchReplacesBar(open: boolean): void {
		this.searchOpen = open;
		this.root.toggleClass('is-search-open', open);
		if (open) {
			this.ensureSearchField();
			if (this.searchSlot) this.plugin.showBarSearch(this.searchSlot);
			return;
		}
		if (this.searchSlot && this.searchSlot.parentElement !== this.sortEl) this.sortEl.appendChild(this.searchSlot);
		this.plugin.closeBarSearch();
		this.clearSearch();
	}

	/** Search replaces the pills. The field is created once so typing keeps focus. */
	private ensureSearchField(): void {
		if (this.searchInput) return;
		const slot = this.searchSlot ?? this.sortEl.createDiv('rv-locator-search-slot');
		this.searchSlot = slot;
		if (slot.parentElement !== this.sortEl) this.sortEl.appendChild(slot);
		const row = slot.createDiv('rv-locator-search rv-suggest-host');
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
			cls: 'rv-suggest-chevron',
			attr: { type: 'button', 'aria-label': 'Clear search' },
		});
		armIconTooltip(clear, 'Close search');
		setIcon(clear, 'x');
		clear.addEventListener('click', () => {
			if (!this.glanceQuery.trim()) {
				this.searchReplacesBar(false);
				return;
			}
			this.glanceQuery = '';
			input.value = '';
			this.renderBody();
			input.focus();
		});
	}

	private clearSearch(): void {
		this.glanceQuery = '';
		if (this.searchInput) this.searchInput.value = '';
		this.renderBody();
	}

	/** Name, Gender, Status, Age, campaign coverage, and snooze. Note body text is not a hub search field. */
	private hubFields(row: RowModel): HubSearchFields {
		const facts = this.noteFrontmatter(row.path);
		const storedAge = ageYears(readProperty(facts, 'Age'));
		const exactAge = ageYears(readProperty(facts, 'Age Exact'));
		const genderRaw = readProperty(facts, 'Gender');
		const statusRaw = readProperty(facts, 'Status');
		const gender = typeof genderRaw === 'string' && genderRaw.trim() ? genderRaw : (row.gender ?? '');
		const status = typeof statusRaw === 'string' && statusRaw.trim() ? statusRaw : (row.status ?? '');
		const mark = this.plugin.campaignMark(row.path);
		return {
			name: row.name,
			gender,
			status,
			age: storedAge ?? exactAge,
			campaign: mark === 'covered' || mark === 'open' ? mark : null,
			snoozed: this.plugin.snoozeActiveFor(row.path) === true,
		};
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
		const live = this.liveRank(row);
		const rank = live.priority != null && live.priority > 0 ? String(live.priority) : null;
		const priority = live.priority;
		const urgency = live.urgency;
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
			setIcon(statusIconEl, statusIcon(live.status));
			statusIconEl.setAttr('aria-label', live.status);
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
			const earth = place.createSpan('rv-locator-place-earth rv-card-earth');
			earth.dataset.rvPath = row.path;
			setIcon(earth, 'earth');
			place.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.plugin.toggleCardEarth(row.path);
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
		card.dataset.rvPaint = this.paintSignature(row);
	}

	private paintSignature(row: RowModel): string {
		const facts = this.noteFrontmatter(row.path);
		const live = this.liveRank(row);
		const until = this.plugin.snoozeUntilFor(row.path);
		const snoozed = this.plugin.snoozeActiveFor(row.path);
		return `${cardPaintKey(row, {
			locationProperty: this.plugin.settings.locationProperty,
			snoozed,
			snoozeUntil: until ? String(until.getTime()) : '',
			snoozeDays: snoozed ? this.plugin.snoozeDaysLeftFor(row.path) : 0,
			campaign: this.plugin.campaignMark(row.path),
			age: ageCaption(readProperty(facts, 'Age'), readProperty(facts, 'Age Exact')),
		})}\u001e${live.priority ?? ''}\u001f${live.status}\u001f${live.urgency ?? ''}`;
	}

	/** Priority, status, and urgency from the pinned note, so a hub card repaints before Bases does. */
	private liveRank(row: RowModel): { priority: number | null; urgency: number | null; status: ReturnType<typeof resolveStatus> } {
		const facts = this.noteFrontmatter(row.path);
		const rawPriority = readProperty(facts, 'Priority');
		const parsed = typeof rawPriority === 'number' ? rawPriority : Number(rawPriority);
		const fromNote = Number.isFinite(parsed) ? Math.round(parsed) : null;
		const priority = fromNote != null && fromNote >= 0 && fromNote <= 5 ? fromNote : rowPriority(row);
		const spokeRaw = readProperty(facts, 'Last Spoke');
		const spoke = spokeRaw instanceof Date ? spokeRaw.toISOString() : typeof spokeRaw === 'string' ? spokeRaw : '';
		const days = spoke ? calendarDaysSince(spoke) : rowSpokeDays(row);
		const status = resolveStatus(readProperty(facts, 'Status') ?? row.status, priority);
		const urgency = displayedUrgency(days, priority, this.plugin.settings, this.plugin.snoozeUntilFor(row.path), new Date());
		return { priority, urgency, status };
	}

	private glanceCards(): HTMLElement[] {
		const grid = this.scrollEl?.querySelector('.rv-locator-card-grid');
		if (!(grid instanceof HTMLElement)) return [];
		return Array.from(grid.children).filter((node): node is HTMLElement => (
			node instanceof HTMLElement && node.classList.contains('rv-locator-card')
		));
	}

	private cardsMatch(cards: readonly HTMLElement[], rows: readonly RowModel[]): boolean {
		if (cards.length !== rows.length) return false;
		return rows.every((row, index) => {
			const card = cards[index];
			return card?.getAttribute('data-rv-path') === row.path
				&& card.getAttribute('data-rv-paint') === this.paintSignature(row);
		});
	}

	private staleCardCount(cards: readonly HTMLElement[], rows: readonly RowModel[]): number {
		return rows.filter((row) => {
			const card = cards.find((node) => node.getAttribute('data-rv-path') === row.path);
			return !card || card.classList.contains('is-stub') || card.getAttribute('data-rv-paint') !== this.paintSignature(row);
		}).length;
	}

	private dropCardsOutside(rows: readonly RowModel[]): void {
		const keep = new Set(rows.map((row) => row.path));
		for (const card of this.glanceCards()) {
			const path = card.getAttribute('data-rv-path') ?? '';
			if (path && !keep.has(path)) card.remove();
		}
	}

	/** Move cards that already exist into the ranked order. No card is rebuilt. */
	private orderExistingCards(rows: readonly RowModel[]): void {
		const grid = this.scrollEl?.querySelector('.rv-locator-card-grid');
		if (!(grid instanceof HTMLElement)) return;
		const pool = new Map<string, HTMLElement>();
		for (const card of Array.from(grid.children)) {
			if (!(card instanceof HTMLElement) || !card.classList.contains('rv-locator-card')) continue;
			const path = card.getAttribute('data-rv-path') ?? '';
			if (path && !pool.has(path)) pool.set(path, card);
		}
		let cursor: ChildNode | null = grid.firstChild;
		for (const row of rows) {
			const existing = pool.get(row.path);
			if (!existing) continue;
			pool.delete(row.path);
			if (cursor !== existing) grid.insertBefore(existing, cursor);
			else cursor = existing.nextSibling;
		}
	}

	private patchGlanceCards(rows: readonly RowModel[], dropTail = true): void {
		this.distanceEls.clear();
		this.distanceRows.clear();
		this.scrollEl.querySelectorAll('.rv-locator-group-label, .rv-locator-empty').forEach((node) => node.remove());
		const grid = this.ensureCardGrid();
		const pool = new Map<string, HTMLElement>();
		for (const card of Array.from(grid.children)) {
			if (!(card instanceof HTMLElement) || !card.classList.contains('rv-locator-card')) continue;
			const path = card.getAttribute('data-rv-path') ?? '';
			if (path && !pool.has(path)) pool.set(path, card);
		}
		let cursor: ChildNode | null = grid.firstChild;
		rows.forEach((row, index) => {
			const signature = this.paintSignature(row);
			const key = `0:${index}:${row.path}`;
			const existing = pool.get(row.path) ?? null;
			if (existing && existing.getAttribute('data-rv-paint') === signature) {
				pool.delete(row.path);
				if (cursor !== existing) grid.insertBefore(existing, cursor);
				else cursor = existing.nextSibling;
				this.rebindDistance(existing, row, key);
				return;
			}
			const holder = grid.ownerDocument.createElement('div');
			this.paintCard(holder, row, key);
			const fresh = holder.firstElementChild;
			if (!(fresh instanceof HTMLElement)) return;
			if (existing) {
				this.carryCardLand(existing, fresh);
				pool.delete(row.path);
				if (cursor === existing) cursor = existing.nextSibling;
				existing.remove();
			}
			grid.insertBefore(fresh, cursor);
		});
		if (dropTail) {
			for (const leftover of pool.values()) leftover.remove();
		}
	}

	private ensureCardGrid(): HTMLElement {
		const found = this.scrollEl.querySelector('.rv-locator-card-grid');
		if (found instanceof HTMLElement) return found;
		const grid = this.scrollEl.createDiv('rv-locator-card-grid');
		const tail = this.scrollEl.querySelector('.rv-locator-list-disclaimer');
		if (tail) this.scrollEl.insertBefore(grid, tail);
		return grid;
	}

	private rebindDistance(card: HTMLElement, row: RowModel, key: string): void {
		const dist = card.querySelector('.rv-locator-distance-lg');
		if (dist instanceof HTMLElement) this.rememberDistance(key, dist, row);
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
		return this.plugin.noteFrontmatter(path);
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
		map?.classList.toggle('is-fullscreen', full);
		this.hubMapHandle?.setAttribute('aria-orientation', this.stackedLayout ? 'horizontal' : 'vertical');
		const pane = this.root.closest('.workspace-leaf-content')
			?? this.root.closest('.workspace-leaf')
			?? this.root;
		const side = this.root.classList.contains('is-side-map');
		const band = this.plugin.sharedMapBand(mapPanePx(pane instanceof HTMLElement ? pane : this.root, side));
		copyShellBand(this.root, band);
		const stage = this.stageEl ?? this.root;
		const fullscreen = this.root.classList.contains('is-map-fullscreen');
		const spacerHost = !side && !fullscreen ? this.root : stage;
		const spacer = spacerHost.querySelector(':scope > .rv-map-spacer');
		if (spacer instanceof HTMLElement) sizeMapSpacer(spacer, band, side, this.root.classList.contains('is-map-fullscreen'));
		const shellRoot = this.plugin.mapShellRoot();
		if (shellRoot) markShellSide(shellRoot, side);
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
		const full = fullBase instanceof HTMLElement;
		if (full) concealRawBaseEmbed(fullBase);
		const release = (): void => {
			embed.classList.remove('is-embed-capped');
			embed.style.removeProperty('--rv-embed-cap');
			embed.style.removeProperty('height');
			embed.style.removeProperty('max-height');
			embed.style.removeProperty('overflow');
			embed.style.removeProperty('transform');
		};
		if (!full && (!this.wideHubFrame() || !this.stackedLayout)) {
			release();
			return;
		}
		const view = this.root.ownerDocument.defaultView;
		const viewport = viewportHeightPx(view);
		const chrome = embedChromePx(this.root.ownerDocument);
		const rect = typeof embed.getBoundingClientRect === 'function' ? embed.getBoundingClientRect() : null;
		const top = rect ? rect.top : 0;
		const pad = full ? markdownPreviewPadPx(embed) : 0;
		const cap = top > 1 || full
			? hubEmbedCapPx(viewport, top, pad)
			: Math.max(160, stackedEmbedCap(viewport, chrome));
		const occupied = top > 1 ? top : (full ? pad : chrome);
		embed.style.setProperty('width', '100%', 'important');
		embed.style.setProperty('transform', 'none', 'important');
		embed.style.setProperty('scrollbar-gutter', 'auto', 'important');
		embed.style.setProperty('overflow', 'hidden', 'important');
		if (embed.dataset.rvCapScroll !== '1') {
			embed.dataset.rvCapScroll = '1';
			const scroller = embed.closest('.markdown-preview-view, .cm-scroller, .view-content');
			scroller?.addEventListener('scroll', () => { this.sizeEmbedFrame(); }, { passive: true });
			view?.requestAnimationFrame?.(() => { this.sizeEmbedFrame(); });
		}
		embed.classList.add('is-embed-capped');
		embed.style.setProperty('--rv-embed-top', `${Math.max(0, Math.round(occupied))}px`);
		embed.style.setProperty('--rv-embed-cap', viewport > 0 ? embedCapCss() : `${cap}px`);
		embed.style.removeProperty('height');
		embed.style.removeProperty('max-height');
	}

	private bindHubHandle(handle: HTMLElement): void {
		if (handle.dataset.rvBound === '1') return;
		handle.dataset.rvBound = '1';
		handle.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const startX = event.clientX;
			const startY = event.clientY;
			const start = this.plugin.mapSplitRatio();
			const box = this.stageEl ?? this.root;
			const height = box.clientHeight || 1;
			const width = box.clientWidth || 1;
			const stacked = this.stackedLayout;
			const move = (ev: PointerEvent): void => {
				const delta = stacked ? (startY - ev.clientY) / height : (startX - ev.clientX) / width;
				this.plugin.rememberMapSplit(start + delta, 'hub');
				this.plugin.sharedMapBand(stacked ? height : width, true);
				this.syncHubMap();
			};
			const stop = (): void => {
				handle.ownerDocument.removeEventListener('pointermove', move);
				handle.ownerDocument.removeEventListener('pointerup', stop);
				if (this.plugin.mapSplitRatio() < 0.08) {
					this.plugin.rememberMapSplit(0.42, 'hub');
					this.plugin.commitMapSplit();
					this.plugin.hideSplitMap();
					return;
				}
				this.plugin.commitMapSplit();
			};
			handle.ownerDocument.addEventListener('pointermove', move);
			handle.ownerDocument.addEventListener('pointerup', stop);
		});
	}

	private flashCard(path: string | null): void {
		this.scrollEl.querySelectorAll('.rv-card-land, .rv-card-flash').forEach((node) => {
			node.classList.remove('rv-card-land', 'rv-card-flash');
		});
		if (!path) return;
		const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(path) : path.replace(/"/g, '');
		const card = this.scrollEl.querySelector(`[data-rv-path="${escaped}"]`);
		if (!(card instanceof HTMLElement)) return;
		revealHubCard(this.scrollEl, card);
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

	/**
	 * Card rows land on whole pixels. Widths are read together, heights are
	 * cleared together, then one layout supplies every card and badge measure
	 * before any height is written back.
	 */
	private snapCardFrames(): void {
		if (!this.scrollEl) return;
		snapEdges(this.scrollEl);
		const cards: HTMLElement[] = [];
		for (const node of Array.from(this.scrollEl.children)) {
			if (!(node instanceof HTMLElement) || !node.classList.contains('rv-locator-card-grid')) continue;
			for (const card of Array.from(node.children)) {
				if (card instanceof HTMLElement && card.classList.contains('rv-locator-card')) cards.push(card);
			}
		}
		if (cards.length === 0) return;
		const token = this.currentSnapToken();
		const widths = cards.map((el) => Math.round(el.getBoundingClientRect().width));
		const pending: HTMLElement[] = [];
		for (let index = 0; index < cards.length; index += 1) {
			const el = cards[index];
			const widthNow = widths[index] ?? 0;
			if (!el || widthNow < 1) continue;
			if (el.dataset.rvSnapWidth === String(widthNow) && el.dataset.rvSnapToken === token && el.style.height) continue;
			el.style.height = '';
			el.style.minHeight = '';
			pending.push(el);
		}
		if (pending.length === 0) return;
		const measured = pending.map((el) => ({
			rect: el.getBoundingClientRect(),
			border: verticalBorder(el),
			stack: badgeStack(el),
		}));
		const snapped: HTMLElement[] = [];
		for (let index = 0; index < pending.length; index += 1) {
			const el = pending[index];
			const read = measured[index];
			if (!el || !read || read.rect.height < 1) continue;
			el.style.height = `${wholeCardHeight(read.rect.height, read.border, read.stack)}px`;
			snapped.push(el);
		}
		const snappedWidths = snapped.map((el) => Math.round(el.getBoundingClientRect().width));
		const rails: HTMLElement[] = [];
		for (let index = 0; index < snapped.length; index += 1) {
			const el = snapped[index];
			if (!el) continue;
			el.dataset.rvSnapWidth = String(snappedWidths[index] ?? 0);
			el.dataset.rvSnapToken = token;
			const rail = el.querySelector(':scope > .rv-locator-card-actions');
			if (rail instanceof HTMLElement) rails.push(rail);
		}
		snapActionRails(rails);
	}

	/** The list scroller's own scrollbar. A hidden scroller is not a measurement, and a side map is not a gutter. */
	private rememberScrollbar(): void {
		if (this.root.classList.contains('is-map-fullscreen')) return;
		if (typeof this.root.closest === 'function' && this.root.closest('.rv-hub-swap-cover')) return;
		const scroll = this.scrollEl;
		if (!scroll || scroll.clientWidth <= 1) return;
		this.plugin.rememberGlanceScrollbar(elementScrollbarGutterPx(scroll));
	}

	/** Cover cards use the live list's gutter once that list has a box. */
	private measureGutter(): number {
		const own = elementScrollbarGutterPx(this.scrollEl);
		if (typeof this.root.closest !== 'function' || !this.root.closest('.rv-hub-swap-cover')) return own;
		const live = this.liveListScroller();
		if (!live) return own;
		return elementScrollbarGutterPx(live);
	}

	private liveListScroller(): HTMLElement | null {
		const doc = this.root.ownerDocument;
		if (!doc || typeof doc.querySelectorAll !== 'function') return null;
		const nodes = doc.querySelectorAll('.rv-locator-scroll');
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index];
			if (!(node instanceof HTMLElement) || node === this.scrollEl) continue;
			if (typeof node.closest === 'function' && node.closest('.rv-hub-swap-cover')) continue;
			if (node.clientWidth > 1) return node;
		}
		return null;
	}

	private currentSnapToken(): string {
		const scale = this.root.style.getPropertyValue('--rv-font-scale').trim() || '1';
		const control = this.root.style.getPropertyValue('--rv-control-size').trim();
		return glanceSnapToken(this.measureGutter(), scale, control);
	}

	/** Density, columns, then card heights. A cover resnap reads the settled box. */
	private settleGlanceLayout(): void {
		if (!this.scrollEl?.isConnected) return;
		this.applyDensity();
		this.applyColumnSnap();
		this.snapCardFrames();
	}

	private applyColumnSnap(): void {
		this.rememberScrollbar();
		const scroll = this.scrollEl;
		const gutter = this.measureGutter();
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
			this.settleGlanceLayout();
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

/**
 * Zoom is a document fact, not a per-badge fact. One probe per document is
 * reused by every later badge until a theme or css change bumps the generation.
 */
let strokeGeneration = 0;
const strokeByDocument = new WeakMap<Document, { generation: number; px: string }>();

export function clearBadgeStrokeCache(): void {
	strokeGeneration += 1;
}

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
 * Painted width of a 2px border divided by 2. The probe is not the badge, so
 * measuring it does not write the badge and does not depend on reading layout
 * between card writes. getComputedStyle already includes zoom.
 */
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
	} finally {
		probe.remove();
	}
	return ratio > 0 ? ratio : 1;
}

/**
 * Specified width whose painted border is 2 CSS px.
 * One off-badge probe per document. The badge itself is only written in
 * `applyBadgeStroke`, so the first card and the fifteenth get the same markup.
 */
function badgeStrokePx(host: HTMLElement): string {
	if (!host.isConnected) return '2px';
	const doc = host.ownerDocument;
	const cached = doc ? strokeByDocument.get(doc) : undefined;
	if (cached && cached.generation === strokeGeneration) return cached.px;
	const ratio = probeBorderRatio(host);
	let specified = STROKE_TARGET_PX;
	let resolved = '2px';
	if (ratio > 0 && Math.abs(ratio - 1) > 0.02) {
		for (let pass = 0; pass < 4; pass += 1) {
			const used = specified * ratio;
			if (!Number.isFinite(used) || used <= 0.01) break;
			if (Math.abs(used - STROKE_TARGET_PX) <= 0.05) {
				resolved = strokeLabel(specified);
				break;
			}
			const next = Number.parseFloat(correctedStrokePx(used, specified));
			if (!Number.isFinite(next) || Math.abs(next - specified) < 0.01) {
				resolved = strokeLabel(specified);
				break;
			}
			specified = next;
			resolved = strokeLabel(specified);
		}
	}
	if (specified < STROKE_TARGET_PX) resolved = '2px';
	if (doc) strokeByDocument.set(doc, { generation: strokeGeneration, px: resolved });
	return resolved;
}

/** Keep the painted badge and map-pin ring at 2 CSS px. Ghosts stay dashed. Measured once per document. */
const RING_BADGES = '.rv-locator-urgency, .rv-locator-map-pin, .rv-locator-priority-pill, .rv-pin-head';

export function pinBadgeStroke(host: HTMLElement): void {
	if (!host.isConnected) return;
	const wanted = badgeStrokePx(host);
	if (host.classList.contains('rv-pin-head')) {
		if (host.dataset.rvStrokePx === wanted) return;
		host.dataset.rvStrokePx = wanted;
		paintRingStroke(host, wanted);
		return;
	}
	const ghost = host.classList.contains('is-ghost');
	const style = ghost ? 'dashed' : 'solid';
	const cached = host.dataset.rvStrokePx;
	const ring = paintedStrokePx(host) ?? wanted;
	if (
		cached === wanted
		&& host.dataset.rvRingStroke === ring
		&& host.style.getPropertyValue('border-width') === wanted
		&& host.style.getPropertyValue('border-style') === style
	) return;
	host.dataset.rvStrokePx = wanted;
	host.dataset.rvRingStroke = ring;
	applyBadgeStroke(host, wanted);
}

/** Urgency, priority, and the study ring. A 2px stored in a fragment is not final. */
export function pinBadgeRings(root: ParentNode): void {
	if (typeof root.querySelectorAll !== 'function') return;
	root.querySelectorAll(RING_BADGES).forEach((node) => {
		if (node instanceof HTMLElement) pinBadgeStroke(node);
	});
}

function applyBadgeStroke(host: HTMLElement, px: string): void {
	const ghost = host.classList.contains('is-ghost');
	host.style.setProperty('border-style', ghost ? 'dashed' : 'solid', 'important');
	host.style.setProperty('border-width', px, 'important');
	paintRingStroke(host, px);
}

const paintedStrokeByDocument = new WeakMap<Document, { generation: number; px: string }>();

function paintedStrokePx(host: HTMLElement): string | null {
	const doc = host.ownerDocument;
	const cached = doc ? paintedStrokeByDocument.get(doc) : undefined;
	if (cached && cached.generation === strokeGeneration) return cached.px;
	return null;
}

/** One painted-border read for the whole list. Not one read per badge. */
function rememberPaintedStroke(root: ParentNode): void {
	if (typeof root.querySelector !== 'function') return;
	const sample = root.querySelector(RING_BADGES);
	if (!(sample instanceof HTMLElement)) return;
	const doc = sample.ownerDocument;
	const view = doc?.defaultView;
	if (!doc || !view || typeof view.getComputedStyle !== 'function') return;
	if (paintedStrokePx(sample)) return;
	if (!sample.style.getPropertyValue('border-width')) return;
	const used = Number.parseFloat(view.getComputedStyle(sample).borderTopWidth);
	if (!Number.isFinite(used) || used < 1) return;
	paintedStrokeByDocument.set(doc, { generation: strokeGeneration, px: strokeLabel(used) });
}

function paintRingStroke(host: HTMLElement, px: string): void {
	// The open path uses the once-per-document specified width. Reading each
	// badge's border flushes layout while the map is mounted. strokeHubRings
	// records the painted width once, after the first frame, and the next
	// pass writes that onto every ring.
	const stroke = paintedStrokePx(host) ?? px;
	host.querySelectorAll('line, circle').forEach((node) => {
		if (!(node instanceof Element) || !('style' in node)) return;
		const mark = node as Element & { style: CSSStyleDeclaration };
		mark.style.setProperty('stroke-width', stroke, 'important');
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

interface ActionRailRead {
	rect: DOMRect;
	gap: number;
	badgeHeights: number[];
}

/**
 * The action rail is pinned to the card's right edge. A fractional card width
 * leaves that edge off the pixel, so the rail's own top and left are rounded
 * and its height is a whole pixel that still centers the stack.
 */
function snapActionsColumn(actions: HTMLElement): void {
	actions.style.transform = '';
	const read = readActionRail(actions);
	if (read) writeActionRail(actions, read);
}

/** Clear every rail, read them in one layout, then write. */
function snapActionRails(rails: readonly HTMLElement[]): void {
	for (const actions of rails) actions.style.transform = '';
	const reads = rails.map((actions) => readActionRail(actions));
	for (let index = 0; index < rails.length; index += 1) {
		const actions = rails[index];
		const read = reads[index];
		if (actions && read) writeActionRail(actions, read);
	}
}

function readActionRail(actions: HTMLElement): ActionRailRead | null {
	const rect = actions.getBoundingClientRect();
	if (rect.width < 1 || rect.height < 1) return null;
	const badges = Array.from(actions.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
	const style = getComputedStyle(actions);
	const gap = Math.round(parseFloat(style.rowGap || style.gap) || 4);
	return {
		rect,
		gap,
		badgeHeights: badges.map((badge) => badge.getBoundingClientRect().height),
	};
}

function writeActionRail(actions: HTMLElement, read: ActionRailRead): void {
	const rect = read.rect;
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
	let stack = read.gap * Math.max(0, read.badgeHeights.length - 1);
	for (const height of read.badgeHeights) stack += height > 0 ? Math.round(height) : 28;
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
function markdownPreviewPadPx(embed: HTMLElement): number {
	const preview = embed.closest('.markdown-preview-view, .markdown-reading-view');
	if (!(preview instanceof HTMLElement)) return 0;
	const view = embed.ownerDocument?.defaultView;
	if (!view || typeof view.getComputedStyle !== 'function') return 0;
	const pad = Number.parseFloat(view.getComputedStyle(preview).paddingTop);
	return Number.isFinite(pad) && pad > 0 ? pad : 0;
}

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
	markHubFill(root, marked);
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
