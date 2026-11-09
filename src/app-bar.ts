import { setIcon, type IconName } from 'obsidian';

/** Hub, bases, and the note use this row. One list so the five slots cannot drift. */
export const APP_TABS: readonly { id: string; label: string; icon: IconName }[] = [
	{ id: 'hub', label: 'Hub', icon: 'house' },
	{ id: 'search', label: 'Search', icon: 'search' },
	{ id: 'campaign', label: 'Campaign', icon: 'flag' },
	{ id: 'map', label: 'Map', icon: 'earth' },
	{ id: 'new', label: 'New', icon: 'plus' },
];

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
 * Obsidian's menu opens downward from the click. A slot on the bottom bar
 * would paint the menu past the viewport. Slide it up so the whole menu
 * stays on screen, and callers scroll the slot into view first.
 */
export function keepMenuOnScreen(anchor: EventTarget | null): void {
	const node = anchor instanceof HTMLElement ? anchor : null;
	const doc = node?.ownerDocument;
	const view = doc?.defaultView;
	if (!doc || !view || typeof doc.querySelectorAll !== 'function') return;
	const menus = doc.querySelectorAll('.menu');
	const el = menus.length > 0 ? menus[menus.length - 1] : null;
	if (!(el instanceof HTMLElement) || typeof el.getBoundingClientRect !== 'function') return;
	const box = el.getBoundingClientRect();
	if (!Number.isFinite(box.height) || box.height <= 0) return;
	const margin = 12;
	const visual = view.visualViewport?.height ?? 0;
	const rawHeight = view.innerHeight > 0 ? view.innerHeight : box.bottom;
	const height = visual > 0 ? Math.min(rawHeight, visual) : rawHeight;
	const width = view.innerWidth > 0 ? view.innerWidth : box.right;
	const limit = Math.floor(height) - margin;
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
	if (left + box.width > width - margin) left = Math.max(margin, width - box.width - margin);
	if (left < margin) left = margin;
	el.style.top = `${Math.floor(top)}px`;
	el.style.left = `${Math.floor(left)}px`;
	if (el.dataset.rvMenuClamp === '1') return;
	el.dataset.rvMenuClamp = '1';
	if (view.requestAnimationFrame) view.requestAnimationFrame(() => keepMenuOnScreen(anchor));
}
