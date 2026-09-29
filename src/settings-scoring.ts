import { Setting } from 'obsidian';
import {
	DAYPARTS,
	DEFAULT_AVOID_MIN_TRIALS,
	DEFAULT_AVOID_SOFT_MAX,
	DEFAULT_TRY_MIN_HOMES,
	DEFAULT_TRY_SOFT_MIN,
	daypartSettingLabel,
	daypartTitle,
	weekdayShort,
	type AvailabilityLevel,
	type Daypart,
} from './schedule';
import {
	idealityFloorSvg,
	idealityMilesSvg,
	likelihoodSvg,
	urgencyLadderSvg,
	urgencyRampSvg,
} from './settings-graphs';
import {
	DEFAULT_IDEALITY_FLOOR_DAYS,
	DEFAULT_PRIORITY_NUDGE_EVERY,
	DEFAULT_TERRITORY_SPAN_MILES,
	DEFAULT_URGENCY_THRESHOLD_DAYS,
	GLANCABLE_LINE_IDS,
	SORT_CHIP_IDS,
	type GlancableLineId,
	type PriorityBand,
	type RVLocatorSettings,
	type SortChipId,
} from './types';

export interface ScoringHost {
	settings: RVLocatorSettings;
	saveSettings(): Promise<void>;
}

const PRIORITY_BANDS: readonly PriorityBand[] = [5, 4, 3, 2, 1];

const LINE_LABELS: Record<GlancableLineId, string> = {
	name: 'Title',
	street: 'Street',
	city: 'City',
	distance: 'Distance',
	'last-spoke': 'Last Spoke',
	'last-attempted': 'Last Attempted',
	met: 'Met',
	'met-with': 'Met With',
	visits: 'Taken and successful visits',
};

const CHIP_LABELS: Record<SortChipId, string> = {
	distance: 'Nearest / Furthest',
	priority: 'Priority',
	spoke: 'Spoke',
	attempted: 'Attempted',
	met: 'Met',
	urgency: 'Urgency',
	ideality: 'Ideality (beta)',
};

export function renderDensitySettings(containerEl: HTMLElement, plugin: ScoringHost): void {
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'General scale changes the card text and the urgency, priority, and map circles together. Two columns turn on when the measured card fits twice.',
	});
	sliderSetting(containerEl, 'General scale', 'Default 1. Text and the three circles grow together.', plugin.settings.glancableFontScale, 0.5, 2.5, 0.05, async (value) => {
		plugin.settings.glancableFontScale = value;
		await plugin.saveSettings();
	});
	sliderSetting(containerEl, 'Vertical padding', 'Space above and below the card text. Default 8.', plugin.settings.glancablePaddingY, 0, 32, 1, async (value) => {
		plugin.settings.glancablePaddingY = value;
		await plugin.saveSettings();
	});
	sliderSetting(containerEl, 'Horizontal padding', 'Space at the card edges. Default 10.', plugin.settings.glancablePaddingX, 0, 32, 1, async (value) => {
		plugin.settings.glancablePaddingX = value;
		await plugin.saveSettings();
	});
	sliderSetting(containerEl, 'Max line length', 'Characters. 0 uses the full card width.', plugin.settings.glancableMaxLineChars, 0, 80, 1, async (value) => {
		plugin.settings.glancableMaxLineChars = value;
		await plugin.saveSettings();
	});
	for (const id of GLANCABLE_LINE_IDS) {
		new Setting(containerEl)
			.setName(LINE_LABELS[id])
			.setDesc('Show this line on the card.')
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.glancableLines[id]);
				toggle.onChange(async (value) => {
					plugin.settings.glancableLines = { ...plugin.settings.glancableLines, [id]: value };
					await plugin.saveSettings();
				});
			});
	}
}

export function renderPriorityNudge(containerEl: HTMLElement, plugin: ScoringHost): void {
	sliderSetting(
		containerEl,
		'Priority check',
		`After every ${plugin.settings.priorityNudgeEvery} home visits, ask whether to lower, keep, or raise priority. Not home does not count. Default ${DEFAULT_PRIORITY_NUDGE_EVERY}.`,
		plugin.settings.priorityNudgeEvery,
		1,
		20,
		1,
		async (value) => {
			plugin.settings.priorityNudgeEvery = value;
			await plugin.saveSettings();
		},
	);
}

export function renderUrgencySettings(containerEl: HTMLElement, plugin: ScoringHost): void {
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Urgency is days since Last Spoke divided by the priority threshold. It keeps growing past 1. Under 3 days it rises slowly, so priority 5 stays well below 1 around 2 days.',
	});
	const ladder = containerEl.createDiv();
	const ramp = containerEl.createDiv();
	const paint = () => {
		mountSvg(ladder, urgencyLadderSvg(plugin.settings.urgencyThresholdDays));
		mountSvg(ramp, urgencyRampSvg(plugin.settings.urgencyThresholdDays));
	};
	for (const band of PRIORITY_BANDS) {
		sliderSetting(
			containerEl,
			`Priority ${band} reaches 1`,
			`Days. Default ${DEFAULT_URGENCY_THRESHOLD_DAYS[band]}.`,
			plugin.settings.urgencyThresholdDays[band],
			1,
			400,
			1,
			async (value) => {
				plugin.settings.urgencyThresholdDays = { ...plugin.settings.urgencyThresholdDays, [band]: value };
				await plugin.saveSettings();
				paint();
			},
		);
	}
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Days until urgency is 1, by priority.',
	});
	containerEl.appendChild(ladder);
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'The first 3 days. Priority 5 should still be far from 1 at about 2 days.',
	});
	containerEl.appendChild(ramp);
	paint();
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Tap the urgency circle on a card to hold urgency at 0 for today, 7 days, or 14 days. Priority 0 stays grey.',
	});
}

export function renderDigestThresholds(containerEl: HTMLElement, plugin: ScoringHost): void {
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'The Attempt Log suggester sorts May-go-out dayparts into Avoid, Try, Unsure, and Untried.',
	});
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'These defaults are a baseline you can adapt to your own return style, not a perfect method.',
	});
	sliderSetting(
		containerEl,
		'Try soft rate',
		`At or above this, with at least the Try homes below. Default ${DEFAULT_TRY_SOFT_MIN}.`,
		plugin.settings.digestTrySoftMin,
		0,
		1,
		0.01,
		async (value) => {
			plugin.settings.digestTrySoftMin = value;
			await plugin.saveSettings();
		},
	);
	sliderSetting(
		containerEl,
		'Try homes',
		`Homes required before Try. Default ${DEFAULT_TRY_MIN_HOMES}.`,
		plugin.settings.digestTryMinHomes,
		1,
		10,
		1,
		async (value) => {
			plugin.settings.digestTryMinHomes = value;
			await plugin.saveSettings();
		},
	);
	sliderSetting(
		containerEl,
		'Avoid soft rate',
		`At or below this, once Avoid trials is met. Default ${DEFAULT_AVOID_SOFT_MAX}.`,
		plugin.settings.digestAvoidSoftMax,
		0,
		1,
		0.01,
		async (value) => {
			plugin.settings.digestAvoidSoftMax = value;
			await plugin.saveSettings();
		},
	);
	sliderSetting(
		containerEl,
		'Avoid trials',
		`Trials required before Avoid. Default ${DEFAULT_AVOID_MIN_TRIALS}.`,
		plugin.settings.digestAvoidMinTrials,
		1,
		12,
		1,
		async (value) => {
			plugin.settings.digestAvoidMinTrials = value;
			await plugin.saveSettings();
		},
	);
}

export function renderGlancableChrome(containerEl: HTMLElement, plugin: ScoringHost): void {
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'These apply only while Glancable is the view on screen. Other Bases views keep the full bar.',
	});
	chromeToggle(containerEl, plugin, 'hideToolbar', 'Hide the Bases bar', 'Hides the whole top bar. Off by default.');
	chromeToggle(containerEl, plugin, 'hideViews', 'Hide view switcher', 'Hides the view name menu.');
	chromeToggle(containerEl, plugin, 'hideSort', 'Hide Bases sort', 'Hides the Bases sort menu. The chip row under it stays.');
	chromeToggle(containerEl, plugin, 'hideFilter', 'Hide filter', 'Hides the Bases filter menu.');
	chromeToggle(containerEl, plugin, 'hideProperties', 'Hide properties', 'Hides the properties menu when Bases shows one.');
	chromeToggle(containerEl, plugin, 'hideSearch', 'Hide search', 'Hides the Bases search field.');
	chromeToggle(containerEl, plugin, 'hideNew', 'Hide Bases New', 'On by default, so it does not compete with the plugin New button.');
	chromeToggle(containerEl, plugin, 'hideCode', 'Hide code', 'Hides the code button (`</>`).');
}

function chromeToggle(
	containerEl: HTMLElement,
	plugin: ScoringHost,
	key: keyof ScoringHost['settings']['glancableChrome'],
	name: string,
	desc: string,
): void {
	new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.glancableChrome[key]);
			toggle.onChange(async (value) => {
				plugin.settings.glancableChrome = { ...plugin.settings.glancableChrome, [key]: value };
				await plugin.saveSettings();
			});
		});
}

export function renderIdealitySettings(containerEl: HTMLElement, plugin: ScoringHost): void {
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Ideality (beta) is urgency times a distance weight. The weight is 1 at the territory span.',
	});
	const miles = containerEl.createDiv();
	const floors = containerEl.createDiv();
	const likelihood = containerEl.createDiv();
	const paint = () => {
		mountSvg(miles, idealityMilesSvg(plugin.settings.territorySpanMiles));
		mountSvg(floors, idealityFloorSvg(plugin.settings));
		mountSvg(likelihood, plugin.settings.homeLikelihoodEnabled ? likelihoodSvg() : '');
	};
	sliderSetting(
		containerEl,
		'Territory span',
		`Miles. Default ${DEFAULT_TERRITORY_SPAN_MILES}.`,
		plugin.settings.territorySpanMiles,
		1,
		80,
		1,
		async (value) => {
			plugin.settings.territorySpanMiles = value;
			await plugin.saveSettings();
			paint();
		},
	);
	containerEl.appendChild(miles);
	for (const band of PRIORITY_BANDS) {
		sliderSetting(
			containerEl,
			`Priority ${band} floor`,
			`Days. Default ${DEFAULT_IDEALITY_FLOOR_DAYS[band]}. Inside this window ideality fades.`,
			plugin.settings.idealityFloorDays[band],
			1,
			180,
			1,
			async (value) => {
				plugin.settings.idealityFloorDays = { ...plugin.settings.idealityFloorDays, [band]: value };
				await plugin.saveSettings();
				paint();
			},
		);
	}
	containerEl.appendChild(floors);
	new Setting(containerEl)
		.setName('Home likelihood')
		.setDesc('For the current weekday and daypart only, a 50% prior nudges ideality. A thin log barely moves it.')
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.homeLikelihoodEnabled);
			toggle.onChange(async (value) => {
				plugin.settings.homeLikelihoodEnabled = value;
				await plugin.saveSettings();
				paint();
			});
		});
	containerEl.appendChild(likelihood);
	paint();
}

export function renderSortChips(containerEl: HTMLElement, plugin: ScoringHost, ids: readonly SortChipId[] = SORT_CHIP_IDS): void {
	for (const id of ids) {
		new Setting(containerEl)
			.setName(CHIP_LABELS[id])
			.setDesc('Show this chip on Nearby and Glancable.')
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.sortChips[id]);
				toggle.onChange(async (value) => {
					plugin.settings.sortChips = { ...plugin.settings.sortChips, [id]: value };
					await plugin.saveSettings();
				});
			});
	}
}

export function paintMayGoOutGrid(
	containerEl: HTMLElement,
	read: () => RVLocatorSettings['availabilityGrid'],
	write: (key: string, level: AvailabilityLevel) => void,
): void {
	const grid = containerEl.createDiv('rv-locator-availability');
	grid.createDiv({ text: '' });
	for (const daypart of DAYPARTS) {
		grid.createDiv({
			cls: 'rv-locator-availability-head',
			text: daypartTitle(daypart),
			attr: { title: daypartSettingLabel(daypart) },
		});
	}
	for (let weekday = 0; weekday < 7; weekday += 1) {
		grid.createDiv({ cls: 'rv-locator-availability-day', text: weekdayShort(weekday) });
		for (const daypart of DAYPARTS) paintCell(grid, weekday, daypart, read, write);
	}
}

export function explainMayGoOut(containerEl: HTMLElement): void {
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Morning is before 12pm, afternoon is 12pm to 4:29pm, and evening is after 4:30pm. Grey is off. Green is may go out. Click a cell to switch. The Attempt Log table counts homes and trials for these dayparts only.',
	});
}

function paintCell(
	grid: HTMLElement,
	weekday: number,
	daypart: Daypart,
	read: () => RVLocatorSettings['availabilityGrid'],
	write: (key: string, level: AvailabilityLevel) => void,
): void {
	const key = `${weekday}:${daypart}`;
	const button = grid.createEl('button', { attr: { type: 'button' } });
	const paint = () => {
		const level: AvailabilityLevel = read()[key] === 'may' ? 'may' : 'off';
		button.className = `rv-may-cell is-${level}`;
		button.textContent = level === 'may' ? 'May go out' : 'Off';
		button.setAttribute('aria-pressed', level === 'may' ? 'true' : 'false');
		button.setAttribute('aria-label', `${weekdayShort(weekday)} ${daypartSettingLabel(daypart)}`);
	};
	paint();
	button.addEventListener('click', () => {
		const next: AvailabilityLevel = read()[key] === 'may' ? 'off' : 'may';
		write(key, next);
		paint();
	});
}

export function mountSvg(host: HTMLElement, svg: string): void {
	host.empty();
	host.addClass('rv-locator-graph');
	if (!svg) {
		host.hide();
		return;
	}
	host.show();
	const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
	const node = doc.documentElement;
	if (node.localName !== 'svg') return;
	host.appendChild(node);
}

function sliderSetting(
	containerEl: HTMLElement,
	name: string,
	desc: string,
	current: number,
	min: number,
	max: number,
	step: number,
	write: (value: number) => Promise<void>,
): void {
	new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addSlider((slider) => {
			slider.setLimits(min, max, step);
			slider.setValue(current);
			slider.setDynamicTooltip();
			slider.onChange((value) => { void write(value); });
		});
}
