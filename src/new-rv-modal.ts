import { Modal, Notice, Setting, setIcon, type App, type ButtonComponent } from 'obsidian';
import { AddressSuggestController, type SuggestFetchResult } from './address-suggest';
import { emptyShare, studyPrefill, type LessonSpec, type VisitShare } from './catalog';
import { mountShareFields } from './catalog-fields';
import { iconizeModal, markModalTone } from './modal-chrome';
import { SUGGEST_PENDING, mountAlwaysChevron } from './suggest-field';
import { abbreviateAddress, addressesMatchOneForOne } from './address';
import { companionChoices, exactCompanion, matchingCompanion } from './companions';
import { statusIcon, type RvGender, type RvStatus } from './status';
import { RESTROOM_MAN, RESTROOM_WOMAN, ageYears } from './person-meta';
import type { GeocodeHit } from './types';

export interface NewRvIdentity {
	gender: RvGender;
	name: string;
	address: string;
	/** Empty when they leave the companion blank. */
	companion: string;
	priority: number;
	/** Blank when they leave Age empty. */
	age?: string;
	ageExact?: boolean;
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
	/** Lowest urgency color. Priority segments step down from this. */
	priorityAccent?: string;
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
	private age = '';
	private ageExact = false;
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
		// New RV priority drops 0. setLimits(1, 5) is the segment range.
		this.priority = Number.isInteger(priority) ? Math.max(1, Math.min(5, priority)) : 4;
	}

	onOpen(): void {
		this.modalEl.addClass('rv-locator-modal');
		this.modalEl.addClass('rv-new-rv');
		markModalTone(this.modalEl, 'general');
		this.setTitle(this.options.title ?? 'New RV');
		const { contentEl } = this;
		if (this.options.intro) {
			contentEl.createEl('p', {
				cls: 'rv-locator-modal-copy',
				text: this.options.intro,
			});
		}
		const gender = new Setting(contentEl).setName('Man / Woman');
		gender.settingEl?.addClass('rv-gender-choice');
		gender.addButton((button) => {
			mountGenderButton(button, 'Woman', RESTROOM_WOMAN, this.gender === 'Woman');
			button.onClick(() => {
				this.gender = 'Woman';
				this.paintGender(gender);
			});
		});
		gender.addButton((button) => {
			mountGenderButton(button, 'Man', RESTROOM_MAN, this.gender === 'Man');
			button.onClick(() => {
				this.gender = 'Man';
				this.paintGender(gender);
			});
		});
		new Setting(contentEl)
			.setName('Name')
			.addText((text) => {
				text.setPlaceholder('Optional (e.g. Maria)');
				text.setValue(this.name);
				text.onChange((value) => { this.name = value; });
			});
		const age = new Setting(contentEl).setName('Age');
		age.settingEl?.addClass('rv-age-choice');
		age.addText((text) => {
			text.setPlaceholder('Optional (e.g. ~35)');
			text.setValue(this.age);
			text.inputEl?.setAttribute('aria-label', 'Age');
			text.inputEl?.setAttribute('inputmode', 'numeric');
			text.onChange((value) => { this.age = value; });
			if (text.inputEl) mountAgeSymbol(text.inputEl, () => this.ageExact, (exact) => { this.ageExact = exact; });
		});
		new Setting(contentEl)
			.setName('Address')
			.addText((text) => {
				text.setPlaceholder('Required (e.g. 123 Oak St)');
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
			.setName('What publisher came with you?')
			.addText((text) => {
				text.setPlaceholder('Optional (e.g. Sister Johnson)');
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
		const priority = new Setting(contentEl).setName('Priority');
		priority.settingEl?.addClass('rv-priority-choice');
		const segs = priority.controlEl.createDiv('rv-priority-segs');
		if (this.options.priorityAccent) segs.style.setProperty('--rv-priority-accent', this.options.priorityAccent);
		for (let rank = 1; rank <= 5; rank += 1) {
			const button = segs.createEl('button', {
				cls: 'rv-priority-seg',
				text: String(rank),
				attr: { type: 'button', 'aria-label': `Priority ${rank}` },
			});
			button.dataset.priority = String(rank);
			button.addEventListener('click', () => {
				this.priority = rank;
				this.paintPriority(segs);
			});
		}
		this.paintPriority(segs);
		new Setting(contentEl)
			.setClass('rv-modal-actions')
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText('Create');
				button.setCta();
				button.onClick(() => this.finish());
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
		if (!address) {
			new Notice('Address is required.');
			return;
		}
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
			age: this.age.trim(),
			ageExact: this.ageExact,
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

	private paintPriority(host: HTMLElement): void {
		host.querySelectorAll('.rv-priority-seg').forEach((node) => {
			if (!(node instanceof HTMLElement)) return;
			node.classList.toggle('is-selected', node.dataset.priority === String(this.priority));
			node.setAttribute('aria-pressed', node.dataset.priority === String(this.priority) ? 'true' : 'false');
		});
	}

	private paintGender(setting: Setting): void {
		const buttons = setting.controlEl.querySelectorAll('button');
		buttons.forEach((button) => {
			button.classList.remove('mod-cta');
			button.classList.toggle('is-selected', button.dataset.gender === this.gender);
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
		const typed = this.addressInput?.inputEl instanceof HTMLInputElement ? this.addressInput.inputEl.value : this.address;
		if (!typed.trim()) return [SUGGEST_PENDING];
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

export function mountGenderButton(button: ButtonComponent, label: 'Man' | 'Woman', icon: string, selected: boolean): void {
	button.setButtonText('');
	button.setTooltip(label);
	const el = button.buttonEl;
	el.dataset.gender = label;
	el.setAttribute('aria-label', label);
	el.classList.toggle('is-selected', selected);
	setIcon(el, icon);
	el.createSpan({ cls: 'rv-gender-word', text: label });
}

export interface AttributeDraft {
	name: string;
	gender: RvGender;
	status: RvStatus;
	age: string;
	ageExact: boolean;
}

/** The person's name, status, age, and Man/Woman. The filename street stays out of Name. */
export class EditAttributesModal extends Modal {
	private name: string;
	private gender: RvGender;
	private status: RvStatus;
	private age: string;
	private ageExact: boolean;
	buttonAccent = '';

	constructor(
		app: App,
		current: AttributeDraft,
		private onDone: (next: AttributeDraft | null) => void,
	) {
		super(app);
		this.name = current.name;
		this.gender = current.gender;
		this.status = current.status;
		this.age = current.age;
		this.ageExact = current.ageExact;
	}

	onOpen(): void {
		this.modalEl.addClass('rv-locator-modal');
		this.modalEl.addClass('rv-edit-attributes');
		markModalTone(this.modalEl, 'rv', this.buttonAccent);
		this.setTitle('Edit attributes');
		const fields = this.contentEl.createDiv('rv-attr-fields');
		new Setting(fields)
			.setClass('rv-attr-name')
			.setName('Name')
			.addText((text) => {
				text.setValue(this.name);
				text.inputEl?.setAttribute('aria-label', 'Name');
				text.onChange((value) => { this.name = value; });
			});
		const status = new Setting(fields).setName('Status');
		status.settingEl?.addClass('rv-status-choice');
		const paintStatus = (): void => {
			const buttons = status.settingEl?.querySelectorAll('button') ?? [];
			buttons.forEach((button) => {
				if (!(button instanceof HTMLButtonElement)) return;
				button.classList.toggle('is-selected', button.dataset.status === this.status);
			});
		};
		for (const option of ['Active', 'Study', 'Inactive'] as const) {
			status.addButton((button) => {
				const el = button.buttonEl;
				el.dataset.status = option;
				el.setAttribute('aria-label', option);
				setIcon(el, statusIcon(option));
				el.createSpan({ cls: 'rv-gender-word', text: option });
				button.onClick(() => {
					this.status = option;
					paintStatus();
				});
			});
		}
		paintStatus();
		const age = new Setting(fields).setName('Age');
		age.settingEl?.addClass('rv-age-choice');
		age.addText((text) => {
			text.setPlaceholder('Optional (e.g. ~35)');
			text.setValue(this.age);
			text.inputEl?.setAttribute('aria-label', 'Age');
			text.inputEl?.setAttribute('inputmode', 'numeric');
			text.onChange((value) => { this.age = value; });
			if (text.inputEl) mountAgeSymbol(text.inputEl, () => this.ageExact, (exact) => { this.ageExact = exact; });
		});
		const gender = new Setting(fields).setName('Man / Woman');
		gender.settingEl?.addClass('rv-gender-choice');
		const paint = (): void => {
			const buttons = gender.settingEl?.querySelectorAll('button') ?? [];
			buttons.forEach((button) => {
				if (!(button instanceof HTMLButtonElement)) return;
				button.classList.toggle('is-selected', button.dataset.gender === this.gender);
			});
		};
		gender.addButton((button) => {
			mountGenderButton(button, 'Woman', RESTROOM_WOMAN, this.gender === 'Woman');
			button.onClick(() => {
				this.gender = 'Woman';
				paint();
			});
		});
		gender.addButton((button) => {
			mountGenderButton(button, 'Man', RESTROOM_MAN, this.gender === 'Man');
			button.onClick(() => {
				this.gender = 'Man';
				paint();
			});
		});
		const bar = this.contentEl.createDiv('rv-modal-actions');
		const cancel = bar.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
		const save = bar.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'button' } });
		cancel.addEventListener('click', () => {
			this.onDone(null);
			this.close();
		});
		save.addEventListener('click', () => {
			const years = ageYears(this.age.replace(/^~/, ''));
			this.onDone({
				name: this.name,
				gender: this.gender,
				status: this.status,
				age: years == null ? '' : String(years),
				ageExact: this.ageExact,
			});
			this.close();
		});
		iconizeModal(this.contentEl);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Right-side ~ or = box. The menu lists ~ Approximate and = Exact. No chevron. */
function mountAgeSymbol(input: HTMLElement, exact: () => boolean, setExact: (value: boolean) => void): void {
	const parent = input.parentElement;
	if (!parent || parent.querySelector('.rv-age-symbol')) return;
	parent.classList.add('rv-suggest-host');
	const button = input.ownerDocument.createElement('button');
	button.type = 'button';
	button.className = 'rv-suggest-chevron rv-age-symbol';
	button.setAttribute('aria-label', 'Age is approximate or exact');
	const paint = (): void => { button.textContent = exact() ? '=' : '~'; };
	paint();
	input.insertAdjacentElement('afterend', button);
	const panel = input.ownerDocument.createElement('div');
	panel.className = 'rv-suggest-panel rv-age-menu';
	panel.hidden = true;
	parent.appendChild(panel);
	const choices: ReadonlyArray<{ exact: boolean; label: string }> = [
		{ exact: false, label: '~ Approximate' },
		{ exact: true, label: '= Exact' },
	];
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (!panel.hidden) {
			panel.hidden = true;
			return;
		}
		panel.replaceChildren();
		for (const choice of choices) {
			const row = input.ownerDocument.createElement('button');
			row.type = 'button';
			row.className = 'rv-suggest-option';
			row.textContent = choice.label;
			row.classList.toggle('is-selected', choice.exact === exact());
			row.addEventListener('click', (click) => {
				click.preventDefault();
				click.stopPropagation();
				setExact(choice.exact);
				paint();
				panel.hidden = true;
			});
			panel.appendChild(row);
		}
		panel.hidden = false;
	});
	const doc = input.ownerDocument;
	const close = (event: Event): void => {
		if (!button.isConnected) {
			doc.removeEventListener('pointerdown', close);
			return;
		}
		const target = event.target;
		if (target instanceof Node && parent.contains(target)) return;
		panel.hidden = true;
	};
	doc.addEventListener('pointerdown', close);
}
