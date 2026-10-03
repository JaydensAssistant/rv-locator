import { Modal, Notice, Setting, SuggestModal, type App } from 'obsidian';
import { emptyShare, type VisitShare } from './catalog';
import { mountShareFields, type ShareFieldOptions } from './catalog-fields';
import { iconizeModal } from './modal-chrome';
import { mountAlwaysChevron } from './suggest-field';
import { dateInputValue, defaultPastVisitTime, describeVisit, hourLabel, isFutureVisit, visitWhenFrom, type VisitEntry, type VisitFacts } from './visit-editor';

export interface VisitEditOptions {
	title: string;
	/** Prefilled visit when editing. A new past visit starts on Home, now. */
	initial?: VisitFacts | null;
	recentCompanions: readonly string[];
	/** When set, a home visit can mark the RV covered for this campaign. */
	campaignName?: string;
	onCovered?: (covered: boolean) => void;
	onSave: (facts: VisitFacts) => void;
	/** Shown as Delete visit when set. */
	onDelete?: () => void;
	share?: ShareFieldOptions;
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
	private covered = false;
	private companionSetting: Setting | null = null;
	private campaignSetting: Setting | null = null;
	private share: VisitShare = emptyShare();

	constructor(app: App, private options: VisitEditOptions) {
		super(app);
		const start = options.initial ?? { when: new Date(), home: true, companion: '' };
		const rounded = options.initial ? { date: start.when, hour: start.when.getHours() } : defaultPastVisitTime(start.when);
		this.home = start.home;
		this.dateText = dateInputValue(rounded.date);
		this.hour = rounded.hour;
		this.companion = start.companion;
		this.share = {
			publications: start.publications ?? options.share?.initial.publications ?? '',
			media: start.media ?? options.share?.initial.media ?? '',
			lesson: start.lesson ?? options.share?.initial.lesson ?? '',
			lessonFrom: start.lessonFrom ?? options.share?.initial.lessonFrom ?? '',
			lessonTo: start.lessonTo ?? options.share?.initial.lessonTo ?? '',
		};
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
				mountAlwaysChevron(text.inputEl, () => this.options.recentCompanions.filter((name) => {
					const needle = this.companion.trim().toLowerCase();
					return !needle || name.toLowerCase().includes(needle);
				}), (picked) => {
					this.companion = picked;
					text.setValue(picked);
				});
			});
		if (this.options.share) {
			mountShareFields(contentEl, { ...this.options.share, initial: this.share }, (next) => {
				this.share = next;
			});
		}
		this.syncCompanion();
		if (this.options.campaignName) {
			this.campaignSetting = new Setting(contentEl)
				.setName(`Covered with ${this.options.campaignName}?`)
				.addToggle((toggle) => {
					toggle.setValue(false);
					toggle.onChange((value) => { this.covered = value; });
				});
		}
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
		iconizeModal(contentEl);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private syncCompanion(): void {
		if (this.companionSetting) this.companionSetting.settingEl.hidden = !this.home;
		if (this.campaignSetting) this.campaignSetting.settingEl.hidden = !this.home;
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
		if (this.home && this.options.campaignName) this.options.onCovered?.(this.covered);
		this.options.onSave({
			when,
			home: this.home,
			companion: this.home ? this.companion.trim() : '',
			publications: this.share.publications.trim(),
			media: this.share.media.trim(),
			lesson: this.share.lesson.trim(),
			lessonFrom: this.share.lessonFrom.trim(),
			lessonTo: this.share.lessonTo.trim(),
		});
	}
}

/** Literature and media for a not-home log, which has no companion dialog. */
export class LiteraturePromptModal extends Modal {
	private share: VisitShare;
	private settled = false;

	constructor(
		app: App,
		private options: ShareFieldOptions,
		private onDone: (share: VisitShare | false) => void,
	) {
		super(app);
		this.share = { ...options.initial };
	}

	onOpen(): void {
		this.setTitle('Log visit');
		this.modalEl.addClass('rv-locator-modal');
		this.contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Optional. Leave both blank to log the visit without literature or media.',
		});
		mountShareFields(this.contentEl, this.options, (next) => { this.share = next; });
		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText('Log visit');
				button.setCta();
				button.onClick(() => {
					this.settled = true;
					this.onDone(this.share);
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			});
		iconizeModal(this.contentEl);
	}

	onClose(): void {
		if (!this.settled) this.onDone(false);
		this.contentEl.empty();
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

	onOpen(): void {
		void super.onOpen();
		this.setTitle('Choose a visit');
		this.modalEl.addClass('rv-locator-modal');
		iconizeModal(this.modalEl);
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
		iconizeModal(this.contentEl);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
