import { ItemView, WorkspaceLeaf } from 'obsidian';

export const MAP_SOON_VIEW_TYPE = 'rv-locator-map';

/** Placeholder until a real map ships. Earth and route-from-address open this. */
export class MapSoonView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return MAP_SOON_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Map';
	}

	getIcon(): 'earth' {
		return 'earth';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('rv-map-soon');
		this.contentEl.createEl('h2', { text: 'Map' });
		this.contentEl.createEl('p', { text: 'Coming soon.' });
	}
}
