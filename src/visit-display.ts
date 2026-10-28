import { stripStampAge } from './dates';
import { stampDateTime } from './schedule';
import { markPreviewOlderVisits } from './visit-older';

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
	// Live Preview is a CodeMirror document. Older Visits there is an editor
	// decoration. This pass never inserts into CodeMirror.
	if (isCodeMirrorSurface(preview)) return;
	decorateRecentChevron(preview);
	const path = preview.dataset.rvNoteFile || '';
	markPreviewOlderVisits(preview, {
		limit: options.limit,
		collapseOlder: options.collapseOlder,
	}, path);
	if (!preview.querySelector('.rv-older-visits')) ensureSuggestionStop(preview);
	concealCollapsedVisitNotes(preview);
	void markdown;
}

function isCodeMirrorSurface(preview: HTMLElement): boolean {
	if (preview.classList.contains('markdown-source-view') || preview.classList.contains('cm-content') || preview.classList.contains('cm-editor')) return true;
	return preview.querySelector('.cm-content, .cm-editor') != null;
}

const CHEVRON_PATH = 'm9 18 6-6-6-6';

/** Same lucide chevron-right as Older Visits. Replaces Obsidian's own chevron. Open rotates it down. */
export function mountHeadingChevron(mark: HTMLElement): void {
	if (chevronReady(mark)) return;
	mark.querySelectorAll('svg').forEach((node) => node.remove());
	appendHeadingChevron(mark);
}

function chevronReady(mark: HTMLElement): boolean {
	const svgs = Array.from(mark.children).filter((kid) => kid.tagName.toLowerCase() === 'svg');
	if (svgs.length !== 1) return false;
	const path = svgs[0]?.querySelector('path');
	return path != null && path.getAttribute('d') === CHEVRON_PATH;
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

function visitPreview(root: HTMLElement): HTMLElement | null {
	const found = root.closest('.markdown-preview-view, .markdown-reading-view, .markdown-rendered, .markdown-source-view');
	if (found instanceof HTMLElement) return found;
	if (root.querySelector('h3, h5, .cm-line')) return root;
	return root.parentElement;
}

const FOLD_CLASS = 'rv-visit-folded';

/**
 * Hide the blocks under a collapsed visit heading. Render only.
 * Older Visits hiding is a root class, not a walk that pairs boxes by position.
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
}

function containsActiveNotes(node: HTMLElement): boolean {
	const active = node.ownerDocument?.activeElement;
	return active instanceof HTMLElement && node.contains(active);
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

function isVisitTextArea(node: EventTarget | null | undefined): node is HTMLTextAreaElement {
	return node instanceof HTMLElement && node.tagName === 'TEXTAREA';
}

/**
 * Obsidian puts focus on the note title after a new file opens. That is not
 * the user leaving the visit note.
 */
/** The inline title is contenteditable. A keystroke there renames the note. */
export function blurNoteTitle(doc: Document): void {
	const active = doc.activeElement;
	if (!(active instanceof HTMLElement)) return;
	const title = active.classList.contains('inline-title')
		|| active.classList.contains('view-header-title')
		|| (typeof active.closest === 'function' && active.closest('.inline-title, .view-header-title') != null);
	if (!title) return;
	active.blur();
}

export function isFocusThief(node: EventTarget | null | undefined): boolean {
	if (!(node instanceof Element)) return true;
	const tag = node.tagName;
	if (tag === 'BODY' || tag === 'HTML') return true;
	if (node.classList.contains('view-header-title') || node.classList.contains('inline-title') || node.classList.contains('view-header')) return true;
	return typeof node.closest === 'function' && node.closest('.view-header, .view-header-title, .inline-title') != null;
}

/** The first textarea rendered after the `ordinal`th heading showing `stamp`. */
export function notesBoxAfterStamp(root: HTMLElement, stamp: string, ordinal: number): HTMLTextAreaElement | null {
	const headings = Array.from(root.querySelectorAll('h3, h5, .cm-line.HyperMD-header'))
		.filter((node) => (node.textContent ?? '').replace(/\s+/g, ' ').includes(stamp));
	const heading = headings[ordinal] ?? headings[headings.length - 1];
	if (!heading) return null;
	const areas = Array.from(root.querySelectorAll('textarea'));
	for (const area of areas) {
		if (heading.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING) {
			return area;
		}
	}
	return null;
}

/**
 * New RV from the ribbon focuses the note title and renders the Meta Bind
 * textarea later. Keep pulling the caret into the first visit note until it
 * exists, and again whenever the title takes it back.
 */
export function watchVisitNoteFocus(root: HTMLElement, ms = 12000): void {
	const stopAt = Date.now() + ms;
	const doc = root.ownerDocument;
	const pull = (): void => {
		if (!root.isConnected || Date.now() > stopAt) return;
		const preview = root.querySelector('.markdown-preview-view, .markdown-reading-view');
		let area = root.querySelector('textarea');
		if (!isVisitTextArea(area) && preview instanceof HTMLElement) {
			const heading = Array.from(preview.querySelectorAll('h3, h4, h5')).find((node) => /(?:visit|recent) notes/i.test(node.textContent ?? ''));
			if (heading instanceof HTMLElement && typeof heading.scrollIntoView === 'function') {
				heading.scrollIntoView({ block: 'center' });
			}
			area = root.querySelector('textarea');
		}
		if (!isVisitTextArea(area)) return;
		const active = doc.activeElement;
		if (active !== area && isFocusThief(active)) {
			try {
				area.focus({ preventScroll: true });
			} catch {
				area.focus();
			}
		}
	};
	const onFocus = (): void => {
		if (Date.now() > stopAt || !root.isConnected) {
			doc.removeEventListener('focusin', onFocus, true);
			return;
		}
		pull();
	};
	doc.addEventListener('focusin', onFocus, true);
	const tick = (): void => {
		if (!root.isConnected || Date.now() > stopAt) return;
		pull();
		window.setTimeout(tick, 250);
	};
	tick();
}

/**
 * Focus the first visit textarea after Templater finishes, including the
 * Householder name prompt. Nothing is on a clock: the prompt blocks focus,
 * and a textarea that appears on the file's first render is focused whenever
 * the title (or the body) takes the caret. The watcher stays until the caller
 * stops it, so a later preview remount can still find the new textarea.
 */
export function armVisitNoteFocus(
	root: HTMLElement,
	notesKey = '',
	currentRoot?: () => HTMLElement | null,
): () => void {
	let stop = false;
	const doc = root.ownerDocument;
	const until = Date.now() + 8000;
	const observer = new MutationObserver(() => { focusArea(); });
	let observed: HTMLElement | null = null;
	const hostNow = (): HTMLElement | null => {
		if (currentRoot) {
			try {
				const next = currentRoot();
				if (next instanceof HTMLElement && next.isConnected) return next;
			} catch {
				/* The leaf went away. */
			}
		}
		return root.isConnected ? root : null;
	};
	const watchHost = (host: HTMLElement): void => {
		if (observed === host) return;
		observer.disconnect();
		observed = host;
		observer.observe(host, { childList: true, subtree: true });
	};
	const promptOpen = (): boolean => doc.querySelector('input.templater-prompt-input, textarea.templater-prompt-input, .modal-container') != null;
	const shown = (area: HTMLElement): boolean => {
		if (!area.isConnected || area.hidden) return false;
		try {
			const style = area.ownerDocument.defaultView?.getComputedStyle(area);
			if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
		} catch {
			/* Treat an unreadable box as visible. */
		}
		return true;
	};
	const lastShown = (nodes: NodeListOf<Element>): HTMLTextAreaElement | null => {
		let found: HTMLTextAreaElement | null = null;
		for (const node of Array.from(nodes)) {
			if (!isVisitTextArea(node) || !shown(node)) continue;
			found = node;
		}
		return found;
	};
	const visitArea = (host: HTMLElement): HTMLTextAreaElement | null => {
		if (notesKey) {
			const key = notesKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
			const named = lastShown(host.querySelectorAll(`textarea.rv-native-notes-area[data-rv-notes-key="${key}"]`));
			if (named) return named;
		}
		return lastShown(host.querySelectorAll('textarea.rv-native-notes-area'))
			?? lastShown(host.querySelectorAll('textarea'));
	};
	const editingElsewhere = (node: Element | null): boolean => {
		if (!(node instanceof HTMLElement)) return false;
		// The note title is contenteditable, and it is where Obsidian leaves the caret.
		if (isFocusThief(node)) return false;
		if (node.classList.contains('templater-prompt-input')) return true;
		const tag = node.tagName;
		const field = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
		if (!field) return false;
		return !isVisitTextArea(node);
	};
	const focusArea = (): boolean => {
		if (stop || promptOpen()) return false;
		const host = hostNow();
		if (!host) return false;
		watchHost(host);
		const area = visitArea(host);
		if (!area) return false;
		const active = doc.activeElement;
		if (active === area) return true;
		// Leave the Templater prompt and any other field alone so Enter still submits.
		if (editingElsewhere(active instanceof Element ? active : null)) return false;
		revealForFocus(area);
		placeCaret(area);
		return doc.activeElement === area;
	};
	const initial = hostNow();
	if (initial) watchHost(initial);
	const docObserver = new MutationObserver(() => { focusArea(); });
	const watch = doc.documentElement ?? doc.body;
	if (watch) docObserver.observe(watch, { childList: true, subtree: true });
	const onFocus = (event: Event): void => {
		if (!promptOpen()) blurNoteTitle(doc);
		if (event.target instanceof HTMLElement && isFocusThief(event.target) && !promptOpen()) {
			event.target.blur();
		}
		focusArea();
	};
	doc.addEventListener('focusin', onFocus, true);
	if (!promptOpen()) blurNoteTitle(doc);
	focusArea();
	const tick = (): void => {
		if (stop || Date.now() > until) return;
		focusArea();
		const view = doc.defaultView;
		if (view && typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(tick);
	};
	tick();
	return () => {
		stop = true;
		observer.disconnect();
		docObserver.disconnect();
		doc.removeEventListener('focusin', onFocus, true);
	};
}

/** Focus the stamp's notes box, or the first visit textarea when the stamp has not painted yet. */
export function placeVisitNoteFocus(root: HTMLElement, stamp: string, ordinal: number): HTMLTextAreaElement | null {
	const matched = stamp ? notesBoxAfterStamp(root, stamp, ordinal) : null;
	const found = root.querySelector('textarea');
	const area = matched ?? (isVisitTextArea(found) ? found : null);
	blurNoteTitle(root.ownerDocument);
	if (!area) return null;
	revealForFocus(area);
	placeCaret(area);
	return area;
}

/** Drop folds that would keep the notes box from taking the caret. */
function revealForFocus(area: HTMLElement): void {
	let node: HTMLElement | null = area;
	while (node) {
		if (node.classList.contains('is-collapsed')) node.classList.remove('is-collapsed');
		node = node.parentElement;
	}
}

/** Focus the notes box and leave the caret in it. */
function placeCaret(area: HTMLTextAreaElement): void {
	area.tabIndex = 0;
	const end = area.value.length;
	try {
		area.focus();
	} catch {
		try {
			area.focus({ preventScroll: true });
		} catch {
			/* The box cannot take focus yet. */
		}
	}
	try {
		area.setSelectionRange(end, end);
	} catch {
		/* The box is not editable yet. */
	}
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
