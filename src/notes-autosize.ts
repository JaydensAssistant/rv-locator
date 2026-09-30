import { domInstanceOf } from './dom';

export const NOTES_MIN_LINES = 1;
export const NOTES_MAX_LINES = 5;

const NOTES_SELECTOR = '.rv-dashboard textarea';

export interface NotesMeasure {
	/** `scrollHeight` with the box at its smallest, padding included. */
	scrollHeight: number;
	lineHeight: number;
	paddingY: number;
	borderY: number;
	borderBox: boolean;
}

/**
 * Height for a visit notes box: one line when empty, growing with the text
 * up to five lines. Past five lines the box scrolls instead of growing.
 */
export function notesBoxHeight(measure: NotesMeasure): { height: number; scroll: boolean } {
	const line = measure.lineHeight > 0 ? measure.lineHeight : 20;
	const content = Math.max(0, measure.scrollHeight - measure.paddingY);
	const min = line * NOTES_MIN_LINES;
	const max = line * NOTES_MAX_LINES;
	const inner = Math.min(max, Math.max(min, content));
	const scroll = content > max + 1;
	const height = measure.borderBox ? inner + measure.paddingY + measure.borderY : inner;
	return { height: Math.ceil(height), scroll };
}

export function isNotesBox(target: EventTarget | null): target is HTMLTextAreaElement {
	return domInstanceOf(target, HTMLTextAreaElement) && target.closest('.rv-dashboard') != null;
}

/** Fit one notes box to its text. The scroll position of the note is kept. */
export function fitNotesBox(area: HTMLTextAreaElement): void {
	if (!area.isConnected) return;
	const style = getComputedStyle(area);
	const fontSize = parseFloat(style.fontSize) || 16;
	const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.45;
	const paddingY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
	const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
	const scroller = area.closest('.markdown-preview-view, .cm-scroller');
	const scrollTop = scroller?.scrollTop ?? 0;
	area.setCssStyles({ height: '0px', overflowY: 'hidden' });
	const fit = notesBoxHeight({
		scrollHeight: area.scrollHeight,
		lineHeight,
		paddingY,
		borderY,
		borderBox: style.boxSizing === 'border-box',
	});
	area.setCssStyles({ height: `${fit.height}px`, overflowY: fit.scroll ? 'auto' : 'hidden' });
	if (scroller && scroller.scrollTop !== scrollTop) scroller.scrollTop = scrollTop;
}

/** Grow or shrink every visit notes box under `root`. */
export function fitNotesBoxes(root: ParentNode): void {
	root.querySelectorAll(NOTES_SELECTOR).forEach((area) => {
		if (domInstanceOf(area, HTMLTextAreaElement)) fitNotesBox(area);
	});
	if (domInstanceOf(root, HTMLTextAreaElement) && root.matches(NOTES_SELECTOR)) fitNotesBox(root);
}
