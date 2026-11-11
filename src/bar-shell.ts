import { setIcon, type IconName } from 'obsidian';
import { APP_TABS, leadTab, type BarSurface } from './app-bar';

/** One tab bar, owned by the plugin, outside every view. */
export const BAR_SHELL_CLASS = 'rv-bar-shell';
export const BAR_SPACER_CLASS = 'rv-bar-spacer';
export const BAR_MIN_PX = 52;

const MIN_BOX = 2;

export interface BarTabHost {
	openHub(path: string): void;
	openSearch(path: string): void;
	openHubSearch(): void;
	openCampaign(): void;
	toggleMap(path: string): void;
	createNew(): void;
	openSort(): void;
}

function ownerDoc(node: unknown): Document | null {
	if (node == null || typeof node !== 'object') return null;
	const doc = (node as { ownerDocument?: unknown }).ownerDocument;
	if (doc == null || typeof (doc as Document).createElement !== 'function') return null;
	return doc as Document;
}

/** The five slots, created once. A later call returns the same node. */
export function createBarShell(container: HTMLElement): HTMLElement {
	const host = ownerDoc(container) ? container : (typeof document !== 'undefined' ? document.body : null);
	const doc = ownerDoc(host);
	if (!host || !doc) {
		const fallback = typeof document !== 'undefined' ? document.createElement('div') : ({} as HTMLElement);
		if (typeof document !== 'undefined') fallback.className = BAR_SHELL_CLASS;
		return fallback;
	}
	const found = host.querySelector(`:scope > .${BAR_SHELL_CLASS}`);
	if (found instanceof HTMLElement) return found;
	const bar = doc.createElement('div');
	bar.className = BAR_SHELL_CLASS;
	bar.style.minHeight = `${BAR_MIN_PX}px`;
	const row = doc.createElement('div');
	row.className = 'rv-bar-row rv-app-bar';
	for (const tab of APP_TABS) {
		const button = doc.createElement('button');
		button.type = 'button';
		button.className = `rv-app-slot rv-bar-tab-${tab.id}`;
		button.setAttribute('aria-label', tab.label);
		setIcon(button, tab.icon);
		const text = doc.createElement('span');
		text.className = 'rv-app-label';
		text.textContent = tab.label;
		button.appendChild(text);
		row.appendChild(button);
	}
	bar.appendChild(row);
	host.appendChild(bar);
	return bar;
}

/** Change the first tab's icon and label without replacing the button. */
export function paintBarLead(bar: HTMLElement, surface: BarSurface): void {
	const lead = leadTab(surface);
	const slot = bar.querySelector('.rv-bar-tab-hub');
	if (slot instanceof HTMLElement) paintBarSlot(slot, lead.label, lead.icon);
	bar.dataset.rvSurface = surface;
	bar.classList.toggle('is-note', surface === 'note');
	bar.classList.remove('is-away');
}

/**
 * Hub and base highlights use band 0. A note uses that note's urgency.
 * The lit slots get the color directly so it does not fall through to the vault accent.
 */
export function paintSurfaceAccent(bar: HTMLElement, surface: BarSurface, color: string): void {
	const paint = color.trim();
	if (surface === 'note') {
		bar.style.removeProperty('--rv-hub-accent');
		if (paint) {
			bar.style.setProperty('--rv-urgency-accent', paint);
			bar.style.setProperty('--interactive-accent', paint);
		} else {
			bar.style.removeProperty('--rv-urgency-accent');
			bar.style.removeProperty('--interactive-accent');
		}
	} else {
		bar.style.removeProperty('--rv-urgency-accent');
		if (paint) {
			bar.style.setProperty('--rv-hub-accent', paint);
			bar.style.setProperty('--interactive-accent', paint);
		}
	}
	bar.querySelectorAll('.rv-app-slot').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (paint && (node.classList.contains('is-on') || node.classList.contains('has-dot'))) node.style.color = paint;
		else node.style.removeProperty('color');
	});
}

/** Map slot stays the same button. Only its lit state and accent class change. */
export function paintBarEarth(bar: HTMLElement, surface: BarSurface, on: boolean, path = ''): void {
	const map = bar.querySelector('.rv-bar-tab-map');
	if (!(map instanceof HTMLElement)) return;
	map.classList.toggle('rv-note-bar-earth', surface === 'note');
	map.classList.toggle('rv-hub-earth', surface !== 'note');
	map.classList.toggle('is-on', on);
	map.setAttribute('aria-pressed', on ? 'true' : 'false');
	if (surface === 'note' && path) map.dataset.rvPath = path;
	else delete map.dataset.rvPath;
}

export function paintBarSlot(slot: HTMLElement, label: string, icon: IconName | string): void {
	slot.setAttribute('aria-label', label);
	slot.querySelectorAll('svg').forEach((node) => node.remove());
	setIcon(slot, icon as IconName);
	let text = slot.querySelector('.rv-app-label');
	if (!(text instanceof HTMLElement)) {
		text = slot.ownerDocument.createElement('span');
		text.className = 'rv-app-label';
		slot.appendChild(text);
	}
	text.textContent = label;
}

/** Same click on hub, base, and note. Only the first tab's meaning changes. */
export function dispatchBarTab(id: string, surface: BarSurface, path: string, host: BarTabHost): void {
	if (id === 'hub') {
		if (surface === 'hub') host.openSort();
		else host.openHub(path);
		return;
	}
	if (id === 'search') {
		if (surface === 'note') host.openSearch(path);
		else host.openHubSearch();
		return;
	}
	if (id === 'campaign') host.openCampaign();
	else if (id === 'map') host.toggleMap(path);
	else host.createNew();
}

export function barTabId(slot: Element): string {
	for (const tab of APP_TABS) {
		if (slot.classList.contains(`rv-bar-tab-${tab.id}`)) return tab.id;
	}
	return '';
}

/** The slot a view reserves. The bar is not a child of this node. */
export function ensureBarSpacer(host: HTMLElement): HTMLElement {
	const doc = ownerDoc(host);
	if (!host || !doc || typeof host.querySelector !== 'function') {
		const spacer = (typeof document !== 'undefined' ? document : doc)?.createElement('div');
		if (spacer) spacer.className = BAR_SPACER_CLASS;
		return spacer ?? ({} as HTMLElement);
	}
	const sitting = host.querySelector(':scope > .rv-bar-spacer');
	if (sitting instanceof HTMLElement) return sitting;
	const spacer = doc.createElement('div');
	spacer.className = BAR_SPACER_CLASS;
	spacer.setAttribute('aria-hidden', 'true');
	host.appendChild(spacer);
	return spacer;
}

function boxHidden(node: HTMLElement): boolean {
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

/**
 * A spacer that is reserving flow in a live hub, base, or note.
 * The swap cover does not get one, and it is never a fallback.
 */
export function visibleBarSpacer(doc: Document): HTMLElement | null {
	if (doc == null || typeof doc.querySelectorAll !== 'function') return null;
	const nodes = doc.querySelectorAll('.rv-bar-spacer');
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!(node instanceof HTMLElement) || !node.isConnected || boxHidden(node)) continue;
		if (node.closest('.rv-hub-swap-cover')) continue;
		const rect = node.getBoundingClientRect();
		if (rect.width < MIN_BOX || rect.height < MIN_BOX) continue;
		return node;
	}
	return null;
}

/** Keep the bar on the screen bottom. A spacer rect must not move it. */
export function pinBarToScreen(bar: HTMLElement): void {
	if (!bar?.style) return;
	bar.style.top = 'auto';
	bar.style.bottom = '0';
	bar.style.left = '0';
	bar.style.right = '0';
	bar.style.width = 'auto';
	bar.style.removeProperty('height');
}

/**
 * Move the bar onto the spacer. A spacer without a box leaves the bar
 * where it was, including its height.
 */
export function placeBarOver(bar: HTMLElement, spacer: HTMLElement | null): boolean {
	if (!(spacer instanceof HTMLElement) || !spacer.isConnected) return false;
	const rect = spacer.getBoundingClientRect();
	if (rect.width < MIN_BOX || rect.height < MIN_BOX) return false;
	bar.style.left = `${rect.left}px`;
	bar.style.top = `${rect.top}px`;
	bar.style.width = `${rect.width}px`;
	return true;
}
