import { setIcon } from 'obsidian';

/**
 * A chevron that stays visible, including before the field is typed in.
 * A tap opens the list. An empty query shows the caller's order (most recently used).
 */
export function mountAlwaysChevron(
	input: HTMLElement,
	suggestions: () => readonly string[],
	onPick: (value: string) => void,
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
			row.textContent = item;
			row.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				onPick(item);
				panel.hidden = true;
			});
			panel.appendChild(row);
		}
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
	input.ownerDocument.addEventListener('pointerdown', (event) => {
		const target = event.target;
		if (target instanceof Node && parent.contains(target)) return;
		panel.hidden = true;
	});
}
