import { Modal, Notice, Setting, SuggestModal, type App } from 'obsidian';
import { emptyShare, type VisitShare } from './catalog';
import { mountShareFields, type ShareFieldOptions } from './catalog-fields';
import { iconizeModal, markModalTone } from './modal-chrome';
import { mountAlwaysChevron, releaseSuggestionFields } from './suggest-field';
import { mountCampaignChoice } from './campaign-choice';
import { campaignIsActive, localDay, type CampaignRecord } from './campaign';
import { coverageQuestion } from './modals';
import { clockFace, dateInputValue, defaultPastVisitTime, describeVisit, hour24FromFace, isFutureVisit, snapFiveMinutes, visitWhenFrom, type VisitEntry, type VisitFacts } from './visit-editor';

export interface VisitEditOptions {
	title: string;
	/** Prefilled visit when editing. A new past visit starts on Home, now. */
	initial?: VisitFacts | null;
	recentCompanions: readonly string[];
	/** Shown when this campaign spans the visit date. Preselects the stored token. */
	campaign?: (Pick<CampaignRecord, 'name' | 'start' | 'end'> & { pronoun?: 'him' | 'her' | 'them' }) | null;
	covered?: boolean;
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
	buttonAccent = '';
	private home = true;
	private dateText = '';
	private hour = 12;
	private minute = 0;
	private companion = '';
	private covered = false;
	private companionSetting: Setting | null = null;
	private shareHost: HTMLElement | null = null;
	private campaignHost: HTMLElement | null = null;
	private share: VisitShare = emptyShare();

	constructor(app: App, private options: VisitEditOptions) {
		super(app);
		const start = options.initial ?? { when: new Date(), home: true, companion: '' };
		const rounded = options.initial ? { date: start.when, hour: start.when.getHours() } : defaultPastVisitTime(start.when);
		this.home = start.home;
		this.dateText = dateInputValue(rounded.date);
		this.hour = rounded.hour;
		const snapped = options.initial ? snapFiveMinutes(start.when.getMinutes()) : 0;
		this.minute = snapped;
		if (options.initial && start.when.getMinutes() >= 58) this.hour = (this.hour + 1) % 24;
		this.companion = start.companion;
		this.covered = options.covered === true || (options.initial?.covered != null && options.initial.covered.length > 0);
		this.share = {
			publications: start.publications ?? options.share?.initial.publications ?? '',
			media: start.media ?? options.share?.initial.media ?? '',
			lesson: start.lesson ?? options.share?.initial.lesson ?? '',
			lessonFrom: start.lessonFrom ?? options.share?.initial.lessonFrom ?? '',
			lessonTo: start.lessonTo ?? options.share?.initial.lessonTo ?? '',
			extraLesson: start.extraLesson ?? options.share?.initial.extraLesson ?? '',
			extraFrom: start.extraFrom ?? options.share?.initial.extraFrom ?? '',
			extraTo: start.extraTo ?? options.share?.initial.extraTo ?? '',
			publicationList: start.publicationList ?? options.share?.initial.publicationList,
			mediaList: start.mediaList ?? options.share?.initial.mediaList,
		};
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		this.modalEl.addClass('rv-locator-modal', 'rv-locator-visit-editor');
		markModalTone(this.modalEl, 'rv', this.buttonAccent);
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

		const face = clockFace(this.hour);
		let hour12 = face.hour12;
		let meridiem = face.meridiem;
		const syncHour = (): void => {
			this.hour = hour24FromFace(hour12, meridiem);
		};
		const time = new Setting(contentEl).setName('Day').setClass('rv-when-row');
		time.addText((text) => {
			text.inputEl.type = 'date';
			text.inputEl.max = dateInputValue(new Date());
			text.setValue(this.dateText);
			text.onChange((value) => {
				this.dateText = value;
				this.syncCompanion();
			});
		});
		time.addDropdown((dropdown) => {
			dropdown.selectEl.setAttribute('aria-label', 'Hour');
			for (let hour = 1; hour <= 12; hour += 1) dropdown.addOption(String(hour), String(hour));
			dropdown.setValue(String(hour12));
			dropdown.onChange((value) => {
				hour12 = Number(value);
				syncHour();
			});
		});
		time.addDropdown((dropdown) => {
			dropdown.selectEl.setAttribute('aria-label', 'Minute');
			for (let minute = 0; minute < 60; minute += 5) dropdown.addOption(String(minute), String(minute).padStart(2, '0'));
			dropdown.setValue(String(this.minute));
			dropdown.onChange((value) => { this.minute = Number(value); });
		});
		time.addDropdown((dropdown) => {
			dropdown.selectEl.setAttribute('aria-label', 'AM or PM');
			dropdown.addOption('AM', 'AM');
			dropdown.addOption('PM', 'PM');
			dropdown.setValue(meridiem);
			dropdown.onChange((value) => {
				meridiem = value === 'PM' ? 'PM' : 'AM';
				syncHour();
			});
		});

		this.companionSetting = new Setting(contentEl)
			.setName('What publisher came with you?')
			.addText((text) => {
				text.setPlaceholder('Nobody');
				text.setValue(this.companion);
				text.onChange((value) => { this.companion = value; });
				mountAlwaysChevron(text.inputEl, () => this.options.recentCompanions.filter((name) => {
					const needle = this.companion.trim().toLowerCase();
					return !needle || name.toLowerCase().includes(needle);
				}), (picked) => {
					this.companion = picked;
					text.setValue(picked);
				});
			});
		this.campaignHost = null;
		if (this.options.campaign) {
			this.campaignHost = contentEl.createDiv('rv-visit-campaign rv-modal-section');
			mountCampaignChoice(
				this.campaignHost,
				coverageQuestion(this.options.campaign.pronoun ?? 'them', this.options.campaign.name),
				this.covered,
				(covered) => { this.covered = covered; },
			);
		}
		if (this.options.share) {
			this.shareHost = contentEl.createDiv('rv-visit-share rv-modal-section');
			mountShareFields(this.shareHost, { ...this.options.share, initial: this.share }, (next) => {
				this.share = next;
			});
		}
		this.syncCompanion();

		const actions = new Setting(contentEl).setClass('rv-modal-actions');
		if (this.options.onDelete) {
			actions.addButton((button) => {
				button.setButtonText('Delete visit');
				button.setDestructive();
				button.removeCta();
				button.buttonEl?.addClass('rv-btn-outline');
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
				button.setButtonText(this.options.onDelete || /^edit/i.test(this.options.title) ? 'Save' : 'Log visit');
				button.setCta();
				button.onClick(() => this.save());
			});
		iconizeModal(contentEl);
	}

	onClose(): void {
		releaseSuggestionFields(this.contentEl);
		this.contentEl.empty();
	}

	private campaignSpansVisit(): boolean {
		const campaign = this.options.campaign;
		if (!campaign) return false;
		const when = visitWhenFrom(this.dateText, this.hour, this.minute);
		if (!when) return false;
		return campaignIsActive({ ...campaign, covered: [] }, localDay(when));
	}

	private syncCompanion(): void {
		const companion = this.companionSetting?.settingEl;
		if (companion) companion.classList.toggle('is-miss-hidden', !this.home);
		if (this.shareHost) this.shareHost.classList.toggle('is-miss-hidden', !this.home);
		if (this.campaignHost) this.campaignHost.hidden = !this.campaignSpansVisit();
	}

	private save(): void {
		const when = visitWhenFrom(this.dateText, this.hour, this.minute);
		if (!when) {
			new Notice('Choose the day of the visit.');
			return;
		}
		if (isFutureVisit(when, new Date())) {
			new Notice('That time has not happened yet.');
			return;
		}
		this.close();
		const spans = this.campaignSpansVisit();
		if (spans) this.options.onCovered?.(this.covered);
		this.options.onSave({
			when,
			home: this.home,
			companion: this.home ? this.companion.trim() : '',
			covered: spans && this.covered ? (this.options.campaign?.name ?? '') : '',
			publications: this.share.publications.trim(),
			media: this.share.media.trim(),
			publicationList: this.share.publicationList,
			mediaList: this.share.mediaList,
			lesson: this.share.lesson.trim(),
			lessonFrom: this.share.lessonFrom.trim(),
			lessonTo: this.share.lessonTo.trim(),
			extraLesson: this.share.extraLesson?.trim() ?? '',
			extraFrom: this.share.extraFrom?.trim() ?? '',
			extraTo: this.share.extraTo?.trim() ?? '',
		});
	}
}

/** Literature, media, and study lessons. Home logs use this instead of the companion dialog. */
export class LiteraturePromptModal extends Modal {
	buttonAccent = '';
	private share: VisitShare;
	private settled = false;
	private covered = true;

	constructor(
		app: App,
		private options: ShareFieldOptions,
		private onDone: (share: VisitShare | false) => void,
		private campaign: { name: string; pronoun: 'him' | 'her' | 'them'; onDecision: (yes: boolean) => void } | null = null,
	) {
		super(app);
		this.share = { ...options.initial };
	}

	onOpen(): void {
		this.setTitle('Log visit');
		this.modalEl.addClass('rv-locator-modal');
		markModalTone(this.modalEl, 'rv', this.buttonAccent);
		mountShareFields(this.contentEl, this.options, (next) => { this.share = next; });
		if (this.campaign) {
			mountCampaignChoice(
				this.contentEl,
				coverageQuestion(this.campaign.pronoun, this.campaign.name),
				this.covered,
				(covered) => { this.covered = covered; },
			);
		}
		new Setting(this.contentEl)
			.setClass('rv-modal-actions')
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText('Log visit');
				button.setCta();
				button.onClick(() => {
					this.settled = true;
					this.campaign?.onDecision(this.covered);
					this.onDone(this.share);
					this.close();
				});
			});
		iconizeModal(this.contentEl);
	}

	onClose(): void {
		releaseSuggestionFields(this.contentEl);
		if (!this.settled) this.onDone(false);
		this.contentEl.empty();
	}
}

/** Visits on one note, newest first, for editing or deleting from the command palette. */
export class VisitPickModal extends SuggestModal<VisitEntry> {
	buttonAccent = '';
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
		markModalTone(this.modalEl, 'rv', this.buttonAccent);
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
	buttonAccent = '';
	constructor(app: App, private options: ConfirmOptions) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.options.title);
		this.modalEl.addClass('rv-locator-modal');
		markModalTone(this.modalEl, 'rv', this.buttonAccent);
		this.contentEl.createEl('p', { cls: 'rv-locator-modal-copy', text: this.options.message });
		new Setting(this.contentEl)
			.setClass('rv-modal-actions')
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText(this.options.confirmText);
				button.setCta();
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
