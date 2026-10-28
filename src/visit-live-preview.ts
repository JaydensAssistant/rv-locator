import { Prec, RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { isReturnSuggestionsLine } from './attempt-digest';
import { coveredCampaignFor, stampDateTime } from './schedule';
import { paintLiveVisitHeading, publisherForVisit } from './visit-controls';
import { mountHeadingChevron, visitStampLine } from './visit-display';
import { attachVisitNoteArea } from './visit-notes-field';
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

/**
 * Older visits in file order, same slice as the reading-view layout.
 * The widget sits in front of the first hidden stamp. Hidden lines are
 * existing document lines; nothing here is inserted into the text.
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
	return /^#{1,6}\s+/.test(trimmed) && visitStampLine(trimmed) == null;
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
			if (area instanceof HTMLTextAreaElement) unlockNoteArea(area);
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
 * Line classes come from decorations. This does not touch `.cm-line`.
 */
export function lockHiddenMetaBindFields(root: ParentNode): void {
	const lines = root.querySelectorAll('.cm-line.rv-older-hidden');
	for (const line of Array.from(lines)) {
		if (!(line instanceof HTMLElement)) continue;
		line.querySelectorAll('textarea:not(.rv-native-notes-area), .mb-input, input').forEach((node) => {
			lockForeignField(node);
		});
		let sib: Element | null = line.nextElementSibling;
		while (sib && !sib.classList.contains('cm-line')) {
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

/** Recent Notes, centered, with the same chevron Reading view draws. The line stays in the file. */
class RecentNotesWidget extends WidgetType {
	constructor(readonly label: string) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof RecentNotesWidget && other.label === this.label;
	}

	toDOM(view: EditorView): HTMLElement {
		installElHelpers(view.dom.ownerDocument);
		const heading = view.dom.ownerDocument.createElement('h3');
		heading.className = 'rv-visit-notes-heading is-open';
		const mark = view.dom.ownerDocument.createElement('span');
		mark.className = 'collapse-indicator collapse-icon';
		heading.appendChild(mark);
		heading.appendChild(view.dom.ownerDocument.createTextNode(this.label));
		mountHeadingChevron(mark);
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
): DecorationSet {
	const plan = planLivePreviewVisits(doc, options);
	const pieces: { from: number; to: number; deco: Decoration; kind: number }[] = [];
	const hidden = new Set(!open && plan.widgetAt != null ? plan.hiddenLines : []);
	if (plan.widgetAt != null) {
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
	const lines = docLines(doc);
	const seenStamps = new Map<number, number>();
	let lastStrip = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) continue;
		const foldClasses: string[] = [];
		if (hidden.has(line.from) && visitStampLine(line.text) == null) foldClasses.push('rv-older-hidden', 'mb-none');
		if (isVisitGapLine(lines, index)) foldClasses.push('rv-lp-gap');
		if (foldClasses.length > 0) {
			pieces.push({
				from: line.from,
				to: line.from,
				kind: 1,
				deco: Decoration.line({ class: foldClasses.join(' ') }),
			});
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
				deco: Decoration.replace({ widget: new RecentNotesWidget(notesHeading[1] ?? 'Recent Notes:') }),
			});
			continue;
		}
		const stamp = visitStampLine(line.text);
		if (stamp) {
			const concealed = hidden.has(line.from);
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
	const decorate = (state: EditorState, open?: boolean): DecorationSet => {
		if (!state.field(livePreviewField)) return Decoration.none;
		const path = state.field(notePathField);
		// An empty path is the gap between notes. Building widgets then fills
		// them from whatever was last cached under ''.
		if (!path) return Decoration.none;
		return buildVisitDecorations(state.doc.toString(), read(), open ?? olderVisitsOpen(path), path);
	};
	const decorations = StateField.define<DecorationSet>({
		create: (state) => decorate(state),
		update(value, transaction) {
			const refresh = transaction.effects.some((effect) => (
				effect.is(refreshVisitPreviewEffect)
				|| effect.is(setOlderVisitsOpen)
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
			for (const effect of transaction.effects) {
				if (effect.is(setOlderVisitsOpen)) open = effect.value;
			}
			return decorate(transaction.state, open);
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
