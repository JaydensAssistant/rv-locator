import { emptyShare, shareTitles, type VisitShare } from './catalog';

const EXTRA_SPAN = /<span\b[^>]*\brv-visit-extra\b[^>]*>[\s\S]*?<\/span>/gi;

function piecePattern(): RegExp {
	return /·\s+(?:«(book|film|lesson)»|(Left|Shared|Covered|Also))\s+«([^»]*)»(?:\s+«([^»]*)»–«([^»]*)»)?/g;
}

/** Drop literature, media, and lesson markup so a visit stamp can be parsed. */
export function stripShareMarkup(text: string): string {
	return text.replace(EXTRA_SPAN, ' ').replace(piecePattern(), ' ');
}

function decodeAttr(value: string): string {
	return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** Visible stamp tail. Icons are render-only; the file stores a kind token, not Left/Shared/Covered. */
export function visitExtraMarkup(share: VisitShare): string {
	const parts: string[] = [];
	for (const title of shareTitles(share.publications, share.publicationList)) parts.push(`· «book» «${title}»`);
	for (const title of shareTitles(share.media, share.mediaList)) parts.push(`· «film» «${title}»`);
	const lesson = share.lesson.trim();
	const extra = share.extraLesson?.trim() ?? '';
	if (lesson) parts.push(lessonToken(lesson, share.lessonFrom, share.lessonTo));
	if (extra) parts.push(lessonToken(extra, share.extraFrom ?? '', share.extraTo ?? ''));
	return parts.join(' ');
}

function lessonToken(lesson: string, from: string, to: string): string {
	const start = from.trim();
	const end = to.trim();
	const range = start || end ? ` «${start}»–«${end}»` : '';
	return `· «lesson» «${lesson}»${range}`;
}

/** Extra text already written on a stamp line, kept when the age text is refreshed. */
export function visitExtrasFromLine(line: string): string {
	const spans = line.match(EXTRA_SPAN);
	if (spans?.length) return spans.join(' ');
	const plain = line.match(piecePattern());
	return plain?.join(' ').trim() ?? '';
}

/** The newest visit's ended-on value, for the next lesson's start. */
export function newestLessonEnd(markdown: string): string {
	return newestLessonProgress(markdown)?.to ?? '';
}

/** Newest lesson on the note. The newest visit is the first stamp in the file. */
export function newestLessonProgress(markdown: string): { lesson: string; to: string } | null {
	const span = /class="rv-visit-extra rv-lesson"[\s\S]*?data-label="([^"]*)"[\s\S]*?data-to="([^"]*)"/.exec(markdown);
	const token = /·\s+«lesson»\s+«([^»]*)»(?:\s+«[^»]*»–«([^»]*)»)?/.exec(markdown);
	const plain = /·\s+Covered\s+«([^»]*)»(?:\s+«[^»]*»–«([^»]*)»)?/.exec(markdown);
	const hits = [
		span ? { at: span.index, lesson: decodeAttr(span[1] ?? ''), to: decodeAttr(span[2] ?? '') } : null,
		token ? { at: token.index, lesson: token[1] ?? '', to: token[2] ?? '' } : null,
		plain ? { at: plain.index, lesson: plain[1] ?? '', to: plain[2] ?? '' } : null,
	].filter((hit): hit is { at: number; lesson: string; to: string } => hit != null);
	hits.sort((a, b) => a.at - b.at);
	const first = hits[0];
	if (first) return { lesson: first.lesson, to: first.to };
	const loose = /data-to="([^"]*)"/.exec(markdown);
	if (span && loose) return { lesson: decodeAttr(span[1] ?? ''), to: decodeAttr(loose[1] ?? '') };
	return null;
}

export function shareFromLine(line: string): VisitShare {
	const share = emptyShare();
	const publications: string[] = [];
	const media: string[] = [];
	const spans = line.match(EXTRA_SPAN) ?? [];
	for (const span of spans) {
		const label = decodeAttr(/data-label="([^"]*)"/.exec(span)?.[1] ?? '');
		if (span.includes('rv-left-pub')) publications.push(label);
		else if (span.includes('rv-shared-media')) media.push(label);
		else if (span.includes('rv-lesson')) {
			share.lesson = label;
			share.lessonFrom = decodeAttr(/data-from="([^"]*)"/.exec(span)?.[1] ?? '');
			share.lessonTo = decodeAttr(/data-to="([^"]*)"/.exec(span)?.[1] ?? '');
		}
	}
	const pieces = piecePattern();
	let match = pieces.exec(line);
	while (match) {
		const token = match[1] ?? '';
		const word = match[2] ?? '';
		const label = match[3] ?? '';
		const from = match[4] ?? '';
		const to = match[5] ?? '';
		if (token === 'book' || word === 'Left') publications.push(label);
		else if (token === 'film' || word === 'Shared') media.push(label);
		else if (token === 'lesson' || word === 'Covered' || word === 'Also') {
			if (!share.lesson) {
				share.lesson = label;
				share.lessonFrom = from;
				share.lessonTo = to;
			} else {
				share.extraLesson = label;
				share.extraFrom = from;
				share.extraTo = to;
			}
		}
		match = pieces.exec(line);
	}
	share.publications = publications[0] ?? '';
	share.media = media[0] ?? '';
	if (publications.length > 0) share.publicationList = publications;
	if (media.length > 0) share.mediaList = media;
	return share;
}
