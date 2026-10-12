import { splitTitleSuffix, stripTitleQuotes } from './catalog';

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

function ellipsize(text: string, keep: number): string {
	if (text.length <= keep) return text;
	const head = Math.max(1, keep);
	return `${text.slice(0, head)}…`;
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
	host.setAttribute('title', full);
	const stem = host.createSpan('rv-fit-stem');
	stem.textContent = parts.text;
	if (parts.suffix) host.createSpan({ cls: 'rv-type', text: paintedSuffix(parts.suffix) });
	host.addEventListener('click', (event) => {
		if (stem.textContent === parts.text) return;
		event.preventDefault();
		event.stopPropagation();
		showTitlePopover(host, full);
	});
	return host;
}

export function fitTitleRow(row: HTMLElement): void {
	const items = Array.from(row.querySelectorAll<HTMLElement>(':scope > .rv-item .rv-fit, :scope > .rv-fit'));
	if (items.length === 0) return;
	const width = row.clientWidth;
	if (width <= 0) return;
	const view = row.ownerDocument.defaultView;
	const rowStyle = view?.getComputedStyle(row);
	const pad = rowStyle ? (parseFloat(rowStyle.paddingLeft) || 0) + (parseFloat(rowStyle.paddingRight) || 0) : 0;
	const rowGap = rowStyle ? (parseFloat(rowStyle.columnGap) || parseFloat(rowStyle.gap) || 0) : 8;
	const gap = Number.isFinite(rowGap) ? rowGap : 8;
	const usable = Math.max(0, width - pad);
	const stems = items.map((item) => item.getAttribute('data-stem') ?? '');
	const floors = stems.map((stem, index) => stemFloorWidth(items[index] ?? row, stem));
	const lines = stripRowPlan(floors, usable, gap);
	applyStripSplit(row, lines === 2 ? evenSplitIndex(items.length) : 0);
	if (lines === 2) {
		const split = evenSplitIndex(items.length);
		paintTitleGroup(items.slice(0, split), stems.slice(0, split), usable, gap);
		paintTitleGroup(items.slice(split), stems.slice(split), usable, gap);
		return;
	}
	paintTitleGroup(items, stems, usable, gap);
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

function paintTitleGroup(items: readonly HTMLElement[], stems: readonly string[], width: number, gap: number): void {
	if (items.length === 0) return;
	let fixed = Math.max(0, items.length - 1) * gap;
	items.forEach((item) => {
		const host = item.closest('.rv-item');
		const icon = host?.querySelector('.rv-item-icon');
		const suffix = item.querySelector('.rv-type');
		const iconWidth = icon instanceof HTMLElement ? icon.offsetWidth : 0;
		const suffixWidth = suffix instanceof HTMLElement ? suffix.offsetWidth : 0;
		fixed += iconWidth + suffixWidth + (iconWidth > 0 ? 4 : 0);
	});
	const sample = stems[0] ?? 'M';
	const probe = items[0]?.ownerDocument.createElement('span');
	if (!probe || !items[0]) return;
	probe.className = 'rv-fit-probe';
	probe.textContent = sample.slice(0, 1) || 'M';
	items[0].appendChild(probe);
	const charPx = Math.max(1, probe.offsetWidth);
	probe.remove();
	const budget = Math.floor(Math.max(0, width - fixed) / charPx);
	const cuts = fairCuts(stems.map((stem) => stem.length), budget, MIN_TITLE_CHARS);
	items.forEach((item, index) => {
		const stem = item.querySelector('.rv-fit-stem');
		const text = stems[index] ?? '';
		const floor = Math.min(MIN_TITLE_CHARS, text.length);
		const keep = Math.max(floor, cuts[index] ?? text.length);
		if (stem) stem.textContent = ellipsize(text, keep);
	});
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

export function watchTitleRow(row: HTMLElement, refit?: () => void): void {
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
	try {
		const observer = new ResizeObserver(() => run());
		observer.observe(row);
	} catch {
		/* Not a browser node. */
	}
}

const LEADING_NUMBER = /^(\d+\s+)/;

/**
 * Closed catalog fields keep the leading number and the type suffix visible.
 * Focus shows the full value in the input.
 */
export function mountClosedTitle(
	input: HTMLElement,
	present: (value: string) => { text: string; suffix: string },
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
		if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) return input.value;
		return input.getAttribute('value') ?? '';
	};
	const paint = (): void => {
		const focused = input.ownerDocument.activeElement === input;
		const value = read().trim();
		if (focused || !value) {
			overlay.hidden = true;
			input.classList.remove('is-title-closed');
			return;
		}
		const parts = present(value);
		const lead = LEADING_NUMBER.exec(parts.text);
		const pre = lead?.[1] ?? '';
		const stem = pre ? parts.text.slice(pre.length) : parts.text;
		const suffix = parts.suffix.trim();
		overlay.replaceChildren();
		if (pre) overlay.append(closedSpan(input, 'rv-title-pre', pre));
		overlay.append(closedSpan(input, 'rv-title-text', stem));
		if (suffix) overlay.append(closedSpan(input, 'rv-title-suffix', ` ${suffix}`));
		overlay.hidden = false;
		overlay.title = suffix ? `${parts.text} ${suffix}` : parts.text;
		input.classList.add('is-title-closed');
	};
	input.addEventListener('focus', paint);
	input.addEventListener('blur', paint);
	input.addEventListener('input', paint);
	input.addEventListener('change', paint);
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
 * A box that already fits is left whole. Catalog titles use {@link fitMiddleEllipsis}.
 */
function slotWidth(el: HTMLElement): number {
	let width = el.clientWidth;
	const row = el.closest('.rv-hub-row');
	if (row instanceof HTMLElement && row.clientWidth > width) width = row.clientWidth;
	return width;
}

export function fitEndEllipsis(el: HTMLElement, full: string): void {
	const text = full.replace(/\s+/g, ' ').trim();
	el.dataset.full = text;
	el.title = text;
	const apply = (): void => {
		const source = (el.dataset.full || text).replace(/\s+/g, ' ').trim();
		el.textContent = source;
		const width = slotWidth(el);
		if (!source || width <= 8) return;
		const wrapped = el.scrollHeight > el.clientHeight + 4;
		if (el.scrollWidth <= width + 1 && !wrapped) return;
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
	el.title = text;
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

export function showTitlePopover(anchor: HTMLElement, text: string): void {
	const doc = anchor.ownerDocument;
	doc.querySelectorAll('.rv-title-popover').forEach((node) => node.remove());
	const pop = doc.createElement('div');
	pop.className = 'rv-title-popover';
	pop.style.whiteSpace = 'pre-line';
	pop.textContent = text;
	doc.body.appendChild(pop);
	const box = anchor.getBoundingClientRect();
	pop.style.left = `${box.left}px`;
	pop.style.top = `${box.bottom + 4}px`;
	const close = (): void => {
		pop.remove();
		doc.removeEventListener('pointerdown', close);
	};
	window.setTimeout(() => doc.addEventListener('pointerdown', close), 0);
}
