/**
 * Bases toolbar pieces. Class names follow the Bases toolbar
 * (views, sort, filter, properties, new item). Search and the code
 * button are also matched from aria-label, placeholder, and icon class
 * because those controls do not share one stable menu class.
 */
export type ChromePiece = 'views' | 'sort' | 'filter' | 'properties' | 'search' | 'new' | 'code';

export const CHROME_PIECES: readonly ChromePiece[] = [
	'views',
	'sort',
	'filter',
	'properties',
	'search',
	'new',
	'code',
];

export interface ChromeControlHint {
	className: string;
	label: string;
	icon: string;
}

export function classifyChromeControl(hint: ChromeControlHint): ChromePiece | null {
	const cls = hint.className.toLowerCase();
	const label = hint.label.trim().toLowerCase();
	const icon = hint.icon.toLowerCase();
	if (cls.includes('views-menu')) return 'views';
	if (cls.includes('sort-menu')) return 'sort';
	if (cls.includes('filter-menu')) return 'filter';
	if (cls.includes('properties-menu')) return 'properties';
	if (cls.includes('new-item') || cls.includes('new-menu')) return 'new';
	if (cls.includes('search')) return 'search';
	if (cls.includes('edit-block-button') || /(^|[^a-z])code([^a-z]|$)/.test(cls)) return 'code';
	if (icon.includes('code') || icon.includes('braces') || label.includes('</>')) return 'code';
	if (label === 'sort' || label.startsWith('sort ')) return 'sort';
	if (label === 'filter' || label.startsWith('filter ')) return 'filter';
	if (label === 'properties' || label.startsWith('properties ')) return 'properties';
	if (label === 'search' || label.startsWith('search ')) return 'search';
	if (label === 'new' || label === 'new file' || label.startsWith('new ')) return 'new';
	if (label === 'code' || label.includes('source mode') || label.includes('edit code')) return 'code';
	return null;
}

export function chromeControlHint(el: HTMLElement): ChromeControlHint {
	const input = el.querySelector('input');
	const placeholder = input?.getAttribute('placeholder') ?? '';
	const icon = Array.from(el.querySelectorAll('svg'))
		.map((svg) => svg.getAttribute('class') ?? '')
		.join(' ');
	const label = [
		el.getAttribute('aria-label') ?? '',
		el.getAttribute('title') ?? '',
		placeholder,
	].join(' ');
	return { className: el.className, label, icon };
}
