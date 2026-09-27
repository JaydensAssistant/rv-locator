import { GEO_WATCH_INTERVAL_MS } from './constants';
import type { LatLon } from './types';

export type GeoStatus = 'pending' | 'ready' | 'denied' | 'unavailable' | 'unsupported';

export interface GeoState {
	status: GeoStatus;
	fix: LatLon | null;
}

/**
 * Live device position for an open Bases view.
 * Distance derived from this state is kept in memory only.
 */
export class LivePosition {
	private watchId: number | null = null;
	private intervalId: number | null = null;
	private state: GeoState = { status: 'pending', fix: null };
	private started = false;

	constructor(
		private win: Window,
		private onChange: (state: GeoState) => void,
	) {}

	start(): void {
		if (this.started) return;
		this.started = true;
		const geo = this.win.navigator?.geolocation;
		if (!geo) {
			this.state = { status: 'unsupported', fix: null };
			this.onChange(this.state);
			return;
		}

		const options: PositionOptions = {
			enableHighAccuracy: true,
			maximumAge: 15_000,
			timeout: 25_000,
		};
		this.watchId = geo.watchPosition(
			(position) => this.onSuccess(position),
			(error) => this.onError(error),
			options,
		);
		this.intervalId = this.win.setInterval(() => {
			geo.getCurrentPosition(
				(position) => this.onSuccess(position),
				(error) => this.onError(error),
				{
					enableHighAccuracy: true,
					maximumAge: 10_000,
					timeout: 20_000,
				},
			);
		}, GEO_WATCH_INTERVAL_MS);
		this.onChange(this.state);
	}

	stop(): void {
		if (!this.started && this.watchId == null && this.intervalId == null) return;
		this.started = false;
		const geo = this.win.navigator?.geolocation;
		if (this.watchId != null) {
			geo?.clearWatch(this.watchId);
			this.watchId = null;
		}
		if (this.intervalId != null) {
			this.win.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private onSuccess(position: GeolocationPosition): void {
		const lat = position.coords.latitude;
		const lon = position.coords.longitude;
		if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
		if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
		this.state = { status: 'ready', fix: { lat, lon } };
		this.onChange(this.state);
	}

	private onError(error: GeolocationPositionError): void {
		const denied = error.code === error.PERMISSION_DENIED;
		if (denied) {
			this.state = { status: 'denied', fix: null };
			this.onChange(this.state);
			return;
		}
		if (this.state.status === 'ready') return;
		this.state = { status: 'unavailable', fix: null };
		this.onChange(this.state);
	}
}
