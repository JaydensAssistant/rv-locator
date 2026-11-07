import { armHoverTooltip, mountClosedTitle } from './title-fit';

const CHEVRON_DOWN = 'm6 9 6 6 6-6';

/** Lucide chevron-down, drawn here so the modal button is not an empty square. */
function paintChevron(button: HTMLElement): void {
	const doc = button.ownerDocument;
	const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('class', 'svg-icon lucide-chevron-down');
	svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', CHEVRON_DOWN);
	svg.appendChild(path);
	button.replaceChildren(svg);
}

/** Placeholder row while an address lookup is in flight. Not a choice. */
export const SUGGEST_PENDING = '\u0000pending';

/** Kept for callers that still want a short list. The panel itself uses the room above the footer. */
export const SUGGEST_VISIBLE_ROWS = 5;

/** Paint this many matches. The rest stay searchable by typing. */
export const SUGGEST_MATCH_LIMIT = 50;

let suggestionListeners = 0;

/** Live document and viewport listeners owned by open suggestion fields. */
export function suggestionListenerCount(): number {
	return suggestionListeners;
}

interface SuggestionMount {
	input: HTMLElement;
	dispose: () => void;
}

const suggestionMounts = new Set<SuggestionMount>();

function trackListener(target: EventTarget | null | undefined, type: string, handler: EventListener, capture = false): () => void {
	if (!target || typeof target.addEventListener !== 'function') return () => {};
	target.addEventListener(type, handler, capture);
	suggestionListeners += 1;
	let dropped = false;
	return () => {
		if (dropped) return;
		dropped = true;
		target.removeEventListener(type, handler, capture);
		suggestionListeners -= 1;
	};
}

/** Drop listeners for suggestion fields inside `root`. Called when a modal closes. */
export function releaseSuggestionFields(root: ParentNode): void {
	for (const mount of suggestionMounts) {
		if (mount.input === root || (typeof root.contains === 'function' && root.contains(mount.input))) mount.dispose();
	}
}

export interface SuggestPlacementInput {
	anchorTop: number;
	anchorBottom: number;
	limitTop: number;
	limitBottom: number;
	rowHeight: number;
	rows?: number;
}

export interface SuggestPlacement {
	above: boolean;
	maxHeight: number;
}

/**
 * Keep the list inside the modal and the visible viewport (above the keyboard).
 * Open above the field when there is more room there than below.
 */
/**
 * Lock the panel to whole painted children. A 40px floor cuts the last title
 * when a type band is shorter than a row, and a scrollbar then clips that row.
 */
function clipPanelToWholeRows(panel: HTMLElement, room: number): void {
	const cap = Math.max(0, Math.floor(room));
	panel.style.maxHeight = `${cap}px`;
	const heights = Array.from(panel.children).flatMap((node) => {
		if (!(node instanceof HTMLElement)) return [];
		const height = node.offsetHeight;
		return height > 0 ? [height] : [];
	});
	if (heights.length === 0 || cap <= 0) return;
	const snap = (inner: number): number => {
		let used = 0;
		for (const height of heights) {
			if (used + height > inner + 0.5) break;
			used += height;
		}
		return used;
	};
	const border = Math.max(0, panel.offsetHeight - panel.clientHeight);
	const used = snap(Math.max(0, cap - border));
	if (used <= 0) return;
	panel.style.maxHeight = `${used + border}px`;
	if (panel.scrollHeight > panel.clientHeight + 0.5) {
		const again = snap(panel.clientHeight);
		if (again > 0 && again < used) {
			const borderNow = Math.max(0, panel.offsetHeight - panel.clientHeight);
			panel.style.maxHeight = `${again + borderNow}px`;
		}
	}
}

/** Use the open side, in whole rows, down to the footer. No fixed row cap. */
export function suggestPanelPlacement(input: SuggestPlacementInput): SuggestPlacement {
	const row = input.rowHeight > 0 ? input.rowHeight : 44;
	const below = Math.max(0, input.limitBottom - input.anchorBottom);
	const above = Math.max(0, input.anchorTop - input.limitTop);
	const openAbove = above > below;
	const room = openAbove ? above : below;
	const cap = input.rows && input.rows > 0 ? input.rows * row : room;
	const usable = Math.min(room, cap);
	const whole = Math.floor(usable / row) * row;
	const maxHeight = whole >= row ? whole : usable;
	return { above: openAbove, maxHeight: Math.max(0, maxHeight) };
}

export interface SuggestBand {
	label: string;
	items: readonly string[];
}

/**
 * A chevron that stays visible, including before the field is typed in.
 * The list stays closed until the user clicks the chevron, the field, or types.
 * Mount does not focus the field, so opening a modal does not open the list.
 * An empty query shows the caller's order (most recently used).
 */
export interface SuggestListOptions {
	/** Titles already chosen. They paint as checked rows at the top and a tap removes one. */
	picked?: () => readonly string[];
	/** Leave the list open after a tap so several picks can change without a second open. */
	keepOpen?: boolean;
}

export function mountAlwaysChevron(
	input: HTMLElement,
	suggestions: () => readonly string[],
	onPick: (value: string) => void,
	present?: (value: string) => { text: string; suffix: string },
	bands?: (items: readonly string[]) => readonly SuggestBand[],
	list?: SuggestListOptions,
): void {
	const parent = input.parentElement;
	if (!parent || typeof input.insertAdjacentElement !== 'function') return;
	if (parent.querySelector('.rv-suggest-chevron')) return;
	parent.classList.add('rv-suggest-host');
	input.setAttribute('autocomplete', 'off');
	input.setAttribute('autocapitalize', 'off');
	input.setAttribute('autocorrect', 'off');
	input.setAttribute('spellcheck', 'false');
	input.removeAttribute('list');
	const button = input.ownerDocument.createElement('button');
	button.type = 'button';
	button.className = 'rv-suggest-chevron';
	button.setAttribute('aria-label', 'Show suggestions');
	paintChevron(button);
	input.insertAdjacentElement('afterend', button);
	const panel = input.ownerDocument.createElement('div');
	panel.className = 'rv-suggest-panel';
	panel.hidden = true;
	parent.appendChild(panel);

	const place = (): void => {
		const rect = parent.getBoundingClientRect();
		const view = input.ownerDocument.defaultView;
		const modal = parent.closest('.modal-content') ?? parent.closest('.modal');
		const frame = modal instanceof HTMLElement ? modal.getBoundingClientRect() : null;
		const viewport = view?.visualViewport;
		const viewTop = viewport ? viewport.offsetTop : 0;
		const viewBottom = viewport ? viewport.offsetTop + viewport.height : (view?.innerHeight ?? rect.bottom);
		const sample = panel.querySelector('.rv-suggest-option, .rv-suggest-pending');
		const measured = sample instanceof HTMLElement ? sample.getBoundingClientRect().height : 0;
		const sheet = parent.closest('.modal, .rv-study-change-modal');
		const actions = sheet?.querySelector('.rv-modal-actions, .modal-button-container');
		const actionsTop = actions instanceof HTMLElement ? actions.getBoundingClientRect().top : 0;
		let limitBottom = Math.min(frame?.bottom ?? viewBottom, viewBottom);
		if (actionsTop > rect.bottom) limitBottom = Math.min(limitBottom, actionsTop);
		const placed = suggestPanelPlacement({
			anchorTop: rect.top,
			anchorBottom: rect.bottom,
			limitTop: Math.max(frame?.top ?? viewTop, viewTop),
			limitBottom,
			rowHeight: measured > 0 ? measured : 40,
		});
		panel.classList.toggle('is-above', placed.above);
		let room = placed.maxHeight;
		panel.style.maxHeight = `${room}px`;
		if (!placed.above && actions instanceof HTMLElement) {
			const panelTop = panel.getBoundingClientRect().top;
			const footerTop = actions.getBoundingClientRect().top;
			if (footerTop > panelTop) room = Math.min(room, Math.max(0, footerTop - panelTop));
		}
		clipPanelToWholeRows(panel, room);
	};

	let armedDismiss = false;
	const showPanel = (open: boolean): void => {
		panel.hidden = !open;
		if (open) panel.style.removeProperty('display');
		else panel.style.setProperty('display', 'none', 'important');
	};
	const paint = (): void => {
		panel.replaceChildren();
		const items = suggestions().map((item) => item.trim()).filter(Boolean).slice(0, SUGGEST_MATCH_LIMIT);
		const typed = 'value' in input ? String((input as HTMLInputElement).value ?? '') : '';
		if (items.length === 0 && typed.trim()) {
			showPanel(false);
			return;
		}
		showPanel(true);
		const paintRow = (item: string, titleOnly = false, checked = false): void => {
			if (item === SUGGEST_PENDING) {
				const pending = panel.ownerDocument.createElement('div');
				pending.className = 'rv-suggest-pending';
				pending.setAttribute('aria-hidden', 'true');
				pending.textContent = '…';
				panel.appendChild(pending);
				return;
			}
			const row = panel.ownerDocument.createElement('button');
			row.type = 'button';
			row.className = 'rv-suggest-option';
			const shown = present?.(item);
			if (shown?.suffix && !titleOnly) {
				row.classList.add('rv-title-option');
				const main = row.ownerDocument.createElement('span');
				main.className = 'rv-title-text';
				main.textContent = shown.text;
				const suffix = row.ownerDocument.createElement('span');
				suffix.className = 'rv-title-suffix';
				suffix.textContent = shown.suffix.startsWith(' ') ? shown.suffix : ` ${shown.suffix}`;
				row.append(main, suffix);
				armHoverTooltip(row, item, { touch: false });
			} else {
				row.textContent = shown?.text || item;
			}
			row.dataset.value = item;
			if (checked) {
				row.classList.add('is-checked');
				const mark = row.ownerDocument.createElement('span');
				mark.className = 'rv-suggest-check';
				mark.setAttribute('aria-hidden', 'true');
				mark.textContent = '✓';
				row.append(mark);
			}
			let chosen = false;
			const choose = (): void => {
				if (chosen && !list?.keepOpen) return;
				chosen = true;
				armedDismiss = true;
				if (input instanceof HTMLElement) input.dataset.rvPicking = '1';
				onPick(item);
				if (list?.keepOpen) {
					chosen = false;
					paint();
					return;
				}
				showPanel(false);
			};
			row.addEventListener('pointerdown', (event) => {
				event.preventDefault();
				if (input instanceof HTMLElement) input.dataset.rvPicking = '1';
			});
			row.addEventListener('pointerup', (event) => {
				event.preventDefault();
				event.stopPropagation();
				choose();
			});
			row.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				choose();
			});
			panel.appendChild(row);
		};
		const pending = items.filter((item) => item === SUGGEST_PENDING);
		const picked = (list?.picked?.() ?? []).map((item) => item.trim()).filter(Boolean);
		const pickedKeys = new Set(picked.map((item) => item.toLowerCase()));
		const choices = items.filter((item) => item !== SUGGEST_PENDING && !pickedKeys.has(item.trim().toLowerCase()));
		for (const item of pending) paintRow(item);
		for (const item of picked) paintRow(item, false, true);
		const grouped = bands?.(choices) ?? null;
		if (grouped && grouped.some((band) => band.items.length > 0)) {
			for (const band of grouped) {
				if (band.items.length === 0) continue;
				const head = panel.ownerDocument.createElement('div');
				head.className = 'rv-suggest-band';
				head.textContent = band.label;
				panel.appendChild(head);
				for (const item of band.items) paintRow(item, true);
			}
		} else {
			for (const item of choices) paintRow(item);
		}
		place();
	};

	let highlighted = -1;
	const markHighlight = (): void => {
		const rows = Array.from(panel.querySelectorAll('.rv-suggest-option'));
		rows.forEach((row, index) => row.classList.toggle('is-highlighted', index === highlighted));
	};

	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (!panel.hidden) {
			showPanel(false);
			return;
		}
		paint();
		if (typeof input.focus === 'function') input.focus();
	});
	const openFromUser = (): void => {
		if (panel.hidden) paint();
		else place();
	};
	let gestured = false;
	const armGesture = (): void => {
		gestured = true;
	};
	input.addEventListener('pointerdown', armGesture);
	input.addEventListener('keydown', armGesture);
	input.addEventListener('focus', (event) => {
		if (typeof FocusEvent !== 'undefined' && event instanceof FocusEvent && !event.isTrusted) return;
		if (!gestured) return;
		openFromUser();
	});
	input.addEventListener('click', () => {
		openFromUser();
	});
	input.addEventListener('input', () => {
		paint();
	});
	input.addEventListener('rv-suggest-sync', () => {
		if (!panel.hidden) paint();
	});
	if (present) mountClosedTitle(input, present);
	input.addEventListener('keydown', (event) => {
		const key = event instanceof KeyboardEvent ? event.key : '';
		if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter') return;
		const rows = Array.from(panel.querySelectorAll('.rv-suggest-option'));
		if (key === 'ArrowDown' || key === 'ArrowUp') {
			event.preventDefault();
			if (panel.hidden) paint();
			const count = panel.querySelectorAll('.rv-suggest-option').length;
			if (count === 0) return;
			highlighted = key === 'ArrowDown' ? Math.min(count - 1, highlighted + 1) : Math.max(0, highlighted - 1);
			markHighlight();
			return;
		}
		const picked = highlighted >= 0 ? rows[highlighted] : undefined;
		if (picked instanceof HTMLElement && picked.classList.contains('is-highlighted')) {
			event.preventDefault();
			event.stopImmediatePropagation();
			onPick(picked.dataset.value || picked.textContent || '');
			if (list?.keepOpen) paint();
			else showPanel(false);
			highlighted = -1;
			return;
		}
		// Nothing highlighted: the field's own Enter handler adds the typed text.
	});
	const doc = input.ownerDocument;
	const view = doc.defaultView;
	const onDismissClick = (event: Event): void => {
		if (!input.isConnected) {
			dispose();
			return;
		}
		if (armedDismiss) {
			armedDismiss = false;
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (panel.hidden) return;
		const target = event.target;
		if (target instanceof Node && parent.contains(target)) return;
		const onFooter = target instanceof Element && target.closest('.rv-modal-actions, .modal-button-container') != null;
		if (onFooter) {
			showPanel(false);
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		showPanel(false);
	};
	// keydown hides the list. The matching keyup still has to stop, or Obsidian
	// sees a keyup with the list already closed and dismisses the modal too.
	let swallowEscape = false;
	const onEscape = (event: Event): void => {
		if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return;
		const listOpen = !panel.hidden;
		if (!listOpen && !swallowEscape) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.type === 'keyup') {
			swallowEscape = false;
			if (listOpen) showPanel(false);
			return;
		}
		swallowEscape = true;
		if (listOpen) showPanel(false);
	};
	const onViewport = (): void => {
		if (!input.isConnected) {
			dispose();
			return;
		}
		if (!panel.hidden) place();
	};
	const escapeTarget: EventTarget = view ?? doc;
	const stops = [
		trackListener(doc, 'click', onDismissClick, true),
		trackListener(escapeTarget, 'keydown', onEscape, true),
		trackListener(escapeTarget, 'keyup', onEscape, true),
		trackListener(view?.visualViewport, 'resize', onViewport),
		trackListener(view?.visualViewport, 'scroll', onViewport),
		trackListener(view, 'resize', onViewport),
	];
	let disposed = false;
	let observer: MutationObserver | null = null;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		for (const stop of stops) stop();
		observer?.disconnect();
		observer = null;
		suggestionMounts.delete(mount);
	};
	const mount: SuggestionMount = { input, dispose };
	suggestionMounts.add(mount);
	const watch = input.closest('.modal') ?? doc.body;
	if (watch && typeof MutationObserver === 'function') {
		try {
			observer = new MutationObserver(() => {
				if (!input.isConnected) dispose();
			});
			observer.observe(watch, { childList: true, subtree: true });
		} catch {
			observer = null;
		}
	}
}
