import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import { OSM_ATTRIBUTION } from './constants';
import { latToTileY, lonToTileX, type MapPin } from './map-pins';
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
	private drag: { x: number; y: number; lat: number; lon: number } | null = null;
	private selectedPath: string | null = null;

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
		const bar = this.contentEl.createDiv('rv-map-bar');
		bar.createEl('h2', { text: 'Map' });
		const zoomIn = bar.createEl('button', { text: '+', attr: { type: 'button', 'aria-label': 'Zoom in' } });
		const zoomOut = bar.createEl('button', { text: '−', attr: { type: 'button', 'aria-label': 'Zoom out' } });
		const fit = bar.createEl('button', { attr: { type: 'button', 'aria-label': 'Fit all pins' } });
		setIcon(fit, 'maximize');
		const locate = bar.createEl('button', { attr: { type: 'button', 'aria-label': 'My location' } });
		setIcon(locate, 'locate');
		zoomIn.addEventListener('click', () => this.setZoom(this.zoom + 1));
		zoomOut.addEventListener('click', () => this.setZoom(this.zoom - 1));
		fit.addEventListener('click', () => this.fitAll());
		locate.addEventListener('click', () => this.locateMe());
		this.stage = this.contentEl.createDiv('rv-map-stage');
		this.pinLayer = this.stage.createDiv('rv-map-pins');
		const credit = this.contentEl.createDiv('rv-map-credit');
		const link = credit.createEl('a', {
			text: OSM_ATTRIBUTION,
			href: 'https://www.openstreetmap.org/copyright',
		});
		link.setAttr('rel', 'noopener');
		this.pins = this.host.listMapPins();
		this.user = this.host.currentMapFix();
		this.centerOnOpen();
		this.bindStage();
		this.paint();
		this.watchLocation();
	}

	async onClose(): Promise<void> {
		if (this.watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
			navigator.geolocation.clearWatch(this.watchId);
		}
		this.watchId = null;
	}

	/** Called when an already-open map is asked to center again. */
	recenter(): void {
		this.pins = this.host.listMapPins();
		this.user = this.host.currentMapFix() ?? this.user;
		this.centerOnOpen();
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
		stage.addEventListener('pointerdown', (event) => {
			if (event.target instanceof Element && event.target.closest('.rv-map-pin, .rv-map-card, .rv-map-cluster')) return;
			this.drag = { x: event.clientX, y: event.clientY, lat: this.centerLat, lon: this.centerLon };
			stage.addClass('is-grabbing');
		});
		stage.addEventListener('pointermove', (event) => {
			if (!this.drag) return;
			const scale = TILE * 2 ** this.zoom;
			const dx = event.clientX - this.drag.x;
			const dy = event.clientY - this.drag.y;
			this.centerLon = this.drag.lon - (dx / scale) * 360;
			const startY = latToTileY(this.drag.lat, this.zoom);
			const nextY = startY - dy / TILE;
			this.centerLat = tileYToLat(nextY, this.zoom);
			this.paint();
		});
		const end = (): void => {
			this.drag = null;
			stage.removeClass('is-grabbing');
		};
		stage.addEventListener('pointerup', end);
		stage.addEventListener('pointerleave', end);
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
			for (const item of placed) this.paintPin(pins, item.pin, item.point);
		}
		const selected = this.selectedPath ? placed.find((item) => item.pin.path === this.selectedPath) : null;
		if (selected && this.zoom > 12) this.openCard(pins, selected.pin, selected.point);
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
		const button = layer.createEl('button', {
			cls: `rv-map-pin${pin.fresh ? ' is-fresh' : ''}${selected ? ' is-selected' : ''}`,
			attr: { type: 'button', 'aria-label': pin.name },
		});
		button.style.setProperty('--pin-color', pin.color);
		button.style.color = pin.fresh ? pin.color : urgencyInk(pin.color);
		if (!pin.fresh) button.style.background = pin.color;
		button.textContent = pin.glyph;
		button.style.left = `${point.x}px`;
		button.style.top = `${point.y}px`;
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.selectedPath = pin.path;
			this.openCard(layer, pin, point);
			button.addClass('is-selected');
		});
	}

	private paintClusters(layer: HTMLElement, placed: { pin: MapPin; point: { x: number; y: number } }[]): void {
		const groups: { x: number; y: number; pins: MapPin[] }[] = [];
		for (const item of placed) {
			const group = groups.find((entry) => Math.hypot(entry.x - item.point.x, entry.y - item.point.y) < 48);
			if (!group) {
				groups.push({ x: item.point.x, y: item.point.y, pins: [item.pin] });
				continue;
			}
			group.pins.push(item.pin);
			group.x = (group.x * (group.pins.length - 1) + item.point.x) / group.pins.length;
			group.y = (group.y * (group.pins.length - 1) + item.point.y) / group.pins.length;
		}
		for (const group of groups) {
			if (group.pins.length === 1) {
				const only = group.pins[0];
				if (only) this.paintPin(layer, only, { x: group.x, y: group.y });
				continue;
			}
			const button = layer.createEl('button', {
				cls: 'rv-map-cluster',
				attr: { type: 'button', 'aria-label': `${group.pins.length} return visits` },
			});
			button.textContent = String(group.pins.length);
			button.style.left = `${group.x}px`;
			button.style.top = `${group.y}px`;
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
		const card = layer.createDiv('rv-map-card rv-locator-card');
		card.style.left = `${point.x + 28}px`;
		card.style.top = `${point.y}px`;
		card.style.setProperty('--rv-urgency-accent', pin.color);
		card.style.setProperty('--rv-urgency-ink', urgencyInk(pin.color));
		const head = card.createDiv('rv-map-card-head');
		head.createEl('strong', { text: pin.name });
		const badges = head.createDiv('rv-map-card-badges');
		const urgency = badges.createSpan('rv-map-badge rv-map-action');
		urgency.style.background = pin.color;
		urgency.style.color = urgencyInk(pin.color);
		urgency.setText(pin.glyph);
		urgency.setAttr('aria-label', 'Urgency');
		const priority = badges.createSpan({ cls: 'rv-map-badge rv-map-action is-priority', text: String(pin.priority) });
		priority.style.background = pin.color;
		priority.style.color = urgencyInk(pin.color);
		priority.setAttr('aria-label', `Priority ${pin.priority}`);
		const route = badges.createEl('button', {
			cls: 'rv-map-badge rv-map-action',
			attr: { type: 'button', 'aria-label': 'Directions in Google Maps' },
		});
		setIcon(route, 'route');
		route.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void this.host.openRoute(pin.path);
		});
		const open = badges.createEl('button', {
			cls: 'rv-map-badge rv-map-action',
			attr: { type: 'button', 'aria-label': 'Open note' },
		});
		setIcon(open, 'file-text');
		open.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.host.openMapNote(pin.path);
		});
		this.cardLine(card, 'map-pin', pin.card.address || '—');
		if (pin.card.city) this.cardLine(card, 'building-2', pin.card.city);
		if (pin.card.study) this.cardLine(card, 'book-marked', pin.card.studied ? `Studied ${pin.card.studied}` : 'Studied —');
		else {
			if (pin.card.spoke) this.cardLine(card, 'message-circle', `Spoke ${pin.card.spoke}`);
			if (pin.card.attempted) this.cardLine(card, 'clock', `Attempted ${pin.card.attempted}`);
		}
		if (pin.card.met) this.cardLine(card, 'home', `Met ${pin.card.met}`);
		this.cardLine(card, 'user', pin.card.metWith || '—');
		this.cardLine(card, 'list-checks', pin.card.study ? pin.card.studyRatio : pin.card.visits);
		this.cardLine(card, 'book-open', pin.card.literature || '—');
		this.cardLine(card, 'clapperboard', pin.card.media || '—');
		if (pin.card.study) {
			card.createDiv({ cls: 'rv-map-section', text: 'Lessons Studied' });
			const lessons = pin.card.lessons.length ? pin.card.lessons : ['—'];
			for (const lesson of lessons) this.cardLine(card, 'book-marked', lesson);
		}
	}

	private cardLine(card: HTMLElement, icon: string, text: string): void {
		const row = card.createDiv('rv-map-fact');
		const mark = row.createSpan('rv-map-fact-icon');
		setIcon(mark, icon);
		row.createSpan({ cls: 'rv-map-fact-text', text });
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

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function spread(values: number[]): number {
	if (values.length === 0) return 0;
	return Math.max(...values) - Math.min(...values);
}

function tileYToLat(y: number, zoom: number): number {
	const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
	return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
