import { Prec, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { isReturnSuggestionsLine } from './attempt-digest';
import { coveredCampaignFor, stampDateTime } from './schedule';
import { paintLiveVisitHeading, publisherForVisit } from './visit-controls';
import { mountHeadingChevron, visitStampLine } from './visit-display';
import { attachVisitNoteArea, restoreVisitNoteCaret } from './visit-notes-field';
import { visitNoteValue } from './visit-notes-store';
import { olderVisitsOpen, setOlderVisitsOpenState } from './visit-older';

export interface VisitPreviewSettings {
	collapseOlder: boolean;
	limit: number;
}

export interface LivePreviewPlan {
	widgetAt: number | null;
	hiddenLines: number[];
}

interface DocLine {
	text: string;
	from: number;
}

const OLDER_HEADING = /^#{1,3}\s+Older Visits\s*:?\s*$/i;

/**
 * Older visits in file order, same slice as the reading-view layout.
 * The widget sits in front of the first hidden stamp, unless the note
 * already has an Older Visits heading. That heading is the widget's line.
 * The fold stops at a callout or the next heading, so Return Suggestions
 * and the paragraph after it stay outside. Nothing here is written into
 * the note.
 */
export function planLivePreviewVisits(markdown: string, options: VisitPreviewSettings): LivePreviewPlan {
	const empty: LivePreviewPlan = { widgetAt: null, hiddenLines: [] };
	if (!options.collapseOlder) return empty;
	const lines = docLines(markdown);
	const stamps: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line && visitStampLine(line.text)) stamps.push(index);
	}
	const cap = Math.max(0, Math.floor(options.limit));
	if (stamps.length <= cap) return empty;
	const older = stamps.slice(cap);
	const hidden: number[] = [];
	for (let index = 0; index < older.length; index += 1) {
		const lineIndex = older[index];
		if (lineIndex == null) continue;
		const limit = sectionEnd(lines, lineIndex, older[index + 1] ?? null);
		for (let cursor = lineIndex; cursor < lines.length; cursor += 1) {
			const line = lines[cursor];
			if (!line || line.from >= limit) break;
			hidden.push(line.from);
		}
	}
	const first = lines[older[0] ?? -1];
	return { widgetAt: first ? first.from : null, hiddenLines: hidden };
}

function docLines(markdown: string): DocLine[] {
	const lines: DocLine[] = [];
	let offset = 0;
	const parts = markdown.split('\n');
	for (let index = 0; index < parts.length; index += 1) {
		const raw = parts[index] ?? '';
		lines.push({ text: raw.replace(/\r$/, ''), from: offset });
		offset += raw.length;
		if (index < parts.length - 1) offset += 1;
	}
	return lines;
}

function sectionEnd(lines: readonly DocLine[], start: number, nextStamp: number | null): number {
	const hard = nextStamp ?? lines.length;
	for (let index = start + 1; index < hard; index += 1) {
		const line = lines[index];
		if (line && stopsVisitSection(line.text)) return line.from;
	}
	if (nextStamp != null) return lines[nextStamp]?.from ?? Number.POSITIVE_INFINITY;
	return Number.POSITIVE_INFINITY;
}

function stopsVisitSection(line: string): boolean {
	const trimmed = line.trim();
	if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) return true;
	if (isReturnSuggestionsLine(trimmed)) return true;
	// Any callout ends the older fold, the same way a later heading does.
	if (/^(?:>[\t ]*)+\[![A-Za-z0-9-]+\]/.test(trimmed)) return true;
	return /^#{1,6}\s+/.test(trimmed) && visitStampLine(trimmed) == null;
}

export function isOlderVisitsHeading(line: string): boolean {
	return OLDER_HEADING.test(line.trim());
}

function stopsVisitCard(line: string): boolean {
	if (visitStampLine(line)) return true;
	if (stopsVisitSection(line)) return true;
	return /^>\s*\S/.test(line.trim());
}

const HIDDEN_BUTTON_IDS = new Set(['rv-log-home', 'rv-log-miss', 'rv-log-past', 'rv-log-housemate', 'rv-archive']);
const INPUT_LINE = /INPUT\[textArea:(sVisit\d+Notes)\]/;

/**
 * Lines of a hoisted `meta-bind-button` fence. Live Preview shows that
 * fence as raw code when the cursor sits on it. The fence is hidden even
 * then; the visible buttons come from the `BUTTON[...]` line.
 */
export function hiddenButtonFenceLines(markdown: string): number[] {
	const lines = docLines(markdown);
	const starts: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line || !/^```meta-bind-button[\t ]*$/.test(line.text.trim())) continue;
		let end = index + 1;
		const inner: string[] = [];
		while (end < lines.length && !/^```[\t ]*$/.test((lines[end]?.text ?? '').trim())) {
			inner.push(lines[end]?.text ?? '');
			end += 1;
		}
		const id = inner.map((item) => /^id:\s*(\S+)\s*$/.exec(item.trim())?.[1]).find((value) => value != null) ?? '';
		const hidden = inner.some((item) => /^hidden:\s*true\s*$/.test(item.trim()));
		if (hidden || HIDDEN_BUTTON_IDS.has(id)) {
			const last = Math.min(end, lines.length - 1);
			for (let cursor = index; cursor <= last; cursor += 1) {
				const at = lines[cursor];
				if (at) starts.push(at.from);
			}
		}
		index = end;
	}
	return starts;
}

/** Stamp plus the note lines under it. The next heading or callout is not included. */
export function planVisitCardRanges(markdown: string): { from: number; to: number }[] {
	const lines = docLines(markdown);
	const ranges: { from: number; to: number }[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (!line || !visitStampLine(line.text)) {
			index += 1;
			continue;
		}
		let endIndex = index;
		let cursor = index + 1;
		while (cursor < lines.length) {
			const next = lines[cursor];
			if (!next || stopsVisitCard(next.text)) break;
			endIndex = cursor;
			cursor += 1;
		}
		const to = endIndex + 1 < lines.length ? (lines[endIndex + 1]?.from ?? markdown.length) : markdown.length;
		if (to > line.from) ranges.push({ from: line.from, to });
		index = Math.max(cursor, index + 1);
	}
	return ranges;
}

const INPUT_KEY = INPUT_LINE;

/** Documents currently in an IME composition. Decorations are mapped, not rebuilt. */
const composingDocs = new WeakSet<Text>();

interface ParkedNote {
	el: HTMLElement;
	unload: () => void;
}

const parkedNotes = new Map<string, ParkedNote>();
const noteUnloads = new WeakMap<HTMLElement, () => void>();

function noteId(path: string, key: string): string {
	return `${path}\0${key}`;
}

/**
 * Replaces one `INPUT[textArea:sVisitNNotes]` line.
 * `eq` is the path and the key. A rebuild parks the DOM and hands it back.
 * `ignoreEvent` stays at the default, so CodeMirror ignores clicks, keys, paste, and undo.
 */
class VisitNoteWidget extends WidgetType {
	constructor(
		readonly path: string,
		readonly key: string,
		readonly locked = false,
		readonly underStrip = false,
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof VisitNoteWidget
			&& other.path === this.path
			&& other.key === this.key
			&& other.locked === this.locked
			&& other.underStrip === this.underStrip;
	}

	toDOM(view: EditorView): HTMLElement {
		const id = noteId(this.path, this.key);
		const saved = !this.locked ? parkedNotes.get(id) : undefined;
		if (saved) {
			parkedNotes.delete(id);
			saved.el.classList.toggle('rv-note-under-strip', this.underStrip);
			saved.el.classList.remove('rv-older-hidden', 'rv-mb-locked');
			const area = saved.el.querySelector('textarea');
			if (area instanceof HTMLTextAreaElement) {
				unlockNoteArea(area);
				restoreVisitNoteCaret(area, this.path, this.key);
			}
			return saved.el;
		}
		const doc = view.dom.ownerDocument;
		const host = doc.createElement('div');
		host.className = 'rv-lp-notes rv-visit-notes-host mb-none';
		if (this.underStrip) host.classList.add('rv-note-under-strip');
		const area = doc.createElement('textarea');
		area.rows = 1;
		area.classList.add('rv-native-notes-area');
		area.dataset.rvNotesKey = this.key;
		area.value = visitNoteValue(this.path, this.key);
		host.appendChild(area);
		if (this.locked) {
			host.classList.add('rv-older-hidden', 'rv-mb-locked');
			lockNoteArea(area);
			noteUnloads.set(host, () => {});
			return host;
		}
		const unload = attachVisitNoteArea(area, this.path, this.key);
		noteUnloads.set(host, unload);
		restoreVisitNoteCaret(area, this.path, this.key);
		return host;
	}

	destroy(dom: HTMLElement): void {
		if (dom.classList.contains('rv-mb-locked')) {
			noteUnloads.delete(dom);
			return;
		}
		const id = noteId(this.path, this.key);
		const unload = noteUnloads.get(dom) ?? (() => {});
		parkedNotes.set(id, { el: dom, unload });
		queueMicrotask(() => {
			const saved = parkedNotes.get(id);
			if (saved?.el !== dom) return;
			parkedNotes.delete(id);
			saved.unload();
			noteUnloads.delete(dom);
		});
	}
}

function lockNoteArea(area: HTMLTextAreaElement): void {
	area.disabled = true;
	area.readOnly = true;
	area.tabIndex = -1;
	area.setAttribute('aria-hidden', 'true');
	area.setAttribute('inert', '');
}

function unlockNoteArea(area: HTMLTextAreaElement): void {
	area.disabled = false;
	area.readOnly = false;
	area.removeAttribute('aria-hidden');
	area.removeAttribute('inert');
}

/**
 * Blank document line directly under a visit note or the Recent Notes heading.
 * The class is a line decoration. Writing it onto `.cm-line` makes CodeMirror
 * drop it and schedule another update.
 */
export function isVisitGapLine(lines: readonly DocLine[], index: number): boolean {
	const line = lines[index];
	if (!line || line.text.replace(/\u200b/g, '').trim() !== '') return false;
	const previous = lines[index - 1];
	if (!previous) return false;
	const text = previous.text.trim();
	if (NOTES_HEADING.test(text)) return true;
	return INPUT_LINE.test(text);
}

/**
 * Disable a Meta Bind field that mounted beside a hidden Older Visits line.
 * A callout, Older Visits, or the next section ends the fold. Line classes
 * come from decorations. This does not touch `.cm-line`.
 */
function isOlderFoldBoundary(node: Element): boolean {
	if (node.classList.contains('cm-line')) return true;
	const embedCallout = node.classList.contains('cm-embed-block') && node.querySelector('.callout, .callout-title') != null;
	if (node.classList.contains('callout') || node.classList.contains('cm-callout') || embedCallout) return true;
	if (node.classList.contains('rv-locator-return-suggestions') || node.classList.contains('rv-older-visits') || node.classList.contains('rv-older-visits-widget') || node.classList.contains('rv-older-rule') || node.classList.contains('rv-visit-notes-heading') || node.classList.contains('rv-notes-fold-stop')) return true;
	if (node.querySelector('.callout, .callout-title, .rv-locator-return-suggestions, .rv-older-visits, .rv-visit-notes-heading, .rv-notes-fold-stop')) return true;
	const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (/^return suggestions\b/i.test(text)) return true;
	return false;
}

export function lockHiddenMetaBindFields(root: ParentNode): void {
	root.querySelectorAll('.rv-older-hidden, .rv-mb-locked').forEach((node) => {
		if (node.classList.contains('cm-line') || !isOlderFoldBoundary(node)) return;
		node.classList.remove('rv-older-hidden', 'rv-mb-locked');
	});
	const lines = root.querySelectorAll('.cm-line.rv-older-hidden');
	for (const line of Array.from(lines)) {
		if (!(line instanceof HTMLElement)) continue;
		line.querySelectorAll('textarea:not(.rv-native-notes-area), .mb-input, input').forEach((node) => {
			lockForeignField(node);
		});
		let sib: Element | null = line.nextElementSibling;
		while (sib && !isOlderFoldBoundary(sib)) {
			const owned = sib.classList.contains('rv-lp-notes') || sib.querySelector('.rv-native-notes-area') != null;
			if (!owned) {
				if (!sib.classList.contains('rv-mb-locked')) sib.classList.add('rv-older-hidden', 'rv-mb-locked');
				lockForeignField(sib);
				sib.querySelectorAll('textarea, input, .mb-input').forEach((node) => lockForeignField(node));
			}
			sib = sib.nextElementSibling;
		}
	}
}

function lockForeignField(node: Element): void {
	if (!(node instanceof HTMLElement)) return;
	if (!node.classList.contains('rv-mb-locked')) node.classList.add('rv-mb-locked');
	if (node.getAttribute('aria-hidden') !== 'true') node.setAttribute('aria-hidden', 'true');
	if (!node.hasAttribute('inert')) node.setAttribute('inert', '');
	if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
		const field = node as HTMLTextAreaElement;
		if (!field.disabled) field.disabled = true;
		if (!field.readOnly) field.readOnly = true;
		if (field.tabIndex !== -1) field.tabIndex = -1;
	}
}

function installElHelpers(doc: Document): void {
	const proto = doc.defaultView?.HTMLElement.prototype as (HTMLElement & {
		createEl?: (tag: string, spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) => HTMLElement;
		createSpan?: (spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) => HTMLElement;
		addClass?: (cls: string) => void;
	}) | undefined;
	if (!proto || typeof proto.createEl === 'function') return;
	const host = proto as unknown as {
		createEl: (this: HTMLElement, tag: string, spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) => HTMLElement;
		createSpan: (this: HTMLElement, spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) => HTMLElement;
		addClass: (this: HTMLElement, cls: string) => void;
	};
	host.createEl = function createEl(this: HTMLElement, tag: string, spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
		const el = this.ownerDocument.createElement(tag);
		if (typeof spec === 'string') el.className = spec;
		else if (spec) {
			if (spec.cls) el.className = spec.cls;
			if (spec.text) el.textContent = spec.text;
			if (spec.attr) {
				for (const [key, value] of Object.entries(spec.attr)) el.setAttribute(key, value);
			}
		}
		this.appendChild(el);
		return el;
	};
	host.createSpan = function createSpan(this: HTMLElement, spec?: string | { cls?: string; text?: string; attr?: Record<string, string> }) {
		return host.createEl.call(this, 'span', typeof spec === 'string' ? { cls: spec } : spec);
	};
	host.addClass = function addClass(this: HTMLElement, cls: string) {
		this.classList.add(...cls.split(/\s+/).filter(Boolean));
	};
}

const NOTES_HEADING = /^###\s+((?:Recent|Visit) Notes:)\s*$/i;

/**
 * Obsidian's own heading fold draws a chevron and a "..." row on Recent Notes.
 * The styled heading already has its chevron. Those extras are not part of it.
 */
export function concealHeadingFoldMarks(root: ParentNode): void {
	const heads = root.querySelectorAll('.cm-line.rv-lp-notes-heading, .cm-line.rv-lp-older-heading');
	for (const line of Array.from(heads)) {
		line.querySelectorAll('.cm-fold-indicator, .cm-foldPlaceholder, .heading-collapse-indicator').forEach((node) => {
			if (!(node instanceof HTMLElement)) return;
			if (node.closest('h3.rv-visit-notes-heading, h3.rv-older-visits')) return;
			node.classList.add('rv-fold-chrome-hidden');
			node.style.setProperty('display', 'none', 'important');
		});
		for (const sib of [line.previousElementSibling, line.nextElementSibling]) {
			if (!(sib instanceof HTMLElement) || sib.classList.contains('rv-visit-notes-heading') || sib.classList.contains('rv-older-visits-widget')) continue;
			const text = (sib.textContent ?? '').replace(/\s+/g, ' ').trim();
			const placeholder = sib.classList.contains('cm-foldPlaceholder') || sib.querySelector('.cm-foldPlaceholder') != null;
			const stray = text === '...' || text === '…' || text === '>';
			if (!placeholder && !stray) continue;
			sib.classList.add('rv-fold-chrome-hidden');
			sib.style.setProperty('display', 'none', 'important');
		}
	}
}

const recentNotesOpenByPath = new Map<string, boolean>();

/** Recent Notes starts open. A collapsed heading hides only the notes under it. */
export function recentNotesOpen(path: string): boolean {
	return recentNotesOpenByPath.get(path) !== false;
}

export function setRecentNotesOpenState(path: string, open: boolean): void {
	if (!path) return;
	if (open) recentNotesOpenByPath.delete(path);
	else recentNotesOpenByPath.set(path, false);
}

/**
 * Lines under Recent Notes. The fold stops at the first Older Visits stamp,
 * Return Suggestions, or the next heading of level 1–3.
 */
export function recentFoldLineStarts(markdown: string, open: boolean, limit = 3): number[] {
	if (open) return [];
	const lines = docLines(markdown);
	const stamps: number[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (line && visitStampLine(line.text)) stamps.push(index);
	}
	const olderAt = stamps[Math.max(0, Math.floor(limit))];
	const stopFrom = olderAt == null ? null : lines[olderAt]?.from ?? null;
	const hidden: number[] = [];
	let folding = false;
	for (const line of lines) {
		const trimmed = line.text.trim();
		if (!folding) {
			if (NOTES_HEADING.test(trimmed)) folding = true;
			continue;
		}
		if (stopFrom != null && line.from >= stopFrom) break;
		if (isReturnSuggestionsLine(trimmed)) break;
		if (/^#{1,3}\s+/.test(trimmed)) break;
		hidden.push(line.from);
	}
	return hidden;
}

/**
 * Replaces one folded Recent Notes line.
 * A block widget built for the real note stays on screen after the source
 * line is `display: none`, because CodeMirror draws that widget beside the
 * line. This stand-in is empty and hidden, and it is thrown away when the
 * section opens so the real note mounts on a visible line.
 */
class RecentFoldWidget extends WidgetType {
	eq(other: WidgetType): boolean {
		return other instanceof RecentFoldWidget;
	}

	toDOM(view: EditorView): HTMLElement {
		const el = view.dom.ownerDocument.createElement('div');
		el.className = 'rv-recent-folded';
		el.setAttribute('aria-hidden', 'true');
		el.style.setProperty('display', 'none', 'important');
		return el;
	}
}

/**
 * Hide rendered blocks that sit beside a folded Recent Notes line.
 * Older Visits, Return Suggestions, and the next heading stay up.
 */
export function concealRecentFoldWidgets(root: ParentNode): void {
	root.querySelectorAll('[data-rv-recent-fold="1"]').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		node.classList.remove('rv-recent-folded', 'rv-recent-fold-extra');
		delete node.dataset.rvRecentFold;
		node.style.removeProperty('display');
	});
	const anchors = root.querySelectorAll('.cm-line.rv-recent-folded, .rv-recent-folded');
	for (const anchor of Array.from(anchors)) {
		markRecentFoldSiblings(anchor.previousElementSibling, -1);
		markRecentFoldSiblings(anchor.nextElementSibling, 1);
	}
}

function markRecentFoldSiblings(start: Element | null, direction: -1 | 1): void {
	let sib = start;
	while (sib) {
		if (recentFoldBoundary(sib)) return;
		if (sib instanceof HTMLElement && !sib.classList.contains('rv-recent-folded')) {
			sib.classList.add('rv-recent-folded', 'rv-recent-fold-extra');
			sib.dataset.rvRecentFold = '1';
			sib.style.setProperty('display', 'none', 'important');
		}
		sib = direction < 0 ? sib.previousElementSibling : sib.nextElementSibling;
	}
}

function recentFoldBoundary(node: Element): boolean {
	if (node.classList.contains('rv-recent-folded')) return false;
	if (node.classList.contains('cm-line')) return true;
	if (node.classList.contains('rv-older-visits') || node.classList.contains('rv-older-visits-widget') || node.classList.contains('rv-older-visits-wrap') || node.classList.contains('rv-older-rule')) return true;
	if (node.classList.contains('rv-visit-notes-heading') || node.classList.contains('rv-notes-fold-stop') || node.classList.contains('rv-locator-return-suggestions')) return true;
	if (node.querySelector('.rv-older-visits, .rv-visit-notes-heading, .rv-notes-fold-stop, .rv-locator-return-suggestions')) return true;
	const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (/^older visits\b/i.test(text)) return true;
	if (/^return suggestions\b/i.test(text)) return true;
	if (node.classList.contains('callout') && /return suggestions/i.test(text)) return true;
	return false;
}

/** Recent Notes, centered, with the same chevron Reading view draws. The line stays in the file. */
class RecentNotesWidget extends WidgetType {
	constructor(readonly label: string, readonly path: string, readonly open: boolean) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof RecentNotesWidget && other.label === this.label && other.path === this.path && other.open === this.open;
	}

	toDOM(view: EditorView): HTMLElement {
		installElHelpers(view.dom.ownerDocument);
		const heading = view.dom.ownerDocument.createElement('h3');
		heading.className = this.open ? 'rv-visit-notes-heading is-open' : 'rv-visit-notes-heading is-collapsed';
		const mark = view.dom.ownerDocument.createElement('span');
		mark.className = 'collapse-indicator collapse-icon';
		heading.appendChild(mark);
		heading.appendChild(view.dom.ownerDocument.createTextNode(this.label));
		mountHeadingChevron(mark);
		const toggle = (event: Event): void => {
			event.preventDefault();
			event.stopPropagation();
		};
		heading.addEventListener('pointerdown', toggle, true);
		heading.addEventListener('mousedown', toggle, true);
		heading.addEventListener('click', (event) => {
			toggle(event);
			const next = !this.open;
			setRecentNotesOpenState(this.path, next);
			view.dispatch({ effects: setRecentNotesOpen.of(next) });
		});
		return heading;
	}
}

/** Calendar tile, time, "with X", day pill, and the item strip. Replaces the raw stamp line. */
class VisitHeadingWidget extends WidgetType {
	constructor(
		readonly source: string,
		readonly publisher: string,
		readonly covered: string,
		readonly hidden = false,
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof VisitHeadingWidget
			&& other.source === this.source
			&& other.publisher === this.publisher
			&& other.covered === this.covered
			&& other.hidden === this.hidden;
	}

	toDOM(view: EditorView): HTMLElement {
		installElHelpers(view.dom.ownerDocument);
		const doc = view.dom.ownerDocument;
		const wrap = doc.createElement('div');
		wrap.className = this.hidden ? 'rv-lp-stamp rv-older-hidden' : 'rv-lp-stamp';
		const heading = doc.createElement('div');
		heading.className = 'rv-visit-stamp';
		wrap.appendChild(heading);
		const when = stampDateTime(this.source);
		paintLiveVisitHeading(heading, this.source, this.covered, this.publisher, when
			? (evt) => {
				wrap.dispatchEvent(new CustomEvent('rv-open-visit-menu', {
					bubbles: true,
					detail: { when: when.getTime(), event: evt },
				}));
			}
			: undefined);
		return wrap;
	}
}

/** Opens or closes the Older Visits group. No document changes. */
export const setOlderVisitsOpen = StateEffect.define<boolean>();

/** Opens or closes Recent Notes. Older Visits and Return Suggestions stay. */
export const setRecentNotesOpen = StateEffect.define<boolean>();

/** Settings or a relayout. The effect value is unused. No document changes. */
export const refreshVisitPreviewEffect = StateEffect.define<null>();

const setLivePreview = StateEffect.define<boolean>();
const setNotePath = StateEffect.define<string>();

const notePathField = StateField.define<string>({
	create: () => '',
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(setNotePath)) value = effect.value;
		}
		return value;
	},
});

const olderOpenField = StateField.define<boolean>({
	create: () => false,
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(setOlderVisitsOpen)) {
				value = effect.value;
				const path = transaction.state.field(notePathField, false);
				if (path) setOlderVisitsOpenState(path, effect.value);
			}
			if (effect.is(setNotePath)) value = olderVisitsOpen(effect.value);
		}
		return value;
	},
});

const livePreviewField = StateField.define<boolean>({
	create: () => false,
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(setLivePreview)) value = effect.value;
		}
		return value;
	},
});

const CHEVRON_PATH = 'm9 18 6-6-6-6';

class OlderVisitsWidget extends WidgetType {
	constructor(private readonly open: boolean) {
		super();
	}

	eq(other: OlderVisitsWidget): boolean {
		return other.open === this.open;
	}

	toDOM(view: EditorView): HTMLElement {
		const doc = view.dom.ownerDocument;
		const wrap = doc.createElement('div');
		wrap.className = 'rv-older-visits-widget';
		const rule = doc.createElement('hr');
		rule.className = 'rv-older-rule';
		const heading = doc.createElement('h3');
		heading.className = this.open ? 'rv-older-visits is-open' : 'rv-older-visits';
		heading.dataset.heading = 'Older Visits';
		const mark = doc.createElement('span');
		mark.className = 'collapse-indicator collapse-icon';
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
		svg.setAttribute('aria-hidden', 'true');
		const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', CHEVRON_PATH);
		svg.appendChild(path);
		mark.appendChild(svg);
		const label = doc.createElement('span');
		label.className = 'rv-older-label';
		label.textContent = 'Older Visits';
		heading.append(mark, label);
		wrap.append(rule, heading);
		heading.addEventListener('mousedown', (event) => {
			event.preventDefault();
		});
		heading.addEventListener('click', (event) => {
			event.preventDefault();
			if ('stopPropagation' in event && typeof event.stopPropagation === 'function') event.stopPropagation();
			const path = view.state.field(notePathField, false);
			const open = path ? !olderVisitsOpen(path) : !view.state.field(olderOpenField, false);
			view.dispatch({ effects: setOlderVisitsOpen.of(open) });
			// The heading widgets were built while those lines were display:none.
			// A second pass, after the open flag is stored, mounts them on screen.
			queueMicrotask(() => {
				if (view.dom.isConnected) view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
			});
		});
		return wrap;
	}
}

function editorIsLivePreview(view: EditorView): boolean {
	const dom = view.dom;
	if (typeof dom.closest !== 'function') return true;
	return dom.closest('.is-live-preview') != null || dom.classList.contains('is-live-preview');
}

function composingNow(state: EditorState, start: EditorState): boolean {
	return composingDocs.has(state.doc) || composingDocs.has(start.doc);
}

export function buildVisitDecorations(
	doc: string,
	options: VisitPreviewSettings,
	open: boolean,
	path = '',
	recentOpen?: boolean,
): DecorationSet {
	const plan = planLivePreviewVisits(doc, options);
	const pieces: { from: number; to: number; deco: Decoration; kind: number }[] = [];
	const hidden = new Set(!open && plan.widgetAt != null ? plan.hiddenLines : []);
	const recentHidden = new Set(recentFoldLineStarts(doc, recentOpen ?? recentNotesOpen(path), options.limit));
	const lines = docLines(doc);
	const headingInFile = lines.some((line) => isOlderVisitsHeading(line.text));
	// The file heading is the one Older Visits control. A second widget at the
	// first older stamp would paint the heading again under the raw line.
	if (plan.widgetAt != null && !headingInFile) {
		pieces.push({
			from: plan.widgetAt,
			to: plan.widgetAt,
			kind: 0,
			deco: Decoration.widget({ widget: new OlderVisitsWidget(open), block: true, side: -1 }),
		});
	}
	for (const from of hiddenButtonFenceLines(doc)) {
		pieces.push({
			from,
			to: from,
			kind: 4,
			deco: Decoration.line({ class: 'rv-mb-hidden' }),
		});
	}
	const seenStamps = new Map<number, number>();
	let lastStrip = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) continue;
		const foldClasses: string[] = [];
		if (hidden.has(line.from) && visitStampLine(line.text) == null) foldClasses.push('rv-older-hidden', 'mb-none');
		if (recentHidden.has(line.from)) foldClasses.push('rv-recent-folded');
		if (isVisitGapLine(lines, index)) foldClasses.push('rv-lp-gap');
		if (foldClasses.length > 0) {
			pieces.push({
				from: line.from,
				to: line.from,
				kind: 1,
				deco: Decoration.line({ class: foldClasses.join(' ') }),
			});
		}
		// The source line's class does not cover a block widget drawn for that
		// line. Replace the whole line so the stamp, the note card, and the
		// rendered paragraph are gone together. The next heading, the older
		// stamp, and Return Suggestions are not in this set.
		if (recentHidden.has(line.from)) {
			const end = line.from + line.text.length;
			if (end > line.from) {
				pieces.push({
					from: line.from,
					to: end,
					kind: 3,
					deco: Decoration.replace({ widget: new RecentFoldWidget(), block: true }),
				});
			}
			continue;
		}
		if (isOlderVisitsHeading(line.text)) {
			const end = line.from + line.text.length;
			pieces.push({
				from: line.from,
				to: line.from,
				kind: 1,
				deco: Decoration.line({ class: 'rv-lp-older-heading' }),
			});
			if (end > line.from) {
				pieces.push({
					from: line.from,
					to: end,
					kind: 2,
					deco: Decoration.replace({ widget: new OlderVisitsWidget(open), block: true }),
				});
			}
			continue;
		}
		const notesHeading = NOTES_HEADING.exec(line.text.trim());
		if (notesHeading) {
			const end = line.from + line.text.length;
			pieces.push({
				from: line.from,
				to: line.from,
				kind: 1,
				deco: Decoration.line({ class: 'rv-lp-notes-heading' }),
			});
			pieces.push({
				from: line.from,
				to: end,
				kind: 2,
				deco: Decoration.replace({ widget: new RecentNotesWidget(notesHeading[1] ?? 'Recent Notes:', path, recentOpen ?? recentNotesOpen(path)) }),
			});
			continue;
		}
		const stamp = visitStampLine(line.text);
		if (stamp) {
			const concealed = hidden.has(line.from) || recentHidden.has(line.from);
			const classes = ['rv-lp-visit', 'rv-lp-visit-heading'];
			if (concealed) classes.push('rv-older-hidden', 'mb-none');
			pieces.push({
				from: line.from,
				to: line.from,
				kind: 1,
				deco: Decoration.line({ class: classes.join(' ') }),
			});
			const when = stampDateTime(stamp);
			const newestIndex = when ? (seenStamps.get(when.getTime()) ?? 0) : 0;
			if (when) seenStamps.set(when.getTime(), newestIndex + 1);
			const publisher = when ? publisherForVisit(doc, when, newestIndex) : '';
			const covered = when ? coveredCampaignFor(doc, when, newestIndex) : '';
			const raw = line.text.replace(/^(?:###|#####)\s+/, '').trim();
			// A stamp always paints a strip, including the muted ghost on an empty visit.
			lastStrip = when != null;
			// A widget built while the line is display:none stays an empty
			// contenteditable span after the fold opens. Mount it only once
			// the line is visible, so the tile, time, pill, and strip are drawn.
			if (concealed) continue;
			const end = line.from + line.text.length;
			pieces.push({
				from: line.from,
				to: end,
				kind: 2,
				deco: Decoration.replace({ widget: new VisitHeadingWidget(raw, publisher, covered, false) }),
			});
			continue;
		}
		const key = INPUT_KEY.exec(line.text)?.[1];
		if (!key) {
			if (stopsVisitSection(line.text)) lastStrip = false;
			continue;
		}
		const locked = hidden.has(line.from);
		const end = line.from + line.text.length;
		const underStrip = !locked && lastStrip;
		lastStrip = false;
		pieces.push({
			from: line.from,
			to: end,
			kind: 5,
			deco: Decoration.replace({ widget: new VisitNoteWidget(path, key, locked, underStrip), block: true }),
		});
	}
	if (pieces.length === 0) return Decoration.none;
	// Block replaces start further left than line classes. Same-from ranges
	// have to be added in startSide order, or the builder rejects the set.
	pieces.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide || a.to - b.to || a.kind - b.kind);
	const builder = new RangeSetBuilder<Decoration>();
	for (const piece of pieces) {
		if (piece.to < piece.from) continue;
		builder.add(piece.from, piece.to, piece.deco);
	}
	return builder.finish();
}

/**
 * Live Preview visit notes. Block widgets replace only the INPUT lines.
 * Headings stay in the document and receive line classes.
 * Every dispatch from here is effects-only.
 */
export function visitPreviewExtension(
	read: () => VisitPreviewSettings,
	pathOf?: (view: EditorView) => string,
	paint?: (dom: HTMLElement) => void,
): Extension {
	const decorate = (state: EditorState, open?: boolean, recentOpen?: boolean): DecorationSet => {
		if (!state.field(livePreviewField)) return Decoration.none;
		const path = state.field(notePathField);
		// An empty path is the gap between notes. Building widgets then fills
		// them from whatever was last cached under ''.
		if (!path) return Decoration.none;
		// Recent Notes toggles pass no older flag. The editor field and the
		// reading-view map both count, so opening Older Visits in either view
		// stays open here, and collapsing Recent does not close it.
		const older = open ?? (state.field(olderOpenField) || olderVisitsOpen(path));
		return buildVisitDecorations(state.doc.toString(), read(), older, path, recentOpen);
	};
	const decorations = StateField.define<DecorationSet>({
		create: (state) => decorate(state),
		update(value, transaction) {
			const refresh = transaction.effects.some((effect) => (
				effect.is(refreshVisitPreviewEffect)
				|| effect.is(setOlderVisitsOpen)
				|| effect.is(setRecentNotesOpen)
				|| effect.is(setLivePreview)
				|| effect.is(setNotePath)
			));
			const typing = transaction.isUserEvent('input.type.compose')
				|| transaction.isUserEvent('input.type.compose.start')
				|| composingNow(transaction.state, transaction.startState);
			if (typing && transaction.docChanged && !refresh) return value.map(transaction.changes);
			if (!transaction.docChanged && !refresh) return value;
			// Read the fold from this transaction. The module map is written
			// by another field, and that write can land after this rebuild.
			let open: boolean | undefined;
			let recentOpen: boolean | undefined;
			for (const effect of transaction.effects) {
				if (effect.is(setOlderVisitsOpen)) open = effect.value;
				if (effect.is(setRecentNotesOpen)) {
					recentOpen = effect.value;
					const path = transaction.state.field(notePathField, false);
					if (path) setRecentNotesOpenState(path, effect.value);
				}
			}
			return decorate(transaction.state, open, recentOpen);
		},
		// Obsidian's markup-hide replace covers the first six characters of the
		// heading and would otherwise outrank this full-line widget. Highest
		// precedence keeps the stamp, including on an empty-material visit.
		provide: (field) => Prec.highest(EditorView.decorations.from(field)),
	});
	const liveWatch = ViewPlugin.fromClass(class {
		observer: MutationObserver | null = null;
		contentWidth = -1;

		constructor(view: EditorView) {
			const onStart = (event: Event): void => {
				const target = event.target;
				if (target instanceof HTMLTextAreaElement) return;
				composingDocs.add(view.state.doc);
			};
			const onEnd = (event: Event): void => {
				const target = event.target;
				if (target instanceof HTMLTextAreaElement) return;
				composingDocs.delete(view.state.doc);
				queueMicrotask(() => {
					if (view.dom.isConnected) view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
				});
			};
			view.contentDOM.addEventListener('compositionstart', onStart, true);
			view.contentDOM.addEventListener('compositionend', onEnd, true);
			this.contentWidth = livePreviewContentWidth(view);
			queueMicrotask(() => {
				syncLivePreview(view);
				syncNotePath(view);
				concealRecentFoldWidgets(view.dom);
				concealHeadingFoldMarks(view.dom);
				lockHiddenMetaBindFields(view.dom);
				paint?.(view.dom);
			});
			const parent = view.dom.parentElement;
			if (!parent || typeof MutationObserver === 'undefined') return;
			try {
				this.observer = new MutationObserver(() => syncLivePreview(view));
				this.observer.observe(parent, { attributes: true, attributeFilter: ['class'] });
			} catch {
				this.observer = null;
			}
		}

		update(update: ViewUpdate): void {
			const view = update.view;
			const nextWidth = livePreviewContentWidth(view);
			const changed = livePreviewShouldPaint({
				docChanged: update.docChanged,
				viewportChanged: update.viewportChanged,
				geometryChanged: update.geometryChanged,
				previousWidth: this.contentWidth,
				nextWidth,
			});
			this.contentWidth = nextWidth;
			queueMicrotask(() => {
				if (!view.dom.isConnected) return;
				syncNotePath(view);
				concealRecentFoldWidgets(view.dom);
				concealHeadingFoldMarks(view.dom);
				if (!changed) return;
				lockHiddenMetaBindFields(view.dom);
				paint?.(view.dom);
			});
		}

		destroy(): void {
			this.observer?.disconnect();
		}
	});
	return [olderOpenField, livePreviewField, notePathField, decorations, liveWatch];

	function syncNotePath(view: EditorView): void {
		const path = pathOf?.(view) ?? '';
		if (!path) return;
		if (view.state.field(notePathField, false) === path) return;
		view.dispatch({ effects: setNotePath.of(path) });
	}
}

function syncLivePreview(view: EditorView): void {
	const live = editorIsLivePreview(view);
	if (view.state.field(livePreviewField, false) === live) return;
	view.dispatch({ effects: setLivePreview.of(live) });
}

export function livePreviewContentWidth(view: { contentDOM?: { clientWidth?: number } | null; dom: { clientWidth?: number } }): number {
	return view.contentDOM?.clientWidth || view.dom.clientWidth || 0;
}

/** Doc and viewport always repaint. Geometry repaints only when the content width changed. */
export function livePreviewShouldPaint(input: {
	docChanged: boolean;
	viewportChanged: boolean;
	geometryChanged: boolean;
	previousWidth: number;
	nextWidth: number;
}): boolean {
	const widthChanged = input.nextWidth !== input.previousWidth;
	return input.docChanged || input.viewportChanged || (input.geometryChanged && widthChanged);
}

export function dispatchVisitPreviewRefresh(view: EditorView): void {
	view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
}
