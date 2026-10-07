import { emptyShare, type VisitShare } from './catalog';

const EXTRA_SPAN = /<span\b[^>]*\brv-visit-extra\b[^>]*>[\s\S]*?<\/span>/gi;
const SHARE_TAIL = /(?:\s+·\s+(?:Left|Shared|Covered|Also)\s+«[^»]*»(?:\s+«[^»]*»–«[^»]*»)?)+\s*$/;
const PLAIN_PIECE = /·\s+(Left|Shared|Covered|Also)\s+«([^»]*)»(?:\s+«([^»]*)»–«([^»]*)»)?/g;

/** Drop literature, media, and lesson markup so a visit stamp can be parsed. */
export function stripShareMarkup(text: string): string {
	return text.replace(EXTRA_SPAN, ' ').replace(SHARE_TAIL, ' ');
}

function decodeAttr(value: string): string {
	return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** Visible stamp tail. Guillemets keep apostrophes inside a title. */
export function visitExtraMarkup(share: VisitShare): string {
	const parts: string[] = [];
	const publications = share.publications.trim();
	const media = share.media.trim();
	const lesson = share.lesson.trim();
	const extra = share.extraLesson?.trim() ?? '';
	if (publications) parts.push(`· Left «${publications}»`);
	if (media) parts.push(`· Shared «${media}»`);
	if (lesson) parts.push(covered('Covered', lesson, share.lessonFrom, share.lessonTo));
	if (extra) parts.push(covered('Also', extra, share.extraFrom ?? '', share.extraTo ?? ''));
	return parts.join(' ');
}

function covered(kind: 'Covered' | 'Also', lesson: string, from: string, to: string): string {
	const start = from.trim();
	const end = to.trim();
	const range = start || end ? ` «${start}»–«${end}»` : '';
	return `· ${kind} «${lesson}»${range}`;
}

/** Extra text already written on a stamp line, kept when the age text is refreshed. */
export function visitExtrasFromLine(line: string): string {
	const spans = line.match(EXTRA_SPAN);
	if (spans?.length) return spans.join(' ');
	const plain = SHARE_TAIL.exec(line);
	return plain?.[0]?.trim() ?? '';
}

/** The newest visit's ended-on value, for the next lesson's start. */
export function newestLessonEnd(markdown: string): string {
	return newestLessonProgress(markdown)?.to ?? '';
}

/** Newest Covered lesson on the note. The newest visit is the first stamp in the file. */
export function newestLessonProgress(markdown: string): { lesson: string; to: string } | null {
	const span = /class="rv-visit-extra rv-lesson"[\s\S]*?data-label="([^"]*)"[\s\S]*?data-to="([^"]*)"/.exec(markdown);
	const plain = /· Covered «([^»]*)»(?:\s+«[^»]*»–«([^»]*)»)?/.exec(markdown);
	const spanAt = span?.index ?? Number.POSITIVE_INFINITY;
	const plainAt = plain?.index ?? Number.POSITIVE_INFINITY;
	if (span && spanAt <= plainAt) {
		return { lesson: decodeAttr(span[1] ?? ''), to: decodeAttr(span[2] ?? '') };
	}
	if (plain) return { lesson: plain[1] ?? '', to: plain[2] ?? '' };
	const loose = /data-to="([^"]*)"/.exec(markdown);
	if (span && loose) return { lesson: decodeAttr(span[1] ?? ''), to: decodeAttr(loose[1] ?? '') };
	return null;
}

export function shareFromLine(line: string): VisitShare {
	const share = emptyShare();
	const spans = line.match(EXTRA_SPAN) ?? [];
	for (const span of spans) {
		const label = decodeAttr(/data-label="([^"]*)"/.exec(span)?.[1] ?? '');
		if (span.includes('rv-left-pub')) share.publications = label;
		else if (span.includes('rv-shared-media')) share.media = label;
		else if (span.includes('rv-lesson')) {
			share.lesson = label;
			share.lessonFrom = decodeAttr(/data-from="([^"]*)"/.exec(span)?.[1] ?? '');
			share.lessonTo = decodeAttr(/data-to="([^"]*)"/.exec(span)?.[1] ?? '');
		}
	}
	PLAIN_PIECE.lastIndex = 0;
	let match = PLAIN_PIECE.exec(line);
	while (match) {
		const kind = match[1] ?? '';
		const label = match[2] ?? '';
		if (kind === 'Left') share.publications = label;
		else if (kind === 'Shared') share.media = label;
		else if (kind === 'Covered') {
			share.lesson = label;
			share.lessonFrom = match[3] ?? '';
			share.lessonTo = match[4] ?? '';
		} else if (kind === 'Also') {
			share.extraLesson = label;
			share.extraFrom = match[3] ?? '';
			share.extraTo = match[4] ?? '';
		}
		match = PLAIN_PIECE.exec(line);
	}
	return share;
}
