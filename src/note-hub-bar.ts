import { setIcon, type IconName } from 'obsidian';

/** The hub bottom bar, mounted on an RV note so the map does not jump. */
export interface NoteHubBarHost {
	noteMapLit(path: string): boolean;
	toggleMap(path: string): void;
	createNewRv(): void;
	openCampaign(): void;
	openSearch(path: string): void;
}

/** Same slots as the hub bar. Sort and Filters stay disabled on a note. */
export function mountNoteHubBar(leaf: HTMLElement, path: string, host: NoteHubBarHost): HTMLElement {
	const found = leaf.querySelector(':scope > .rv-note-hub-bar');
	let bar: HTMLElement;
	if (found instanceof HTMLElement) {
		bar = found;
	} else {
		const doc = leaf.ownerDocument;
		bar = doc.createElement('div');
		bar.className = 'rv-locator-sortbar rv-note-hub-bar';
		const actions = doc.createElement('div');
		actions.className = 'rv-locator-toolbar-actions';
		bar.appendChild(actions);
		const make = (label: string, icon: IconName, cls: string, disabled: boolean): HTMLButtonElement => {
			const button = doc.createElement('button');
			button.type = 'button';
			button.className = cls;
			button.setAttribute('aria-label', label);
			if (disabled) {
				button.disabled = true;
				button.setAttribute('aria-disabled', 'true');
			}
			setIcon(button, icon);
			actions.appendChild(button);
			return button;
		};
		make('Sort', 'arrow-up-down', 'rv-locator-toolbar-quiet', true);
		const search = make('Search', 'search', 'rv-locator-toolbar-quiet', false);
		const map = make('Map', 'earth', 'rv-locator-toolbar-quiet rv-note-bar-earth', false);
		const flag = make('Campaign', 'flag', 'rv-locator-toolbar-quiet', false);
		make('Filters', 'list-filter', 'rv-locator-toolbar-quiet rv-locator-filter', true);
		const create = make('New RV', 'plus', 'rv-locator-new-rv', false);
		const current = (): string => bar instanceof HTMLElement ? (bar.dataset.rvPath ?? '') : '';
		search.addEventListener('click', () => host.openSearch(current()));
		map.addEventListener('click', () => host.toggleMap(current()));
		flag.addEventListener('click', () => host.openCampaign());
		create.addEventListener('click', () => host.createNewRv());
		leaf.appendChild(bar);
	}
	bar.dataset.rvPath = path;
	const map = bar.querySelector('.rv-note-bar-earth');
	if (map instanceof HTMLElement) {
		map.dataset.rvPath = path;
		map.classList.toggle('is-on', host.noteMapLit(path));
	}
	return bar;
}

export function clearNoteHubBar(leaf: HTMLElement): void {
	leaf.querySelector(':scope > .rv-note-hub-bar')?.remove();
	leaf.classList.remove('is-rv-note');
}
