import { stripStampAge } from './dates';
import { stampDateTime } from './schedule';

export interface VisitStampRef {
	text: string;
	when: number;
	fileIndex: number;
}

const STAMP_HEADING = /^(?:###|#####)\s+(.+?)\s*$/;

/**
 * Visit headings in file order. `### Recent Notes:` and `### Visit Notes:` are not visits.
 * The stored note is not rewritten. The screen keeps this order.
 */
export function visitStampsInMarkdown(markdown: string): VisitStampRef[] {
	const stamps: VisitStampRef[] = [];
	const lines = markdown.split(/\r?\n/);
	for (const line of lines) {
		const match = STAMP_HEADING.exec(line.replace(/\r$/, ''));
		if (!match) continue;
		const text = stripStampAge(match[1] ?? '').trim();
		if (!text || /^(?:visit|recent) notes:?$/i.test(text)) continue;
		const when = stampDateTime(text)?.getTime() ?? Number.NaN;
		if (!Number.isFinite(when)) continue;
		stamps.push({ text, when, fileIndex: stamps.length });
	}
	return stamps;
}

export interface VisitPartition<T extends VisitStampRef> {
	visible: T[];
	older: T[];
}

/**
 * `newestFirst` is display order only.
 * When collapsing, the most recent `limit` visits stay visible and the rest
 * are the older group, in that same display order.
 */
export function partitionVisits<T extends VisitStampRef>(
	items: readonly T[],
	newestFirst: boolean,
	collapseOlder: boolean,
	limit: number,
): VisitPartition<T> {
	const ordered = [...items].sort((a, b) => newestFirst
		? (b.when - a.when) || (a.fileIndex - b.fileIndex)
		: (a.fileIndex - b.fileIndex));
	if (!collapseOlder) return { visible: ordered, older: [] };
	const cap = Math.max(0, Math.floor(limit));
	const recent = [...items].sort((a, b) => (b.when - a.when) || (a.fileIndex - b.fileIndex)).slice(0, cap);
	const recentIds = new Set(recent);
	return {
		visible: ordered.filter((item) => recentIds.has(item)),
		older: ordered.filter((item) => !recentIds.has(item)),
	};
}

export interface VisitLayoutOptions {
	newestFirst: boolean;
	collapseOlder: boolean;
	limit: number;
}

/**
 * Leave visit sections in file order. The newest notes are already at the
 * top of the note. Visits after the visible count sit under an `h2`
 * Older Visits, collapsed, without moving any stamp.
 */
export function layoutVisitNotes(root: HTMLElement, markdown: string, options: VisitLayoutOptions): void {
	const preview = visitPreview(root);
	if (!preview) return;
	const stamps = stampHeads(preview);
	if (stamps.length === 0) return;
	const fileStamps = visitStampsInMarkdown(markdown);
	clearOlderChrome(preview);
	const blocks = blocksFor(preview, stamps);
	if (blocks.length === 0) return;
	const matched = matchBlocks(blocks, fileStamps);
	const cap = options.collapseOlder ? Math.max(0, Math.floor(options.limit)) : matched.length;
	const older = matched.slice(cap);
	for (const block of matched) {
		for (const node of block.nodes) node.classList.remove('rv-older-visit', 'rv-older-hidden');
	}
	if (older.length === 0) return;
	const first = older[0]?.nodes[0];
	const parent = first?.parentElement;
	if (!first || !parent) return;
	const collapsed = preview.dataset.rvOlderOpen !== '1';
	const rule = parent.ownerDocument.createElement('hr');
	rule.className = 'rv-older-rule';
	const heading = parent.ownerDocument.createElement('h2');
	heading.className = 'rv-older-visits';
	if (!collapsed) heading.classList.add('is-open');
	heading.dataset.heading = 'Older Visits';
	const mark = parent.ownerDocument.createElement('span');
	mark.className = 'collapse-indicator collapse-icon';
	appendHeadingChevron(mark);
	const label = parent.ownerDocument.createElement('span');
	label.className = 'rv-older-label';
	label.textContent = 'Older Visits';
	heading.appendChild(mark);
	heading.appendChild(label);
	parent.insertBefore(rule, first);
	parent.insertBefore(heading, first);
	for (const block of older) {
		for (const node of block.nodes) {
			node.classList.add('rv-older-visit');
			node.classList.toggle('rv-older-hidden', collapsed);
		}
	}
	const toggle = (event: Event) => {
		event.preventDefault();
		if ('stopPropagation' in event && typeof event.stopPropagation === 'function') event.stopPropagation();
		const open = preview.dataset.rvOlderOpen === '1';
		preview.dataset.rvOlderOpen = open ? '0' : '1';
		const nowCollapsed = preview.dataset.rvOlderOpen !== '1';
		heading.classList.toggle('is-open', !nowCollapsed);
		preview.querySelectorAll('.rv-older-visit').forEach((node) => {
			if (node instanceof HTMLElement) node.classList.toggle('rv-older-hidden', nowCollapsed);
		});
	};
	heading.addEventListener('click', toggle);
}

interface VisitBlock extends VisitStampRef {
	nodes: HTMLElement[];
}

/** Same lucide chevron-right Obsidian draws on a collapsed heading. Open rotates it down. */
function appendHeadingChevron(mark: HTMLElement): void {
	const doc = mark.ownerDocument;
	const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('class', 'svg-icon lucide-chevron-right');
	svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', 'm9 18 6-6-6-6');
	svg.appendChild(path);
	mark.appendChild(svg);
}

function visitPreview(root: HTMLElement): HTMLElement | null {
	const found = root.closest('.markdown-preview-view, .markdown-reading-view, .markdown-rendered');
	if (found instanceof HTMLElement) return found;
	if (root.querySelector('h3, h5')) return root;
	return root.parentElement;
}

function stampHeads(preview: HTMLElement): HTMLElement[] {
	const found: HTMLElement[] = [];
	preview.querySelectorAll('h3, h5').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (node.classList.contains('rv-older-visits') || node.classList.contains('rv-visit-notes-heading')) return;
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (/^(?:visit|recent) notes:?$/i.test(text)) return;
		if (node.classList.contains('rv-visit-stamp') || node.querySelector('.rv-stamp-ago')) found.push(node);
	});
	return found;
}

/**
 * Obsidian 1.13 puts every block in one `.markdown-preview-section` sizer.
 * The move unit is the highest ancestor that does not contain another stamp,
 * so the walk is that unit's siblings and not the shared sizer.
 */
function visitMoveUnit(stamp: HTMLElement, stamps: readonly HTMLElement[], boundary: HTMLElement): HTMLElement {
	let node = stamp;
	while (node.parentElement && node.parentElement !== boundary && boundary.contains(node.parentElement)) {
		const parent = node.parentElement;
		if (stamps.some((other) => other !== stamp && parent.contains(other))) break;
		node = parent;
	}
	return node;
}

function blocksFor(preview: HTMLElement, stamps: readonly HTMLElement[]): VisitBlock[] {
	const blocks: VisitBlock[] = [];
	const units = stamps.map((stamp) => visitMoveUnit(stamp, stamps, preview));
	for (let index = 0; index < stamps.length; index += 1) {
		const stamp = stamps[index];
		const start = units[index];
		if (!stamp || !start) continue;
		const end = units[index + 1] ?? null;
		const nodes: HTMLElement[] = [];
		let cursor: HTMLElement | null = start;
		while (cursor && cursor !== end) {
			if (cursor.classList.contains('rv-older-rule') || cursor.classList.contains('rv-older-visits')) {
				cursor = cursor.nextElementSibling instanceof HTMLElement ? cursor.nextElementSibling : null;
				continue;
			}
			if (cursor !== start && isStop(cursor)) break;
			nodes.push(cursor);
			const next = cursor.nextElementSibling;
			cursor = next instanceof HTMLElement ? next : null;
		}
		if (nodes.length === 0) continue;
		const text = stripStampAge((stamp.textContent ?? '').replace(/\s+/g, ' ').trim());
		const when = stampDateTime(text)?.getTime() ?? Number.NaN;
		blocks.push({
			text,
			when: Number.isFinite(when) ? when : 0,
			fileIndex: index,
			nodes,
		});
	}
	return blocks;
}

function isStop(node: HTMLElement): boolean {
	if (node.classList.contains('rv-older-rule') || node.classList.contains('rv-older-visits')) return false;
	if (node.classList.contains('rv-locator-return-suggestions')) return true;
	const title = node.querySelector('.callout-title');
	if ((title?.textContent ?? '').includes('Return Suggestions')) return true;
	if (node.querySelector('.rv-locator-return-suggestions')) return true;
	if (node.tagName === 'HR') return true;
	const rule = node.querySelector('hr');
	return rule instanceof HTMLElement && !rule.classList.contains('rv-older-rule');
}

function matchBlocks(blocks: readonly VisitBlock[], fileStamps: readonly VisitStampRef[]): VisitBlock[] {
	const used = new Set<number>();
	return blocks.map((block, index) => {
		const fileIndex = fileStamps.findIndex((stamp, stampIndex) => {
			if (used.has(stampIndex)) return false;
			return stamp.text === block.text || block.text.includes(stamp.text) || stamp.text.includes(block.text);
		});
		if (fileIndex >= 0) used.add(fileIndex);
		const file = fileIndex >= 0 ? fileStamps[fileIndex] : null;
		return {
			...block,
			when: file?.when ?? block.when,
			fileIndex: file?.fileIndex ?? index,
		};
	});
}

function clearOlderChrome(preview: HTMLElement): void {
	preview.querySelectorAll('.rv-older-rule, .rv-older-visits').forEach((node) => node.remove());
	preview.querySelectorAll('.rv-older-visit').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		node.classList.remove('rv-older-visit', 'rv-older-hidden');
	});
}
