import { FuzzySuggestModal, Modal, Notice, Setting, SuggestModal, TFile, TFolder, Vault, type App } from 'obsidian';
import { PRIVACY_NOTICE } from './constants';
import { schedulePickerDismiss } from './picker-gate';
import type { GeocodeHit } from './types';
import type RVLocatorPlugin from './main';

export class GeocodeSuggestModal extends SuggestModal<GeocodeHit> {
	private closed = false;
	private lookingUp = false;
	private chose = false;
	heading = 'Choose a location';

	constructor(
		app: App,
		private hits: GeocodeHit[],
		private fromCache: boolean,
		private onPick: (hit: GeocodeHit) => void,
		private onRefetch: () => Promise<GeocodeHit[]>,
		private onDismiss: () => void = () => {},
	) {
		super(app);
		this.emptyStateText = 'No matches for that address.';
		this.limit = 10;
	}

	onOpen(): void {
		void super.onOpen();
		this.setTitle(this.heading);
		this.setPlaceholder('Filter results');
		this.setInstructions([
			{ command: '↑↓', purpose: 'to navigate' },
			{ command: '↵', purpose: 'to use result' },
			{ command: 'esc', purpose: 'to cancel' },
		]);

		const bar = this.modalEl.createDiv('rv-locator-suggest-actions');
		const button = bar.createEl('button', { text: 'Look up again', cls: 'mod-cta' });
		button.addEventListener('click', () => {
			void this.refetch(button);
		});
		const privacy = this.modalEl.createDiv({ cls: 'rv-locator-privacy' });
		privacy.setText(this.fromCache
			? `Showing a saved lookup. Look up again sends the address to Geoapify. ${PRIVACY_NOTICE}`
			: PRIVACY_NOTICE);
		this.modalEl.addClass('rv-locator-modal');
	}

	onClose(): void {
		this.closed = true;
		super.onClose();
		schedulePickerDismiss(
			() => this.chose,
			() => this.onDismiss(),
			(run) => { window.setTimeout(run, 0); },
		);
	}

	getSuggestions(query: string): GeocodeHit[] {
		const needle = query.trim().toLowerCase();
		if (!needle) return this.hits;
		return this.hits.filter((hit) => {
			const haystack = `${hit.formattedAddress} ${hit.city ?? ''} ${hit.resultType ?? ''}`.toLowerCase();
			return haystack.includes(needle);
		});
	}

	renderSuggestion(hit: GeocodeHit, el: HTMLElement): void {
		el.empty();
		el.createDiv({ cls: 'rv-locator-suggest-title', text: hit.formattedAddress });
		const bits = [
			hit.resultType,
			hit.confidence != null ? `confidence ${hit.confidence.toFixed(2)}` : '',
			`${hit.lat}, ${hit.lon}`,
		].filter(Boolean);
		el.createDiv({ cls: 'rv-locator-suggest-meta', text: bits.join(' · ') });
	}

	onChooseSuggestion(hit: GeocodeHit): void {
		this.chose = true;
		this.onPick(hit);
	}

	private async refetch(button: HTMLButtonElement): Promise<void> {
		if (this.lookingUp) return;
		this.lookingUp = true;
		button.disabled = true;
		button.setText('Looking up…');
		try {
			const hits = await this.onRefetch();
			if (this.closed) return;
			this.hits = hits;
			this.fromCache = false;
			this.inputEl.value = '';
			this.inputEl.dispatchEvent(new Event('input'));
		} finally {
			this.lookingUp = false;
			if (!this.closed) {
				button.disabled = false;
				button.setText('Look up again');
			}
		}
	}
}

export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	constructor(app: App, private onPick: (folder: TFolder) => void) {
		super(app);
		this.setPlaceholder('Filter folders');
	}

	getItems(): TFolder[] {
		return this.app.vault.getAllFolders(true);
	}

	getItemText(item: TFolder): string {
		return item.path || '/';
	}

	onChooseItem(item: TFolder): void {
		this.onPick(item);
	}
}

export interface BulkGeocodeChoice {
	scope: 'vault' | 'folder';
	folderPath: string;
	force: boolean;
}

export class BulkGeocodeModal extends Modal {
	private target: 'vault' | 'folder';
	private folderPath: string;
	private force = false;
	private running = false;
	private previewGen = 0;
	private previewEl: HTMLElement | null = null;

	constructor(
		app: App,
		private plugin: RVLocatorPlugin,
		private onStart: (choice: BulkGeocodeChoice, report: (message: string) => void) => Promise<void>,
	) {
		super(app);
		const active = app.workspace.getActiveFile();
		this.folderPath = active?.parent?.path ?? '';
		this.target = active ? 'folder' : 'vault';
	}

	onOpen(): void {
		this.setTitle('Bulk geocode');
		this.modalEl.addClass('rv-locator-modal');
		this.render();
	}

	onClose(): void {
		this.plugin.requestBulkStop();
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Notes with an address and no location are looked up. A folder includes its subfolders. Address is never written. A result is saved without this picker only when Geoapify rank.confidence is 1.00 and that hit is the only one in a home-base county. Otherwise this picker opens. Choosing a row saves Location as two quoted strings, plus City and a Map Link that searches the note’s Address. Closing the picker skips that note. Distance is not written. If Successful Visits is missing and Visits is a number, that number is copied. Notes that already have Address and Location get City filled from the address when City is missing. Last Attempted is left alone.',
		});

		new Setting(contentEl)
			.setName('Scope')
			.setDesc('A folder includes its subfolders.')
			.addDropdown((dropdown) => {
				dropdown.addOption('folder', 'Folder');
				dropdown.addOption('vault', 'Entire vault');
				dropdown.setValue(this.target);
				dropdown.onChange((value) => {
					this.target = value === 'vault' ? 'vault' : 'folder';
					this.render();
				});
			});

		if (this.target === 'folder') {
			new Setting(contentEl)
				.setName('Folder')
				.setDesc(this.folderPath || '/')
				.addButton((button) => {
					button.setButtonText('Choose folder');
					button.onClick(() => {
						const picker = new FolderSuggestModal(this.app, (folder) => {
							this.folderPath = folder.path;
							this.render();
						});
						picker.open();
					});
				});
		}

		new Setting(contentEl)
			.setName('Re-geocode notes that already have a location')
			.addToggle((toggle) => {
				toggle.setValue(this.force);
				toggle.onChange((value) => {
					this.force = value;
					void this.refreshPreview();
				});
			});

		this.previewEl = contentEl.createDiv({ cls: 'rv-locator-modal-copy' });
		this.previewEl.setText('Counting notes…');
		void this.refreshPreview();

		const progress = contentEl.createDiv({ cls: 'rv-locator-progress' });
		progress.hide();

		let dismissLabel: ((label: string) => void) | null = null;
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Start');
				button.setCta();
				button.onClick(() => {
					if (this.running) return;
					this.running = true;
					button.setDisabled(true);
					button.setButtonText('Working…');
					dismissLabel?.('Stop');
					progress.show();
					progress.setText('Starting…');
					void this.onStart(
						{ scope: this.target, folderPath: this.folderPath, force: this.force },
						(message) => {
							if (progress.isShown()) progress.setText(message);
						},
					).finally(() => {
						this.running = false;
						if (progress.isShown()) {
							button.setDisabled(false);
							button.setButtonText('Start');
							dismissLabel?.('Close');
						}
					});
				});
			})
			.addButton((button) => {
				dismissLabel = (label) => {
					button.setButtonText(label);
				};
				button.setButtonText(this.running ? 'Stop' : 'Close');
				button.onClick(() => {
					if (this.running) {
						this.plugin.requestBulkStop();
						new Notice('Stopping after the current note.');
						return;
					}
					this.close();
				});
			});
	}

	private async refreshPreview(): Promise<void> {
		const preview = this.previewEl;
		if (!preview?.isConnected) return;
		const gen = ++this.previewGen;
		if (this.target === 'folder' && !this.folderExists()) {
			preview.setText('That folder was not found.');
			return;
		}
		preview.setText('Counting notes…');
		const notes = collectNotes(this.app, { scope: this.target, folderPath: this.folderPath });
		const planned = await this.plugin.countBulk(notes, this.force);
		if (gen !== this.previewGen || !preview.isConnected) return;
		if (this.force) {
			preview.setText(`${planned.pending} notes will be looked up, including ${planned.skipped} that already have a location.`);
			return;
		}
		preview.setText(`${planned.pending} notes will be looked up. ${planned.skipped} already have a location.`);
	}

	private folderExists(): boolean {
		if (this.folderPath === '' || this.folderPath === '/') return true;
		return this.app.vault.getFolderByPath(this.folderPath) != null;
	}
}

export class SuccessfulVisitsModal extends Modal {
	private target: 'vault' | 'folder';
	private folderPath: string;
	private running = false;

	constructor(
		app: App,
		private plugin: RVLocatorPlugin,
		private onStart: (choice: Pick<BulkGeocodeChoice, 'scope' | 'folderPath'>, report: (message: string) => void) => Promise<void>,
	) {
		super(app);
		const active = app.workspace.getActiveFile();
		this.folderPath = active?.parent?.path ?? '';
		this.target = active ? 'folder' : 'vault';
	}

	onOpen(): void {
		this.setTitle('Fill Successful Visits');
		this.modalEl.addClass('rv-locator-modal');
		this.render();
	}

	onClose(): void {
		this.plugin.requestBulkStop();
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Copies Visits into Successful Visits when that property is missing. Notes that already have Successful Visits are left alone. This does not invent Last Attempted or change Visits. When City is missing and the note already has Address and Location, City is filled from the address. No geocode request is made.',
		});

		new Setting(contentEl)
			.setName('Scope')
			.setDesc('A folder includes its subfolders.')
			.addDropdown((dropdown) => {
				dropdown.addOption('folder', 'Folder');
				dropdown.addOption('vault', 'Entire vault');
				dropdown.setValue(this.target);
				dropdown.onChange((value) => {
					this.target = value === 'vault' ? 'vault' : 'folder';
					this.render();
				});
			});

		if (this.target === 'folder') {
			new Setting(contentEl)
				.setName('Folder')
				.setDesc(this.folderPath || '/')
				.addButton((button) => {
					button.setButtonText('Choose folder');
					button.onClick(() => {
						const picker = new FolderSuggestModal(this.app, (folder) => {
							this.folderPath = folder.path;
							this.render();
						});
						picker.open();
					});
				});
		}

		const progress = contentEl.createDiv({ cls: 'rv-locator-progress' });
		progress.hide();

		let dismissLabel: ((label: string) => void) | null = null;
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Fill');
				button.setCta();
				button.onClick(() => {
					if (this.running) return;
					this.running = true;
					button.setDisabled(true);
					button.setButtonText('Working…');
					dismissLabel?.('Stop');
					progress.show();
					progress.setText('Starting…');
					void this.onStart(
						{ scope: this.target, folderPath: this.folderPath },
						(message) => {
							if (progress.isShown()) progress.setText(message);
						},
					).finally(() => {
						this.running = false;
						if (progress.isShown()) {
							button.setDisabled(false);
							button.setButtonText('Fill');
							dismissLabel?.('Close');
						}
					});
				});
			})
			.addButton((button) => {
				dismissLabel = (label) => {
					button.setButtonText(label);
				};
				button.setButtonText('Close');
				button.onClick(() => {
					if (this.running) {
						this.plugin.requestBulkStop();
						new Notice('Stopping after the current note.');
						return;
					}
					this.close();
				});
			});
	}
}

export class VisitConfirmModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private displayName: string,
		private onAnswer: (answer: 'home' | 'miss' | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Were they home?');
		this.modalEl.addClass('rv-locator-modal');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: `Log a visit on “${this.displayName}”. Address is not changed.`,
		});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Yes');
				button.setCta();
				button.onClick(() => this.finish('home'));
			})
			.addButton((button) => {
				button.setButtonText('No');
				button.onClick(() => this.finish('miss'));
			})
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.finish(null));
			});
	}

	onClose(): void {
		if (!this.answered) this.onAnswer(null);
		this.contentEl.empty();
	}

	private finish(answer: 'home' | 'miss' | null): void {
		if (this.answered) return;
		this.answered = true;
		this.onAnswer(answer);
		this.close();
	}
}

export function collectNotes(app: App, choice: Pick<BulkGeocodeChoice, 'scope' | 'folderPath'>): TFile[] {
	if (choice.scope === 'vault') return app.vault.getMarkdownFiles();
	const folder = choice.folderPath === '' || choice.folderPath === '/'
		? app.vault.getRoot()
		: app.vault.getFolderByPath(choice.folderPath);
	if (!folder) return [];
	const files: TFile[] = [];
	Vault.recurseChildren(folder, (child) => {
		if (child instanceof TFile && child.extension === 'md') files.push(child);
	});
	return files;
}
