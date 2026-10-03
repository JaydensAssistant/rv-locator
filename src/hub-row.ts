/** The hub every new note stores until a setting points the chip somewhere else. */
export const DEFAULT_RETURN_HUB = 'Return Visits Hub';

/**
 * The return-visit chip follows the setting. Any other hub keeps its stored target.
 * A note that still says Return Visits Hub opens the configured note.
 */
export function resolveReturnHub(ref: HubRef, configured: string): HubRef {
	const target = configured.trim() || DEFAULT_RETURN_HUB;
	const base = (ref.target.split('/').pop() ?? ref.target).replace(/\.md$/i, '');
	if (base !== DEFAULT_RETURN_HUB && base !== target && ref.label !== DEFAULT_RETURN_HUB) return ref;
	return { target, label: (target.split('/').pop() ?? target).replace(/\.md$/i, '') };
}

export interface HubRef {
	/** Wikilink target, including a folder when the note stores one. */
	target: string;
	label: string;
}

/** Display name for a Hub value. An alias wins. A path uses the note name. */
export function hubLabel(value: unknown): string {
	const ref = hubRef(value);
	return ref?.label ?? '';
}

export function hubRef(value: unknown): HubRef | null {
	const text = typeof value === 'string' ? value.trim().replace(/^["']|["']$/g, '') : '';
	if (!text) return null;
	const wiki = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(text);
	if (!wiki) return { target: text, label: text };
	const target = (wiki[1] ?? '').trim();
	if (!target) return null;
	const alias = wiki[2]?.trim();
	const base = (target.split('/').pop() ?? target).replace(/\.md$/i, '');
	return { target, label: alias || base };
}

/** Every hub on the note, in stored order. Nothing is dropped for width. */
export function hubRefs(value: unknown): HubRef[] {
	const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
	const refs: HubRef[] = [];
	for (const item of source) {
		const ref = hubRef(item);
		if (ref) refs.push(ref);
	}
	return refs;
}

/**
 * Move the hub with this label one place toward the start.
 * Returns null when it is already first or missing, so the note is not rewritten.
 */
/**
 * Keep every hub already on the note, then add a wikilink for each other person
 * at the same address. A name already listed is not added again.
 */
export function mergeHouseholdHubs(current: unknown, otherNames: readonly string[]): unknown[] {
	const list: unknown[] = [];
	if (Array.isArray(current)) {
		for (const item of current) list.push(item);
	} else if (current != null && current !== '') {
		list.push(current);
	}
	const seen = new Set(list.map((item) => hubLabel(item)));
	for (const name of otherNames) {
		const label = name.trim();
		if (!label || seen.has(label)) continue;
		seen.add(label);
		list.push(`[[${label}]]`);
	}
	return list;
}

export function moveHubLeft(items: readonly unknown[], label: string): unknown[] | null {
	const index = items.findIndex((item) => hubLabel(item) === label);
	if (index <= 0) return null;
	const next = [...items];
	const [item] = next.splice(index, 1);
	next.splice(index - 1, 0, item);
	return next;
}
