import { Modal, Setting, type App } from 'obsidian';
import { abbreviateAddress, addressesMatchOneForOne, matchingAddress } from './address';
import { companionChoices, matchingCompanion } from './companions';
import { ADDRESS_LOOKUP_IDLE_MS, addressLookupDecision } from './lookup-cadence';
import type { RvGender } from './status';
import type { GeocodeHit } from './types';

export interface NewRvIdentity {
	gender: RvGender;
	name: string;
	address: string;
	/** Empty when they leave the companion blank. */
	companion: string;
	priority: number;
	/** Set when they picked a Geoapify hit and the address still matches it. */
	verifiedHit: GeocodeHit | null;
}

export interface NewRvModalOptions {
	defaultPriority: number;
	companions: readonly string[];
	/** Geoapify hits for the address field. Empty when there is no key or no match. */
	lookupAddress?: (query: string) => Promise<readonly GeocodeHit[]>;
	title?: string;
	intro?: string;
	preset?: Partial<Pick<NewRvIdentity, 'gender' | 'name' | 'address' | 'companion' | 'priority'>>;
}

interface TextControl {
	setValue: (value: string) => void;
	inputEl?: HTMLElement;
}

/**
 * One dialog: gender, name, address, Met companion, and priority.
 * Companion is optional. Create with it blank leaves Met With and Taken blank.
 */
export class NewRvIdentityModal extends Modal {
	private gender: RvGender = 'Man';
	private name = '';
	private address = '';
	private companion = '';
	private priority: number;
	private settled = false;
	private companionPicked = false;
	private verifiedHit: GeocodeHit | null = null;
	private addressList: HTMLElement | null = null;
	private addressResults: GeocodeHit[] = [];
	private addressInput: TextControl | null = null;
	private companionInput: TextControl | null = null;
	private idleTimer = 0;
	private sentQuery = '';
	private lookupFlight: Promise<void> | null = null;
	private queuedQuery: string | null = null;

	constructor(
		app: App,
		private options: NewRvModalOptions,
		private onDone: (identity: NewRvIdentity | null) => void,
	) {
		super(app);
		const preset = options.preset;
		if (preset?.gender === 'Woman' || preset?.gender === 'Man') this.gender = preset.gender;
		this.name = preset?.name ?? '';
		this.address = preset?.address ?? '';
		this.companion = preset?.companion ?? '';
		const priority = preset?.priority ?? options.defaultPriority;
		this.priority = Number.isInteger(priority) ? Math.max(0, Math.min(5, priority)) : 4;
	}

	onOpen(): void {
		this.setTitle(this.options.title ?? 'New RV');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: this.options.intro ?? 'Choose man or woman, a name if you have one, the address, and a priority. Companion is optional.',
		});
		const gender = new Setting(contentEl).setName('Man / Woman');
		gender.addButton((button) => {
			button.setButtonText('Man');
			if (this.gender === 'Man') button.setCta();
			button.onClick(() => {
				this.gender = 'Man';
				this.paintGender(gender);
			});
		});
		gender.addButton((button) => {
			button.setButtonText('Woman');
			if (this.gender === 'Woman') button.setCta();
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
				text.setValue(this.name);
				text.onChange((value) => { this.name = value; });
			});
		new Setting(contentEl)
			.setName('Address')
			.setDesc('Street address. Matches appear in the address list.')
			.addText((text) => {
				text.setPlaceholder('Street address');
				text.setValue(this.address);
				this.addressInput = text;
				this.bindField(text, () => this.commitAddressMatch(), (value) => {
					this.address = value;
					this.forgetVerification(value);
					const exact = this.addressResults.find((hit) => addressesMatchOneForOne(value, hit.formattedAddress));
					if (exact) this.verifiedHit = { ...exact, formattedAddress: exact.formattedAddress.replace(/\s+/g, ' ').trim() };
					this.scheduleAddressLookup(value);
				});
				const listId = `rv-locator-addresses-${Date.now()}`;
				this.addressList = contentEl.createEl('datalist', { attr: { id: listId } });
				text.inputEl?.setAttribute('list', listId);
			});
		new Setting(contentEl)
			.setName('Companion')
			.setDesc('Optional. Leave blank and press Create to skip.')
			.addText((text) => {
				text.setPlaceholder('Companion (optional)');
				text.setValue(this.companion);
				this.companionInput = text;
				const listId = `rv-locator-companions-${Date.now()}`;
				const list = contentEl.createEl('datalist', { attr: { id: listId } });
				for (const name of this.options.companions) {
					if (name.trim()) list.createEl('option', { attr: { value: name } });
				}
				text.inputEl?.setAttribute('list', listId);
				this.bindField(text, () => this.commitCompanionMatch(), (value) => {
					this.companion = value;
					const match = matchingCompanion(companionChoices(this.options.companions, value), value);
					this.companionPicked = match != null && match.value === value.trim();
					text.inputEl?.classList.toggle('is-selected', this.companionPicked);
				});
			});
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
				button.onClick(() => this.finish());
			})
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			});
	}

	onClose(): void {
		window.clearTimeout(this.idleTimer);
		if (!this.settled) this.onDone(null);
		this.contentEl.empty();
	}

	private finish(): void {
		this.commitAddressMatch();
		this.commitCompanionMatch();
		const address = this.address.replace(/\r?\n/g, ' ').trim();
		const verified = this.verifiedHit && addressesMatchOneForOne(address, this.verifiedHit.formattedAddress)
			? this.verifiedHit
			: null;
		this.settled = true;
		this.onDone({
			gender: this.gender,
			name: this.name.trim(),
			address,
			companion: this.companion.trim(),
			priority: this.priority,
			verifiedHit: verified,
		});
		this.close();
	}

	private paintGender(setting: Setting): void {
		const buttons = setting.controlEl.querySelectorAll('button');
		buttons.forEach((button) => {
			button.classList.toggle('mod-cta', button.textContent === this.gender);
		});
	}

	private bindField(text: TextControl, commit: () => void, onChange: (value: string) => void): void {
		text.inputEl?.addEventListener('keydown', (event) => {
			if ((event as KeyboardEvent).key !== 'Enter') return;
			event.preventDefault();
			commit();
		});
		text.inputEl?.addEventListener('blur', () => commit());
		const control = text as TextControl & { onChange?: (fn: (value: string) => void) => void };
		control.onChange?.(onChange);
	}

	private forgetVerification(value: string): void {
		if (!this.verifiedHit) return;
		if (!addressesMatchOneForOne(value, this.verifiedHit.formattedAddress)) this.verifiedHit = null;
	}

	private scheduleAddressLookup(value: string): void {
		window.clearTimeout(this.idleTimer);
		const query = value.trim();
		const decision = addressLookupDecision(this.sentQuery.length, query.length);
		if (decision === 'wait') {
			this.addressResults = [];
			this.paintAddressHits();
			return;
		}
		if (decision === 'now') {
			this.enqueueAddress(query);
			return;
		}
		this.idleTimer = window.setTimeout(() => this.enqueueAddress(query), ADDRESS_LOOKUP_IDLE_MS);
	}

	private enqueueAddress(query: string): void {
		const current = query.trim();
		if (addressLookupDecision(0, current.length) === 'wait') return;
		if (this.lookupFlight) {
			this.queuedQuery = current;
			return;
		}
		if (current === this.sentQuery) return;
		this.lookupFlight = this.fetchAddress(current).finally(() => {
			this.lookupFlight = null;
			const next = this.queuedQuery;
			this.queuedQuery = null;
			if (!next || next === current || this.address.trim() !== next) return;
			const decision = addressLookupDecision(current.length, next.length);
			if (decision === 'now') this.enqueueAddress(next);
			else if (decision === 'idle') {
				this.idleTimer = window.setTimeout(() => this.enqueueAddress(next), ADDRESS_LOOKUP_IDLE_MS);
			}
		});
	}

	private async fetchAddress(query: string): Promise<void> {
		const lookup = this.options.lookupAddress;
		if (!lookup) return;
		this.sentQuery = query;
		let hits: readonly GeocodeHit[] = [];
		try {
			hits = await lookup(query);
		} catch {
			hits = [];
		}
		if (this.address.trim() !== query) return;
		const seen = new Set<string>();
		this.addressResults = [];
		for (const hit of hits) {
			const label = hit.formattedAddress.replace(/\s+/g, ' ').trim();
			if (!label || seen.has(label)) continue;
			seen.add(label);
			this.addressResults.push({ ...hit, formattedAddress: label });
		}
		this.paintAddressHits();
	}

	private paintAddressHits(): void {
		const list = this.addressList;
		if (!list) return;
		list.empty();
		for (const hit of this.addressResults) {
			list.createEl('option', {
				text: abbreviateAddress(hit.formattedAddress),
				attr: { value: hit.formattedAddress },
			});
		}
	}

	private selectAddress(hit: GeocodeHit): void {
		const label = hit.formattedAddress.replace(/\s+/g, ' ').trim();
		this.address = label;
		this.verifiedHit = { ...hit, formattedAddress: label };
		this.addressInput?.setValue(label);
		this.paintAddressHits();
	}

	private commitAddressMatch(): void {
		const match = matchingAddress(this.addressResults, this.address);
		if (!match) return;
		this.selectAddress(match);
	}

	private selectCompanion(value: string): void {
		this.companion = value;
		this.companionPicked = true;
		this.companionInput?.setValue(value);
		this.companionInput?.inputEl?.classList.toggle('is-selected', true);
	}

	private commitCompanionMatch(): void {
		if (this.companionPicked) return;
		const match = matchingCompanion(companionChoices(this.options.companions, this.companion), this.companion);
		if (!match) return;
		this.selectCompanion(match.value);
	}
}
