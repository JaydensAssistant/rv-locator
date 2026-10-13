import { stripStampAge } from './dates';
import { stampDateTime } from './schedule';

/**
 * Older Visits open/closed state, in memory, per file path.
 * A section decides it is older from its own line numbers. Hiding is a root
 * class. Nothing here caches or reinserts preview nodes.
 */

const openByPath = new Map<string, boolean>();
const openByRoot = new WeakMap<HTMLElement, boolean>();

export function olderVisitsOpen(path: string, root?: HTMLElement | null): boolean {
	if (path && openByPath.has(path)) return openByPath.get(path) === true;
	if (root && openByRoot.has(root)) return openByRoot.get(root) === true;
	return false;
}

export function setOlderVisitsOpenState(path: string, open: boolean, root?: HTMLElement | null): void {
	if (path) openByPath.set(path, open);
	if (root) openByRoot.set(root, open);
}

export function toggleOlderVisits(path: string, root?: HTMLElement | null): boolean {
	const next = !olderVisitsOpen(path, root);
	setOlderVisitsOpenState(path, next, root);
	return next;
}

export function clearOlderVisitsState(): void {
	openByPath.clear();
}

export interface VisitLineSpan {
	index: number;
	line: number;
	end: number;
	older: boolean;
	firstOlder: boolean;
}

/** Visit blocks in file order. The first `limit` stay visible when collapsing. */
export function visitLineSpans(markdown: string, limit: number, collapse: boolean): VisitLineSpan[] {
	const lines = markdown.split(/\r?\n/);
	const stamps: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (visitStampLine(lines[index] ?? '')) stamps.push(index);
	}
	const cap = collapse ? Math.max(0, Math.floor(limit)) : stamps.length;
	const firstLine = stamps.length > cap ? stamps[cap] ?? -1 : -1;
	return stamps.map((line, index) => ({
		index,
		line,
		end: stamps[index + 1] ?? lines.length,
		older: index >= cap,
		firstOlder: line === firstLine,
	}));
}

export type VisitSectionRole = 'none' | 'visible' | 'older' | 'first-older';

/** `lineStart`/`lineEnd` are the section's own lines, from `getSectionInfo`. */
export function visitSectionRole(
	spans: readonly VisitLineSpan[],
	lineStart: number,
	lineEnd: number,
): VisitSectionRole {
	let role: VisitSectionRole = 'none';
	for (const span of spans) {
		const containsStamp = lineStart <= span.line && span.line <= lineEnd;
		const inside = lineStart >= span.line && lineStart < span.end;
		if (!containsStamp && !inside) continue;
		if (span.firstOlder && containsStamp) return 'first-older';
		if (span.older) role = 'older';
		else if (role === 'none') role = 'visible';
	}
	return role;
}

const CHEVRON_PATH = 'm9 18 6-6-6-6';
const STAMP_HEADING = /^(?:###|#####)\s+(.+?)\s*$/;

function visitStampLine(line: string): string | null {
	const match = STAMP_HEADING.exec(line.replace(/\r$/, ''));
	if (!match) return null;
	const text = stripStampAge(match[1] ?? '').trim();
	if (!text || /^(?:visit|recent) notes:?$/i.test(text)) return null;
	if (stampDateTime(text) == null) return null;
	return text;
}

function olderRoots(doc: Document, path: string, root: HTMLElement): HTMLElement[] {
	const found: HTMLElement[] = [];
	const nodes = doc.querySelectorAll?.('.markdown-reading-view, .markdown-preview-view') ?? [];
	nodes.forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (path && node.dataset.rvNoteFile && node.dataset.rvNoteFile !== path) return;
		found.push(node);
	});
	if (found.length === 0) found.push(root);
	return found;
}

function paintOlderChrome(path: string, root: HTMLElement, hasOlder: boolean): void {
	const open = olderVisitsOpen(path, root);
	const collapsed = hasOlder && !open;
	const doc = root.ownerDocument;
	for (const node of olderRoots(doc, path, root)) {
		node.classList.toggle('rv-older-collapsed', collapsed);
		node.querySelectorAll('.rv-older-visits').forEach((heading) => {
			if (heading instanceof HTMLElement) heading.classList.toggle('is-open', open);
		});
	}
}

function wireOlderHeader(heading: HTMLElement, path: string, root: HTMLElement, hasOlder: boolean): void {
	if (heading.dataset.rvOlderBound === '1') return;
	heading.dataset.rvOlderBound = '1';
	heading.addEventListener('click', (event) => {
		event.preventDefault();
		if (typeof event.stopPropagation === 'function') event.stopPropagation();
		toggleOlderVisits(path, root);
		paintOlderChrome(path, root, hasOlder);
	});
}

/** Our fold header, created in the first older heading's section. */
export function ensureOlderHeader(section: HTMLElement, path: string, root: HTMLElement): HTMLElement {
	let heading: HTMLElement | null = null;
	for (const kid of Array.from(section.children)) {
		if (!(kid instanceof HTMLElement)) continue;
		if (kid.classList.contains('rv-older-visits')) heading = kid;
		else if (kid.classList.contains('rv-older-visits-wrap')) {
			const inner = kid.querySelector('.rv-older-visits');
			if (inner instanceof HTMLElement) heading = inner;
		}
	}
	if (heading instanceof HTMLElement) {
		wireOlderHeader(heading, path, root, true);
		return heading;
	}
	const doc = section.ownerDocument;
	const rule = doc.createElement('hr');
	rule.className = 'rv-older-rule';
	const wrap = doc.createElement('div');
	wrap.className = 'el-h3 rv-older-visits-wrap';
	const created = doc.createElement('h3');
	created.className = 'rv-older-visits';
	created.dataset.heading = 'Older Visits';
	const mark = doc.createElement('span');
	mark.className = 'collapse-indicator collapse-icon';
	if (!mark.querySelector('svg')) {
		const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('class', 'svg-icon lucide-chevron-right');
		svg.setAttribute('width', '16');
		svg.setAttribute('height', '16');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
		icon.setAttribute('d', CHEVRON_PATH);
		svg.appendChild(icon);
		mark.appendChild(svg);
	}
	const label = doc.createElement('span');
	label.className = 'rv-older-label';
	label.textContent = 'Older Visits';
	created.appendChild(mark);
	created.appendChild(label);
	wrap.appendChild(created);
	const anchor = section.children[0] instanceof HTMLElement ? section.children[0] : null;
	section.insertBefore(wrap, anchor);
	section.insertBefore(rule, wrap);
	wireOlderHeader(created, path, root, true);
	return created;
}

export interface OlderSectionOptions {
	limit: number;
	collapseOlder: boolean;
}

/**
 * Mark one post-processor section from its line numbers.
 * The root class is what hides older sections.
 */
export function classifyVisitSection(
	section: HTMLElement,
	path: string,
	markdown: string,
	lineStart: number,
	lineEnd: number,
	options: OlderSectionOptions,
): VisitSectionRole {
	const root = section.closest('.markdown-reading-view, .markdown-preview-view');
	const preview = root instanceof HTMLElement ? root : section;
	const spans = visitLineSpans(markdown, options.limit, options.collapseOlder);
	const role = visitSectionRole(spans, lineStart, lineEnd);
	const older = role === 'older' || role === 'first-older';
	section.classList.toggle('rv-older-section', older);
	section.classList.toggle('rv-older-first', role === 'first-older');
	if (role === 'first-older') ensureOlderHeader(section, path, preview);
	paintOlderChrome(path, preview, spans.some((span) => span.older));
	return role;
}

function isStampHeading(node: HTMLElement): boolean {
	if (node.classList.contains('rv-older-visits') || node.classList.contains('rv-visit-notes-heading') || node.classList.contains('rv-fold-stop-heading')) return false;
	if (node.classList.contains('rv-visit-stamp')) return true;
	const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/^#{1,6}\s+/, '');
	return visitStampLine(`##### ${text}`) != null;
}

/** The heading's own block: the highest ancestor that does not contain another stamp. */
function blockOf(heading: HTMLElement, boundary: HTMLElement): HTMLElement {
	let node = heading;
	while (node.parentElement && node.parentElement !== boundary && boundary.contains(node.parentElement)) {
		const parent = node.parentElement;
		const stamps = parent.querySelectorAll('h3, h5');
		let other = false;
		stamps.forEach((item) => {
			if (item !== heading && item instanceof HTMLElement && isStampHeading(item)) other = true;
		});
		if (other) break;
		node = parent;
	}
	return node;
}

/**
 * Full-preview pass used when a test or a refresh already has every stamp.
 * Classes and one header only. Nodes Obsidian created stay where they are.
 */
export function markPreviewOlderVisits(
	preview: HTMLElement,
	options: OlderSectionOptions,
	path = '',
): void {
	if (preview.classList.contains('markdown-source-view') || preview.classList.contains('cm-content') || preview.querySelector('.cm-content, .cm-editor')) return;
	const headings = Array.from(preview.querySelectorAll('h3, h5')).filter((node): node is HTMLElement => (
		node instanceof HTMLElement && isStampHeading(node)
	));
	const cap = options.collapseOlder ? Math.max(0, Math.floor(options.limit)) : headings.length;
	const blocks = headings.map((heading) => blockOf(heading, preview));
	for (const block of blocks) {
		block.classList.remove('rv-older-section', 'rv-older-first');
		let cursor = block.nextElementSibling;
		while (cursor instanceof HTMLElement && !blocks.includes(cursor) && !isStampHeading(cursor)) {
			if (cursor.querySelector('h3.rv-visit-stamp, h5.rv-visit-stamp, h3.rv-older-visits')) break;
			cursor.classList.remove('rv-older-section', 'rv-older-first');
			const next = cursor.nextElementSibling;
			if (cursor.classList.contains('rv-older-visits-wrap') || cursor.classList.contains('rv-older-rule') || cursor.classList.contains('callout') || cursor.tagName === 'HR') break;
			cursor = next;
		}
	}
	headings.forEach((heading, index) => {
		const block = blockOf(heading, preview);
		const older = index >= cap && headings.length > cap;
		block.classList.toggle('rv-older-section', older);
		block.classList.toggle('rv-older-first', older && index === cap);
		let cursor = block.nextElementSibling;
		while (cursor instanceof HTMLElement) {
			if (blocks.includes(cursor) || isStampHeading(cursor)) break;
			if (cursor.classList.contains('callout') || cursor.classList.contains('rv-notes-fold-stop') || cursor.classList.contains('rv-older-visits-wrap') || cursor.classList.contains('rv-older-rule')) break;
			if (cursor.tagName === 'HR' && !cursor.classList.contains('rv-older-rule')) break;
			cursor.classList.toggle('rv-older-section', older);
			cursor = cursor.nextElementSibling;
		}
		if (older && index === cap) ensureOlderHeader(block, path, preview);
	});
	paintOlderChrome(path, preview, headings.length > cap);
}
