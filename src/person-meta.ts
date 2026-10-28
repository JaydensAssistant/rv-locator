import { addIcon, setIcon } from 'obsidian';
import { sanitizeNoteName, stripFilenameStamp } from './note-name';

/** Restroom figures. Approved 24-viewBox glyphs; Obsidian icons are a 100 box. */
export const RESTROOM_MAN = 'rv-restroom-man';
export const RESTROOM_WOMAN = 'rv-restroom-woman';

const MAN_PATHS = '<circle cx="12" cy="5" r="3"/><path d="M8 10.5h8"/><path d="M12 8.5v6.5"/><path d="m12 15-3.5 7"/><path d="m12 15 3.5 7"/>';
const WOMAN_PATHS = '<circle cx="12" cy="5" r="3"/><path d="M9.5 8.5h5"/><path d="M9.5 8.5 5.5 17h13L14.5 8.5"/><path d="M10 17v5"/><path d="M14 17v5"/>';

/**
 * Stroke 2.75 in the 24 box is about 1.8px when the icon is drawn at 16px.
 * Sizes and colors stay with each callsite.
 */
function iconBody(paths: string): string {
	return `<svg viewBox="0 0 24 24" width="100" height="100" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export function registerRestroomIcons(): void {
	addIcon(RESTROOM_MAN, iconBody(MAN_PATHS));
	addIcon(RESTROOM_WOMAN, iconBody(WOMAN_PATHS));
}

export function genderIcon(gender: string | null | undefined): string | null {
	if (gender === 'Man') return RESTROOM_MAN;
	if (gender === 'Woman') return RESTROOM_WOMAN;
	return null;
}

export function isExactAge(exact: unknown): boolean {
	return exact === true || exact === 'true' || exact === 'Exact' || exact === 'exact';
}

/** `~35 y/o` when the age is estimated. `42 y/o` when it is exact. Blank when unset. */
export function ageCaption(age: unknown, exact: unknown): string {
	const years = ageYears(age);
	if (years == null) return '';
	const shown = isExactAge(exact) ? String(years) : `~${years}`;
	return `${shown} y/o`;
}

export function ageYears(age: unknown): number | null {
	const parsed = typeof age === 'number' ? age : typeof age === 'string' && age.trim() ? Number(age) : Number.NaN;
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return Math.round(parsed);
}

/**
 * The filename keeps the street and the stamp. Only the person's name changes.
 * `Joshua on Maple St` plus `Josh` becomes `Josh on Maple St`.
 */
export function replacePersonName(basename: string, person: string): string {
	const stripped = stripFilenameStamp(basename);
	const stamp = basename.slice(stripped.length);
	const who = sanitizeNoteName(person);
	if (!who) return basename;
	const on = stripped.toLowerCase().indexOf(' on ');
	if (on > 0) return `${who}${stripped.slice(on)}${stamp}`;
	return `${who}${stamp}`;
}

/** Muted age, then the muted restroom figure. Both sit after the name. */
export function appendPersonMeta(parent: HTMLElement, ageText: string, gender: string | null | undefined): void {
	if (ageText) parent.createSpan({ cls: 'rv-title-age', text: ageText });
	const icon = genderIcon(gender);
	if (!icon) return;
	const mark = parent.createSpan({
		cls: 'rv-title-gender',
		attr: { 'aria-label': gender ?? '' },
	});
	setIcon(mark, icon);
}
