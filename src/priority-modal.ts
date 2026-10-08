import { Modal, Setting, type App } from 'obsidian';
import { iconizeModal } from './modal-chrome';

/** Change priority with a slider. 0 archives. Above 0 on an inactive note restores Active. */
export class PrioritySliderModal extends Modal {
	private value: number;

	constructor(
		app: App,
		private displayName: string,
		current: number,
		private onSave: (priority: number) => void,
	) {
		super(app);
		this.value = Math.max(0, Math.min(5, Math.round(current)));
	}

	onOpen(): void {
		this.setTitle(`Priority on “${this.displayName}”`);
		const { contentEl } = this;
		new Setting(contentEl)
			.setName('Priority')
			.setDesc('0 is Inactive. 1 to 5 stays on the active list.')
			.addSlider((slider) => {
				slider.setLimits(0, 5, 1);
				slider.setValue(this.value);
				slider.setDynamicTooltip();
				slider.onChange((value) => {
					this.value = value;
				});
			});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Save');
				button.setCta();
				button.onClick(() => {
					this.onSave(this.value);
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			});
		iconizeModal(contentEl);
	}
}
