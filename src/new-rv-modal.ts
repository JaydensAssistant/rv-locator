import { Modal, Setting, type App } from 'obsidian';
import type { RvGender } from './status';

export interface NewRvIdentity {
	gender: RvGender;
	name: string;
}

/**
 * One dialog for gender and an optional name. The name field starts empty.
 * The placeholder is not a prefilled name.
 */
export class NewRvIdentityModal extends Modal {
	private gender: RvGender = 'Man';
	private name = '';
	private settled = false;

	constructor(app: App, private onDone: (identity: NewRvIdentity | null) => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('New RV');
		const { contentEl } = this;
		contentEl.createEl('p', { text: 'Man or Woman, and a name if you have one. A blank name uses the gender in the note title.' });
		const gender = new Setting(contentEl).setName('Gender');
		gender.addButton((button) => {
			button.setButtonText('Man');
			button.setCta();
			button.onClick(() => {
				this.gender = 'Man';
				this.paintGender(gender);
			});
		});
		gender.addButton((button) => {
			button.setButtonText('Woman');
			button.onClick(() => {
				this.gender = 'Woman';
				this.paintGender(gender);
			});
		});
		new Setting(contentEl)
			.setName('Name')
			.setDesc('Optional. Leave blank to title the note Man on Street or Woman on Street.')
			.addText((text) => {
				text.setPlaceholder('Name (optional)');
				text.setValue('');
				text.onChange((value) => {
					this.name = value;
				});
			});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Continue');
				button.setCta();
				button.onClick(() => {
					this.settled = true;
					this.onDone({ gender: this.gender, name: this.name.trim() });
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			});
	}

	onClose(): void {
		if (!this.settled) this.onDone(null);
		this.contentEl.empty();
	}

	private paintGender(setting: Setting): void {
		const buttons = setting.controlEl.querySelectorAll('button');
		buttons.forEach((button) => {
			const on = button.textContent === this.gender;
			button.classList.toggle('mod-cta', on);
		});
	}
}
