import { PluginSettingTab, Setting, type App } from 'obsidian';
import { GEOAPIFY_ATTRIBUTION, OSM_ATTRIBUTION, PRIVACY_NOTICE } from './constants';
import { parseDatePropertyNames } from './dates';
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
			'Written as a Google Maps URL. Leave empty to skip. No Google geocoding request is made.',
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
			text: 'Nearby always shows file name, Distance, Priority, Last Spoke, Last Attempted, Met, Visits, Successful Visits, Address, Met With, and Map Link. Priority sits beside Distance. The stored City property is shown next to Distance; if City is missing, Nearby parses it from Address. The note still stores the full address. Sort presets are Nearest, Priority, Last Spoke, and Last Attempted, and the last one you used is remembered. Active layouts keep Hub links to Return Visits Hub with Priority above 0. All layouts keep that Hub link at any priority. Inactive layouts keep that Hub link with Priority 0. Every layout skips the +/Templates folder.',
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
