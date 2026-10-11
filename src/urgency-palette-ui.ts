import { Setting, type ColorComponent } from 'obsidian';
import {
	URGENCY_LEVEL_LABELS,
	URGENCY_PALETTES,
	editableUrgencyColors,
	sanitizeUrgencyPalette,
	urgencyColorsFor,
	type UrgencyColors,
	type UrgencyPaletteId,
} from './urgency-palette';

export interface UrgencyPaletteChoice {
	palette: UrgencyPaletteId;
	custom: UrgencyColors;
}

function paintSwatches(strip: HTMLElement, colors: readonly string[]): void {
	strip.empty();
	colors.forEach((color, index) => {
		const swatch = strip.createSpan({
			cls: 'rv-urgency-swatch',
			attr: { 'aria-label': `Urgency ${URGENCY_LEVEL_LABELS[index] ?? ''}` },
		});
		swatch.setCssProps({ '--rv-swatch': color });
	});
}

/**
 * Palette dropdown with a live preview strip, then one color picker per
 * urgency level. Editing a level switches the palette to Custom.
 * Settings and the setup wizard both use this.
 */
export function renderUrgencyPalette(
	containerEl: HTMLElement,
	get: () => UrgencyPaletteChoice,
	set: (choice: UrgencyPaletteChoice) => void | Promise<void>,
): void {
	const host = containerEl.createDiv('rv-urgency-palette');
	let strip: HTMLElement | null = null;
	const pickers: ColorComponent[] = [];
	/** ColorComponent.setValue fires onChange. A repaint is not an edit. */
	let painting = false;

	const refresh = (repaintPickers: boolean) => {
		const { palette, custom } = get();
		if (strip) paintSwatches(strip, urgencyColorsFor(palette, custom));
		if (!repaintPickers) return;
		const editable = editableUrgencyColors(palette, custom);
		painting = true;
		pickers.forEach((picker, index) => {
			picker.setValue(editable[index] ?? '#000000');
		});
		painting = false;
	};

	const paletteSetting = new Setting(host)
		.setName('Urgency colors')
		.setDesc('Colors the card edge, urgency marks, and chips in Nearby, from low urgency on the left to high on the right.');
	strip = paletteSetting.controlEl.createDiv('rv-urgency-preview');
	const picker = paletteSetting.controlEl.createEl('button', {
		cls: 'rv-palette-picker',
		attr: { type: 'button', 'aria-label': 'Urgency palette' },
	});
	const paintPicker = (): void => {
		const { palette, custom } = get();
		const known = URGENCY_PALETTES.find((item) => item.id === palette);
		picker.empty();
		picker.createSpan({ cls: 'rv-palette-label', text: known?.label ?? 'Custom' });
		paintSwatches(picker.createSpan('rv-urgency-preview'), urgencyColorsFor(palette, custom));
	};
	picker.addEventListener('click', () => {
		host.querySelector('.rv-palette-menu')?.remove();
		const menu = host.createDiv('rv-palette-menu');
		const { custom } = get();
		const options: Array<{ id: UrgencyPaletteId; label: string; colors: readonly string[] }> = [
			...URGENCY_PALETTES.map((item) => ({ id: item.id, label: item.label, colors: item.colors })),
			{ id: 'custom', label: 'Custom', colors: custom },
		];
		for (const option of options) {
			const row = menu.createEl('button', { cls: 'rv-palette-option', attr: { type: 'button' } });
			row.createSpan({ text: option.label });
			paintSwatches(row.createSpan('rv-urgency-preview'), option.colors);
			row.addEventListener('click', () => {
				menu.remove();
				void (async () => {
					await set({ palette: sanitizeUrgencyPalette(option.id), custom });
					refresh(true);
					paintPicker();
				})();
			});
		}
	});
	paintPicker();

	URGENCY_LEVEL_LABELS.forEach((label, index) => {
		new Setting(host)
			.setName(`Urgency ${label.toLowerCase()}`)
			.setClass('rv-urgency-level')
			.addColorPicker((picker) => {
				pickers.push(picker);
				picker.onChange(async (value) => {
					if (painting) return;
					const current = get();
					const custom = editableUrgencyColors(current.palette, current.custom);
					custom[index] = value.toLowerCase();
					await set({ palette: 'custom', custom });
					refresh(false);
				});
			});
	});

	refresh(true);
}
