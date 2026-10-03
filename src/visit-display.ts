import { stripStampAge } from './dates';
import { stampDateTime } from './schedule';

export interface VisitStampRef {
	text: string;
	when: number;
	fileIndex: number;
}

const STAMP_HEADING = /^(?:###|#####)\s+(.+?)\s*$/;

/**
 * Visit headings in file order. `### Visit Notes:` is not a visit.
 * The stored note is not rewritten; this is only the order to paint.
 */
export function visitStampsInMarkdown(markdown: string): VisitStampRef[] {
	const stamps: VisitStampRef[] = [];
	const lines = markdown.split(/\r?\n/);
	for (const line of lines) {
		const match = STAMP_HEADING.exec(line.replace(/\r$/, ''));
		if (!match) continue;
		const text = stripStampAge(match[1] ?? '').trim();
		if (!text || /^visit notes:?$/i.test(text)) continue;
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
 * Reorder rendered visit sections so the latest notes sit at the top when
 * that setting is on, and park the rest under an `h2` Older Visits.
 * The file is not written.
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
	const partition = partitionVisits(matched, options.newestFirst, options.collapseOlder, options.limit);
	const parent = blocks[0]?.nodes[0]?.parentElement;
	if (!parent) return;
	const anchor = endAnchor(parent);
	const before = anchor ?? null;
	for (const block of partition.visible) placeBlock(parent, block, before, false);
	if (partition.older.length === 0) return;
	const rule = parent.ownerDocument.createElement('hr');
	rule.className = 'rv-older-rule';
	const heading = parent.ownerDocument.createElement('h2');
	heading.className = 'rv-older-visits';
	heading.dataset.heading = 'Older Visits';
	heading.textContent = 'Older Visits';
	const collapsed = preview.dataset.rvOlderOpen !== '1';
	heading.classList.toggle('is-collapsed', collapsed);
	if (before) parent.insertBefore(rule, before);
	else parent.appendChild(rule);
	if (before) parent.insertBefore(heading, before);
	else parent.appendChild(heading);
	for (const block of partition.older) placeBlock(parent, block, before, collapsed);
	if (heading.dataset.rvBound === '1') return;
	heading.dataset.rvBound = '1';
	heading.addEventListener('click', (event) => {
		event.preventDefault();
		const open = preview.dataset.rvOlderOpen === '1';
		preview.dataset.rvOlderOpen = open ? '0' : '1';
		const nowCollapsed = preview.dataset.rvOlderOpen !== '1';
		heading.classList.toggle('is-collapsed', nowCollapsed);
		preview.querySelectorAll('.rv-older-visit').forEach((node) => {
			if (node instanceof HTMLElement) node.classList.toggle('rv-older-hidden', nowCollapsed);
		});
	});
}

interface VisitBlock extends VisitStampRef {
	nodes: HTMLElement[];
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
		if (/^visit notes:?$/i.test(text)) return;
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

/** Thematic break or Return Suggestions that should stay below Older Visits. */
function endAnchor(parent: HTMLElement): HTMLElement | null {
	for (const child of Array.from(parent.children)) {
		if (!(child instanceof HTMLElement)) continue;
		if (child.classList.contains('rv-older-rule') || child.classList.contains('rv-older-visits')) continue;
		if (isStop(child)) return child;
	}
	return null;
}

function placeBlock(parent: HTMLElement, block: VisitBlock, before: HTMLElement | null, hidden: boolean): void {
	for (const node of block.nodes) {
		node.classList.toggle('rv-older-visit', hidden);
		node.classList.toggle('rv-older-hidden', hidden);
		if (before && before.parentElement === parent) parent.insertBefore(node, before);
		else parent.appendChild(node);
	}
}

function clearOlderChrome(preview: HTMLElement): void {
	preview.querySelectorAll('.rv-older-rule, .rv-older-visits').forEach((node) => node.remove());
	preview.querySelectorAll('.rv-older-visit').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		node.classList.remove('rv-older-visit', 'rv-older-hidden');
	});
}
