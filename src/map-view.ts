import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import { OSM_ATTRIBUTION } from './constants';
import { latToTileY, lonToTileX, type MapPin } from './map-pins';
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
		zoomIn.addEventListener('click', () => this.setZoom(this.zoom + 1));
		zoomOut.addEventListener('click', () => this.setZoom(this.zoom - 1));
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
			this.drag = { x: event.clientX, y: event.clientY, lat: this.centerLat, lon: this.centerLon };
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
		const end = (): void => { this.drag = null; };
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
		for (const pin of this.pins) this.paintPin(pins, pin, width, height, cx, cy);
	}

	private paintUser(layer: HTMLElement, width: number, height: number, cx: number, cy: number): void {
		if (!this.user) return;
		const dot = layer.createDiv('rv-map-user');
		const point = this.project(this.user.lat, this.user.lon, width, height, cx, cy);
		dot.style.left = `${point.x}px`;
		dot.style.top = `${point.y}px`;
		dot.setAttr('title', 'Current location');
	}

	private paintPin(
		layer: HTMLElement,
		pin: MapPin,
		width: number,
		height: number,
		cx: number,
		cy: number,
	): void {
		const button = layer.createEl('button', {
			cls: `rv-map-pin${pin.fresh ? ' is-fresh' : ''}`,
			attr: { type: 'button', 'aria-label': pin.name },
		});
		button.style.background = pin.color;
		button.textContent = pin.glyph;
		const point = this.project(pin.lat, pin.lon, width, height, cx, cy);
		button.style.left = `${point.x}px`;
		button.style.top = `${point.y}px`;
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.openCard(layer, pin, point);
		});
	}

	private openCard(layer: HTMLElement, pin: MapPin, point: { x: number; y: number }): void {
		layer.querySelectorAll('.rv-map-card').forEach((node) => node.remove());
		const card = layer.createDiv('rv-map-card');
		card.style.left = `${point.x + 16}px`;
		card.style.top = `${point.y}px`;
		card.createEl('strong', { text: pin.name });
		const badges = card.createDiv('rv-map-card-badges');
		const urgency = badges.createSpan('rv-map-badge');
		urgency.style.background = pin.color;
		urgency.setText(pin.glyph);
		urgency.setAttr('aria-label', 'Urgency');
		const priority = badges.createSpan({ cls: 'rv-map-badge is-priority', text: String(pin.priority) });
		priority.setAttr('aria-label', `Priority ${pin.priority}`);
		const route = badges.createEl('button', {
			cls: 'rv-map-badge',
			attr: { type: 'button', 'aria-label': 'Route' },
		});
		setIcon(route, 'route');
		route.addEventListener('click', () => { void this.host.openRoute(pin.path); });
		const open = card.createEl('button', {
			cls: 'rv-map-open',
			text: 'Open note',
			attr: { type: 'button' },
		});
		setIcon(open, 'file-text');
		open.addEventListener('click', () => this.host.openMapNote(pin.path));
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

function tileYToLat(y: number, zoom: number): number {
	const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
	return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
