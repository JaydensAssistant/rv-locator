/**
 * Bottom chrome the toast and the fullscreen map card must clear.
 * The mobile navbar, the mobile toolbar, and the desktop status bar.
 */
export const BOTTOM_CHROME = '.mobile-navbar, .mobile-toolbar, .status-bar';

export const TOAST_GAP_PX = 8;
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
