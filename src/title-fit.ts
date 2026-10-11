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

/**
 * Each title keeps at least `minKeep` characters. The longest stem gives way
 * first until the row fits the character budget.
 */
export function fairCuts(lengths: readonly number[], budget: number, minKeep = 5): number[] {
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
	let fixed = pad + Math.max(0, items.length - 1) * (Number.isFinite(rowGap) ? rowGap : 8);
	const stems = items.map((item) => {
		const host = item.closest('.rv-item');
		const icon = host?.querySelector('.rv-item-icon');
		const suffix = item.querySelector('.rv-type');
		const iconWidth = icon instanceof HTMLElement ? icon.offsetWidth : 0;
		const suffixWidth = suffix instanceof HTMLElement ? suffix.offsetWidth : 0;
		fixed += iconWidth + suffixWidth + (iconWidth > 0 ? 4 : 0);
		return item.getAttribute('data-stem') ?? '';
	});
	const budgetPx = Math.max(0, width - fixed);
	const sample = stems[0] ?? 'M';
	const probe = row.ownerDocument.createElement('span');
	probe.className = 'rv-fit-probe';
	probe.textContent = sample.slice(0, 1) || 'M';
	row.appendChild(probe);
	const charPx = Math.max(1, probe.offsetWidth);
	probe.remove();
	const budget = Math.floor(budgetPx / charPx);
	const cuts = fairCuts(stems.map((stem) => stem.length), budget, 5);
	items.forEach((item, index) => {
		const stem = item.querySelector('.rv-fit-stem');
		const text = item.getAttribute('data-stem') ?? '';
		if (stem) stem.textContent = ellipsize(text, cuts[index] ?? text.length);
	});
	let guard = 0;
	while (row.scrollWidth > row.clientWidth + 1 && guard < 400) {
		guard += 1;
		let longest = 0;
		let longestLen = 0;
		items.forEach((item, index) => {
			const stem = item.querySelector('.rv-fit-stem');
			const len = (stem?.textContent ?? '').replace(/…$/, '').length;
			if (len > longestLen) {
				longestLen = len;
				longest = index;
			}
		});
		if (longestLen <= 1) break;
		const item = items[longest];
		const stem = item?.querySelector('.rv-fit-stem');
		const text = item?.getAttribute('data-stem') ?? '';
		if (stem) stem.textContent = ellipsize(text, longestLen - 1);
	}
}

export function watchTitleRow(row: HTMLElement): void {
	fitTitleRow(row);
	if (row.clientWidth <= 0 && typeof requestAnimationFrame === 'function') {
		requestAnimationFrame(() => fitTitleRow(row));
	}
	if (row.dataset.rvFit === '1' || typeof ResizeObserver === 'undefined') return;
	row.dataset.rvFit = '1';
	try {
		const observer = new ResizeObserver(() => fitTitleRow(row));
		observer.observe(row);
	} catch {
		/* Not a browser node. */
	}
}

function showTitlePopover(anchor: HTMLElement, text: string): void {
	const doc = anchor.ownerDocument;
	doc.querySelectorAll('.rv-title-popover').forEach((node) => node.remove());
	const pop = doc.createElement('div');
	pop.className = 'rv-title-popover';
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
