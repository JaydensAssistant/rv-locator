import { stripStampAge } from './dates';
import { stampDateTime } from './schedule';

export interface VisitStampRef {
	text: string;
	when: number;
	fileIndex: number;
}

const STAMP_HEADING = /^(?:###|#####)\s+(.+?)\s*$/;

/** A `###` / `#####` visit stamp line, or null when the line is not a visit. */
export function visitStampLine(line: string): string | null {
	const match = STAMP_HEADING.exec(line.replace(/\r$/, ''));
	if (!match) return null;
	const text = stripStampAge(match[1] ?? '').trim();
	if (!text || /^(?:visit|recent) notes:?$/i.test(text)) return null;
	if (stampDateTime(text) == null) return null;
	return text;
}

/**
 * Visit headings in file order. `### Recent Notes:` and `### Visit Notes:` are not visits.
 * The stored note is not rewritten. The screen keeps this order.
 */
export function visitStampsInMarkdown(markdown: string): VisitStampRef[] {
	const stamps: VisitStampRef[] = [];
	const lines = markdown.split(/\r?\n/);
	for (const line of lines) {
		const text = visitStampLine(line);
		if (!text) continue;
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
 * top of the note. Visits after the visible count sit under an `h3`
 * Older Visits, the same level as Recent Notes, collapsed, without moving any stamp.
 */
export function layoutVisitNotes(root: HTMLElement, markdown: string, options: VisitLayoutOptions): void {
	const preview = visitPreview(root);
	if (!preview) return;
	// Live Preview is a CodeMirror document. Inserting nodes there writes the
	// note. Older Visits in that mode is an editor decoration, never DOM.
	if (isCodeMirrorSurface(preview)) return;
	if (preview.dataset.rvLaying === '1') return;
	preview.dataset.rvLaying = '1';
	preview.dataset.rvFolding = '1';
	disconnectRecent(preview);
	try {
		layoutVisitNotesNow(preview, markdown, options);
	} finally {
		preview.dataset.rvLaying = '0';
		delete preview.dataset.rvFolding;
		concealCollapsedVisitNotes(preview);
		settleRecent(preview);
	}
}

function isCodeMirrorSurface(preview: HTMLElement): boolean {
	if (preview.classList.contains('markdown-source-view') || preview.classList.contains('cm-content') || preview.classList.contains('cm-editor')) return true;
	return preview.querySelector('.cm-content, .cm-editor') != null;
}

function layoutVisitNotesNow(
	preview: HTMLElement,
	markdown: string,
	options: VisitLayoutOptions,
): void {
	armRecentNotesRelayout(preview, markdown, options);
	decorateRecentChevron(preview);
	const stamps = stampHeads(preview);
	const fileStamps = visitStampsInMarkdown(markdown);
	if (stamps.length === 0) {
		restoreRecentTail(preview);
		return;
	}
	if (fileStamps.length > 0 && stamps.length < fileStamps.length) return;
	if (visitNotesTyping(preview) && preview.querySelector('.rv-older-visits')) {
		releaseRecentNotesTail(preview);
		rememberRecentTail(preview);
		return;
	}
	const blocks = blocksFor(preview, stamps);
	if (blocks.length === 0) return;
	const matched = matchBlocks(blocks, fileStamps);
	const cap = options.collapseOlder ? Math.max(0, Math.floor(options.limit)) : matched.length;
	const older = matched.slice(cap);
	for (const block of matched) {
		for (const node of block.nodes) {
			setClass(node, 'rv-older-visit', false);
			setClass(node, 'rv-older-hidden', false);
		}
	}
	preview.dataset.rvOlderExpected = older.length > 0 ? '1' : '0';
	if (older.length === 0) {
		clearOlderChrome(preview);
		ensureSuggestionStop(preview);
		releaseRecentNotesTail(preview);
		rememberRecentTail(preview);
		return;
	}
	const first = older[0]?.nodes[0];
	const parent = first?.parentElement;
	if (!first || !parent) return;
	const collapsed = preview.dataset.rvOlderOpen !== '1';
	const existing = olderChromeFits(preview, first);
	const heading = existing ?? insertOlderChrome(preview, parent, first);
	setClass(heading, 'is-open', !collapsed);
	for (const block of older) {
		for (const node of block.nodes) {
			setClass(node, 'rv-older-visit', true);
			setClass(node, 'rv-older-hidden', collapsed);
		}
	}
	releaseRecentNotesTail(preview);
	rememberRecentTail(preview);
}

interface VisitBlock extends VisitStampRef {
	nodes: HTMLElement[];
}

/** Keep an Older Visits control that is already sitting on the first hidden stamp. */
function olderChromeFits(preview: HTMLElement, first: HTMLElement): HTMLElement | null {
	const heading = preview.querySelector('.rv-older-visits');
	if (!(heading instanceof HTMLElement)) return null;
	const wrap = heading.closest('.rv-older-visits-wrap, .rv-older-visits-line');
	const anchor = wrap instanceof HTMLElement ? wrap : heading;
	if (anchor.nextElementSibling !== first) return null;
	const rule = anchor.previousElementSibling;
	if (!(rule instanceof HTMLElement) || !rule.classList.contains('rv-older-rule')) return null;
	return heading;
}

/**
 * Reading view gets an h3 beside Recent Notes. Never insert into CodeMirror:
 * its DOM observer would save that text into the note.
 */
function insertOlderChrome(preview: HTMLElement, parent: HTMLElement, first: HTMLElement): HTMLElement {
	if (first.classList.contains('cm-line') || parent.classList.contains('cm-content') || isCodeMirrorSurface(parent)) return first;
	clearOlderChrome(preview);
	const doc = parent.ownerDocument;
	const rule = doc.createElement('hr');
	rule.className = 'rv-older-rule';
	const wrap = doc.createElement('div');
	wrap.className = 'el-h3 rv-older-visits-wrap';
	const heading = doc.createElement('h3');
	heading.className = 'rv-older-visits';
	heading.dataset.heading = 'Older Visits';
	const mark = doc.createElement('span');
	mark.className = 'collapse-indicator collapse-icon';
	appendHeadingChevron(mark);
	const label = doc.createElement('span');
	label.className = 'rv-older-label';
	label.textContent = 'Older Visits';
	heading.appendChild(mark);
	heading.appendChild(label);
	wrap.appendChild(heading);
	parent.insertBefore(rule, first);
	parent.insertBefore(wrap, first);
	heading.addEventListener('click', (event) => {
		event.preventDefault();
		if ('stopPropagation' in event && typeof event.stopPropagation === 'function') event.stopPropagation();
		const preview = heading.closest('.markdown-preview-view, .markdown-reading-view, .markdown-rendered, .markdown-source-view');
		const root = preview instanceof HTMLElement ? preview : parent;
		const open = root.dataset.rvOlderOpen === '1';
		root.dataset.rvOlderOpen = open ? '0' : '1';
		const nowCollapsed = root.dataset.rvOlderOpen !== '1';
		setClass(heading, 'is-open', !nowCollapsed);
		root.querySelectorAll('.rv-older-visit').forEach((node) => {
			if (node instanceof HTMLElement) setClass(node, 'rv-older-hidden', nowCollapsed);
		});
	});
	return heading;
}

const CHEVRON_PATH = 'm9 18 6-6-6-6';

/** Same lucide chevron-right as Older Visits. Replaces Obsidian's own chevron. Open rotates it down. */
export function mountHeadingChevron(mark: HTMLElement): void {
	if (chevronReady(mark)) return;
	mark.querySelectorAll('svg').forEach((node) => node.remove());
	appendHeadingChevron(mark);
}

function chevronReady(mark: HTMLElement): boolean {
	let svg: HTMLElement | null = null;
	let count = 0;
	for (const kid of Array.from(mark.children)) {
		if (kid instanceof HTMLElement && kid.tagName === 'SVG') {
			count += 1;
			svg = kid;
		}
	}
	if (count !== 1 || !svg) return false;
	const path = svg.querySelector('path');
	return path instanceof HTMLElement && path.getAttribute('d') === CHEVRON_PATH;
}

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
	path.setAttribute('d', CHEVRON_PATH);
	svg.appendChild(path);
	mark.appendChild(svg);
}

function decorateRecentChevron(preview: HTMLElement): void {
	preview.querySelectorAll('h3').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (node.classList.contains('rv-older-visits')) return;
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (!/^(?:visit|recent) notes:?$/i.test(text) && !node.classList.contains('rv-visit-notes-heading')) return;
		node.classList.add('rv-visit-notes-heading');
		let mark = directChild(node, 'collapse-indicator');
		if (!mark) {
			mark = node.ownerDocument.createElement('span');
			mark.className = 'collapse-indicator collapse-icon';
			node.insertBefore(mark, node.children[0] ?? null);
		}
		mountHeadingChevron(mark);
		setClass(node, 'is-open', !headingIsCollapsed(node));
		bindRecentNotesToggle(preview, node);
	});
}

function collapseHost(heading: HTMLElement): HTMLElement {
	const parent = heading.parentElement;
	if (!parent) return heading;
	const wrapper = ['el-h1', 'el-h2', 'el-h3', 'el-h4', 'el-h5', 'el-h6'].some((name) => parent.classList.contains(name));
	if (wrapper || parent.classList.contains('is-collapsed')) return parent;
	return heading;
}

function headingIsCollapsed(heading: HTMLElement): boolean {
	if (heading.classList.contains('is-collapsed')) return true;
	const host = collapseHost(heading);
	return host !== heading && host.classList.contains('is-collapsed');
}

function bindRecentNotesToggle(preview: HTMLElement, heading: HTMLElement): void {
	if (heading.dataset.rvToggleBound === '1') return;
	heading.dataset.rvToggleBound = '1';
	const sync = (): void => {
		if (preview.dataset.rvFolding === '1' || preview.dataset.rvLaying === '1') return;
		const open = !headingIsCollapsed(heading);
		if (heading.classList.contains('is-open') !== open) heading.classList.toggle('is-open', open);
		scheduleRecentRelayout(preview);
	};
	heading.addEventListener('click', sync);
	const host = collapseHost(heading);
	if (host === heading || typeof MutationObserver === 'undefined') return;
	try {
			const observer = new MutationObserver((records) => {
			if (records.length > 0 && records.every((record) => ownFoldClassChange(record))) return;
			sync();
		});
		observer.observe(host, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
	} catch {
		/* The layout test document is not a browser node. */
	}
}

function directChild(parent: HTMLElement, className: string): HTMLElement | null {
	for (const kid of Array.from(parent.children)) {
		if (kid instanceof HTMLElement && kid.classList.contains(className)) return kid;
	}
	return null;
}

interface RecentWatch {
	markdown: string;
	options: VisitLayoutOptions;
}

const recentWatches = new WeakMap<HTMLElement, RecentWatch>();
const recentSchedules = new WeakMap<HTMLElement, () => void>();
const recentObservers = new WeakMap<HTMLElement, MutationObserver>();

const RECENT_OBSERVE: MutationObserverInit = {
	childList: true,
	subtree: true,
	attributes: true,
	attributeOldValue: true,
	attributeFilter: ['class'],
};

function disconnectRecent(preview: HTMLElement): void {
	recentObservers.get(preview)?.disconnect();
}

/** Drop records our own writes queued, then listen again. */
function settleRecent(preview: HTMLElement): void {
	const observer = recentObservers.get(preview);
	if (!observer) return;
	observer.disconnect();
	observer.takeRecords();
	try {
		observer.observe(preview, RECENT_OBSERVE);
	} catch {
		/* The layout test document is not a browser node. */
	}
}

/**
 * Collapsing Recent Notes rebuilds the section and drops the injected Older
 * Visits heading. Put it back on the live preview after that toggle.
 * A short stamp list (the fold is mid-rebuild) must not clear the chrome.
 */
function olderChromeMissing(preview: HTMLElement, markdown: string, options: VisitLayoutOptions): boolean {
	if (!options.collapseOlder) return false;
	const fileStamps = visitStampsInMarkdown(markdown);
	const cap = Math.max(0, Math.floor(options.limit));
	if (fileStamps.length <= cap) return false;
	return preview.querySelector('.rv-older-visits') == null;
}

function scheduleRecentRelayout(preview: HTMLElement): void {
	recentSchedules.get(preview)?.();
}

function armRecentNotesRelayout(preview: HTMLElement, markdown: string, options: VisitLayoutOptions): void {
	const existing = recentWatches.get(preview);
	if (existing) {
		existing.markdown = markdown;
		existing.options = options;
		return;
	}
	const state: RecentWatch = { markdown, options };
	recentWatches.set(preview, state);
	let soon: ReturnType<typeof globalThis.setTimeout> | undefined;
	let later: ReturnType<typeof globalThis.setTimeout> | undefined;
	const rerun = (): void => {
		disconnectRecent(preview);
		try {
			restoreRecentTail(preview);
			if (preview.dataset.rvLaying === '1') return;
			if (visitNotesTyping(preview) && preview.querySelector('.rv-older-visits')) {
				releaseRecentNotesTail(preview);
				rememberRecentTail(preview);
				return;
			}
			if (!olderChromeMissing(preview, state.markdown, state.options)) {
				releaseRecentNotesTail(preview);
				rememberRecentTail(preview);
				concealCollapsedVisitNotes(preview);
				return;
			}
			layoutVisitNotes(preview, state.markdown, state.options);
		} finally {
			settleRecent(preview);
		}
	};
	const schedule = (): void => {
		if (soon !== undefined) globalThis.clearTimeout(soon);
		if (later !== undefined) globalThis.clearTimeout(later);
		soon = globalThis.setTimeout(rerun, 60);
		later = globalThis.setTimeout(rerun, 240);
	};
	recentSchedules.set(preview, schedule);
	preview.dataset.rvRecentWatch = '1';
	const onRecentNotes = (event: Event): boolean => {
		const target = (event as { target?: { closest?: (selector: string) => HTMLElement | null } }).target;
		const heading = target?.closest?.('h3');
		if (!heading || heading.classList.contains('rv-older-visits')) return false;
		const title = (heading.textContent ?? '').replace(/\s+/g, ' ');
		return /recent notes:?/i.test(title) || heading.classList.contains('rv-visit-notes-heading');
	};
	preview.addEventListener('pointerdown', (event) => {
		if (!onRecentNotes(event)) return;
		rememberRecentTail(preview);
	}, true);
	preview.addEventListener('click', (event) => {
		if (!onRecentNotes(event)) return;
		const target = (event as { target?: { closest?: (selector: string) => HTMLElement | null } }).target;
		const heading = target?.closest?.('h3');
		if (!heading) return;
		heading.classList.toggle('is-open', !headingIsCollapsed(heading));
		schedule();
	});
	if (typeof MutationObserver === 'undefined') return;
	try {
		const observer = new MutationObserver((records) => {
			// Empty class diffs and our own tokens are not Recent Notes. A visit
			// fold's class writes used to schedule another pass forever.
			if (records.length > 0 && records.every((record) => ownFoldClassChange(record))) return;
			if (records.length > 0 && !records.some((record) => isRecentNotesMutation(preview, record))) return;
			restoreRecentTail(preview);
			schedule();
		});
		recentObservers.set(preview, observer);
	} catch {
		/* The layout test document is not a browser node. */
	}
}

function isRecentNotesMutation(preview: HTMLElement, record: MutationRecord): boolean {
	if (ownFoldClassChange(record)) return false;
	if (record.type === 'childList') {
		const nodes = [...Array.from(record.removedNodes), ...Array.from(record.addedNodes)];
		return nodes.some((node) => node instanceof HTMLElement && isRecentStructureNode(node));
	}
	if (record.type !== 'attributes') return false;
	const target = record.target;
	if (!(target instanceof HTMLElement)) return false;
	const notes = recentNotesHeading(preview);
	if (!notes) return false;
	const host = collapseHost(notes);
	return target === notes || target === host || host.contains(target);
}

function isRecentStructureNode(node: HTMLElement): boolean {
	if (node.classList.contains('rv-older-visits') || node.classList.contains('rv-older-visits-wrap') || node.classList.contains('rv-older-visits-line') || node.classList.contains('rv-older-rule') || node.classList.contains('rv-notes-fold-stop')) return true;
	if (node.classList.contains('rv-locator-return-suggestions')) return true;
	if (node.querySelector('.rv-older-visits, .rv-older-visits-wrap, .rv-locator-return-suggestions')) return true;
	const title = node.querySelector('.callout-title');
	return (title?.textContent ?? '').includes('Return Suggestions');
}

function visitPreview(root: HTMLElement): HTMLElement | null {
	const found = root.closest('.markdown-preview-view, .markdown-reading-view, .markdown-rendered, .markdown-source-view');
	if (found instanceof HTMLElement) return found;
	if (root.querySelector('h3, h5, .cm-line')) return root;
	return root.parentElement;
}

const FOLD_CLASS = 'rv-visit-folded';

/**
 * Hide Meta Bind text areas under a collapsed visit heading, and any text area
 * that mounted late under a collapsed Older Visits group. Render only.
 * A collapsed heading starts hidden before the next paint when the fold class
 * is already on the wrapper; a later mount is hidden from the mutation observer.
 */
export function concealCollapsedVisitNotes(root: HTMLElement): void {
	const preview = visitPreview(root);
	if (!preview) return;
	watchCollapsedVisitNotes(preview);
	if (preview.dataset.rvLaying === '1') return;
	applyCollapsedVisitNotes(preview);
}

const FOLD_OBSERVE: MutationObserverInit = {
	subtree: true,
	childList: true,
	attributes: true,
	attributeOldValue: true,
	attributeFilter: ['class', 'style'],
};

interface FoldSlot {
	observer: MutationObserver;
	pending: boolean;
}

const foldSlots = new WeakMap<HTMLElement, FoldSlot>();

function watchCollapsedVisitNotes(preview: HTMLElement): void {
	if (foldSlots.has(preview) || typeof MutationObserver === 'undefined') return;
	const slot: FoldSlot = { observer: null as unknown as MutationObserver, pending: false };
	const schedule = (): void => {
		if (slot.pending) return;
		slot.pending = true;
		const run = (): void => {
			slot.pending = false;
			applyCollapsedVisitNotes(preview);
		};
		const raf = globalThis.requestAnimationFrame;
		if (typeof raf === 'function') raf(() => run());
		else globalThis.setTimeout(run, 0);
	};
	let observer: MutationObserver;
	try {
		observer = new MutationObserver((records) => {
			if (records.length > 0 && records.every((record) => ownFoldClassChange(record))) return;
			schedule();
		});
	} catch {
		return;
	}
	slot.observer = observer;
	foldSlots.set(preview, slot);
	try {
		observer.observe(preview, FOLD_OBSERVE);
	} catch {
		foldSlots.delete(preview);
	}
}

const OWN_FOLD_CLASSES = new Set(['rv-visit-folded', 'rv-older-hidden', 'rv-older-visit', 'is-open']);

/**
 * True when a class mutation changed nothing, or only tokens this file writes.
 * An empty diff must be ignored: Obsidian can deliver oldValue === current class,
 * and treating that as work queues the next observer turn forever.
 */
export function foldClassChangeIsOwn(oldValue: string | null, next: string): boolean {
	const before = new Set((oldValue ?? '').split(/\s+/).filter(Boolean));
	const after = new Set(next.split(/\s+/).filter(Boolean));
	const changed = new Set<string>();
	for (const name of before) if (!after.has(name)) changed.add(name);
	for (const name of after) if (!before.has(name)) changed.add(name);
	if (changed.size === 0) return true;
	for (const name of changed) if (!OWN_FOLD_CLASSES.has(name)) return false;
	return true;
}

/** Class edits this file just applied. They must not schedule another pass. */
function ownFoldClassChange(record: MutationRecord): boolean {
	if (record.type !== 'attributes' || record.attributeName !== 'class') return false;
	const target = record.target;
	if (!(target instanceof HTMLElement)) return false;
	return foldClassChangeIsOwn(record.oldValue, target.className);
}

function applyCollapsedVisitNotes(preview: HTMLElement): void {
	const slot = foldSlots.get(preview);
	slot?.observer.disconnect();
	try {
		applyCollapsedVisitNotesNow(preview);
	} finally {
		if (!slot) return;
		slot.observer.takeRecords();
		try {
			slot.observer.observe(preview, FOLD_OBSERVE);
		} catch {
			/* The layout test document is not a browser node. */
		}
	}
}

function setClass(node: HTMLElement, name: string, on: boolean): void {
	if (node.classList.contains(name) === on) return;
	if (on) node.classList.add(name);
	else node.classList.remove(name);
}

function applyCollapsedVisitNotesNow(preview: HTMLElement): void {
	const tagged = new Set<HTMLElement>();
	for (const host of visitHeadingHosts(preview)) {
		if (!visitHeadingCollapsed(host)) continue;
		const level = headingLevelOf(host) ?? 5;
		let cursor = host.nextElementSibling;
		while (cursor instanceof HTMLElement) {
			if (endsVisitSection(cursor, level)) break;
			if (!containsActiveNotes(cursor)) {
				setClass(cursor, FOLD_CLASS, true);
				tagged.add(cursor);
			}
			cursor = cursor.nextElementSibling;
		}
	}
	preview.querySelectorAll(`.${FOLD_CLASS}`).forEach((node) => {
		if (node instanceof HTMLElement && !tagged.has(node)) setClass(node, FOLD_CLASS, false);
	});
	concealStrayOlderFields(preview);
}

function concealStrayOlderFields(preview: HTMLElement): void {
	const groupCollapsed = preview.querySelector('.rv-older-visits') != null && preview.dataset.rvOlderOpen !== '1';
	if (!groupCollapsed) return;
	preview.querySelectorAll('textarea').forEach((area) => {
		if (!(area instanceof HTMLElement)) return;
		if (area.closest('.rv-older-hidden, .rv-visit-folded')) return;
		const block = sectionBlock(area, preview);
		if (!block || block === preview || containsActiveNotes(block)) return;
		if (block.classList.contains('rv-older-hidden') || block.classList.contains(FOLD_CLASS)) return;
		if (!belongsToHiddenOlderVisit(block)) return;
		setClass(block, 'rv-older-visit', true);
		setClass(block, 'rv-older-hidden', true);
	});
}

function containsActiveNotes(node: HTMLElement): boolean {
	const active = node.ownerDocument?.activeElement;
	return active instanceof HTMLElement && node.contains(active);
}

function sectionBlock(node: HTMLElement, preview: HTMLElement): HTMLElement | null {
	let current: HTMLElement | null = node;
	while (current && current !== preview) {
		const parent: HTMLElement | null = current.parentElement;
		if (!parent || parent === preview || parent.classList.contains('markdown-preview-section') || parent.classList.contains('markdown-preview-sizer') || parent.classList.contains('cm-content')) {
			return current;
		}
		current = parent;
	}
	return null;
}

function belongsToHiddenOlderVisit(block: HTMLElement): boolean {
	let cursor = block.previousElementSibling;
	while (cursor instanceof HTMLElement) {
		if (isOlderWalkStop(cursor)) return false;
		if (cursor.classList.contains('rv-older-hidden')) return true;
		cursor = cursor.previousElementSibling;
	}
	return false;
}

function isOlderWalkStop(node: HTMLElement): boolean {
	if (node.classList.contains('rv-older-visits') || node.classList.contains('rv-older-visits-wrap') || node.classList.contains('rv-older-rule') || node.classList.contains('rv-notes-fold-stop')) return true;
	if (node.classList.contains('rv-locator-return-suggestions')) return true;
	if (node.tagName === 'HR' && !node.classList.contains('rv-older-hidden')) return true;
	if (node.querySelector('.callout-title')?.textContent?.includes('Return Suggestions')) return true;
	if (isVisitHeading(node) && !node.classList.contains('rv-older-hidden')) return true;
	const inner = node.querySelector('h3, h5');
	return inner instanceof HTMLElement && isVisitHeading(inner) && !node.classList.contains('rv-older-hidden') && !inner.classList.contains('rv-older-hidden');
}

function visitHeadingHosts(preview: HTMLElement): HTMLElement[] {
	const hosts: HTMLElement[] = [];
	preview.querySelectorAll('h3, h5, .cm-line').forEach((node) => {
		if (!(node instanceof HTMLElement) || !isVisitHeading(node)) return;
		const host = visitSectionHost(node);
		if (!hosts.includes(host)) hosts.push(host);
	});
	return hosts.filter((host) => !hosts.some((other) => other !== host && other.contains(host)));
}

function visitSectionHost(heading: HTMLElement): HTMLElement {
	const parent = heading.parentElement;
	if (!parent) return heading;
	for (let level = 1; level <= 6; level += 1) {
		if (parent.classList.contains(`el-h${level}`)) return parent;
	}
	return heading;
}

function isVisitHeading(node: HTMLElement): boolean {
	if (node.classList.contains('rv-older-visits') || node.classList.contains('rv-visit-notes-heading') || node.classList.contains('rv-fold-stop-heading')) return false;
	const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (/^(?:visit|recent) notes:?$/i.test(text)) return false;
	if (node.classList.contains('rv-visit-stamp') || node.querySelector('.rv-stamp-ago')) return true;
	if (headingLevelOf(node) == null) return false;
	if (!node.classList.contains('cm-line') && !/^H[1-6]$/.test(node.tagName)) return false;
	const plain = text.replace(/^#{1,6}\s+/, '');
	return stampDateTime(stripStampAge(plain)) != null;
}

function visitHeadingCollapsed(host: HTMLElement): boolean {
	if (host.classList.contains('is-collapsed')) return true;
	const heading = host.matches('h3, h5') ? host : host.querySelector('h3, h5');
	if (heading instanceof HTMLElement && heading.classList.contains('is-collapsed')) return true;
	if (host.querySelector('.heading-collapse-indicator.is-collapsed, .collapse-indicator.is-collapsed')) return true;
	return host.querySelector('.cm-foldPlaceholder') != null;
}

function headingLevelOf(node: HTMLElement): number | null {
	if (/^H[1-6]$/.test(node.tagName)) return Number(node.tagName.slice(1));
	for (let level = 1; level <= 6; level += 1) {
		if (node.classList.contains(`el-h${level}`) || node.classList.contains(`HyperMD-header-${level}`)) return level;
	}
	return null;
}

function endsVisitSection(node: HTMLElement, level: number): boolean {
	if (node.classList.contains('rv-older-rule') || node.classList.contains('rv-older-visits') || node.classList.contains('rv-older-visits-wrap') || node.classList.contains('rv-notes-fold-stop')) return true;
	if (isStop(node)) return true;
	const direct = headingLevelOf(node);
	if (direct != null && direct <= level) return true;
	const inner = node.querySelector('h1, h2, h3, h4, h5, h6');
	if (!(inner instanceof HTMLElement)) return false;
	const innerLevel = headingLevelOf(inner);
	return innerLevel != null && innerLevel <= level && node.classList.contains(`el-h${innerLevel}`);
}

function stampLabel(node: HTMLElement): string {
	return stripStampAge((node.textContent ?? '').replace(/\s+/g, ' ').trim()).replace(/^#{1,6}\s+/, '').trim();
}

function stampHeads(preview: HTMLElement): HTMLElement[] {
	const found: HTMLElement[] = [];
	preview.querySelectorAll('h3, h5, .cm-line.HyperMD-header-3, .cm-line.HyperMD-header-5').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (node.classList.contains('rv-older-visits') || node.classList.contains('rv-visit-notes-heading')) return;
		if (node.classList.contains('cm-line')) {
			if (isVisitHeading(node)) found.push(node);
			return;
		}
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
			if (cursor.classList.contains('rv-older-rule') || cursor.classList.contains('rv-older-visits') || cursor.classList.contains('rv-older-visits-wrap') || cursor.classList.contains('rv-older-visits-line')) {
				cursor = cursor.nextElementSibling instanceof HTMLElement ? cursor.nextElementSibling : null;
				continue;
			}
			if (cursor !== start && isStop(cursor)) break;
			nodes.push(cursor);
			const next = cursor.nextElementSibling;
			cursor = next instanceof HTMLElement ? next : null;
		}
		if (nodes.length === 0) continue;
		const text = stampLabel(stamp);
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
	if (node.classList.contains('rv-older-rule') || node.classList.contains('rv-older-visits') || node.classList.contains('rv-older-visits-wrap')) return false;
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

function visitNotesTyping(preview: HTMLElement): boolean {
	const doc = preview.ownerDocument as { activeElement?: Element | null } | null;
	const active = doc?.activeElement;
	if (!(active instanceof HTMLElement)) return false;
	if (active.tagName !== 'TEXTAREA') return false;
	return preview.contains(active);
}

/** Recent Notes collapse stops at the Older Visits heading. Anything from there on stays shown. */
function releaseRecentNotesTail(preview: HTMLElement): void {
	const heading = recentNotesHeading(preview);
	if (!heading) return;
	const host = collapseHost(heading);
	let cursor = host.nextElementSibling;
	let tail = false;
	while (cursor instanceof HTMLElement) {
		if (!tail && isOlderTail(cursor)) tail = true;
		if (tail) clearInlineHidden(cursor);
		cursor = cursor.nextElementSibling;
	}
}

function recentNotesHeading(preview: HTMLElement): HTMLElement | null {
	let found: HTMLElement | null = null;
	preview.querySelectorAll('h3').forEach((node) => {
		if (found || !(node instanceof HTMLElement) || node.classList.contains('rv-older-visits')) return;
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (/^(?:visit|recent) notes:?$/i.test(text) || node.classList.contains('rv-visit-notes-heading')) found = node;
	});
	return found;
}

function isOlderTail(node: HTMLElement): boolean {
	if (node.classList.contains('rv-notes-fold-stop') || node.classList.contains('rv-older-visits-wrap') || node.classList.contains('rv-older-rule') || node.classList.contains('rv-older-visits') || node.classList.contains('rv-older-visit')) return true;
	if (node.classList.contains('rv-locator-return-suggestions')) return true;
	if (node.querySelector('.rv-older-visits, .rv-older-rule, .rv-locator-return-suggestions')) return true;
	const title = node.querySelector('.callout-title');
	return (title?.textContent ?? '').includes('Return Suggestions');
}

const recentTails = new WeakMap<HTMLElement, HTMLElement[]>();

/**
 * Recent Notes collapse detaches every following sibling until the footer.
 * The saved tail is Older Visits through Return Suggestions, taken while
 * those nodes are still in the note. An empty walk must not replace it.
 */
function rememberRecentTail(preview: HTMLElement): void {
	const heading = recentNotesHeading(preview);
	if (!heading) return;
	const host = collapseHost(heading);
	const parent = host.parentElement;
	if (!parent) return;
	const footer = sectionFooter(parent);
	const nodes: HTMLElement[] = [];
	let started = false;
	let cursor = host.nextElementSibling;
	while (cursor instanceof HTMLElement && cursor !== footer) {
		if (!started && isOlderTail(cursor)) started = true;
		if (started) nodes.push(cursor);
		cursor = cursor.nextElementSibling;
	}
	if (nodes.length === 0 || nodes.some((node) => node.parentElement == null)) return;
	recentTails.set(preview, nodes);
}

/** Put a detached Older Visits / Return Suggestions tail back in front of the footer. */
function restoreRecentTail(preview: HTMLElement): void {
	const heading = recentNotesHeading(preview);
	if (!heading) return;
	const host = collapseHost(heading);
	if (!host.classList.contains('is-collapsed')) return;
	const saved = recentTails.get(preview);
	if (!saved || saved.length === 0) return;
	const tailGone = saved.some((node) => node.parentElement == null && isTailAnchor(node));
	if (!tailGone) return;
	const parent = host.parentElement;
	if (!parent) return;
	const footer = sectionFooter(parent);
	const anchor = footer && footer.parentElement === parent ? footer : null;
	const missing = saved.filter((node) => node.parentElement == null);
	if (missing.length === 0) return;
	for (const node of missing) parent.insertBefore(node, anchor);
}

function isTailAnchor(node: HTMLElement): boolean {
	if (node.classList.contains('rv-older-visits-wrap') || node.classList.contains('rv-notes-fold-stop')) return true;
	if (node.classList.contains('rv-locator-return-suggestions')) return true;
	const title = node.querySelector('.callout-title');
	return (title?.textContent ?? '').includes('Return Suggestions');
}

function sectionFooter(parent: HTMLElement): HTMLElement | null {
	for (const kid of Array.from(parent.children)) {
		if (!(kid instanceof HTMLElement)) continue;
		if (kid.classList.contains('mod-footer') || kid.classList.contains('embedded-backlinks')) return kid;
	}
	return null;
}

function clearInlineHidden(node: HTMLElement): void {
	if (node.classList.contains(FOLD_CLASS) || node.classList.contains('rv-older-hidden')) return;
	const style = (node as HTMLElement & { style?: { display?: string; removeProperty?: (name: string) => void } }).style;
	if (!style || style.display !== 'none') return;
	if (typeof style.removeProperty === 'function') style.removeProperty('display');
	else style.display = '';
}

function ensureSuggestionStop(preview: HTMLElement): void {
	if (preview.querySelector('.rv-older-visits-wrap')) return;
	const callout = suggestionCallout(preview);
	if (!callout) return;
	const boundary = climbToSection(callout, preview);
	const parent = boundary.parentElement;
	if (!parent) return;
	let anchor = boundary;
	const previous = boundary.previousElementSibling;
	if (previous instanceof HTMLElement && !previous.classList.contains('rv-older-rule') && !previous.classList.contains('rv-notes-fold-stop') && (previous.tagName === 'HR' || Boolean(previous.querySelector('hr')))) {
		anchor = previous;
	}
	const existing = Array.from(parent.children).find((node) => node instanceof HTMLElement && node.classList.contains('rv-notes-fold-stop'));
	if (existing instanceof HTMLElement) {
		ensureFoldStopHeading(existing);
		if (existing.nextElementSibling !== anchor) parent.insertBefore(existing, anchor);
		return;
	}
	const stop = parent.ownerDocument.createElement('div');
	stop.className = 'el-h3 rv-notes-fold-stop';
	stop.setAttribute('aria-hidden', 'true');
	ensureFoldStopHeading(stop);
	parent.insertBefore(stop, anchor);
}

function ensureFoldStopHeading(stop: HTMLElement): void {
	const first = stop.children[0];
	if (first instanceof HTMLElement && /^H[1-6]$/.test(first.tagName)) return;
	const heading = stop.ownerDocument.createElement('h3');
	heading.className = 'rv-fold-stop-heading';
	heading.setAttribute('aria-hidden', 'true');
	stop.insertBefore(heading, first instanceof HTMLElement ? first : null);
}

function suggestionCallout(preview: HTMLElement): HTMLElement | null {
	const nodes = preview.querySelectorAll('.callout, .rv-locator-return-suggestions');
	for (const node of Array.from(nodes)) {
		if (!(node instanceof HTMLElement)) continue;
		if (node.classList.contains('rv-locator-return-suggestions')) return node;
		const title = node.querySelector('.callout-title');
		if ((title?.textContent ?? '').includes('Return Suggestions')) return node;
	}
	return null;
}

function climbToSection(node: HTMLElement, preview: HTMLElement): HTMLElement {
	let current = node;
	while (current.parentElement && current.parentElement !== preview && preview.contains(current.parentElement)) {
		const parent = current.parentElement;
		if (parent.classList.contains('markdown-preview-section') || parent.classList.contains('markdown-preview-sizer')) break;
		current = parent;
	}
	return current;
}

function clearOlderChrome(preview: HTMLElement): void {
	preview.querySelectorAll('.rv-older-rule, .rv-older-visits, .rv-older-visits-wrap, .rv-notes-fold-stop').forEach((node) => node.remove());
	preview.querySelectorAll('.rv-older-visit').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		node.classList.remove('rv-older-visit', 'rv-older-hidden');
	});
}
