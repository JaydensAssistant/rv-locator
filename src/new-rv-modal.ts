import { Modal, Setting, type App } from 'obsidian';
import { emptyShare, type VisitShare } from './catalog';
import { mountShareFields } from './catalog-fields';
import { iconizeModal } from './modal-chrome';
import { mountAlwaysChevron } from './suggest-field';
import { abbreviateAddress, addressChevronLabels, addressesMatchOneForOne } from './address';
import { companionChoices, exactCompanion, matchingCompanion } from './companions';
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
	publications: string;
	media: string;
	publicationList?: string[];
	mediaList?: string[];
}

export interface NewRvModalOptions {
	defaultPriority: number;
	companions: readonly string[];
	/** Geoapify hits for the address field. Empty when there is no key or no match. */
	lookupAddress?: (query: string) => Promise<readonly GeocodeHit[]>;
	/** Stored addresses, newest first. Shown by the chevron until a lookup returns hits. */
	recentAddresses?: readonly string[];
	title?: string;
	intro?: string;
	preset?: Partial<Pick<NewRvIdentity, 'gender' | 'name' | 'address' | 'companion' | 'priority'>>;
	publications?: readonly string[];
	media?: readonly string[];
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
	private share: VisitShare = emptyShare();

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
		gender.settingEl?.addClass('rv-gender-choice');
		gender.addButton((button) => {
			button.setButtonText('♂');
			button.buttonEl.dataset.gender = 'Man';
			button.setTooltip('Man');
			if (this.gender === 'Man') button.setCta();
			button.onClick(() => {
				this.gender = 'Man';
				this.paintGender(gender);
			});
		});
		gender.addButton((button) => {
			button.setButtonText('♀');
			button.buttonEl.dataset.gender = 'Woman';
			button.setTooltip('Woman');
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
					if (exact) {
						this.verifiedHit = { ...exact, formattedAddress: exact.formattedAddress.replace(/\s+/g, ' ').trim() };
						this.releaseAddressList();
						return;
					}
					this.attachAddressList();
					this.scheduleAddressLookup(value);
				});
				const listId = `rv-locator-addresses-${Date.now()}`;
				this.addressList = contentEl.createEl('datalist', { attr: { id: listId } });
				text.inputEl?.setAttribute('list', listId);
				if (text.inputEl) {
					mountAlwaysChevron(text.inputEl, () => this.addressChevronItems(), (picked) => {
						const hit = this.addressResults.find((item) => item.formattedAddress === picked);
						if (hit) this.selectAddress(hit);
						else this.useRecentAddress(picked);
					});
				}
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
				if (text.inputEl) {
					mountAlwaysChevron(text.inputEl, () => companionChoices(this.options.companions, this.companion).map((item) => item.label), (picked) => {
						const match = companionChoices(this.options.companions, this.companion).find((item) => item.label === picked || item.value === picked);
						this.companion = match?.value ?? picked;
						text.setValue(this.companion);
						this.companionPicked = true;
					});
				}
				this.bindField(text, () => this.commitCompanionMatch(), (value) => {
					this.companion = value;
					const match = matchingCompanion(companionChoices(this.options.companions, value), value);
					this.companionPicked = match != null && match.value === value.trim();
					text.inputEl?.classList.toggle('is-selected', this.companionPicked);
				});
			});
		mountShareFields(contentEl, {
			publications: this.options.publications ?? [],
			media: this.options.media ?? [],
			customLessons: [],
			lessons: [],
			showLiterature: true,
			showLesson: false,
			initial: this.share,
		}, (next) => { this.share = next; });
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
		iconizeModal(contentEl);
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
			publications: this.share.publications.trim(),
			media: this.share.media.trim(),
			publicationList: this.share.publicationList,
			mediaList: this.share.mediaList,
		});
		this.close();
	}

	private paintGender(setting: Setting): void {
		const buttons = setting.controlEl.querySelectorAll('button');
		buttons.forEach((button) => {
			button.classList.toggle('mod-cta', button.dataset.gender === this.gender);
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
		if (this.verifiedHit && addressesMatchOneForOne(this.address, this.verifiedHit.formattedAddress)) {
			this.releaseAddressList();
			return;
		}
		this.attachAddressList();
		list.empty();
		for (const hit of this.addressResults) {
			list.createEl('option', {
				text: abbreviateAddress(hit.formattedAddress),
				attr: { value: hit.formattedAddress },
			});
		}
	}

	/** Recent addresses until Geoapify has hits. A lookup replaces the chevron list. */
	private addressChevronItems(): string[] {
		return addressChevronLabels(
			this.options.recentAddresses ?? [],
			this.addressResults.map((hit) => hit.formattedAddress),
			this.address,
		);
	}

	/** A stored address fills the field. It is not a Geoapify pick, so lookup can still confirm it. */
	private useRecentAddress(value: string): void {
		const label = value.replace(/\s+/g, ' ').trim();
		if (!label) return;
		this.address = label;
		this.verifiedHit = null;
		this.addressInput?.setValue(label);
		const input = this.addressInput?.inputEl;
		if (input instanceof HTMLInputElement) input.readOnly = false;
	}

	private selectAddress(hit: GeocodeHit): void {
		const label = hit.formattedAddress.replace(/\s+/g, ' ').trim();
		this.address = label;
		this.verifiedHit = { ...hit, formattedAddress: label };
		const shown = this.addressInput?.inputEl instanceof HTMLInputElement ? this.addressInput.inputEl.value : undefined;
		if (shown !== label) this.addressInput?.setValue(label);
		const input = this.addressInput?.inputEl;
		if (input instanceof HTMLInputElement) input.readOnly = false;
		this.releaseAddressList();
	}

	private commitAddressMatch(): void {
		if (this.verifiedHit && addressesMatchOneForOne(this.address, this.verifiedHit.formattedAddress)) {
			this.releaseAddressList();
			return;
		}
		const needle = this.address.replace(/\s+/g, ' ').trim().toLowerCase();
		if (!needle) return;
		const match = this.addressResults.find((hit) => {
			const full = hit.formattedAddress.replace(/\s+/g, ' ').trim().toLowerCase();
			return addressesMatchOneForOne(hit.formattedAddress, this.address)
				|| abbreviateAddress(hit.formattedAddress).toLowerCase() === needle
				|| full === needle;
		});
		if (!match) return;
		this.selectAddress(match);
	}

	/** A picked address is ordinary text. The dropdown comes back when the text is no longer that pick. */
	private releaseAddressList(): void {
		this.addressList?.empty();
		const input = this.addressInput?.inputEl;
		input?.removeAttribute('list');
		if (input instanceof HTMLInputElement) input.readOnly = false;
	}

	private attachAddressList(): void {
		const input = this.addressInput?.inputEl;
		const list = this.addressList;
		if (!input || !list?.id) return;
		if (input.getAttribute('list') !== list.id) input.setAttribute('list', list.id);
	}

	private selectCompanion(value: string): void {
		this.companion = value;
		this.companionPicked = true;
		this.companionInput?.setValue(value);
		this.companionInput?.inputEl?.classList.toggle('is-selected', true);
	}

	private commitCompanionMatch(): void {
		if (this.companionPicked) return;
		const match = exactCompanion(companionChoices(this.options.companions, this.companion), this.companion);
		if (!match) return;
		this.selectCompanion(match.value);
	}
}
