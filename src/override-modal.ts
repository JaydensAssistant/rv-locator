import { Modal, Setting, type App } from 'obsidian';
import { iconizeModal } from './modal-chrome';
import { DAYPARTS, type Daypart } from './schedule';
import {
	formatSlotOverride,
	removeSlotOverride,
	upsertSlotOverride,
	type SlotOverride,
} from './slot-override';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Mark one daypart Try or Avoid, whatever the Attempt Log computed. */
export class SlotOverrideModal extends Modal {
	private weekday = new Date().getDay();
	private daypart: Daypart = 'evening';
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
		this.setTitle('Try or Avoid');
		this.modalEl.addClass('rv-locator-modal');
		this.paint();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private paint(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Mark a day and daypart as Try or Avoid even when the counts say something else. For example, they said they work then, or they are off.',
		});
		new Setting(contentEl)
			.setName('Day')
			.addDropdown((dropdown) => {
				WEEKDAYS.forEach((label, index) => dropdown.addOption(String(index), label));
				dropdown.setValue(String(this.weekday));
				dropdown.onChange((value) => { this.weekday = Number(value); });
			});
		new Setting(contentEl)
			.setName('Daypart')
			.addDropdown((dropdown) => {
				for (const daypart of DAYPARTS) dropdown.addOption(daypart, daypart);
				dropdown.setValue(this.daypart);
				dropdown.onChange((value) => { this.daypart = value === 'morning' || value === 'afternoon' ? value : 'evening'; });
			});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Try');
				button.setCta();
				button.onClick(() => this.save('try'));
			})
			.addButton((button) => {
				button.setButtonText('Avoid');
				button.onClick(() => this.save('avoid'));
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
		this.current = upsertSlotOverride(this.current, { weekday: this.weekday, daypart: this.daypart, bucket });
		this.onChange(this.current);
		this.paint();
	}
}
