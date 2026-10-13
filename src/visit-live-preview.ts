import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { coveredCampaignFor, stampDateTime } from './schedule';
import { paintLiveVisitHeading, publisherForVisit, visitHasStripItems } from './visit-controls';
import { visitStampLine } from './visit-display';
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
 * A Meta Bind textArea on a closed Older Visits line is a block widget beside
 * the hidden line, so the line's display:none does not cover it. Mark that
 * widget and disable its fields.
 */
export function lockHiddenMetaBindFields(root: ParentNode): void {
	root.querySelectorAll('.rv-lp-notes.rv-older-hidden, .rv-lp-stamp.rv-older-hidden').forEach((node) => {
		const line = node.closest('.cm-line');
		if (line instanceof HTMLElement) {
			line.classList.add('rv-older-hidden', 'mb-none');
			return;
		}
		let prev: Element | null = node.previousElementSibling;
		while (prev && !prev.classList.contains('cm-line')) prev = prev.previousElementSibling;
		prev?.classList.add('rv-older-hidden', 'mb-none');
	});
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
				sib.classList.add('rv-older-hidden', 'rv-mb-locked');
				lockForeignField(sib);
				sib.querySelectorAll('textarea, input, .mb-input').forEach((node) => lockForeignField(node));
			}
			sib = sib.nextElementSibling;
		}
	}
}

function lockForeignField(node: Element): void {
	if (!(node instanceof HTMLElement)) return;
	node.classList.add('rv-mb-locked');
	node.setAttribute('aria-hidden', 'true');
	node.setAttribute('inert', '');
	if (node.tagName === 'TEXTAREA' || node.tagName === 'INPUT') {
		const field = node as HTMLTextAreaElement;
		field.disabled = true;
		field.readOnly = true;
		field.tabIndex = -1;
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
	for (const line of lines) {
		const stamp = visitStampLine(line.text);
		if (stamp) {
			const classes = ['rv-lp-visit', 'rv-lp-visit-heading'];
			if (hidden.has(line.from)) classes.push('rv-older-hidden', 'mb-none');
			pieces.push({
				from: line.from,
				to: line.from,
				kind: 1,
				deco: Decoration.line({ class: classes.join(' ') }),
			});
			const when = stampDateTime(stamp);
			const publisher = when ? publisherForVisit(doc, when) : '';
			const newestIndex = when ? (seenStamps.get(when.getTime()) ?? 0) : 0;
			if (when) seenStamps.set(when.getTime(), newestIndex + 1);
			const covered = when ? coveredCampaignFor(doc, when, newestIndex) : '';
			const raw = line.text.replace(/^(?:###|#####)\s+/, '').trim();
			lastStrip = visitHasStripItems(raw, covered);
			const end = line.from + line.text.length;
			pieces.push({
				from: line.from,
				to: end,
				kind: 2,
				deco: Decoration.replace({ widget: new VisitHeadingWidget(raw, publisher, covered, hidden.has(line.from)) }),
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
	pieces.sort((a, b) => a.from - b.from || a.to - b.to || a.kind - b.kind);
	const builder = new RangeSetBuilder<Decoration>();
	let cursor = -1;
	for (const piece of pieces) {
		if (piece.from < cursor) continue;
		if (piece.to < piece.from) continue;
		builder.add(piece.from, piece.to, piece.deco);
		cursor = piece.to;
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
	const decorate = (state: EditorState): DecorationSet => {
		if (!state.field(livePreviewField)) return Decoration.none;
		const path = state.field(notePathField);
		// An empty path is the gap between notes. Building widgets then fills
		// them from whatever was last cached under ''.
		if (!path) return Decoration.none;
		return buildVisitDecorations(state.doc.toString(), read(), olderVisitsOpen(path), path);
	};
	const decorations = StateField.define<DecorationSet>({
		create: decorate,
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
			return decorate(transaction.state);
		},
		provide: (field) => EditorView.decorations.from(field),
	});
	const liveWatch = ViewPlugin.fromClass(class {
		observer: MutationObserver | null = null;

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
			const changed = update.docChanged || update.viewportChanged || update.geometryChanged;
			queueMicrotask(() => {
				if (!view.dom.isConnected) return;
				syncNotePath(view);
				lockHiddenMetaBindFields(view.dom);
				if (changed) paint?.(view.dom);
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

export function dispatchVisitPreviewRefresh(view: EditorView): void {
	view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
}
