import { Modal, Notice, PluginSettingTab, Setting, TFile, normalizePath, setIcon, type App, type TextComponent } from 'obsidian';
import { GEOAPIFY_ATTRIBUTION, NON_AFFILIATION_NOTICE, OSM_ATTRIBUTION, PRIVACY_NOTICE } from './constants';
import { deleteCustom, rememberCustom } from './catalog';
import { iconizeModal } from './modal-chrome';
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
import { SUGGESTION_COLOR_OPTIONS, sanitizeSuggestionColor } from './suggestion-callout';
import {
	explainMayGoOut,
	paintMayGoOutGrid,
	renderDensitySettings,
	renderDigestThresholds,
	renderGlancableChrome,
	renderIdealitySettings,
	renderPriorityNudge,
	renderSortChips,
	renderUrgencySettings,
} from './settings-scoring';
import { applyTemplateSettingChange, type TemplateRenameVault } from './template-rename';
import { resetSettingsTab } from './settings-reset';
import { attemptLogFullWidth } from './types';
import { renderUrgencyPalette } from './urgency-palette-ui';

/** Pause so a half-typed file name does not rename the note on every keystroke. */
const TEMPLATE_RENAME_DELAY_MS = 400;

type SettingsSection = 'everyday' | 'urgency' | 'nearby' | 'templates' | 'advanced';

const SETTINGS_SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string; icon: string }> = [
	{ id: 'everyday', label: 'Everyday', icon: 'star' },
	{ id: 'urgency', label: 'Urgency', icon: 'alert-circle' },
	{ id: 'nearby', label: 'Nearby', icon: 'map-pin' },
	{ id: 'templates', label: 'Templates', icon: 'file-text' },
	{ id: 'advanced', label: 'Advanced', icon: 'wrench' },
];

export class RVLocatorSettingTab extends PluginSettingTab {
	private templateFieldGeneration = 0;
	private templateRenameChain: Promise<void> = Promise.resolve();
	private section: SettingsSection = 'everyday';
	private mountEl: HTMLElement = this.containerEl;

	constructor(app: App, private plugin: RVLocatorPlugin) {
		super(app, plugin);
	}

	display(): void {
		this.templateFieldGeneration += 1;
		const templateGeneration = this.templateFieldGeneration;
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('rv-locator-settings');
		this.paintSectionBar(containerEl);
		const body = containerEl.createDiv('rv-locator-settings-body');
		this.mountEl = body;
		if (this.section === 'everyday') this.paintEveryday(body);
		else if (this.section === 'urgency') this.paintUrgency(body);
		else if (this.section === 'nearby') this.paintNearby(body);
		else if (this.section === 'templates') this.paintTemplates(body, templateGeneration);
		else this.paintAdvanced(body);
		this.paintReset(body);
	}

	private paintSectionBar(containerEl: HTMLElement): void {
		const bar = containerEl.createDiv('rv-locator-settings-tabs');
		for (const section of SETTINGS_SECTIONS) {
			const button = bar.createEl('button', {
				cls: `rv-locator-settings-tab${this.section === section.id ? ' is-active' : ''}`,
				attr: { type: 'button' },
			});
			const icon = button.createSpan('rv-locator-settings-tab-icon');
			setIcon(icon, section.icon);
			button.createSpan({ text: section.label });
			button.addEventListener('click', () => {
				if (this.section === section.id) return;
				this.section = section.id;
				this.display();
			});
		}
	}

	private paintEveryday(containerEl: HTMLElement): void {
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

		new Setting(containerEl)
			.setName('Geoapify region')
			.setDesc('Global is the default. EU sends lookups to api-eu.geoapify.com only when you choose it here.')
			.addDropdown((dropdown) => {
				dropdown.addOption('global', 'Global');
				dropdown.addOption('eu', 'EU');
				dropdown.setValue(this.plugin.settings.geoapifyRegion);
				dropdown.onChange(async (value) => {
					this.plugin.settings.geoapifyRegion = value === 'eu' ? 'eu' : 'global';
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Home counties')
			.setDesc('One county per line. Empty means every match asks you to confirm. A fully confident hit is saved only when it is the only hit in one of these counties.')
			.addTextArea((text) => {
				text.inputEl.rows = 4;
				text.setPlaceholder('Orange\nLake');
				text.setValue(this.plugin.settings.homeCounties.join('\n'));
				text.onChange(async (value) => {
					this.plugin.settings.homeCounties = parseHomeCountyLines(value);
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName('May-go-out schedule').setHeading();
		explainMayGoOut(containerEl);
		paintMayGoOutGrid(
			containerEl,
			() => this.plugin.settings.availabilityGrid,
			(key, level) => {
				this.plugin.settings.availabilityGrid = { ...this.plugin.settings.availabilityGrid, [key]: level };
				void this.plugin.saveSettings();
			},
		);
		new Setting(containerEl)
			.setName('Digest table')
			.setDesc(this.plugin.settings.digestOrientation === 'columns'
				? 'Dayparts run down the side. Days run across. Changing this rewrites the digest on every RV note. It does not change Attempt Log width.'
				: 'Days run down the side. Dayparts run across. Changing this rewrites the digest on every RV note. It does not change Attempt Log width.')
			.addButton((button) => {
				button.setButtonText('Swap rows and columns');
				button.onClick(() => {
					this.plugin.settings.digestOrientation = this.plugin.settings.digestOrientation === 'columns' ? 'rows' : 'columns';
					void this.plugin.saveSettings().then(() => this.display());
				});
			});
		new Setting(containerEl)
			.setName('Show every weekday')
			.setDesc(this.plugin.settings.digestDays === 'may'
				? 'Off. The table lists only days that have a May-go-out daypart. A daypart that is not May go out shows an em dash. Turn this on to list Sun through Sat as 0/0 or the real count.'
				: 'On. The table lists Sun through Sat. A day that is not May go out shows 0/0, or the real count when that slot has attempts. Turn this off to list only May-go-out days.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.digestDays !== 'may');
				toggle.onChange(async (value) => {
					this.plugin.settings.digestDays = value ? 'all' : 'may';
					await this.plugin.saveSettings();
					this.display();
				});
			});
		new Setting(containerEl)
			.setName('Return Suggestions color')
			.setDesc('Colors the Return Suggestions callout. Automatic follows the theme accent, and changing the accent recolors every RV note. Changing this rewrites every RV note.')
			.addDropdown((dropdown) => {
				for (const option of SUGGESTION_COLOR_OPTIONS) dropdown.addOption(option.id, option.label);
				dropdown.setValue(sanitizeSuggestionColor(this.plugin.settings.suggestionColor));
				dropdown.onChange(async (value) => {
					this.plugin.settings.suggestionColor = sanitizeSuggestionColor(value);
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Open RV notes in Reading view')
			.setDesc('An RV note opens in Reading view. Visit notes are Meta Bind boxes, so they stay editable there. Switching to editing yourself is kept until the note is opened again.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.openRvInReadingView);
				toggle.onChange(async (value) => {
					this.plugin.settings.openRvInReadingView = value;
					await this.plugin.saveSettings();
				});
			});

		this.paintNoteLayout(containerEl);

		new Setting(containerEl).setName('Glancable density').setHeading();
		renderDensitySettings(containerEl, this.plugin);

		new Setting(containerEl).setName('New notes').setHeading();
		new Setting(containerEl)
			.setName('Default priority')
			.setDesc('Priority written on a new RV. 0 to 5, default 4.')
			.addSlider((slider) => {
				slider.setLimits(0, 5, 1);
				slider.setValue(this.plugin.settings.defaultNewRvPriority);
				slider.setDynamicTooltip();
				slider.onChange(async (value) => {
					this.plugin.settings.defaultNewRvPriority = value;
					await this.plugin.saveSettings();
				});
			});
		renderPriorityNudge(containerEl, this.plugin);
	}

	private paintNoteLayout(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('RV note layout').setHeading();
		new Setting(containerEl)
			.setName('Short daypart names')
			.setDesc('The Attempt Log table reads Mor, Aft, and Eve. Turn this off for Morning, Afternoon, and Evening. Changing this rewrites the digest on every RV note.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.abbreviateDayparts);
				toggle.onChange(async (value) => {
					this.plugin.settings.abbreviateDayparts = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Attempt Log width')
			.setDesc('Full width is the default. Automatic stays full width too. Dashboard column is the narrow width. Swapping digest rows and columns does not change this.')
			.addDropdown((dropdown) => {
				dropdown.addOption('auto', `Automatic (now ${attemptLogFullWidth(this.plugin.settings) ? 'full width' : 'dashboard column'})`);
				dropdown.addOption('full', 'Full width');
				dropdown.addOption('column', 'Dashboard column');
				dropdown.setValue(this.plugin.settings.attemptLogWidth);
				dropdown.onChange(async (value) => {
					this.plugin.settings.attemptLogWidth = value === 'full' || value === 'column' ? value : 'auto';
					await this.plugin.saveSettings();
				});
			});
		const centers: ReadonlyArray<{ key: 'centerDashboard' | 'centerVisitNotes' | 'centerSuggestions'; name: string; desc: string }> = [
			{ key: 'centerDashboard', name: 'Center RV Dashboard', desc: 'Centers the RV Dashboard title, Hubs, Address, and buttons. Quick Facts labels stay left aligned.' },
			{ key: 'centerVisitNotes', name: 'Center visit notes', desc: 'On when the setting is missing. Centers the Visit Notes heading, each visit stamp, and the notes block. The words in the notes box stay left aligned.' },
			{ key: 'centerSuggestions', name: 'Center Return Suggestions', desc: 'Centers the Return Suggestions title and lines, the Attempt Log, its table, and its visit lines.' },
		];
		for (const center of centers) {
			new Setting(containerEl)
				.setName(center.name)
				.setDesc(center.desc)
				.addToggle((toggle) => {
					toggle.setValue(this.plugin.settings[center.key]);
					toggle.onChange(async (value) => {
						this.plugin.settings[center.key] = value;
						await this.plugin.saveSettings();
					});
				});
		}
		const wides: ReadonlyArray<{ key: 'wideQuickFacts' | 'wideHubsAddress' | 'wideVisitButtons'; name: string; desc: string }> = [
			{ key: 'wideQuickFacts', name: 'Wide Quick Facts', desc: 'Quick Facts uses the full note width. Off keeps it in the dashboard column.' },
			{ key: 'wideHubsAddress', name: 'Wide Hubs and Address', desc: 'Hubs and Address use the full note width. Off keeps them in the dashboard column.' },
			{ key: 'wideVisitButtons', name: 'Wide visit buttons', desc: 'Home, Not home, Log past visit, and Archive span the full RV Dashboard. Off lines their right edge up with Hub + and the map button.' },
		];
		for (const wide of wides) {
			new Setting(containerEl)
				.setName(wide.name)
				.setDesc(wide.desc)
				.addToggle((toggle) => {
					toggle.setValue(this.plugin.settings[wide.key]);
					toggle.onChange(async (value) => {
						this.plugin.settings[wide.key] = value;
						await this.plugin.saveSettings();
					});
				});
		}
		const badges: ReadonlyArray<{ key: 'showUrgencyBadge' | 'showPriorityBadge' | 'showRouteBadge'; name: string; desc: string }> = [
			{ key: 'showUrgencyBadge', name: 'Quick Facts urgency badge', desc: 'The urgency circle in the Quick Facts header. On by default. It opens Home, Not home, Log past visit, Archive, and snooze.' },
			{ key: 'showPriorityBadge', name: 'Quick Facts priority badge', desc: 'The priority circle in the Quick Facts header. On by default. It opens a priority slider.' },
			{ key: 'showRouteBadge', name: 'Quick Facts route badge', desc: 'The route circle in the Quick Facts header. On by default. It opens the Google Maps link for that RV. It does not open the coming-soon map.' },
		];
		for (const badge of badges) {
			new Setting(containerEl)
				.setName(badge.name)
				.setDesc(badge.desc)
				.addToggle((toggle) => {
					toggle.setValue(this.plugin.settings[badge.key]);
					toggle.onChange(async (value) => {
						this.plugin.settings[badge.key] = value;
						await this.plugin.saveSettings();
					});
				});
		}
		new Setting(containerEl)
			.setName('Newest visits first')
			.setDesc('A new visit is written at the top of the note and older visits move down in the file. The screen follows that order.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.visitsNewestFirst);
				toggle.onChange(async (value) => {
					this.plugin.settings.visitsNewestFirst = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Collapse older visits')
			.setDesc('Only the most recent visits stay open. The rest sit under an Older Visits heading, collapsed, with a horizontal rule above it.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.collapseOlderVisits);
				toggle.onChange(async (value) => {
					this.plugin.settings.collapseOlderVisits = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Visible visit notes')
			.setDesc('How many of the most recent visit notes stay visible when older visits are collapsed. Default 3.')
			.addSlider((slider) => {
				slider.setLimits(1, 30, 1);
				slider.setValue(this.plugin.settings.visibleVisitCount);
				slider.setDynamicTooltip();
				slider.onChange(async (value) => {
					this.plugin.settings.visibleVisitCount = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Return status on cards')
			.setDesc('On unless it was turned off. The bottom line of a Glancable card shows the visit count and the current daypart bucket (Avoid, Try, Unsure, or Untried), with the weekday and daypart in front of the bucket.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showCardReturnStatus);
				toggle.onChange(async (value) => {
					this.plugin.settings.showCardReturnStatus = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Return status format')
			.setDesc('Short is the default, like Sat mor. Long keeps the full weekday and daypart, like Friday afternoon.')
			.addDropdown((dropdown) => {
				dropdown.addOption('short', 'Short (Sat mor)');
				dropdown.addOption('long', 'Long (Friday afternoon)');
				dropdown.setValue(this.plugin.settings.cardReturnFormat);
				dropdown.onChange(async (value) => {
					this.plugin.settings.cardReturnFormat = value === 'long' ? 'long' : 'short';
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Name only on cards')
			.setDesc('On unless it was turned off. The card title is the person\'s name. Off shows Name on Street.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.cardTitleNameOnly);
				toggle.onChange(async (value) => {
					this.plugin.settings.cardTitleNameOnly = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Compact mode')
			.setDesc('On unless turned off. Last Spoke, Last Attempted, and Met share one line: the symbol and how many days, with no weekday, time, or date. The circles on the right shrink to the lines that are showing. Day values are bold.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.compactMode);
				toggle.onChange(async (value) => {
					this.plugin.settings.compactMode = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Literature on a study')
			.setDesc('Off by default. A study\'s at-home log, past visit, and edit hide literature and media unless this is on. The lesson prompt stays.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.showStudyLiterature);
				toggle.onChange(async (value) => {
					this.plugin.settings.showStudyLiterature = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Lessons/Studies on a study')
			.setDesc('On shows Lessons/Studies, such as 2/6 (0.33) in Quick Facts. Off shows Studies/Lessons. The card leaves off the divided number. Missing this setting stays Lessons/Studies.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.studyRatio !== 'studies-lessons');
				toggle.onChange(async (value) => {
					this.plugin.settings.studyRatio = value ? 'lessons-studies' : 'studies-lessons';
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Last Spoke on a study')
			.setDesc('Off unless it was turned on. A study card and Quick Facts show Last Studied instead. This puts Last Spoke back as well.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.studyShowSpoke);
				toggle.onChange(async (value) => {
					this.plugin.settings.studyShowSpoke = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Last Attempted on a study')
			.setDesc('Off unless it was turned on. A study card and Quick Facts show Last Studied instead. This puts Last Attempted back as well.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.studyShowAttempted);
				toggle.onChange(async (value) => {
					this.plugin.settings.studyShowAttempted = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Left-align suggestion bullets')
			.setDesc('On by default. Return-suggestion bullets stay left-aligned even when Center Return Suggestions is on. Attempt Log lines are left-aligned too.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.leftAlignSuggestionBullets);
				toggle.onChange(async (value) => {
					this.plugin.settings.leftAlignSuggestionBullets = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('City on its own line')
			.setDesc('Off by default. City and distance move off the address line, with a building icon.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.splitCityLine);
				toggle.onChange(async (value) => {
					this.plugin.settings.splitCityLine = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Card icon scale')
			.setDesc('Glanceable card icons. 1.2 is about 20% larger than the original size.')
			.addSlider((slider) => {
				slider.setLimits(0.8, 2, 0.1);
				slider.setValue(this.plugin.settings.glancableIconScale);
				slider.setDynamicTooltip();
				slider.onChange(async (value) => {
					this.plugin.settings.glancableIconScale = value;
					await this.plugin.saveSettings();
				});
			});
		this.renderCatalog(containerEl, 'Publications', 'customPublications');
		this.renderCatalog(containerEl, 'Media', 'customMedia');
		this.renderCatalog(containerEl, 'Lessons', 'customLessons');
		new Setting(containerEl)
			.setName('Page preview on the dashboard')
			.setDesc('Off by default. While this is off, hovering a title on the RV Dashboard or a Glancable card does not open Page Preview, even when that core plugin is enabled.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.dashboardPagePreview);
				toggle.onChange(async (value) => {
					this.plugin.settings.dashboardPagePreview = value;
					await this.plugin.saveSettings();
				});
			});
	}

	private renderCatalog(
		containerEl: HTMLElement,
		label: string,
		key: 'customPublications' | 'customMedia' | 'customLessons',
	): void {
		new Setting(containerEl).setName(label).setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'The official list is empty until titles are added. Add a custom entry here, or type one while logging. Rename updates every note that stores that name. Delete removes it from future suggestions only.',
		});
		for (const name of this.plugin.settings[key]) {
			new Setting(containerEl)
				.setName(name)
				.addButton((button) => {
					button.setButtonText('Rename');
					button.onClick(() => {
						new CatalogRenameModal(this.app, name, (next) => {
							void this.plugin.renameCatalogEntry(key, name, next).then(() => this.display());
						}).open();
					});
				})
				.addButton((button) => {
					button.setButtonText('Delete');
					button.setWarning();
					button.onClick(async () => {
						this.plugin.settings[key] = deleteCustom(this.plugin.settings[key], name);
						await this.plugin.saveSettings();
						this.display();
					});
				});
		}
		let draft = '';
		new Setting(containerEl)
			.setName('Add a custom entry')
			.addText((text) => {
				text.setPlaceholder(label);
				text.onChange((value) => { draft = value; });
			})
			.addButton((button) => {
				button.setButtonText('Add');
				button.onClick(async () => {
					const next = rememberCustom(this.plugin.settings[key], draft, []);
					if (next.length === this.plugin.settings[key].length) {
						new Notice('That entry is already in the list.');
						return;
					}
					this.plugin.settings[key] = next;
					await this.plugin.saveSettings();
					this.display();
				});
			});
	}

	private paintReset(containerEl: HTMLElement): void {
		const section = this.section;
		const label = SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? 'this tab';
		new Setting(containerEl)
			.setName(`Reset ${label}`)
			.setDesc(section === 'everyday'
				? 'Resets only this tab. The Geoapify API key stays. Other tabs and the active campaign stay as they are.'
				: 'Resets only this tab. Other tabs, the Geoapify API key, and the active campaign stay as they are.')
			.addButton((button) => {
				button.setButtonText('Reset this tab');
				button.setWarning();
				button.onClick(async () => {
					this.plugin.settings = resetSettingsTab(this.plugin.settings, section);
					await this.plugin.saveSettings();
					this.display();
				});
			});
	}

	private paintUrgency(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Urgency').setHeading();
		renderUrgencyPalette(
			containerEl,
			() => ({ palette: this.plugin.settings.urgencyPalette, custom: this.plugin.settings.urgencyCustomColors }),
			async ({ palette, custom }) => {
				this.plugin.settings.urgencyPalette = palette;
				this.plugin.settings.urgencyCustomColors = custom;
				await this.plugin.saveSettings();
			},
		);
		renderUrgencySettings(containerEl, this.plugin);
	}

	private paintNearby(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Nearby').setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'Return Visits keeps a hub link at any priority and skips templates. Active, RVs Only, Studies, and Archive, then Men+Women, Men, and Women, filter that list.',
		});
		new Setting(containerEl)
			.setName('Distance unit')
			.setDesc('Miles or kilometers. Distance stays on screen.')
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
			.setDesc('Comma-separated names, shown as Wed, 2pm, a smaller date, and a days chip.')
			.addText((text) => {
				text.setPlaceholder('Last Spoke, Met, Last Attempted');
				text.setValue(this.plugin.settings.datePropertiesForWeekday.join(', '));
				text.onChange(async (value) => {
					this.plugin.settings.datePropertiesForWeekday = parseDatePropertyNames(value);
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl).setName('Sort chips').setHeading();
		renderSortChips(containerEl, this.plugin, ['distance', 'priority', 'spoke', 'attempted', 'met', 'city', 'urgency']);
	}

	private paintTemplates(containerEl: HTMLElement, templateGeneration: number): void {
		new Setting(containerEl).setName('Templates').setHeading();
		new Setting(containerEl)
			.setName('Setup wizard')
			.setDesc('Home counties and the may-go-out schedule, urgency colors, then Templater and Meta Bind. RV Locator does not install plugins.')
			.addButton((button) => {
				button.setButtonText('Open setup wizard');
				button.onClick(() => { this.plugin.openSetupWizard(); });
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
		new Setting(containerEl)
			.setName('Return visit hub')
			.setDesc('The hub chip in each note that points at Return Visits Hub opens this note instead. Other hubs stay as they are written.')
			.addText((text) => {
				text.setPlaceholder('Return Visits Hub');
				text.setValue(this.plugin.settings.returnHubNote);
				text.onChange(async (value) => {
					this.plugin.settings.returnHubNote = value.trim() || 'Return Visits Hub';
					await this.plugin.saveSettings();
				});
			});
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
	}

	private paintAdvanced(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('New RV files').setHeading();
		new Setting(containerEl)
			.setName('Default folder for new RVs')
			.setDesc('Folder the New RV note is moved into after it is created. Leave empty to keep Templater’s folder. Slashes at the ends are ignored.')
			.addText((text) => {
				text.setPlaceholder('Return Visits');
				text.setValue(this.plugin.settings.newRvFolder);
				text.onChange(async (value) => {
					this.plugin.settings.newRvFolder = value;
					await this.plugin.saveSettings();
				});
			});
		new Setting(containerEl)
			.setName('Append Met date to new filenames')
			.setDesc('Off by default. When on, a new RV filename gains the Met date as YYYY-MM-DD, so two people on the same street do not collide.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.appendMetDateToFilename);
				toggle.onChange(async (value) => {
					this.plugin.settings.appendMetDateToFilename = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName('Property names').setHeading();
		this.propertySetting(
			'Address property',
			'Read for the lookup. Geocode never writes it.',
			'Address',
			() => this.plugin.settings.addressProperty,
			(value) => { this.plugin.settings.addressProperty = value; },
		);
		this.propertySetting(
			'Location property',
			'Two quoted strings: latitude, then longitude.',
			'Location',
			() => this.plugin.settings.locationProperty,
			(value) => { this.plugin.settings.locationProperty = value; },
		);
		new Setting(containerEl)
			.setName('Directions')
			.setDesc('Where a route opens: Google Maps, Apple Maps, or Waze. Notes keep their stored Map Link. The choice applies when you tap directions.')
			.addDropdown((dropdown) => {
				dropdown.addOption('google', 'Google Maps');
				dropdown.addOption('apple', 'Apple Maps');
				dropdown.addOption('waze', 'Waze');
				dropdown.setValue(this.plugin.settings.routeProvider);
				dropdown.onChange(async (value) => {
					this.plugin.settings.routeProvider = value === 'apple' || value === 'waze' ? value : 'google';
					await this.plugin.saveSettings();
				});
			});
		this.propertySetting(
			'Map link property',
			'Written on the first geocode. Leave empty to skip. Changing Directions does not rewrite this property.',
			'Map Link',
			() => this.plugin.settings.mapLinkProperty,
			(value) => { this.plugin.settings.mapLinkProperty = value; },
		);
		new Setting(containerEl)
			.setName('Optional place properties')
			.setDesc('Geocode always writes City. A filled name below is replaced from the new result. An empty name is skipped.');
		this.extraSetting(
			'City property',
			'City',
			() => this.plugin.settings.cityProperty,
			(value) => { this.plugin.settings.cityProperty = value; },
			'Extra name besides City. Geocode still writes City when this is empty.',
		);
		this.extraSetting('County property', 'County', () => this.plugin.settings.countyProperty, (value) => { this.plugin.settings.countyProperty = value; });
		this.extraSetting('State property', 'State', () => this.plugin.settings.stateProperty, (value) => { this.plugin.settings.stateProperty = value; });
		this.extraSetting('ZIP / postal property', 'ZIP', () => this.plugin.settings.postcodeProperty, (value) => { this.plugin.settings.postcodeProperty = value; });
		this.extraSetting('Country property', 'Country', () => this.plugin.settings.countryProperty, (value) => { this.plugin.settings.countryProperty = value; });

		new Setting(containerEl).setName('Attempt Log suggester').setHeading();
		renderDigestThresholds(containerEl, this.plugin);

		new Setting(containerEl).setName('Ideality (beta)').setHeading();
		renderIdealitySettings(containerEl, this.plugin);
		new Setting(containerEl)
			.setName('Ideality (beta) sort chip')
			.setDesc('Off until you turn it on.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.sortChips.ideality);
				toggle.onChange(async (value) => {
					this.plugin.settings.sortChips = { ...this.plugin.settings.sortChips, ideality: value };
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl).setName('Glancable Bases bar').setHeading();
		renderGlancableChrome(containerEl, this.plugin);

		new Setting(containerEl).setName('Distance testing').setHeading();
		new Setting(containerEl)
			.setName('Use test coordinates')
			.setDesc('Nearby and Glancable use these coordinates instead of this device. A toast says so, then goes away.')
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.distanceTest);
				toggle.onChange(async (value) => {
					this.plugin.settings.distanceTest = value;
					await this.plugin.saveSettings();
				});
			});
		this.coordSetting(
			'Test latitude',
			'Used only while test coordinates are on.',
			'28.54',
			90,
			() => this.plugin.settings.testLatitude,
			(value) => { this.plugin.settings.testLatitude = value; },
		);
		this.coordSetting(
			'Test longitude',
			'Used only while test coordinates are on.',
			'-81.38',
			180,
			() => this.plugin.settings.testLongitude,
			(value) => { this.plugin.settings.testLongitude = value; },
		);

		new Setting(containerEl).setName('About').setHeading();

		const about = containerEl.createDiv('rv-locator-about');
		about.createEl('p', { cls: 'rv-locator-disclaimer', text: NON_AFFILIATION_NOTICE });
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
			text: 'Lookups use Geoapify’s global endpoint (api.geoapify.com) unless Geoapify region is set to EU. Google Maps is only used to build a link. This plugin does not call Nominatim or the Google Geocoding API.',
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
		new Setting(this.mountEl)
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
		new Setting(this.mountEl)
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
		new Setting(this.mountEl)
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

class CatalogRenameModal extends Modal {
	private nextName: string;

	constructor(app: App, private current: string, private onRename: (next: string) => void) {
		super(app);
		this.nextName = current;
	}

	onOpen(): void {
		this.setTitle('Rename');
		this.modalEl.addClass('rv-locator-modal');
		new Setting(this.contentEl)
			.setName('Name')
			.addText((text) => {
				text.setValue(this.current);
				text.onChange((value) => { this.nextName = value; });
			});
		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText('Cancel');
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText('Rename');
				button.setCta();
				button.onClick(() => {
					const next = this.nextName.trim();
					this.close();
					if (next && next.toLowerCase() !== this.current.trim().toLowerCase()) this.onRename(next);
				});
			});
		iconizeModal(this.contentEl);
	}
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
		iconizeModal(this.contentEl);
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
