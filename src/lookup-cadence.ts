/** First lookup, even while they are still typing. */
export const ADDRESS_LOOKUP_START = 6;
/** Further lookups while typing, measured from the last query that was sent. */
export const ADDRESS_LOOKUP_EVERY = 5;
/** One more lookup after they pause, when the last stretch missed a boundary. */
export const ADDRESS_LOOKUP_IDLE_MS = 450;

/**
 * `now` sends immediately. `idle` waits for a pause. `wait` sends nothing.
 * Shorter than the start length never sends. A burst still has to pass the
 * in-flight guard before a second request leaves.
 */
export function addressLookupDecision(sentLength: number, length: number): 'now' | 'idle' | 'wait' {
	if (length < ADDRESS_LOOKUP_START) return 'wait';
	const sent = Math.max(0, sentLength);
	if (sent < ADDRESS_LOOKUP_START) return 'now';
	if (length >= sent + ADDRESS_LOOKUP_EVERY) return 'now';
	return 'idle';
}
