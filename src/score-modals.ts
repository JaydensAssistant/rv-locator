import { Modal, Setting, setIcon, type App } from 'obsidian';
import { iconizeModal, markModalTone } from './modal-chrome';
import { sliderToSnoozeDays, snoozeDaysToSlider } from './lesson-stops';
import {
	snoozeDaysFromUntil,
	snoozePreview,
	type SnoozeWrite,
} from './snooze';

export interface SnoozeModalState {
	until: Date | null;
	label: string;
}

/**
 * Custom duration and label. Quick row is 1d / 7d / 14d, then a non-linear slider.
 * Footer is always Clear | Cancel | Snooze, or Update while a snooze is already set.
 */
export class UrgencySnoozeModal extends Modal {
	buttonAccent = '';
	private days: number;
	private label: string;
	private readonly openedDays: number;
	private readonly openedLabel: string;
	private readonly snoozed: boolean;

	constructor(
		app: App,
		private displayName: string,
		current: SnoozeModalState,
		private onCommit: (next: SnoozeWrite | 'clear') => void,
	) {
		super(app);
		const now = new Date();
		this.snoozed = current.until != null && current.until.getTime() > now.getTime();
		this.days = this.snoozed && current.until ? snoozeDaysFromUntil(current.until, now) : 7;
		this.label = current.label;
		this.openedDays = this.days;
		this.openedLabel = current.label.trim();
	}

	onOpen(): void {
		this.setTitle('Snooze');
		this.modalEl.addClass('rv-locator-modal');
		markModalTone(this.modalEl, 'rv', this.buttonAccent);
		this.modalEl.addClass('rv-snooze-modal');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: this.displayName,
		});
		const quick = contentEl.createDiv('rv-snooze-quick rv-modal-section');
		const presets: Array<[number, string]> = [[1, '1d'], [7, '7d'], [14, '14d']];
		const presetButtons: HTMLButtonElement[] = [];
		for (const [days, text] of presets) {
			const button = quick.createEl('button', { text, attr: { type: 'button' } });
			const icon = button.createSpan('rv-snooze-moon');
			setIcon(icon, 'moon');
			button.addEventListener('click', (event) => {
				event.preventDefault();
				this.days = days;
				sync();
			});
			presetButtons.push(button);
		}
		const slider = contentEl.createEl('input', {
			cls: 'rv-snooze-slider',
			attr: { type: 'range', min: '0', max: '100', 'aria-label': 'Snooze length' },
		});
		const preview = contentEl.createEl('p', { cls: 'rv-snooze-preview' });
		new Setting(contentEl)
			.setClass('rv-modal-section')
			.setName('Reason')
			.addText((text) => {
				text.setPlaceholder('optional');
				text.setValue(this.label);
				text.onChange((value) => {
					this.label = value;
					sync();
				});
			});
		const footer = contentEl.createDiv('rv-modal-actions is-footer');
		const clear = footer.createEl('button', { text: 'Clear', attr: { type: 'button' } });
		const cancel = footer.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		const save = footer.createEl('button', { text: this.snoozed ? 'Update' : 'Snooze', attr: { type: 'button' } });
		clear.disabled = !this.snoozed;
		cancel.addEventListener('click', () => this.close());
		clear.addEventListener('click', () => {
			if (clear.disabled) return;
			this.onCommit('clear');
			this.close();
		});
		save.addEventListener('click', () => {
			if (save.disabled) return;
			const now = new Date();
			const until = new Date(now.getTime() + this.days * 24 * 60 * 60 * 1000);
			const pad = (value: number) => String(value).padStart(2, '0');
			const stamp = `${until.getFullYear()}-${pad(until.getMonth() + 1)}-${pad(until.getDate())}T${pad(until.getHours())}:${pad(until.getMinutes())}:${pad(until.getSeconds())}`;
			const start = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
			this.onCommit({ until: stamp, start, label: this.label.trim() });
			this.close();
		});
		const sync = (): void => {
			(slider as HTMLInputElement).value = String(snoozeDaysToSlider(this.days));
			preview.setText(snoozePreview(this.days, new Date()));
			presetButtons.forEach((button, index) => {
				button.classList.toggle('is-selected', presets[index]?.[0] === this.days);
			});
			const dirty = this.days !== this.openedDays || this.label.trim() !== this.openedLabel;
			save.disabled = this.snoozed && !dirty;
			save.classList.toggle('mod-cta', !save.disabled);
		};
		slider.addEventListener('input', () => {
			this.days = sliderToSnoozeDays(Number((slider as HTMLInputElement).value) || 0);
			sync();
		});
		sync();
		iconizeModal(contentEl);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class PriorityNudgeModal extends Modal {
	buttonAccent = '';
	constructor(
		app: App,
		private current: number,
		private onChoose: (next: number) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Priority');
		this.modalEl.addClass('rv-locator-modal');
		markModalTone(this.modalEl, 'rv', this.buttonAccent);
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: `Current priority is ${this.current}.`,
		});
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Lower, stay, or raise it.',
		});
		new Setting(contentEl)
			.setClass('rv-modal-actions')
			.setClass('rv-priority-nudge')
			.addButton((button) => {
				button.setButtonText('−1');
				button.buttonEl.addClass('rv-nudge-lower');
				button.setDisabled(this.current <= 0);
				button.onClick(() => {
					this.onChoose(Math.max(0, this.current - 1));
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText('Stay');
				button.buttonEl.addClass('rv-nudge-stay');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText('+1');
				button.buttonEl.addClass('rv-nudge-raise');
				button.setDisabled(this.current >= 5);
				button.onClick(() => {
					this.onChoose(Math.min(5, this.current + 1));
					this.close();
				});
			});
		iconizeModal(contentEl);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
