/**
 * Publication, media, and lesson catalogs.
 * The title lists stay empty until the official names are dropped in.
 * A follow-up fills {@link PUBLICATION_TITLES}, {@link MEDIA_TITLES}, and {@link LESSONS}.
 */

/** Official publication titles. Empty until that list is supplied. */
export const PUBLICATION_TITLES: readonly string[] = [];

/** Official media titles. Empty until that list is supplied. */
export const MEDIA_TITLES: readonly string[] = [];

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

/** Official lessons. Empty until that list is supplied. */
export const LESSONS: readonly LessonSpec[] = [];

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
}

export function emptyShare(): VisitShare {
	return { publications: '', media: '', lesson: '', lessonFrom: '', lessonTo: '' };
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
	if (lesson?.review) {
		const section = lesson.reviewSection && REVIEW_QUESTION_COUNTS[lesson.reviewSection]
			? lesson.reviewSection
			: 1;
		const count = REVIEW_QUESTION_COUNTS[section];
		return Array.from({ length: count }, (_, index) => String(index + 1));
	}
	return NORMAL_LESSON_PARTS;
}

function normalize(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Exact match first, then a close match. "enjoy lif f" finds "Enjoy Life Forever".
 * An empty query keeps the list order, which is most-recently-used when the caller built it that way.
 */
export function rankSuggestions(query: string, items: readonly string[]): string[] {
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
		.map((item) => ({ item, score: matchScore(needle, item) }))
		.filter((row) => row.score > 0)
		.sort((a, b) => b.score - a.score || a.item.localeCompare(b.item))
		.map((row) => row.item);
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
	const properties = ['Left Publications', 'Shared Media'];
	for (const property of properties) {
		const pattern = new RegExp(`^(${property}:)\\s*${escapeRegExp(previous)}\\s*$`, 'gm');
		next = next.replace(pattern, `$1 ${nextName}`);
	}
	return next;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function catalogSuggestions(catalog: readonly string[], custom: readonly string[], query: string): string[] {
	return rankSuggestions(query, [...custom, ...catalog]);
}
