import { buildGeocodeUrl, parseGeocodeBody } from './address';
import type { GeoapifyRegion } from './constants';
import { CancelledError, RequestPacer } from './pacer';
import { redactSecrets } from './redact';
import type { GeocodeHit } from './types';

export class GeocodeRequestError extends Error {
	readonly status: number | null;
	readonly retryable: boolean;
	readonly retryAfterMs: number | null;

	constructor(message: string, status: number | null, retryable: boolean, retryAfterMs: number | null = null) {
		super(message);
		this.name = 'GeocodeRequestError';
		this.status = status;
		this.retryable = retryable;
		this.retryAfterMs = retryAfterMs;
	}
}

export interface GeocodeDeps {
	fetchImpl: typeof fetch;
	sleep: (ms: number) => Promise<void>;
	pacer: RequestPacer;
	aborted: () => boolean;
}

const MAX_RETRIES = 3;

/**
 * Look up one address with direct fetch. Retries 429 and 5xx with backoff.
 * The request URL contains only the address plus Geoapify protocol fields.
 */
export async function geocodeAddress(
	address: string,
	apiKey: string,
	deps: GeocodeDeps,
	region: GeoapifyRegion = 'global',
): Promise<GeocodeHit[]> {
	let attempt = 0;
	for (;;) {
		if (deps.aborted()) {
			throw new CancelledError();
		}
		await deps.pacer.wait(deps.sleep, () => deps.aborted());
		try {
			return await fetchGeocodeResults(address, apiKey, deps.fetchImpl, region);
		} catch (error) {
			if (error instanceof CancelledError) throw error;
			const wrapped = asGeocodeError(error, apiKey);
			if (!wrapped.retryable || attempt >= MAX_RETRIES) throw wrapped;
			attempt += 1;
			const delay = wrapped.retryAfterMs ?? Math.min(30_000, 2000 * 2 ** (attempt - 1));
			deps.pacer.delayNext(delay);
		}
	}
}

export async function fetchGeocodeResults(
	address: string,
	apiKey: string,
	fetchImpl: typeof fetch,
	region: GeoapifyRegion = 'global',
): Promise<GeocodeHit[]> {
	let url: string;
	try {
		url = buildGeocodeUrl(address, apiKey, region);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Could not build the geocode request.';
		throw new GeocodeRequestError(redactSecrets(message, apiKey), null, false);
	}

	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: 'GET',
			headers: { Accept: 'application/json' },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Network error';
		throw new GeocodeRequestError(redactSecrets(message, apiKey), null, true);
	}

	if (response.status === 429) {
		throw new GeocodeRequestError('Geoapify rate limit (429).', 429, true, retryAfterMs(response));
	}
	if (response.status === 401 || response.status === 403) {
		throw new GeocodeRequestError(`Geoapify rejected the request (HTTP ${response.status}).`, response.status, false);
	}
	if (!response.ok) {
		throw new GeocodeRequestError(
			`Geoapify request failed (HTTP ${response.status}).`,
			response.status,
			response.status >= 500,
		);
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new GeocodeRequestError('Geoapify returned unreadable JSON.', response.status, true);
	}
	return parseGeocodeBody(body);
}

function asGeocodeError(error: unknown, apiKey: string): GeocodeRequestError {
	if (error instanceof GeocodeRequestError) return error;
	const message = error instanceof Error ? error.message : 'Geocoding failed.';
	return new GeocodeRequestError(redactSecrets(message, apiKey), null, false);
}

function retryAfterMs(response: Response): number | null {
	const header = response.headers.get('retry-after');
	if (!header) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const when = Date.parse(header);
	if (Number.isFinite(when)) return Math.max(0, when - Date.now());
	return null;
}
