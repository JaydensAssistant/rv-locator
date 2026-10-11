import { stripFilenameStamp } from './note-name';

const STAMPED = /\s+\d{4}-\d{2}-\d{2}(?:[ T]\d{4})?$/;

/** View header, inline title, tab, file explorer, search, and the quick switcher. */
export const STAMP_TITLE_SELECTOR = [
	'.view-header-title',
	'.inline-title',
	'.workspace-tab-header-inner-title',
	'.nav-file-title-content',
	'.search-result-file-title',
	'.suggestion-title',
].join(', ');

export function basenameHasStamp(basename: string): boolean {
	return STAMPED.test(basename.trim());
}

/** The name Obsidian should show. The file on disk keeps the stamp. */
export function rvDisplayTitle(basename: string): string {
	const next = stripFilenameStamp(basename);
	return next || basename.trim();
}

/**
 * Exact basename, or the basename Obsidian puts in front of ` - Vault`.
 * Other text is left alone.
 */
export function maskStampText(text: string, stamped: string, display: string): string {
	if (!stamped || stamped === display) return text;
	if (text === stamped) return display;
	if (text.startsWith(`${stamped} - `) || text.startsWith(`${stamped} — `)) {
		return display + text.slice(stamped.length);
	}
	return text;
}

/** Rewrite title text nodes. A focused inline title and status chips stay as they are. */
export function maskTitleElement(el: HTMLElement, pairs: readonly { stamped: string; display: string }[]): void {
	if (pairs.length === 0) return;
	if (el.classList.contains('rv-note-status') || el.closest('.rv-note-status')) return;
	const doc = el.ownerDocument;
	if (doc.activeElement === el) return;
	if (typeof doc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') {
		const raw = el.textContent ?? '';
		for (const pair of pairs) {
			const next = maskStampText(raw, pair.stamped, pair.display);
			if (next !== raw) el.textContent = next;
		}
		return;
	}
	const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const parent = node.parentElement;
		if (parent?.classList.contains('rv-note-status') || parent?.closest('.rv-note-status')) {
			node = walker.nextNode();
			continue;
		}
		const raw = node.textContent ?? '';
		for (const pair of pairs) {
			const next = maskStampText(raw, pair.stamped, pair.display);
			if (next !== raw) node.textContent = next;
		}
		node = walker.nextNode();
	}
}
