import { setIcon } from 'obsidian';

/**
 * Open a callout the way Obsidian's own title click does.
 * Removing only `is-collapsed` shows the body while the fold icon still says
 * closed, and the half-open callout then swallows scrolling.
 */
export function expandCallout(callout: HTMLElement): void {
	callout.classList.remove('is-collapsed');
	if (callout.hasAttribute('data-callout-fold') || callout.querySelector('.callout-fold')) {
		callout.setAttribute('data-callout-fold', '+');
	}
	const fold = callout.querySelector(':scope > .callout-title .callout-fold');
	if (fold instanceof HTMLElement) {
		fold.classList.remove('is-collapsed');
		setIcon(fold, 'chevron-down');
	}
	const content = callout.querySelector(':scope > .callout-content');
	if (!(content instanceof HTMLElement)) return;
	content.hidden = false;
	if (content.style.display === 'none') content.style.removeProperty('display');
	content.style.removeProperty('height');
	content.style.removeProperty('max-height');
	content.style.removeProperty('overflow');
	content.style.removeProperty('visibility');
}

/** Open every collapsed callout and heading between `target` and `root`. */
export function expandFoldedHost(target: HTMLElement, root: HTMLElement): void {
	let node: HTMLElement | null = target;
	while (node && node !== root) {
		if (node.classList.contains('callout')) expandCallout(node);
		node.classList.remove('is-collapsed');
		if (node.style.display === 'none') node.style.removeProperty('display');
		node = node.parentElement;
	}
}

/**
 * Move the note scroller, not a nested `overflow: auto` callout.
 * `scrollIntoView` walks every scrollport and can leave the wheel stuck
 * inside a callout that was only half opened.
 */
export function scrollPreviewTarget(target: HTMLElement): void {
	const scroller = target.closest('.markdown-preview-view, .markdown-reading-view, .cm-scroller');
	if (!(scroller instanceof HTMLElement) || typeof scroller.getBoundingClientRect !== 'function') {
		target.scrollIntoView?.({ block: 'center' });
		return;
	}
	const scrollerRect = scroller.getBoundingClientRect();
	const targetRect = target.getBoundingClientRect();
	const delta = targetRect.top - scrollerRect.top - (scrollerRect.height - targetRect.height) / 2;
	if (typeof scroller.scrollBy === 'function') scroller.scrollBy({ top: delta });
	else scroller.scrollTop += delta;
}
