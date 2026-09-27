import { Modal, Notice, PluginSettingTab, Setting, TFile, normalizePath, requestUrl, type App } from 'obsidian';
import { GEOAPIFY_ATTRIBUTION, OSM_ATTRIBUTION, PRIVACY_NOTICE } from './constants';
import { parseDatePropertyNames } from './dates';
import {
	EXTRAS_SYNC_BRANCH,
	EXTRAS_SYNC_REPO,
	downloadExtras,
	extrasDestinations,
	isAllowlistedExtrasPath,
	type ExtrasSyncPlan,
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
			.setDesc('City is always saved on the note as City. Leave another name empty to skip that part. A filled extra name is overwritten from the geocoder result.');

		this.extraSetting('City property', 'City', () => this.plugin.settings.cityProperty, (value) => { this.plugin.settings.cityProperty = value; });
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
		const extrasPaths = extrasDestinations(this.app.vault.configDir).map((file) => file.vault).join(', ');
		new Setting(containerEl)
			.setName('Update Templater / Meta Bind extras from GitHub')
			.setDesc(`Downloads the public ${EXTRAS_SYNC_BRANCH} branch of ${EXTRAS_SYNC_REPO} and overwrites only these vault paths: ${extrasPaths}. Asks before writing. Does not change notes, Address, or the Geoapify key.`)
			.addButton((button) => {
				button.setButtonText('Update from GitHub');
				button.onClick(() => {
					const modal = new ExtrasSyncConfirmModal(this.app, () => {
						void this.installExtras();
					});
					modal.open();
				});
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

	private extraSetting(name: string, placeholder: string, read: () => string, write: (value: string) => void): void {
		this.propertySetting(name, 'Empty skips this output.', placeholder, read, write);
	}

	private async installExtras(): Promise<void> {
		let plan: ExtrasSyncPlan;
		try {
			plan = await downloadExtras(async (url) => {
				const response = await requestUrl({ url, throw: false });
				return {
					ok: response.status >= 200 && response.status < 300,
					status: response.status,
					text: response.text,
				};
			}, this.app.vault.configDir);
		} catch (error) {
			const reason = error instanceof Error && error.message ? error.message : 'download failed';
			new Notice(`Extras update failed. Nothing was written. ${reason}`, 10_000);
			return;
		}
		const written: string[] = [];
		const failed = [...plan.failed];
		for (const file of plan.updated) {
			try {
				await writeAllowlistedExtrasFile(this.app, file.vaultPath, file.contents, this.app.vault.configDir);
				written.push(file.vaultPath);
			} catch (error) {
				const reason = error instanceof Error && error.message ? error.message : 'write failed';
				failed.push({ vaultPath: file.vaultPath, reason });
			}
		}
		const failText = failed.map((item) => `${item.vaultPath} (${item.reason})`).join('; ');
		if (written.length === 0) {
			new Notice(`Extras update failed. Nothing was written. ${failText}`, 12_000);
			return;
		}
		const updated = `Updated ${written.length} file${written.length === 1 ? '' : 's'} from ${EXTRAS_SYNC_BRANCH}: ${written.join(', ')}.`;
		new Notice(failText ? `${updated} Failed: ${failText}` : updated, 12_000);
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

class ExtrasSyncConfirmModal extends Modal {
	constructor(app: App, private onYes: () => void) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Update Templater / Meta Bind extras');
		this.contentEl.createEl('p', {
			text: `Download the latest Templater scripts, New RV template, Meta Bind button helpers, the rv-dashboard snippet, and the matching docs from the public ${EXTRAS_SYNC_BRANCH} branch of ${EXTRAS_SYNC_REPO}, then overwrite the allowlisted vault files?`,
		});
		const list = this.contentEl.createEl('ul');
		for (const file of extrasDestinations(this.app.vault.configDir)) {
			list.createEl('li', { text: file.vault });
		}
		this.contentEl.createEl('p', {
			text: 'Notes, Address values, and the Geoapify key in plugin data are not touched.',
		});
		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText('Download and overwrite').setCta();
				button.onClick(() => {
					this.close();
					this.onYes();
				});
			});
	}
}

async function writeAllowlistedExtrasFile(app: App, vaultPath: string, contents: string, configDir: string): Promise<void> {
	const path = normalizePath(vaultPath);
	if (!isAllowlistedExtrasPath(path, configDir) || !isAllowlistedExtrasPath(vaultPath, configDir)) {
		throw new Error(`Refusing to write ${vaultPath}`);
	}
	const configPrefix = `${configDir.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
	if (path.startsWith(configPrefix)) {
		await writeHiddenVaultFile(app, path, contents);
		return;
	}
	await ensureVaultFolder(app, path);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, contents);
		return;
	}
	if (existing) throw new Error(`${path} exists and is not a file`);
	await app.vault.create(path, contents);
}

async function writeHiddenVaultFile(app: App, path: string, contents: string): Promise<void> {
	const adapter = app.vault.adapter;
	const folder = path.split('/').slice(0, -1).join('/');
	if (folder && !(await adapter.exists(folder))) {
		const parent = folder.split('/').slice(0, -1).join('/');
		if (parent && !(await adapter.exists(parent))) {
			await adapter.mkdir(parent);
		}
		await adapter.mkdir(folder);
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
