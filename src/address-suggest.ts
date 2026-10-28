import type { GeocodeHit } from './types';

export const ADDRESS_SUGGEST_MIN_CHARS = 3;
export const ADDRESS_SUGGEST_DEBOUNCE_MS = 200;
export const ADDRESS_SUGGEST_MAX_WAIT_MS = 350;
export const ADDRESS_SUGGEST_MAX_IN_FLIGHT = 2;
export const ADDRESS_SUGGEST_MAX_PER_SEC = 3;
/** Home autocomplete hits at or above this skip the wider query. */
export const ADDRESS_SUGGEST_HOME_ENOUGH = 3;
/** Circle around home or the current fix for the first pass. About 50 miles. */
export const ADDRESS_SUGGEST_HOME_RADIUS_M = 80_000;

export interface SuggestClock {
	now(): number;
	schedule(ms: number, run: () => void): number;
	cancel(id: number): void;
}

export interface SuggestFetchResult {
	hits: readonly GeocodeHit[];
	/** False when there is no home or location bias, so a second call would repeat the first. */
	allowBroad: boolean;
}

export interface SuggestFetch {
	home(query: string): Promise<SuggestFetchResult>;
	broad(query: string): Promise<readonly GeocodeHit[]>;
}

export interface SuggestView {
	hits: GeocodeHit[];
	loading: boolean;
}

export function normalizeSuggestQuery(value: string): string {
	return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Rank hits against the text on screen. A token may be a prefix of a word. */
export function filterAddressHits(hits: readonly GeocodeHit[], typed: string): GeocodeHit[] {
	const needle = normalizeSuggestQuery(typed);
	if (!needle) return [...hits];
	const tokens = needle.split(' ').filter(Boolean);
	const scored = hits.map((hit, index) => ({
		hit,
		index,
		score: scoreAddress(hit.formattedAddress, needle, tokens),
	}));
	return scored
		.filter((row) => row.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((row) => row.hit);
}

function scoreAddress(address: string, needle: string, tokens: readonly string[]): number {
	const text = address.toLowerCase();
	if (!text) return 0;
	let score = 0;
	if (text.includes(needle)) score += 10;
	for (const token of tokens) {
		if (text.includes(token)) score += 2;
		else if (text.split(/[^a-z0-9]+/).some((word) => word.startsWith(token))) score += 1;
		else return 0;
	}
	if (text.startsWith(needle)) score += 3;
	return score;
}

/**
 * Exact cache, or a shorter cached query whose hits all still contain the longer text.
 * Null means the server should be asked.
 */
export function prefixCacheCovers(
	query: string,
	cache: ReadonlyMap<string, readonly GeocodeHit[]>,
): GeocodeHit[] | null {
	const key = normalizeSuggestQuery(query);
	if (key.length < ADDRESS_SUGGEST_MIN_CHARS) return null;
	const exact = cache.get(key);
	if (exact) return [...exact];
	let best = '';
	for (const cached of cache.keys()) {
		if (key.startsWith(cached) && cached.length > best.length) best = cached;
	}
	if (!best) return null;
	const filtered = filterAddressHits(cache.get(best) ?? [], query);
	if (filtered.length === 0) return null;
	if (filtered.every((hit) => hit.formattedAddress.toLowerCase().includes(key))) return filtered;
	return null;
}

export function mergeHomeFirst(home: readonly GeocodeHit[], broad: readonly GeocodeHit[]): GeocodeHit[] {
	const seen = new Set<string>();
	const out: GeocodeHit[] = [];
	for (const hit of [...home, ...broad]) {
		const key = hit.formattedAddress.toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(hit);
	}
	return out;
}

interface BroadJob {
	gen: number;
	query: string;
	home: readonly GeocodeHit[];
}

/**
 * New RV address type-ahead.
 * Trailing debounce plus a max-wait so fast typing still looks up mid-word.
 * Older responses render when they are still the newest result on screen,
 * filtered to the current text. A newer rendered response is never overwritten.
 * At most two requests are in flight and three start per second.
 */
export class AddressSuggestController {
	private inFlight = 0;
	private sentAt: number[] = [];
	private renderedGen = 0;
	private nextGen = 1;
	private latest = '';
	private queued: string | null = null;
	private pendingBroad: BroadJob | null = null;
	private trailing: number | null = null;
	private maxWait: number | null = null;
	private rateTimer: number | null = null;
	private lastFireAt = 0;
	private lastHits: GeocodeHit[] = [];
	private requests = 0;

	constructor(
		private clock: SuggestClock,
		private fetchers: SuggestFetch,
		private onView: (view: SuggestView) => void,
		private cache: Map<string, GeocodeHit[]> = new Map(),
	) {}

	/** Requests that left for the provider. Cache hits are not counted. */
	requestCount(): number {
		return this.requests;
	}

	push(query: string): void {
		this.latest = query;
		const key = normalizeSuggestQuery(query);
		if (key.length < ADDRESS_SUGGEST_MIN_CHARS) {
			this.clearTimers();
			this.queued = null;
			this.publish(false);
			return;
		}
		const local = prefixCacheCovers(query, this.cache);
		if (local) {
			this.clearTimers();
			this.queued = null;
			this.lastHits = local;
			this.publish(this.inFlight > 0 || this.pendingBroad != null);
			return;
		}
		this.armTimers();
		this.publish(true);
	}

	dispose(): void {
		this.clearTimers();
		if (this.rateTimer != null) this.clock.cancel(this.rateTimer);
		this.rateTimer = null;
	}

	private publish(loading: boolean): void {
		const matched = filterAddressHits(this.lastHits, this.latest);
		const hits = matched.length > 0 ? matched : (loading ? [...this.lastHits] : []);
		this.onView({ hits, loading });
	}

	private armTimers(): void {
		const now = this.clock.now();
		if (this.trailing != null) this.clock.cancel(this.trailing);
		this.trailing = this.clock.schedule(ADDRESS_SUGGEST_DEBOUNCE_MS, () => { this.fire(); });
		if (this.maxWait == null) {
			const elapsed = this.lastFireAt ? now - this.lastFireAt : 0;
			const delay = this.lastFireAt ? Math.max(0, ADDRESS_SUGGEST_MAX_WAIT_MS - elapsed) : ADDRESS_SUGGEST_MAX_WAIT_MS;
			this.maxWait = this.clock.schedule(delay, () => { this.fire(); });
		}
	}

	private fire(): void {
		this.clearTimers();
		const query = this.latest;
		if (normalizeSuggestQuery(query).length < ADDRESS_SUGGEST_MIN_CHARS) return;
		const local = prefixCacheCovers(query, this.cache);
		if (local) {
			this.lastHits = local;
			this.publish(this.inFlight > 0 || this.pendingBroad != null);
			return;
		}
		this.lastFireAt = this.clock.now();
		this.queued = query;
		this.pump();
	}

	private pump(): void {
		if (this.pendingBroad && this.canSend()) {
			const job = this.pendingBroad;
			this.pendingBroad = null;
			void this.sendBroad(job);
			return;
		}
		const query = this.queued;
		if (!query) return;
		if (normalizeSuggestQuery(query).length < ADDRESS_SUGGEST_MIN_CHARS) {
			this.queued = null;
			return;
		}
		const local = prefixCacheCovers(this.latest, this.cache);
		if (local) {
			this.queued = null;
			this.lastHits = local;
			this.publish(this.inFlight > 0 || this.pendingBroad != null);
			return;
		}
		if (!this.canSend()) {
			this.queued = this.latest;
			this.armRateRetry();
			this.publish(true);
			return;
		}
		this.queued = null;
		void this.sendHome(this.latest);
	}

	private canSend(): boolean {
		if (this.inFlight >= ADDRESS_SUGGEST_MAX_IN_FLIGHT) return false;
		this.pruneRate();
		return this.sentAt.length < ADDRESS_SUGGEST_MAX_PER_SEC;
	}

	private pruneRate(): void {
		const now = this.clock.now();
		this.sentAt = this.sentAt.filter((at) => now - at < 1000);
	}

	private armRateRetry(): void {
		if (this.rateTimer != null) return;
		this.pruneRate();
		const oldest = this.sentAt[0];
		const wait = oldest == null ? 40 : Math.max(20, 1000 - (this.clock.now() - oldest) + 5);
		this.rateTimer = this.clock.schedule(wait, () => {
			this.rateTimer = null;
			this.pump();
		});
	}

	private async sendHome(query: string): Promise<void> {
		const gen = this.nextGen++;
		this.inFlight += 1;
		this.requests += 1;
		this.sentAt.push(this.clock.now());
		this.publish(true);
		let result: SuggestFetchResult = { hits: [], allowBroad: false };
		try {
			result = await this.fetchers.home(query);
		} catch {
			result = { hits: [], allowBroad: false };
		}
		this.inFlight -= 1;
		this.noteHome(gen, query, result);
	}

	private noteHome(gen: number, query: string, result: SuggestFetchResult): void {
		const hits = [...result.hits];
		this.cache.set(normalizeSuggestQuery(query), hits);
		if (gen < this.renderedGen) {
			this.pump();
			return;
		}
		this.applyHits(gen, hits);
		const needBroad = result.allowBroad && hits.length < ADDRESS_SUGGEST_HOME_ENOUGH;
		if (needBroad) {
			const job: BroadJob = { gen, query, home: hits };
			if (this.canSend()) void this.sendBroad(job);
			else {
				this.pendingBroad = job;
				this.armRateRetry();
				this.publish(true);
			}
			return;
		}
		this.pump();
	}

	private async sendBroad(job: BroadJob): Promise<void> {
		this.inFlight += 1;
		this.requests += 1;
		this.sentAt.push(this.clock.now());
		this.publish(true);
		let broad: readonly GeocodeHit[] = [];
		try {
			broad = await this.fetchers.broad(job.query);
		} catch {
			broad = [];
		}
		this.inFlight -= 1;
		const merged = mergeHomeFirst(job.home, broad);
		this.cache.set(normalizeSuggestQuery(job.query), merged);
		if (job.gen < this.renderedGen) {
			this.pump();
			return;
		}
		this.applyHits(job.gen, merged);
		this.pump();
	}

	private applyHits(gen: number, hits: readonly GeocodeHit[]): void {
		if (gen < this.renderedGen) return;
		const filtered = filterAddressHits(hits, this.latest);
		if (filtered.length > 0) this.lastHits = [...hits];
		this.renderedGen = gen;
		this.publish(this.inFlight > 0 || this.queued != null || this.pendingBroad != null);
	}

	private clearTimers(): void {
		if (this.trailing != null) this.clock.cancel(this.trailing);
		if (this.maxWait != null) this.clock.cancel(this.maxWait);
		this.trailing = null;
		this.maxWait = null;
	}
}
