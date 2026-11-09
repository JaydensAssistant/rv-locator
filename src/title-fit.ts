import { displayTooltip } from 'obsidian';
import { splitTitleSuffix, stripTitleQuotes } from './catalog';

const TIP_PRESS_MS = 450;

function phoneTooltipHost(el: HTMLElement): boolean {
	const body = el.ownerDocument?.body;
	if (!body) return false;
	return body.classList.contains('is-phone') || body.classList.contains('is-mobile');
}

/**
 * Obsidian tooltip, same placement as the visit buttons. The native `title`
 * attribute stays off so the OS tooltip does not also appear.
 * `touch: false` leaves click and long-press to the control that already owns them.
 */
export function armHoverTooltip(el: HTMLElement, text: string, opts?: { touch?: boolean }): void {
	const full = text.replace(/\s+/g, ' ').trim();
	if (typeof el.removeAttribute === 'function') el.removeAttribute('title');
	if (!el.dataset || typeof el.addEventListener !== 'function') return;
	if (!full) {
		delete el.dataset.rvTip;
		return;
	}
	el.dataset.rvTip = full;
	if (el.dataset.rvTipArmed === '1') return;
	el.dataset.rvTipArmed = '1';
	el.addEventListener('mouseenter', () => {
		if (phoneTooltipHost(el)) return;
		const tip = el.dataset.rvTip?.trim();
		if (!tip) return;
		displayTooltip(el, tip, { placement: 'top' });
	});
	if (opts?.touch === false) return;
	let timer: number | null = null;
	const clear = (): void => {
		if (timer == null) return;
		window.clearTimeout(timer);
		timer = null;
	};
	el.addEventListener('pointerdown', (event) => {
		if (event.pointerType === 'mouse') return;
		clear();
		const doc = el.ownerDocument;
		const release = (): void => {
			clear();
			doc.removeEventListener('pointerup', release, true);
			doc.removeEventListener('pointercancel', release, true);
		};
		doc.addEventListener('pointerup', release, true);
		doc.addEventListener('pointercancel', release, true);
		timer = window.setTimeout(() => {
			timer = null;
			if (!el.isConnected) return;
			const tip = el.dataset.rvTip?.trim();
			if (tip) displayTooltip(el, tip, { placement: 'top' });
		}, TIP_PRESS_MS);
	});
}

/** Icon button: keep the accessible name and show it from the Obsidian tooltip. */
export function armIconTooltip(el: HTMLElement, label: string): void {
	const text = label.trim();
	if (text) el.setAttribute('aria-label', text);
	armHoverTooltip(el, text, { touch: true });
}

export type TitleKind = 'literature' | 'media' | 'lesson' | 'plain';

/** Render-time title. Quotes stay out of the display. Media and lessons gain their suffix once. */
export function displayTitle(title: string, kind: TitleKind = 'plain'): { text: string; suffix: string } {
	const clean = stripTitleQuotes(title);
	const split = splitTitleSuffix(clean);
	if (kind === 'media') return split.suffix === 'Video' ? split : { text: clean, suffix: 'Video' };
	if (kind === 'lesson') return split.suffix === 'Study' ? split : { text: clean, suffix: 'Study' };
	return split.suffix ? split : { text: clean, suffix: '' };
}

/** The rendered suffix keeps one leading space and no other gap before it. */
export function paintedSuffix(suffix: string): string {
	const clean = suffix.trim();
	return clean ? ` ${clean}` : '';
}

/** A stem is never drawn shorter than this, unless the stem itself is shorter. */
export const MIN_TITLE_CHARS = 5;

/** First row length when a strip splits. Four items become 2 and 2. Two become 1 and 1. */
export function evenSplitIndex(count: number): number {
	if (count <= 1) return count;
	return Math.ceil(count / 2);
}

/**
 * One line while every item can keep `minKeep` characters plus its suffix.
 * Otherwise the strip uses two centred rows.
 */
export function stripRowPlan(minWidths: readonly number[], width: number, gap: number, minKeep = MIN_TITLE_CHARS): 1 | 2 {
	if (minWidths.length < 2 || width <= 0) return 1;
	const floors = minWidths.map((item) => Math.max(0, item));
	const need = floors.reduce((sum, item) => sum + item, 0) + Math.max(0, floors.length - 1) * gap;
	if (need <= width) return 1;
	void minKeep;
	return 2;
}

/**
 * Each title keeps at least `minKeep` characters. The longest stem gives way
 * first until the row fits the character budget.
 */
export function fairCuts(lengths: readonly number[], budget: number, minKeep = MIN_TITLE_CHARS): number[] {
	const cuts = lengths.map((length) => Math.max(0, length));
	let total = cuts.reduce((sum, length) => sum + length, 0);
	while (total > budget) {
		let longest = 0;
		for (let index = 1; index < cuts.length; index += 1) {
			if ((cuts[index] ?? 0) > (cuts[longest] ?? 0)) longest = index;
		}
		if ((cuts[longest] ?? 0) <= minKeep) break;
		cuts[longest] = (cuts[longest] ?? 0) - 1;
		total -= 1;
	}
	return cuts;
}

/**
 * Suffix-preserving fit. The suffix span has no gap before it. Hover keeps
 * the full title; a tap on a truncated title opens a phone popover.
 */
export function mountFittedTitle(parent: HTMLElement, title: string, kind: TitleKind = 'plain'): HTMLElement {
	const parts = displayTitle(title, kind);
	const host = parent.createSpan('rv-fit');
	const full = parts.suffix ? `${parts.text} ${parts.suffix}` : parts.text;
	host.setAttribute('data-full', full);
	host.setAttribute('data-stem', parts.text);
	armHoverTooltip(host, full, { touch: false });
	const stem = host.createSpan('rv-fit-stem');
	stem.textContent = parts.text;
	if (parts.suffix) host.createSpan({ cls: 'rv-type', text: paintedSuffix(parts.suffix) });
	host.addEventListener('click', (event) => {
		if (host.closest('.rv-item-strip')) return;
		if (stem.textContent === parts.text) return;
		event.preventDefault();
		event.stopPropagation();
		showTitlePopover(host, full);
	});
	return host;
}

/** Keep an overlay on the chip. Pull it inside the screen only when the chip itself would cross the edge. */
export function overlayOnChip(
	box: { left: number; width: number },
	viewWidth: number,
	margin = 8,
): { left: number; width: number } {
	const room = Math.max(0, viewWidth - margin * 2);
	let width = Math.max(0, box.width);
	let left = box.left;
	if (width > room) width = room;
	if (left < margin) left = margin;
	if (left + width > viewWidth - margin) left = Math.max(margin, viewWidth - margin - width);
	return { left, width };
}

export function fitTitleRow(row: HTMLElement): void {
	const items = Array.from(row.querySelectorAll<HTMLElement>(':scope > .rv-item .rv-fit, :scope > .rv-fit'));
	if (items.length === 0) return;
	const stems = items.map((item) => item.getAttribute('data-stem') ?? '');
	const width = row.clientWidth;
	let lines: 1 | 2 = 1;
	if (width > 0 && items.length >= 4) {
		const view = row.ownerDocument.defaultView;
		const rowStyle = view?.getComputedStyle(row);
		const pad = rowStyle ? (parseFloat(rowStyle.paddingLeft) || 0) + (parseFloat(rowStyle.paddingRight) || 0) : 0;
		const rowGap = rowStyle ? (parseFloat(rowStyle.columnGap) || parseFloat(rowStyle.gap) || 0) : 12;
		const gap = Number.isFinite(rowGap) ? rowGap : 12;
		const usable = Math.max(0, width - pad);
		const floors = stems.map((stem, index) => stemFloorWidth(items[index] ?? row, stem));
		lines = stripRowPlan(floors, usable, gap);
	}
	applyStripSplit(row, lines === 2 ? evenSplitIndex(items.length) : 0);
	items.forEach((item, index) => paintFullStem(item, stems[index] ?? ''));
}

function stemFloorWidth(item: HTMLElement, stem: string): number {
	const host = item.closest('.rv-item');
	const box = host instanceof HTMLElement ? host : item;
	const stemEl = item.querySelector('.rv-fit-stem');
	const previous = stemEl?.textContent ?? '';
	const keep = Math.min(MIN_TITLE_CHARS, stem.length);
	if (stemEl) stemEl.textContent = stem.length > keep ? `${stem.slice(0, keep)}…` : stem;
	const snapshot = box.style.cssText;
	box.style.flex = '0 0 auto';
	box.style.width = 'max-content';
	box.style.maxWidth = 'none';
	box.style.minWidth = 'max-content';
	const measured = Math.max(box.scrollWidth, box.offsetWidth);
	box.style.cssText = snapshot;
	if (stemEl) stemEl.textContent = previous;
	return measured;
}

/** CSS ellipsizes a stem that does not fit. The text stays whole until then. */
function paintFullStem(item: HTMLElement, text: string): void {
	const stem = item.querySelector('.rv-fit-stem');
	const host = item.closest('.rv-item');
	if (host?.classList.contains('is-open')) {
		if (stem) stem.textContent = text;
		return;
	}
	if (host?.classList.contains('is-squeezed')) {
		if (stem) stem.textContent = text.length > 1 ? `${text.slice(0, 1)}…` : text;
		return;
	}
	if (stem && stem.textContent !== text) stem.textContent = text;
}

function applyStripSplit(row: HTMLElement, splitAt: number): void {
	row.querySelectorAll(':scope > .rv-strip-break').forEach((node) => node.remove());
	const wrapped = splitAt > 0;
	row.classList.toggle('is-two-line', wrapped);
	if (!wrapped) return;
	const chips = Array.from(row.querySelectorAll<HTMLElement>(':scope > .rv-item'));
	const after = chips[splitAt];
	const breaker = row.ownerDocument.createElement('span');
	breaker.className = 'rv-strip-break';
	if (after) row.insertBefore(breaker, after);
	else row.appendChild(breaker);
}

export function watchTitleRow(row: HTMLElement, refit?: () => void, observed?: HTMLElement | null): void {
	const target = observed instanceof HTMLElement ? observed : row;
	const run = (): void => {
		if (refit) refit();
		else fitTitleRow(row);
	};
	run();
	if (row.clientWidth <= 0 && typeof requestAnimationFrame === 'function') {
		requestAnimationFrame(run);
	}
	if (row.dataset.rvFit === '1' || typeof ResizeObserver === 'undefined') return;
	row.dataset.rvFit = '1';
	let width = target.clientWidth;
	try {
		const observer = new ResizeObserver(() => {
			const next = target.clientWidth;
			if (next === width) return;
			width = next;
			run();
		});
		observer.observe(target);
	} catch {
		/* Not a browser node. */
	}
}

const LEADING_NUMBER = /^(\d+\s+)/;

/** The closed overlay uses the input's own font and text inset, so a pick sits where the typed letters sat. */
function matchClosedField(input: HTMLElement, overlay: HTMLElement): void {
	const view = input.ownerDocument?.defaultView;
	if (!view || typeof view.getComputedStyle !== 'function') return;
	const style = view.getComputedStyle(input);
	const left = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0);
	const right = (parseFloat(style.paddingRight) || 0) + (parseFloat(style.borderRightWidth) || 0);
	overlay.style.fontSize = style.fontSize;
	overlay.style.fontFamily = style.fontFamily;
	overlay.style.fontWeight = style.fontWeight;
	overlay.style.letterSpacing = style.letterSpacing;
	overlay.style.lineHeight = style.lineHeight;
	overlay.style.paddingLeft = `${left}px`;
	overlay.style.paddingRight = `${right}px`;
}

/**
 * Closed catalog fields keep the leading number and the type suffix visible.
 * Focus shows the full value in the input.
 */
export function mountClosedTitle(
	input: HTMLElement,
	present: (value: string) => { text: string; suffix: string; count?: string },
): void {
	const parent = input.parentElement;
	if (!parent) return;
	const found = parent.querySelector(':scope > .rv-closed-title');
	const overlay = found instanceof HTMLElement ? found : input.ownerDocument.createElement('span');
	if (!(found instanceof HTMLElement)) {
		overlay.className = 'rv-closed-title';
		overlay.setAttribute('aria-hidden', 'true');
		input.insertAdjacentElement('afterend', overlay);
	}
	const read = (): string => {
		const tag = input.tagName;
		if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && 'value' in input) {
			const value = (input as HTMLInputElement).value;
			if (typeof value === 'string') return value;
		}
		return input.getAttribute('value') ?? '';
	};
	const paint = (): void => {
		const focused = input.ownerDocument.activeElement === input;
		const value = read().trim();
		if (focused || !value) {
			overlay.replaceChildren();
			overlay.hidden = true;
			input.classList.remove('is-title-closed');
			return;
		}
		const parts = present(value);
		const lead = LEADING_NUMBER.exec(parts.text);
		const pre = lead?.[1] ?? '';
		const stem = pre ? parts.text.slice(pre.length) : parts.text;
		const suffix = parts.suffix.trim();
		const count = (parts.count ?? '').trim();
		overlay.replaceChildren();
		matchClosedField(input, overlay);
		if (pre) overlay.append(closedSpan(input, 'rv-title-pre', pre));
		overlay.append(closedSpan(input, 'rv-title-text', stem));
		if (suffix) overlay.append(closedSpan(input, 'rv-type rv-title-suffix', paintedSuffix(suffix)));
		if (count) overlay.append(closedSpan(input, 'rv-count-pill', count));
		overlay.hidden = false;
		const tip = [parts.text, suffix, count].filter((part) => part.length > 0).join(' ');
		armHoverTooltip(overlay, tip, { touch: false });
		input.classList.add('is-title-closed');
	};
	input.addEventListener('focus', paint);
	input.addEventListener('blur', paint);
	input.addEventListener('input', paint);
	input.addEventListener('change', paint);
	input.addEventListener('rv-closed-refresh', paint);
	paint();
}

function closedSpan(input: HTMLElement, cls: string, text: string): HTMLElement {
	const node = input.ownerDocument.createElement('span');
	node.className = cls;
	node.textContent = text;
	return node;
}

/**
 * Hub names and addresses keep the start and cut the end: `Return Visits…`.
 * A box that already fits is left whole. Width and font are read before the
 * text is written, and repeated strings reuse the cached measure.
 */
const textWidthCache = new Map<string, number>();
let textMeasure: CanvasRenderingContext2D | null | undefined;

function cachedTextWidth(font: string, sample: string): number | null {
	const key = `${font}\n${sample}`;
	const hit = textWidthCache.get(key);
	if (hit != null) return hit;
	if (textMeasure === undefined) {
		try {
			textMeasure = document.createElement('canvas').getContext('2d');
		} catch {
			textMeasure = null;
		}
	}
	if (!textMeasure) return null;
	textMeasure.font = font || '13px sans-serif';
	const width = textMeasure.measureText(sample).width;
	if (textWidthCache.size > 2000) textWidthCache.clear();
	textWidthCache.set(key, width);
	return width;
}

function ellipsisWithin(font: string, source: string, width: number): string | null {
	const whole = cachedTextWidth(font, source);
	if (whole == null) return null;
	if (whole <= width + 1) return source;
	let lo = 1;
	let hi = source.length - 1;
	let best = '…';
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const candidate = `${source.slice(0, mid)}…`;
		const size = cachedTextWidth(font, candidate) ?? width + 2;
		if (size <= width + 1) {
			best = candidate;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return best;
}

export function fitEndEllipsis(el: HTMLElement, full: string): void {
	const text = full.replace(/\s+/g, ' ').trim();
	el.dataset.full = text;
	armHoverTooltip(el, text, { touch: false });
	const apply = (): void => {
		const source = (el.dataset.full || text).replace(/\s+/g, ' ').trim();
		const presetWidth = el.dataset.rvMeasureWidth;
		const presetFont = el.dataset.rvMeasureFont;
		delete el.dataset.rvMeasureWidth;
		delete el.dataset.rvMeasureFont;
		const view = el.ownerDocument.defaultView;
		const width = presetWidth != null && presetWidth !== '' ? Number.parseFloat(presetWidth) : el.clientWidth;
		const font = presetFont || (view && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(el).font : '');
		if (!source || !Number.isFinite(width) || width <= 8) {
			if (el.textContent !== source) el.textContent = source;
			return;
		}
		const fitted = ellipsisWithin(font, source, width);
		if (fitted != null) {
			if (el.textContent !== fitted) el.textContent = fitted;
			return;
		}
		if (el.textContent !== source) el.textContent = source;
		if (el.scrollWidth <= width + 1 && el.scrollHeight <= el.clientHeight + 4) return;
		let lo = 1;
		let hi = source.length - 1;
		let best = '…';
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const candidate = `${source.slice(0, mid)}…`;
			el.textContent = candidate;
			if (el.scrollWidth <= width + 1) {
				best = candidate;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		el.textContent = best;
	};
	apply();
	if (el.dataset.rvEnd === '1') return;
	el.dataset.rvEnd = '1';
	if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
	if (typeof ResizeObserver === 'undefined') return;
	try {
		const observer = new ResizeObserver(() => apply());
		observer.observe(el);
		const row = el.closest('.rv-hub-row, .rv-hub-owned');
		if (row instanceof HTMLElement && row !== el) observer.observe(row);
	} catch {
		/* The node is not in a browser. */
	}
}

/**
 * Catalog titles keep the start and the end. The ellipsis sits in the middle.
 * A box that already fits is left whole.
 */
export function fitMiddleEllipsis(el: HTMLElement, full: string): void {
	const text = full.replace(/\s+/g, ' ').trim();
	el.dataset.full = text;
	armHoverTooltip(el, text, { touch: false });
	const apply = (): void => {
		const source = (el.dataset.full || text).replace(/\s+/g, ' ').trim();
		el.textContent = source;
		const width = el.clientWidth;
		if (!source || width <= 8) return;
		if (el.scrollWidth <= width + 1) return;
		let lo = 1;
		let hi = source.length - 1;
		let best = '…';
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const head = Math.ceil(mid / 2);
			const tail = Math.floor(mid / 2);
			const candidate = tail > 0 ? `${source.slice(0, head)}…${source.slice(source.length - tail)}` : `${source.slice(0, head)}…`;
			el.textContent = candidate;
			if (el.scrollWidth <= width + 1) {
				best = candidate;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		el.textContent = best;
	};
	apply();
	if (el.dataset.rvMid === '1') return;
	el.dataset.rvMid = '1';
	if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
	if (typeof ResizeObserver === 'undefined') return;
	try {
		const observer = new ResizeObserver(() => apply());
		observer.observe(el);
	} catch {
		/* The node is not in a browser. */
	}
}

/** The visible string is shorter than the full title, or the box itself is clipped. */
export function plainTitleTruncated(el: HTMLElement): boolean {
	const full = (el.dataset.full || el.dataset.rvTip || '').replace(/\s+/g, ' ').trim();
	const shown = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (full && shown && shown !== full) return true;
	return el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
}

let titleTooltipDismiss: (() => void) | null = null;

function hideShownTooltip(doc: Document): void {
	doc.querySelectorAll('.tooltip, .rv-title-popover').forEach((node) => node.remove());
}

function tooltipContent(anchor: HTMLElement, text: string): string | DocumentFragment {
	if (!text.includes('\n')) return text;
	const block = anchor.ownerDocument.createElement('div');
	block.style.whiteSpace = 'pre-line';
	block.textContent = text;
	const frag = anchor.ownerDocument.createDocumentFragment();
	frag.append(block);
	return frag;
}

/**
 * Same Obsidian tooltip the visit buttons use. A later tap or a scroll
 * removes it. The opening tap does not, so the readout can stay up.
 */
function armTitleTooltipDismiss(anchor: HTMLElement): void {
	titleTooltipDismiss?.();
	const doc = anchor.ownerDocument;
	const view = doc.defaultView ?? window;
	const close = (event: Event): void => {
		if (event.type === 'pointerdown') {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (anchor.contains(target)) return;
			const tip = target instanceof Element ? target.closest('.tooltip') : null;
			if (tip) return;
		}
		hideShownTooltip(doc);
		stop();
	};
	const stop = (): void => {
		doc.removeEventListener('pointerdown', close, true);
		doc.removeEventListener('scroll', close, true);
		view.removeEventListener('scroll', close, true);
		if (titleTooltipDismiss === stop) titleTooltipDismiss = null;
	};
	titleTooltipDismiss = stop;
	view.setTimeout(() => {
		if (titleTooltipDismiss !== stop) return;
		doc.addEventListener('pointerdown', close, true);
		doc.addEventListener('scroll', close, true);
		view.addEventListener('scroll', close, true);
	}, 0);
}

/** Plain title readout. Phone taps and desktop clicks both use displayTooltip. */
export function showTitlePopover(anchor: HTMLElement, text: string): void {
	const full = text.replace(/\s+/g, ' ').trim();
	const doc = anchor.ownerDocument;
	if (!full || !doc || typeof doc.querySelectorAll !== 'function') return;
	doc.querySelectorAll('.rv-title-popover').forEach((node) => node.remove());
	displayTooltip(anchor, tooltipContent(anchor, full), { placement: 'top' });
	armTitleTooltipDismiss(anchor);
}
