export class CancelledError extends Error {
	constructor() {
		super('Cancelled.');
		this.name = 'CancelledError';
	}
}

export class RequestPacer {
	private nextSlot = 0;

	constructor(
		private gapMs: number,
		private now: () => number = Date.now,
	) {}

	async wait(sleep: (ms: number) => Promise<void>, aborted: () => boolean): Promise<void> {
		const now = this.now();
		const delay = Math.max(0, this.nextSlot - now);
		this.nextSlot = Math.max(now, this.nextSlot) + this.gapMs;
		if (delay > 0) await sleep(delay);
		if (aborted()) {
			throw new CancelledError();
		}
	}

	/** Push the following request out, used after an HTTP 429. */
	delayNext(ms: number): void {
		const at = this.now() + Math.max(0, ms);
		if (at > this.nextSlot) this.nextSlot = at;
	}
}
