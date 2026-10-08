import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import { GEOAPIFY_ATTRIBUTION, OSM_ATTRIBUTION } from './constants';
import { mountUrgencyGlyph } from './glancable-view';
import { clusterAppearance, latToTileY, lonToTileX, mapPressIsClick, popupClearOfChrome, pinStackZ, rankPinsFromRenderedList, zoomToRevealPin, type MapPin } from './map-pins';
import { urgencyMark } from './scoring';
import type { RVLocatorSettings } from './types';
import { urgencyInk } from './urgency-palette';

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
	private selectedPath: string | null = null;
	private detachMap: (() => void) | null = null;
	private stageObserver: ResizeObserver | null = null;
	/** Fullscreen pin tap only. Card taps and split taps never set this. */
	private popupPath: string | null = null;
	private flashPath: string | null = null;
	private flashUntil = 0;
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
				const steps = Math.round(Math.log2(pointerSpan(pointers) / pinchDistance));
				if (steps !== 0) this.setZoom(pinchZoom + steps);
				return;
			}
			if (!this.drag) return;
			const dx = event.clientX - this.drag.x;
			const dy = event.clientY - this.drag.y;
			if (!this.drag.moved) {
				if (mapPressIsClick(dx, dy)) return;
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
		stage.addEventListener('pointerleave', () => {
			this.drag = null;
			pointers.clear();
			pinchZoom = null;
			stage.removeClass('is-grabbing');
		});
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
			this.setZoom(this.zoom + (event.deltaY < 0 ? 1 : -1));
		}, { passive: false });
	}

	private setZoom(zoom: number): void {
		this.zoom = Math.max(3, Math.min(18, Math.round(zoom)));
		this.paint();
	}

	private paint(): void {
		const stage = this.stage;
		const pins = this.pinLayer;
		if (!stage || !pins) return;
		const width = stage.clientWidth || 640;
		const height = stage.clientHeight || 480;
		stage.querySelectorAll('.rv-map-tile').forEach((node) => node.remove());
		const scale = 2 ** this.zoom;
		const cx = lonToTileX(this.centerLon, this.zoom);
		const cy = latToTileY(this.centerLat, this.zoom);
		const left = Math.floor(cx - width / 2 / TILE);
		const right = Math.floor(cx + width / 2 / TILE);
		const top = Math.floor(cy - height / 2 / TILE);
		const bottom = Math.floor(cy + height / 2 / TILE);
		for (let x = left; x <= right; x += 1) {
			for (let y = top; y <= bottom; y += 1) {
				if (y < 0 || y >= scale) continue;
				const wrapped = ((x % scale) + scale) % scale;
				const tile = stage.ownerDocument.createElement('img');
				tile.className = 'rv-map-tile';
				tile.alt = '';
				tile.src = `https://tile.openstreetmap.org/${this.zoom}/${wrapped}/${y}.png`;
				const px = (x - cx) * TILE + width / 2;
				const py = (y - cy) * TILE + height / 2;
				tile.style.left = `${px}px`;
				tile.style.top = `${py}px`;
				stage.insertBefore(tile, pins);
			}
		}
		pins.empty();
		if (this.user) this.paintUser(pins, width, height, cx, cy);
		const placed = this.pins.map((pin) => ({ pin, point: this.project(pin.lat, pin.lon, width, height, cx, cy) }));
		if (this.zoom <= 12) this.paintClusters(pins, placed);
		else {
			const stacked = [...placed].sort((a, b) => b.pin.rank - a.pin.rank);
			for (const item of stacked) this.paintPin(pins, item.pin, item.point);
		}
		const popup = this.popupPath && this.zoom > 12 && this.isFullscreen()
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

	private paintPin(layer: HTMLElement, pin: MapPin, point: { x: number; y: number }): void {
		const selected = this.selectedPath === pin.path;
		const ghost = pin.stateIcon != null;
		const button = layer.createEl('button', {
			cls: `rv-map-pin${ghost ? ' is-fresh' : ''}${selected ? ' is-selected' : ''}`,
			attr: { type: 'button', 'aria-label': pin.name },
		});
		button.style.setProperty('--pin-color', pin.color);
		button.style.setProperty('--rv-urgency-accent', pin.color);
		if (pin.stateIcon) {
			button.dataset.pinState = pin.stateIcon;
			setIcon(button, pin.stateIcon);
		} else if (pin.shadeIcon) {
			setIcon(button, pin.shadeIcon);
		} else if (pin.markText) {
			button.createSpan({ cls: 'rv-pin-mark', text: pin.markText });
		} else mountUrgencyGlyph(button, pin.glyph);
		sizePinGlyph(button);
		button.style.left = `${point.x}px`;
		button.style.top = `${point.y}px`;
		button.style.zIndex = String(pinStackZ(pin.rank, selected));
		if (this.flashPath === pin.path && Date.now() < this.flashUntil) button.addClass('rv-pin-flash');
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.selectedPath = pin.path;
			if (this.isFullscreen()) {
				this.popupPath = pin.path;
				this.openCard(layer, pin, point);
				button.addClass('is-selected');
				return;
			}
			this.popupPath = null;
			this.host.notifyPin?.(pin.path);
			button.addClass('is-selected');
		});
	}

	private paintClusters(layer: HTMLElement, placed: { pin: MapPin; point: { x: number; y: number } }[]): void {
		const groups: { x: number; y: number; pins: MapPin[] }[] = [];
		const ordered = [...placed].sort((a, b) => a.pin.rank - b.pin.rank);
		for (const item of ordered) {
			const group = groups.find((entry) => Math.hypot(entry.x - item.point.x, entry.y - item.point.y) < 48);
			if (!group) {
				groups.push({ x: item.point.x, y: item.point.y, pins: [item.pin] });
				continue;
			}
			group.pins.push(item.pin);
			group.x = (group.x * (group.pins.length - 1) + item.point.x) / group.pins.length;
			group.y = (group.y * (group.pins.length - 1) + item.point.y) / group.pins.length;
		}
		const painted = [...groups].sort((a, b) => bestRank(b.pins) - bestRank(a.pins));
		for (const group of painted) {
			group.pins.sort((a, b) => a.rank - b.rank);
			if (group.pins.length === 1) {
				const only = group.pins[0];
				if (only) this.paintPin(layer, only, { x: group.x, y: group.y });
				continue;
			}
			const look = clusterAppearance(group.pins);
			const button = layer.createEl('button', {
				cls: `rv-map-cluster${look.ghost ? ' is-fresh' : ''}`,
				attr: { type: 'button', 'aria-label': `${group.pins.length} return visits` },
			});
			button.style.setProperty('--pin-color', look.color);
			button.textContent = String(group.pins.length);
			button.style.left = `${group.x}px`;
			button.style.top = `${group.y}px`;
			const top = group.pins[0];
			button.style.zIndex = String(pinStackZ(top ? top.rank : 0));
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				const lats = group.pins.map((pin) => pin.lat);
				const lons = group.pins.map((pin) => pin.lon);
				this.centerLat = average(lats);
				this.centerLon = average(lons);
				this.setZoom(this.zoom + 2);
			});
		}
	}

	private openCard(layer: HTMLElement, pin: MapPin, point: { x: number; y: number }): void {
		layer.querySelectorAll('.rv-map-card').forEach((node) => node.remove());
		const shell = layer.createDiv('rv-map-card rv-locator-glancable');
		const stage = this.stage;
		const origin = popupClearOfChrome(point, {
			width: 280,
			height: 180,
		}, {
			width: stage?.clientWidth || 640,
			height: stage?.clientHeight || 480,
		});
		shell.style.left = `${origin.left}px`;
		shell.style.top = `${origin.top}px`;
		shell.style.zIndex = String(pinStackZ(pin.rank, true) + 1);
		const marks = urgencyMark(pin.urgency, pin.priority);
		const card = shell.createDiv('rv-locator-card has-actions');
		card.style.setProperty('--rv-urgency-accent', pin.color);
		card.style.setProperty('--rv-urgency-ink', urgencyInk(pin.color));
		card.style.setProperty('--rv-badge-count', '3');
		card.style.setProperty('--rv-font-scale', '1');
		card.style.setProperty('--rv-icon-scale', '1.2');
		card.style.setProperty('--rv-control-size', `${MAP_POPUP_BADGE_PX}px`);
		card.addEventListener('click', (event) => {
			const target = event.target;
			if (target instanceof Element && target.closest('a, button')) return;
			event.preventDefault();
			event.stopPropagation();
		});
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
		const when = card.createDiv('rv-locator-when');
		const dates = pin.card.driveDates ?? [];
		if (dates.length > 0) {
			for (const date of dates) this.dateSlot(when, date);
		} else {
			if (pin.card.study) this.cardSlot(when, 'book-marked', pin.card.studied ? `Studied ${pin.card.studied}` : 'Studied —', !pin.card.studied);
			else {
				if (pin.card.spoke) this.cardSlot(when, 'message-circle', `Spoke ${pin.card.spoke}`, false);
				if (pin.card.attempted) this.cardSlot(when, 'clock', `Attempted ${pin.card.attempted}`, false);
			}
			if (pin.card.met) this.cardSlot(when, 'home', `Met ${pin.card.met}`, false);
		}
		const foot = card.createDiv('rv-locator-card-foot');
		this.cardSlot(foot, 'user', pin.card.metWith || '—', !pin.card.metWith);
		const ratio = pin.card.study ? pin.card.studyRatio : pin.card.visits;
		if (ratio) this.cardSlot(foot, pin.card.study ? 'percent' : 'list-checks', ratio, false);
		const actions = card.createSpan('rv-locator-card-actions');
		const urgency = actions.createSpan({
			cls: 'rv-locator-urgency',
			attr: { 'data-band': String(marks.band), 'aria-label': 'Urgency' },
		});
		mountUrgencyGlyph(urgency, marks.glyphs);
		actions.createSpan({
			cls: 'rv-locator-priority-pill',
			text: String(pin.priority),
			attr: { 'aria-label': `Priority ${pin.priority}` },
		});
		const route = actions.createEl('button', {
			cls: 'rv-locator-map-pin',
			attr: { type: 'button', 'aria-label': 'Directions' },
		});
		setIcon(route, 'route');
		route.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.host.openRoute(pin.path);
		});
	}

	private dateSlot(parent: HTMLElement, date: { icon: string; dow: string; time: string; rest: string; days: string }): void {
		const slot = parent.createSpan('rv-locator-slot is-dated');
		const iconEl = slot.createSpan('rv-locator-slot-icon');
		setIcon(iconEl, date.icon);
		const wrap = slot.createSpan('rv-locator-date');
		const clock = wrap.createSpan('rv-locator-clock');
		clock.createSpan({ cls: 'rv-locator-dow', text: date.dow });
		if (date.time) clock.createSpan({ cls: 'rv-locator-time', text: `, ${date.time}` });
		if (date.rest) wrap.createSpan({ cls: 'rv-locator-cal', text: date.rest });
		if (date.days) slot.createSpan({ cls: 'rv-locator-days', text: date.days });
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

/** Fullscreen popup badges. Larger than the 28px hub badges; card text stays at font scale 1. */
export const MAP_POPUP_BADGE_PX = 38;

/**
 * Map pin diameter. 15% over the original 42px pin, before the 50% enlargement.
 * Popup badges stay {@link MAP_POPUP_BADGE_PX}. Hub badges stay 28px.
 */
export const MAP_PIN_PX = 48;

/** 15% over the original 18px glyph. Bang marks and ghost hourglass/ban icons. */
export const MAP_PIN_GLYPH_PX = 21;

/** 15% over the original 46px cluster. */
export const MAP_CLUSTER_PX = 53;

/** Force pin icons past `svg { width: 1em }`, which followed the 22px pin font-size. */
export function sizePinGlyph(host: HTMLElement): void {
	host.querySelectorAll('svg').forEach((node) => {
		if (!(node instanceof SVGElement)) return;
		node.style.setProperty('width', `${MAP_PIN_GLYPH_PX}px`, 'important');
		node.style.setProperty('height', `${MAP_PIN_GLYPH_PX}px`, 'important');
	});
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
	const shell = {
		contentEl: parent,
		host,
		centerLat: 28.54,
		centerLon: -81.38,
		zoom: 13,
		pins: [] as MapPin[],
		user: null as { lat: number; lon: number } | null,
		stage: null as HTMLElement | null,
		pinLayer: null as HTMLElement | null,
		watchId: null as number | null,
		drag: null as { x: number; y: number; lat: number; lon: number; moved: boolean } | null,
		selectedPath: null as string | null,
		renderedPaths: null as readonly string[] | null,
		scaleEl: null as HTMLElement | null,
		scaleBarEl: null as HTMLElement | null,
		detachMap: null as (() => void) | null,
		mapFullscreen: false,
		fullscreenScope: 'hub' as const,
	};
	const map = Object.assign(Object.create(RvMapView.prototype), shell) as RvMapView;
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
