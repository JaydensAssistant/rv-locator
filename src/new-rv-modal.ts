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
	/** Geoapify hits for the address field. Empty when there is no key or no match. */
	lookupAddress?: (query: string) => Promise<readonly string[]>;
}

/**
 * One dialog: gender, name, address, Met companion, and priority.
 * The name starts empty. A blank name still uses Man or Woman in the title.
 */
/** Name for a second RV at the same address. Cancel returns null. */
export class HousemateNameModal extends Modal {
	private name = '';
	private settled = false;

	constructor(app: App, private onDone: (name: string | null) => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Add a housemate');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Creates another RV note at this address.',
		});
		new Setting(contentEl)
			.setName('Name')
			.addText((text) => {
				text.setPlaceholder('Name');
				text.onChange((value) => { this.name = value; });
			});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Create');
				button.setCta();
				button.onClick(() => {
					const name = this.name.trim();
					if (!name) return;
					this.settled = true;
					this.onDone(name);
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
}

export class NewRvIdentityModal extends Modal {
	private gender: RvGender = 'Man';
	private name = '';
	private address = '';
	private companion = '';
	private priority: number;
	private settled = false;
	private suggestions: HTMLElement | null = null;
	private addressHits: HTMLElement | null = null;
	private addressTimer = 0;
	private addressInput: { setValue: (value: string) => void } | null = null;

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
			.setDesc('Type a few words. Pick a Geoapify match to fill the address.')
			.addText((text) => {
				text.setPlaceholder('Street address');
				this.addressInput = text;
				text.onChange((value) => {
					this.address = value;
					this.scheduleAddressLookup(value);
				});
			});
		this.addressHits = contentEl.createDiv('rv-locator-suggest-actions rv-address-hits');
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

	private scheduleAddressLookup(value: string): void {
		window.clearTimeout(this.addressTimer);
		const query = value.trim();
		const host = this.addressHits;
		if (!host) return;
		host.empty();
		if (query.length < 3 || !this.options.lookupAddress) return;
		this.addressTimer = window.setTimeout(() => {
			void this.paintAddressHits(query);
		}, 280);
	}

	private async paintAddressHits(query: string): Promise<void> {
		const host = this.addressHits;
		const lookup = this.options.lookupAddress;
		if (!host || !lookup) return;
		if (this.address.trim() !== query) return;
		let hits: readonly string[] = [];
		try {
			hits = await lookup(query);
		} catch {
			hits = [];
		}
		if (this.address.trim() !== query) return;
		host.empty();
		const seen = new Set<string>();
		for (const hit of hits) {
			const label = hit.replace(/\s+/g, ' ').trim();
			if (!label || seen.has(label)) continue;
			seen.add(label);
			const button = host.createEl('button', { text: label, attr: { type: 'button' } });
			button.addEventListener('click', () => {
				this.address = label;
				this.addressInput?.setValue(label);
				host.empty();
			});
			if (seen.size >= 6) break;
		}
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
