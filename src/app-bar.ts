import { setIcon, type IconName } from 'obsidian';
import { closeUrgencyPopovers } from './urgency-popover';

/** Hub, bases, and the note use this row. One list so the five slots cannot drift. */
export const APP_TABS: readonly { id: string; label: string; icon: IconName }[] = [
	{ id: 'hub', label: 'Hub', icon: 'house' },
	{ id: 'search', label: 'Search', icon: 'search' },
	{ id: 'campaign', label: 'Campaign', icon: 'flag' },
	{ id: 'map', label: 'Map', icon: 'earth' },
	{ id: 'new', label: 'New', icon: 'plus' },
];

/** The icon the sort row uses when a preset has none of its own. */
export const SORT_ICON: IconName = 'arrow-up-down';

export type BarSurface = 'hub' | 'base' | 'note';

/** RV-260. The hub's first tab is Sort. A base or a note still says Hub. */
export function leadTab(surface: BarSurface): { id: string; label: string; icon: IconName } {
	if (surface === 'hub') return { id: 'hub', label: 'Sort', icon: SORT_ICON };
	return APP_TABS[0] ?? { id: 'hub', label: 'Hub', icon: 'house' };
}

/** Five equal slots across the bar. At a 390px phone that is 78px each. */
export function appBarSlotPx(barPx: number, count = APP_TABS.length): number {
	if (!(barPx > 0) || count <= 0) return 0;
	return barPx / count;
}

export function appendAppSlot(
	bar: HTMLElement,
	label: string,
	icon: IconName | string,
	options: { on?: boolean; dot?: boolean; extra?: string } = {},
): HTMLButtonElement {
	const button = bar.ownerDocument.createElement('button');
	button.type = 'button';
	const classes = ['rv-app-slot'];
	if (options.on) classes.push('is-on');
	if (options.dot) classes.push('has-dot');
	if (options.extra) classes.push(...options.extra.split(/\s+/).filter(Boolean));
	button.className = classes.join(' ');
	button.setAttribute('aria-label', label);
	setIcon(button, icon as IconName);
	const text = bar.ownerDocument.createElement('span');
	text.className = 'rv-app-label';
	text.textContent = label;
	button.appendChild(text);
	bar.appendChild(button);
	return button;
}

/**
 * A menu left in the document swallows the next tap. Light theme lays the
 * menu out a frame late, so the first open still covers the badge and the
 * second snooze never reaches it. Drop what is already open before showing
 * another.
 */
export function dismissOpenMenus(doc: Document | null | undefined): void {
	closeUrgencyPopovers(doc);
	if (!doc || typeof doc.querySelectorAll !== 'function') return;
	const menus = doc.querySelectorAll('.menu');
	for (let index = 0; index < menus.length; index += 1) menus[index]?.remove();
}

/**
 * Obsidian's menu opens downward from the click. A slot on the bottom bar
 * would paint the menu past the viewport. Slide it up so the whole menu,
 * including its empty padding, stays 12px inside every edge.
 */
export function keepMenuOnScreen(anchor: EventTarget | null): void {
	const node = anchor instanceof HTMLElement ? anchor : null;
	const doc = node?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
	const view = doc?.defaultView;
	if (!doc || !view || typeof doc.querySelectorAll !== 'function') return;
	const menus = doc.querySelectorAll('.menu');
	const el = menus.length > 0 ? menus[menus.length - 1] : null;
	if (!(el instanceof HTMLElement) || typeof el.getBoundingClientRect !== 'function') return;
	const box = el.getBoundingClientRect();
	if (!Number.isFinite(box.height) || box.height <= 0) {
		const tries = Number(el.dataset.rvMenuWait ?? '0');
		if (tries < 8 && view.requestAnimationFrame) {
			el.dataset.rvMenuWait = String(tries + 1);
			view.requestAnimationFrame(() => keepMenuOnScreen(anchor));
		}
		return;
	}
	const margin = 12;
	const visual = view.visualViewport?.height ?? 0;
	const rawHeight = view.innerHeight > 0 ? view.innerHeight : box.bottom;
	const height = visual > 0 ? Math.min(rawHeight, visual) : rawHeight;
	const width = view.innerWidth > 0 ? view.innerWidth : box.right;
	const limit = Math.floor(height) - margin;
	const rightLimit = Math.floor(width) - margin;
	let top = box.top;
	let left = box.left;
	if (box.bottom > limit) {
		const anchorTop = node && typeof node.getBoundingClientRect === 'function'
			? node.getBoundingClientRect().top
			: box.top;
		const above = anchorTop - box.height - margin;
		top = above >= margin ? above : Math.max(margin, limit - box.height);
	}
	if (top < margin) top = margin;
	if (top + box.height > limit) top = Math.max(margin, limit - box.height);
	if (left + box.width > rightLimit) left = Math.max(margin, rightLimit - box.width);
	if (left < margin) left = margin;
	const maxHeight = Math.max(0, Math.floor(limit - top));
	const maxWidth = Math.max(0, Math.floor(rightLimit - left));
	el.style.setProperty('box-sizing', 'border-box', 'important');
	el.style.setProperty('bottom', 'auto', 'important');
	el.style.setProperty('right', 'auto', 'important');
	el.style.setProperty('max-height', `${maxHeight}px`, 'important');
	el.style.setProperty('max-width', `${maxWidth}px`, 'important');
	el.style.setProperty('top', `${Math.floor(top)}px`, 'important');
	el.style.setProperty('left', `${Math.floor(left)}px`, 'important');
	const pass = Number(el.dataset.rvMenuClamp ?? '0');
	if (pass >= 4) return;
	el.dataset.rvMenuClamp = String(pass + 1);
	if (view.requestAnimationFrame) view.requestAnimationFrame(() => keepMenuOnScreen(anchor));
}
