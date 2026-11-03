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
 * Obsidian's markdown view builds reading mode and live preview together.
 * The mode that is not showing is hidden with `display: none` (`Element.hide`).
 * Its `.bases-embed` stays in the document at 0×0. That is the ghost.
 */
export function hostIsHidden(node: HTMLElement): boolean {
	let current: HTMLElement | null = node;
	while (current) {
		if (current.style?.display === 'none') return true;
		if (current.classList?.contains('is-hidden')) return true;
		if (typeof current.hasAttribute === 'function' && current.hasAttribute('hidden')) return true;
		const parent: HTMLElement | null = current.parentElement;
		if (!parent || parent === current) break;
		current = parent;
	}
	const mode = node.closest?.('.markdown-source-view, .markdown-reading-view, .markdown-preview-view');
	if (!isElement(mode)) return false;
	const view = mode.ownerDocument?.defaultView;
	if (view && typeof view.getComputedStyle === 'function') {
		try {
			if (view.getComputedStyle(mode).display === 'none') return true;
		} catch {
			// A detached node has nothing to measure.
		}
	}
	return false;
}

/** A card inside a hidden or not-yet-laid-out embed is not the hub frame. */
function embedPaints(node: HTMLElement): boolean {
	const embed = node.closest?.('.bases-embed, .block-language-base');
	if (!isElement(embed)) return true;
	if (hostIsHidden(embed)) return false;
	const rect = embed.getBoundingClientRect();
	return rect.width >= 2 || rect.height >= 2;
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
		if (!embedPaints(node)) continue;
		card = node;
		break;
	}
	const toolbars = leaf.querySelectorAll('.rv-locator-toolbar-actions');
	let toolbar: HTMLElement | null = null;
	for (let index = 0; index < toolbars.length; index += 1) {
		const node = toolbars[index];
		if (!isElement(node) || node.closest(`.${COVER_CLASS}`)) continue;
		if (!embedPaints(node)) continue;
		if (!node.querySelector('button') || layoutHeight(node) < 8) continue;
		toolbar = node;
		break;
	}
	if (!card || !toolbar) return false;
	if (!phone) return true;
	const glances = leaf.querySelectorAll('.rv-locator-glancable');
	let glance: HTMLElement | null = null;
	for (let index = 0; index < glances.length; index += 1) {
		const node = glances[index];
		if (!isElement(node) || node.closest(`.${COVER_CLASS}`)) continue;
		if (!embedPaints(node)) continue;
		glance = node;
		break;
	}
	if (!glance || !glance.classList.contains('is-stacked')) return false;
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

export interface HubCoverPaint {
	/** Title written onto the cloned header while the real leaf still says the old note. */
	title?: string;
	/**
	 * Paint the cached hub into `host` before the browser frames the swap.
	 * Return a disposer. No cards, or a throw, keeps the note clone instead of a blank frame.
	 */
	mount?: (host: HTMLElement) => (() => void) | void;
}

function snapshotReady(host: HTMLElement): boolean {
	return host.querySelector('.rv-locator-card') != null
		&& host.querySelector('.rv-locator-toolbar-actions button') != null;
}

function clonedHeader(leaf: HTMLElement, doc: Document, title: string | undefined): HTMLElement {
	const headers = leaf.querySelectorAll('.view-header');
	let source: HTMLElement | null = null;
	for (let index = 0; index < headers.length; index += 1) {
		const header = headers[index];
		if (!isElement(header) || header.closest(`.${COVER_CLASS}`)) continue;
		source = header;
		break;
	}
	const header = source ? source.cloneNode(true) as HTMLElement : doc.createElement('div');
	if (!source) header.className = 'view-header';
	if (!title) return header;
	const titles = header.querySelectorAll('.view-header-title');
	const first = titles[0];
	if (isElement(first)) {
		first.textContent = title;
		return header;
	}
	const el = doc.createElement('div');
	el.className = 'view-header-title';
	el.textContent = title;
	header.append(el);
	return header;
}

/**
 * Cover the leaf the moment the hub is requested. When `mount` paints cards,
 * the cover is the cached hub, so the phone never sits on the old note. The
 * note clone remains the fallback when that paint has nothing to show.
 */
export function holdLeafForHubPaint(leafEl: HTMLElement | null | undefined, options?: HubCoverPaint): void {
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
	if (body.classList.contains('rv-hide-mobile-nav')) body.dataset.rvHubNavHeld = '1';
	body.classList.add(SWAP_CLASS, 'rv-hide-mobile-nav');
	const phone = body.classList.contains('is-phone') || body.classList.contains('is-mobile');
	const started = view?.performance?.now() ?? Date.now();
	let stopped = false;
	let dispose: (() => void) | void = undefined;
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
		try {
			dispose?.();
		} catch {
			// The snapshot view is leaving with the cover.
		}
		dispose = undefined;
		releaseHubSwapCover(doc, keepNav);
	};
	const observer = new MutationObserver(() => {
		if (stopped) return;
		if (!cover.isConnected) {
			stop(body.classList.contains('rv-hide-mobile-nav'));
			return;
		}
		const current = host();
		const elapsed = (view?.performance?.now() ?? Date.now()) - started;
		const decision = current ? hubSwapDecision(current, phone, elapsed) : 'drop';
		if (decision !== 'hold') {
			stop(decision === 'ready');
			return;
		}
		park();
	});
	const noteClone = leaf.cloneNode(true) as HTMLElement;
	noteClone.style.width = '100%';
	noteClone.style.height = '100%';
	noteClone.style.margin = '0';
	noteClone.style.pointerEvents = 'none';
	copyScroll(leaf, noteClone);
	park();
	let painted = false;
	if (options?.mount) {
		const header = clonedHeader(leaf, doc, options.title);
		const snapshot = doc.createElement('div');
		snapshot.className = 'rv-hub-snapshot-body';
		cover.append(header, snapshot);
		try {
			dispose = options.mount(snapshot);
			painted = snapshotReady(snapshot);
		} catch {
			painted = false;
		}
		if (!painted) {
			try {
				dispose?.();
			} catch {
				// A failed snapshot must not leave a half-built view behind the note.
			}
			dispose = undefined;
			cover.replaceChildren();
		}
	}
	if (!painted) cover.appendChild(noteClone);
	observer.observe(doc.body, { childList: true, subtree: true });
	const tick = (): void => {
		if (stopped) return;
		if (!cover.isConnected) {
			stop(body.classList.contains('rv-hide-mobile-nav'));
			return;
		}
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
