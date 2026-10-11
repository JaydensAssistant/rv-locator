/**
 * Index of map tiles the user has actually viewed.
 * Home tiles cover the return-visit box plus about 25 miles (0.35°).
 * County names are not a boundary: Home base stores names only.
 */

export const NON_HOME_CAP = 2000;
export const HOME_CAP = 20_000;
export const NON_HOME_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const TILE_BYTES_ESTIMATE = 16_000;
export const HOME_PAD_DEG = 0.35;

export interface TileRecord {
	key: string;
	z: number;
	x: number;
	y: number;
	home: boolean;
	lastViewed: number;
}

export interface HomeBox {
	south: number;
	north: number;
	west: number;
	east: number;
}

export interface TileIndexLimits {
	nonHomeCap: number;
	homeCap: number;
	ttlMs: number;
}

export const DEFAULT_TILE_LIMITS: TileIndexLimits = {
	nonHomeCap: NON_HOME_CAP,
	homeCap: HOME_CAP,
	ttlMs: NON_HOME_TTL_MS,
};

export function tileKey(z: number, x: number, y: number): string {
	return `${z}/${x}/${y}`;
}

export function homeBoxFromPoints(points: readonly { lat: number; lon: number }[], pad = HOME_PAD_DEG): HomeBox | null {
	const finite = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
	if (finite.length === 0) return null;
	let south = 90;
	let north = -90;
	let west = 180;
	let east = -180;
	for (const point of finite) {
		south = Math.min(south, point.lat);
		north = Math.max(north, point.lat);
		west = Math.min(west, point.lon);
		east = Math.max(east, point.lon);
	}
	return {
		south: Math.max(-85, south - pad),
		north: Math.min(85, north + pad),
		west: Math.max(-180, west - pad),
		east: Math.min(180, east + pad),
	};
}

export function tileCenter(z: number, x: number, y: number): { lat: number; lon: number } {
	const n = 2 ** z;
	const lon = (x + 0.5) / n * 360 - 180;
	const merc = Math.PI * (1 - 2 * (y + 0.5) / n);
	const lat = (180 / Math.PI) * Math.atan(Math.sinh(merc));
	return { lat, lon };
}

export function tileIsHome(z: number, x: number, y: number, box: HomeBox | null): boolean {
	if (!box) return false;
	const center = tileCenter(z, x, y);
	return center.lat >= box.south && center.lat <= box.north && center.lon >= box.west && center.lon <= box.east;
}

export function purgeExpired(records: readonly TileRecord[], now: number, ttlMs: number): TileRecord[] {
	return records.filter((record) => record.home || now - record.lastViewed < ttlMs);
}

/**
 * Remember one viewed tile. Non-home tiles expire and stop at their cap (LRU).
 * Home tiles skip that cap and expiry, then the safety cap drops the deepest
 * zoom first and the least recently viewed within that zoom.
 */
export function noteViewedTile(
	records: readonly TileRecord[],
	tile: { z: number; x: number; y: number; home: boolean },
	now: number,
	limits: TileIndexLimits = DEFAULT_TILE_LIMITS,
): TileRecord[] {
	const key = tileKey(tile.z, tile.x, tile.y);
	const next = purgeExpired(records, now, limits.ttlMs).filter((record) => record.key !== key);
	next.push({ key, z: tile.z, x: tile.x, y: tile.y, home: tile.home, lastViewed: now });
	return evict(next, limits);
}

function evict(records: TileRecord[], limits: TileIndexLimits): TileRecord[] {
	const home = records.filter((record) => record.home);
	let away = records.filter((record) => !record.home);
	away.sort((a, b) => b.lastViewed - a.lastViewed);
	if (away.length > limits.nonHomeCap) away = away.slice(0, limits.nonHomeCap);
	if (home.length <= limits.homeCap) return [...home, ...away];
	const ranked = [...home].sort((a, b) => {
		if (a.z !== b.z) return a.z - b.z;
		return b.lastViewed - a.lastViewed;
	});
	return [...ranked.slice(0, limits.homeCap), ...away];
}

const TILE_STORAGE_KEY = 'rv-locator-tile-index';

export function loadTileIndex(): TileRecord[] {
	try {
		const raw = globalThis.localStorage?.getItem(TILE_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is TileRecord => {
			if (!item || typeof item !== 'object') return false;
			const row = item as TileRecord;
			return typeof row.key === 'string' && typeof row.z === 'number' && typeof row.lastViewed === 'number';
		});
	} catch {
		return [];
	}
}

export function saveTileIndex(records: readonly TileRecord[]): void {
	try {
		globalThis.localStorage?.setItem(TILE_STORAGE_KEY, JSON.stringify(records));
	} catch {
		/* Private mode or a full disk. The session pool still paints. */
	}
}

export function clearTileIndex(): void {
	try {
		globalThis.localStorage?.removeItem(TILE_STORAGE_KEY);
	} catch {
		/* Nothing stored. */
	}
}

export function cacheStats(records: readonly TileRecord[]): { total: number; home: number; bytes: number; homeBytes: number } {
	const home = records.filter((record) => record.home).length;
	return {
		total: records.length,
		home,
		bytes: records.length * TILE_BYTES_ESTIMATE,
		homeBytes: home * TILE_BYTES_ESTIMATE,
	};
}
