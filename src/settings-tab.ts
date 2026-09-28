import { Modal, Notice, PluginSettingTab, Setting, TFile, normalizePath, type App, type TextComponent } from 'obsidian';
import { GEOAPIFY_ATTRIBUTION, OSM_ATTRIBUTION, PRIVACY_NOTICE } from './constants';
import { parseDatePropertyNames } from './dates';
import { parseHomeCountyLines } from './home-base';
import {
	DEFAULT_HOME_LOG_TEMPLATE_FILE,
	DEFAULT_MISS_LOG_TEMPLATE_FILE,
	DEFAULT_NEW_RV_TEMPLATE_FILE,
	EXTRAS_SYNC_REF,
	EXTRAS_SYNC_REPO,
	assertExtrasDownloadUrl,
	downloadExtras,
	extrasRedirectUrl,
	isAllowlistedExtrasPath,
	planExtrasWrite,
	type ExtrasFetchResult,
	type ExtrasPlacement,
	type ExtrasSyncFailure,
	type ExtrasSyncFile,
} from './extras-sync';
import type RVLocatorPlugin from './main';
import { applyTemplateSettingChange, type TemplateRenameVault } from './template-rename';

/** Pause so a half-typed file name does not rename the note on every keystroke. */
const TEMPLATE_RENAME_DELAY_MS = 400;

export class RVLocatorSettingTab extends PluginSettingTab {
	private templateFieldGeneration = 0;
	private templateRenameChain: Promise<void> = Promise.resolve();

	constructor(app: App, private plugin: RVLocatorPlugin) {
		super(app, plugin);
	}

	display(): void {
		this.templateFieldGeneration += 1;
		const templateGeneration = this.templateFieldGeneration;
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Geocoding').setHeading();

		const keyDesc = createFragment((fragment) => {
			fragment.appendText('Free key from ');
			fragment.createEl('a', {
				text: 'Geoapify MyProjects',
				href: 'https://myprojects.geoapify.com/',
			});
			fragment.appendText('. It stays in this vault and is never printed in logs. ');
			fragment.appendText(PRIVACY_NOTICE);
		});

		let keyInput: HTMLInputElement | null = null;
		new Setting(containerEl)
			.setName('Geoapify API key')
			.setDesc(keyDesc)
			.addText((text) => {
				keyInput = text.inputEl;
				text.inputEl.type = 'password';
				text.setPlaceholder('Paste key');
				text.setValue(this.plugin.settings.geoapifyApiKey);
				text.onChange(async (value) => {
					this.plugin.settings.geoapifyApiKey = value.trim();
					await this.plugin.saveSettings();
				});
			})
			.addExtraButton((button) => {
				button.setIcon('eye');
				button.setTooltip('Show or hide API key');
				button.onClick(() => {
					if (!keyInput) return;
					const hidden = keyInput.type === 'password';
					keyInput.type = hidden ? 'text' : 'password';
					button.setIcon(hidden ? 'eye-off' : 'eye');
				});
			});

		new Setting(containerEl).setName('Property names').setHeading();

		this.propertySetting(
			'Address property',
			'Read for the lookup. Only this text is sent to Geoapify, and geocode never writes it.',
			'Address',
			() => this.plugin.settings.addressProperty,
			(value) => { this.plugin.settings.addressProperty = value; },
		);
		this.propertySetting(
			'Location property',
			'YAML list of two quoted strings: latitude, then longitude.',
			'Location',
			() => this.plugin.settings.locationProperty,
			(value) => { this.plugin.settings.locationProperty = value; },
		);
		this.propertySetting(
			'Map link property',
			'Google Maps search of Address; leave empty to skip. A street with no city adds the note’s City in the link only, and Address is never rewritten.',
			'Map Link',
			() => this.plugin.settings.mapLinkProperty,
			(value) => { this.plugin.settings.mapLinkProperty = value; },
		);

		new Setting(containerEl)
			.setName('Optional place properties')
			.setDesc('Geocode always writes City. Names below are optional; a filled name is overwritten from the result, and an empty name is skipped.');

		this.extraSetting(
			'City property',
			'City',
			() => this.plugin.settings.cityProperty,
			(value) => { this.plugin.settings.cityProperty = value; },
			'Optional extra name. Geocode always writes City even when this is empty.',
		);
		this.extraSetting('County property', 'County', () => this.plugin.settings.countyProperty, (value) => { this.plugin.settings.countyProperty = value; });
		this.extraSetting('State property', 'State', () => this.plugin.settings.stateProperty, (value) => { this.plugin.settings.stateProperty = value; });
		this.extraSetting('ZIP / postal property', 'ZIP', () => this.plugin.settings.postcodeProperty, (value) => { this.plugin.settings.postcodeProperty = value; });
		this.extraSetting('Country property', 'Country', () => this.plugin.settings.countryProperty, (value) => { this.plugin.settings.countryProperty = value; });

		new Setting(containerEl)
			.setName('Home counties')
			.setDesc('One county per line; empty always asks you to confirm, and Address is never written. A hit is saved without asking only when Geoapify confidence is 1.00 and it is the only hit in one of these counties, including bulk geocode.')
			.addTextArea((text) => {
				text.inputEl.rows = 4;
				text.setPlaceholder('Orange\nLake');
				text.setValue(this.plugin.settings.homeCounties.join('\n'));
				text.onChange(async (value) => {
					this.plugin.settings.homeCounties = parseHomeCountyLines(value);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName('Nearby views').setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Shows file name, Distance, Priority, Last Spoke, Last Attempted, Met, Visits, Successful Visits, Address, Met With, and Map Link, with Priority beside Distance. City is the stored City, or parsed from Address when City is missing, and the note still keeps the full address.',
		});
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Sort chips: Nearest / Furthest, Priority high or low, Spoke oldest or newest, Attempted oldest or newest. The first tap uses nearest, high, or longest-ago, and tapping the selected chip flips direction; the last choice is remembered.',
		});
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Active keeps a Hub link to Return Visits Hub when Priority is above 0. All keeps that link at any priority, Inactive only at Priority 0, and every layout skips +/Templates.',
		});

		new Setting(containerEl)
			.setName('Distance unit')
			.setDesc('Miles or kilometers in Nearby and Glancable. Distance stays on screen and is not written into notes.')
			.addDropdown((dropdown) => {
				dropdown.addOption('miles', 'Miles');
				dropdown.addOption('kilometers', 'Kilometers');
				dropdown.setValue(this.plugin.settings.distanceUnit);
				dropdown.onChange(async (value) => {
					this.plugin.settings.distanceUnit = value === 'kilometers' ? 'kilometers' : 'miles';
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Weekday date properties')
			.setDesc('Comma-separated property names, shown as Wed, 2pm, a smaller date, and a days chip. An empty value is a muted dash.')
			.addText((text) => {
				text.setPlaceholder('Last Spoke, Met, Last Attempted');
				text.setValue(this.plugin.settings.datePropertiesForWeekday.join(', '));
				text.onChange(async (value) => {
					this.plugin.settings.datePropertiesForWeekday = parseDatePropertyNames(value);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName('Developer').setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'While on, Nearby and Glancable use the test coordinates instead of this device, and a banner says so. Distance is not written into notes.',
		});
		new Setting(containerEl)
			.setName('Desktop distance testing')
			.setDesc('Nearby and Glancable use the test coordinates instead of this device.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.distanceTest);
				toggle.onChange(async (value) => {
					this.plugin.settings.distanceTest = value;
					await this.plugin.saveSettings();
				});
			});
		this.coordSetting(
			'Test latitude',
			'Used only while desktop distance testing is on. Default is an Orlando-area point.',
			'28.54',
			90,
			() => this.plugin.settings.testLatitude,
			(value) => { this.plugin.settings.testLatitude = value; },
		);
		this.coordSetting(
			'Test longitude',
			'Used only while desktop distance testing is on.',
			'-81.38',
			180,
			() => this.plugin.settings.testLongitude,
			(value) => { this.plugin.settings.testLongitude = value; },
		);

		new Setting(containerEl).setName('Templater and Meta Bind').setHeading();
		new Setting(containerEl)
			.setName('Setup wizard')
			.setDesc('Starts with home counties, then Templater, Meta Bind, and the template files. RV Locator does not install plugins or turn on the Meta Bind JS Engine or Templater system commands.')
			.addButton((button) => {
				button.setButtonText('Open setup wizard');
				button.onClick(() => { this.plugin.openSetupWizard(); });
			});
		new Setting(containerEl)
			.setName('Default priority for a new RV')
			.setDesc('Priority on a new RV. 0–5, default 3.')
			.addDropdown((dropdown) => {
				for (let rank = 0; rank <= 5; rank += 1) dropdown.addOption(String(rank), String(rank));
				dropdown.setValue(String(this.plugin.settings.defaultNewRvPriority));
				dropdown.onChange(async (value) => {
					this.plugin.settings.defaultNewRvPriority = Number(value);
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Link companions to notes')
			.setDesc('On, Taken stores [[Note Name]] when a note name or alias matches; otherwise plain text. Off is always plain text, and Met With is not changed.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.linkCompanionsToNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.linkCompanionsToNotes = value;
					await this.plugin.saveSettings();
				});
			});
		this.templateFileSetting(
			templateGeneration,
			'New RV template file',
			'Name in Templater’s templates folder. The + button uses it, then New RV.md. Changing it renames the file.',
			DEFAULT_NEW_RV_TEMPLATE_FILE,
			() => this.plugin.settings.newRvTemplateFile,
			(value) => { this.plugin.settings.newRvTemplateFile = value; },
			false,
		);
		this.templateFileSetting(
			templateGeneration,
			'Home log template file',
			'Home button template in Templater’s templates folder. Changing the name renames the file and updates templateFile paths that still use the old name.',
			DEFAULT_HOME_LOG_TEMPLATE_FILE,
			() => this.plugin.settings.homeLogTemplateFile,
			(value) => { this.plugin.settings.homeLogTemplateFile = value; },
			true,
		);
		this.templateFileSetting(
			templateGeneration,
			'Not home log template file',
			'Not home button template in Templater’s templates folder. Changing the name renames the file and updates templateFile paths that still use the old name.',
			DEFAULT_MISS_LOG_TEMPLATE_FILE,
			() => this.plugin.settings.missLogTemplateFile,
			(value) => { this.plugin.settings.missLogTemplateFile = value; },
			true,
		);
		const placement = this.plugin.extrasPlacement();
		new Setting(containerEl)
			.setName('Update templates and scripts')
			.setDesc(`Downloads tag ${EXTRAS_SYNC_REF} of ${EXTRAS_SYNC_REPO} into ${placement.templatesFolder}/ and ${placement.scriptsFolder}/ (not main or unstable; docs and the CSS snippet are not included). You confirm before anything is written; existing files stay unless overwrite is checked, and notes, Address, and the Geoapify key are not changed.`)
			.addButton((button) => {
				button.setButtonText('Update from GitHub');
				button.onClick(() => { startExtrasSync(this.app, this.plugin); });
			});

		new Setting(containerEl).setName('About').setHeading();

		const about = containerEl.createDiv('rv-locator-about');
		about.createEl('p', { text: `Map data ${OSM_ATTRIBUTION}` });
		about.createEl('p', { text: GEOAPIFY_ATTRIBUTION });
		about.createEl('p', { text: PRIVACY_NOTICE });
		const osm = about.createEl('p');
		const osmLink = osm.createEl('a', {
			text: 'OpenStreetMap copyright',
			href: 'https://www.openstreetmap.org/copyright',
		});
		osmLink.setAttr('rel', 'noopener');
		about.createEl('p', {
			text: 'Lookups use Geoapify’s EU endpoint (api-eu.geoapify.com). Google Maps is only used to build a link. This plugin does not call Nominatim or the Google Geocoding API.',
		});
	}

	private templateFileSetting(
		generation: number,
		name: string,
		desc: string,
		fallbackName: string,
		read: () => string,
		write: (value: string) => void,
		rewriteReferences: boolean,
	): void {
		let timer: number | undefined;
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.setPlaceholder(fallbackName);
				text.setValue(read());
				const run = (fromBlur: boolean) => {
					if (generation !== this.templateFieldGeneration) return;
					this.templateRenameChain = this.templateRenameChain
						.then(() => this.commitTemplateFileName(generation, text, read, write, fallbackName, rewriteReferences, fromBlur))
						.catch(() => undefined);
				};
				text.onChange(() => {
					if (timer) window.clearTimeout(timer);
					timer = window.setTimeout(() => {
						timer = undefined;
						run(false);
					}, TEMPLATE_RENAME_DELAY_MS);
				});
				text.inputEl.addEventListener('blur', () => {
					if (timer) window.clearTimeout(timer);
					timer = undefined;
					run(true);
				});
			});
	}

	private async commitTemplateFileName(
		generation: number,
		text: TextComponent,
		read: () => string,
		write: (value: string) => void,
		fallbackName: string,
		rewriteReferences: boolean,
		fromBlur: boolean,
	): Promise<void> {
		if (generation !== this.templateFieldGeneration) return;
		const previous = read();
		const result = await applyTemplateSettingChange(templateRenameVault(this.app), {
			templatesFolder: this.plugin.extrasPlacement().templatesFolder,
			previous,
			typed: text.getValue(),
			fallbackName,
			rewriteReferences,
			fromBlur,
		});
		if (result.name !== previous) {
			write(result.name);
			await this.plugin.saveSettings();
		}
		if (generation !== this.templateFieldGeneration) return;
		if ((result.revertField || result.name !== previous) && text.getValue() !== result.name) {
			text.setValue(result.name);
		}
		if (result.notice) new Notice(result.notice, 8_000);
	}

	private propertySetting(
		name: string,
		desc: string,
		placeholder: string,
		read: () => string,
		write: (value: string) => void,
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.setPlaceholder(placeholder);
				text.setValue(read());
				text.onChange(async (value) => {
					write(value.trim());
					await this.plugin.saveSettings();
				});
			});
	}

	private extraSetting(
		name: string,
		placeholder: string,
		read: () => string,
		write: (value: string) => void,
		desc = 'Leave empty to skip.',
	): void {
		this.propertySetting(name, desc, placeholder, read, write);
	}

	private coordSetting(
		name: string,
		desc: string,
		placeholder: string,
		limit: number,
		read: () => number,
		write: (value: number) => void,
	): void {
		new Setting(this.containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.setPlaceholder(placeholder);
				text.setValue(String(read()));
				text.onChange(async (value) => {
					const trimmed = value.trim();
					if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return;
					const next = Number(trimmed);
					if (!Number.isFinite(next) || Math.abs(next) > limit) return;
					write(next);
					await this.plugin.saveSettings();
				});
			});
	}
}

export function startExtrasSync(app: App, plugin: RVLocatorPlugin): void {
	void previewExtras(app, plugin);
}

async function previewExtras(app: App, plugin: RVLocatorPlugin): Promise<void> {
	const placement = plugin.extrasPlacement();
	const pending = new Notice(`Downloading templates and scripts (${EXTRAS_SYNC_REF})…`, 0);
	try {
		const plan = await downloadExtras((url) => fetchPinnedExtras(url), app.vault.configDir, EXTRAS_SYNC_REF, placement);
		pending.hide();
		if (plan.files.length === 0) {
			const failText = plan.failed.map((item) => `${item.vaultPath} (${item.reason})`).join('; ');
			new Notice(`Could not download templates. Nothing was written. ${failText}`, 12_000);
			return;
		}
		const rows: ExtrasPreviewRow[] = [];
		for (const file of plan.files) {
			rows.push({
				...file,
				exists: await extrasDestinationExists(app, file.vaultPath, app.vault.configDir, placement),
			});
		}
		const modal = new ExtrasSyncConfirmModal(app, rows, plan.failed, (overwriteExisting) => {
			void applyExtras(app, rows, overwriteExisting, placement);
		});
		modal.open();
	} catch (error) {
		pending.hide();
		const reason = error instanceof Error && error.message ? error.message : 'download failed';
		new Notice(`Could not download templates. Nothing was written. ${reason}`, 10_000);
	}
}

async function applyExtras(
	app: App,
	rows: readonly ExtrasPreviewRow[],
	overwriteExisting: boolean,
	placement: ExtrasPlacement,
): Promise<void> {
		const created: ExtrasPreviewRow[] = [];
		const overwritten: ExtrasPreviewRow[] = [];
		const skipped: ExtrasPreviewRow[] = [];
		const failed: ExtrasSyncFailure[] = [];
		for (const row of rows) {
			const action = planExtrasWrite(row.exists, overwriteExisting);
			if (action === 'skip') {
				skipped.push(row);
				continue;
			}
			try {
				await writeAllowlistedExtrasFile(app, row.vaultPath, row.contents, app.vault.configDir, action, placement);
				if (action === 'create') created.push(row);
				else overwritten.push(row);
			} catch (error) {
				const reason = error instanceof Error && error.message ? error.message : 'write failed';
				failed.push({ vaultPath: row.vaultPath, reason });
			}
		}
		const parts = [
			formatExtrasResult('Created', created),
			formatExtrasResult('Overwrote', overwritten),
			formatExtrasResult('Skipped', skipped),
			failed.length ? `Failed: ${failed.map((item) => `${item.vaultPath} (${item.reason})`).join('; ')}` : '',
		].filter(Boolean);
		const summary = parts.join(' ') || 'Nothing was written.';
		new Notice(`Templates ${EXTRAS_SYNC_REF}. ${summary}`, 14_000);
}

interface ExtrasPreviewRow extends ExtrasSyncFile {
	exists: boolean;
}

class ExtrasSyncConfirmModal extends Modal {
	private overwriteExisting = false;

	constructor(
		app: App,
		private rows: readonly ExtrasPreviewRow[],
		private failed: readonly ExtrasSyncFailure[],
		private onApply: (overwriteExisting: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Update templates and scripts');
		this.contentEl.createEl('p', {
			text: `Tag ${EXTRAS_SYNC_REF} of ${EXTRAS_SYNC_REPO}. Nothing is written until you confirm. Existing files are skipped unless overwrite is checked.`,
		});
		this.contentEl.createEl('p', {
			text: 'This does not enable plugins, the Meta Bind JS Engine, or Templater system commands. Notes, Address, and the Geoapify key are not changed.',
		});
		const list = this.contentEl.createEl('ul');
		const actions: HTMLElement[] = [];
		for (const row of this.rows) {
			const item = list.createEl('li');
			const action = item.createSpan();
			actions.push(action);
			item.createDiv({ text: row.vaultPath });
			item.createEl('code', { text: row.sha256 });
		}
		const paint = () => {
			this.rows.forEach((row, index) => {
				const action = planExtrasWrite(row.exists, this.overwriteExisting);
				const label = action === 'create' ? 'Create' : action === 'overwrite' ? 'Overwrite' : 'Skip (already exists)';
				actions[index]?.setText(label);
			});
		};
		paint();
		if (this.failed.length) {
			this.contentEl.createEl('p', {
				text: `Not downloaded: ${this.failed.map((item) => `${item.vaultPath} (${item.reason})`).join('; ')}`,
			});
		}
		const label = this.contentEl.createEl('label');
		const box = label.createEl('input');
		box.setAttr('type', 'checkbox');
		label.appendText(' Overwrite files that already exist');
		box.addEventListener('change', () => {
			this.overwriteExisting = box instanceof HTMLInputElement && box.checked;
			paint();
		});
		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText('Apply').setCta();
				button.onClick(() => {
					const overwrite = this.overwriteExisting;
					this.close();
					this.onApply(overwrite);
				});
			});
	}
}

async function fetchPinnedExtras(url: string): Promise<ExtrasFetchResult> {
	assertExtrasDownloadUrl(url);
	const response = await fetch(url, { redirect: 'manual' });
	if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
		const location = response.headers.get('location') ?? '';
		const next = extrasRedirectUrl(url, location);
		const followed = await fetch(next, { redirect: 'manual' });
		if (followed.type === 'opaqueredirect' || (followed.status >= 300 && followed.status < 400)) {
			throw new Error('Refusing a second redirect');
		}
		return {
			ok: followed.ok,
			status: followed.status,
			text: await followed.text(),
			finalUrl: followed.url || next,
		};
	}
	return {
		ok: response.ok,
		status: response.status,
		text: await response.text(),
		finalUrl: response.url || url,
	};
}

function templateRenameVault(app: App): TemplateRenameVault {
	return {
		fileState(path: string) {
			const normalized = normalizePath(path);
			if (normalized !== path) return 'missing';
			const file = app.vault.getAbstractFileByPath(normalized);
			if (!file) return 'missing';
			return file instanceof TFile ? 'file' : 'other';
		},
		async renameFile(from: string, to: string) {
			const source = normalizePath(from);
			const dest = normalizePath(to);
			if (source !== from || dest !== to) throw new Error('Refusing to rename outside the templates folder');
			const file = app.vault.getAbstractFileByPath(source);
			if (!(file instanceof TFile) || file.path !== source) throw new Error('Template file is missing');
			if (app.vault.getAbstractFileByPath(dest)) throw new Error('destination-exists');
			await app.fileManager.renameFile(file, dest);
		},
		markdownFiles() {
			return app.vault.getMarkdownFiles().map((file) => ({ path: file.path }));
		},
		async read(path: string) {
			const file = app.vault.getAbstractFileByPath(normalizePath(path));
			if (!(file instanceof TFile)) throw new Error('Template note is missing');
			return app.vault.read(file);
		},
		async modify(path: string, contents: string) {
			const normalized = normalizePath(path);
			if (normalized !== path) throw new Error('Refusing to rewrite outside the vault path');
			const file = app.vault.getAbstractFileByPath(normalized);
			if (!(file instanceof TFile) || file.path !== normalized) throw new Error('Template note is missing');
			await app.vault.modify(file, contents);
		},
	};
}

async function extrasDestinationExists(
	app: App,
	vaultPath: string,
	configDir: string,
	placement: ExtrasPlacement,
): Promise<boolean> {
	const path = normalizePath(vaultPath);
	if (!isAllowlistedExtrasPath(path, configDir, placement) && !isAllowlistedExtrasPath(vaultPath, configDir, placement)) return false;
	const configPrefix = `${configDir.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
	if (path.startsWith(configPrefix)) return app.vault.adapter.exists(path);
	return app.vault.getAbstractFileByPath(path) instanceof TFile;
}

async function writeAllowlistedExtrasFile(
	app: App,
	vaultPath: string,
	contents: string,
	configDir: string,
	mode: 'create' | 'overwrite',
	placement: ExtrasPlacement,
): Promise<void> {
	const path = normalizePath(vaultPath);
	const allowed = isAllowlistedExtrasPath(path, configDir, placement) && isAllowlistedExtrasPath(vaultPath, configDir, placement);
	if (path !== vaultPath || !allowed) {
		throw new Error(`Refusing to write ${vaultPath}`);
	}
	const configPrefix = `${configDir.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
	const exists = await extrasDestinationExists(app, path, configDir, placement);
	if (exists && mode !== 'overwrite') throw new Error('Refusing to overwrite');
	if (path.startsWith(configPrefix)) {
		if (path.includes('/plugins/')) throw new Error(`Refusing to write ${path}`);
		await writeHiddenVaultFile(app, path, contents, exists);
		return;
	}
	await ensureVaultFolder(app, path);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		if (existing.path !== path || mode !== 'overwrite') throw new Error('Refusing to overwrite');
		await app.vault.modify(existing, contents);
		return;
	}
	if (existing) throw new Error(`${path} exists and is not a file`);
	if (mode === 'overwrite') throw new Error(`${path} is missing`);
	await app.vault.create(path, contents);
}

function formatExtrasResult(label: string, rows: readonly ExtrasPreviewRow[]): string {
	if (rows.length === 0) return '';
	const detail = rows.map((row) => `${row.vaultPath} ${row.sha256}`).join('; ');
	return `${label} ${rows.length}: ${detail}.`;
}

async function writeHiddenVaultFile(app: App, path: string, contents: string, exists: boolean): Promise<void> {
	const adapter = app.vault.adapter;
	const now = await adapter.exists(path);
	if (now !== exists) throw new Error(exists ? 'Refusing to overwrite a missing file' : 'Refusing to overwrite');
	if (!exists) {
		const folder = path.split('/').slice(0, -1).join('/');
		if (folder && !(await adapter.exists(folder))) {
			const parent = folder.split('/').slice(0, -1).join('/');
			if (parent && !(await adapter.exists(parent))) await adapter.mkdir(parent);
			await adapter.mkdir(folder);
		}
	}
	await adapter.write(path, contents);
}

async function ensureVaultFolder(app: App, filePath: string): Promise<void> {
	const parts = filePath.split('/').slice(0, -1);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (app.vault.getAbstractFileByPath(current)) continue;
		await app.vault.createFolder(current);
	}
}
