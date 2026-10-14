export interface ReadingOpenState {
	state?: Record<string, unknown>;
}

/** The state a leaf should receive so the first paint is Reading view. */
export function withReadingPreview<T extends ReadingOpenState>(open: T | undefined): T {
	const base = open ?? ({} as T);
	const state = base.state && typeof base.state === 'object' ? base.state : {};
	return { ...base, state: { ...state, mode: 'preview', source: false } };
}

/**
 * True when the leaf is navigating to a different file.
 * A mode toggle on the note that is already open keeps the same path.
 */
export function navigatingToFile(currentPath: string, nextPath: string): boolean {
	return nextPath.length > 0 && nextPath !== currentPath;
}
