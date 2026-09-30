import { Modal, Notice, Setting, SuggestModal, type App } from 'obsidian';
import { dateInputValue, describeVisit, hourLabel, isFutureVisit, roundedHour, visitWhenFrom, type VisitEntry, type VisitFacts } from './visit-editor';

export interface VisitEditOptions {
	title: string;
	/** Prefilled visit when editing. A new past visit starts on Home, now. */
	initial?: VisitFacts | null;
	recentCompanions: readonly string[];
	onSave: (facts: VisitFacts) => void;
	/** Shown as Delete visit when set. */
	onDelete?: () => void;
}

/**
 * Home or Not home, the day, the approximate hour, and for a Home who was
 * taken. A time later than now is refused.
 */
export class VisitEditModal extends Modal {
	private home = true;
	private dateText = '';
	private hour = 12;
	private companion = '';
	private companionSetting: Setting | null = null;

	constructor(app: App, private options: VisitEditOptions) {
		super(app);
		const start = options.initial ?? { when: new Date(), home: true, companion: '' };
		const rounded = options.initial ? { date: start.when, hour: start.when.getHours() } : roundedHour(start.when);
		this.home = start.home;
		this.dateText = dateInputValue(rounded.date);
		this.hour = rounded.hour;
		this.companion = start.companion;
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		this.modalEl.addClass('rv-locator-modal', 'rv-locator-visit-editor');
		const { contentEl } = this;

		new Setting(contentEl)
			.setName('Were they home?')
			.addDropdown((dropdown) => {
				dropdown.addOption('home', 'Home');
				dropdown.addOption('miss', 'Not home');
				dropdown.setValue(this.home ? 'home' : 'miss');
				dropdown.onChange((value) => {
					this.home = value === 'home';
					this.syncCompanion();
				});
			});

		new Setting(contentEl)
			.setName('Day')
			.addText((text) => {
				text.inputEl.type = 'date';
				text.inputEl.max = dateInputValue(new Date());
				text.setValue(this.dateText);
				text.onChange((value) => { this.dateText = value; });
			});

		new Setting(contentEl)
			.setName('Approximate time')
			.addDropdown((dropdown) => {
				for (let hour = 0; hour < 24; hour += 1) dropdown.addOption(String(hour), hourLabel(hour));
				dropdown.setValue(String(this.hour));
				dropdown.onChange((value) => { this.hour = Number(value); });
			});

		this.companionSetting = new Setting(contentEl)
			.setName('Who was taken?')
			.setDesc('One person, or leave blank.')
			.addText((text) => {
				text.setPlaceholder('Nobody');
				text.setValue(this.companion);
				text.onChange((value) => { this.companion = value; });
				const listId = `rv-locator-companions-${Date.now()}`;
				const list = contentEl.createEl('datalist', { attr: { id: listId } });
				for (const name of this.options.recentCompanions) list.createEl('option', { attr: { value: name } });
				text.inputEl.setAttribute('list', listId);
			});
		this.syncCompanion();

		const actions = new Setting(contentEl);
		if (this.options.onDelete) {
			actions.addButton((button) => {
				button.setButtonText('Delete visit');
				button.setWarning();
				button.onClick(() => {
					this.close();
					this.options.onDelete?.();
				});
			});
		}
		actions
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText('Save');
				button.setCta();
				button.onClick(() => this.save());
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private syncCompanion(): void {
		if (this.companionSetting) this.companionSetting.settingEl.hidden = !this.home;
	}

	private save(): void {
		const when = visitWhenFrom(this.dateText, this.hour);
		if (!when) {
			new Notice('Choose the day of the visit.');
			return;
		}
		if (isFutureVisit(when, new Date())) {
			new Notice('That time has not happened yet.');
			return;
		}
		this.close();
		this.options.onSave({ when, home: this.home, companion: this.home ? this.companion.trim() : '' });
	}
}

/** Visits on one note, newest first, for editing or deleting from the command palette. */
export class VisitPickModal extends SuggestModal<VisitEntry> {
	constructor(app: App, private visits: readonly VisitEntry[], private onPick: (entry: VisitEntry) => void) {
		super(app);
		this.setPlaceholder('Choose a visit to edit or delete');
		this.emptyStateText = 'No visits on this note.';
	}

	getSuggestions(query: string): VisitEntry[] {
		const needle = query.trim().toLowerCase();
		return [...this.visits].reverse().filter((entry) => describeVisit(entry).toLowerCase().includes(needle));
	}

	renderSuggestion(entry: VisitEntry, el: HTMLElement): void {
		el.setText(describeVisit(entry));
	}

	onChooseSuggestion(entry: VisitEntry): void {
		this.onPick(entry);
	}
}

export interface ConfirmOptions {
	title: string;
	message: string;
	confirmText: string;
	warning?: boolean;
	onConfirm: () => void;
}

export class ConfirmActionModal extends Modal {
	constructor(app: App, private options: ConfirmOptions) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		this.modalEl.addClass('rv-locator-modal');
		this.contentEl.createEl('p', { cls: 'rv-locator-modal-copy', text: this.options.message });
		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText(this.options.confirmText);
				if (this.options.warning) button.setWarning();
				else button.setCta();
				button.onClick(() => {
					this.close();
					this.options.onConfirm();
				});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
