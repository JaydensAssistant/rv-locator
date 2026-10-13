import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { coveredCampaignFor, stampDateTime } from './schedule';
import { fillItemStrip, publisherForVisit } from './visit-controls';
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
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof VisitNoteWidget && other.path === this.path && other.key === this.key;
	}

	toDOM(view: EditorView): HTMLElement {
		const id = noteId(this.path, this.key);
		const saved = parkedNotes.get(id);
		if (saved) {
			parkedNotes.delete(id);
			return saved.el;
		}
		const doc = view.dom.ownerDocument;
		const host = doc.createElement('div');
		host.className = 'rv-lp-notes rv-visit-notes-host mb-none';
		const area = doc.createElement('textarea');
		area.rows = 1;
		area.value = visitNoteValue(this.path, this.key);
		host.appendChild(area);
		const unload = attachVisitNoteArea(area, this.path, this.key);
		noteUnloads.set(host, unload);
		return host;
	}

	destroy(dom: HTMLElement): void {
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

/** "with X" on the heading line. The heading text itself stays a CodeMirror line. */
class VisitWithWidget extends WidgetType {
	constructor(private readonly name: string) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof VisitWithWidget && other.name === this.name;
	}

	toDOM(view: EditorView): HTMLElement {
		const span = view.dom.ownerDocument.createElement('span');
		span.className = 'rv-stamp-with';
		span.textContent = `with ${this.name}`;
		return span;
	}
}

/** Literature, media, and lesson chips, or the empty ghost strip. */
class VisitStripWidget extends WidgetType {
	constructor(
		private readonly source: string,
		private readonly covered: string,
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof VisitStripWidget && other.source === this.source && other.covered === this.covered;
	}

	toDOM(view: EditorView): HTMLElement {
		const strip = view.dom.ownerDocument.createElement('div');
		strip.className = 'rv-item-strip';
		try {
			fillItemStrip(strip, this.source, this.covered);
		} catch {
			if (!strip.childElementCount) strip.classList.add('is-ghost');
		}
		return strip;
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
	for (const line of lines) {
		const stamp = visitStampLine(line.text);
		if (stamp) {
			const classes = ['rv-lp-visit', 'rv-lp-visit-heading'];
			if (hidden.has(line.from)) classes.push('rv-older-hidden');
			pieces.push({
				from: line.from,
				to: line.from,
				kind: 1,
				deco: Decoration.line({ class: classes.join(' ') }),
			});
			if (!hidden.has(line.from)) {
				const when = stampDateTime(stamp);
				const publisher = when ? publisherForVisit(doc, when) : '';
				if (publisher) {
					pieces.push({
						from: line.from + line.text.length,
						to: line.from + line.text.length,
						kind: 2,
						deco: Decoration.widget({ widget: new VisitWithWidget(publisher), side: 1 }),
					});
				}
				const newestIndex = when ? (seenStamps.get(when.getTime()) ?? 0) : 0;
				if (when) seenStamps.set(when.getTime(), newestIndex + 1);
				const covered = when ? coveredCampaignFor(doc, when, newestIndex) : '';
				pieces.push({
					from: line.from + line.text.length,
					to: line.from + line.text.length,
					kind: 3,
					deco: Decoration.widget({
						widget: new VisitStripWidget(stamp, covered),
						block: true,
						side: 1,
					}),
				});
			}
			continue;
		}
		const key = INPUT_KEY.exec(line.text)?.[1];
		if (!key) continue;
		if (hidden.has(line.from)) {
			pieces.push({
				from: line.from,
				to: line.from,
				kind: 1,
				deco: Decoration.line({ class: 'rv-older-hidden' }),
			});
			continue;
		}
		const end = line.from + line.text.length;
		pieces.push({
			from: line.from,
			to: end,
			kind: 5,
			deco: Decoration.replace({ widget: new VisitNoteWidget(path, key), block: true }),
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
