import { parseDriveInstant, parseFlexibleDate } from './dates';
import { readProperty } from './frontmatter';

/** One return visit, as far as Glancable search needs to see it. */
export interface GlanceRecord {
	name: string;
	address: string;
	city: string;
	met: Date | null;
	spoke: Date | null;
	attempted: Date | null;
	studied: Date | null;
	literature: string;
	media: string;
	lessons: string;
	taken: string;
	notes: string;
}

export interface GlanceDayRange {
	start: Date;
	end: Date;
}

export interface GlanceDateFacet {
	field: 'met' | 'spoke' | 'attempted' | 'studied';
	range: GlanceDayRange;
}

/** AND of every facet. An empty query matches every record. */
export interface GlanceQuery {
	dates: GlanceDateFacet[];
	literature: string[];
	media: string[];
	lessons: string[];
	taken: string[];
	terms: string[];
}

const STOP = new Set(['a', 'an', 'the', 'named', 'who', 'of', 'and', 'with']);
const LITERATURE_TYPES = new Set(['brochure', 'brochures', 'tract', 'tracts', 'awake', 'watchtower', 'book', 'books', 'magazine', 'magazines']);
const WEEKDAYS: Record<string, number> = {
	sun: 0, sunday: 0,
	mon: 1, monday: 1,
	tue: 2, tues: 2, tuesday: 2,
	wed: 3, wednesday: 3,
	thu: 4, thur: 4, thurs: 4, thursday: 4,
	fri: 5, friday: 5,
	sat: 6, saturday: 6,
};

const FIELD_WORDS: Record<string, GlanceDateFacet['field']> = {
	met: 'met',
	spoke: 'spoke',
	attempted: 'attempted',
	studied: 'studied',
};

/** Free-text query → AND facets. `now` anchors yesterday, today, and this week. */
export function parseGlanceQuery(raw: string, now: Date): GlanceQuery {
	const tokens = raw
		.toLowerCase()
		.replace(/[“”"'’]/g, '')
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 0);
	const query: GlanceQuery = { dates: [], literature: [], media: [], lessons: [], taken: [], terms: [] };
	let index = 0;
	while (index < tokens.length) {
		const field = dateFieldAt(tokens, index);
		if (field) {
			const phrase = datePhraseAt(tokens, field.next, now);
			if (phrase) {
				query.dates.push({ field: field.field, range: phrase.range });
				index = phrase.next;
				continue;
			}
			if (field.field === 'met' && tokens[field.next] === 'with') {
				const name = tokens[field.next + 1];
				if (name && !FIELD_WORDS[name] && !datePhraseAt(tokens, field.next + 1, now)) {
					query.taken.push(name);
					index = field.next + 2;
					continue;
				}
			}
		}
		const token = tokens[index] ?? '';
		if (token === 'left' || token === 'shared' || token === 'studied') {
			const kind = token === 'shared' ? 'media' : token === 'studied' ? 'lessons' : 'literature';
			let next = index + 1;
			while (STOP.has(tokens[next] ?? '')) next += 1;
			const word = tokens[next];
			if (word && !FIELD_WORDS[word] && !datePhraseAt(tokens, next, now)) {
				query[kind].push(normalizeType(word));
				index = next + 1;
				continue;
			}
		}
		if (LITERATURE_TYPES.has(token)) {
			query.literature.push(normalizeType(token));
			index += 1;
			continue;
		}
		if (STOP.has(token)) {
			index += 1;
			continue;
		}
		query.terms.push(token);
		index += 1;
	}
	return query;
}

export function matchesGlanceQuery(record: GlanceRecord, query: GlanceQuery): boolean {
	if (!queryHasFacets(query)) return true;
	for (const facet of query.dates) {
		if (!inDayRange(record[facet.field], facet.range)) return false;
	}
	if (!includesAll(record.literature, query.literature)) return false;
	if (!includesAll(record.media, query.media)) return false;
	if (!includesAll(record.lessons, query.lessons)) return false;
	if (!includesAll(`${record.taken} ${record.notes}`, query.taken)) return false;
	const haystack = [
		record.name,
		record.address,
		record.city,
		record.notes,
		record.literature,
		record.media,
		record.lessons,
		record.taken,
	].join(' ');
	return query.terms.every((term) => termIn(haystack, term));
}

/** Frontmatter plus stamp markup. Visit-note properties and the note body both count as notes. */
export function glanceRecordFromNote(input: {
	name: string;
	address: string;
	city: string;
	frontmatter: Record<string, unknown> | null;
	body?: string;
}): GlanceRecord {
	const frontmatter = input.frontmatter;
	const body = input.body ?? '';
	const literature = [textOf(readProperty(frontmatter, 'Left Publications')), stampTitles(body, 'book')].filter(Boolean).join(' ');
	const media = [textOf(readProperty(frontmatter, 'Shared Media')), stampTitles(body, 'film')].filter(Boolean).join(' ');
	const lessons = [textOf(readProperty(frontmatter, 'Lessons Studied')), stampTitles(body, 'lesson')].filter(Boolean).join(' ');
	const taken = [textOf(readProperty(frontmatter, 'Taken')), textOf(readProperty(frontmatter, 'Met With'))].filter(Boolean).join(' ');
	const notes = [noteText(frontmatter), looseNoteText(body)].filter(Boolean).join(' ');
	const city = [input.city, textOf(readProperty(frontmatter, 'City'))].filter(Boolean).join(' ');
	const address = [input.address, textOf(readProperty(frontmatter, 'Address'))].filter(Boolean).join(' ');
	return {
		name: input.name,
		address,
		city,
		met: asDate(readProperty(frontmatter, 'Met')),
		spoke: asDate(readProperty(frontmatter, 'Last Spoke')),
		attempted: asDate(readProperty(frontmatter, 'Last Attempted')),
		studied: asDate(readProperty(frontmatter, 'Last Studied')),
		literature,
		media,
		lessons,
		taken,
		notes,
	};
}

function queryHasFacets(query: GlanceQuery): boolean {
	return query.dates.length + query.literature.length + query.media.length + query.lessons.length + query.taken.length + query.terms.length > 0;
}

function dateFieldAt(tokens: readonly string[], index: number): { field: GlanceDateFacet['field']; next: number } | null {
	const token = tokens[index] ?? '';
	if (token === 'last') {
		const next = tokens[index + 1] ?? '';
		const field = FIELD_WORDS[next];
		if (field && field !== 'met') return { field, next: index + 2 };
		return null;
	}
	const field = FIELD_WORDS[token];
	return field ? { field, next: index + 1 } : null;
}

function datePhraseAt(tokens: readonly string[], index: number, now: Date): { range: GlanceDayRange; next: number } | null {
	const token = tokens[index] ?? '';
	const second = tokens[index + 1] ?? '';
	const third = tokens[index + 2] ?? '';
	if (token === 'today') return { range: dayRange(now, 0), next: index + 1 };
	if (token === 'yesterday') return { range: dayRange(now, -1), next: index + 1 };
	if (token === 'tomorrow') return { range: dayRange(now, 1), next: index + 1 };
	if (token === 'this' && second === 'week') return { range: trailingDays(now, 6), next: index + 2 };
	if (token === 'last' && second === 'week') {
		return {
			range: { start: addDays(startOfDay(now), -13), end: addDays(startOfDay(now), -7) },
			next: index + 2,
		};
	}
	if (token === 'this' && second === 'month') {
		return { range: { start: new Date(now.getFullYear(), now.getMonth(), 1), end: startOfDay(now) }, next: index + 2 };
	}
	if (/^\d+$/.test(token) && (second === 'day' || second === 'days') && third === 'ago') {
		return { range: dayRange(now, -Number(token)), next: index + 3 };
	}
	const weekday = WEEKDAYS[token];
	if (weekday != null) return { range: recentWeekday(now, weekday), next: index + 1 };
	return null;
}

function dayRange(now: Date, offset: number): GlanceDayRange {
	const day = addDays(startOfDay(now), offset);
	return { start: day, end: day };
}

/** Today and the previous `back` calendar days. */
function trailingDays(now: Date, back: number): GlanceDayRange {
	return { start: addDays(startOfDay(now), -back), end: startOfDay(now) };
}

function recentWeekday(now: Date, weekday: number): GlanceDayRange {
	const today = startOfDay(now);
	const delta = (today.getDay() - weekday + 7) % 7;
	return dayRange(now, -delta);
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function inDayRange(value: Date | null, range: GlanceDayRange): boolean {
	if (!value || Number.isNaN(value.getTime())) return false;
	const day = startOfDay(value).getTime();
	return day >= startOfDay(range.start).getTime() && day <= startOfDay(range.end).getTime();
}

function includesAll(haystack: string, needles: readonly string[]): boolean {
	return needles.every((needle) => termIn(haystack, needle));
}

function termIn(haystack: string, term: string): boolean {
	const text = haystack.toLowerCase();
	const needle = term.toLowerCase();
	if (!needle) return true;
	if (text.includes(needle)) return true;
	if (needle.endsWith('s') && text.includes(needle.slice(0, -1))) return true;
	if (!needle.endsWith('s') && text.includes(`${needle}s`)) return true;
	return false;
}

function normalizeType(word: string): string {
	if (word === 'brochures') return 'brochure';
	if (word === 'tracts') return 'tract';
	if (word === 'books') return 'book';
	if (word === 'magazines') return 'magazine';
	return word;
}

function stampTitles(body: string, kind: 'book' | 'film' | 'lesson'): string {
	const legacy = kind === 'book' ? 'Left' : kind === 'film' ? 'Shared' : 'Covered';
	const pattern = new RegExp(String.raw`·\s+(?:«${kind}»|${legacy})\s+«([^»]*)»`, 'gi');
	const titles: string[] = [];
	for (const match of body.matchAll(pattern)) {
		const title = match[1]?.trim();
		if (title) titles.push(title);
	}
	return titles.join(' ');
}

function noteText(frontmatter: Record<string, unknown> | null): string {
	if (!frontmatter) return '';
	const parts: string[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (!/notes/i.test(key)) continue;
		const text = textOf(value);
		if (text) parts.push(text);
	}
	return parts.join(' ');
}

/** Body text that is not a heading, callout marker, or Meta Bind field. */
function looseNoteText(body: string): string {
	return body
		.split(/\r?\n/)
		.filter((line) => {
			const trimmed = line.trim();
			if (!trimmed) return false;
			if (/^#{1,6}\s/.test(trimmed)) return false;
			if (/^>\s*\[!/.test(trimmed)) return false;
			if (/^`INPUT\[/.test(trimmed)) return false;
			if (/^---\s*$/.test(trimmed)) return false;
			return true;
		})
		.join(' ');
}

function textOf(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (Array.isArray(value)) return value.map((item) => textOf(item)).filter(Boolean).join(' ');
	return '';
}

function asDate(value: unknown): Date | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
	if (typeof value === 'string') return parseDriveInstant(value) ?? parseFlexibleDate(value);
	return null;
}
