/**
 * Publication, media, and lesson catalogs.
 * Display titles come from the supplied list. Parenthetical aliases match search only.
 */
import { LESSON_ENTRIES, MEDIA_ENTRIES, PUBLICATION_ENTRIES, type CatalogTitle } from './catalog-data';
import { isClosingPart, sliderStopsFor } from './lesson-stops';

export type { CatalogTitle };

/** Official publication titles, in list order. */
export const PUBLICATION_TITLES: readonly string[] = PUBLICATION_ENTRIES.map((entry) => entry.title);

/** Official media titles, in list order. */
export const MEDIA_TITLES: readonly string[] = MEDIA_ENTRIES.map((entry) => entry.title);

export type ReviewSection = 1 | 2 | 3 | 4;

/**
 * One Enjoy Life Forever lesson. `review` lessons are marked when the official
 * list arrives. This file does not invent those titles or which lessons are reviews.
 */
export interface LessonSpec {
	title: string;
	review: boolean;
	/** Set only for a review lesson. Section 1–4 pick the question count. */
	reviewSection?: ReviewSection;
}

/** Official Enjoy Life Forever lessons, including the four section reviews. */
export const LESSONS: readonly LessonSpec[] = LESSON_ENTRIES.map((entry) => (
	entry.reviewSection
		? { title: entry.title, review: true, reviewSection: entry.reviewSection }
		: { title: entry.title, review: entry.review }
));

const TITLE_SUFFIXES = [
	'Become Jehovah’s Friend',
	'Tiny Tract',
	'Watchtower',
	'Brochure',
	'Awake!',
	'Tract',
	'Book',
	'Video',
	'Study',
] as const;

const quoteCache = new Map<string, string>();

/** Straight, curly, and guillemet quotes around a displayed title. The file is not rewritten. */
export function stripTitleQuotes(title: string): string {
	const cached = quoteCache.get(title);
	if (cached !== undefined) return cached;
	const clean = title.replace(/^[\s"'“”«»]+|[\s"'“”«»]+$/g, '').trim();
	quoteCache.set(title, clean);
	return clean;
}

const suffixCache = new Map<string, { text: string; suffix: string }>();
let suffixByTitle: Map<string, string> | null = null;

function knownSuffix(title: string, clean: string): string {
	if (!suffixByTitle) {
		suffixByTitle = new Map();
		for (const entry of [...PUBLICATION_ENTRIES, ...MEDIA_ENTRIES]) {
			if (!entry.suffix) continue;
			suffixByTitle.set(entry.title, entry.suffix);
			const bare = entry.title.replace(/^[\s"'“”«»]+|[\s"'“”«»]+$/g, '').trim();
			suffixByTitle.set(bare, entry.suffix);
		}
	}
	return suffixByTitle.get(title) ?? suffixByTitle.get(clean) ?? '';
}

/** Title text and the type suffix that stays visible when the row truncates. */
export function splitTitleSuffix(title: string): { text: string; suffix: string } {
	const cached = suffixCache.get(title);
	if (cached) return cached;
	const clean = stripTitleQuotes(title);
	const suffix = knownSuffix(title, clean) || TITLE_SUFFIXES.find((item) => clean.endsWith(` ${item}`)) || '';
	const result = !suffix || !clean.endsWith(suffix)
		? { text: clean, suffix: '' }
		: { text: clean.slice(0, -suffix.length).trimEnd(), suffix };
	suffixCache.set(title, result);
	return result;
}

export type StudyRatioOrder = 'lessons-studies' | 'studies-lessons';

/** Card ratio has no decimal. Quick Facts adds the divided number in parentheses. */
export function formatStudyFraction(
	lessons: number,
	studies: number,
	order: StudyRatioOrder = 'lessons-studies',
): { ratio: string; withDecimal: string } {
	const left = order === 'studies-lessons' ? studies : lessons;
	const right = order === 'studies-lessons' ? lessons : studies;
	const ratio = `${countText(left)}/${countText(right)}`;
	if (!Number.isFinite(left) || !Number.isFinite(right) || right <= 0) return { ratio, withDecimal: ratio };
	return { ratio, withDecimal: `${ratio} (${(left / right).toFixed(2)})` };
}

function countText(value: number): string {
	if (!Number.isFinite(value)) return '—';
	return String(Math.max(0, Math.round(value)));
}

/**
 * Summary, or the last part of the lesson, opens the next lesson at its intro.
 * Stopping earlier opens the next part of the same lesson.
 */
export function nextStudyStart(lesson: string, endedOn: string, catalog: readonly LessonSpec[] = LESSONS): { lesson: string; from: string } {
	const title = lesson.trim();
	const ended = endedOn.trim();
	const current = lessonByTitle(title, catalog.map((item) => item.title));
	const parts = [...lessonPartOptions(current)];
	const index = parts.findIndex((part) => part.toLowerCase() === ended.toLowerCase());
	const finished = isClosingPart(ended) || (index >= 0 && index === parts.length - 1);
	if (finished) {
		const at = catalog.findIndex((item) => item.title.trim().toLowerCase() === title.toLowerCase());
		const next = at >= 0 ? catalog[at + 1] : undefined;
		if (next) return { lesson: next.title, from: lessonPartOptions(next)[0] ?? 'Intro' };
		return { lesson: title, from: ended };
	}
	if (index >= 0 && index + 1 < parts.length) return { lesson: title, from: parts[index + 1] ?? ended };
	return { lesson: title, from: ended };
}

export interface StudyDefaults {
	lesson: string;
	from: string;
	to: string;
}

/**
 * Next study's lesson, start, and end.
 * No prior study opens lesson 1 from its intro through its last part.
 * A finished lesson opens the next lesson the same way.
 * A stop mid-lesson opens the next part and still ends on that lesson's last part.
 */
export function studyPrefill(
	progress: { lesson: string; to: string } | null,
	catalog: readonly LessonSpec[] = LESSONS,
): StudyDefaults {
	if (!progress || (!progress.lesson.trim() && !progress.to.trim())) {
		return boundsForLesson(catalog[0] ?? null);
	}
	const start = nextStudyStart(progress.lesson, progress.to, catalog);
	const spec = lessonByTitle(start.lesson, catalog.map((item) => item.title));
	const parts = lessonPartOptions(spec);
	return {
		lesson: start.lesson,
		from: start.from,
		to: parts[parts.length - 1] ?? '',
	};
}

/** Start and end when a lesson is picked by hand. End is that lesson's last part. */
export function lessonBounds(
	title: string,
	catalog: readonly LessonSpec[] = LESSONS,
	custom: readonly string[] = [],
): { from: string; to: string } {
	const spec = lessonByTitle(title, [...custom, ...catalog.map((item) => item.title)]);
	const parts = lessonPartOptions(spec);
	return { from: parts[0] ?? '', to: parts[parts.length - 1] ?? '' };
}

function boundsForLesson(lesson: LessonSpec | null): StudyDefaults {
	if (!lesson) return { lesson: '', from: '', to: '' };
	const parts = lessonPartOptions(lesson);
	return { lesson: lesson.title, from: parts[0] ?? '', to: parts[parts.length - 1] ?? '' };
}

/** A normal lesson, in study order. */
export const NORMAL_LESSON_PARTS = [
	'Intro',
	'1',
	'2',
	'3',
	'4',
	'5',
	'6',
	'7',
	'8',
	'Some people say',
	'Summary',
	'Review',
] as const;

/** Review-lesson question counts. Which lessons use these is not invented here. */
export const REVIEW_QUESTION_COUNTS: Record<ReviewSection, number> = {
	1: 10,
	2: 15,
	3: 12,
	4: 12,
};

export interface VisitShare {
	publications: string;
	media: string;
	lesson: string;
	lessonFrom: string;
	lessonTo: string;
	/** Rare second lesson in the same visit. Empty unless they open that control. */
	extraLesson?: string;
	extraFrom?: string;
	extraTo?: string;
	/** Every publication left on this visit. The first is also {@link publications}. */
	publicationList?: string[];
	/** Every media piece shown on this visit. The first is also {@link media}. */
	mediaList?: string[];
	/** Publisher who came along. Empty unless the study log asks. */
	companion?: string;
}

export function emptyShare(): VisitShare {
	return {
		publications: '',
		media: '',
		lesson: '',
		lessonFrom: '',
		lessonTo: '',
		extraLesson: '',
		extraFrom: '',
		extraTo: '',
	};
}

function draftText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** Several titles when the logger added more than one. A single field still counts. */
export function shareTitles(single: unknown, list?: readonly unknown[] | null): string[] {
	const source = Array.isArray(list) ? list : [];
	const many = source.map((item) => draftText(item)).filter(Boolean);
	if (many.length > 0) return many;
	const one = draftText(single);
	return one ? [one] : [];
}

/**
 * Literature from a New RV draft. Missing publications, media, lesson, notes,
 * and companion are blank. Nothing is written when literature is empty.
 * Companion and notes do not by themselves create a share write.
 */
export function shareFromNewRvDraft(draft: {
	publications?: unknown;
	publicationList?: unknown;
	media?: unknown;
	mediaList?: unknown;
	lesson?: unknown;
	lessonFrom?: unknown;
	lessonTo?: unknown;
	extraLesson?: unknown;
	extraFrom?: unknown;
	extraTo?: unknown;
	companion?: unknown;
	notes?: unknown;
} | null | undefined): VisitShare | null {
	if (!draft) return null;
	const publications = shareTitles(draft.publications, Array.isArray(draft.publicationList) ? draft.publicationList : undefined);
	const media = shareTitles(draft.media, Array.isArray(draft.mediaList) ? draft.mediaList : undefined);
	const lesson = draftText(draft.lesson);
	const extraLesson = draftText(draft.extraLesson);
	// The template already stores notes. Reading a missing value must not throw.
	void draftText(draft.notes);
	const companion = draftText(draft.companion);
	if (publications.length === 0 && media.length === 0 && !lesson && !extraLesson) return null;
	return {
		...emptyShare(),
		publications: publications[0] ?? '',
		media: media[0] ?? '',
		publicationList: publications,
		mediaList: media,
		lesson,
		lessonFrom: draftText(draft.lessonFrom),
		lessonTo: draftText(draft.lessonTo),
		extraLesson,
		extraFrom: draftText(draft.extraFrom),
		extraTo: draftText(draft.extraTo),
		companion,
	};
}

export function lessonByTitle(title: string, custom: readonly string[] = []): LessonSpec | null {
	const wanted = title.trim().toLowerCase();
	if (!wanted) return null;
	const official = LESSONS.find((lesson) => lesson.title.trim().toLowerCase() === wanted);
	if (official) return official;
	if (custom.some((item) => item.trim().toLowerCase() === wanted)) {
		return { title: title.trim(), review: false };
	}
	return null;
}

/** Where a lesson can start or end. A review uses its section's question numbers. */
export function lessonPartOptions(lesson: LessonSpec | null): readonly string[] {
	if (lesson?.review && !lookupKnownStops(lesson.title)) {
		const section = lesson.reviewSection && REVIEW_QUESTION_COUNTS[lesson.reviewSection]
			? lesson.reviewSection
			: 1;
		const count = REVIEW_QUESTION_COUNTS[section];
		return Array.from({ length: count }, (_, index) => String(index + 1));
	}
	if (lesson?.title) return sliderStopsFor(lesson.title, NORMAL_LESSON_PARTS);
	return NORMAL_LESSON_PARTS;
}

function lookupKnownStops(title: string): boolean {
	return sliderStopsFor(title, []).length > 0;
}

function normalize(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Exact match first, then a close match. "enjoy lif f" finds "Enjoy Life Forever".
 * An empty query keeps the list order, which is most-recently-used when the caller built it that way.
 */
export function rankSuggestions(
	query: string,
	items: readonly string[],
	aliases: Readonly<Record<string, readonly string[]>> = {},
): string[] {
	const unique: string[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		const text = item.trim();
		if (!text) continue;
		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(text);
	}
	const needle = normalize(query);
	if (!needle) return unique;
	return unique
		.map((item) => ({ item, score: scoreWithAliases(needle, item, aliases[item.toLowerCase()]) }))
		.filter((row) => row.score > 0)
		.sort((a, b) => b.score - a.score || a.item.localeCompare(b.item))
		.map((row) => row.item);
}

function scoreWithAliases(query: string, item: string, aliases: readonly string[] | undefined): number {
	let best = matchScore(query, item);
	for (const alias of aliases ?? []) best = Math.max(best, matchScore(query, alias));
	return best;
}

function matchScore(query: string, item: string): number {
	const text = normalize(item);
	if (!text) return 0;
	if (text === query) return 1000;
	if (text.startsWith(query)) return 800;
	const tokens = query.split(' ').filter(Boolean);
	const words = text.split(' ');
	let from = 0;
	let score = 400;
	for (const token of tokens) {
		const at = words.findIndex((word, index) => index >= from && word.startsWith(token));
		if (at < 0) return subsequenceScore(query, text);
		score += 40 - at;
		if (words[at] === token) score += 20;
		from = at + 1;
	}
	return score;
}

function subsequenceScore(query: string, text: string): number {
	const q = query.replace(/ /g, '');
	const t = text.replace(/ /g, '');
	let index = 0;
	for (const char of q) {
		index = t.indexOf(char, index);
		if (index < 0) return 0;
		index += 1;
	}
	return 80;
}

/** A typed value missing from the static list and the custom list is kept. */
export function rememberCustom(list: readonly string[], value: string, catalog: readonly string[]): string[] {
	const text = value.trim();
	const next = [...list];
	if (!text) return next;
	const known = [...catalog, ...next].some((item) => item.trim().toLowerCase() === text.toLowerCase());
	if (known) return next;
	next.unshift(text);
	return next;
}

export function renameCustom(list: readonly string[], from: string, to: string): string[] {
	const nextName = to.trim();
	const previous = from.trim().toLowerCase();
	if (!nextName || !previous) return [...list];
	return list.map((item) => item.trim().toLowerCase() === previous ? nextName : item);
}

export function deleteCustom(list: readonly string[], name: string): string[] {
	const previous = name.trim().toLowerCase();
	return list.filter((item) => item.trim().toLowerCase() !== previous);
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** Replace a stored catalog name in visit markup and the two Quick Facts properties. */
export function renameLabelInMarkdown(markdown: string, from: string, to: string): string {
	const previous = from.trim();
	const nextName = to.trim();
	if (!previous || previous === nextName) return markdown;
	let next = markdown.split(`data-label="${escapeAttr(previous)}"`).join(`data-label="${escapeAttr(nextName)}"`);
	next = next.split(`'${previous}'`).join(`'${nextName}'`);
	next = next.split(`«${previous}»`).join(`«${nextName}»`);
	const properties = ['Left Publications', 'Shared Media', 'Lessons Studied'];
	for (const property of properties) {
		const pattern = new RegExp(`^(${property}:)\\s*${escapeRegExp(previous)}\\s*$`, 'gm');
		next = next.replace(pattern, `$1 ${nextName}`);
	}
	return next;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PUBLICATION_ALIASES = aliasIndex(PUBLICATION_ENTRIES);
const MEDIA_ALIASES = aliasIndex(MEDIA_ENTRIES);

function aliasIndex(entries: readonly CatalogTitle[]): Record<string, readonly string[]> {
	const map: Record<string, readonly string[]> = {};
	for (const entry of entries) {
		if (entry.aliases?.length) map[entry.title.toLowerCase()] = entry.aliases;
	}
	return map;
}

export function publicationAliasIndex(): Readonly<Record<string, readonly string[]>> {
	return PUBLICATION_ALIASES;
}

export function mediaAliasIndex(): Readonly<Record<string, readonly string[]>> {
	return MEDIA_ALIASES;
}

export function catalogSuggestions(
	catalog: readonly string[],
	custom: readonly string[],
	query: string,
	aliases: Readonly<Record<string, readonly string[]>> = {},
): string[] {
	return rankSuggestions(query, [...custom, ...catalog], aliases);
}
