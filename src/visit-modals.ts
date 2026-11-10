import { Modal, Notice, Setting, SuggestModal, type App } from 'obsidian';
import { emptyShare, type VisitShare } from './catalog';
import { mountShareFields, type ShareFieldOptions } from './catalog-fields';
import { iconizeModal, markModalTone } from './modal-chrome';
import { mountAlwaysChevron, releaseSuggestionFields, suggestEscapeShouldHold } from './suggest-field';
import { mountCampaignChoice } from './campaign-choice';
import { campaignIsActive, localDay, type CampaignRecord } from './campaign';
import { coverageQuestion } from './modals';
import { companionChoices, publisherBands } from './companions';
import { clockFace, dateInputValue, defaultPastVisitTime, describeVisit, hour24FromFace, isFutureVisit, visitWhenFrom, type VisitEntry, type VisitFacts } from './visit-editor';

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
	/** Deletes the visit. The sheet's Delete tab confirms first. */
	onDelete?: () => void;
	/** Copy shown on the Delete tab. */
	deleteMessage?: string;
	/** Open on the Delete tab. */
	startOnDelete?: boolean;
	share?: ShareFieldOptions;
}

/**
 * The day and clock the sheet is showing. A date input often fires `change`
 * and not the text callback, so Save reads the controls themselves.
 */
export function readVisitControls(
	root: ParentNode,
	current: { dateText: string; hour: number; minute: number },
): { dateText: string; hour: number; minute: number } {
	if (typeof root.querySelector !== 'function') return current;
	const date = root.querySelector('input[type="date"]');
	const hourEl = root.querySelector('select[aria-label="Hour"]');
	const minuteEl = root.querySelector('select[aria-label="Minute"]');
	const meridiemEl = root.querySelector('select[aria-label="AM or PM"]');
	const dateValue = date instanceof HTMLElement ? (date as HTMLInputElement).value : '';
	const dateText = typeof dateValue === 'string' && dateValue ? dateValue : current.dateText;
	let hour = current.hour;
	let minute = current.minute;
	if (hourEl instanceof HTMLElement && meridiemEl instanceof HTMLElement) {
		const raw = (hourEl as HTMLSelectElement).value;
		const face = Number(raw);
		const meridiem = (meridiemEl as HTMLSelectElement).value === 'PM' ? 'PM' : 'AM';
		if (raw !== '' && Number.isInteger(face) && face >= 1 && face <= 12) hour = hour24FromFace(face, meridiem);
	}
	if (minuteEl instanceof HTMLElement) {
		const next = Number((minuteEl as HTMLSelectElement).value);
		if ((minuteEl as HTMLSelectElement).value !== '' && Number.isInteger(next)) minute = next;
	}
	return { dateText, hour, minute };
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
	private editPane: HTMLElement | null = null;
	private deletePane: HTMLElement | null = null;
	private editActions: HTMLElement | null = null;
	private deleteActions: HTMLElement | null = null;
	private editTab: HTMLElement | null = null;
	private deleteTab: HTMLElement | null = null;
	private share: VisitShare = emptyShare();

	constructor(app: App, private options: VisitEditOptions) {
		super(app);
		const start = options.initial ?? { when: new Date(), home: true, companion: '' };
		const rounded = options.initial ? { date: start.when, hour: start.when.getHours() } : defaultPastVisitTime(start.when);
		this.home = start.home;
		this.dateText = dateInputValue(rounded.date);
		this.hour = options.initial ? start.when.getHours() : rounded.hour;
		this.minute = options.initial ? start.when.getMinutes() : 0;
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
		const rawClose = this.close.bind(this);
		this.close = () => {
			if (suggestEscapeShouldHold(this.contentEl)) return;
			rawClose();
		};
		this.setTitle(this.options.title);
		this.modalEl.addClass('rv-locator-modal', 'rv-locator-visit-editor');
		markModalTone(this.modalEl, 'rv', this.buttonAccent);
		const { contentEl } = this;
		if (this.options.onDelete) this.mountVisitTabs();
		const body = this.options.onDelete ? contentEl.createDiv('rv-visit-pane is-edit') : contentEl;
		this.editPane = body === contentEl ? null : body;

		new Setting(body)
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
		const time = new Setting(body).setName('Day').setClass('rv-when-row');
		time.addText((text) => {
			text.inputEl.type = 'date';
			text.inputEl.max = dateInputValue(new Date());
			text.setValue(this.dateText);
			text.onChange((value) => {
				this.dateText = value;
				this.syncCompanion();
			});
			text.inputEl.addEventListener('change', () => {
				const value = (text.inputEl as { value?: string }).value;
				if (typeof value === 'string') this.dateText = value;
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
			const minutes = new Set<number>();
			for (let minute = 0; minute < 60; minute += 5) minutes.add(minute);
			if (this.minute >= 0 && this.minute <= 59) minutes.add(this.minute);
			for (const minute of [...minutes].sort((a, b) => a - b)) {
				dropdown.addOption(String(minute), String(minute).padStart(2, '0'));
			}
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

		this.companionSetting = new Setting(body)
			.setName('What publisher came with you?')
			.addText((text) => {
				text.setPlaceholder('Optional (e.g. Sister Johnson)');
				text.setValue(this.companion);
				text.onChange((value) => { this.companion = value; });
				const choices = (): ReturnType<typeof companionChoices> => companionChoices(this.options.recentCompanions, this.companion);
				mountAlwaysChevron(text.inputEl, () => choices().map((item) => item.label), (picked) => {
					const match = choices().find((item) => item.label === picked || item.value === picked);
					this.companion = match?.value ?? picked;
					text.setValue(this.companion);
				}, undefined, (rows) => publisherBands(rows), {
					picked: () => (this.companion.trim() ? [this.companion.trim()] : []),
				});
			});
		this.campaignHost = null;
		if (this.options.campaign) {
			this.campaignHost = body.createDiv('rv-visit-campaign rv-modal-section');
			mountCampaignChoice(
				this.campaignHost,
				coverageQuestion(this.options.campaign.pronoun ?? 'them', this.options.campaign.name),
				this.covered,
				(covered) => { this.covered = covered; },
			);
		}
		if (this.options.share) {
			this.shareHost = body.createDiv('rv-visit-share rv-modal-section');
			mountShareFields(this.shareHost, { ...this.options.share, initial: this.share }, (next) => {
				this.share = next;
			});
		}
		this.syncCompanion();

		const actions = new Setting(contentEl).setClass('rv-modal-actions rv-visit-edit-actions');
		this.editActions = actions.settingEl;
		actions
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.buttonEl?.classList.add('rv-modal-cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText(this.options.onDelete || /^edit/i.test(this.options.title) ? 'Save' : 'Log visit');
				button.setCta();
				button.onClick(() => this.save());
			});
		if (this.options.onDelete) {
			this.deletePane = contentEl.createDiv('rv-visit-pane is-delete');
			this.deletePane.createEl('p', {
				cls: 'rv-visit-delete-copy',
				text: this.options.deleteMessage ?? 'Delete this visit?',
			});
			const confirm = new Setting(contentEl).setClass('rv-modal-actions rv-visit-delete-actions');
			this.deleteActions = confirm.settingEl;
			confirm
				.addButton((button) => {
					button.setButtonText('Cancel');
					button.buttonEl?.classList.add('rv-modal-cancel');
					button.onClick(() => this.showVisitPane('edit'));
				})
				.addButton((button) => {
					button.setButtonText('Delete visit');
					button.setCta();
					button.onClick(() => {
						this.close();
						this.options.onDelete?.();
					});
				});
			this.showVisitPane(this.options.startOnDelete ? 'delete' : 'edit');
		}
		iconizeModal(contentEl);
	}

	private mountVisitTabs(): void {
		const title = this.titleEl;
		if (typeof title?.empty !== 'function' || typeof title.createEl !== 'function') return;
		title.empty();
		title.addClass('rv-visit-tabs');
		const edit = title.createEl('button', {
			cls: 'rv-visit-tab is-active',
			text: 'Edit visit',
			attr: { type: 'button' },
		});
		const remove = title.createEl('button', {
			cls: 'rv-visit-tab',
			text: 'Delete visit',
			attr: { type: 'button' },
		});
		edit.addEventListener('click', (event) => {
			event?.preventDefault?.();
			this.showVisitPane('edit');
		});
		remove.addEventListener('click', (event) => {
			event?.preventDefault?.();
			this.showVisitPane('delete');
		});
		this.editTab = edit;
		this.deleteTab = remove;
	}

	private showVisitPane(which: 'edit' | 'delete'): void {
		const deleting = which === 'delete';
		if (this.editPane) this.editPane.hidden = deleting;
		if (this.deletePane) this.deletePane.hidden = !deleting;
		if (this.editActions) this.editActions.hidden = deleting;
		if (this.deleteActions) this.deleteActions.hidden = !deleting;
		this.editTab?.classList.toggle('is-active', !deleting);
		this.deleteTab?.classList.toggle('is-active', deleting);
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
		const shown = readVisitControls(this.contentEl, {
			dateText: this.dateText,
			hour: this.hour,
			minute: this.minute,
		});
		this.dateText = shown.dateText;
		this.hour = shown.hour;
		this.minute = shown.minute;
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
				button.buttonEl?.classList.add('rv-modal-cancel');
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
		this.setPlaceholder('Optional');
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
				button.buttonEl?.classList.add('rv-modal-cancel');
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
