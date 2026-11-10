/**
 * The last painted hub or base list, kept off the leaf the way the map shell is.
 * Obsidian empties `.view-content` before the next bases view exists. The node
 * stays here, and the next open puts it back before the browser paints.
 */

const HOLD_CLASS = 'rv-card-hold';

let parkedScroll: HTMLElement | null = null;

function isElement(node: unknown): node is HTMLElement {
	if (!node || typeof node !== 'object') return false;
	const el = node as HTMLElement;
	return typeof el.querySelector === 'function' && typeof el.appendChild === 'function';
}

function hasCards(node: HTMLElement | null | undefined): node is HTMLElement {
	return isElement(node) && node.querySelector('.rv-locator-card') != null;
}

function hidden(node: HTMLElement): boolean {
	let current: HTMLElement | null = node;
	while (current) {
		if (current.style?.display === 'none') return true;
		if (current.classList?.contains('is-hidden') === true) return true;
		if (typeof current.hasAttribute === 'function' && current.hasAttribute('hidden')) return true;
		const parent: HTMLElement | null = current.parentElement;
		if (!parent || parent === current) break;
		current = parent;
	}
	return false;
}

function ensureHold(doc: Document): HTMLElement {
	const found = doc.querySelector(`:scope > body > .${HOLD_CLASS}, body > .${HOLD_CLASS}`);
	if (isElement(found)) return found;
	const hold = doc.createElement('div');
	hold.className = HOLD_CLASS;
	hold.setAttribute('aria-hidden', 'true');
	hold.style.position = 'absolute';
	hold.style.width = '0';
	hold.style.height = '0';
	hold.style.overflow = 'hidden';
	hold.style.pointerEvents = 'none';
	(doc.body ?? doc.documentElement).appendChild(hold);
	return hold;
}

/** Remember this list and take it out of the leaf that is about to be emptied. */
export function parkCardList(scroll: HTMLElement | null | undefined): void {
	if (!hasCards(scroll)) return;
	if (typeof scroll.closest === 'function' && scroll.closest('.rv-hub-swap-cover')) return;
	parkedScroll = scroll;
	const doc = scroll.ownerDocument;
	if (!doc || typeof doc.createElement !== 'function') return;
	const hold = ensureHold(doc);
	if (scroll.parentElement !== hold) hold.appendChild(scroll);
}

/** The visible list, if one is on screen. A cover snapshot is not the list. */
export function parkVisibleCardList(doc: Document | null | undefined): void {
	if (!doc || typeof doc.querySelectorAll !== 'function') return;
	if (hasCards(parkedScroll) && parkedScroll.ownerDocument === doc) {
		parkCardList(parkedScroll);
		return;
	}
	const nodes = doc.querySelectorAll('.rv-locator-scroll');
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!isElement(node) || !hasCards(node)) continue;
		if (typeof node.closest === 'function' && node.closest('.rv-hub-swap-cover, .rv-card-hold')) continue;
		if (hidden(node)) continue;
		parkCardList(node);
		return;
	}
}

/**
 * Put the parked list into this view before paint. A view that already has
 * cards is left alone. Returns false when there is nothing to put back.
 */
export function seedCardList(content: HTMLElement | null | undefined): boolean {
	if (!isElement(content)) return false;
	if (content.querySelector('.rv-locator-card')) return false;
	const scroll = hasCards(parkedScroll) ? parkedScroll : null;
	if (!scroll) return false;
	if (typeof scroll.closest === 'function' && scroll.closest('.rv-locator-glancable') && content.contains(scroll)) return false;
	content.appendChild(scroll);
	return true;
}

/**
 * The list the new view should adopt. A list already inside a live glancable
 * belongs to that view.
 */
export function claimCardList(doc: Document | null | undefined): HTMLElement | null {
	const scroll = hasCards(parkedScroll) ? parkedScroll : null;
	if (!scroll) return null;
	if (doc && scroll.ownerDocument && scroll.ownerDocument !== doc) return null;
	const glance = typeof scroll.closest === 'function' ? scroll.closest('.rv-locator-glancable') : null;
	if (isElement(glance) && glance.isConnected) return null;
	return scroll;
}

/** The live view owns the list now. A later empty must not pull it back out. */
export function releaseParkedCardList(): void {
	const scroll = parkedScroll;
	if (!isElement(scroll)) {
		parkedScroll = null;
		return;
	}
	if (typeof scroll.closest === 'function' && scroll.closest('.rv-locator-glancable')) parkedScroll = null;
}

/** Drop a parked list that is no longer the truth. A list on screen stays. */
export function dropParkedCardList(): void {
	const scroll = parkedScroll;
	parkedScroll = null;
	if (!isElement(scroll)) return;
	if (typeof scroll.closest === 'function' && scroll.closest('.rv-card-hold')) scroll.remove();
}

/**
 * While a hub or base open is in progress, an emptied view-content gets the
 * parked list back in the same mutation turn, which is before the next paint.
 */
export function watchCardHold(
	doc: Document,
	armed: () => boolean,
	release: () => void,
): () => void {
	if (typeof doc.defaultView?.MutationObserver !== 'function' && typeof MutationObserver !== 'function') {
		return () => {};
	}
	const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
	const observer = new Observer(() => {
		if (!armed()) return;
		const leaf = doc.querySelector('.workspace-leaf.mod-active') ?? doc.querySelector('.workspace-leaf');
		if (!isElement(leaf)) return;
		const contents = leaf.querySelectorAll('.view-content');
		for (let index = 0; index < contents.length; index += 1) {
			const content = contents[index];
			if (!isElement(content) || hidden(content)) continue;
			if (content.querySelector('.rv-locator-glancable .rv-locator-card')) {
				release();
				return;
			}
			if (content.querySelector('.rv-locator-card')) return;
			if (seedCardList(content)) return;
		}
	});
	const root = doc.body ?? doc.documentElement;
	if (!root) return () => { observer.disconnect(); };
	observer.observe(root, { childList: true, subtree: true });
	return () => { observer.disconnect(); };
}
