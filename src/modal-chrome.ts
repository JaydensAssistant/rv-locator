import { Platform, setIcon, type Setting } from 'obsidian';

const PROMPT_ICONS: Array<[RegExp, string]> = [
	[/literature|publication/i, 'book-open'],
	[/media/i, 'clapperboard'],
	[/lesson/i, 'book-marked'],
	[/where you started|start date|started/i, 'calendar'],
	[/where you ended|end date|ended/i, 'calendar'],
	[/companion|who came|who was taken|publisher came/i, 'users'],
	[/address/i, 'map-pin'],
	[/name/i, 'user'],
	[/man \/ woman|gender/i, 'person-standing'],
	[/priority/i, 'gauge'],
	[/county|home region|region/i, 'map'],
	[/were they home|\bhome\b/i, 'door-open'],
	[/weekday|daypart|\bday\b/i, 'calendar'],
	[/^hour$/i, 'clock'],
	[/minutes/i, 'timer'],
	[/^label$/i, 'tag'],
	[/time/i, 'clock'],
	[/try or avoid/i, 'list-checks'],
	[/covered|campaign/i, 'book-alert'],
	[/scope|folder/i, 'folder'],
	[/include notes|already have a location|latitude|longitude|coordinate/i, 'locate'],
	[/note|template/i, 'file-text'],
	[/snooze/i, 'moon'],
	[/color|palette/i, 'palette'],
	[/distance/i, 'ruler'],
	[/api key|\bkey\b/i, 'key'],
	[/overwrite|\btag\b/i, 'download'],
	[/step \d/i, 'list-ordered'],
];

const BUTTON_ICONS: Array<[RegExp, string]> = [
	[/^log past visit$/i, 'rotate-ccw-clock'],
	[/^log visit$/i, 'check'],
	[/^look up again$/i, 'refresh-cw'],
	[/^save and continue$/i, 'check'],
	[/^cancel$/i, 'x'],
	[/^save$/i, 'check'],
	[/^rename$/i, 'pencil'],
	[/^delete/i, 'trash-2'],
	[/^start campaign$/i, 'book-alert'],
	[/^end campaign/i, 'book-x'],
	[/^covered$/i, 'book-check'],
	[/^not this time$/i, 'book-x'],
	[/^not home$/i, 'door-closed'],
	[/^home$/i, 'door-open'],
	[/^create$/i, 'plus'],
	[/^add$/i, 'plus'],
	[/^man$/i, 'user'],
	[/^woman$/i, 'user'],
	[/^remove$/i, 'trash-2'],
	[/^keep$/i, 'check'],
	[/^unarchive$/i, 'archive-restore'],
	[/^archive$/i, 'archive'],
	[/^choose folder$/i, 'folder'],
	[/^clear$/i, 'moon'],
	[/^clear snooze$/i, 'moon'],
	[/^snooze$/i, 'moon'],
	[/^update$/i, 'check'],
	[/^1d$/i, 'moon'],
	[/^7d$/i, 'moon'],
	[/^14d$/i, 'moon'],
	[/^today$/i, 'calendar'],
	[/^\d+ days$/i, 'moon'],
	[/^stay$/i, 'equal'],
	[/^[−+-]1$/i, 'chevrons-up-down'],
	[/^skip$/i, 'skip-forward'],
	[/^start$/i, 'play'],
	[/^fill$/i, 'check'],
	[/^close$/i, 'x'],
	[/^stop$/i, 'square'],
	[/^apply$/i, 'check'],
	[/^done$/i, 'check'],
	[/^check again$/i, 'refresh-cw'],
	[/community plugins/i, 'puzzle'],
	[/templater/i, 'file-code'],
	[/meta bind/i, 'link'],
	[/github/i, 'download'],
	[/^reset/i, 'rotate-ccw'],
	[/^working/i, 'loader'],
];

/** Desktop click opens the native picker. A phone tap already does. */
export function openDesktopDatePicker(input: HTMLInputElement, isMobile = Platform.isMobile): void {
	if (isMobile) return;
	if (input.type !== 'date' && input.type !== 'time' && input.type !== 'datetime-local') return;
	const show = input.showPicker;
	if (typeof show !== 'function') return;
	try {
		show.call(input);
	} catch {
		// The picker is already open, or this browser has no showPicker.
	}
}

export function iconizeModal(root: HTMLElement): void {
	if (typeof root.querySelectorAll !== 'function') return;
	bindDatePickers(root);
	armMobileSelects(root);
	watchModalWidth(root);
	root.querySelectorAll('.setting-item-name').forEach((node) => {
		if (!(node instanceof HTMLElement) || node.closest('.rv-campaign-choice, .rv-modal-actions')) return;
		const icon = iconFor(node.textContent ?? '', PROMPT_ICONS);
		if (icon) paintIcon(node, icon);
	});
	root.querySelectorAll('.rv-locator-modal-copy, p').forEach((node) => {
		if (!(node instanceof HTMLElement) || node.classList.contains('rv-campaign-question')) return;
		const icon = iconFor(node.textContent ?? '', PROMPT_ICONS);
		if (icon) paintIcon(node, icon);
	});
	root.querySelectorAll('button').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (node.classList.contains('rv-suggest-chevron') || node.classList.contains('rv-suggest-option')) return;
		if (node.querySelector('svg')) return;
		const icon = iconFor(node.textContent ?? '', BUTTON_ICONS);
		if (!icon) return;
		paintIcon(node, icon);
	});
}

function watchModalWidth(root: HTMLElement): void {
	const modal = root.closest('.modal');
	if (!(modal instanceof HTMLElement) || modal.dataset.rvWidth === '1' || typeof ResizeObserver === 'undefined') return;
	modal.dataset.rvWidth = '1';
	const apply = (): void => {
		modal.classList.toggle('is-stacked', modal.clientWidth > 0 && modal.clientWidth < 420);
	};
	try {
		const observer = new ResizeObserver(apply);
		observer.observe(modal);
		apply();
	} catch {
		apply();
	}
}

/**
 * Phone selects do not open a native menu inside the modal under mobile
 * emulation. A tap shows the options in the page, and choosing one fires change.
 */
function armMobileSelects(root: HTMLElement): void {
	root.querySelectorAll('select').forEach((node) => {
		if (!(node instanceof HTMLSelectElement) || node.dataset.rvMenu === '1') return;
		node.dataset.rvMenu = '1';
		let stamp = 0;
		const open = (event: Event): void => {
			if (!Platform.isMobile) return;
			event.preventDefault();
			event.stopPropagation();
			const now = Date.now();
			if (now - stamp < 350) return;
			stamp = now;
			openSelectMenu(node);
		};
		node.addEventListener('pointerdown', (event) => {
			if (!Platform.isMobile) return;
			event.preventDefault();
			event.stopPropagation();
		});
		node.addEventListener('pointerup', open);
		node.addEventListener('click', open);
	});
}

function openSelectMenu(select: HTMLSelectElement): void {
	const doc = select.ownerDocument;
	doc.querySelectorAll('.rv-select-menu').forEach((node) => node.remove());
	const menu = doc.createElement('div');
	menu.className = 'rv-select-menu';
	menu.setAttribute('role', 'listbox');
	for (const option of Array.from(select.options)) {
		const button = doc.createElement('button');
		button.type = 'button';
		button.className = 'rv-select-option';
		button.textContent = option.textContent ?? option.label;
		if (option.value === select.value) button.classList.add('is-selected');
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			select.value = option.value;
			select.dispatchEvent(new Event('change', { bubbles: true }));
			menu.remove();
		});
		menu.appendChild(button);
	}
	const box = select.getBoundingClientRect();
	menu.style.left = `${Math.max(8, box.left)}px`;
	menu.style.top = `${box.bottom + 4}px`;
	menu.style.minWidth = `${Math.max(120, box.width)}px`;
	doc.body.appendChild(menu);
	const close = (event: Event): void => {
		const target = event.target;
		if (target instanceof Node && (menu.contains(target) || target === select)) return;
		menu.remove();
		doc.removeEventListener('pointerdown', close, true);
	};
	window.setTimeout(() => doc.addEventListener('pointerdown', close, true), 0);
}

function bindDatePickers(root: HTMLElement): void {
	if (root.dataset.rvDateBound === '1' || typeof root.addEventListener !== 'function') return;
	root.dataset.rvDateBound = '1';
	root.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) return;
		openDesktopDatePicker(target);
	});
}

function paintIcon(node: Element, icon: string): void {
	if (!(node instanceof HTMLElement) || node.querySelector('.rv-modal-icon')) return;
	const mark = node.ownerDocument.createElement('span');
	mark.className = 'rv-modal-icon';
	node.prepend(mark);
	setIcon(mark, icon);
}

export function nameWithIcon(setting: Setting, icon: string, name: string): Setting {
	setting.setName(name);
	const node = setting.nameEl;
	if (node instanceof HTMLElement && !node.querySelector('.rv-modal-icon')) {
		const mark = node.ownerDocument.createElement('span');
		mark.className = 'rv-modal-icon';
		node.prepend(mark);
		setIcon(mark, icon);
	}
	return setting;
}

function iconFor(text: string, table: Array<[RegExp, string]>): string | null {
	const label = text.replace(/\s+/g, ' ').trim();
	if (!label) return null;
	for (const [pattern, icon] of table) {
		if (pattern.test(label)) return icon;
	}
	return null;
}
