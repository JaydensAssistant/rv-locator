import { Setting, type ColorComponent, type DropdownComponent } from 'obsidian';
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
	let dropdownRef: DropdownComponent | null = null;
	let strip: HTMLElement | null = null;
	const pickers: ColorComponent[] = [];
	/** ColorComponent.setValue fires onChange. A repaint is not an edit. */
	let painting = false;

	const refresh = (repaintPickers: boolean) => {
		const { palette, custom } = get();
		dropdownRef?.setValue(palette);
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
	paletteSetting.addDropdown((dropdown) => {
		dropdownRef = dropdown;
		for (const palette of URGENCY_PALETTES) dropdown.addOption(palette.id, palette.label);
		dropdown.addOption('custom', 'Custom');
		dropdown.onChange(async (value) => {
			const { custom } = get();
			await set({ palette: sanitizeUrgencyPalette(value), custom });
			refresh(true);
		});
	});

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
