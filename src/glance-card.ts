import { TFile, setIcon, type App } from 'obsidian';
import { displayCity, parseDisplayAddress } from './address-display';
import { formatStudyFraction } from './catalog';
import { calendarDaysSince, formatDriveDate, formatGlanceableCounter } from './dates';
import { formatDistance, haversineMeters, latLonFromUnknown } from './distance';
import { readProperty } from './frontmatter';
import { cardReturnLead } from './schedule';
import { appendBadge, type BadgeIconName } from './glancable-view';
import { compactBadgePx, fittedFontScale, type CompactLineKind } from './glancable-density';
import { cardPersonTitle } from './note-name';
import { displayedUrgency } from './row-score';
import { urgencyAccentColor, urgencyBand, urgencyMark } from './scoring';
import { paintUrgencyInk } from './color-math';
import { resolveStatus, statusIcon } from './status';
import { SNOOZE_SLATE } from './snooze';
import { urgencyColorsFor } from './urgency-palette';
import type { GlancableLineId, RVLocatorSettings } from './types';

/** What the map needs in order to paint a list card with no Bases view mounted. */
export interface NoteGlanceHost {
	app: App;
	settings: RVLocatorSettings;
	snoozeUntilFor(path: string): Date | null;
	snoozeActiveFor(path: string): boolean;
	ghostIconForCard(path: string): 'hourglass' | 'moon' | 'ban' | null;
	campaignMark(path: string): 'covered' | 'open' | null;
	openMapNote(path: string): void;
	openRoute(path: string): Promise<void>;
	promptUrgencyMenu(path: string, name: string, event: MouseEvent): void;
	promptPriority(path: string, name: string): void;
	/** Device GPS, or the desktop test point. Null when neither is known. */
	distanceFix(): { lat: number; lon: number } | null;
	cardReturnBucket(path: string): 'Try' | 'Avoid' | 'Unsure' | 'Untried';
	cardOverrideLabel(path: string): string | null;
	openAttemptLog(path: string): void;
}

/**
 * The same Glancable card the list paints, built from the note.
 * Used when no base view is mounted (the note map).
 */
export function paintNoteGlanceCard(parent: HTMLElement, path: string, host: NoteGlanceHost): boolean {
	const file = host.app.vault.getFileByPath(path);
	if (!(file instanceof TFile)) return false;
	const note = host.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
	const settings = host.settings;
	const viewW = parent.ownerDocument.defaultView?.innerWidth ?? 0;
	const fitted = fittedFontScale(viewW, settings, settings.glancableFitCount);
	parent.style.setProperty('--rv-font-scale', String(fitted));
	parent.style.setProperty('--rv-icon-scale', String(settings.glancableIconScale));
	parent.style.setProperty('--rv-control-size', `${Math.round(28 * fitted)}px`);
	parent.style.setProperty('--rv-pad-y', `${settings.glancablePaddingY}px`);
	parent.style.setProperty('--rv-pad-x', `${settings.glancablePaddingX}px`);
	const priority = finite(readProperty(note, 'Priority'));
	const status = resolveStatus(readProperty(note, 'Status'), priority);
	const study = status === 'Study';
	const spokeRaw = dateRaw(readProperty(note, 'Last Spoke'));
	const spokeDays = spokeRaw ? calendarDaysSince(spokeRaw) : null;
	const snoozed = host.snoozeActiveFor(path);
	const urgency = displayedUrgency(spokeDays, priority, settings, host.snoozeUntilFor(path), new Date());
	const colors = urgencyColorsFor(settings.urgencyPalette, settings.urgencyCustomColors);
	const accent = snoozed ? SNOOZE_SLATE : urgencyAccentColor(urgency, priority, colors);
	const card = parent.createDiv('rv-locator-card');
	card.setAttr('data-rv-path', path);
	card.style.setProperty('--rv-urgency-accent', accent);
	paintUrgencyInk(card, accent);
	const band = priority != null && priority > 0 ? urgencyBand(urgency) : 0;
	card.setAttr('data-urgency-band', String(band));
	if (priority === 0) card.addClass('is-priority-zero');
	if (snoozed) card.addClass('is-snoozed');
	const linesOn = settings.glancableLines;
	const show = (id: GlancableLineId): boolean => linesOn[id] !== false;
	if (show('name')) {
		const name = card.createDiv('rv-locator-card-name');
		const statusIconEl = name.createSpan('rv-locator-status-icon');
		setIcon(statusIconEl, statusIcon(status));
		statusIconEl.setAttr('aria-label', status);
		const mark = host.campaignMark(path);
		if (mark) {
			const icon = name.createSpan({
				cls: 'rv-locator-campaign-mark',
				attr: { 'aria-label': mark === 'covered' ? 'Covered this campaign' : 'Not covered this campaign' },
			});
			setIcon(icon, mark === 'covered' ? 'book-check' : 'book-alert');
		}
		const title = cardPersonTitle(file.basename, settings.cardTitleNameOnly);
		const link = name.createEl('a', {
			cls: 'rv-locator-file-link',
			text: title,
			href: path,
			attr: { 'aria-label': file.basename },
		});
		link.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openMapNote(path);
		});
	}
	const address = textOf(readProperty(note, settings.addressProperty.trim() || 'Address'));
	const cityName = settings.cityProperty.trim() || 'City';
	const city = displayCity(textOf(readProperty(note, cityName)), address) ?? '';
	const street = parseDisplayAddress(address)?.street || address;
	const showStreet = show('street') && Boolean(street);
	const showCity = show('city') && Boolean(city);
	const showDistance = show('distance');
	if (showStreet || showCity || showDistance) {
		const place = card.createDiv('rv-locator-place');
		const earth = place.createSpan('rv-locator-place-earth');
		setIcon(earth, 'earth');
		if (showStreet && street) place.createSpan({ cls: 'rv-locator-card-street', text: street });
		if (showCity && city) place.createSpan({ cls: 'rv-locator-city-lg', text: city });
		if (showDistance) {
			const distance = distanceLabel(host, note, settings);
			const live = distance !== '—';
			place.createSpan({
				cls: `rv-locator-distance-lg${live ? ' is-live' : ' is-missing'}`,
				text: live ? `· ${distance}` : '· —',
				attr: { 'aria-label': live ? `Distance ${distance}` : 'Distance unavailable' },
			});
		}
	}
	const compact = settings.compactMode !== false;
	const showSpoke = show('last-spoke') && (!study || settings.studyShowSpoke);
	const showAttempted = show('last-attempted') && (!study || settings.studyShowAttempted);
	const showStudied = study;
	const showMet = show('met');
	const compactLines: CompactLineKind[] = [];
	if (show('name')) compactLines.push('name');
	if (showStreet || showCity || showDistance) compactLines.push('place');
	if (showSpoke || showAttempted || showMet || showStudied) {
		const when = card.createDiv(compact ? 'rv-locator-when is-compact' : 'rv-locator-when');
		if (showStudied) dateSlot(when, 'book-marked', 'Last Studied', dateRaw(readProperty(note, 'Last Studied')), compact);
		if (showSpoke) dateSlot(when, 'message-circle', 'Last Spoke', spokeRaw, compact);
		if (showAttempted) dateSlot(when, 'clock', 'Last Attempted', dateRaw(readProperty(note, 'Last Attempted')), compact);
		if (showMet) dateSlot(when, 'home', 'Met', dateRaw(readProperty(note, 'Met')), compact);
		if (compact) compactLines.push('dates');
	}
	const foot = card.createDiv('rv-locator-card-foot');
	if (show('met-with')) {
		const metWith = textOf(readProperty(note, 'Met With'));
		plainSlot(foot, 'user', metWith || '—', !metWith);
	}
	const ratio = show('visits') ? visitRatioText(note, study, settings.studyRatio) : null;
	const overrideLabel = settings.showCardReturnStatus && !snoozed ? host.cardOverrideLabel(path) : null;
	if (overrideLabel) {
		foot.createSpan({
			cls: 'rv-locator-slot rv-locator-override-label',
			text: overrideLabel,
			attr: { 'aria-label': `Return override ${overrideLabel}` },
		});
	} else if (ratio && !settings.showCardReturnStatus) {
		const ratioEl = foot.createSpan({
			cls: 'rv-locator-slot rv-locator-visits',
			attr: { 'aria-label': ratio.title },
		});
		ratioEl.createSpan({ cls: 'rv-locator-slot-text', text: `# ${ratio.text}` });
	}
	if ((!overrideLabel || snoozed) && ratio && settings.showCardReturnStatus) {
		const line = foot.createSpan('rv-locator-return-inline');
		line.createSpan({
			cls: 'rv-locator-return-visits',
			text: `# ${ratio.text}`,
			attr: { 'aria-label': ratio.title },
		});
		line.createSpan({
			cls: 'rv-locator-return-when',
			text: cardReturnLead(new Date(), settings.cardReturnFormat),
		});
		const bucket = line.createSpan({
			cls: 'rv-locator-return-bucket',
			text: host.cardReturnBucket(path),
		});
		bucket.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openAttemptLog(path);
		});
	}
	if (overrideLabel) {
		const overrideEl = foot.querySelector('.rv-locator-override-label');
		if (overrideEl instanceof HTMLElement) {
			overrideEl.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				host.openAttemptLog(path);
			});
		}
	}
	if (show('met-with') || show('visits')) compactLines.push('foot');
	paintActions(card, host, path, file.basename, priority, urgency, address, compact ? compactLines : null, fitted, snoozed);
	return true;
}

function paintActions(
	card: HTMLElement,
	host: NoteGlanceHost,
	path: string,
	name: string,
	priority: number | null,
	urgency: number | null,
	address: string,
	compactLines: readonly CompactLineKind[] | null,
	fitted: number,
	snoozed: boolean,
): void {
	const rank = priority != null && priority >= 0 && priority <= 5 ? String(Math.round(priority)) : null;
	const showRank = rank != null && priority !== 0;
	const showMap = Boolean(address.trim());
	let badges = 1;
	if (showRank && rank) badges += 1;
	if (showMap) badges += 1;
	card.style.setProperty('--rv-badge-count', String(badges));
	card.addClass('has-actions');
	if (compactLines) {
		card.addClass('is-compact-mode');
		const size = compactBadgePx(fitted, host.settings.glancablePaddingY, compactLines, badges);
		card.style.setProperty('--rv-control-size', `${size}px`);
	}
	const actions = card.createSpan('rv-locator-card-actions');
	const marks = urgencyMark(urgency, priority);
	const ghost = host.ghostIconForCard(path);
	const urgencyButton = snoozed || ghost === 'moon'
		? appendBadge(actions, { kind: 'icon', icon: 'moon', band: marks.band, label: 'Urgency' })
		: appendBadge(actions, { kind: 'urgency', glyphs: marks.glyphs, band: marks.band, label: 'Urgency' });
	urgencyButton.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		host.promptUrgencyMenu(path, name, event);
	});
	if (showRank && rank) {
		const pill = appendBadge(actions, { kind: 'priority', rank, label: `Priority ${rank}` });
		pill.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.promptPriority(path, name);
		});
	}
	if (showMap) {
		const route = appendBadge(actions, { kind: 'icon', icon: 'route' as BadgeIconName, label: 'Directions' });
		route.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void host.openRoute(path);
		});
	}
}

function distanceLabel(
	host: NoteGlanceHost,
	note: Record<string, unknown> | null,
	settings: NoteGlanceHost['settings'],
): string {
	const fix = host.distanceFix();
	const point = latLonFromUnknown(readProperty(note, settings.locationProperty.trim() || 'Location'));
	if (!fix || !point) return '—';
	return formatDistance(haversineMeters(fix, point), settings.distanceUnit);
}

function visitRatioText(
	note: Record<string, unknown> | null,
	study: boolean,
	order: NoteGlanceHost['settings']['studyRatio'],
): { text: string; title: string } {
	if (study) {
		const fraction = formatStudyFraction(lessonCount(readProperty(note, 'Lessons Studied')), finite(readProperty(note, 'Studies')) ?? 0, order);
		const label = order === 'studies-lessons' ? 'Studies/Lessons' : 'Lessons/Studies';
		return { text: fraction.ratio, title: `${label} ${fraction.withDecimal}` };
	}
	const home = countLabel(readProperty(note, 'Successful Visits'));
	const total = countLabel(readProperty(note, 'Visits'));
	return { text: `${home}/${total}`, title: `${home} Successful Visits of ${total} Visits` };
}

function countLabel(value: unknown): string {
	const count = finite(value);
	if (count == null) return '—';
	return Number.isInteger(count) ? String(count) : String(count);
}

function dateSlot(parent: HTMLElement, icon: string, label: string, raw: string, compact: boolean): void {
	const slot = parent.createSpan({
		cls: `rv-locator-slot is-dated${raw ? '' : ' is-empty'}`,
		attr: { 'aria-label': label },
	});
	const iconEl = slot.createSpan('rv-locator-slot-icon');
	setIcon(iconEl, icon);
	if (!raw) {
		slot.createSpan({ cls: 'rv-locator-slot-text', text: '—' });
		return;
	}
	if (compact) {
		const days = calendarDaysSince(raw);
		slot.createSpan({ cls: 'rv-locator-slot-text', text: days == null ? '—' : formatGlanceableCounter(days) });
		return;
	}
	const display = formatDriveDate(raw);
	const wrap = slot.createSpan('rv-locator-date');
	const clock = wrap.createSpan('rv-locator-clock');
	clock.createSpan({ cls: 'rv-locator-dow', text: display.dow ?? '' });
	if (display.time) clock.createSpan({ cls: 'rv-locator-time', text: `, ${display.time}` });
	if (display.rest) wrap.createSpan({ cls: 'rv-locator-cal', text: display.rest });
	const days = calendarDaysSince(raw);
	if (days != null) slot.createSpan({ cls: 'rv-locator-days', text: formatGlanceableCounter(days) });
}

function plainSlot(parent: HTMLElement, icon: string, text: string, empty: boolean): void {
	const slot = parent.createSpan({ cls: `rv-locator-slot${empty ? ' is-empty' : ''}` });
	const mark = slot.createSpan('rv-locator-slot-icon');
	setIcon(mark, icon);
	slot.createSpan({ cls: 'rv-locator-slot-text', text });
}

function dateRaw(value: unknown): string {
	if (value instanceof Date) return value.toISOString();
	return typeof value === 'string' ? value.trim() : '';
}

function textOf(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return '';
}

function finite(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
	return null;
}

function lessonCount(value: unknown): number {
	if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).length;
	return typeof value === 'string' && value.trim() ? 1 : 0;
}
