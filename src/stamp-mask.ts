import { stripFilenameStamp } from './note-name';

/**
 * Core file UI is out of scope. Touching these nodes broke inline rename,
 * search, and the quick switcher, and saving an edited inline title renamed
 * the note on disk. The mask refuses them even if a caller passes one in.
 */
const CORE_FILE_UI = [
	'.inline-title',
	'.view-header-title',
	'.view-header-breadcrumb',
	'.nav-file',
	'.nav-file-title',
	'.nav-file-title-content',
	'.nav-folder-title',
	'.search-result',
	'.search-result-file-title',
	'.suggestion',
	'.suggestion-item',
	'.suggestion-title',
	'.prompt',
].join(', ');

export function basenameHasStamp(basename: string): boolean {
	const name = basename.trim();
	const display = stripFilenameStamp(name);
	return display.length > 0 && display !== name;
}

/** The name plugin surfaces show. The file on disk keeps the stamp. */
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

/** Rewrite title text nodes on a plugin header or tab. Core file UI is left untouched. */
export function maskTitleElement(el: HTMLElement, pairs: readonly { stamped: string; display: string }[]): void {
	if (pairs.length === 0) return;
	if (isCoreFileUi(el)) return;
	if (el.classList.contains('rv-note-status') || el.closest('.rv-note-status')) return;
	if (el.isContentEditable || el.closest('[contenteditable="true"]')) return;
	const doc = el.ownerDocument;
	if (doc.activeElement === el) return;
	if (typeof doc.createTreeWalker !== 'function' || typeof NodeFilter === 'undefined') return;
	const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const parent = node.parentElement;
		if (!parent || isCoreFileUi(parent) || parent.classList.contains('rv-note-status') || parent.closest('.rv-note-status')) {
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

function isCoreFileUi(el: HTMLElement): boolean {
	return el.matches(CORE_FILE_UI) || el.closest(CORE_FILE_UI) != null;
}
