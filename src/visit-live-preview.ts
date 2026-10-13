import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { coveredCampaignFor, stampDateTime } from './schedule';
import { visitStampLine } from './visit-display';
import { decorateVisitControls, publisherForVisit, type VisitTarget } from './visit-controls';
import { noteWritePending } from './visit-notes-field';

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

let liveHostHook: ((root: HTMLElement) => void) | null = null;

/** Mounts the native notes textarea once the visit widget exists. */
export function onLiveVisitHost(hook: ((root: HTMLElement) => void) | null): void {
	liveHostHook = hook;
}

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

/**
 * Live Preview has no inner `h5`. The widget replaces the raw `#####` line and
 * the note under it while the cursor is outside that range.
 */
class VisitCardWidget extends WidgetType {
	constructor(
		private readonly source: string,
		private readonly covered: string,
	) {
		super();
	}

	eq(other: WidgetType): boolean {
		return other instanceof VisitCardWidget && other.source === this.source && other.covered === this.covered;
	}

	toDOM(view: EditorView): HTMLElement {
		const doc = view.dom.ownerDocument;
		const wrap = doc.createElement('div');
		wrap.className = 'rv-lp-visit markdown-rendered';
		const lines = this.source.replace(/\n$/, '').split('\n');
		const heading = doc.createElement('h5');
		heading.textContent = (lines[0] ?? '').replace(/^#{1,6}\s+/, '');
		wrap.appendChild(heading);
		let list: HTMLElement | null = null;
		for (const line of lines.slice(1)) {
			const item = /^\s*[-*]\s+(.*)$/.exec(line);
			if (item) {
				if (!list) {
					list = doc.createElement('ul');
					wrap.appendChild(list);
				}
				const li = doc.createElement('li');
				li.textContent = item[1] ?? '';
				list.appendChild(li);
				continue;
			}
			list = null;
			if (!line.trim()) continue;
			const paragraph = doc.createElement('p');
			paragraph.textContent = line;
			wrap.appendChild(paragraph);
		}
		try {
			const when = stampDateTime((lines[0] ?? '').replace(/^#{1,6}\s+/, ''));
			if (when) {
				const publisher = publisherForVisit(view.state.doc.toString(), when);
				if (publisher) heading.dataset.rvCompanion = publisher;
			}
			decorateVisitControls(wrap, () => null, (target: VisitTarget, evt: MouseEvent) => {
				wrap.dispatchEvent(new CustomEvent('rv-open-visit', { bubbles: true, detail: { target, event: evt } }));
			}, () => this.covered);
		} catch {
			// createEl is Obsidian's. The heading and note are already in the widget.
		}
		liveHostHook?.(wrap);
		return wrap;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

/** Opens or closes the Older Visits group. No document changes. */
export const setOlderVisitsOpen = StateEffect.define<boolean>();

/** Settings or a relayout. The effect value is unused. No document changes. */
export const refreshVisitPreviewEffect = StateEffect.define<null>();

const setLivePreview = StateEffect.define<boolean>();

const olderOpenField = StateField.define<boolean>({
	create: () => false,
	update(value, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(setOlderVisitsOpen)) value = effect.value;
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
			const open = view.state.field(olderOpenField, false);
			view.dispatch({ effects: setOlderVisitsOpen.of(!open) });
		});
		return wrap;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/** A frontmatter save keeps the visit cards. A different note does not. */
function visitCardsUnchanged(before: string, after: string): boolean {
	const signature = (doc: string): string => planVisitCardRanges(doc).map((range) => doc.slice(range.from, range.to)).join('\0');
	return signature(before) === signature(after);
}

function editorIsLivePreview(view: EditorView): boolean {
	const dom = view.dom;
	if (typeof dom.closest !== 'function') return true;
	return dom.closest('.is-live-preview') != null || dom.classList.contains('is-live-preview');
}

export function buildVisitDecorations(
	doc: string,
	options: VisitPreviewSettings,
	open: boolean,
	selection?: { from: number; to: number } | null,
): DecorationSet {
	const plan = planLivePreviewVisits(doc, options);
	const pieces: { from: number; to: number; deco: Decoration; kind: number }[] = [];
	const blocked: number[] = [];
	if (plan.widgetAt != null) {
		pieces.push({
			from: plan.widgetAt,
			to: plan.widgetAt,
			kind: 0,
			deco: Decoration.widget({ widget: new OlderVisitsWidget(open), block: true, side: -1 }),
		});
	}
	if (!open && plan.widgetAt != null) {
		for (const from of plan.hiddenLines) {
			blocked.push(from);
			pieces.push({ from, to: from, kind: 1, deco: Decoration.line({ class: 'rv-older-hidden' }) });
		}
	}
	const cursor = selection ?? null;
	const lines = docLines(doc);
	for (const from of hiddenButtonFenceLines(doc)) {
		pieces.push({
			from,
			to: from,
			kind: 4,
			deco: Decoration.line({ class: 'rv-mb-hidden' }),
		});
	}
	const seenStamps = new Map<number, number>();
	for (const range of planVisitCardRanges(doc)) {
		if (cursor && cursor.from < range.to && cursor.to > range.from) continue;
		if (blocked.some((at) => at >= range.from && at < range.to)) continue;
		const source = doc.slice(range.from, range.to);
		const stamp = visitStampLine(source.split('\n')[0] ?? '') ?? '';
		const when = stampDateTime(stamp);
		const newestIndex = when ? (seenStamps.get(when.getTime()) ?? 0) : 0;
		if (when) seenStamps.set(when.getTime(), newestIndex + 1);
		const covered = when ? coveredCampaignFor(doc, when, newestIndex) : '';
		pieces.push({
			from: range.from,
			to: range.from,
			kind: 2,
			deco: Decoration.widget({ widget: new VisitCardWidget(source, covered), block: true, side: -1 }),
		});
		for (const line of lines) {
			if (line.from < range.from || line.from >= range.to) continue;
			if (blocked.includes(line.from)) continue;
			pieces.push({
				from: line.from,
				to: line.from,
				kind: 3,
				deco: Decoration.line({ class: 'rv-lp-card-source' }),
			});
		}
	}
	if (pieces.length === 0) return Decoration.none;
	pieces.sort((a, b) => a.from - b.from || a.to - b.to || a.kind - b.kind);
	const builder = new RangeSetBuilder<Decoration>();
	for (const piece of pieces) builder.add(piece.from, piece.to, piece.deco);
	return builder.finish();
}

/**
 * Older Visits for Live Preview. Every dispatch from here is effects-only.
 * Block widgets have to come from a state field; a view plugin cannot provide them.
 * The document text is never part of the transaction.
 */
export function visitPreviewExtension(read: () => VisitPreviewSettings, paint?: (dom: HTMLElement) => void): Extension {
	const decorate = (state: EditorState): DecorationSet => {
		if (!state.field(livePreviewField)) return Decoration.none;
		const selection = state.selection.main;
		return buildVisitDecorations(state.doc.toString(), read(), state.field(olderOpenField), selection);
	};
	const decorations = StateField.define<DecorationSet>({
		create: decorate,
		update(value, transaction) {
			const refresh = transaction.effects.some((effect) => (
				effect.is(refreshVisitPreviewEffect) || effect.is(setOlderVisitsOpen) || effect.is(setLivePreview)
			));
			if (!refresh && transaction.docChanged && noteWritePending() && visitCardsUnchanged(transaction.startState.doc.toString(), transaction.state.doc.toString())) {
				return value.map(transaction.changes);
			}
			if (!transaction.docChanged && !refresh) return value;
			return decorate(transaction.state);
		},
		provide: (field) => EditorView.decorations.from(field),
	});
	const liveWatch = ViewPlugin.fromClass(class {
		observer: MutationObserver | null = null;

		constructor(view: EditorView) {
			queueMicrotask(() => {
				syncLivePreview(view);
				mountLiveVisitHosts(view.dom);
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
			if (!update.docChanged && !update.viewportChanged && !update.geometryChanged) return;
			queueMicrotask(() => {
				mountLiveVisitHosts(update.view.dom);
				paint?.(update.view.dom);
			});
		}

		destroy(): void {
			this.observer?.disconnect();
		}
	});
	return [olderOpenField, livePreviewField, decorations, liveWatch];
}

function mountLiveVisitHosts(dom: HTMLElement): void {
	if (!liveHostHook) return;
	dom.querySelectorAll('.rv-lp-visit').forEach((node) => {
		if (node instanceof HTMLElement) liveHostHook?.(node);
	});
}

function syncLivePreview(view: EditorView): void {
	const live = editorIsLivePreview(view);
	if (view.state.field(livePreviewField, false) === live) return;
	view.dispatch({ effects: setLivePreview.of(live) });
}

export function dispatchVisitPreviewRefresh(view: EditorView): void {
	view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
}
