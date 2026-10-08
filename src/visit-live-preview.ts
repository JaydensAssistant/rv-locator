import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import { visitStampLine } from './visit-display';

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

function editorIsLivePreview(view: EditorView): boolean {
	const dom = view.dom;
	if (typeof dom.closest !== 'function') return true;
	return dom.closest('.is-live-preview') != null || dom.classList.contains('is-live-preview');
}

export function buildVisitDecorations(doc: string, options: VisitPreviewSettings, open: boolean): DecorationSet {
	const plan = planLivePreviewVisits(doc, options);
	if (plan.widgetAt == null) return Decoration.none;
	const builder = new RangeSetBuilder<Decoration>();
	const pieces: { from: number; deco: Decoration; kind: number }[] = [{
		from: plan.widgetAt,
		kind: 0,
		deco: Decoration.widget({ widget: new OlderVisitsWidget(open), block: true, side: -1 }),
	}];
	if (!open) {
		for (const from of plan.hiddenLines) {
			pieces.push({ from, kind: 1, deco: Decoration.line({ class: 'rv-older-hidden' }) });
		}
	}
	pieces.sort((a, b) => a.from - b.from || a.kind - b.kind);
	for (const piece of pieces) builder.add(piece.from, piece.from, piece.deco);
	return builder.finish();
}

/**
 * Older Visits for Live Preview. Every dispatch from here is effects-only.
 * Block widgets have to come from a state field; a view plugin cannot provide them.
 * The document text is never part of the transaction.
 */
export function visitPreviewExtension(read: () => VisitPreviewSettings): Extension {
	const decorate = (state: EditorState): DecorationSet => {
		if (!state.field(livePreviewField)) return Decoration.none;
		return buildVisitDecorations(state.doc.toString(), read(), state.field(olderOpenField));
	};
	const decorations = StateField.define<DecorationSet>({
		create: decorate,
		update(value, transaction) {
			const refresh = transaction.effects.some((effect) => (
				effect.is(refreshVisitPreviewEffect) || effect.is(setOlderVisitsOpen) || effect.is(setLivePreview)
			));
			if (!transaction.docChanged && !refresh) return value;
			return decorate(transaction.state);
		},
		provide: (field) => EditorView.decorations.from(field),
	});
	const liveWatch = ViewPlugin.fromClass(class {
		observer: MutationObserver | null = null;

		constructor(view: EditorView) {
			queueMicrotask(() => syncLivePreview(view));
			const parent = view.dom.parentElement;
			if (!parent || typeof MutationObserver === 'undefined') return;
			try {
				this.observer = new MutationObserver(() => syncLivePreview(view));
				this.observer.observe(parent, { attributes: true, attributeFilter: ['class'] });
			} catch {
				this.observer = null;
			}
		}

		destroy(): void {
			this.observer?.disconnect();
		}
	});
	return [olderOpenField, livePreviewField, decorations, liveWatch];
}

function syncLivePreview(view: EditorView): void {
	const live = editorIsLivePreview(view);
	if (view.state.field(livePreviewField, false) === live) return;
	view.dispatch({ effects: setLivePreview.of(live) });
}

export function dispatchVisitPreviewRefresh(view: EditorView): void {
	view.dispatch({ effects: refreshVisitPreviewEffect.of(null) });
}
