import { assignProperty, readProperty, removeProperty } from './frontmatter';

/** Compare a cached property with the value pinned at the visit write. */
export function pinnedText(value: unknown): string {
	if (value == null) return '';
	if (Array.isArray(value)) return value.map((item) => pinnedText(item)).join('\u0000');
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
	return String(value).trim();
}

/** True when every pinned field is already present on the raw parse. */
export function pinMatches(incoming: Record<string, unknown>, pinned: Record<string, unknown>): boolean {
	return Object.entries(pinned).every(([key, value]) => pinnedText(readProperty(incoming, key)) === pinnedText(value));
}

/**
 * A late `changed` event from the body write must not replace a newer pin.
 * The pin clears only when the raw parse itself matches. Until then the
 * stored cache keeps the pinned fields.
 */
export function storeFrontmatter(
	incoming: Record<string, unknown>,
	pinned: Record<string, unknown> | null,
): { stored: Record<string, unknown>; clearPin: boolean } {
	if (!pinned) return { stored: { ...incoming }, clearPin: false };
	if (pinMatches(incoming, pinned)) return { stored: { ...incoming }, clearPin: true };
	const stored = { ...incoming };
	for (const [key, value] of Object.entries(pinned)) assignProperty(stored, key, value);
	return { stored, clearPin: false };
}

/**
 * Overlay a status, priority, or snooze pin onto a late cache parse.
 * An empty pin value removes that key. Returns true when the parse already matches.
 */
export function applyHeadPin(stored: Record<string, unknown>, head: Record<string, unknown> | null): boolean {
	if (!head) return false;
	if (pinMatches(stored, head)) return true;
	for (const [key, value] of Object.entries(head)) {
		if (value == null || value === '') removeProperty(stored, key);
		else assignProperty(stored, key, value);
	}
	return false;
}
