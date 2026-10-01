import { FuzzySuggestModal, TFile, type App } from 'obsidian';

/** Every markdown note in the vault. No Dataview query, so no Dataview toast. */
export class HubFileSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder('Add a hub note');
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}
