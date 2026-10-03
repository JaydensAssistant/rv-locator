import { Modal, Setting, type App } from 'obsidian';
import { companionChoices } from './companions';
import type { RvGender } from './status';

export interface NewRvIdentity {
	gender: RvGender;
	name: string;
	address: string;
	/** Empty when they skip the Met companion. */
	companion: string;
	priority: number;
}

export interface NewRvModalOptions {
	defaultPriority: number;
	companions: readonly string[];
}

/**
 * One dialog: gender, name, address, Met companion, and priority.
 * The name starts empty. A blank name still uses Man or Woman in the title.
 */
export class NewRvIdentityModal extends Modal {
	private gender: RvGender = 'Man';
	private name = '';
	private address = '';
	private companion = '';
	private priority: number;
	private settled = false;
	private suggestions: HTMLElement | null = null;

	constructor(
		app: App,
		private options: NewRvModalOptions,
		private onDone: (identity: NewRvIdentity | null) => void,
	) {
		super(app);
		const priority = options.defaultPriority;
		this.priority = Number.isInteger(priority) ? Math.max(0, Math.min(5, priority)) : 4;
	}

	onOpen(): void {
		this.setTitle('New RV');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Man or Woman, a name if you have one, the address, who was met, and a priority. A blank name uses the gender in the note title.',
		});
		const gender = new Setting(contentEl).setName('Man / Woman');
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
				text.onChange((value) => { this.name = value; });
			});
		new Setting(contentEl)
			.setName('Address')
			.addText((text) => {
				text.setPlaceholder('Street address');
				text.onChange((value) => { this.address = value; });
			});
		new Setting(contentEl)
			.setName('Met companion')
			.setDesc('Who was there the first time. Skip leaves Met With and Taken blank.')
			.addText((text) => {
				text.setPlaceholder('Search companions');
				text.onChange((value) => {
					this.companion = value;
					this.paintSuggestions(value);
				});
			});
		this.suggestions = contentEl.createDiv('rv-locator-suggest-actions');
		this.paintSuggestions('');
		new Setting(contentEl)
			.setName('Priority')
			.setDesc('Starts from the default priority setting.')
			.addSlider((slider) => {
				slider.setLimits(0, 5, 1);
				slider.setValue(this.priority);
				slider.setDynamicTooltip();
				slider.onChange((value) => { this.priority = value; });
			});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Create');
				button.setCta();
				button.onClick(() => {
					this.settled = true;
					this.onDone({
						gender: this.gender,
						name: this.name.trim(),
						address: this.address.replace(/\r?\n/g, ' ').trim(),
						companion: this.companion.trim(),
						priority: this.priority,
					});
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText('Skip companion');
				button.onClick(() => { this.companion = ''; this.paintSuggestions(''); });
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
			button.classList.toggle('mod-cta', button.textContent === this.gender);
		});
	}

	private paintSuggestions(query: string): void {
		const host = this.suggestions;
		if (!host) return;
		host.empty();
		for (const choice of companionChoices(this.options.companions, query).slice(0, 6)) {
			const button = host.createEl('button', { text: choice.label, attr: { type: 'button' } });
			button.addEventListener('click', () => {
				this.companion = choice.value;
				host.empty();
				host.createEl('span', { text: choice.value });
			});
		}
	}
}
