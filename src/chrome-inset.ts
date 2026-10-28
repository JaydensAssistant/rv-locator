/**
 * Bottom chrome the toast and the fullscreen map card must clear.
 * The mobile navbar, the mobile toolbar, and the desktop status bar.
 */
export const BOTTOM_CHROME = '.mobile-navbar, .mobile-toolbar, .status-bar';

export const TOAST_GAP_PX = 12;
/** How long a toast keeps remeasuring while the mobile nav finishes layout. */
export const TOAST_SETTLE_MS = 500;
export const POPUP_MARGIN_PX = 4;

export interface ChromeBox {
	top: number;
	bottom: number;
	left: number;
	right: number;
	width: number;
	height: number;
}

function cssPx(value: string): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** `env(safe-area-inset-bottom)` and Obsidian's own inset variable. The larger one wins. */
export function readSafeAreaBottom(doc: Document): number {
	const root = doc.defaultView?.getComputedStyle(doc.documentElement).getPropertyValue('--safe-area-inset-bottom') ?? '';
	const probe = doc.createElement('div');
	probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom);';
	doc.body.appendChild(probe);
	const env = doc.defaultView?.getComputedStyle(probe).paddingBottom ?? '';
	probe.remove();
	return Math.max(cssPx(root), cssPx(env));
}

export function measureBottomChrome(doc: Document): ChromeBox[] {
	const boxes: ChromeBox[] = [];
	doc.querySelectorAll<HTMLElement>(BOTTOM_CHROME).forEach((el) => {
		const rect = el.getBoundingClientRect();
		boxes.push({
			top: rect.top,
			bottom: rect.bottom,
			left: rect.left,
			right: rect.right,
			width: rect.width,
			height: rect.height,
		});
	});
	return boxes;
}

/**
 * The y, in viewport pixels, where content must stop.
 * A visible bottom bar wins over the safe area when the bar already includes it.
 */
export function contentBottom(viewportHeight: number, boxes: readonly ChromeBox[], safeAreaBottom = 0): number {
	if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
	let limit = viewportHeight - Math.max(0, safeAreaBottom);
	const floor = viewportHeight * 0.5;
	for (const box of boxes) {
		if (box.width < 8 || box.height < 8 || box.height > viewportHeight * 0.5) continue;
		if (box.bottom < floor || box.top >= viewportHeight) continue;
		limit = Math.min(limit, box.top);
	}
	return Math.max(0, limit);
}

/** CSS `bottom` for a fixed toast so its bottom edge sits `gap` px above `limitTop`. */
export function toastBottomOffset(viewportHeight: number, limitTop: number, gap = TOAST_GAP_PX): number {
	if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return gap;
	return Math.max(gap, Math.round(viewportHeight - limitTop + gap));
}

/** Measure the live nav, toolbar, status bar, and safe area, then pin the toast above them. */
export function placeBottomToast(toast: HTMLElement): void {
	const doc = toast.ownerDocument;
	const view = doc.defaultView;
	const height = view?.innerHeight || doc.documentElement?.clientHeight || 0;
	if (height <= 0) return;
	const limit = contentBottom(height, measureBottomChrome(doc), readSafeAreaBottom(doc));
	toast.style.bottom = `${toastBottomOffset(height, limit)}px`;
}

/**
 * Keep a toast 12px above the nav, toolbar, and status bar.
 * The first layout often happens after the toast is shown, so this remeasures
 * every frame for {@link TOAST_SETTLE_MS}, then follows resize, visualViewport,
 * scroll, and nav/toolbar size or class changes.
 */
export function watchBottomToast(toast: HTMLElement): () => void {
	const doc = toast.ownerDocument;
	const view = doc.defaultView;
	let frame = 0;
	let stopped = false;
	const started = view?.performance?.now?.() ?? Date.now();
	const resizeObservers: ResizeObserver[] = [];
	const mutationObservers: MutationObserver[] = [];
	const watched = new WeakSet<Element>();

	const place = (): void => {
		if (stopped) return;
		if (!toast.isConnected) {
			stop();
			return;
		}
		placeBottomToast(toast);
	};

	const watchEl = (el: Element): void => {
		if (watched.has(el) || el === toast) return;
		watched.add(el);
		if (typeof ResizeObserver === 'function') {
			const resize = new ResizeObserver(() => place());
			resize.observe(el);
			resizeObservers.push(resize);
		}
		if (typeof MutationObserver === 'function') {
			const mutation = new MutationObserver(() => place());
			mutation.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
			mutationObservers.push(mutation);
		}
	};

	const onChange = (): void => {
		doc.querySelectorAll(BOTTOM_CHROME).forEach(watchEl);
		place();
	};

	const tick = (now: number): void => {
		if (stopped) return;
		onChange();
		if (now - started < TOAST_SETTLE_MS) frame = view?.requestAnimationFrame(tick) ?? 0;
	};

	// Do not observe body childList. Measuring the safe area inserts a probe,
	// and a child observer would measure again forever.
	view?.addEventListener('resize', onChange);
	view?.visualViewport?.addEventListener('resize', onChange);
	view?.visualViewport?.addEventListener('scroll', onChange);
	doc.addEventListener('scroll', onChange, true);
	if (doc.documentElement) watchEl(doc.documentElement);
	if (doc.body) watchEl(doc.body);
	onChange();
	frame = view?.requestAnimationFrame(tick) ?? 0;

	function stop(): void {
		if (stopped) return;
		stopped = true;
		view?.cancelAnimationFrame(frame);
		view?.removeEventListener('resize', onChange);
		view?.visualViewport?.removeEventListener('resize', onChange);
		view?.visualViewport?.removeEventListener('scroll', onChange);
		doc.removeEventListener('scroll', onChange, true);
		for (const resize of resizeObservers) resize.disconnect();
		for (const mutation of mutationObservers) mutation.disconnect();
	}
	return stop;
}

/**
 * Space between a toast lead and its name.
 * A flex item drops a leading space, so the gap is the space.
 */
export const TOAST_TEXT_GAP = '0.3em';

const TOAST_LEADS = ['Not home', 'Home', 'Undone'] as const;

/** Split a toast into a lead and a name. The name never starts with whitespace. */
export function toastLineParts(message: string): { lead: string; name: string } {
	const text = message.trim();
	for (const lead of TOAST_LEADS) {
		if (text === lead) return { lead, name: '' };
		if (text.startsWith(`${lead} `)) return { lead, name: text.slice(lead.length).trim() };
	}
	const space = text.indexOf(' ');
	if (space <= 0) return { lead: text, name: '' };
	return { lead: text.slice(0, space), name: text.slice(space + 1).trim() };
}

/**
 * Home, Not home, and Undone share this line.
 * Returns the name element when the toast has one.
 */
export function fillToastText(text: HTMLElement, message: string): HTMLElement | null {
	const parts = toastLineParts(message);
	text.replaceChildren();
	const leadEl = text.ownerDocument.createElement('span');
	leadEl.className = 'rv-toast-lead';
	leadEl.textContent = parts.lead;
	text.append(leadEl);
	if (!parts.name) return null;
	const nameEl = text.ownerDocument.createElement('span');
	nameEl.className = 'rv-toast-name';
	nameEl.textContent = parts.name;
	text.append(nameEl);
	return nameEl;
}
