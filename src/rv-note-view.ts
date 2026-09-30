import { stampAgeFromHeadingText } from './dates';

const RV_DASHBOARD_CLASS = 'rv-dashboard';
const STAMP_AGE_SELECTOR = '.rv-stamp-ago';
const STAMP_HOST_SELECTOR = 'h1, h2, h3, h4, h5, h6, .cm-line';

/** An RV note lists `rv-dashboard` under `cssclasses` (or the older `cssclass`). */
export function isRvDashboardNote(frontmatter: Record<string, unknown> | null | undefined): boolean {
	if (!frontmatter) return false;
	for (const key of Object.keys(frontmatter)) {
		const name = key.toLowerCase();
		if (name !== 'cssclasses' && name !== 'cssclass') continue;
		if (cssClassList(frontmatter[key]).includes(RV_DASHBOARD_CLASS)) return true;
	}
	return false;
}

function cssClassList(value: unknown): string[] {
	if (typeof value === 'string') return value.split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
	if (Array.isArray(value)) return value.flatMap((item) => cssClassList(item));
	return [];
}

/**
 * Recompute every rendered `x days ago` label under `root` from the stamp
 * text beside it. Only the display changes; the note file is not written.
 * Returns how many labels changed.
 */
export function refreshStampAgeLabels(root: ParentNode, today: Date = new Date()): number {
	let changed = 0;
	root.querySelectorAll(STAMP_AGE_SELECTOR).forEach((label) => {
		const host = label.closest(STAMP_HOST_SELECTOR) ?? label.parentElement;
		if (!host) return;
		const next = stampAgeFromHeadingText(host.textContent ?? '', today);
		if (next == null || label.textContent === next) return;
		label.textContent = next;
		changed += 1;
	});
	return changed;
}
