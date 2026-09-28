import type { DistanceUnit, LatLon } from './types';

const EARTH_RADIUS_METERS = 6_371_008.8;
const METERS_PER_MILE = 1609.344;
const METERS_PER_KILOMETER = 1000;

/** Ideality always uses miles, even when Nearby is showing kilometers. */
export function milesFromMeters(meters: number): number {
	return meters / METERS_PER_MILE;
}

export function haversineMeters(from: LatLon, to: LatLon): number {
	const toRad = (degrees: number) => (degrees * Math.PI) / 180;
	const lat1 = toRad(from.lat);
	const lat2 = toRad(to.lat);
	const dLat = lat2 - lat1;
	const dLon = toRad(to.lon - from.lon);
	const h = Math.sin(dLat / 2) ** 2
		+ Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(meters: number, unit: DistanceUnit): string {
	if (!Number.isFinite(meters) || meters < 0) return '—';
	const value = unit === 'miles' ? meters / METERS_PER_MILE : meters / METERS_PER_KILOMETER;
	const suffix = unit === 'miles' ? 'mi' : 'km';
	if (value < 0.1) return `< 0.1 ${suffix}`;
	if (value < 10) return `${value.toFixed(1)} ${suffix}`;
	return `${Math.round(value)} ${suffix}`;
}

export function roundCoord(value: number): number {
	return Math.round(value * 1e7) / 1e7;
}

/**
 * Latitude or longitude as text for a YAML list of strings.
 * Up to 7 decimal places, no scientific notation, no trailing zeros.
 */
export function coordString(value: number): string {
	const rounded = roundCoord(value);
	if (!Number.isFinite(rounded)) return '0';
	const fixed = Math.abs(rounded).toFixed(7).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
	if (fixed === '0' || fixed === '') return '0';
	return rounded < 0 ? `-${fixed}` : fixed;
}

export function validLatLon(lat: number, lon: number): LatLon | null {
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
	return { lat, lon };
}

export function latLonFromUnknown(value: unknown): LatLon | null {
	if (Array.isArray(value) && value.length >= 2) {
		return validLatLon(numberOrNaN(value[0]), numberOrNaN(value[1]));
	}
	if (typeof value === 'string') {
		const text = value.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
		const match = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
		if (!match) return null;
		return validLatLon(Number(match[1]), Number(match[2]));
	}
	return null;
}

function numberOrNaN(value: unknown): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return Number(value);
	return Number.NaN;
}
