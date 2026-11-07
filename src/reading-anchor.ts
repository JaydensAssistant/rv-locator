const SPACER = 'rv-reading-anchor';

/**
 * The scroller whose height grows when the stacked note map closes.
 * `.view-content` is that grid row. A nested preview scroller is used when
 * that row itself has not moved.
 */
export function noteReadingScroller(content: HTMLElement): HTMLElement | null {
	const view = content.querySelector(':scope > .view-content');
	if (!(view instanceof HTMLElement)) return null;
	if (view.scrollTop > 0) return view;
	const inner = view.querySelector('.markdown-preview-view, .markdown-reading-view, .cm-scroller');
	if (inner instanceof HTMLElement && inner.scrollTop > 0) return inner;
	return view;
}

/**
 * Remember the line at the top of `scroller`. Calling the result puts that
 * same line back. When the grown viewport would clamp `scrollTop`, a spacer
 * keeps the old offset legal. It does not focus or scroll a notes box.
 */
export function keepReadingPlace(scroller: HTMLElement): () => void {
	const top = scroller.scrollTop;
	return () => applyReadingPlace(scroller, top);
}

export function applyReadingPlace(scroller: HTMLElement, top: number): void {
	const existing = scroller.querySelector(':scope > .rv-reading-anchor');
	const extra = existing instanceof HTMLElement ? spacerPx(existing) : 0;
	const natural = Math.max(0, scroller.scrollHeight - extra - scroller.clientHeight);
	if (top > natural + 0.5) {
		const spacer = existing instanceof HTMLElement ? existing : scroller.ownerDocument.createElement('div');
		spacer.className = SPACER;
		spacer.setAttribute('aria-hidden', 'true');
		const height = `${Math.ceil(top - natural)}px`;
		if (spacer.style.height !== height) spacer.style.height = height;
		if (!spacer.isConnected) scroller.appendChild(spacer);
	} else if (existing instanceof HTMLElement) {
		existing.remove();
	}
	if (scroller.scrollTop !== top) scroller.scrollTop = top;
}

function spacerPx(el: HTMLElement): number {
	if (el.offsetHeight > 0) return el.offsetHeight;
	const parsed = parseFloat(el.style.height);
	return Number.isFinite(parsed) ? parsed : 0;
}
