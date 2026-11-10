import { Modal, Notice, Setting, type App } from 'obsidian';
import { iconizeModal, markModalTone } from './modal-chrome';
import { DAYPARTS, daypartSettingLabel, type Daypart } from './schedule';
import { mountAlwaysChevron, releaseSuggestionFields, suggestEscapeShouldHold } from './suggest-field';
import {
	formatSlotOverride,
	removeSlotOverride,
	upsertSlotOverride,
	type SlotOverride,
} from './slot-override';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Day or daypart field for the Return Suggestions override.
 * The open list is the same suggestion panel Lit, Media, and Lessons use.
 */
export function mountSlotChoice(
	parent: HTMLElement,
	name: string,
	current: () => string,
	choices: readonly string[],
	onPick: (value: string) => void,
): void {
	let query = '';
	new Setting(parent).setName(name).addText((text) => {
		const showCurrent = (): void => {
			query = '';
			text.setValue(current());
		};
		text.setValue(current());
		text.onChange((value) => { query = value; });
		mountAlwaysChevron(
			text.inputEl,
			() => {
				const needle = query.trim().toLowerCase();
				const chosen = current().trim().toLowerCase();
				if (!needle || needle === chosen) return [...choices];
				return choices.filter((label) => label.toLowerCase().includes(needle));
			},
			(picked) => {
				onPick(picked);
				showCurrent();
			},
			undefined,
			undefined,
			{ picked: () => [current()] },
		);
		text.inputEl.addEventListener('blur', () => {
			const dataset = text.inputEl?.dataset;
			if (dataset?.rvPicking === '1') {
				delete dataset.rvPicking;
				return;
			}
			showCurrent();
		});
	});
}

/** Mark one daypart Try or Avoid, whatever the Attempt Log computed. */
export class SlotOverrideModal extends Modal {
	buttonAccent = '';
	private weekday = new Date().getDay();
	private daypart: Daypart = 'evening';
	private reason = '';
	private current: SlotOverride[];

	constructor(
		app: App,
		current: readonly SlotOverride[],
		private onChange: (next: readonly SlotOverride[]) => void,
	) {
		super(app);
		this.current = [...current];
	}

	onOpen(): void {
		const rawClose = this.close.bind(this);
		this.close = () => {
			if (suggestEscapeShouldHold(this.contentEl)) return;
			rawClose();
		};
		this.setTitle('Try or Avoid');
		this.modalEl.addClass('rv-locator-modal');
		markModalTone(this.modalEl, 'rv', this.buttonAccent);
		this.paint();
	}

	onClose(): void {
		releaseSuggestionFields(this.contentEl);
		this.contentEl.empty();
	}

	private paint(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Try or Avoid for this day and daypart.',
		});
		const when = contentEl.createDiv('rv-slot-when');
		mountSlotChoice(when, 'Day', () => WEEKDAYS[this.weekday] ?? 'Sun', WEEKDAYS, (label) => {
			const index = (WEEKDAYS as readonly string[]).indexOf(label);
			if (index >= 0) this.weekday = index;
		});
		mountSlotChoice(when, 'Daypart', () => daypartSettingLabel(this.daypart), DAYPARTS.map((part) => daypartSettingLabel(part)), (label) => {
			const found = DAYPARTS.find((part) => daypartSettingLabel(part) === label);
			if (found) this.daypart = found;
		});
		new Setting(contentEl)
			.setName('Label')
			.setDesc('Why this slot is Try or Avoid.')
			.addText((text) => {
				text.setPlaceholder('Optional (e.g. Works then)');
				text.setValue(this.reason);
				text.onChange((value) => { this.reason = value; });
			});
		new Setting(contentEl)
			.setClass('rv-modal-actions')
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.buttonEl?.classList.add('rv-modal-cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText('Avoid');
				button.onClick(() => this.save('avoid'));
			})
			.addButton((button) => {
				button.setButtonText('Try');
				button.setCta();
				button.onClick(() => this.save('try'));
			});
		if (this.current.length === 0) {
			contentEl.createEl('p', { cls: 'rv-locator-modal-copy', text: 'No overrides on this note.' });
		}
		for (const override of this.current) {
			new Setting(contentEl)
				.setName(formatSlotOverride(override))
				.addButton((button) => {
					button.setButtonText('Remove');
					button.onClick(() => {
						this.current = removeSlotOverride(this.current, override.weekday, override.daypart);
						this.onChange(this.current);
						this.paint();
					});
				});
		}
		iconizeModal(contentEl);
	}

	private save(bucket: 'try' | 'avoid'): void {
		const reason = this.reason.trim();
		if (!reason) {
			new Notice('Add a label for this override.');
			return;
		}
		this.current = upsertSlotOverride(this.current, { weekday: this.weekday, daypart: this.daypart, bucket, reason });
		this.reason = '';
		this.onChange(this.current);
		this.paint();
	}
}
