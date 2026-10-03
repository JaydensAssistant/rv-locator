import { readProperty } from './frontmatter';

/** Suggester length. The newest names are kept; older duplicates are dropped. */
export const RECENT_COMPANION_LIMIT = 24;

export interface CompanionMention {
	metWith: unknown;
	taken: unknown;
	/** Higher is more recent. */
	recentAt: number;
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

/** Names already in the recent list. The “Use …” row is typed text, not a suggestion. */
export function listedCompanions(choices: readonly CompanionSuggestion[]): CompanionSuggestion[] {
	return choices.filter((choice) => !choice.label.startsWith('Use “') && !choice.label.startsWith('Use "'));
}

/**
 * Enter or leaving the field selects a suggestion only when the text matches one.
 * An exact name wins. A single remaining match also wins. Several matches do not.
 */
export function matchingCompanion(choices: readonly CompanionSuggestion[], typed: string): CompanionSuggestion | null {
	const needle = typed.trim().toLowerCase();
	if (!needle) return null;
	const listed = listedCompanions(choices);
	const exact = listed.find((choice) => choice.value.trim().toLowerCase() === needle);
	if (exact) return exact;
	const partial = listed.filter((choice) => choice.value.toLowerCase().includes(needle));
	return partial.length === 1 ? partial[0] ?? null : null;
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

/**
 * List items for Taken. A wikilink Obsidian parsed as a nested array
 * (`[[Name]]` → `[["Name"]]`) is restored to the `[[Name]]` string.
 */
export function takenItems(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((item) => {
			const link = wikilinkFromParsed(item);
			if (link) return [link];
			if (typeof item === 'string' && item.trim()) return [item.trim()];
			return [];
		});
	}
	const link = wikilinkFromParsed(value);
	if (link) return [link];
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
 * Plain name appended to Taken. A wikilink is reduced to its display name.
 * New companion writes do not create wikilinks.
 */
export function formatStoredCompanion(name: string): string {
	return companionDisplayName(name) || name.trim();
}

/**
 * Quoted `"[[Note]]"` is the form Obsidian Properties keeps as a link.
 * An unquoted `[[Note]]`, or the nested list Obsidian’s parser makes from it,
 * is rewritten under Taken and Met With only. Other keys, including Hub, stay.
 */
export function stabilizeCompanionFrontmatter(markdown: string): string {
	const fence = frontmatterSpan(markdown);
	if (!fence) return markdown;
	const lines = markdown.slice(fence.start, fence.end).split(/\r?\n/);
	const rewritten = rewriteCompanionLinkLines(lines);
	if (rewritten.length === lines.length && rewritten.every((line, index) => line === lines[index])) return markdown;
	return markdown.slice(0, fence.start) + rewritten.join(fence.nl) + markdown.slice(fence.end);
}

function wikilinkFromParsed(value: unknown): string | null {
	if (typeof value === 'string') {
		const text = value.trim();
		return /^\[\[[^\]]+\]\]$/.test(text) ? text : null;
	}
	if (!Array.isArray(value) || value.length !== 1) return null;
	const inner = value[0];
	if (Array.isArray(inner) && inner.length === 1 && typeof inner[0] === 'string') {
		return wikilinkTarget(inner[0]);
	}
	if (typeof inner === 'string') return wikilinkTarget(inner);
	return null;
}

function wikilinkTarget(value: string): string | null {
	const text = value.trim();
	if (!text) return null;
	if (/^\[\[[^\]]+\]\]$/.test(text)) return text;
	if (!looksLikeCompanionTarget(text)) return null;
	return `[[${text}]]`;
}

function looksLikeCompanionTarget(value: string): boolean {
	if (!value || value.length > 120) return false;
	if (/[\[\]#:]/.test(value)) return false;
	return /[A-Za-z]/.test(value);
}

function yamlQuote(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function frontmatterSpan(markdown: string): { start: number; end: number; nl: string } | null {
	const nl = markdown.startsWith('---\r\n') ? '\r\n' : markdown.startsWith('---\n') ? '\n' : '';
	if (!nl) return null;
	const start = 3 + nl.length;
	const close = `${nl}---`;
	const end = markdown.indexOf(close, start);
	if (end < 0) return null;
	return { start, end, nl };
}

const COMPANION_FRONTMATTER_KEYS = new Set(['taken', 'met with']);

function rewriteCompanionLinkLines(lines: string[]): string[] {
	const out: string[] = [];
	let key = '';
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (!/^\s/.test(line)) {
			const top = /^([^:#][^:]*?)\s*:(.*)$/.exec(line);
			key = top ? (top[1] ?? '').trim().toLowerCase() : '';
			if (top && COMPANION_FRONTMATTER_KEYS.has(key)) {
				const quoted = quoteLooseWikilink((top[2] ?? '').trim());
				if (quoted) {
					out.push(`${top[1]}: ${quoted}`);
					continue;
				}
			}
			out.push(line);
			continue;
		}
		if (!COMPANION_FRONTMATTER_KEYS.has(key)) {
			out.push(line);
			continue;
		}
		const unquoted = /^(\s*)-\s+\[\[([^\]]+)\]\]\s*$/.exec(line);
		if (unquoted) {
			out.push(`${unquoted[1]}- ${yamlQuote(`[[${unquoted[2]}]]`)}`);
			continue;
		}
		const nested = /^(\s*)-\s+-\s+(.+?)\s*$/.exec(line);
		if (nested) {
			const wrapped = wikilinkTarget(stripYamlQuote(nested[2] ?? ''));
			if (wrapped) {
				out.push(`${nested[1]}- ${yamlQuote(wrapped)}`);
				continue;
			}
		}
		const empty = /^(\s*)-\s*$/.exec(line);
		const child = /^(\s*)-\s+(.+?)\s*$/.exec(lines[index + 1] ?? '');
		if (empty && child && (child[1]?.length ?? 0) > (empty[1]?.length ?? 0)) {
			const wrapped = wikilinkTarget(stripYamlQuote(child[2] ?? ''));
			if (wrapped) {
				out.push(`${empty[1]}- ${yamlQuote(wrapped)}`);
				index += 1;
				continue;
			}
		}
		out.push(line);
	}
	return out;
}

function quoteLooseWikilink(value: string): string | null {
	if (!value || value.startsWith('"') || value.startsWith("'")) return null;
	const match = /^\[\[([^\]]+)\]\]$/.exec(value);
	if (!match) return null;
	return yamlQuote(`[[${match[1]}]]`);
}

function stripYamlQuote(value: string): string {
	const text = value.trim();
	if (text.length >= 2) {
		const open = text[0];
		const close = text[text.length - 1];
		if ((open === '"' && close === '"') || (open === "'" && close === "'")) return text.slice(1, -1);
	}
	return text;
}

/**
 * Frontmatter lines for a new note.
 * Met With is the publisher taken when first meeting this householder, so
 * the create companion goes on Met With and is also the first Taken entry.
 * A skip leaves both blank. Later Home visits append to Taken only.
 */
export function companionFrontmatterBlock(stored: string): string {
	const name = stored.trim();
	if (!name) return 'Met With:\nTaken:';
	const quoted = `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	return `Met With: ${quoted}\nTaken:\n  - ${quoted}`;
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
