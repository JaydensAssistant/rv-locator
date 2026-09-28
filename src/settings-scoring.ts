import { Setting } from 'obsidian';
import { DAYPARTS, daypartLabel, weekdayShort, type AvailabilityLevel, type Daypart } from './schedule';
import { settingsGraphs } from './settings-graphs';
import {
	DEFAULT_IDEALITY_FLOOR_DAYS,
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
	ideality: 'Ideality',
};

const DAYPART_SHORT: Record<Daypart, string> = {
	'early-morning': 'Early',
	'late-morning': 'Late',
	afternoon: 'Aft',
	evening: 'Eve',
};

export function renderScoringSettings(containerEl: HTMLElement, plugin: ScoringHost): void {
	new Setting(containerEl).setName('Urgency and ideality').setHeading();
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Urgency is days since Last Spoke divided by the priority threshold, and it keeps growing past 1. Under 3 days it fades toward 0 for every priority. Ideality multiplies that by a distance weight. Territory span is not in the setup wizard.',
	});

	for (const band of PRIORITY_BANDS) {
		numberSetting(
			containerEl,
			`Priority ${band} urgency (days)`,
			`Default ${DEFAULT_URGENCY_THRESHOLD_DAYS[band]}.`,
			plugin.settings.urgencyThresholdDays[band],
			(value) => positive(value, 3650),
			async (value) => {
				plugin.settings.urgencyThresholdDays = { ...plugin.settings.urgencyThresholdDays, [band]: value };
				await plugin.saveSettings();
				redraw();
			},
		);
	}

	numberSetting(
		containerEl,
		'Territory span (miles)',
		`Default ${DEFAULT_TERRITORY_SPAN_MILES}. Ideality’s distance weight is 1 at this many miles. Power-user setting, left out of the setup wizard.`,
		plugin.settings.territorySpanMiles,
		(value) => positive(value, 500),
		async (value) => {
			plugin.settings.territorySpanMiles = value;
			await plugin.saveSettings();
			redraw();
		},
	);

	for (const band of PRIORITY_BANDS) {
		numberSetting(
			containerEl,
			`Priority ${band} ideality floor (days)`,
			`Default ${DEFAULT_IDEALITY_FLOOR_DAYS[band]}. Inside this window ideality fades instead of cutting off.`,
			plugin.settings.idealityFloorDays[band],
			(value) => positive(value, 3650),
			async (value) => {
				plugin.settings.idealityFloorDays = { ...plugin.settings.idealityFloorDays, [band]: value };
				await plugin.saveSettings();
				redraw();
			},
		);
	}

	new Setting(containerEl)
		.setName('Ideality sort chip')
		.setDesc('Off by default. Shows the Ideality chip with the other sort chips.')
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.sortChips.ideality);
			toggle.onChange(async (value) => {
				plugin.settings.sortChips = { ...plugin.settings.sortChips, ideality: value };
				await plugin.saveSettings();
			});
		});

	new Setting(containerEl)
		.setName('Home likelihood')
		.setDesc('Off by default. For the current weekday and daypart only, a 50% prior nudges ideality. A thin log barely moves it. Different weekdays are never merged.')
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.homeLikelihoodEnabled);
			toggle.onChange(async (value) => {
				plugin.settings.homeLikelihoodEnabled = value;
				await plugin.saveSettings();
				redraw();
			});
		});

	new Setting(containerEl)
		.setName('Ideality planner')
		.setDesc('Needs home likelihood. Holds distance at the territory span and lists each RV across upcoming Willing and Go out times.')
		.addToggle((toggle) => {
			toggle.setValue(plugin.settings.idealityPlannerEnabled);
			toggle.onChange(async (value) => {
				plugin.settings.idealityPlannerEnabled = value;
				await plugin.saveSettings();
			});
		});

	new Setting(containerEl).setName('Live graphs').setHeading();
	const graphs = containerEl.createDiv('rv-locator-graphs');
	const redraw = () => paintGraphs(graphs, plugin.settings);

	new Setting(containerEl).setName('When you can go').setHeading();
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Each weekday and daypart is Off, Willing, or Go out. The return suggester skips Off. Defaults: go out 1.0, willing 0.65.',
	});
	numberSetting(
		containerEl,
		'Go out multiplier',
		'Default 1.',
		plugin.settings.availabilityMultipliers.goOut,
		(value) => nonNegative(value, 10),
		async (value) => {
			plugin.settings.availabilityMultipliers = { ...plugin.settings.availabilityMultipliers, goOut: value };
			await plugin.saveSettings();
		},
	);
	numberSetting(
		containerEl,
		'Willing multiplier',
		'Default 0.65.',
		plugin.settings.availabilityMultipliers.willing,
		(value) => nonNegative(value, 10),
		async (value) => {
			plugin.settings.availabilityMultipliers = { ...plugin.settings.availabilityMultipliers, willing: value };
			await plugin.saveSettings();
		},
	);
	paintAvailability(containerEl, plugin);

	new Setting(containerEl).setName('Glancable density').setHeading();
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Defaults match the current card. Two columns turn on when the measured card fits twice. A short line is allowed to feel cramped.',
	});
	numberSetting(
		containerEl,
		'Vertical padding',
		'Default 8.',
		plugin.settings.glancablePaddingY,
		(value) => nonNegative(value, 64),
		async (value) => {
			plugin.settings.glancablePaddingY = value;
			await plugin.saveSettings();
		},
	);
	numberSetting(
		containerEl,
		'Horizontal padding',
		'Default 10.',
		plugin.settings.glancablePaddingX,
		(value) => nonNegative(value, 64),
		async (value) => {
			plugin.settings.glancablePaddingX = value;
			await plugin.saveSettings();
		},
	);
	numberSetting(
		containerEl,
		'Max line length',
		'Characters. 0 uses the full card width.',
		plugin.settings.glancableMaxLineChars,
		(value) => lineChars(value),
		async (value) => {
			plugin.settings.glancableMaxLineChars = value;
			await plugin.saveSettings();
		},
	);
	numberSetting(
		containerEl,
		'Font size multiplier',
		'Default 1. Title, street, and the date lines keep their relative sizes.',
		plugin.settings.glancableFontScale,
		(value) => fontScale(value),
		async (value) => {
			plugin.settings.glancableFontScale = value;
			await plugin.saveSettings();
		},
	);
	for (const id of GLANCABLE_LINE_IDS) {
		new Setting(containerEl)
			.setName(LINE_LABELS[id])
			.setDesc('Show this Glancable line.')
			.addToggle((toggle) => {
				toggle.setValue(plugin.settings.glancableLines[id]);
				toggle.onChange(async (value) => {
					plugin.settings.glancableLines = { ...plugin.settings.glancableLines, [id]: value };
					await plugin.saveSettings();
				});
			});
	}

	new Setting(containerEl).setName('Sort chips').setHeading();
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: 'Hide a chip without changing the last sort. Urgency starts on. Ideality stays off until Ideality sort chip is turned on.',
	});
	for (const id of SORT_CHIP_IDS) {
		if (id === 'ideality') continue;
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

	redraw();
}

function paintGraphs(host: HTMLElement, settings: RVLocatorSettings): void {
	host.empty();
	const graphs = settingsGraphs(settings);
	for (const svg of [graphs.ladder, graphs.ramp, graphs.ideality, graphs.floors, graphs.likelihood]) {
		if (!svg) continue;
		const frame = host.createDiv('rv-locator-graph');
		const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
		const node = doc.documentElement;
		if (node.localName !== 'svg') continue;
		frame.appendChild(node);
	}
}

function paintAvailability(containerEl: HTMLElement, plugin: ScoringHost): void {
	const grid = containerEl.createDiv('rv-locator-availability');
	grid.createDiv({ text: '' });
	for (const daypart of DAYPARTS) {
		grid.createDiv({
			cls: 'rv-locator-availability-head',
			text: DAYPART_SHORT[daypart],
			attr: { title: daypartLabel(daypart) },
		});
	}
	for (let weekday = 0; weekday < 7; weekday += 1) {
		grid.createDiv({ cls: 'rv-locator-availability-day', text: weekdayShort(weekday) });
		for (const daypart of DAYPARTS) {
			const key = `${weekday}:${daypart}`;
			const select = grid.createEl('select', {
				attr: { 'aria-label': `${weekdayShort(weekday)} ${daypartLabel(daypart)}` },
			});
			for (const level of ['off', 'willing', 'go-out'] as const) {
				select.createEl('option', { text: levelLabel(level), attr: { value: level } });
			}
			select.value = plugin.settings.availabilityGrid[key] ?? 'willing';
			select.addEventListener('change', () => {
				const next = select.value;
				if (next !== 'off' && next !== 'willing' && next !== 'go-out') return;
				plugin.settings.availabilityGrid = { ...plugin.settings.availabilityGrid, [key]: next };
				void plugin.saveSettings();
			});
		}
	}
}

function levelLabel(level: AvailabilityLevel): string {
	if (level === 'go-out') return 'Go out';
	if (level === 'willing') return 'Willing';
	return 'Off';
}

function numberSetting(
	containerEl: HTMLElement,
	name: string,
	desc: string,
	current: number,
	parse: (value: string) => number | null,
	write: (value: number) => Promise<void>,
): void {
	new Setting(containerEl)
		.setName(name)
		.setDesc(desc)
		.addText((text) => {
			text.setValue(String(current));
			text.onChange((value) => {
				const next = parse(value);
				if (next == null) return;
				void write(next);
			});
		});
}

function positive(value: string, max: number): number | null {
	if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
	const next = Number(value.trim());
	if (!Number.isFinite(next) || next <= 0 || next > max) return null;
	return next;
}

function nonNegative(value: string, max: number): number | null {
	if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
	const next = Number(value.trim());
	if (!Number.isFinite(next) || next < 0 || next > max) return null;
	return next;
}

function lineChars(value: string): number | null {
	if (!/^\d+$/.test(value.trim())) return null;
	const next = Number(value.trim());
	if (!Number.isInteger(next) || next < 0 || next > 200) return null;
	return next;
}

function fontScale(value: string): number | null {
	if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
	const next = Number(value.trim());
	if (!Number.isFinite(next) || next < 0.5 || next > 2.5) return null;
	return next;
}
