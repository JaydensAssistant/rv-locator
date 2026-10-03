import { FuzzySuggestModal, Modal, Notice, Setting, SuggestModal, TFile, TFolder, Vault, type App } from 'obsidian';
import { emptyShare, type VisitShare } from './catalog';
import { mountShareFields, type ShareFieldOptions } from './catalog-fields';
import { iconizeModal } from './modal-chrome';
import { mountAlwaysChevron } from './suggest-field';
import { createCompanionPromptGate, type CompanionPromptGate } from './companion-prompt';
import { companionChoices, matchingCompanion, type CompanionSuggestion } from './companions';
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
		iconizeModal(this.modalEl);
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

	onOpen(): void {
		void super.onOpen();
		this.setTitle('Choose a folder');
		this.modalEl.addClass('rv-locator-modal');
		iconizeModal(this.modalEl);
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
			text: 'Looks up notes that have an address and no location. A folder includes its subfolders, and Address is never written.',
		});
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'A hit is saved without asking only when Geoapify confidence is 1.00 and it is the only hit in a home county. Otherwise you pick a row, which saves Location as two quoted strings plus City and a Map Link of Address, and closing the picker skips that note.',
		});
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'If Successful Visits is missing, Visits is copied into it. When Address and Location are already set and City is missing, City is filled from Address; Last Attempted is left alone, and distance is not written.',
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
			.setName('Include notes that already have a location')
			.setDesc('Looks them up again. Address is still never written.')
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
		iconizeModal(contentEl);
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
			text: 'Copies Visits into Successful Visits only when it is missing. Does not change Visits or add Last Attempted.',
		});
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'When City is missing on a note that already has Address and Location, City is filled from the address. No lookup is made.',
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
		iconizeModal(contentEl);
	}
}

export type VisitMenuAnswer = 'home' | 'miss' | 'past' | 'archive';

export class VisitConfirmModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private displayName: string,
		private onAnswer: (answer: VisitMenuAnswer | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Log a visit');
		this.modalEl.addClass('rv-locator-modal');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: `Log a visit on “${this.displayName}”. Address is not changed.`,
		});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Home');
				button.setCta();
				button.onClick(() => this.finish('home'));
			})
			.addButton((button) => {
				button.setButtonText('Not home');
				button.onClick(() => this.finish('miss'));
			})
			.addButton((button) => {
				button.setButtonText('Log past visit');
				button.onClick(() => this.finish('past'));
			});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Archive');
				button.onClick(() => this.finish('archive'));
			})
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.finish(null));
			});
		iconizeModal(contentEl);
	}

	onClose(): void {
		if (!this.answered) this.onAnswer(null);
		this.contentEl.empty();
	}

	private finish(answer: VisitMenuAnswer | null): void {
		if (this.answered) return;
		this.answered = true;
		this.onAnswer(answer);
		this.close();
	}
}

export type CoverageDecision = 'yes' | 'no' | 'skip';

export interface CompanionCampaignPrompt {
	name: string;
	/** him, her, or them. */
	pronoun?: 'him' | 'her' | 'them';
	onDecision: (decision: CoverageDecision) => void;
}

export function coveragePronoun(gender: unknown): 'him' | 'her' | 'them' {
	const value = typeof gender === 'string' ? gender.trim().toLowerCase() : '';
	if (value === 'man' || value === 'male') return 'him';
	if (value === 'woman' || value === 'female') return 'her';
	return 'them';
}

export function coverageQuestion(pronoun: 'him' | 'her' | 'them', campaign: string): string {
	return `Did you cover ${pronoun} with the ${campaign} campaign?`;
}

/**
 * Companion for an at-home visit. The field is the same companion dropdown
 * as Log past visit. Picking a name does not log. The visit is logged when
 * they press Log visit, after the coverage choice when a campaign is active.
 * Cancel and a click outside do not log.
 */
export class CompanionSuggestModal extends Modal {
	private readonly gate: CompanionPromptGate;
	private covered = true;
	private decided = false;
	private companion = '';
	private companionPicked = false;
	private companionInput: { setValue: (value: string) => void; inputEl?: HTMLElement } | null = null;

	private share: VisitShare = emptyShare();

	constructor(
		app: App,
		private recent: readonly string[],
		onDone: (name: string | null | false) => void,
		private campaign: CompanionCampaignPrompt | null = null,
		private literature: (ShareFieldOptions & { onShare: (share: VisitShare) => void }) | null = null,
	) {
		super(app);
		this.gate = createCompanionPromptGate(onDone);
		if (literature) {
			this.share = {
				...literature.initial,
				lessonFrom: literature.initial.lessonFrom || literature.initial.lessonTo,
			};
		}
	}

	onOpen(): void {
		this.setTitle('Who came with you?');
		this.modalEl.addClass('rv-locator-modal', 'rv-locator-companion-modal');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Optional. Choose a companion if someone came along, then log the visit. Cancel does not log it.',
		});
		new Setting(contentEl)
			.setName('Companion')
			.setDesc('Optional.')
			.addText((text) => {
				text.setPlaceholder('Companion (optional)');
				this.companionInput = text;
				const listId = `rv-locator-companions-${Date.now()}`;
				const list = contentEl.createEl('datalist', { attr: { id: listId } });
				for (const name of this.recent) {
					if (name.trim()) list.createEl('option', { attr: { value: name } });
				}
				text.inputEl.setAttribute('list', listId);
				text.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					this.commitCompanionMatch();
				});
				text.inputEl.addEventListener('blur', () => this.commitCompanionMatch());
				text.onChange((value) => {
					this.companion = value;
					const match = matchingCompanion(this.getSuggestions(value), value);
					this.markCompanion(match != null && match.value === value.trim());
				});
				mountAlwaysChevron(text.inputEl, () => this.getSuggestions(this.companion).map((item) => item.label), (picked) => {
					const match = this.getSuggestions(this.companion).find((item) => item.label === picked || item.value === picked);
					this.selectCompanion(match?.value ?? picked);
				});
			});
		if (this.literature) {
			mountShareFields(contentEl, this.literature, (next) => {
				this.share = next;
				this.literature?.onShare(next);
			});
		}
		if (this.campaign) {
			const pronoun = this.campaign.pronoun ?? 'them';
			contentEl.createEl('p', {
				cls: 'rv-locator-modal-copy',
				text: coverageQuestion(pronoun, this.campaign.name),
			});
			const choice = contentEl.createDiv('rv-locator-suggest-actions');
			const yes = choice.createEl('button', { text: 'Covered', attr: { type: 'button' } });
			const no = choice.createEl('button', { text: 'Not this time', attr: { type: 'button' } });
			yes.classList.add('mod-cta');
			yes.addEventListener('click', () => {
				this.covered = true;
				yes.classList.add('mod-cta');
				no.classList.remove('mod-cta');
			});
			no.addEventListener('click', () => {
				this.covered = false;
				no.classList.add('mod-cta');
				yes.classList.remove('mod-cta');
			});
		}
		const bar = contentEl.createDiv('rv-locator-suggest-actions is-end');
		const log = bar.createEl('button', { text: 'Log visit', attr: { type: 'button' } });
		log.classList.add('mod-cta');
		log.addEventListener('click', () => this.commitLog());
		const cancel = bar.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		cancel.addEventListener('click', () => {
			this.gate.cancel();
			this.close();
		});
		this.containerEl.addEventListener('pointerdown', (event: PointerEvent) => {
			this.onDimPointerDown(event.target);
		});
		iconizeModal(contentEl);
	}

	/** A press on the dim layer behind the dialog cancels. A press inside the dialog does not. */
	onDimPointerDown(target: EventTarget | null): void {
		const modal = this.modalEl as unknown as { contains?: (node: EventTarget) => boolean };
		if (target && modal.contains?.(target)) return;
		this.gate.cancel();
		this.close();
	}

	private finishCoverage(decision: CoverageDecision): void {
		if (!this.campaign || this.decided) return;
		this.decided = true;
		this.campaign.onDecision(decision);
	}

	/**
	 * Esc closes the dialog before a choice. The dismiss waits so a choice in
	 * this turn still wins. A click outside cancels and does not log.
	 */
	onClose(): void {
		this.gate.closed((run) => { window.setTimeout(run, 0); });
		this.contentEl.empty();
	}

	getSuggestions(query: string): CompanionSuggestion[] {
		return companionChoices(this.recent, query);
	}

	private markCompanion(picked: boolean): void {
		this.companionPicked = picked;
		this.companionInput?.inputEl?.classList.toggle('is-selected', picked);
	}

	private selectCompanion(value: string): void {
		this.companion = value;
		this.companionInput?.setValue(value);
		this.markCompanion(true);
	}

	private commitCompanionMatch(): void {
		if (this.companionPicked) return;
		const match = matchingCompanion(this.getSuggestions(this.companion), this.companion);
		if (!match) return;
		this.selectCompanion(match.value);
	}

	private commitLog(): void {
		this.commitCompanionMatch();
		this.finishCoverage(this.covered ? 'yes' : 'no');
		this.literature?.onShare(this.share);
		const name = this.companion.trim();
		if (name) this.gate.choose(name);
		else this.gate.skip();
		this.close();
	}

	/** A finished choice. Highlighting a companion does not call this. */
	onChooseSuggestion(choice: CompanionSuggestion): void {
		this.companion = choice.value;
		this.companionPicked = true;
		this.commitLog();
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
