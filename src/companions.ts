import { readProperty } from './frontmatter';

/** Suggester length. The newest names are kept; older duplicates are dropped. */
export const RECENT_COMPANION_LIMIT = 24;

export interface CompanionMention {
	metWith: unknown;
	taken: unknown;
	/** Higher is more recent. */
	recentAt: number;
}

export interface CompanionNoteRef {
	path: string;
	basename: string;
}

export interface CompanionSuggestion {
	/** Name stored on the note. A typed row uses the typed text, not the “Use …” label. */
	value: string;
	label: string;
}

/**
 * Recent names that match the query, plus a leading “Use …” row when the
 * typed text is not already one of those names.
 */
export function companionChoices(recent: readonly string[], query: string): CompanionSuggestion[] {
	const typed = query.trim();
	const needle = typed.toLowerCase();
	const matches = recent.filter((name) => !needle || name.toLowerCase().includes(needle));
	const choices = matches.map((name) => ({ value: name, label: name }));
	if (typed && !matches.some((name) => name.toLowerCase() === needle)) {
		choices.unshift({ value: typed, label: `Use “${typed}”` });
	}
	return choices;
}

/**
 * Display text for a Met With / Taken value.
 * A wikilink uses its alias, otherwise the note basename.
 */
export function companionDisplayName(value: unknown): string {
	if (typeof value !== 'string') return '';
	const text = value.trim();
	if (!text) return '';
	const link = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(text);
	if (!link) return text;
	const alias = link[2]?.trim() ?? '';
	if (alias) return alias;
	const target = link[1]?.trim() ?? '';
	const base = target.split('/').pop() ?? target;
	return base.trim();
}

export function companionKey(value: string): string {
	return companionDisplayName(value).trim().toLowerCase();
}

export function takenItems(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((item) => (typeof item === 'string' ? item.trim() : ''))
			.filter((item) => item.length > 0);
	}
	if (typeof value === 'string' && value.trim()) return [value.trim()];
	return [];
}

/**
 * Newest notes first. On each note, Met With is read before Taken.
 * The same person (ignoring case and wikilink wrapping) is kept once,
 * using the name from the newest note.
 */
export function recentCompanionNames(
	notes: readonly CompanionMention[],
	limit = RECENT_COMPANION_LIMIT,
): string[] {
	const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : RECENT_COMPANION_LIMIT;
	const sorted = [...notes].sort((a, b) => b.recentAt - a.recentAt);
	const seen = new Set<string>();
	const names: string[] = [];
	for (const note of sorted) {
		const values = [note.metWith, ...takenItems(note.taken)];
		for (const raw of values) {
			const label = companionDisplayName(raw);
			if (!label) continue;
			const key = label.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			names.push(label);
			if (names.length >= cap) return names;
		}
	}
	return names;
}

/** Latest of Last Spoke, Last Attempted, Met, and the file modification time. */
export function companionRecency(
	frontmatter: Record<string, unknown> | null | undefined,
	mtime = 0,
): number {
	const stamps = ['Last Spoke', 'Last Attempted', 'Met']
		.map((key) => parseCompanionStamp(readProperty(frontmatter, key)))
		.filter((value): value is number => value != null);
	const latest = stamps.length > 0 ? Math.max(...stamps) : 0;
	const modified = Number.isFinite(mtime) ? mtime : 0;
	return Math.max(latest, modified);
}

/**
 * Append one companion to Taken. Wikilink and plain forms of the same name
 * count as one entry. An empty companion leaves the list unchanged.
 */
export function appendCompanionTaken(existing: unknown, companion: string): string[] {
	const items = takenItems(existing);
	const stored = companion.trim();
	if (!stored) return items;
	const key = companionKey(stored);
	if (!key || items.some((item) => companionKey(item) === key)) return items;
	return [...items, stored];
}

/**
 * When linking is on and exactly one note basename matches, store `[[Note Name]]`.
 * Several matches use the path form Obsidian accepts. Otherwise the plain name.
 */
export function formatStoredCompanion(
	name: string,
	linkToNotes: boolean,
	notes: readonly CompanionNoteRef[],
): string {
	const plain = companionDisplayName(name) || name.trim();
	if (!plain) return '';
	if (!linkToNotes) return plain;
	return companionWikilink(plain, notes) ?? plain;
}

export function companionWikilink(name: string, notes: readonly CompanionNoteRef[]): string | null {
	const wanted = name.trim().toLowerCase();
	if (!wanted) return null;
	const matches = notes.filter((note) => note.basename.trim().toLowerCase() === wanted);
	if (matches.length === 0) return null;
	const exact = matches.filter((note) => note.basename === name.trim());
	const pool = exact.length > 0 ? exact : matches;
	const chosen = pool[0];
	if (!chosen) return null;
	if (pool.length === 1) return `[[${chosen.basename}]]`;
	const path = chosen.path.replace(/\\/g, '/').replace(/\.md$/i, '');
	return path ? `[[${path}]]` : null;
}

/**
 * Frontmatter lines for a new note.
 * Met With stays blank. Taken lists the companion, or stays blank when they skipped.
 */
export function companionFrontmatterBlock(stored: string): string {
	const name = stored.trim();
	if (!name) return 'Met With:\nTaken:';
	const quoted = `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	return `Met With:\nTaken:\n  - ${quoted}`;
}

function parseCompanionStamp(value: unknown): number | null {
	if (value instanceof Date) {
		const time = value.getTime();
		return Number.isNaN(time) ? null : time;
	}
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return null;
	const text = value.trim();
	if (!text) return null;
	const local = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
	if (local) {
		const date = new Date(
			Number(local[1]),
			Number(local[2]) - 1,
			Number(local[3]),
			Number(local[4] ?? 0),
			Number(local[5] ?? 0),
			Number(local[6] ?? 0),
		);
		const time = date.getTime();
		return Number.isNaN(time) ? null : time;
	}
	const parsed = Date.parse(text);
	return Number.isNaN(parsed) ? null : parsed;
}
