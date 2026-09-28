import { Modal, Notice, PluginSettingTab, Setting, TFile, normalizePath, type App } from 'obsidian';
import { GEOAPIFY_ATTRIBUTION, OSM_ATTRIBUTION, PRIVACY_NOTICE } from './constants';
import { parseDatePropertyNames } from './dates';
import {
	EXTRAS_SYNC_REF,
	EXTRAS_SYNC_REPO,
	assertExtrasDownloadUrl,
	downloadExtras,
	extrasDestinations,
	extrasRedirectUrl,
	isAllowlistedExtrasPath,
	planExtrasWrite,
	type ExtrasFetchResult,
	type ExtrasPlacement,
	type ExtrasSyncFailure,
	type ExtrasSyncFile,
} from './extras-sync';
import type RVLocatorPlugin from './main';

export class RVLocatorSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: RVLocatorPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Geocoding').setHeading();

		const keyDesc = createFragment((fragment) => {
			fragment.appendText('Create a free key at ');
			fragment.createEl('a', {
				text: 'Geoapify MyProjects',
				href: 'https://myprojects.geoapify.com/',
			});
			fragment.appendText('. The key stays in this vault’s plugin data and is never printed in logs. ');
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
			'Read from this property. Only this text is sent to Geoapify. Geocode never writes it.',
			'Address',
			() => this.plugin.settings.addressProperty,
			(value) => { this.plugin.settings.addressProperty = value; },
		);
		this.propertySetting(
			'Location property',
			'Stored as a YAML list of two quoted strings, latitude then longitude.',
			'Location',
			() => this.plugin.settings.locationProperty,
			(value) => { this.plugin.settings.locationProperty = value; },
		);
		this.propertySetting(
			'Map link property',
			'Google Maps search of Address. A street with no city gets the note’s City appended in the link only. Address is never rewritten. Leave empty to skip.',
			'Map Link',
			() => this.plugin.settings.mapLinkProperty,
			(value) => { this.plugin.settings.mapLinkProperty = value; },
		);

		new Setting(containerEl)
			.setName('Optional place properties')
			.setDesc('Geocode always writes City. The City property below is an optional alias; leave it empty to skip that alias. Leave County, State, ZIP, or Country empty to skip that part. A filled extra name is overwritten from the geocoder result.');

		this.extraSetting(
			'City property',
			'City',
			() => this.plugin.settings.cityProperty,
			(value) => { this.plugin.settings.cityProperty = value; },
			'Optional alias. Geocode always writes City. An empty name here only skips that alias.',
		);
		this.extraSetting('County property', 'County', () => this.plugin.settings.countyProperty, (value) => { this.plugin.settings.countyProperty = value; });
		this.extraSetting('State property', 'State', () => this.plugin.settings.stateProperty, (value) => { this.plugin.settings.stateProperty = value; });
		this.extraSetting('ZIP / postal property', 'ZIP', () => this.plugin.settings.postcodeProperty, (value) => { this.plugin.settings.postcodeProperty = value; });
		this.extraSetting('Country property', 'Country', () => this.plugin.settings.countryProperty, (value) => { this.plugin.settings.countryProperty = value; });

		new Setting(containerEl)
			.setName('Home base counties')
			.setDesc('One county per line, such as Orange or Orange County. Leave this empty to always confirm the match. A result is saved without the picker only when Geoapify rank.confidence is 1.00 and it is the only result in one of these counties. A missing confidence, or two in-county results, opens the picker. Bulk geocode uses the same rule. Address is never written.')
			.addTextArea((text) => {
				text.inputEl.rows = 4;
				text.setPlaceholder('Orange\nLake');
				text.setValue(this.plugin.settings.homeCounties.join('\n'));
				text.onChange(async (value) => {
					this.plugin.settings.homeCounties = value.split(/\n/).map((line) => line.trim()).filter((line) => line.length > 0);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName('Nearby views').setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Nearby always shows file name, Distance, Priority, Last Spoke, Last Attempted, Met, Visits, Successful Visits, Address, Met With, and Map Link. Priority sits beside Distance. The stored City property is shown next to Distance; if City is missing, Nearby parses it from Address. The note still stores the full address. Sort chips are Nearest / Furthest, Priority · high / low, Spoke · oldest / newest, and Attempted · oldest / newest. The first tap uses nearest, high priority, or longest-ago. Tapping the selected chip flips direction. The last choice is remembered. Active layouts keep Hub links to Return Visits Hub with Priority above 0. All layouts keep that Hub link at any priority. Inactive layouts keep that Hub link with Priority 0. Every layout skips the +/Templates folder.',
		});

		new Setting(containerEl)
			.setName('Distance unit')
			.setDesc('Used by the nearby views. Distance is calculated on screen and is not written into notes.')
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
			.setDesc('Comma-separated property keys. Nearby shows Last Spoke, Last Attempted, and Met as a bold Wed, 2pm, a smaller Sep 9, 2026, and a days chip. An empty value is a muted em dash.')
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
			text: 'Desktop distance testing checks Distance and the Nearest sort without GPS. It is off by default. While it is on, Nearby uses the test latitude and longitude instead of this device, and a banner says so. Distance stays in memory and is not written into notes.',
		});
		new Setting(containerEl)
			.setName('Desktop distance testing')
			.setDesc('Use the test coordinates as the position for Distance, Nearest, and the Glancable distance slot.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.distanceTest);
				toggle.onChange(async (value) => {
					this.plugin.settings.distanceTest = value;
					await this.plugin.saveSettings();
				});
			});
		this.coordSetting(
			'Test latitude',
			'Used only while desktop distance testing is on. The default is an Orlando-area point.',
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
			.setDesc('Checks that Templater and Meta Bind are enabled, shows the folders Templater is using, and places templates and scripts. RV Locator does not install community plugins.')
			.addButton((button) => {
				button.setButtonText('Open setup wizard');
				button.onClick(() => { this.plugin.openSetupWizard(); });
			});
		new Setting(containerEl)
			.setName('Default priority for a new RV')
			.setDesc('Written as Priority when a new return-visit note is created. 0 through 5. The default is 3.')
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
			.setDesc('When on, Met With and Taken store [[Note Name]] if a note’s basename matches the companion. Otherwise the name stays plain text. One toggle; there is no prefix or suffix.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.linkCompanionsToNotes);
				toggle.onChange(async (value) => {
					this.plugin.settings.linkCompanionsToNotes = value;
					await this.plugin.saveSettings();
				});
			});
		this.propertySetting(
			'New RV template file',
			'File name inside Templater’s template folder. The + button looks for this name first, then New RV.md.',
			'99 New RV.md',
			() => this.plugin.settings.newRvTemplateFile,
			(value) => { this.plugin.settings.newRvTemplateFile = value; },
		);
		this.propertySetting(
			'Home log template file',
			'File name for the Meta Bind Home button. Sync writes it into Templater’s template folder and points New RV at that path.',
			'99 RV Log Home.md',
			() => this.plugin.settings.homeLogTemplateFile,
			(value) => { this.plugin.settings.homeLogTemplateFile = value; },
		);
		this.propertySetting(
			'Not home log template file',
			'File name for the Meta Bind Not home button. Sync writes it into Templater’s template folder and points New RV at that path.',
			'99 RV Log Miss.md',
			() => this.plugin.settings.missLogTemplateFile,
			(value) => { this.plugin.settings.missLogTemplateFile = value; },
		);
		const placement = this.plugin.extrasPlacement();
		const extrasPaths = extrasDestinations(this.app.vault.configDir, placement).map((file) => file.vault).join(', ');
		new Setting(containerEl)
			.setName('Update Templater / Meta Bind extras from GitHub')
			.setDesc(`Downloads tag ${EXTRAS_SYNC_REF} of ${EXTRAS_SYNC_REPO} from raw.githubusercontent.com. Not the moving main or unstable branch. Templates go to ${placement.templatesFolder}/ (Templater templates_folder) and scripts go to ${placement.scriptsFolder}/ (Templater user_scripts_folder). Documentation and the CSS snippet are not downloaded. Asks before any write. Existing files are skipped unless overwrite is checked. Does not change notes, Address, or the Geoapify key. Paths: ${extrasPaths}.`)
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
			text: 'Lookups use Geoapify’s EU endpoint (api-eu.geoapify.com). Google Maps is used only to build a link. This plugin does not call Nominatim or the Google Geocoding API.',
		});
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
		desc = 'Empty skips this output.',
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
	const pending = new Notice(`Downloading extras at ${EXTRAS_SYNC_REF}…`, 0);
	try {
		const plan = await downloadExtras((url) => fetchPinnedExtras(url), app.vault.configDir, EXTRAS_SYNC_REF, placement);
		pending.hide();
		if (plan.files.length === 0) {
			const failText = plan.failed.map((item) => `${item.vaultPath} (${item.reason})`).join('; ');
			new Notice(`Extras download failed. Nothing was written. ${failText}`, 12_000);
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
		new Notice(`Extras download failed. Nothing was written. ${reason}`, 10_000);
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
		new Notice(`Extras ${EXTRAS_SYNC_REF}. ${summary}`, 14_000);
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
		this.setTitle('Update Templater / Meta Bind extras');
		this.contentEl.createEl('p', {
			text: `Pinned ref ${EXTRAS_SYNC_REF} of ${EXTRAS_SYNC_REPO}. Nothing is written until you confirm. Existing files are skipped unless overwrite is checked. Templater system commands stay off. The Meta Bind JS Engine is not required. Notes, Address, and the Geoapify key are not touched.`,
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
