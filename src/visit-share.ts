import { emptyShare, type VisitShare } from './catalog';

const EXTRA_SPAN = /<span\b[^>]*\brv-visit-extra\b[^>]*>[\s\S]*?<\/span>/gi;

/** Drop literature, media, and lesson markup so a visit stamp can be parsed. */
export function stripVisitExtras(text: string): string {
	return text.replace(EXTRA_SPAN, ' ').replace(/\s+/g, ' ').trim();
}

function span(kind: string, label: string, share: VisitShare): string {
	const attrs = [
		`class="rv-visit-extra ${kind}"`,
		`data-label="${escapeAttr(labelValue(kind, share))}"`,
		`data-from="${escapeAttr(share.lessonFrom)}"`,
		`data-to="${escapeAttr(share.lessonTo)}"`,
		`title="${escapeAttr(label)}"`,
	];
	return `<span ${attrs.join(' ')}>${escapeText(label)}</span>`;
}

function labelValue(kind: string, share: VisitShare): string {
	if (kind === 'rv-left-pub') return share.publications;
	if (kind === 'rv-shared-media') return share.media;
	return share.lesson;
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Markup after the days-ago span. Empty when the visit recorded none of these. */
export function visitExtraMarkup(share: VisitShare): string {
	const parts: string[] = [];
	if (share.publications.trim()) {
		parts.push(span('rv-left-pub', `Left '${share.publications.trim()}'`, share));
	}
	if (share.media.trim()) {
		parts.push(span('rv-shared-media', `Shared '${share.media.trim()}'`, share));
	}
	if (share.lesson.trim()) {
		const from = share.lessonFrom.trim();
		const to = share.lessonTo.trim();
		const range = from || to ? ` ${from || '…'}–${to || '…'}` : '';
		parts.push(span('rv-lesson', `Covered '${share.lesson.trim()}'${range}`, share));
	}
	return parts.join(' ');
}

/** Extra spans already written on a stamp line, kept when the age text is refreshed. */
export function visitExtrasFromLine(line: string): string {
	const found = line.match(EXTRA_SPAN);
	return found ? found.join(' ') : '';
}

/** The newest visit's ended-on value, for the next lesson's start. */
export function newestLessonEnd(markdown: string): string {
	const match = /class="rv-visit-extra rv-lesson"[^>]*data-to="([^"]*)"/.exec(markdown)
		?? /data-to="([^"]*)"[^>]*class="rv-visit-extra rv-lesson"/.exec(markdown);
	if (match?.[1]) return decodeAttr(match[1]);
	const loose = /class="rv-visit-extra rv-lesson"[\s\S]*?data-to="([^"]*)"/.exec(markdown);
	return loose?.[1] ? decodeAttr(loose[1]) : '';
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
	return share;
}

function decodeAttr(value: string): string {
	return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
