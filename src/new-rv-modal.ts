import { Modal, Setting, type App } from 'obsidian';
import { AddressSuggestController, type SuggestFetchResult } from './address-suggest';
import { emptyShare, studyPrefill, type LessonSpec, type VisitShare } from './catalog';
import { mountShareFields } from './catalog-fields';
import { iconizeModal } from './modal-chrome';
import { SUGGEST_PENDING, mountAlwaysChevron } from './suggest-field';
import { abbreviateAddress, addressesMatchOneForOne } from './address';
import { companionChoices, exactCompanion, matchingCompanion } from './companions';
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
	lesson?: string;
	lessonFrom?: string;
	lessonTo?: string;
	extraLesson?: string;
	extraFrom?: string;
	extraTo?: string;
}

export interface NewRvModalOptions {
	defaultPriority: number;
	companions: readonly string[];
	/** Home-biased autocomplete, then a wider pass when home is sparse. */
	suggestHome?: (query: string) => Promise<SuggestFetchResult>;
	suggestBroad?: (query: string) => Promise<readonly GeocodeHit[]>;
	/** Session cache shared with the plugin so reopening the modal is instant. */
	addressCache?: () => Map<string, GeocodeHit[]>;
	lessons?: readonly LessonSpec[];
	customLessons?: readonly string[];
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
	private addressResults: GeocodeHit[] = [];
	private addressLoading = false;
	private addressInput: TextControl | null = null;
	private companionInput: TextControl | null = null;
	private suggest: AddressSuggestController | null = null;
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
		this.modalEl.addClass('rv-locator-modal');
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
						return;
					}
					this.suggest?.push(value);
				});
				if (text.inputEl) {
					mountAlwaysChevron(text.inputEl, () => this.addressChevronItems(), (picked) => {
						if (picked === SUGGEST_PENDING) return;
						const hit = this.addressResults.find((item) => item.formattedAddress === picked);
						if (hit) this.selectAddress(hit);
					});
					const home = this.options.suggestHome;
					const broad = this.options.suggestBroad;
					if (home && broad) {
						this.suggest = new AddressSuggestController({
							now: () => Date.now(),
							schedule: (ms, run) => window.setTimeout(run, ms),
							cancel: (id) => { window.clearTimeout(id); },
						}, { home, broad }, (view) => {
							this.addressLoading = view.loading;
							this.addressResults = view.hits.map((hit) => ({
								...hit,
								formattedAddress: hit.formattedAddress.replace(/\s+/g, ' ').trim(),
							}));
							text.inputEl?.dispatchEvent(new Event('rv-suggest-sync'));
						}, this.options.addressCache?.());
					}
				}
			});
		new Setting(contentEl)
			.setName('Companion')
			.setDesc('Optional. Leave blank and press Create to skip.')
			.addText((text) => {
				text.setPlaceholder('Companion (optional)');
				text.setValue(this.companion);
				this.companionInput = text;
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
			customLessons: this.options.customLessons ?? [],
			lessons: this.options.lessons ?? [],
			showLiterature: true,
			literatureCollapsed: false,
			lessonExpanded: false,
			showLesson: false,
			optionalLesson: true,
			lessonPrefill: studyPrefill(null, this.options.lessons),
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
		this.suggest?.dispose();
		this.suggest = null;
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
			lesson: this.share.lesson,
			lessonFrom: this.share.lessonFrom,
			lessonTo: this.share.lessonTo,
			extraLesson: this.share.extraLesson,
			extraFrom: this.share.extraFrom,
			extraTo: this.share.extraTo,
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

	private addressChevronItems(): string[] {
		const labels = this.addressResults.map((hit) => hit.formattedAddress).filter((label) => label.length > 0);
		return this.addressLoading ? [SUGGEST_PENDING, ...labels] : labels;
	}

	private selectAddress(hit: GeocodeHit): void {
		const label = hit.formattedAddress.replace(/\s+/g, ' ').trim();
		this.address = label;
		this.verifiedHit = { ...hit, formattedAddress: label };
		const shown = this.addressInput?.inputEl instanceof HTMLInputElement ? this.addressInput.inputEl.value : undefined;
		if (shown !== label) this.addressInput?.setValue(label);
		const input = this.addressInput?.inputEl;
		if (input instanceof HTMLInputElement) input.readOnly = false;
	}

	private commitAddressMatch(): void {
		if (this.verifiedHit && addressesMatchOneForOne(this.address, this.verifiedHit.formattedAddress)) return;
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
