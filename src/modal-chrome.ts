import { Platform, setIcon, type Setting } from 'obsidian';

const PROMPT_ICONS: Array<[RegExp, string]> = [
	[/literature|publication/i, 'book-open'],
	[/media/i, 'clapperboard'],
	[/lesson/i, 'book-marked'],
	[/where you started|start date|started/i, 'flag'],
	[/where you ended|end date|ended/i, 'flag-off'],
	[/companion|who came|who was taken/i, 'users'],
	[/address/i, 'map-pin'],
	[/name/i, 'user'],
	[/man \/ woman|gender/i, 'person-standing'],
	[/priority/i, 'gauge'],
	[/county|home region|region/i, 'map'],
	[/were they home|\bhome\b/i, 'door-open'],
	[/weekday|daypart|\bday\b/i, 'calendar'],
	[/time/i, 'clock'],
	[/try or avoid/i, 'list-checks'],
	[/covered|campaign/i, 'flag'],
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
	[/^start campaign$/i, 'flag'],
	[/^end campaign/i, 'flag-off'],
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
	[/^clear snooze$/i, 'moon'],
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
	root.querySelectorAll('.setting-item-name').forEach((node) => {
		paintIcon(node, iconFor(node.textContent ?? '', PROMPT_ICONS) ?? 'circle-dot');
	});
	root.querySelectorAll('.rv-locator-modal-copy, p').forEach((node) => {
		paintIcon(node, iconFor(node.textContent ?? '', PROMPT_ICONS) ?? 'info');
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
