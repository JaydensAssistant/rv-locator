import { mountClosedTitle } from './title-fit';

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

/** About five suggestion rows, then the list scrolls inside the box. */
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

function trackListener(target: EventTarget | null | undefined, type: string, handler: EventListener): () => void {
	if (!target || typeof target.addEventListener !== 'function') return () => {};
	target.addEventListener(type, handler);
	suggestionListeners += 1;
	let dropped = false;
	return () => {
		if (dropped) return;
		dropped = true;
		target.removeEventListener(type, handler);
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
export function suggestPanelPlacement(input: SuggestPlacementInput): SuggestPlacement {
	const rows = input.rows ?? SUGGEST_VISIBLE_ROWS;
	const gap = 2;
	const row = input.rowHeight > 0 ? input.rowHeight : 44;
	const preferred = row * rows;
	const below = Math.max(0, input.limitBottom - input.anchorBottom - gap);
	const above = Math.max(0, input.anchorTop - input.limitTop - gap);
	const openAbove = below < preferred && above > below;
	const room = openAbove ? above : below;
	return { above: openAbove, maxHeight: Math.max(0, Math.min(preferred, room)) };
}

/**
 * A chevron that stays visible, including before the field is typed in.
 * The list stays closed until the user clicks the chevron, the field, or types.
 * Mount does not focus the field, so opening a modal does not open the list.
 * An empty query shows the caller's order (most recently used).
 */
export function mountAlwaysChevron(
	input: HTMLElement,
	suggestions: () => readonly string[],
	onPick: (value: string) => void,
	present?: (value: string) => { text: string; suffix: string },
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
		const placed = suggestPanelPlacement({
			anchorTop: rect.top,
			anchorBottom: rect.bottom,
			limitTop: Math.max(frame?.top ?? viewTop, viewTop),
			limitBottom: Math.min(frame?.bottom ?? viewBottom, viewBottom),
			rowHeight: measured > 0 ? measured : 44,
		});
		panel.classList.toggle('is-above', placed.above);
		panel.style.maxHeight = `${placed.maxHeight}px`;
	};

	const paint = (): void => {
		panel.replaceChildren();
		const items = suggestions().map((item) => item.trim()).filter(Boolean).slice(0, SUGGEST_MATCH_LIMIT);
		const typed = 'value' in input ? String((input as HTMLInputElement).value ?? '') : '';
		const emptyQuery = !typed.trim();
		if (items.length === 0 && !emptyQuery) {
			panel.hidden = true;
			return;
		}
		panel.hidden = false;
		if (emptyQuery) {
			const hint = panel.ownerDocument.createElement('div');
			hint.className = 'rv-suggest-hint';
			hint.textContent = 'Start typing';
			panel.appendChild(hint);
		}
		if (items.length === 0) return;
		for (const item of items) {
			if (item === SUGGEST_PENDING) {
				const pending = panel.ownerDocument.createElement('div');
				pending.className = 'rv-suggest-pending';
				pending.setAttribute('aria-hidden', 'true');
				pending.textContent = '…';
				panel.appendChild(pending);
				continue;
			}
			const row = panel.ownerDocument.createElement('button');
			row.type = 'button';
			row.className = 'rv-suggest-option';
			const shown = present?.(item);
			if (shown?.suffix) {
				row.classList.add('rv-title-option');
				const main = row.ownerDocument.createElement('span');
				main.className = 'rv-title-text';
				main.textContent = shown.text;
				const suffix = row.ownerDocument.createElement('span');
				suffix.className = 'rv-title-suffix';
				suffix.textContent = shown.suffix.startsWith(' ') ? shown.suffix : ` ${shown.suffix}`;
				row.append(main, suffix);
				row.title = item;
			} else {
				row.textContent = item;
			}
			row.dataset.value = item;
			row.addEventListener('pointerdown', (event) => {
				event.preventDefault();
				if (input instanceof HTMLElement) input.dataset.rvPicking = '1';
				onPick(item);
				panel.hidden = true;
			});
			row.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				onPick(item);
				panel.hidden = true;
			});
			panel.appendChild(row);
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
			panel.hidden = true;
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
			panel.hidden = true;
			highlighted = -1;
			return;
		}
		// Nothing highlighted: the field's own Enter handler adds the typed text.
	});
	const doc = input.ownerDocument;
	const view = doc.defaultView;
	const onPointerDown = (event: Event): void => {
		const target = event.target;
		if (target instanceof Node && parent.contains(target)) return;
		panel.hidden = true;
	};
	const onViewport = (): void => {
		if (!input.isConnected) {
			dispose();
			return;
		}
		if (!panel.hidden) place();
	};
	const stops = [
		trackListener(doc, 'pointerdown', onPointerDown),
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
