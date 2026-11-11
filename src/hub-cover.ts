import { landingScrollExact } from './hub-layout';
import { isRvHubNote } from './rv-note-view';

/** How long the previous leaf may cover a hub swap before we give up. */
export const HUB_SWAP_HOLD_MS = 800;

const COVER_CLASS = 'rv-hub-swap-cover';
const SWAP_CLASS = 'rv-hub-swapping';
const COVER_HELD = 'is-rv-cover-held';

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
 * A box the layout engine actually measured as empty. JSDOM reports 0 for
 * every element, including one that is showing, so a page with no box of its
 * own does not count unless this node stubs its own empty rect.
 */
function measuredEmpty(node: HTMLElement): boolean {
	if (typeof node.getBoundingClientRect !== 'function') return false;
	let rect: { width: number; height: number };
	try { rect = node.getBoundingClientRect(); } catch { return false; }
	if (rect.width > 0 || rect.height > 0) return false;
	const page = node.ownerDocument?.documentElement;
	if (!page || page === node || typeof page.getBoundingClientRect !== 'function') return true;
	let pageRect: { width: number; height: number };
	try { pageRect = page.getBoundingClientRect(); } catch { return true; }
	if (pageRect.width > 0 || pageRect.height > 0) return true;
	return Object.prototype.hasOwnProperty.call(node, 'getBoundingClientRect');
}

function computedDisplayNone(node: HTMLElement): boolean {
	const view = node.ownerDocument?.defaultView;
	if (!view || typeof view.getComputedStyle !== 'function') return false;
	try {
		return view.getComputedStyle(node).display === 'none';
	} catch {
		return false;
	}
}

/**
 * Obsidian's markdown view builds reading mode and live preview together.
 * The mode that is not showing is hidden with `display: none` (`Element.hide`).
 * Its `.bases-embed` stays in the document at 0×0. A view that was removed
 * and never unloaded is detached, also 0×0. Both are the ghost.
 */
export function hostIsHidden(node: HTMLElement): boolean {
	if (!node) return true;
	if (node.isConnected === false) return true;
	let current: HTMLElement | null = node;
	while (current) {
		if (current.style?.display === 'none') return true;
		if (current.classList?.contains('is-hidden')) return true;
		if (typeof current.hasAttribute === 'function' && current.hasAttribute('hidden')) return true;
		const parent: HTMLElement | null = current.parentElement;
		if (!parent || parent === current) break;
		current = parent;
	}
	if (measuredEmpty(node)) return true;
	const mode = node.closest?.('.markdown-source-view, .markdown-reading-view, .markdown-preview-view');
	if (!isElement(mode)) return false;
	return computedDisplayNone(mode);
}

/**
 * The note on screen. A tab that is not the active leaf in its group is hidden,
 * and a `display: none` ancestor is hidden. Work for those waits until they show.
 */
export function noteSurfaceShown(node: HTMLElement): boolean {
	if (!node.isConnected) return false;
	if (hostIsHidden(node)) return false;
	const leaf = node.closest?.('.workspace-leaf');
	if (!isElement(leaf)) return true;
	const tabs = leaf.parentElement;
	if (tabs && (tabs.classList.contains('workspace-tab-container') || tabs.classList.contains('workspace-tabs'))) {
		return leaf.classList.contains('mod-active');
	}
	const view = node.ownerDocument?.defaultView;
	if (view && typeof view.getComputedStyle === 'function') {
		try {
			if (view.getComputedStyle(leaf).display === 'none') return false;
		} catch {
			return false;
		}
	}
	return true;
}

/**
 * Where hub layout classes may stop. A cached snapshot stops at its cover.
 * A real hub stops at its embed, or at the leaf when it is not embedded.
 * No recognized boundary means the classes must not walk upward.
 */
export function hubFillBoundary(root: HTMLElement): HTMLElement | null {
	if (typeof root.closest !== 'function') return null;
	const cover = root.closest('.rv-hub-swap-cover');
	if (isElement(cover)) return cover;
	const embed = root.closest('.bases-embed, .block-language-base, .internal-embed, .markdown-embed');
	if (isElement(embed)) return embed;
	const leaf = root.closest('.workspace-leaf-content');
	return isElement(leaf) ? leaf : null;
}

/**
 * The leaf is about to show a note. Strip the fill that forces a hidden
 * markdown mode back on, and hide our list so the note's first frame cannot
 * show hub cards. The nodes stay put until Obsidian detaches the view.
 */
export function concealHubList(root: ParentNode | null | undefined): void {
	if (!root || typeof root.querySelectorAll !== 'function') return;
	root.querySelectorAll('.rv-hub-fill').forEach((node) => {
		if (node instanceof HTMLElement) node.classList.remove('rv-hub-fill');
	});
	root.querySelectorAll('.rv-locator-glancable').forEach((node) => {
		if (node instanceof HTMLElement) node.setAttribute('hidden', '');
	});
}

/** Mark ancestors up to the boundary. A missing boundary marks nothing. */
export function markHubFill(root: HTMLElement, marked: HTMLElement[]): void {
	const stop = hubFillBoundary(root);
	if (!stop) return;
	let node: HTMLElement | null = root.parentElement;
	while (node) {
		if (node !== stop && !stop.contains(node)) break;
		node.classList.add('rv-hub-fill');
		marked.push(node);
		if (node === stop) break;
		node = node.parentElement;
	}
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
function windowBarShell(leaf: HTMLElement): HTMLElement | null {
	const doc = leaf.ownerDocument;
	if (!doc || typeof doc.querySelectorAll !== 'function') return null;
	const bars = doc.querySelectorAll('.rv-bar-shell');
	for (let index = 0; index < bars.length; index += 1) {
		const bar = bars[index];
		if (!isElement(bar) || bar.closest(`.${COVER_CLASS}`)) continue;
		if (layoutHeight(bar) < 8) continue;
		return bar;
	}
	return null;
}

function coverLandTarget(leaf: HTMLElement): HTMLElement | null {
	const cards = leaf.querySelectorAll(`.${COVER_CLASS} .rv-locator-card.rv-card-land`);
	for (let index = 0; index < cards.length; index += 1) {
		const card = cards[index];
		if (isElement(card) && card.getAttribute('data-rv-path')) return card;
	}
	return null;
}

function liveCardFor(leaf: HTMLElement, path: string): HTMLElement | null {
	const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(path) : path.replace(/"/g, '\\"');
	const cards = leaf.querySelectorAll(`[data-rv-path="${escaped}"]`);
	for (let index = 0; index < cards.length; index += 1) {
		const node = cards[index];
		if (!isElement(node) || node.closest(`.${COVER_CLASS}`)) continue;
		if (!embedPaints(node)) continue;
		return node;
	}
	return null;
}

export function hubFrameReady(leaf: HTMLElement, phone: boolean): boolean {
	if (/^no file$/i.test(headerTitle(leaf))) return false;
	const land = coverLandTarget(leaf);
	if (land) {
		const live = liveCardFor(leaf, land.getAttribute('data-rv-path') ?? '');
		if (!live || live.classList.contains('is-stub')) return false;
		const scrolled = live.closest('.rv-locator-scroll');
		if (!isElement(scrolled)) return false;
		if (!landingScrollExact(scrolled, live, land.getBoundingClientRect().top).reaches) return false;
	}
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
	const shell = windowBarShell(leaf);
	if (!card || (!toolbar && !shell)) return false;
	if (!phone) return true;
	if (shell) return true;
	const glances = leaf.querySelectorAll('.rv-locator-glancable');
	let glance: HTMLElement | null = null;
	for (let index = 0; index < glances.length; index += 1) {
		const node = glances[index];
		if (!isElement(node) || node.closest(`.${COVER_CLASS}`)) continue;
		if (!embedPaints(node)) continue;
		glance = node;
		break;
	}
	if (!glance || !glance.classList.contains('is-stacked') || !toolbar) return false;
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

/**
 * Put the live card where the cover card already is, then remember that the
 * landing was applied. A cover with no tinted card is a direct hub open.
 */
export function handoffCoverLanding(doc: Document, onLand?: (path: string) => void): boolean {
	const cover = doc.querySelector(`.${COVER_CLASS}`);
	if (!isElement(cover)) return false;
	const coverCard = cover.querySelector('.rv-locator-card.rv-card-land');
	if (!isElement(coverCard)) return false;
	const path = coverCard.getAttribute('data-rv-path');
	if (!path) return false;
	const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(path) : path.replace(/"/g, '\\"');
	const cards = doc.querySelectorAll(`[data-rv-path="${escaped}"]`);
	let live: HTMLElement | null = null;
	for (let index = 0; index < cards.length; index += 1) {
		const node = cards[index];
		if (isElement(node) && !cover.contains(node)) {
			live = node;
			break;
		}
	}
	if (!live) return false;
	const scrolled = live.closest('.rv-locator-scroll');
	if (!isElement(scrolled)) return false;
	const desired = coverCard.getBoundingClientRect().top;
	const plan = landingScrollExact(scrolled, live, desired);
	if (!plan.reaches) return false;
	scrolled.scrollTop = plan.scroll;
	if (!live.classList.contains('rv-card-land')) {
		const started = Number(coverCard.dataset.rvLandAt);
		const elapsed = Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0;
		if (elapsed > 0) live.style.setProperty('--rv-land-delay', `-${elapsed}ms`);
		live.dataset.rvLandAt = coverCard.dataset.rvLandAt || String(Date.now());
		live.classList.add('rv-card-land');
		if (live.dataset.rvLandTimer !== '1') {
			live.dataset.rvLandTimer = '1';
			const left = Math.max(0, 2000 - elapsed);
			doc.defaultView?.setTimeout(() => {
				live?.classList.remove('rv-card-land');
				live?.style.removeProperty('--rv-land-delay');
			}, left);
		}
	}
	onLand?.(path);
	return true;
}

/**
 * Card tops come from the shared header band and `--rv-hub-top`. A translate
 * on the snapshot would leave a residual once those already match.
 */
export function alignHubCover(doc: Document): void {
	const cover = doc.querySelector(`.${COVER_CLASS}`);
	if (!isElement(cover)) return;
	const body = cover.querySelector('.rv-hub-snapshot-body');
	if (!isElement(body)) return;
	body.style.removeProperty('transform');
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
	const held = doc.querySelectorAll(`.${COVER_HELD}`);
	for (let index = held.length - 1; index >= 0; index -= 1) held[index]?.classList.remove(COVER_HELD);
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
	/** The live card now sits where the cover had it. Clear the one-shot arrival. */
	onLand?: (path: string) => void;
	/** Move a map out of the cover before the cover node is removed. */
	beforeRelease?: () => void;
	/** A card on the cover. The live list may not have links yet. */
	openCard?: (path: string) => void;
}

function snapshotReady(host: HTMLElement): boolean {
	return host.querySelector('.rv-locator-card') != null
		&& host.querySelector('.rv-locator-toolbar-actions button, .rv-app-slot, .rv-bar-spacer, .rv-locator-sortbar') != null;
}

const COVER_CRUMB = '.view-header-title-parent, .view-header-breadcrumb, .view-header-breadcrumb-container';

function isBookmarkAction(node: HTMLElement): boolean {
	const label = `${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('aria-label-resolved') ?? ''}`;
	if (/bookmark/i.test(label)) return true;
	const icons = node.querySelectorAll('svg');
	for (let index = 0; index < icons.length; index += 1) {
		const icon = icons[index];
		if (!isElement(icon)) continue;
		if (/lucide-bookmark|bookmark-check|bookmark-minus/i.test(icon.getAttribute('class') ?? '')) return true;
	}
	return false;
}

/**
 * The cover is built from the note that was open. Its header still has that
 * note's folder crumb and bookmark. The settled hub header is the centered
 * title plus edit and more, with no folder name.
 */
export function fitHubCoverHeader(header: HTMLElement): void {
	const containers = header.querySelectorAll('.view-header-title-container');
	const hosts: HTMLElement[] = [];
	if (containers.length === 0) hosts.push(header);
	for (let index = 0; index < containers.length; index += 1) {
		const container = containers[index];
		if (isElement(container)) hosts.push(container);
	}
	for (const host of hosts) {
		const kids = Array.from(host.childNodes);
		for (const kid of kids) {
			if (isElement(kid)) {
				if (kid.classList.contains('view-header-title') || kid.classList.contains('view-header-icon')) continue;
				if (kid.querySelector('.view-header-title')) continue;
				if (kid.matches(COVER_CRUMB) || isBookmarkAction(kid)) kid.remove();
				continue;
			}
			if (kid.nodeType === 3 && (kid.textContent ?? '').trim()) kid.remove();
		}
	}
	const crumbs = header.querySelectorAll(COVER_CRUMB);
	for (let index = 0; index < crumbs.length; index += 1) {
		const crumb = crumbs[index];
		if (!isElement(crumb) || crumb.querySelector('.view-header-title')) continue;
		crumb.remove();
	}
	const actions = header.querySelectorAll('.view-action');
	for (let index = 0; index < actions.length; index += 1) {
		const action = actions[index];
		if (isElement(action) && isBookmarkAction(action)) action.remove();
	}
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
	if (title) {
		const titles = header.querySelectorAll('.view-header-title');
		const first = titles[0];
		if (isElement(first)) first.textContent = title;
		else {
			const el = doc.createElement('div');
			el.className = 'view-header-title';
			el.textContent = title;
			header.append(el);
		}
	}
	fitHubCoverHeader(header);
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
	const markHeld = (current: HTMLElement): void => {
		const leaves = doc.querySelectorAll(`.${COVER_HELD}`);
		for (let index = 0; index < leaves.length; index += 1) {
			const leaf = leaves[index];
			if (leaf !== current) leaf?.classList.remove(COVER_HELD);
		}
		current.classList.add(COVER_HELD);
	};
	const park = (): void => {
		const current = host();
		if (!current) return;
		if (cover.parentElement !== current) current.prepend(cover);
		markHeld(current);
	};
	const stop = (keepNav: boolean): void => {
		if (stopped) return;
		stopped = true;
		observer.disconnect();
		try {
			handoffCoverLanding(doc, options?.onLand);
		} catch {
			// A missing live card still has to drop the cover.
		}
		try {
			dispose?.();
		} catch {
			// The snapshot view is leaving with the cover.
		}
		dispose = undefined;
		// Drop the hold before the map moves. The live stage is then visible
		// in this same turn, so the stage never sits under opacity 0.
		releaseHubSwapCover(doc, keepNav);
		try {
			options?.beforeRelease?.();
		} catch {
			// The cover is already gone if the map handoff throws.
		}
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
	cover.appendChild(noteClone);
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
			header.remove();
			snapshot.remove();
		} else noteClone.remove();
	}
	cover.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		const target = event.target;
		let card = target instanceof Element ? target.closest('.rv-locator-card') : null;
		if (!(card instanceof HTMLElement) || !cover.contains(card)) {
			const point = event as MouseEvent;
			const hit = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(point.clientX, point.clientY) : null;
			card = hit instanceof Element ? hit.closest('.rv-locator-card') : null;
		}
		if (!(card instanceof HTMLElement) || !cover.contains(card)) return;
		const path = card.getAttribute('data-rv-path') || '';
		if (path) options?.openCard?.(path);
	}, true);
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
			try { alignHubCover(doc); } catch { /* The live list is not laid out yet. */ }
			if (typeof view?.requestAnimationFrame === 'function') view.requestAnimationFrame(tick);
			return;
		}
		stop(decision === 'ready');
	};
	if (typeof view?.requestAnimationFrame === 'function') view.requestAnimationFrame(tick);
	else tick();
}

const NEW_RV_COVER = 'rv-new-rv-cover';

/** Cover the workspace until the new note's dashboard is on screen. */
export function mountNewRvCover(doc: Document): () => void {
	const body = doc.body;
	if (!body) return () => {};
	const existing = doc.querySelector(`.${NEW_RV_COVER}`);
	if (existing) existing.remove();
	const cover = doc.createElement('div');
	cover.className = NEW_RV_COVER;
	cover.setAttribute('aria-hidden', 'true');
	body.appendChild(cover);
	let gone = false;
	return () => {
		if (gone) return;
		gone = true;
		cover.remove();
	};
}

/** Resolve once `root` contains the RV dashboard, or when the clock runs out. */
export function waitForDashboard(root: HTMLElement, ms = 4000): Promise<void> {
	const view = root.ownerDocument.defaultView;
	const start = Date.now();
	return new Promise((resolve) => {
		const tick = (): void => {
			if (root.querySelector('.rv-dashboard') || Date.now() - start >= ms) {
				resolve();
				return;
			}
			if (view?.requestAnimationFrame) view.requestAnimationFrame(tick);
			else setTimeout(tick, 16);
		};
		tick();
	});
}
