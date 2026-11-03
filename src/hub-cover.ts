import { isRvHubNote } from './rv-note-view';

/** How long the previous leaf may cover a hub swap before we give up. */
export const HUB_SWAP_HOLD_MS = 800;

const COVER_CLASS = 'rv-hub-swap-cover';
const SWAP_CLASS = 'rv-hub-swapping';

/**
 * A direct `.base` open, or the hub note (`cssclass` `rv-locator-full-base`).
 * An RV dashboard note is not a hub swap.
 */
export function isHubSwapFile(
	extension: string | undefined,
	frontmatter: Record<string, unknown> | null | undefined,
): boolean {
	if ((extension ?? '').toLowerCase() === 'base') return true;
	return isRvHubNote(frontmatter);
}

function isElement(node: unknown): node is HTMLElement {
	if (!node || typeof node !== 'object') return false;
	const el = node as HTMLElement;
	return typeof el.getBoundingClientRect === 'function' && typeof el.querySelector === 'function';
}

function headerTitle(leaf: HTMLElement): string {
	const titles = leaf.querySelectorAll('.view-header-title');
	for (let index = 0; index < titles.length; index += 1) {
		const title = titles[index];
		if (!isElement(title) || title.closest(`.${COVER_CLASS}`)) continue;
		return (title.textContent ?? '').replace(/\s+/g, ' ').trim();
	}
	return '';
}

function layoutHeight(el: HTMLElement): number {
	const rect = el.getBoundingClientRect();
	if (rect.height > 0) return rect.height;
	return el.offsetHeight;
}

/**
 * The hub's first paint: cards, a laid-out plugin toolbar, and a header that
 * is no longer the empty "No file" bases frame. On a phone the toolbar has
 * to sit on the bottom of the leaf, which is where `is-stacked` puts it.
 */
export function hubFrameReady(leaf: HTMLElement, phone: boolean): boolean {
	if (/^no file$/i.test(headerTitle(leaf))) return false;
	const cards = leaf.querySelectorAll('.rv-locator-card');
	let card: HTMLElement | null = null;
	for (let index = 0; index < cards.length; index += 1) {
		const node = cards[index];
		if (!isElement(node) || node.closest(`.${COVER_CLASS}`)) continue;
		card = node;
		break;
	}
	const toolbars = leaf.querySelectorAll('.rv-locator-toolbar-actions');
	let toolbar: HTMLElement | null = null;
	for (let index = 0; index < toolbars.length; index += 1) {
		const node = toolbars[index];
		if (!isElement(node) || node.closest(`.${COVER_CLASS}`)) continue;
		if (!node.querySelector('button') || layoutHeight(node) < 8) continue;
		toolbar = node;
		break;
	}
	if (!card || !toolbar) return false;
	if (!phone) return true;
	const glance = leaf.querySelector('.rv-locator-glancable');
	if (!isElement(glance) || !glance.classList.contains('is-stacked')) return false;
	const sortbar = toolbar.closest('.rv-locator-sortbar');
	const dock = isElement(sortbar) ? sortbar : toolbar;
	const bar = dock.getBoundingClientRect();
	const host = leaf.getBoundingClientRect();
	if (host.height < 1 || bar.height < 1) return true;
	return host.bottom - bar.bottom <= 48;
}

export function hubSwapDecision(leaf: HTMLElement, phone: boolean, elapsedMs: number): 'hold' | 'ready' | 'drop' {
	if (!leaf.isConnected) return 'drop';
	if (hubFrameReady(leaf, phone)) return 'ready';
	if (elapsedMs >= HUB_SWAP_HOLD_MS) return 'drop';
	return 'hold';
}

function copyScroll(from: Element, to: Element): void {
	if (from.scrollTop || from.scrollLeft) {
		to.scrollTop = from.scrollTop;
		to.scrollLeft = from.scrollLeft;
	}
	const count = Math.min(from.childElementCount, to.childElementCount);
	for (let index = 0; index < count; index += 1) {
		const child = from.children[index];
		const copy = to.children[index];
		if (child && copy) copyScroll(child, copy);
	}
}

function coverMounted(doc: Document): boolean {
	return doc.querySelector(`.${COVER_CLASS}`) != null;
}

function leafWorthHolding(leaf: HTMLElement): boolean {
	const text = (leaf.textContent ?? '').replace(/\s+/g, ' ').trim();
	if (text.length < 2) return false;
	if (/^no file$/i.test(headerTitle(leaf)) && !leaf.querySelector('.rv-locator-card, .markdown-preview-view, .cm-content')) return false;
	return true;
}

/** Drop the cover. `keepNav` leaves the phone navbar hidden for a painted hub. */
export function releaseHubSwapCover(doc: Document, keepNav = false): void {
	const body = doc.body;
	if (!body) return;
	const covers = doc.querySelectorAll(`.${COVER_CLASS}`);
	for (let index = covers.length - 1; index >= 0; index -= 1) covers[index]?.remove();
	const swapping = body.classList.contains(SWAP_CLASS);
	body.classList.remove(SWAP_CLASS);
	if (!keepNav && swapping && body.dataset.rvHubNavHeld !== '1') body.classList.remove('rv-hide-mobile-nav');
	delete body.dataset.rvHubNavHeld;
}

/**
 * Keep the leaf's current pixels up until the hub's cards and toolbar are in
 * the DOM. Obsidian paints empty frames before the view factory; this cover
 * is what the phone shows instead of those frames.
 */
export function holdLeafForHubPaint(leafEl: HTMLElement | null | undefined): void {
	const climbed = leafEl?.closest?.('.workspace-leaf');
	const leaf = isElement(climbed) ? climbed : leafEl;
	if (!leaf || typeof leaf.cloneNode !== 'function' || typeof leaf.getBoundingClientRect !== 'function') return;
	if (!leafWorthHolding(leaf)) return;
	const doc = leaf.ownerDocument;
	const body = doc?.body;
	const view = doc?.defaultView;
	if (!doc || !body || coverMounted(doc)) return;
	const rect = leaf.getBoundingClientRect();
	if (rect.width < 2 || rect.height < 2) return;
	const cover = doc.createElement('div');
	cover.className = COVER_CLASS;
	cover.setAttribute('aria-hidden', 'true');
	const clone = leaf.cloneNode(true) as HTMLElement;
	clone.style.width = '100%';
	clone.style.height = '100%';
	clone.style.margin = '0';
	clone.style.pointerEvents = 'none';
	copyScroll(leaf, clone);
	cover.appendChild(clone);
	if (body.classList.contains('rv-hide-mobile-nav')) body.dataset.rvHubNavHeld = '1';
	body.classList.add(SWAP_CLASS, 'rv-hide-mobile-nav');
	const phone = body.classList.contains('is-phone') || body.classList.contains('is-mobile');
	const started = view?.performance?.now() ?? Date.now();
	let stopped = false;
	const host = (): HTMLElement | null => {
		if (leaf.isConnected) return leaf;
		const next = doc.querySelector('.workspace-leaf.mod-active');
		return isElement(next) ? next : null;
	};
	const park = (): void => {
		const current = host();
		if (!current || cover.parentElement === current) return;
		current.prepend(cover);
	};
	const stop = (keepNav: boolean): void => {
		if (stopped) return;
		stopped = true;
		observer.disconnect();
		releaseHubSwapCover(doc, keepNav);
	};
	const observer = new MutationObserver(() => {
		if (stopped) return;
		const current = host();
		const elapsed = (view?.performance?.now() ?? Date.now()) - started;
		const decision = current ? hubSwapDecision(current, phone, elapsed) : 'drop';
		if (decision !== 'hold') {
			stop(decision === 'ready');
			return;
		}
		park();
	});
	park();
	observer.observe(doc.body, { childList: true, subtree: true });
	const tick = (): void => {
		if (stopped) return;
		const current = host();
		const elapsed = (view?.performance?.now() ?? Date.now()) - started;
		const decision = current ? hubSwapDecision(current, phone, elapsed) : 'drop';
		if (decision === 'hold') {
			park();
			view?.requestAnimationFrame(tick);
			return;
		}
		stop(decision === 'ready');
	};
	if (view?.requestAnimationFrame) view.requestAnimationFrame(tick);
	else tick();
}
