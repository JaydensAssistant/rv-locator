import { setIcon } from 'obsidian';

export interface GlanceFootOptions {
	showPerson: boolean;
	metWith: string;
	/** Visits counter without a hash, such as `3/3`. */
	ratio: string;
	ratioTitle: string;
	daypart: string;
	bucket: string;
	showReturn: boolean;
	snoozed: boolean;
	snoozeLabel: string;
	snoozeDays: string;
	onOpen?: () => void;
}

/**
 * One foot line: person, list-checks counter, then either the return
 * (repeat, daypart, bucket) or the snooze (grey moon, tiny label, accent days).
 */
export function paintGlanceFoot(foot: HTMLElement, options: GlanceFootOptions): void {
	foot.addClass('rv-foot-line');
	if (options.showPerson) {
		const who = foot.createSpan('rv-locator-slot rv-foot-bit');
		const whoIcon = who.createSpan('rv-locator-slot-icon');
		setIcon(whoIcon, 'user');
		who.createSpan({ cls: 'rv-locator-slot-text', text: options.metWith || '—' });
		if (!options.metWith) who.addClass('is-empty');
	}

	if (options.ratio) {
		const count = foot.createSpan({
			cls: 'rv-locator-slot rv-foot-bit',
			attr: { 'aria-label': options.ratioTitle || options.ratio },
		});
		const icon = count.createSpan('rv-locator-slot-icon');
		setIcon(icon, 'list-checks');
		count.createSpan({ cls: 'rv-locator-slot-text rv-locator-return-visits', text: options.ratio });
	}

	if (options.snoozed) {
		const seg = foot.createSpan('rv-locator-slot rv-foot-bit rv-foot-snooze');
		const moon = seg.createSpan('rv-locator-slot-icon rv-foot-moon');
		setIcon(moon, 'moon');
		if (options.snoozeLabel) seg.createSpan({ cls: 'rv-locator-return-when', text: options.snoozeLabel });
		if (options.snoozeDays) seg.createSpan({ cls: 'rv-locator-return-bucket rv-foot-days', text: options.snoozeDays });
		return;
	}

	if (!options.showReturn) return;
	const seg = foot.createSpan('rv-locator-slot rv-foot-bit rv-locator-return-inline');
	const icon = seg.createSpan('rv-locator-slot-icon');
	setIcon(icon, 'repeat');
	if (options.daypart) seg.createSpan({ cls: 'rv-locator-return-when', text: options.daypart });
	if (options.bucket) seg.createSpan({ cls: 'rv-locator-return-bucket', text: options.bucket });
	if (!options.onOpen) return;
	seg.addClass('is-action');
	seg.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		options.onOpen?.();
	});
}
