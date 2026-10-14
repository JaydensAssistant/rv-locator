import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import { glancableCardSlotPx } from './glancable-density';
import { GEOAPIFY_ATTRIBUTION, OSM_ATTRIBUTION } from './constants';
import { appendBadge, mountUrgencyGlyph, snapAbsoluteOrigin, snapFlowBox } from './glancable-view';
import { contentBottom, measureBottomChrome, POPUP_MARGIN_PX, readSafeAreaBottom } from './chrome-inset';
import { dropPath, groupPinStacks, latToTileY, lonToTileX, mapPressIsClick, pinsToDraw, pinUrgencyZ, popupClearOfChrome, rankPinsFromRenderedList, tapZoomsStack, zoomToRevealPin, type MapPin } from './map-pins';
import { urgencyMark } from './scoring';
import { homeBoxFromPoints, loadTileIndex, noteViewedTile, saveTileIndex, tileIsHome, tileKey, type TileRecord } from './tile-index';
import { autoInk, paintUrgencyInk, parseCssColor, resolvePaintedColor } from './color-math';
import type { RVLocatorSettings } from './types';

export const MAP_VIEW_TYPE = 'rv-locator-map';

export interface MapHost {
	settings: RVLocatorSettings;
	/** Set just before the map opens. Null centers on the current location. */
	mapFocusPath: string | null;
	listMapPins(): MapPin[];
	openMapNote(path: string): void;
	openRoute(path: string): Promise<void>;
	currentMapFix(): { lat: number; lon: number } | null;
	/** Hub stack only. The split map keeps its own fullscreen flag. */
	hubMapIsFullscreen?(): boolean;
	setHubMapFullscreen?(on: boolean): void;
	notifyPin?(path: string): void;
	notifyMapCleared?(): void;
	hideSplitMap?(): void;
	promptUrgencyMenu?(path: string, name: string, event: MouseEvent): void;
	/** Paint the Glancable list card into the popup. False when that view is not mounted. */
	paintGlanceCard?(parent: HTMLElement, path: string): boolean;
	/**
	 * Width the list would use for its card grid. Fullscreen hides the cards,
	 * so this is the view width, not a measurement of a hidden card.
	 */
	glanceLayoutWidth?(): number;
	/** Keep the note-map distance in step with this map's GPS fix. */
	rememberLiveFix?(fix: { lat: number; lon: number } | null): void;
	tileCacheEpoch?: number;
	attachMap?(canvas: { refresh(): void; focus(path: string | null, center: boolean, source?: 'follow' | 'card'): void }): () => void;
}

const TILE = 256;

/**
 * Embedded OpenStreetMap raster map. No API key and no Geoapify basemap.
 * Turn-by-turn routing is intentionally not built; the route badge stays a later hook.
 */
export class RvMapView extends ItemView {
	private centerLat = 28.54;
	private centerLon = -81.38;
	private zoom = 13;
	private pins: MapPin[] = [];
	private user: { lat: number; lon: number } | null = null;
	private stage: HTMLElement | null = null;
	private pinLayer: HTMLElement | null = null;
	private watchId: number | null = null;
	private drag: { x: number; y: number; lat: number; lon: number; moved: boolean } | null = null;
	private press: { x: number; y: number } | null = null;
	private detachPress: (() => void) | null = null;
	private selectedPath: string | null = null;
	private detachMap: (() => void) | null = null;
	private stageObserver: ResizeObserver | null = null;
	private hideMapButton: HTMLElement | null = null;
	private tileImgs = new Map<string, HTMLImageElement>();
	private tileBacks = new Map<string, HTMLElement>();
	private tileSrc = new Map<string, string>();
	private settleEl: HTMLElement | null = null;
	private settleZ = -1;
	private settleCx = 0;
	private settleCy = 0;
	private settleTile = 256;
	private popupPanned = false;
	private lastPlaced: { pin: MapPin; point: { x: number; y: number } }[] = [];
	private tileIndex: TileRecord[] = loadTileIndex();
	private tileEpoch = -1;
	/** Fullscreen pin tap only. Card taps and split taps never set this. */
	private popupPath: string | null = null;
	private flashPath: string | null = null;
	private flashUntil = 0;
	/** pointerup and click both arrive for one tap. A zoom ignores every follow-up for a moment so the click cannot open a card. */
	private pinTapStamp = 0;
	private pinTapPath = '';
	private pinTapKind: '' | 'zoom' | 'open' = '';
	/** This map only. The hub stack and the split leaf do not share it. */
	private mapFullscreen = false;
	private fullscreenScope: 'hub' | 'split' = 'split';
	/** Card order for this hub. Null until the view publishes the rendered list. */
	private renderedPaths: readonly string[] | null = null;
	private scaleEl: HTMLElement | null = null;
	private scaleBarEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private host: MapHost) {
		super(leaf);
	}

	/**
	 * Class-field initializers do not run when the hub map is built from the
	 * prototype. Every field the constructor would set is assigned here.
	 */
	bindHost(host: MapHost, scope: 'hub' | 'split'): void {
		this.host = host;
		this.centerLat = 28.54;
		this.centerLon = -81.38;
		this.zoom = 13;
		this.pins = [];
		this.user = null;
		this.stage = null;
		this.pinLayer = null;
		this.watchId = null;
		this.drag = null;
		this.press = null;
		this.detachPress?.();
		this.detachPress = null;
		this.selectedPath = null;
		this.detachMap = null;
		this.stageObserver = null;
		this.hideMapButton = null;
		this.tileImgs = new Map();
		this.tileBacks = new Map();
		this.tileSrc = new Map();
		this.settleEl = null;
		this.settleZ = -1;
		this.settleCx = 0;
		this.settleCy = 0;
		this.settleTile = 256;
		this.popupPanned = false;
		this.lastPlaced = [];
		this.tileIndex = loadTileIndex();
		this.tileEpoch = -1;
		this.popupPath = null;
		this.flashPath = null;
		this.flashUntil = 0;
		this.pinTapStamp = 0;
		this.pinTapPath = '';
		this.pinTapKind = '';
		this.mapFullscreen = false;
		this.fullscreenScope = scope;
		this.renderedPaths = null;
		this.scaleEl = null;
		this.scaleBarEl = null;
	}

	getViewType(): string {
		return MAP_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Map';
	}

	getIcon(): 'earth' {
		return 'earth';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('rv-map');
		this.stage = this.contentEl.createDiv('rv-map-stage');
		const bar = this.stage.createDiv('rv-map-bar');
		const fullscreen = bar.createEl('button', {
			cls: 'rv-map-fullscreen',
			attr: { type: 'button', 'aria-label': 'Full screen', title: 'Full screen' },
		});
		setIcon(fullscreen, 'expand');
		const locate = bar.createEl('button', { attr: { type: 'button', 'aria-label': 'My location', title: 'My location' } });
		setIcon(locate, 'locate');
		const fit = bar.createEl('button', { attr: { type: 'button', 'aria-label': 'Show all', title: 'Show all' } });
		setIcon(fit, 'maximize');
		fullscreen.addEventListener('click', () => {
			this.setFullscreen(!this.isFullscreen());
		});
		locate.addEventListener('click', () => this.locateMe());
		fit.addEventListener('click', () => this.fitAll());
		const hide = bar.createEl('button', {
			cls: 'rv-map-hide',
			attr: { type: 'button', 'aria-label': 'Hide map', title: 'Hide map' },
		});
		setIcon(hide, 'chevron-down');
		hide.addEventListener('click', () => this.host.hideSplitMap?.());
		this.hideMapButton = hide;
		this.pinLayer = this.stage.createDiv('rv-map-pins');
		const scale = this.stage.createDiv('rv-map-scale');
		this.scaleBarEl = scale.createSpan('rv-map-scale-bar');
		this.scaleEl = scale.createSpan({ cls: 'rv-map-scale-label', text: '' });
		const credit = this.stage.createDiv('rv-map-credit');
		const osm = credit.createEl('a', {
			text: OSM_ATTRIBUTION,
			href: 'https://www.openstreetmap.org/copyright',
		});
		osm.setAttr('rel', 'noopener');
		osm.setAttr('target', '_blank');
		credit.createSpan({ text: ' · ' });
		const geo = credit.createEl('a', {
			text: GEOAPIFY_ATTRIBUTION,
			href: 'https://www.geoapify.com/',
		});
		geo.setAttr('rel', 'noopener');
		geo.setAttr('target', '_blank');
		this.pins = this.pinsInRenderedOrder();
		this.user = this.host.currentMapFix();
		this.centerOnOpen();
		this.bindStage();
		this.watchStageSize();
		this.paint();
		this.watchLocation();
		this.syncFullscreen();
		this.detachMap = this.host.attachMap?.({
			refresh: () => { this.recenter(); },
			focus: (path, center, source) => { this.focusPath(path, center, source); },
		}) ?? null;
	}

	async onClose(): Promise<void> {
		if (this.watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
			navigator.geolocation.clearWatch(this.watchId);
		}
		this.watchId = null;
		this.detachPress?.();
		this.detachPress = null;
		this.detachMap?.();
		this.detachMap = null;
		this.stageObserver?.disconnect();
		this.stageObserver = null;
	}

	/** Hub asked the map to center a pin, or only to highlight it. */
	focusPath(path: string | null, center: boolean, source: 'follow' | 'card' = 'follow'): void {
		this.selectedPath = path;
		if (source === 'card') this.popupPath = null;
		const pin = path ? this.pins.find((item) => item.path === path) : null;
		if (pin && center) {
			this.centerLat = pin.lat;
			this.centerLon = pin.lon;
			if (source === 'card') {
				this.zoom = zoomToRevealPin(this.zoom);
				this.flashPath = path;
				this.flashUntil = Date.now() + 1600;
				this.clearPinFlash(this.flashUntil);
			} else {
				this.zoom = Math.max(this.zoom, 15);
			}
		}
		this.paint();
	}

	/** Card list order for this hub. Rank is the index in that array. */
	applyRenderedOrder(paths: readonly string[]): void {
		this.renderedPaths = paths;
		this.pins = this.pinsInRenderedOrder();
		this.paint();
	}

	/** Remeasure after the embed or fullscreen layout settles, and on resize. */
	invalidateSize(): void {
		this.repaintAfterLayout();
	}

	private pinsInRenderedOrder(): MapPin[] {
		const pins = this.host.listMapPins();
		if (this.contentEl?.classList.contains('rv-note-map')) return pins;
		const order = this.renderedPaths;
		if (!order) return pins;
		return rankPinsFromRenderedList(pins, order);
	}

	private isFullscreen(): boolean {
		if (this.fullscreenScope === 'hub') return this.host.hubMapIsFullscreen?.() === true;
		return this.mapFullscreen === true;
	}

	/** Full screen stays on the map that was toggled. */
	private setFullscreen(on: boolean): void {
		if (this.fullscreenScope === 'hub') this.host.setHubMapFullscreen?.(on);
		else this.mapFullscreen = on;
		this.syncFullscreen();
		this.paint();
		this.repaintAfterLayout();
	}

	/** Drop the pin outline when the same 1600ms card flash would end. */
	private clearPinFlash(until: number): void {
		if (typeof window === 'undefined') return;
		window.setTimeout(() => {
			if (this.flashUntil !== until) return;
			const layer = this.pinLayer;
			if (!layer || typeof layer.querySelectorAll !== 'function') return;
			layer.querySelectorAll('.rv-pin-flash').forEach((node) => node.classList.remove('rv-pin-flash'));
		}, 1600);
	}

	/** Layout from the fullscreen class is not settled on the same turn. */
	private repaintAfterLayout(): void {
		const paint = (): void => { this.paint(); };
		const raf = typeof requestAnimationFrame === 'function'
			? requestAnimationFrame
			: ((fn: FrameRequestCallback): number => {
				fn(0);
				return 0;
			});
		raf(() => { raf(() => paint()); });
	}

	private watchStageSize(): void {
		const stage = this.stage;
		if (!stage || typeof ResizeObserver === 'undefined') return;
		let frame = 0;
		const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (): void => {};
		this.stageObserver = new ResizeObserver(() => {
			if (frame) cancel(frame);
			frame = rafOrNow(() => { this.invalidateSize(); });
		});
		this.stageObserver.observe(stage);
	}

	private syncFullscreen(): void {
		const on = this.isFullscreen();
		this.contentEl.toggleClass('is-fullscreen', on);
		const button = this.contentEl.querySelector('.rv-map-fullscreen');
		if (!(button instanceof HTMLElement)) return;
		const label = on ? 'Back to Hub' : 'Full screen';
		button.setAttr('aria-label', label);
		button.setAttr('title', label);
		button.empty();
		setIcon(button, on ? 'arrow-left' : 'expand');
		this.hideMapButton?.toggleClass('is-hidden', on);
	}

	/** Called when an already-open map is asked to center again. */
	recenter(): void {
		this.pins = this.pinsInRenderedOrder();
		this.user = this.host.currentMapFix() ?? this.user;
		this.centerOnOpen();
		this.syncFullscreen();
		this.paint();
	}

	private centerOnOpen(): void {
		const focus = this.host.mapFocusPath;
		const pin = focus ? this.pins.find((item) => item.path === focus) : null;
		if (pin) {
			this.centerLat = pin.lat;
			this.centerLon = pin.lon;
			this.zoom = 15;
			return;
		}
		if (this.user) {
			this.centerLat = this.user.lat;
			this.centerLon = this.user.lon;
			this.zoom = 14;
		}
	}

	private watchLocation(): void {
		if (this.host.settings.distanceTest) return;
		if (typeof navigator === 'undefined' || !navigator.geolocation) return;
		this.watchId = navigator.geolocation.watchPosition((position) => {
			this.user = { lat: position.coords.latitude, lon: position.coords.longitude };
			this.host.rememberLiveFix?.(this.user);
			if (!this.host.mapFocusPath) {
				this.centerLat = this.user.lat;
				this.centerLon = this.user.lon;
			}
			this.paint();
		});
	}

	private bindStage(): void {
		const stage = this.stage;
		if (!stage) return;
		stage.tabIndex = 0;
		const pointers = new Map<number, { x: number; y: number }>();
		let pinchZoom: number | null = null;
		let pinchDistance = 0;
		const onControl = (event: Event): boolean => event.target instanceof Element
			&& event.target.closest('.rv-map-pin, .rv-map-card, .rv-map-cluster, .rv-map-bar, .rv-map-credit, .rv-map-scale') != null;
		stage.addEventListener('pointerdown', (event) => {
			if (event.button > 0) return;
			this.press = { x: event.clientX, y: event.clientY };
			if (onControl(event)) return;
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (pointers.size >= 2) {
				this.drag = null;
				pinchZoom = this.zoom;
				pinchDistance = pointerSpan(pointers);
				return;
			}
			this.drag = { x: event.clientX, y: event.clientY, lat: this.centerLat, lon: this.centerLon, moved: false };
		});
		stage.addEventListener('pointermove', (event) => {
			if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (pointers.size >= 2 && pinchZoom != null && pinchDistance > 0) {
				const ratio = pointerSpan(pointers) / pinchDistance;
				if (ratio > 0) this.setZoom(pinchZoom + Math.log2(ratio), false);
				return;
			}
			if (!this.drag) return;
			const dx = event.clientX - this.drag.x;
			const dy = event.clientY - this.drag.y;
			if (!this.drag.moved) {
				if (mapPressIsClick(dx, dy, 8)) return;
				this.drag.moved = true;
				stage.addClass('is-grabbing');
			}
			const scale = TILE * 2 ** this.zoom;
			this.centerLon = this.drag.lon - (dx / scale) * 360;
			const startY = latToTileY(this.drag.lat, this.zoom);
			const nextY = startY - dy / TILE;
			this.centerLat = tileYToLat(nextY, this.zoom);
			this.paint();
		});
		stage.addEventListener('pointerup', (event) => {
			pointers.delete(event.pointerId);
			if (pointers.size < 2) {
				pinchZoom = null;
				pinchDistance = 0;
			}
			const drag = this.drag;
			this.drag = null;
			stage.removeClass('is-grabbing');
			const target = event.target instanceof Element ? event.target : null;
			const cardControl = target?.closest('.rv-map-card a, .rv-map-card button') != null;
			if (!cardControl && event.button <= 0 && (!drag || !drag.moved)) {
				const hit = this.pinHitAt(event.clientX, event.clientY, target);
				if (hit && this.pinLayer) {
					this.activatePin(hit.pin, hit.point, this.lastPlaced, this.pinLayer, hit.button);
					return;
				}
			}
			if (!drag || drag.moved) return;
			if (this.isFullscreen()) {
				if (!this.selectedPath && !this.popupPath) return;
				this.selectedPath = null;
				this.popupPath = null;
				this.paint();
				return;
			}
			this.selectedPath = null;
			this.popupPath = null;
			this.host.notifyMapCleared?.();
			this.paint();
		});
		stage.addEventListener('pointercancel', () => {
			this.drag = null;
			this.press = null;
			pointers.clear();
			pinchZoom = null;
			stage.removeClass('is-grabbing');
		});
		const view = stage.ownerDocument.defaultView;
		const onWindowUp = (event: PointerEvent): void => {
			const press = this.press;
			this.press = null;
			if (!press || event.button > 0) return;
			if (!mapPressIsClick(event.clientX - press.x, event.clientY - press.y, 8)) return;
			const hit = this.pinHitAt(event.clientX, event.clientY, event.target);
			if (!hit || !this.pinLayer || !this.pinTapZooms(hit.pin)) return;
			this.centerLat = hit.pin.lat;
			this.centerLon = hit.pin.lon;
			this.popupPath = null;
			this.popupPanned = false;
			this.pinTapStamp = Date.now();
			this.pinTapPath = hit.pin.path;
			this.pinTapKind = 'zoom';
			this.drag = null;
			const zed = Math.floor(this.zoom);
			this.setZoom(zoomToRevealPin(zed), true);
		};
		view?.addEventListener('pointerup', onWindowUp, true);
		this.detachPress = () => view?.removeEventListener('pointerup', onWindowUp, true);
		stage.addEventListener('dblclick', (event) => {
			if (onControl(event)) return;
			event.preventDefault();
			this.setZoom(this.zoom + 1);
		});
		stage.addEventListener('keydown', (event) => {
			if (event.key === '+' || event.key === '=') {
				event.preventDefault();
				this.setZoom(this.zoom + 1);
			} else if (event.key === '-' || event.key === '_') {
				event.preventDefault();
				this.setZoom(this.zoom - 1);
			}
		});
		stage.addEventListener('wheel', (event) => {
			event.preventDefault();
			const pinch = event.ctrlKey || event.metaKey;
			const mouseWheel = !pinch && Math.abs(event.deltaY) >= 40 && Math.abs(event.deltaX) < 8;
			if (!pinch && !mouseWheel) {
				const scale = TILE * 2 ** this.zoom;
				this.centerLon -= (event.deltaX / scale) * 360;
				const y = latToTileY(this.centerLat, this.zoom) + event.deltaY / TILE;
				this.centerLat = tileYToLat(y, this.zoom);
				this.paint();
				return;
			}
			if (pinch) this.setZoom(this.zoom - event.deltaY * 0.01, false);
			else this.setZoom(this.zoom + (event.deltaY < 0 ? 1 : -1), true);
		}, { passive: false });
	}

	private setZoom(zoom: number, whole = true): void {
		const next = whole ? Math.round(zoom) : zoom;
		this.zoom = Math.max(3, Math.min(18, next));
		this.paint();
	}

	private paint(): void {
		const stage = this.stage;
		const pins = this.pinLayer;
		if (!stage || !pins) return;
		const width = stage.clientWidth || 640;
		const height = stage.clientHeight || 480;
		const z = Math.floor(this.zoom);
		const frac = 2 ** (this.zoom - z);
		const scale = 2 ** z;
		const cx = lonToTileX(this.centerLon, z);
		const cy = latToTileY(this.centerLat, z);
		const tilePx = TILE * frac;
		this.paintTiles(stage, pins, width, height, z, scale, cx, cy, tilePx);
		pins.empty();
		const cxF = cx * frac;
		const cyF = cy * frac;
		if (this.user) this.paintUser(pins, width, height, cxF, cyF);
		const placed = this.pins.map((pin) => ({ pin, point: this.project(pin.lat, pin.lon, width, height, cxF, cyF) }));
		this.lastPlaced = placed;
		this.paintStacks(pins, placed);
		const popup = this.popupPath && Math.floor(this.zoom) > 12 && this.isFullscreen()
			? placed.find((item) => item.pin.path === this.popupPath)
			: null;
		if (popup) this.openCard(pins, popup.pin, popup.point);
		this.paintScale(width);
	}

	private paintScale(stageWidth: number): void {
		const bar = this.scaleBarEl;
		const label = this.scaleEl;
		if (!bar || !label) return;
		const metersPerPx = (156543.03392 * Math.cos((this.centerLat * Math.PI) / 180)) / 2 ** this.zoom;
		const target = Math.min(96, Math.max(48, stageWidth * 0.18));
		const meters = niceMeters(metersPerPx * target);
		const px = Math.max(24, Math.round(meters / metersPerPx));
		bar.style.width = `${px}px`;
		label.textContent = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
	}

	private paintUser(layer: HTMLElement, width: number, height: number, cx: number, cy: number): void {
		if (!this.user) return;
		const dot = layer.createDiv('rv-map-user');
		const point = this.project(this.user.lat, this.user.lon, width, height, cx, cy);
		dot.style.left = `${point.x}px`;
		dot.style.top = `${point.y}px`;
		dot.setAttr('title', 'Current location');
	}

	private paintTiles(
		stage: HTMLElement,
		pins: HTMLElement,
		width: number,
		height: number,
		z: number,
		scale: number,
		cx: number,
		cy: number,
		tilePx: number,
	): void {
		const epoch = this.host.tileCacheEpoch ?? 0;
		if (epoch !== this.tileEpoch) {
			this.tileEpoch = epoch;
			this.tileIndex = loadTileIndex();
		}
		const buffer = 2;
		const left = Math.floor(cx - width / 2 / tilePx) - buffer;
		const right = Math.floor(cx + width / 2 / tilePx) + buffer;
		const top = Math.floor(cy - height / 2 / tilePx) - buffer;
		const bottom = Math.floor(cy + height / 2 / tilePx) + buffer;
		const needed = new Set<string>();
		const visible = new Set<string>();
		const box = homeBoxFromPoints(this.pins);
		const viewLeft = Math.floor(cx - width / 2 / tilePx);
		const viewRight = Math.floor(cx + width / 2 / tilePx);
		const viewTop = Math.floor(cy - height / 2 / tilePx);
		const viewBottom = Math.floor(cy + height / 2 / tilePx);
		for (let x = left; x <= right; x += 1) {
			for (let y = top; y <= bottom; y += 1) {
				if (y < 0 || y >= scale) continue;
				const wrapped = ((x % scale) + scale) % scale;
				const key = tileKey(z, wrapped, y);
				needed.add(key);
				if (x >= viewLeft && x <= viewRight && y >= viewTop && y <= viewBottom) visible.add(key);
				let img = this.tileImgs.get(key);
				const back = this.paintTileBack(stage, pins, key, z, wrapped, y);
				if (!img) {
					img = stage.ownerDocument.createElement('img');
					img.className = 'rv-map-tile is-holding';
					img.alt = '';
					img.addEventListener('load', () => {
						if (!img || img.naturalWidth <= 0) return;
						img.classList.add('is-ready');
						this.tileSrc.set(key, img.currentSrc || img.src);
						this.tileIndex = noteViewedTile(this.tileIndex, {
							z,
							x: wrapped,
							y,
							home: tileIsHome(z, wrapped, y, box),
						}, Date.now());
						saveTileIndex(this.tileIndex);
					});
					img.src = `https://tile.openstreetmap.org/${z}/${wrapped}/${y}.png`;
					this.tileImgs.set(key, img);
					stage.insertBefore(img, pins);
				}
				const leftPx = `${(x - cx) * tilePx + width / 2}px`;
				const topPx = `${(y - cy) * tilePx + height / 2}px`;
				const sizePx = `${tilePx}px`;
				back.style.width = sizePx;
				back.style.height = sizePx;
				back.style.left = leftPx;
				back.style.top = topPx;
				img.style.width = sizePx;
				img.style.height = sizePx;
				img.style.left = leftPx;
				img.style.top = topPx;
				const holding = !tileReady(img);
				img.classList.toggle('is-holding', holding);
				if (holding && back.dataset.rvParent === '1') {
					img.style.backgroundImage = back.style.backgroundImage;
					img.style.backgroundPosition = back.style.backgroundPosition;
					img.style.backgroundSize = back.style.backgroundSize;
					img.style.backgroundRepeat = 'no-repeat';
				}
			}
		}
		const visibleReady = [...visible].every((key) => tileReady(this.tileImgs.get(key)));
		this.syncTileSettle(stage, pins, z, cx, cy, tilePx, visibleReady);
		if (!visibleReady) return;
		for (const [key, img] of this.tileImgs) {
			if (needed.has(key)) continue;
			img.remove();
			this.tileImgs.delete(key);
			const back = this.tileBacks.get(key);
			back?.remove();
			this.tileBacks.delete(key);
		}
	}

	/**
	 * Parent art sits under the tile. `is-holding` hides the image, not this
	 * layer, so a tile that has never loaded still covers the stage.
	 */
	private paintTileBack(stage: HTMLElement, pins: HTMLElement, key: string, z: number, x: number, y: number): HTMLElement {
		let back = this.tileBacks.get(key);
		if (!back?.isConnected) {
			back = stage.ownerDocument.createElement('div');
			back.className = 'rv-map-tile-back';
			stage.insertBefore(back, pins);
			this.tileBacks.set(key, back);
		}
		const parent = ancestorTileBackground(z, x, y, this.tileSrc) ?? unloadedAncestorTile(z, x, y);
		if (parent) {
			const image = `url("${parent.url}")`;
			back.dataset.rvParent = '1';
			back.style.backgroundImage = image;
			back.style.backgroundPosition = parent.position;
			back.style.backgroundSize = parent.size;
			back.style.backgroundRepeat = 'no-repeat';
		}
		return back;
	}

	/** Last complete frame stays under new tiles and slides with the pan until they load. */
	private syncTileSettle(
		stage: HTMLElement,
		pins: HTMLElement,
		z: number,
		cx: number,
		cy: number,
		tilePx: number,
		visibleReady: boolean,
	): void {
		if (!this.settleEl?.isConnected) {
			const hold = stage.ownerDocument.createElement('div');
			hold.className = 'rv-map-settle';
			stage.insertBefore(hold, pins);
			this.settleEl = hold;
		}
		const hold = this.settleEl;
		if (!hold) return;
		if (visibleReady) {
			hold.replaceChildren();
			this.settleZ = z;
			this.settleCx = cx;
			this.settleCy = cy;
			this.settleTile = tilePx;
			for (const img of this.tileImgs.values()) {
				if (!tileReady(img)) continue;
				const clone = img.cloneNode(true);
				if (clone instanceof HTMLElement) {
					clone.classList.add('is-settle');
					hold.appendChild(clone);
				}
			}
			hold.style.transform = '';
			return;
		}
		if (this.settleZ < 0) {
			this.captureParentSettle(hold, z, cx, cy, tilePx);
			return;
		}
		if (this.settleZ === z) {
			const dx = (this.settleCx - cx) * tilePx;
			const dy = (this.settleCy - cy) * tilePx;
			hold.style.transform = `translate(${dx}px, ${dy}px)`;
			return;
		}
		const scale = tilePx / Math.max(1, this.settleTile);
		const dx = this.settleCx * this.settleTile - cx * tilePx;
		const dy = this.settleCy * this.settleTile - cy * tilePx;
		hold.style.transformOrigin = '0 0';
		hold.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
	}

	/** Parent tiles fill the settle layer before any image has loaded, including the first pan. */
	private captureParentSettle(hold: HTMLElement, z: number, cx: number, cy: number, tilePx: number): void {
		hold.replaceChildren();
		for (const back of this.tileBacks.values()) {
			if (back.dataset.rvParent !== '1') continue;
			const clone = back.cloneNode(true);
			if (!(clone instanceof HTMLElement)) continue;
			clone.classList.add('is-settle');
			hold.appendChild(clone);
		}
		if (hold.childElementCount === 0) return;
		this.settleZ = z;
		this.settleCx = cx;
		this.settleCy = cy;
		this.settleTile = tilePx;
		hold.style.transform = '';
	}

	/** The pin button whose border box contains a viewport point. Used only when the element stack is unavailable. */
	private pinButtonAt(clientX: number, clientY: number): { pin: MapPin; point: { x: number; y: number }; button: HTMLElement } | null {
		const buttons = this.pinLayer?.querySelectorAll<HTMLElement>('button.rv-map-pin');
		if (!buttons) return null;
		let best: { pin: MapPin; point: { x: number; y: number }; button: HTMLElement } | null = null;
		let bestZ = -1;
		buttons.forEach((button) => {
			const rect = button.getBoundingClientRect();
			if (rect.width < 1 || rect.height < 1) return;
			if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return;
			const z = Number(button.style.zIndex) || 0;
			if (best && z < bestZ) return;
			const item = this.lastPlaced.find((entry) => entry.pin.path === (button.dataset.rvPath ?? ''));
			if (!item) return;
			best = { pin: item.pin, point: item.point, button };
			bestZ = z;
		});
		return best;
	}

	private pinFromTarget(target: Element | null): { pin: MapPin; point: { x: number; y: number }; button: HTMLElement } | null {
		const button = target?.closest('.rv-map-pin');
		if (!(button instanceof HTMLElement)) return null;
		const path = button.dataset.rvPath ?? '';
		const item = this.lastPlaced.find((entry) => entry.pin.path === path);
		if (!item) return null;
		return { pin: item.pin, point: item.point, button };
	}

	/**
	 * The pin element under the pointer. The event target wins, then the
	 * topmost pin in the element stack (a card may cover it). A nearby pin
	 * is never substituted.
	 */
	private pinHitAt(clientX: number, clientY: number, target: EventTarget | null): { pin: MapPin; point: { x: number; y: number }; button: HTMLElement } | null {
		const direct = target instanceof Element ? this.pinFromTarget(target) : null;
		if (direct) return direct;
		const view = this.stage?.ownerDocument.defaultView;
		const stack = view?.document?.elementsFromPoint?.(clientX, clientY) ?? [];
		for (const node of stack) {
			if (!(node instanceof Element)) continue;
			const hit = this.pinFromTarget(node);
			if (hit) return hit;
		}
		return this.pinButtonAt(clientX, clientY);
	}

	/** A count stack, or any pins drawn on top of each other, zooms instead of opening. */
	private pinTapZooms(pin: MapPin): boolean {
		const placed = this.lastPlaced;
		const spot = placed.find((entry) => entry.pin.path === pin.path)?.point;
		if (!spot) return false;
		const members = placed.map((item) => ({
			path: item.pin.path,
			x: item.point.x,
			y: item.point.y,
			urgency: item.pin.urgency,
			priority: item.pin.priority,
		}));
		const group = groupPinStacks(members).find((entry) => entry.some((member) => member.path === pin.path));
		return tapZoomsStack(Math.floor(this.zoom), group?.length ?? 0);
	}

	private paintStacks(layer: HTMLElement, placed: { pin: MapPin; point: { x: number; y: number } }[]): void {
		const members = placed.map((item) => ({
			path: item.pin.path,
			x: item.point.x,
			y: item.point.y,
			urgency: item.pin.urgency,
			priority: item.pin.priority,
			snoozed: item.pin.snoozed === true,
		}));
		const groups = groupPinStacks(members);
		for (const group of groups) {
			const drawn = pinsToDraw(group);
			drawn.drawn.forEach((member, index) => {
				const item = placed.find((entry) => entry.pin.path === member.path);
				if (!item) return;
				this.paintPin(layer, item.pin, item.point, placed, index === 0 ? drawn.label : null);
			});
		}
	}

	private paintPin(
		layer: HTMLElement,
		pin: MapPin,
		point: { x: number; y: number },
		placed: { pin: MapPin; point: { x: number; y: number } }[],
		count: string | null,
	): void {
		const selected = this.selectedPath === pin.path;
		const snoozed = pin.snoozed === true || pin.stateIcon === 'moon';
		const ghost = pin.stateIcon != null && !snoozed;
		const button = layer.createEl('button', {
			cls: `rv-map-pin is-drop${ghost ? ' is-fresh' : ''}${snoozed ? ' is-snoozed' : ''}${selected ? ' is-selected' : ''}`,
			attr: { type: 'button', 'aria-label': pin.name },
		});
		button.style.setProperty('--pin-color', pin.color);
		button.style.setProperty('--rv-urgency-accent', pin.color);
		paintUrgencyInk(button, pin.color);
		button.createSpan('rv-pin-tipshadow');
		const shape = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
		shape.setAttribute('class', 'rv-pin-shape');
		shape.setAttribute('viewBox', '0 0 42 54');
		const outline = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
		outline.setAttribute('d', dropPath());
		shape.appendChild(outline);
		button.appendChild(shape);
		const head = button.createSpan('rv-pin-head');
		if (pin.stateIcon) {
			button.dataset.pinState = pin.stateIcon;
			setIcon(head, pin.stateIcon);
			sizePinGlyph(head, 25);
		} else {
			mountUrgencyGlyph(head, pin.glyph);
			sizePinGlyph(head, MAP_PIN_GLYPH_PX);
		}
		if (count) {
			const dot = button.createSpan({ cls: 'rv-pin-stack-count', text: count });
			const painted = resolvePaintedColor(button, pin.color || 'var(--interactive-accent)');
			const band = parseCssColor(painted);
			if (band) dot.style.color = autoInk(band);
		}
		button.dataset.rvPath = pin.path;
		button.style.left = `${point.x}px`;
		button.style.top = `${point.y}px`;
		button.style.zIndex = String(pinUrgencyZ(pin.urgency, selected, snoozed));
		if (this.flashPath === pin.path && Date.now() < this.flashUntil) button.addClass('rv-pin-flash');
		button.addEventListener('pointerdown', (event) => {
			if (event.button > 0) return;
			button.dataset.rvX = String(event.clientX);
			button.dataset.rvY = String(event.clientY);
		});
		const onTap = (event: PointerEvent | MouseEvent): void => {
			if (event.button > 0) return;
			if (event.type !== 'click') {
				const downX = Number(button.dataset.rvX ?? event.clientX);
				const downY = Number(button.dataset.rvY ?? event.clientY);
				if (Math.hypot(event.clientX - downX, event.clientY - downY) > 8) return;
			}
			event.preventDefault();
			event.stopPropagation();
			const path = button.dataset.rvPath ?? pin.path;
			const live = this.lastPlaced.find((entry) => entry.pin.path === path);
			this.activatePin(live?.pin ?? pin, live?.point ?? point, this.lastPlaced, layer, button);
		};
		button.addEventListener('pointerup', onTap);
		button.addEventListener('click', onTap);
	}

	/** Mouse button 0 and touch (`button === -1`) both count. A second event for the same tap does not zoom twice. */
	private activatePin(
		pin: MapPin,
		point: { x: number; y: number },
		placed: { pin: MapPin; point: { x: number; y: number } }[],
		layer: HTMLElement,
		button: HTMLElement,
	): void {
		const path = button.dataset.rvPath || pin.path;
		const live = this.lastPlaced.find((entry) => entry.pin.path === path);
		const chosen = live?.pin ?? pin;
		const spot = live?.point ?? point;
		const now = Date.now();
		if (now - this.pinTapStamp < 400 && (this.pinTapKind === 'zoom' || this.pinTapPath === chosen.path)) return;
		this.pinTapStamp = now;
		this.pinTapPath = chosen.path;
		const zed = Math.floor(this.zoom);
		if (this.pinTapZooms(chosen)) {
			this.pinTapKind = 'zoom';
			this.centerLat = chosen.lat;
			this.centerLon = chosen.lon;
			this.popupPath = null;
			this.popupPanned = false;
			this.setZoom(zoomToRevealPin(zed), true);
			return;
		}
		this.pinTapKind = 'open';
		this.selectedPath = chosen.path;
		if (this.isFullscreen()) {
			this.popupPath = chosen.path;
			this.popupPanned = false;
			this.openCard(layer, chosen, spot);
			button.addClass('is-selected');
			return;
		}
		this.popupPath = null;
		this.host.notifyPin?.(chosen.path);
		button.addClass('is-selected');
	}

	/** Intersection of the stage and the window, in stage-local coordinates. */
	private visibleFrame(): { left: number; top: number; width: number; height: number } {
		const stage = this.stage;
		const view = stage?.ownerDocument.defaultView;
		if (!stage) return { left: 0, top: 0, width: 390, height: 640 };
		const frame = stage.getBoundingClientRect();
		const viewW = view?.innerWidth ?? frame.width;
		const viewH = view?.innerHeight ?? frame.height;
		const doc = stage.ownerDocument;
		const chrome = doc ? contentBottom(viewH, measureBottomChrome(doc), readSafeAreaBottom(doc)) : viewH;
		const viewBottom = Math.min(viewH, chrome) - POPUP_MARGIN_PX;
		const left = Math.max(0, -frame.left);
		const top = Math.max(0, -frame.top);
		const right = Math.min(frame.width, Math.max(left, viewW - frame.left));
		const bottom = Math.min(frame.height, Math.max(top, viewBottom - frame.top));
		return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
	}

	private panPixels(dx: number, dy: number): void {
		const scale = TILE * 2 ** this.zoom;
		this.centerLon += (dx / scale) * 360;
		const y = latToTileY(this.centerLat, this.zoom) - dy / TILE;
		this.centerLat = tileYToLat(y, this.zoom);
		this.paint();
	}

	private openCard(layer: HTMLElement, pin: MapPin, point: { x: number; y: number }): void {
		layer.querySelectorAll('.rv-map-card').forEach((node) => node.remove());
		const shell = layer.createDiv('rv-map-card rv-locator-glancable');
		const frame = this.visibleFrame();
		const stageBox = {
			width: this.stage?.clientWidth || frame.width,
			height: this.stage?.clientHeight || frame.height,
		};
		const cardWidth = this.popupCardWidth();
		const cardHeight = Math.min(320, Math.max(120, frame.height - 16));
		shell.style.width = `${cardWidth}px`;
		shell.style.minWidth = `${cardWidth}px`;
		shell.style.maxWidth = `${cardWidth}px`;
		shell.style.maxHeight = `${cardHeight}px`;
		const origin = popupClearOfChrome({ x: point.x, y: point.y - 8 }, {
			width: cardWidth,
			height: cardHeight,
		}, stageBox, frame);
		shell.style.left = `${Math.round(origin.left)}px`;
		shell.style.top = `${Math.round(origin.top)}px`;
		shell.style.zIndex = String(pinUrgencyZ(pin.urgency, true) + 1);
		shell.addEventListener('click', (event) => {
			event.stopPropagation();
		});
		this.host.rememberLiveFix?.(this.user);
		const painted = this.host.paintGlanceCard?.(shell, pin.path) === true;
		if (!painted) this.paintFallbackCard(shell, pin);
		const card = shell.querySelector('.rv-locator-card');
		const placeShell = (): void => {
			snapAbsoluteOrigin(shell);
			if (card instanceof HTMLElement) snapFlowBox(card, true);
		};
		placeShell();
		const nudge = (): void => {
			const stage = this.stage;
			if (!stage || !shell.isConnected) return;
			const rect = shell.getBoundingClientRect();
			if (rect.width < 1 || rect.height < 1) return;
			const nextFrame = this.visibleFrame();
			const nextStage = {
				width: stage.clientWidth || nextFrame.width,
				height: stage.clientHeight || nextFrame.height,
			};
			const limit = Math.max(80, nextFrame.height - 8);
			if (rect.height > limit) shell.style.maxHeight = `${limit}px`;
			const fitted = popupClearOfChrome({ x: point.x, y: point.y - 8 }, {
				width: rect.width,
				height: Math.min(rect.height, limit),
			}, nextStage, nextFrame);
			shell.style.left = `${Math.round(fitted.left)}px`;
			shell.style.top = `${Math.round(fitted.top)}px`;
			placeShell();
		};
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(nudge);
		else nudge();
	}

	/**
	 * The width one list card gets from the glancable grid in this leaf.
	 * Fullscreen hides the list, so the live card is not measured.
	 * A 1236px leaf is 400. A 400px leaf is 380.
	 */
	private popupCardWidth(): number {
		const settings = this.host.settings;
		const layout = this.host.glanceLayoutWidth?.() ?? 0;
		const windowW = this.stage?.ownerDocument.defaultView?.innerWidth ?? 0;
		const container = layout > 0 ? layout : windowW;
		return glancableCardSlotPx(container, settings, settings.glancableFitCount);
	}

	/** Used only when the Glancable view is not mounted to paint the same card. */
	private paintFallbackCard(shell: HTMLElement, pin: MapPin): void {
		const marks = urgencyMark(pin.urgency, pin.priority);
		const card = shell.createDiv('rv-locator-card has-actions');
		card.style.setProperty('--rv-urgency-accent', pin.color);
		paintUrgencyInk(card, pin.color);
		card.style.setProperty('--rv-badge-count', '3');
		card.style.setProperty('--rv-font-scale', '1');
		card.style.setProperty('--rv-icon-scale', '1.2');
		const openNote = (): void => { this.host.openMapNote(pin.path); };
		const name = card.createDiv('rv-locator-card-name');
		const link = name.createEl('a', {
			cls: 'rv-locator-file-link',
			text: pin.name,
			href: pin.path,
			attr: { 'aria-label': pin.name },
		});
		link.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			openNote();
		});
		const place = card.createDiv('rv-locator-place');
		this.cardSlot(place, 'earth', pin.card.address || '—', !pin.card.address);
		if (pin.card.city) {
			const city = card.createDiv('rv-locator-place');
			this.cardSlot(city, 'building-2', pin.card.city, false);
		}
		const lines = this.host.settings.glancableLines;
		const lineOn = (id: keyof typeof lines): boolean => lines[id] !== false;
		const study = pin.card.study;
		const compact = this.host.settings.compactMode !== false;
		const showSpoke = lineOn('last-spoke') && (!study || this.host.settings.studyShowSpoke);
		const showAttempted = lineOn('last-attempted') && (!study || this.host.settings.studyShowAttempted);
		const showMet = lineOn('met');
		if (study || showSpoke || showAttempted || showMet) {
			const when = card.createDiv(compact ? 'rv-locator-when is-compact' : 'rv-locator-when');
			if (study) this.cardSlot(when, 'book-marked', pin.card.studied || '—', !pin.card.studied);
			if (showSpoke) this.cardSlot(when, 'message-circle', pin.card.spoke || '—', !pin.card.spoke);
			if (showAttempted) this.cardSlot(when, 'clock', pin.card.attempted || '—', !pin.card.attempted);
			if (showMet) this.cardSlot(when, 'home', pin.card.met || '—', !pin.card.met);
		}
		const foot = card.createDiv('rv-locator-card-foot');
		this.cardSlot(foot, 'user', pin.card.metWith || '—', !pin.card.metWith);
		const ratio = pin.card.study ? pin.card.studyRatio : pin.card.visits;
		if (ratio) this.cardSlot(foot, pin.card.study ? 'percent' : 'list-checks', ratio, false);
		const actions = card.createSpan('rv-locator-card-actions');
		const snoozedPin = pin.snoozed === true || pin.stateIcon === 'moon';
		const urgency = snoozedPin
			? appendBadge(actions, { kind: 'icon', icon: 'moon', band: marks.band, label: 'Urgency' })
			: appendBadge(actions, { kind: 'urgency', glyphs: marks.glyphs, band: marks.band, label: 'Urgency' });
		urgency.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.host.promptUrgencyMenu?.(pin.path, pin.name, event);
		});
		appendBadge(actions, { kind: 'priority', rank: String(pin.priority), label: `Priority ${pin.priority}` });
		const route = appendBadge(actions, { kind: 'icon', icon: 'route', label: 'Directions' });
		route.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.host.openRoute(pin.path);
		});
	}

	private cardSlot(parent: HTMLElement, icon: string, text: string, empty: boolean): void {
		const slot = parent.createSpan({ cls: `rv-locator-slot${empty ? ' is-empty' : ''}` });
		const mark = slot.createSpan('rv-locator-slot-icon');
		setIcon(mark, icon);
		slot.createSpan({ cls: 'rv-locator-slot-text', text });
	}

	private fitAll(): void {
		const points = [
			...this.pins.map((pin) => ({ lat: pin.lat, lon: pin.lon })),
			...(this.user ? [this.user] : []),
		];
		if (points.length === 0) return;
		const lats = points.map((point) => point.lat);
		const lons = points.map((point) => point.lon);
		this.centerLat = average(lats);
		this.centerLon = average(lons);
		const span = Math.max(spread(lats), spread(lons));
		this.zoom = span < 0.02 ? 15 : span < 0.08 ? 13 : span < 0.3 ? 11 : span < 1 ? 9 : 6;
		this.paint();
	}

	private locateMe(): void {
		if (this.user) {
			this.centerLat = this.user.lat;
			this.centerLon = this.user.lon;
			this.zoom = 15;
			this.paint();
			return;
		}
		const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
		if (!geo || this.host.settings.distanceTest) return;
		geo.getCurrentPosition((position) => {
			this.user = { lat: position.coords.latitude, lon: position.coords.longitude };
			this.centerLat = this.user.lat;
			this.centerLon = this.user.lon;
			this.zoom = 15;
			this.paint();
		});
	}

	private project(
		lat: number,
		lon: number,
		width: number,
		height: number,
		cx: number,
		cy: number,
	): { x: number; y: number } {
		return {
			x: (lonToTileX(lon, this.zoom) - cx) * TILE + width / 2,
			y: (latToTileY(lat, this.zoom) - cy) * TILE + height / 2,
		};
	}
}

/**
 * Map pin diameter. 15% over the original 42px pin, before the 50% enlargement.
 * Popup badges use the Glancable card's control size. Hub badges stay 28px.
 */
export const MAP_PIN_PX = 48;

/** 0.70 × the 42px teardrop head. */
export const MAP_PIN_GLYPH_PX = 29.4;

/** 15% over the original 46px cluster. */
export const MAP_CLUSTER_PX = 53;

/** Force pin icons past `svg { width: 1em }`, which followed the 22px pin font-size. */
export function sizePinGlyph(host: HTMLElement, px = MAP_PIN_GLYPH_PX): void {
	host.querySelectorAll('svg').forEach((node) => {
		if (!(node instanceof SVGElement)) return;
		node.style.setProperty('width', `${px}px`, 'important');
		node.style.setProperty('height', `${px}px`, 'important');
		node.style.setProperty('min-width', `${px}px`, 'important');
		node.style.setProperty('min-height', `${px}px`, 'important');
	});
}

export function tileReady(img: HTMLImageElement | undefined): boolean {
	return img?.classList.contains('is-ready') === true && img.naturalWidth > 0;
}

/** A loaded coarser tile covers a new tile until its own image arrives. */
export function ancestorTileBackground(
	z: number,
	x: number,
	y: number,
	srcs: ReadonlyMap<string, string>,
): { url: string; position: string; size: string } | null {
	for (let level = 1; level <= z; level += 1) {
		const div = 2 ** level;
		const url = srcs.get(tileKey(z - level, Math.floor(x / div), Math.floor(y / div)));
		if (!url) continue;
		const cellX = x % div;
		const cellY = y % div;
		const denom = Math.max(1, div - 1);
		return {
			url,
			position: `${(cellX / denom) * 100}% ${(cellY / denom) * 100}%`,
			size: `${div * 100}% ${div * 100}%`,
		};
	}
	return null;
}

/** Coarser OSM tile for a cell whose parents were never cached. Empty maps stay null in {@link ancestorTileBackground}. */
export function unloadedAncestorTile(
	z: number,
	x: number,
	y: number,
): { url: string; position: string; size: string } | null {
	if (z <= 0) return null;
	const div = 2;
	const parentX = Math.floor(x / div);
	const parentY = Math.floor(y / div);
	return {
		url: `https://tile.openstreetmap.org/${z - 1}/${parentX}/${parentY}.png`,
		position: `${(x % div) * 100}% ${(y % div) * 100}%`,
		size: `${div * 100}% ${div * 100}%`,
	};
}

function bestRank(pins: readonly MapPin[]): number {
	let best = Number.POSITIVE_INFINITY;
	for (const pin of pins) {
		if (pin.rank < best) best = pin.rank;
	}
	return best;
}

function rafOrNow(fn: () => void): number {
	if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => { fn(); });
	fn();
	return 0;
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function spread(values: number[]): number {
	if (values.length === 0) return 0;
	return Math.max(...values) - Math.min(...values);
}

/** Phone hub stack. Obsidian mobile has no workspace splits. */
export function mountEmbeddedMap(
	parent: HTMLElement,
	host: MapHost,
): {
	destroy(): void;
	refresh(): void;
	focus(path: string | null, center: boolean, source?: 'follow' | 'card'): void;
	applyRenderedOrder(paths: readonly string[]): void;
	invalidateSize(): void;
} {
	const map = Object.create(RvMapView.prototype) as RvMapView;
	map.contentEl = parent;
	map.bindHost(host, 'hub');
	void map.onOpen();
	return {
		destroy: () => { void map.onClose(); },
		refresh: () => { map.recenter(); },
		focus: (path, center, source) => { map.focusPath(path, center, source); },
		applyRenderedOrder: (paths: readonly string[]) => { map.applyRenderedOrder(paths); },
		invalidateSize: () => { map.invalidateSize(); },
	};
}

function pointerSpan(pointers: ReadonlyMap<number, { x: number; y: number }>): number {
	const points = [...pointers.values()];
	const a = points[0];
	const b = points[1];
	if (!a || !b) return 0;
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function niceMeters(meters: number): number {
	const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
	let best = steps[0] ?? 100;
	for (const step of steps) {
		if (step <= meters) best = step;
	}
	return best;
}

function tileYToLat(y: number, zoom: number): number {
	const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
	return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
