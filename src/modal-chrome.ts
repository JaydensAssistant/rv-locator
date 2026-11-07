import { Platform, setIcon, type Setting } from 'obsidian';
import { urgencyColorsFor, urgencyInk, type UrgencyColors, type UrgencyPaletteId } from './urgency-palette';
import { RESTROOM_MAN, RESTROOM_WOMAN } from './person-meta';

const PROMPT_ICONS: Array<[RegExp, string]> = [
	[/literature|publication/i, 'book-open'],
	[/media/i, 'clapperboard'],
	[/lesson/i, 'book-marked'],
	[/where you started|start date|started/i, 'calendar'],
	[/where you ended|end date|ended/i, 'calendar'],
	[/companion|who came|who was taken|publisher came/i, 'users'],
	[/address/i, 'map-pin'],
	[/estimated age|^age$/i, 'sprout'],
	[/name/i, 'user'],
	[/man \/ woman|gender/i, 'person-standing'],
	[/priority/i, 'gauge'],
	[/county|home region|region/i, 'map'],
	[/were they home|\bhome\b/i, 'door-open'],
	[/^daypart$/i, 'sun'],
	[/weekday|^day$/i, 'calendar'],
	[/^hour$/i, 'clock'],
	[/minutes/i, 'timer'],
	[/^label$/i, 'tag'],
	[/time/i, 'clock'],
	[/try or avoid/i, 'list-checks'],
	[/campaign/i, 'flag'],
	[/covered/i, 'book-alert'],
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
	[/^save and continue$/i, 'check'],
	[/^cancel$/i, 'x'],
	[/^save$/i, 'check'],
	[/^rename$/i, 'pencil'],
	[/^delete/i, 'trash-2'],
	[/^start campaign$/i, 'flag'],
	[/^end campaign/i, 'book-x'],
	[/^covered$/i, 'book-check'],
	[/^not this time$/i, 'book-x'],
	[/^not home$/i, 'door-closed'],
	[/^home$/i, 'door-open'],
	[/^create$/i, 'plus'],
	[/^add$/i, 'plus'],
	[/^man$/i, RESTROOM_MAN],
	[/^woman$/i, RESTROOM_WOMAN],
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
	[/meta bind/i, 'blocks'],
	[/github/i, 'github'],
	[/^reset/i, 'rotate-ccw'],
	[/^working/i, 'loader'],
];

/** A tap anywhere on a date field opens the native picker, on phone and desktop. */
export function openDesktopDatePicker(input: HTMLInputElement, _isMobile = Platform.isMobile): void {
	if (input.type !== 'date' && input.type !== 'time' && input.type !== 'datetime-local') return;
	try {
		input.focus({ preventScroll: true });
	} catch {
		try {
			input.focus();
		} catch {
			/* The field cannot take focus yet. */
		}
	}
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
	const open = (event: Event): void => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) return;
		// A tap fires pointerup and click. The second showPicker throws.
		const now = Date.now();
		const last = Number(target.dataset.rvPickerAt ?? '0');
		if (now - last < 400) return;
		target.dataset.rvPickerAt = String(now);
		openDesktopDatePicker(target);
	};
	root.addEventListener('pointerup', open);
	root.addEventListener('click', open);
}

function paintIcon(node: Element, icon: string): void {
	if (!(node instanceof HTMLElement) || node.querySelector('.rv-modal-icon')) return;
	const mark = node.ownerDocument.createElement('span');
	mark.className = 'rv-modal-icon';
	mark.dataset.rvGlyph = icon;
	node.prepend(mark);
	setIcon(mark, icon);
}

/** Band 0 of the palette the user has selected, including a custom palette. */
export function generalModalAccent(settings: { urgencyPalette: UrgencyPaletteId; urgencyCustomColors: UrgencyColors }): string {
	return urgencyColorsFor(settings.urgencyPalette, settings.urgencyCustomColors)[0] ?? '#1f8a4c';
}

/** Primary buttons. RV notes use that note's urgency. General modals use band 0. */
export function markModalTone(modalEl: HTMLElement, tone: 'general' | 'rv', accent = ''): void {
	modalEl.addClass(tone === 'rv' ? 'rv-modal-rv' : 'rv-modal-general');
	const drop = tone === 'rv' ? 'rv-modal-general' : 'rv-modal-rv';
	if (typeof modalEl.removeClass === 'function') modalEl.removeClass(drop);
	else modalEl.classList.remove(drop);
	if (typeof modalEl.style?.setProperty !== 'function') return;
	const color = accent.trim() || '#1f8a4c';
	modalEl.style.setProperty('--rv-modal-accent', color);
	modalEl.style.setProperty('--rv-modal-ink', urgencyInk(color));
	modalEl.style.setProperty('--rv-menu-ink', color);
}

export function nameWithIcon(setting: Setting, icon: string, name: string): Setting {
	setting.setName(name);
	const node = setting.nameEl;
	if (node instanceof HTMLElement && !node.querySelector('.rv-modal-icon')) {
		const mark = node.ownerDocument.createElement('span');
		mark.className = 'rv-modal-icon';
		mark.dataset.rvGlyph = icon;
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
