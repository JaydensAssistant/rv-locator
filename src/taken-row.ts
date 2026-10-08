export interface TakenLayout {
	/** Met With person, pinned so they stay on screen. Null when Taken does not include them. */
	met: string | null;
	/** Names that may scroll. Excludes the pinned Met person and the pinned latest person. */
	scroll: string[];
	/** Latest Taken person, pinned. Null when they are the Met person, or Taken is empty. */
	recent: string | null;
}

/**
 * Met stays visible, and so does the latest Taken name.
 * Everyone else can scroll. One person who is both is shown once.
 */
/** Last entries shown before a Quick Facts list expands. Two-line clamp is applied on top of this. */
export function lastListEntries(items: readonly string[], limit = 3): string[] {
	const cleaned = items.map((item) => item.trim()).filter((item) => item.length > 0);
	return cleaned.slice(-limit);
}

export function layoutTakenNames(names: readonly string[], metWith: string): TakenLayout {
	const cleaned = names.map((name) => name.trim()).filter((name) => name.length > 0);
	if (cleaned.length === 0) return { met: null, scroll: [], recent: null };
	const metKey = metWith.trim().toLowerCase();
	const metIndex = metKey ? cleaned.findIndex((name) => name.toLowerCase() === metKey) : -1;
	const met = metIndex >= 0 ? cleaned[metIndex] ?? null : null;
	const lastIndex = cleaned.length - 1;
	const recent = lastIndex !== metIndex ? cleaned[lastIndex] ?? null : null;
	const scroll = cleaned.filter((_, index) => index !== metIndex && index !== lastIndex);
	return { met, scroll, recent };
}
