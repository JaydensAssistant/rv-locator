import { FuzzySuggestModal, TFile, type App } from 'obsidian';
import { iconizeModal, markModalTone } from './modal-chrome';
import { rvDisplayTitle } from './stamp-mask';

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
		const folder = file.parent?.path;
		const name = rvDisplayTitle(file.basename);
		return folder && folder !== '/' ? `${folder}/${name}` : name;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}

	onOpen(): void {
		void super.onOpen();
		this.setTitle('Add a hub note');
		this.modalEl.addClass('rv-locator-modal');
		markModalTone(this.modalEl, 'general');
		iconizeModal(this.modalEl);
	}
}
