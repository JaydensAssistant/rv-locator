import { setIcon } from 'obsidian';

/**
 * A chevron that stays visible, including before the field is typed in.
 * A tap opens the list. An empty query shows the caller's order (most recently used).
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
	const button = input.ownerDocument.createElement('button');
	button.type = 'button';
	button.className = 'rv-suggest-chevron';
	button.setAttribute('aria-label', 'Show suggestions');
	setIcon(button, 'chevron-down');
	input.insertAdjacentElement('afterend', button);
	const panel = input.ownerDocument.createElement('div');
	panel.className = 'rv-suggest-panel';
	panel.hidden = true;
	parent.appendChild(panel);

	const paint = (): void => {
		panel.replaceChildren();
		const items = suggestions().filter((item) => item.trim());
		if (items.length === 0) {
			panel.hidden = true;
			return;
		}
		panel.hidden = false;
		for (const item of items) {
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
				suffix.textContent = shown.suffix;
				row.append(main, suffix);
				row.title = item;
			} else {
				row.textContent = item;
			}
			row.dataset.value = item;
			row.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				onPick(item);
				panel.hidden = true;
			});
			panel.appendChild(row);
		}
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
	input.addEventListener('input', () => {
		if (!panel.hidden) paint();
	});
	input.addEventListener('focus', () => {
		paint();
	});
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
		const picked = rows[highlighted];
		if (picked instanceof HTMLElement && picked.classList.contains('is-highlighted')) {
			event.preventDefault();
			event.stopPropagation();
			onPick(picked.dataset.value || picked.textContent || '');
			panel.hidden = true;
			highlighted = -1;
			return;
		}
		event.preventDefault();
		panel.hidden = true;
		highlighted = -1;
	});
	input.ownerDocument.addEventListener('pointerdown', (event) => {
		const target = event.target;
		if (target instanceof Node && parent.contains(target)) return;
		panel.hidden = true;
	});
}
