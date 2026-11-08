import { Menu, setIcon } from 'obsidian';
import { attemptLogCallouts, isLogCalloutTitle } from './attempt-digest';
import { expandFoldedHost, scrollPreviewTarget } from './callout-fold';
import { pickDayJump, type DayJumpCandidate } from './day-jump';
import { calendarDaysSince, dateTextFromUnknown, formatDriveDate, formatGlanceableCounter, parseDriveInstant, visibleStampText } from './dates';
import { parseLogBullet, stampDateTime } from './schedule';
import { readProperty } from './frontmatter';
import { pinnedText } from './visit-paint-guard';
import { hubRefs, resolveReturnHub, type HubRef } from './hub-row';
import { displayedUrgency } from './row-score';
import { urgencyAccentColor, urgencyMark } from './scoring';
import { appendBadge, concealRawBaseEmbed, pinBadgeStroke } from './glancable-view';
import { isRvDashboardNote } from './rv-note-view';
import { resolveStatus, sanitizeGender, statusIcon, type RvStatus } from './status';
import { lastListEntries } from './taken-row';
import type { RVLocatorSettings } from './types';
import { formatStudyFraction, lessonPillLabel } from './catalog';
import { paintUrgencyInk } from './color-math';
import { SNOOZE_SLATE } from './snooze';
import { armHoverTooltip, displayTitle, fitEndEllipsis, overlayOnChip, plainTitleTruncated, showTitlePopover } from './title-fit';
import { cardPersonTitle } from './note-name';
import { ageCaption, appendPersonMeta } from './person-meta';
import { urgencyColorsFor } from './urgency-palette';

export interface NoteChromeHost {
	frontmatter(path: string): Record<string, unknown> | null;
	settings: RVLocatorSettings;
	snoozeUntil(path: string): Date | null;
	setStatus(path: string, status: RvStatus): void;
	setPriority(path: string, priority: number): void;
	openUrgency(path: string, name: string, event: MouseEvent): void;
	openPriority(path: string, name: string): void;
	openRoute(path: string): void;
	openHub(path: string, target: string): void;
	addHub(path: string): void;
	removeHub(path: string, label: string): void;
	moveHub(path: string, label: string): void;
	openSlotOverride(path: string): void;
	setAddress(path: string, address: string): void;
	openMap(path: string): void;
	openCompanion(path: string): void;
	campaignMark(path: string): 'covered' | 'open' | null;
	noteTitle(path: string): string;
	renameNote(path: string): void;
	mapOpen(): boolean;
	/** Lit only while this note's own split map is open. */
	noteMapLit?(path: string): boolean;
	ghostIcon(path: string): 'hourglass' | 'moon' | 'ban' | null;
}

const LONG_PRESS_MS = 500;

function eventPointerType(event: Event): string {
	if ('pointerType' in event && typeof (event as PointerEvent).pointerType === 'string') return (event as PointerEvent).pointerType;
	return '';
}

/**
 * Hold still opens the action. A refresh that replaces the node never
 * delivers pointerup to it, so the release is watched on the document.
 * A node that is already gone does not run the action.
 */
function armLongPress(el: HTMLElement, run: (event: PointerEvent) => void, allowMouse = true): void {
	let timer = 0;
	let startX = 0;
	let startY = 0;
	let startedAt = 0;
	const doc = el.ownerDocument;
	const clear = (): void => {
		window.clearTimeout(timer);
		timer = 0;
		doc.removeEventListener('pointerup', onPointerEnd, true);
		doc.removeEventListener('pointercancel', onPointerEnd, true);
	};
	const holdTaken = (event: PointerEvent): boolean => (
		event.pointerType === 'touch' && Date.now() - startedAt >= LONG_PRESS_MS - 80
	);
	const onPointerEnd = (event: PointerEvent): void => {
		if (event.type === 'pointercancel' && holdTaken(event)) return;
		clear();
	};
	el.addEventListener('pointerdown', (event) => {
		if (event.pointerType === 'mouse' && (!allowMouse || event.button !== 0)) return;
		clear();
		startX = event.clientX;
		startY = event.clientY;
		startedAt = Date.now();
		doc.addEventListener('pointerup', onPointerEnd, true);
		doc.addEventListener('pointercancel', onPointerEnd, true);
		timer = window.setTimeout(() => {
			timer = 0;
			doc.removeEventListener('pointerup', onPointerEnd, true);
			doc.removeEventListener('pointercancel', onPointerEnd, true);
			if (!el.isConnected) return;
			run(event);
		}, LONG_PRESS_MS);
	});
	el.addEventListener('pointermove', (event) => {
		if (!timer) return;
		if (Math.hypot(event.clientX - startX, event.clientY - startY) > 12) clear();
	});
	el.addEventListener('pointerleave', (event) => {
		if (event.pointerType === 'touch') return;
		clear();
	});
	el.addEventListener('pointercancel', (event) => {
		if (holdTaken(event)) return;
		clear();
	});
	el.addEventListener('touchend', () => { clear(); });
}

/**
 * The hub menu opens while the finger is still down. The lift's pointerup
 * and the compatibility click would dismiss it. Swallow that one gesture
 * so the menu stays up until the next tap.
 */
function keepHubMenuAfterTouch(link: HTMLElement): void {
	const doc = link.ownerDocument;
	const view = doc.defaultView;
	if (!view) return;
	let phase: 'down' | 'lift' | 'done' = 'down';
	let liftTimer = 0;
	const types = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'];
	const finish = (): void => {
		if (phase === 'done') return;
		phase = 'done';
		view.clearTimeout(liftTimer);
		for (const type of types) {
			view.removeEventListener(type, onLift, true);
			doc.removeEventListener(type, onLift, true);
		}
	};
	const onLift = (lift: Event): void => {
		if (phase === 'done') return;
		if (!link.isConnected) {
			finish();
			return;
		}
		const kind = eventPointerType(lift);
		const nextTouch = lift.type === 'touchstart' || (lift.type === 'pointerdown' && kind === 'touch');
		if (lift.type === 'pointerdown' || lift.type === 'touchstart') {
			if (nextTouch || phase === 'down') {
				finish();
				return;
			}
			lift.preventDefault();
			lift.stopImmediatePropagation();
			return;
		}
		if (phase === 'down') {
			if (lift.type !== 'pointerup' && lift.type !== 'touchend') return;
			phase = 'lift';
			lift.preventDefault();
			lift.stopImmediatePropagation();
			liftTimer = view.setTimeout(finish, 700);
			return;
		}
		lift.preventDefault();
		lift.stopImmediatePropagation();
		if (lift.type === 'click') finish();
	};
	for (const type of types) {
		view.addEventListener(type, onLift, true);
		doc.addEventListener(type, onLift, true);
	}
}

/** Leaves and previews that own the urgency custom properties. */
const URGENCY_READY_SELECTOR = '.workspace-leaf-content, .markdown-preview-view, .markdown-reading-view, .rv-dashboard';

/** Quick Facts header badges, Quick Facts rows, and one shared Hub chip row. */
export function decorateNoteChrome(root: HTMLElement, path: string, host: NoteChromeHost): void {
	const data = host.frontmatter(path);
	if (!data) return;
	const fullBase = root.classList.contains('rv-locator-full-base')
		? root
		: root.closest('.rv-locator-full-base');
	if (fullBase instanceof HTMLElement) concealRawBaseEmbed(fullBase);
	decorateNoteTitle(root, data);
	decorateDashboardHeading(root, path, data, host);
	decorateQuickFacts(root, path, data, host);
	decorateHubRow(root, path, data, host);
	decorateSlotOverride(root, path, data, host);
	applyLiveUrgency(root, path, host, true);
}

/** Status icon to the left of the note title. Render only; the file is not written. */
function decorateDashboardHeading(root: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	if (!isRvDashboardNote(data) || typeof root.querySelectorAll !== 'function') return;
	root.querySelectorAll('.callout[data-callout="quote"] .callout-title-inner').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		const callout = node.closest('.callout');
		if (!(callout instanceof HTMLElement) || callout.classList.contains('rv-locator-return-suggestions')) return;
		const raw = (node.dataset.rvNamed === '1' ? 'RV Dashboard' : (node.textContent ?? '')).replace(/\s+/g, ' ').trim();
		if (raw !== 'RV Dashboard' && node.dataset.rvNamed !== '1') return;
		node.dataset.rvNamed = '1';
		const status = resolveStatus(readProperty(data, 'Status'), finiteNumber(readProperty(data, 'Priority')));
		const mark = host.campaignMark(path);
		const age = ageCaption(readProperty(data, 'Age'), readProperty(data, 'Age Exact'));
		const gender = sanitizeGender(readProperty(data, 'Gender')) ?? '';
		const dashKey = [status, mark ?? '', host.noteTitle(path), age, gender].join('\u0001');
		if (node.dataset.rvDash === dashKey && node.querySelector(':scope > .rv-dash-name')) return;
		node.dataset.rvDash = dashKey;
		node.replaceChildren();
		if (mark) {
			const icon = node.createSpan('rv-dash-campaign');
			setIcon(icon, mark === 'covered' ? 'book-check' : 'book-alert');
			icon.setAttribute('aria-label', mark === 'covered' ? 'Covered this campaign' : 'Campaign');
		}
		const statusEl = node.createSpan('rv-dash-status');
		setIcon(statusEl, statusIcon(status));
		statusEl.setAttribute('aria-label', status);
		node.createSpan({ cls: 'rv-dash-name', text: host.noteTitle(path) });
		appendPersonMeta(node, age, gender);
		const more = node.createEl('button', {
			cls: 'rv-dash-rename clickable-icon',
			attr: { type: 'button', 'aria-label': 'Edit attributes' },
		});
		setIcon(more, 'more-horizontal');
		more.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.renameNote(path);
		});
	});
}

function decorateNoteTitle(root: HTMLElement, data: Record<string, unknown>): void {
	if (typeof root.closest !== 'function') return;
	const leaf = root.closest('.workspace-leaf-content');
	if (!(leaf instanceof HTMLElement) || typeof leaf.querySelectorAll !== 'function') return;
	const dashboard = isRvDashboardNote(data);
	const status = resolveStatus(readProperty(data, 'Status'), finiteNumber(readProperty(data, 'Priority')));
	leaf.querySelectorAll('.inline-title').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		const existing = node.querySelector(':scope > .rv-note-status');
		if (!dashboard) {
			existing?.remove();
			return;
		}
		let mark = existing instanceof HTMLElement ? existing : null;
		if (!mark) {
			mark = node.ownerDocument.createElement('span');
			mark.className = 'rv-note-status';
			node.prepend(mark);
		}
		if (mark.dataset.status === status && mark.childElementCount > 0) return;
		mark.dataset.status = status;
		mark.replaceChildren();
		setIcon(mark, statusIcon(status));
		mark.setAttribute('aria-label', status);
	});
}

/**
 * Cards and Bases embeds paint their own accent. A note pass must not
 * overwrite them, or an embedded hub goes grey with the note's faint ink.
 */
function noteChromeOwnsUrgency(node: HTMLElement): boolean {
	if (typeof node.closest !== 'function') return true;
	return node.closest('.rv-locator-glancable, .rv-locator-card, .bases-embed, .block-language-base, .rv-map, .rv-map-pin, .rv-note-map') == null;
}

/**
 * Reading view reuses a cached section and skips its post-processor.
 * A Home log re-renders the buttons and suggestions, and leaves the address
 * and the facts badge on that cached HTML, still carrying the old accent.
 * Paint from the preview so those siblings update in the same pass.
 */
export function readingUrgencyScope(start: HTMLElement): HTMLElement {
	if (typeof start.closest !== 'function') return start;
	const preview = start.closest('.markdown-preview-view, .markdown-reading-view');
	return preview instanceof HTMLElement ? preview : start;
}

/**
 * The note, its preview, and the leaf, walking up from `start`.
 * Custom properties inherit, so the leaf is enough for chrome that mounts later.
 */
export function urgencyStyleHosts(start: HTMLElement): HTMLElement[] {
	const hosts: HTMLElement[] = [start];
	let node = start.parentElement;
	while (node) {
		hosts.push(node);
		if (node.classList.contains('workspace-leaf-content')) break;
		node = node.parentElement;
	}
	return hosts;
}

/**
 * Render-only urgency on the note and Return Suggestions. Does not rewrite Markdown.
 * Sets the accent before chrome paints. With no frontmatter yet, clears a previous
 * note's accent so the hide-until-ready rule can hold the wrong color off screen.
 * `forceReady` unhides after the last remount even if frontmatter never arrives.
 */
export function applyLiveUrgency(start: HTMLElement, path: string, host: NoteChromeHost, forceReady = false): void {
	const data = host.frontmatter(path);
	const scope = data ? readingUrgencyScope(start) : start;
	const hosts = urgencyStyleHosts(scope);
	if (!data) {
		clearUrgencySurfaces(scope);
		if (forceReady) markUrgencyReady(hosts);
		else clearUrgencyPaint(hosts);
		return;
	}
	const priority = finiteNumber(readProperty(data, 'Priority'));
	const urgency = noteUrgency(path, data, priority, host);
	const colors = urgencyColorsFor(host.settings.urgencyPalette, host.settings.urgencyCustomColors);
	const snoozed = host.ghostIcon(path) === 'moon';
	const accent = snoozed ? SNOOZE_SLATE : urgencyAccentColor(urgency, priority, colors);
	markSnoozedDashboard(start, hosts, snoozed);
	const inkHost = hosts[0];
	if (inkHost) paintUrgencyInk(inkHost, accent);
	const ink = inkHost?.style.getPropertyValue('--rv-urgency-ink') || accent;
	for (const el of hosts) {
		setPaint(el, '--rv-urgency-accent', accent);
		setPaint(el, '--rv-urgency-ink', ink);
		if (el.classList.contains('rv-locator-return-suggestions')) setPaint(el, '--callout-color', accent);
	}
	// RV-166A. A chrome-less pass still has to repaint the dashboard and every
	// RV callout. Their own inline accent would otherwise keep the old color.
	// Home leaves the address and the badge in a cached section, so the scope
	// is the preview, not only the section that just re-rendered.
	paintUrgencySurfaces(scope, accent, ink, snoozed);
	scope.querySelectorAll('.rv-locator-return-suggestions').forEach((node) => {
		if (!(node instanceof HTMLElement) || !noteChromeOwnsUrgency(node)) return;
		setPaint(node, '--rv-urgency-accent', accent);
		setPaint(node, '--rv-urgency-ink', ink);
		setPaint(node, '--callout-color', accent);
	});
	scope.querySelectorAll('.rv-stamp-count, .rv-stamp-ago').forEach((node) => {
		if (!(node instanceof HTMLElement) || !noteChromeOwnsUrgency(node)) return;
		setPaint(node, '--rv-urgency-accent', accent);
		paintUrgencyInk(node, accent);
		const nodeInk = node.style.getPropertyValue('--rv-urgency-ink').trim() || accent;
		setPaint(node, 'color', nodeInk, true);
	});
	markUrgencyReady(hosts);
	paintUrgencyDetails(scope, accent);
}

/** Address, hub, item icons, campaign, and badge strokes follow the accent after a visit. */
function paintUrgencyDetails(start: HTMLElement, accent: string): void {
	const colorOf = [
		'.rv-item-icon',
		'.rv-label-icon',
		'.rv-stamp-kind',
	].join(', ');
	start.querySelectorAll(colorOf).forEach((node) => {
		if (!(node instanceof HTMLElement) || !noteChromeOwnsUrgency(node)) return;
		setPaint(node, 'color', accent, true);
		node.querySelectorAll('svg').forEach((svg) => {
			if (!(svg instanceof SVGElement)) return;
			setPaint(svg, 'color', accent, true);
			setPaint(svg, 'stroke', accent, true);
		});
	});
	start.querySelectorAll('.rv-locator-urgency, .rv-locator-map-pin, .rv-locator-priority-pill').forEach((node) => {
		if (!(node instanceof HTMLElement) || !noteChromeOwnsUrgency(node)) return;
		pinBadgeStroke(node);
	});
}

function setPaint(el: HTMLElement | SVGElement, name: string, value: string, important = false): void {
	const priority = important ? 'important' : '';
	if (el.style.getPropertyValue(name) === value && el.style.getPropertyPriority(name) === priority) return;
	if (important) el.style.setProperty(name, value, 'important');
	else el.style.setProperty(name, value);
}

/**
 * Dashboard, RV callouts, and any node that already carries an inline accent.
 * Reading view stamps `--rv-urgency-accent` on each section (`.el-p`, `.el-div`,
 * `.el-pre`). Those sit closer than the dashboard, so a later pass has to
 * repaint them or the address and visit buttons keep the old color.
 */
function urgencyPaintTargets(start: HTMLElement): HTMLElement[] {
	const found: HTMLElement[] = [];
	const seen = new Set<HTMLElement>();
	const take = (node: HTMLElement): void => {
		if (!noteChromeOwnsUrgency(node) || seen.has(node)) return;
		seen.add(node);
		found.push(node);
	};
	if (start.matches('.rv-dashboard, .callout[data-callout="rv"], .rv-locator-urgency, .rv-cal-month')) take(start);
	start.querySelectorAll('.rv-dashboard, .callout[data-callout="rv"], [style*="--rv-urgency-accent"], .rv-locator-urgency, .rv-cal-month').forEach((node) => {
		if (node instanceof HTMLElement) take(node);
	});
	return found;
}

function paintUrgencySurfaces(start: HTMLElement, accent: string, ink: string, snoozed: boolean): void {
	for (const el of urgencyPaintTargets(start)) {
		setPaint(el, '--rv-urgency-accent', accent);
		paintUrgencyInk(el, accent);
		if (!el.style.getPropertyValue('--rv-urgency-ink').trim()) setPaint(el, '--rv-urgency-ink', ink || accent);
		if (el.classList.contains('rv-dashboard')) el.classList.toggle('is-snoozed', snoozed);
	}
}

function clearUrgencySurfaces(start: HTMLElement): void {
	for (const el of urgencyPaintTargets(start)) {
		el.style.removeProperty('--rv-urgency-accent');
		el.style.removeProperty('--rv-urgency-ink');
		if (el.classList.contains('rv-dashboard')) el.classList.remove('is-snoozed');
	}
}

function markSnoozedDashboard(start: HTMLElement, hosts: readonly HTMLElement[], snoozed: boolean): void {
	const mark = (el: HTMLElement): void => {
		if (el.classList.contains('rv-dashboard')) el.classList.toggle('is-snoozed', snoozed);
	};
	mark(start);
	for (const el of hosts) mark(el);
}

function markUrgencyReady(hosts: readonly HTMLElement[]): void {
	for (const el of hosts) {
		if (el.matches(URGENCY_READY_SELECTOR)) el.classList.add('is-urgency-ready');
	}
}

function clearUrgencyPaint(hosts: readonly HTMLElement[]): void {
	for (const el of hosts) {
		el.style.removeProperty('--rv-urgency-accent');
		el.style.removeProperty('--rv-urgency-ink');
		if (el.classList.contains('rv-locator-return-suggestions')) el.style.removeProperty('--callout-color');
		if (el.matches(URGENCY_READY_SELECTOR)) el.classList.remove('is-urgency-ready');
	}
}

function decorateQuickFacts(root: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	for (const callout of visitFactsCallouts(root)) paintQuickFactsCallout(callout, path, data, host);
}

/**
 * Every Visit Facts callout under the root. Reading view and the hidden
 * live-preview clone are both in the leaf. Painting only the first one
 * left the visible reading callout on the previous visit.
 */
function visitFactsCallouts(root: HTMLElement): HTMLElement[] {
	const list = root.matches('.callout[data-callout="rv"]')
		? [root]
		: Array.from(root.querySelectorAll('.callout[data-callout="rv"]'));
	const found: HTMLElement[] = [];
	for (const node of list) {
		if (!(node instanceof HTMLElement)) continue;
		const title = node.querySelector(':scope > .callout-title');
		const text = title?.textContent ?? '';
		if (text.includes('Visit Facts') || text.includes('Quick Facts') || node.querySelector('.rv-qf-body')) found.push(node);
	}
	return found;
}

/** Frontmatter fields the reading-view callout shows. A match skips a second paint. */
function factsPaintKey(data: Record<string, unknown>): string {
	const fields = [
		'Last Spoke',
		'Last Attempted',
		'Last Studied',
		'Met',
		'Visits',
		'Successful Visits',
		'Left Publications',
		'Shared Media',
		'Lessons Studied',
		'Taken',
		'Met With',
		'Status',
		'Priority',
	];
	return fields.map((key) => pinnedText(readProperty(data, key))).join('\u0001');
}

function paintQuickFactsCallout(callout: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	const title = callout.querySelector(':scope > .callout-title');
	const content = callout.querySelector(':scope > .callout-content');
	if (!title || !content || !(title instanceof HTMLElement) || !(content instanceof HTMLElement)) return;
	const key = factsPaintKey(data);
	const priority = finiteNumber(readProperty(data, 'Priority'));
	const status = resolveStatus(readProperty(data, 'Status'), priority);
	const urgency = noteUrgency(path, data, priority, host);
	const colors = urgencyColorsFor(host.settings.urgencyPalette, host.settings.urgencyCustomColors);
	const snoozed = host.ghostIcon(path) === 'moon';
	const accent = snoozed ? SNOOZE_SLATE : urgencyAccentColor(urgency, priority, colors);
	callout.style.setProperty('--rv-urgency-accent', accent);
	paintUrgencyInk(callout, accent);
	const dashboard = callout.closest('.rv-dashboard');
	if (dashboard instanceof HTMLElement) {
		dashboard.classList.toggle('is-snoozed', snoozed);
		dashboard.style.setProperty('--rv-urgency-accent', accent);
		paintUrgencyInk(dashboard, accent);
	}
	if (content.dataset.rvFactsPaint === key && content.classList.contains('rv-qf-body') && content.childElementCount > 0) return;
	paintFactsTitle(title, path, data, status, priority, urgency, host);
	paintFactsBody(content, path, data, status, priority, host);
	content.dataset.rvFactsPaint = key;
}

/** Fractional part in [0, 1). */
function unitFraction(value: number): number {
	const mod = value % 1;
	return mod < 0 ? mod + 1 : mod;
}

/**
 * Margin that puts a row on a whole pixel.
 * `top` is the row's top while its margin-top is still `base`.
 * The added amount is `(1 - f) mod 1`, which is 0 when the top is already whole.
 */
export function factsRowMargin(base: number, top: number): number {
	const next = base + unitFraction(1 - unitFraction(top));
	return Math.round(next * 10000) / 10000;
}

function px(value: number): string {
	return String(Math.round(value * 10000) / 10000);
}

function factsBaseMargin(badges: HTMLElement): number {
	const stored = badges.dataset.rvFactsBase;
	if (stored != null && stored !== '') {
		const parsed = Number(stored);
		if (Number.isFinite(parsed)) return parsed;
	}
	const value = parseFloat(getComputedStyle(badges).marginTop);
	const base = Number.isFinite(value) ? value : 0;
	badges.dataset.rvFactsBase = String(base);
	return base;
}

function factsScope(badges: HTMLElement): HTMLElement | null {
	const scope = badges.closest('.markdown-preview-view, .markdown-reading-view, .markdown-source-view');
	if (scope instanceof HTMLElement) return scope;
	return badges.parentElement;
}

/** Measure the badge row and set its margin-top. No transform and no timer. */
function snapFactsRow(badges: HTMLElement): void {
	const probe = badges.getBoundingClientRect();
	if (probe.width < 1 || probe.height < 1) return;
	const scope = factsScope(badges);
	const key = String(Math.round(scope?.getBoundingClientRect().width || probe.width));
	if (badges.dataset.rvFactsWidth === key && badges.style.marginTop !== '') return;
	const base = factsBaseMargin(badges);
	badges.style.marginTop = `${px(base)}px`;
	const top = badges.getBoundingClientRect().top;
	badges.style.marginTop = `${px(factsRowMargin(base, top))}px`;
	badges.dataset.rvFactsWidth = key;
}

function armFactsRow(badges: HTMLElement): void {
	snapFactsRow(badges);
	if (badges.dataset.rvFactsWatch === '1' || typeof ResizeObserver === 'undefined') return;
	const scope = factsScope(badges);
	if (!scope) return;
	badges.dataset.rvFactsWatch = '1';
	const observer = new ResizeObserver(() => {
		snapFactsRow(badges);
	});
	observer.observe(scope);
}

function mountQuickFactsHead(inner: HTMLElement, ratio: string): void {
	inner.replaceChildren();
	inner.addClass('rv-qf-head');
	inner.createSpan({ cls: 'rv-qf-head-label', text: 'Visit Facts' });
	inner.createSpan({ cls: 'rv-qf-head-dot', text: '·' });
	const count = inner.createSpan('rv-qf-head-count');
	const icon = count.createSpan('rv-qf-head-icon');
	setIcon(icon, 'list-checks');
	count.createSpan({ cls: 'rv-qf-head-ratio', text: ratio });
}

function paintFactsTitle(
	title: HTMLElement,
	path: string,
	data: Record<string, unknown>,
	status: RvStatus,
	priority: number | null,
	urgency: number | null,
	host: NoteChromeHost,
): void {
	const inner = title.querySelector('.callout-title-inner');
	if (inner instanceof HTMLElement) {
		const successful = finiteNumber(readProperty(data, 'Successful Visits'));
		const visits = finiteNumber(readProperty(data, 'Visits'));
		mountQuickFactsHead(inner, visitsPercent(successful, visits));
	}
	let badges = title.querySelector(':scope > .rv-qf-badges');
	if (!(badges instanceof HTMLElement)) {
		badges = title.createSpan('rv-qf-badges');
	}
	if (!(badges instanceof HTMLElement)) return;
	const snoozed = host.ghostIcon(path) === 'moon';
	const signature = [
		host.settings.showUrgencyBadge ? `u:${urgency ?? ''}:${priority ?? ''}:${snoozed ? 'moon' : ''}` : '',
		host.settings.showPriorityBadge && priority != null ? `p:${priority}` : '',
		host.settings.showRouteBadge ? 'r:1' : '',
	].join('|');
	const expectsBadges = /(?:^|\|)[upr]:/.test(signature);
	if (badges.dataset.rvFacts === signature && (!expectsBadges || badges.childElementCount > 0)) {
		if (title.getAttribute('data-rv-status') !== status) title.setAttr('data-rv-status', status);
		armFactsRow(badges);
		return;
	}
	badges.empty();
	const name = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
	if (host.settings.showUrgencyBadge) {
		const marks = urgencyMark(urgency, priority);
		const button = snoozed
			? appendBadge(badges, { kind: 'icon', icon: 'moon', band: marks.band, label: 'Urgency' })
			: appendBadge(badges, { kind: 'urgency', glyphs: marks.glyphs, band: marks.band, label: 'Urgency' });
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openUrgency(path, name, event);
		});
	}
	if (host.settings.showPriorityBadge && priority != null) {
		const rank = String(Math.max(0, Math.min(5, Math.round(priority))));
		const pill = appendBadge(badges, { kind: 'priority', rank, label: `Priority ${priority}` });
		pill.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openPriority(path, name);
		});
	}
	if (host.settings.showRouteBadge) {
		const route = appendBadge(badges, { kind: 'icon', icon: 'route', label: 'Directions' });
		route.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openRoute(path);
		});
	}
	badges.dataset.rvFacts = signature;
	if (title.getAttribute('data-rv-status') !== status) title.setAttr('data-rv-status', status);
	armFactsRow(badges);
}

function paintFactsBody(
	content: HTMLElement,
	path: string,
	data: Record<string, unknown>,
	status: RvStatus,
	priority: number | null,
	host: NoteChromeHost,
): void {
	collapseChipReveal();
	content.empty();
	content.addClass('rv-qf-body');
	const study = status === 'Study';
	void priority;
	if (study) factDateRow(content, 'book-marked', 'Studied', readProperty(data, 'Last Studied'));
	if (!study || host.settings.studyShowSpoke) factDateRow(content, 'message-circle', 'Spoke', readProperty(data, 'Last Spoke'));
	if (!study || host.settings.studyShowAttempted) factDateRow(content, 'clock', 'Attempted', readProperty(data, 'Last Attempted'));
	factDateRow(content, 'home', 'Met', readProperty(data, 'Met'));
	paintQuickList(content, 'book', 'Literature', textList(readProperty(data, 'Left Publications')), 'literature', 1);
	paintQuickList(content, 'film', 'Media', textList(readProperty(data, 'Shared Media')), 'media', 1);
	paintQuickList(content, 'book-open', 'Lessons', textList(readProperty(data, 'Lessons Studied')), 'lesson', 2);
	const taken = textList(readProperty(data, 'Taken'));
	const metWith = textOf(readProperty(data, 'Met With'));
	const row = paintQuickList(content, 'users', 'Taken', taken, 'name', 2, metWith);
	bindCompanionOpen(row, path, host);
}

function visitsPercent(successful: number | null, visits: number | null): string {
	const home = successful == null ? '—' : String(successful);
	const total = visits == null ? '—' : String(visits);
	if (successful == null || visits == null || visits <= 0) return `${home}/${total}`;
	return `${successful}/${visits} (${Math.round((successful / visits) * 100)}%)`;
}

function paintClampRow(parent: HTMLElement, icon: string, label: string, items: readonly string[]): void {
	const row = factRow(parent, icon, label, '');
	const valueEl = row.querySelector('.rv-qf-value');
	if (!(valueEl instanceof HTMLElement)) return;
	if (items.length === 0) {
		valueEl.setText('—');
		return;
	}
	paintClampList(valueEl, items);
}

/** Last three entries, clamped to two lines. A tap shows the rest. */
function paintClampList(host: HTMLElement, items: readonly string[]): void {
	const recent = lastListEntries(items);
	const box = host.createSpan('rv-qf-clamp');
	box.setText(recent.join(' · '));
	if (items.length <= 1 && recent.join(' · ').length < 48) return;
	host.classList.add('is-collapsible');
	host.setAttr('role', 'button');
	host.tabIndex = 0;
	const full = items.join(' · ');
	const reveal = (event: Event): void => {
		event.preventDefault();
		event.stopPropagation();
		showTitlePopover(host, full);
	};
	host.addEventListener('click', reveal);
	host.addEventListener('mouseenter', () => {
		if (chipHostIsPhone(host)) return;
		showTitlePopover(host, full);
	});
	armLongPress(host, (event) => reveal(event), false);
	host.addEventListener('keydown', (event) => {
		if (!(event instanceof KeyboardEvent)) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		reveal(event);
	});
}

function bindCompanionOpen(row: HTMLElement, path: string, host: NoteChromeHost): void {
	const open = (event: Event): void => {
		event.preventDefault();
		event.stopPropagation();
		host.openCompanion(path);
	};
	row.querySelector('.rv-qf-icon')?.addEventListener('click', open);
	row.querySelector('.rv-qf-label')?.addEventListener('click', open);
	row.classList.add('rv-qf-companion');
}

const CAL_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

type ChipKind = 'literature' | 'media' | 'lesson' | 'name';

interface FactChip {
	title: string;
	type: string;
	full: string;
	met: boolean;
	empty: boolean;
}

function factDateRow(parent: HTMLElement, icon: string, label: string, value: unknown): void {
	const row = factRow(parent, icon, label, '');
	const valueEl = row.querySelector('.rv-qf-value');
	if (!(valueEl instanceof HTMLElement)) return;
	const raw = value instanceof Date ? value.toISOString() : textOf(value);
	const display = formatDriveDate(raw);
	if (display.empty || !display.rest) {
		valueEl.createSpan({ cls: 'rv-qf-pill rv-qf-dash', text: '—' });
		return;
	}
	const days = calendarDaysSince(raw, new Date());
	const instant = parseDriveInstant(raw);
	const lead = display.time ? `${display.dow}, ${display.time}` : (display.dow || display.text);
	const pill = valueEl.createSpan('rv-qf-pill rv-qf-when');
	if (instant) {
		const tile = pill.createSpan('rv-cal');
		tile.createSpan({ cls: 'rv-cal-month', text: CAL_MONTHS[instant.getMonth()] ?? '' });
		tile.createSpan({ cls: 'rv-cal-day', text: String(instant.getDate()) });
	}
	pill.createSpan({ cls: 'rv-qf-when-lead', text: lead });
	if (days != null) pill.createSpan({ cls: 'rv-stamp-ago', text: formatGlanceableCounter(days) });
	armHoverTooltip(pill, display.title || raw, { touch: false });
	if (!instant) return;
	pill.setAttr('role', 'link');
	pill.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (chipHostIsPhone(pill) && plainTitleTruncated(pill)) {
			showTitlePopover(pill, pill.dataset.rvTip || display.title || raw);
			return;
		}
		jumpToQuickFactDay(pill, instant);
	});
}

function paintQuickList(
	parent: HTMLElement,
	icon: string,
	label: string,
	items: readonly string[],
	kind: ChipKind,
	limit: number,
	metWith = '',
): HTMLElement {
	const row = factRow(parent, icon, label, '');
	const labelEl = row.querySelector('.rv-qf-label');
	const valueEl = row.querySelector('.rv-qf-value');
	const all = items.map((item) => item.trim()).filter((item) => item.length > 0);
	const width = limit === 2 ? 2 : 1;
	const ordered = pairBlankPartner(orderedChips(all, kind, width, metWith), width);
	const collapsed = chipsFor(all, kind, width, metWith);
	const shown = collapsed.filter((chip) => !chip.empty && !(kind === 'name' && chip.met && !all.some((item) => item.toLowerCase() === chip.full.toLowerCase()))).length;
	const extra = Math.max(0, all.length - shown);
	if (!(valueEl instanceof HTMLElement)) return row;
	if (ordered.length === 0) {
		valueEl.createSpan({ cls: 'rv-qf-pill rv-qf-dash', text: '—' });
		return row;
	}
	const stack = valueEl.createSpan('rv-qf-stack');
	const lines: HTMLElement[] = [];
	for (let index = 0; index < ordered.length; index += width) {
		const slice = ordered.slice(index, index + width);
		const host = stack.createSpan(width === 2 ? 'rv-qf-chips is-halves' : 'rv-qf-chips is-single');
		for (const chip of slice) paintFactChip(host, chip);
		lines.push(host);
	}
	if (extra > 0 && labelEl instanceof HTMLElement) {
		labelEl.createSpan({ cls: 'rv-qf-plus', text: `+${extra}` });
		const chevron = labelEl.createSpan({
			cls: 'rv-qf-chevron',
			attr: { role: 'button', tabindex: '0', 'aria-expanded': 'false', 'aria-label': `${label} list` },
		});
		setIcon(chevron, 'chevron-down');
		const searchWrap = valueEl.createSpan('rv-qf-search-wrap');
		const searchIcon = searchWrap.createSpan('rv-qf-search-icon');
		setIcon(searchIcon, 'search');
		const search = searchWrap.createEl('input', {
			cls: 'rv-qf-search',
			attr: { type: 'search', placeholder: 'Search', 'aria-label': `Search ${label}` },
		});
		search.addEventListener('input', () => {
			const query = search instanceof HTMLInputElement ? search.value.trim().toLowerCase() : '';
			for (const line of lines) {
				const chips = Array.from(line.querySelectorAll('.rv-qf-chip'));
				let any = false;
				for (const chip of chips) {
					if (!(chip instanceof HTMLElement)) continue;
					const hit = query.length === 0 || (chip.dataset.rvText ?? '').includes(query);
					chip.hidden = !hit;
					if (hit) any = true;
				}
				line.hidden = !any;
			}
		});
		const toggle = (event: Event): void => {
			event.preventDefault();
			event.stopPropagation();
			const open = !stack.classList.contains('is-open');
			stack.classList.toggle('is-open', open);
			valueEl.classList.toggle('is-open', open);
			chevron.setAttr('aria-expanded', open ? 'true' : 'false');
			setIcon(chevron, open ? 'chevron-up' : 'chevron-down');
		};
		chevron.addEventListener('click', toggle);
		chevron.addEventListener('keydown', (event) => {
			if (!(event instanceof KeyboardEvent)) return;
			if (event.key !== 'Enter' && event.key !== ' ') return;
			toggle(event);
		});
	}
	return row;
}

function paintFactChip(host: HTMLElement, chip: FactChip): void {
	if (chip.empty) {
		const blank = host.createSpan({ cls: 'rv-qf-chip is-blank', text: '—' });
		blank.dataset.rvText = '';
		return;
	}
	const el = host.createSpan({ cls: chip.met ? 'rv-qf-chip is-met' : 'rv-qf-chip' });
	el.dataset.rvText = chip.full.toLowerCase();
	const group = el.createSpan('rv-qf-chip-group');
	group.createSpan({ cls: 'rv-qf-chip-title', text: chip.title });
	if (chip.type) group.createSpan({ cls: 'rv-qf-chip-type', text: chip.type });
	armChipOverlay(el, chip.full);
}

/** A single Taken or Lessons entry keeps a blank partner so the row stays a pair. */
function pairBlankPartner(chips: FactChip[], width: number): FactChip[] {
	if (width !== 2 || chips.length !== 1) return chips;
	const blank: FactChip = { title: '—', type: '', full: '', met: false, empty: true };
	if (chips[0]?.met) return [blank, chips[0]];
	return [...chips, blank];
}

/** Collapsed pills first, then every later entry, in the same single or double shape. */
function orderedChips(items: readonly string[], kind: ChipKind, limit: number, metWith: string): FactChip[] {
	if (kind === 'name') {
		const visible = chipsFor(items, kind, limit, metWith).filter((chip) => !chip.empty);
		const used = new Set(visible.map((chip) => chip.full.toLowerCase()));
		const rest = items
			.filter((item) => !used.has(item.trim().toLowerCase()))
			.map((item) => ({ ...chipParts(item, kind), met: false, empty: false }));
		return [...visible, ...rest];
	}
	const recent = lastListEntries(items, limit);
	const recentKeys = new Set(recent.map((item) => item.toLowerCase()));
	const older = items.filter((item) => !recentKeys.has(item.toLowerCase()));
	return [...recent, ...older].map((item) => ({ ...chipParts(item, kind), met: false, empty: false }));
}

function chipsFor(items: readonly string[], kind: ChipKind, limit: number, metWith: string): FactChip[] {
	if (kind !== 'name') return lastListEntries(items, limit).map((item) => ({ ...chipParts(item, kind), met: false, empty: false }));
	const met = metWith.trim();
	const metKey = met.toLowerCase();
	if (met) {
		const others = items.filter((item) => item.toLowerCase() !== metKey);
		const left = others.length > 0 ? others[others.length - 1] ?? '' : '';
		return [
			left ? { ...chipParts(left, 'name'), met: false, empty: false } : { title: '', type: '', full: '', met: false, empty: true },
			{ ...chipParts(met, 'name'), met: true, empty: false },
		];
	}
	return lastListEntries(items, limit).map((item) => ({ ...chipParts(item, 'name'), met: false, empty: false }));
}

function chipParts(item: string, kind: ChipKind): { title: string; type: string; full: string } {
	if (kind === 'literature' || kind === 'media') {
		const parts = displayTitle(item, kind);
		const type = parts.suffix.trim();
		return { title: parts.text, type, full: type ? `${parts.text} ${type}` : parts.text };
	}
	if (kind === 'lesson') {
		const title = lessonPillLabel(item);
		return { title, type: '', full: title };
	}
	return { title: item, type: '', full: item };
}

function chipTruncated(el: HTMLElement): boolean {
	const title = el.querySelector('.rv-qf-chip-title');
	if (!(title instanceof HTMLElement)) return false;
	if (title.clientWidth <= 0) return true;
	return title.scrollWidth > title.clientWidth + 1;
}

let openChip: HTMLElement | null = null;
let chipDismissArmed = false;
let ignoreChipClick = false;

function chipHostIsPhone(el: HTMLElement): boolean {
	const body = el.ownerDocument.body;
	return body.classList.contains('is-phone') || body.classList.contains('is-mobile');
}

let factCard: HTMLElement | null = null;

function clearFactCard(): void {
	factCard?.remove();
	factCard = null;
}

function collapseChipReveal(): void {
	clearFactCard();
	const current = openChip;
	openChip = null;
	if (!(current instanceof HTMLElement) || !current.isConnected) return;
	current.classList.remove('is-revealed');
	current.style.removeProperty('max-width');
}

/** The value chip grows in place. One open at a time, kept 8px inside the screen. */
function showChipOverlay(el: HTMLElement, full: string): void {
	if (!full || !chipTruncated(el)) return;
	if (openChip && openChip !== el) collapseChipReveal();
	openChip = el;
	el.classList.add('is-revealed');
	el.style.removeProperty('max-width');
	clearFactCard();
	const doc = el.ownerDocument;
	const card = doc.createElement('div');
	card.className = 'rv-fact-overlay';
	const title = el.querySelector('.rv-qf-chip-title')?.textContent ?? full;
	const type = el.querySelector('.rv-qf-chip-type')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
	const text = doc.createElement('span');
	text.className = 'rv-fact-overlay-title';
	text.textContent = title;
	card.appendChild(text);
	if (type) {
		const suffix = doc.createElement('span');
		suffix.className = 'rv-fact-overlay-type';
		suffix.textContent = ` ${type}`;
		card.appendChild(suffix);
	}
	doc.body.appendChild(card);
	const box = el.getBoundingClientRect();
	const viewWidth = doc.defaultView?.innerWidth ?? box.left + box.width;
	const fitted = overlayOnChip(box, viewWidth);
	card.style.left = `${fitted.left}px`;
	card.style.width = `${fitted.width}px`;
	card.style.top = `${box.top}px`;
	factCard = card;
}

function armChipDismiss(doc: Document): void {
	if (chipDismissArmed) return;
	chipDismissArmed = true;
	doc.addEventListener('pointerdown', (event) => {
		const body = doc.body;
		if (!body.classList.contains('is-phone') && !body.classList.contains('is-mobile')) return;
		const target = event.target;
		if (openChip && target instanceof Node && openChip.contains(target)) return;
		collapseChipReveal();
	}, true);
	const onScroll = (): void => {
		const body = doc.body;
		if (!body.classList.contains('is-phone') && !body.classList.contains('is-mobile')) return;
		collapseChipReveal();
	};
	doc.addEventListener('scroll', onScroll, true);
}

function armChipOverlay(el: HTMLElement, full: string): void {
	if (!full) return;
	armChipDismiss(el.ownerDocument);
	const show = (): void => { showChipOverlay(el, full); };
	el.addEventListener('mouseenter', () => {
		if (chipHostIsPhone(el)) return;
		show();
	});
	el.addEventListener('mouseleave', () => {
		if (chipHostIsPhone(el)) return;
		if (openChip === el) collapseChipReveal();
	});
	el.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (ignoreChipClick) {
			ignoreChipClick = false;
			return;
		}
		if (!chipHostIsPhone(el)) {
			show();
			return;
		}
		if (el.classList.contains('is-revealed')) collapseChipReveal();
		else show();
	});
	armLongPress(el, () => {
		ignoreChipClick = true;
		show();
	}, false);
}

interface DayJumpTarget extends DayJumpCandidate {
	el: HTMLElement;
}

function jumpToQuickFactDay(anchor: HTMLElement, when: Date): void {
	const preview = anchor.closest('.markdown-preview-view, .markdown-reading-view, .markdown-rendered');
	const root = preview instanceof HTMLElement ? preview : anchor.ownerDocument.body;
	if (!(root instanceof HTMLElement)) return;
	const pick = pickDayJump(when, collectDayJumps(root));
	if (!pick) return;
	const target = pick.kind === 'notes' ? visitNotesTarget(pick.el) : pick.el;
	revealJumpTarget(target, root);
	jumpToDayInRoot(root, when);
}

/** Scroll to the visit on this day and flash it. Recent Notes, Older Visits, or the Attempt Log. */
export function jumpToDayInRoot(root: HTMLElement, when: Date): boolean {
	const pick = pickDayJump(when, collectDayJumps(root));
	if (!pick) return false;
	const target = pick.kind === 'notes' ? visitNotesTarget(pick.el) : pick.el;
	revealJumpTarget(target, root);
	scrollPreviewTarget(target);
	target.classList.add('rv-day-flash');
	window.setTimeout(() => target.classList.remove('rv-day-flash'), 1600);
	return true;
}

function collectDayJumps(root: HTMLElement): DayJumpTarget[] {
	const found: DayJumpTarget[] = [];
	root.querySelectorAll('h3, h5').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		if (node.classList.contains('rv-older-visits') || node.classList.contains('rv-visit-notes-heading')) return;
		const text = headingStampText(node);
		if (/^(?:visit|recent) notes:?$/i.test(text)) return;
		const when = stampDateTime(text);
		if (!when) return;
		found.push({ when, home: true, kind: 'notes', el: node });
	});
	for (const callout of attemptLogCallouts(root)) {
		callout.querySelectorAll('li').forEach((node) => {
			if (!(node instanceof HTMLElement)) return;
			const bullet = parseLogBullet(`- ${node.textContent ?? ''}`);
			if (!bullet) return;
			found.push({ when: bullet.when, home: bullet.home, kind: 'attempt', el: node });
		});
	}
	return found;
}

function headingStampText(node: HTMLElement): string {
	const copy = node.cloneNode(true);
	if (copy instanceof HTMLElement) {
		copy.querySelectorAll('.rv-stamp-ago, .rv-visit-more, .heading-collapse-indicator, .collapse-indicator').forEach((child) => child.remove());
		return visibleStampText(copy.textContent ?? '');
	}
	return visibleStampText(node.textContent ?? '');
}

function visitNotesTarget(stamp: HTMLElement): HTMLElement {
	const start = stamp.closest('.el-h3, .el-h5') ?? stamp;
	let look: Element | null = start.nextElementSibling;
	while (look) {
		if (look.querySelector('h3.rv-visit-stamp, h5.rv-visit-stamp, .rv-stamp-ago')) break;
		const area = look instanceof HTMLTextAreaElement ? look : look.querySelector('textarea');
		if (area instanceof HTMLElement) return area;
		look = look.nextElementSibling;
	}
	return stamp;
}

/** Open the Attempt Log and scroll to it. Used by the card return line. */
export function revealAttemptLog(root: HTMLElement): boolean {
	const callout = attemptLogCallouts(root)[0];
	if (!callout) return false;
	expandFoldedHost(callout, root);
	scrollPreviewTarget(callout);
	callout.classList.add('rv-day-flash');
	window.setTimeout(() => callout.classList.remove('rv-day-flash'), 1600);
	return true;
}

/** Lisa and Bo render the callout a few hundred milliseconds after the note opens. */
const ATTEMPT_LOG_WAIT_MS = 2_000;

/**
 * Expand the Attempt Log once it is in the note. A fixed delay misses notes
 * whose callout arrives later, so this watches mutations and animation frames
 * until the callout exists or about two seconds have passed.
 */
export function revealAttemptLogWhenReady(root: HTMLElement, timeoutMs = ATTEMPT_LOG_WAIT_MS): void {
	const started = Date.now();
	let settled = false;
	let observer: MutationObserver | null = null;
	const stop = (): void => {
		observer?.disconnect();
		observer = null;
	};
	const attempt = (): void => {
		if (settled) return;
		const found = attemptLogCallouts(root).length > 0;
		if (!found && Date.now() - started < timeoutMs) return;
		settled = true;
		stop();
		if (found) revealAttemptLog(root);
	};
	const view = root.ownerDocument?.defaultView;
	const Observer = view?.MutationObserver ?? globalThis.MutationObserver;
	if (typeof Observer === 'function') {
		observer = new Observer(() => attempt());
		observer.observe(root, { childList: true, subtree: true });
	}
	const tick = (): void => {
		attempt();
		if (settled) return;
		const frame = view?.requestAnimationFrame ?? globalThis.requestAnimationFrame;
		if (typeof frame === 'function') frame(tick);
		else globalThis.setTimeout(tick, 16);
	};
	tick();
}

function revealJumpTarget(target: HTMLElement, root: HTMLElement): void {
	const notes = root.querySelector('h3.rv-visit-notes-heading');
	const host = notes?.parentElement;
	const notesWereCollapsed = host instanceof HTMLElement && host.classList.contains('is-collapsed');
	expandFoldedHost(target, root);
	if (notes instanceof HTMLElement && host instanceof HTMLElement && notesWereCollapsed && !host.contains(target)) {
		let inRecent = false;
		let cursor = host.nextElementSibling;
		while (cursor instanceof HTMLElement) {
			if (cursor.classList.contains('rv-older-visits-wrap') || cursor.classList.contains('rv-notes-fold-stop')) break;
			if (cursor === target || cursor.contains(target)) inRecent = true;
			cursor = cursor.nextElementSibling;
		}
		if (inRecent) {
			host.classList.remove('is-collapsed');
			notes.classList.add('is-open');
			let again = host.nextElementSibling;
			while (again instanceof HTMLElement) {
				if (again.classList.contains('rv-older-visits-wrap') || again.classList.contains('rv-notes-fold-stop')) break;
				if (again.style?.display === 'none') again.style.removeProperty('display');
				again = again.nextElementSibling;
			}
		}
	}
	if (!target.classList.contains('rv-older-hidden') && !target.closest('.rv-older-hidden')) return;
	root.dataset.rvOlderOpen = '1';
	root.querySelectorAll('.rv-older-hidden').forEach((el) => {
		if (el instanceof HTMLElement) el.classList.remove('rv-older-hidden');
	});
	root.querySelectorAll('.rv-older-visits').forEach((el) => {
		if (el instanceof HTMLElement) el.classList.add('is-open');
	});
}

function factRow(parent: HTMLElement, icon: string, label: string, value = ''): HTMLElement {
	const row = parent.createDiv('rv-qf-row');
	const iconEl = row.createSpan('rv-qf-icon');
	setIcon(iconEl, icon);
	row.createSpan({ cls: 'rv-qf-label', text: label });
	const valueEl = row.createSpan({ cls: 'rv-qf-value', text: value });
	if (!value) valueEl.empty();
	return row;
}

function decorateHubRow(root: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	const paragraphs = root.matches('p') ? [root] : Array.from(root.querySelectorAll('p'));
	for (const paragraph of paragraphs) {
		if (!(paragraph instanceof HTMLElement)) continue;
		const hubLabel = labeledStrong(paragraph, 'hub');
		const addressLabel = labeledStrong(paragraph, 'address');
		if (!hubLabel && !addressLabel) continue;
		paragraph.addClass('rv-hub-owned');
		pinSharedPairGrid(paragraph);
		if (!hubLabel) {
			decorateAddress(paragraph, path, data, host);
			continue;
		}
		hubLabel.textContent = 'Hub:';
		const address = labeledStrong(paragraph, 'address');
		let line = paragraph.querySelector(':scope > .rv-hub-line');
		if (!(line instanceof HTMLElement)) {
			line = paragraph.createSpan('rv-hub-line');
			if (address?.parentElement === paragraph) paragraph.insertBefore(line, address);
		}
		if (hubLabel.parentElement !== line) line.insertBefore(hubLabel, line.firstChild);
		let row = line.querySelector(':scope > .rv-hub-row');
		if (!(row instanceof HTMLElement)) {
			const stray = paragraph.querySelector(':scope > .rv-hub-row');
			row = stray instanceof HTMLElement ? stray : line.createSpan('rv-hub-row');
			if (row.parentElement !== line) line.appendChild(row);
		}
		if (!(row instanceof HTMLElement)) continue;
		if (hubLabel.textContent !== 'Hub:') hubLabel.textContent = 'Hub:';
		pinPairLabel(hubLabel);
		if (!(line instanceof HTMLElement)) continue;
		pinSharedLine(line);
		const hubs = hubRefs(readProperty(data, 'Hub')).map((hub) => resolveReturnHub(hub, host.settings.returnHubNote));
		const signature = hubs.map((hub) => `${hub.label}\u0000${hub.target}`).join('\u0001');
		const chips = row.querySelectorAll(':scope > .rv-hub-chip');
		if (row.dataset.rvHubs !== signature || chips.length !== hubs.length) {
			row.dataset.rvHubs = signature;
			row.empty();
			hubs.forEach((hub, index) => {
				row.appendChild(hubChip(paragraph.ownerDocument, path, hub, index, host));
			});
		}
		armHubOverflow(row);
		let add = line.querySelector(':scope > .rv-hub-add');
		if (!(add instanceof HTMLElement)) {
			const button = paragraph.ownerDocument.createElement('button');
			button.className = 'rv-hub-add';
			button.setAttribute('type', 'button');
			button.setAttribute('aria-label', 'Add hub');
			setIcon(button, 'plus');
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				host.addHub(path);
			});
			line.appendChild(button);
		}
		decorateAddress(paragraph, path, data, host);
	}
}

function ensureAddressInput(paragraph: HTMLElement): HTMLInputElement {
	const found = paragraph.querySelector(':scope > input.rv-address-input, :scope > .rv-address-line input.rv-address-input');
	if (found instanceof HTMLInputElement) return found;
	const created = paragraph.ownerDocument.createElement('input');
	created.className = 'rv-address-input';
	created.type = 'text';
	created.setAttribute('aria-label', 'Address');
	const map = paragraph.querySelector(':scope > a.rv-map-button, :scope > .rv-address-line > a.rv-map-button');
	if (map) paragraph.insertBefore(created, map);
	else paragraph.appendChild(created);
	return created;
}

function decorateAddress(paragraph: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	const address = labeledStrong(paragraph, 'address');
	if (!address) return;
	address.textContent = 'Address:';
	const property = host.settings.addressProperty.trim() || 'Address';
	const input = ensureAddressInput(paragraph);
	for (const child of Array.from(paragraph.childNodes)) {
		if (child === address || child === input) continue;
		if (!(child instanceof HTMLElement)) {
			if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim()) {
				const plain = paragraph.ownerDocument.createElement('span');
				plain.className = 'rv-address-hidden';
				plain.textContent = child.textContent ?? '';
				child.replaceWith(plain);
			}
			continue;
		}
		if (
			child.classList.contains('rv-hub-line')
			|| child.classList.contains('rv-address-link')
			|| child.tagName === 'STRONG'
		) {
			child.classList.remove('rv-address-hidden');
			continue;
		}
		if (child.classList.contains('rv-map-button') || child.classList.contains('rv-address-line')) {
			child.classList.remove('rv-address-hidden');
			continue;
		}
		child.classList.add('rv-address-hidden');
	}
	const stored = textOf(readProperty(data, property));
	const focused = paragraph.ownerDocument.activeElement === input;
	if (!focused) input.value = stored;
	const commit = () => host.setAddress(path, input.value);
	input.onchange = null;
	input.onkeydown = (event) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		input.blur();
	};
	input.onblur = () => {
		commit();
		showAddressLink(paragraph, input, path, host);
	};
	input.classList.add('rv-address-input');
	showAddressLink(paragraph, input, path, host);
	ensureEarthButton(paragraph, path, host);
	assembleAddressLine(paragraph);
}

/** Append these nodes only when they are not already the trailing children, in order. */
function placeTail(parent: HTMLElement, nodes: Node[]): void {
	if (nodes.length === 0) return;
	let cursor: Node | null = parent.lastChild;
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		if (cursor !== nodes[index]) {
			parent.append(...nodes);
			return;
		}
		cursor = cursor.previousSibling;
	}
}

function assembleAddressLine(paragraph: HTMLElement): void {
	const address = labeledStrong(paragraph, 'address');
	if (!address) return;
	const doc = paragraph.ownerDocument;
	let line = paragraph.querySelector(':scope > .rv-address-line');
	if (!(line instanceof HTMLElement)) {
		line = doc.createElement('span');
		line.className = 'rv-address-line';
		paragraph.appendChild(line);
	}
	if (!(line instanceof HTMLElement)) return;
	let field = line.querySelector(':scope > .rv-address-field');
	if (!(field instanceof HTMLElement)) {
		field = doc.createElement('span');
		field.className = 'rv-address-field';
	}
	if (!(field instanceof HTMLElement)) return;
	const input = paragraph.querySelector('input.rv-address-input');
	const link = paragraph.querySelector('a.rv-address-link');
	const earth = paragraph.querySelector('a.rv-map-button');
	const fieldKids: Node[] = [];
	if (input) fieldKids.push(input);
	if (link instanceof HTMLElement) fieldKids.push(link);
	placeTail(field, fieldKids);
	const lineKids: Node[] = [address, field];
	if (earth instanceof HTMLElement) lineKids.push(earth);
	placeTail(line, lineKids);
	if (!(line instanceof HTMLElement) || !(field instanceof HTMLElement)) return;
	pinSharedLine(line);
	line.style.setProperty('grid-template-rows', 'auto', 'important');
	line.style.setProperty('justify-items', 'stretch', 'important');
	line.style.setProperty('max-width', 'none', 'important');
	line.style.setProperty('min-width', '0', 'important');
	line.style.setProperty('box-sizing', 'border-box', 'important');
	address.style.setProperty('grid-column', '1', 'important');
	address.style.setProperty('grid-row', '1', 'important');
	pinPairLabel(address);
	field.style.setProperty('grid-column', '2', 'important');
	field.style.setProperty('grid-row', '1', 'important');
	field.style.setProperty('display', 'flex', 'important');
	field.style.setProperty('align-items', 'center', 'important');
	field.style.setProperty('height', '40px', 'important');
	field.style.setProperty('width', 'auto', 'important');
	field.style.setProperty('min-width', '0', 'important');
	field.style.setProperty('max-width', 'none', 'important');
	field.style.setProperty('flex', '1 1 auto', 'important');
	field.style.setProperty('position', 'static', 'important');
	field.style.setProperty('overflow', 'hidden', 'important');
	if (earth instanceof HTMLElement) {
		earth.style.setProperty('grid-column', '3', 'important');
		earth.style.setProperty('grid-row', '1', 'important');
		earth.style.setProperty('align-self', 'center', 'important');
		earth.style.setProperty('justify-self', 'center', 'important');
		earth.style.setProperty('position', 'static', 'important');
		earth.style.setProperty('inset', 'auto', 'important');
		earth.style.setProperty('transform', 'none', 'important');
		earth.style.setProperty('margin', '0', 'important');
		earth.style.setProperty('margin-top', '0', 'important');
		earth.style.setProperty('width', '40px', 'important');
		earth.style.setProperty('height', '40px', 'important');
		earth.style.setProperty('min-width', '40px', 'important');
		earth.style.setProperty('max-width', '40px', 'important');
		earth.style.setProperty('min-height', '40px', 'important');
		earth.style.setProperty('max-height', '40px', 'important');
		earth.style.setProperty('flex', '0 0 40px', 'important');
		earth.style.setProperty('z-index', '0', 'important');
	}
}

function ensureEarthButton(paragraph: HTMLElement, path: string, host: NoteChromeHost): void {
	let earth = paragraph.querySelector(':scope > a.rv-map-button, :scope > .rv-address-line > a.rv-map-button');
	if (!(earth instanceof HTMLElement)) {
		const link = paragraph.ownerDocument.createElement('a');
		link.className = 'rv-map-button';
		link.setAttribute('href', '#');
		link.setAttribute('aria-label', 'Map');
		link.setAttribute('rel', 'noopener');
		setIcon(link, 'earth');
		link.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			host.openMap(path);
		});
		paragraph.appendChild(link);
		earth = link;
	}
	if (!(earth instanceof HTMLElement)) return;
	earth.dataset.rvPath = path;
	earth.classList.toggle('is-on', host.noteMapLit ? host.noteMapLit(path) : host.mapOpen());
}

function armAddressEdit(link: HTMLElement, input: HTMLInputElement): void {
	if (link.dataset.rvEdit === '1') return;
	link.dataset.rvEdit = '1';
	const start = (): void => {
		if (!link.isConnected) return;
		link.hidden = true;
		input.hidden = false;
		link.style.setProperty('display', 'none', 'important');
		input.style.setProperty('display', 'block', 'important');
		input.focus();
		if (typeof input.select === 'function') input.select();
	};
	link.addEventListener('contextmenu', (event) => {
		event.preventDefault();
		start();
	});
	armLongPress(link, () => start());
}

/** Hub and Address share one grid so both text boxes stay the same width. */
function pinSharedPairGrid(paragraph: HTMLElement): void {
	paragraph.style.setProperty('display', 'grid', 'important');
	paragraph.style.setProperty('grid-template-columns', 'max-content minmax(0, 1fr) 40px', 'important');
	paragraph.style.setProperty('column-gap', '8px', 'important');
	paragraph.style.setProperty('row-gap', '8px', 'important');
	paragraph.style.setProperty('align-items', 'center', 'important');
	paragraph.style.setProperty('width', '100%', 'important');
}

function pinSharedLine(line: HTMLElement): void {
	line.style.setProperty('display', 'grid', 'important');
	line.style.setProperty('grid-column', '1 / -1', 'important');
	line.style.setProperty('grid-template-columns', 'subgrid', 'important');
	line.style.setProperty('column-gap', '8px', 'important');
	line.style.setProperty('align-items', 'center', 'important');
	line.style.setProperty('width', '100%', 'important');
}

function pinPairLabel(label: HTMLElement): void {
	label.style.setProperty('display', 'inline-flex', 'important');
	label.style.setProperty('align-items', 'center', 'important');
	label.style.setProperty('align-self', 'center', 'important');
	label.style.setProperty('height', '40px', 'important');
	label.style.setProperty('gap', '0', 'important');
	label.style.setProperty('width', 'max-content', 'important');
	label.style.setProperty('min-width', 'max-content', 'important');
	label.style.setProperty('justify-self', 'end', 'important');
	label.style.setProperty('justify-content', 'flex-end', 'important');
	label.style.setProperty('text-align', 'right', 'important');
	label.style.setProperty('max-width', 'none', 'important');
	label.style.setProperty('margin', '0', 'important');
	label.style.setProperty('white-space', 'nowrap', 'important');
	label.style.setProperty('font-size', '14px', 'important');
	label.style.setProperty('line-height', '1.15', 'important');
	label.style.setProperty('overflow', 'hidden', 'important');
}

function openAddress(link: HTMLElement, path: string, host: NoteChromeHost, event: Event): void {
	event.preventDefault();
	event.stopPropagation();
	if (chipHostIsPhone(link) && plainTitleTruncated(link)) {
		showTitlePopover(link, link.dataset.rvTip || link.textContent || '');
		return;
	}
	host.openMap(path);
}

function showAddressLink(paragraph: HTMLElement, input: HTMLInputElement, path: string, host: NoteChromeHost): void {
	const found = paragraph.querySelector(':scope > a.rv-address-link, :scope > .rv-address-line a.rv-address-link');
	const link = found instanceof HTMLElement ? found : paragraph.ownerDocument.createElement('a');
	if (!(found instanceof HTMLElement)) {
		link.className = 'rv-address-link';
		if (typeof input.insertAdjacentElement === 'function') input.insertAdjacentElement('afterend', link);
		else paragraph.appendChild(link);
		link.addEventListener('click', (event) => openAddress(link, path, host, event));
		armAddressEdit(link, input);
	}
	link.setAttribute('href', '#');
	link.removeAttribute('target');
	link.classList.toggle('is-on', host.mapOpen());
	link.classList.remove('rv-address-hidden');
	link.dataset.rvMapOpen = '1';
	link.onclick = (event) => openAddress(link, path, host, event);
	link.style.setProperty('display', 'block', 'important');
	link.style.setProperty('grid-column', 'auto', 'important');
	link.style.setProperty('width', '100%', 'important');
	link.style.setProperty('max-width', '100%', 'important');
	link.style.setProperty('min-width', '0', 'important');
	link.style.setProperty('position', 'static', 'important');
	link.style.setProperty('white-space', 'nowrap', 'important');
	link.style.setProperty('overflow-wrap', 'normal', 'important');
	link.style.setProperty('word-break', 'normal', 'important');
	link.style.setProperty('overflow', 'hidden', 'important');
	link.style.setProperty('text-overflow', 'ellipsis', 'important');
	link.style.setProperty('line-height', '1.25', 'important');
	link.style.removeProperty('max-height');
	link.style.setProperty('max-height', 'none', 'important');
	const text = input.value.trim();
	link.classList.toggle('is-empty', !text);
	if (link.textContent !== (text || 'Add an address')) link.textContent = text || 'Add an address';
	if (text) armHoverTooltip(link, text, { touch: false });
	const editing = paragraph.ownerDocument.activeElement === input;
	const showInput = editing || text.length === 0;
	link.hidden = showInput;
	input.hidden = !showInput;
	link.style.setProperty('display', showInput ? 'none' : 'block', 'important');
	input.style.setProperty('display', showInput ? 'block' : 'none', 'important');
}

function labeledStrong(paragraph: HTMLElement, kind: 'hub' | 'address'): HTMLElement | null {
	const nodes = paragraph.querySelectorAll('strong');
	for (const node of Array.from(nodes)) {
		if (!(node instanceof HTMLElement)) continue;
		const label = (node.textContent ?? '').replace(/:$/, '').trim().toLowerCase();
		if (kind === 'hub' ? label === 'hub' || label === 'hubs' : label === 'address') return node;
	}
	return null;
}

function fitHubOverflow(row: HTMLElement): void {
	const jobs: { node: HTMLElement; label: HTMLElement; full: string }[] = [];
	row.querySelectorAll('.rv-hub-chip').forEach((node) => {
		if (!(node instanceof HTMLElement)) return;
		const label = node.querySelector('.rv-hub-chip-label');
		if (!(label instanceof HTMLElement)) return;
		const full = label.dataset.full || label.textContent || '';
		jobs.push({ node, label, full });
	});
	const view = row.ownerDocument.defaultView;
	const widths = jobs.map((job) => job.label.clientWidth);
	const fonts = jobs.map((job) => view && typeof view.getComputedStyle === 'function' ? view.getComputedStyle(job.label).font : '');
	jobs.forEach((job, index) => {
		const label = job.label;
		const full = job.full;
		if (Number.isFinite(widths[index])) label.dataset.rvMeasureWidth = String(widths[index]);
		if (fonts[index]) label.dataset.rvMeasureFont = fonts[index] ?? '';
		fitEndEllipsis(label, full);
		job.node.classList.remove('is-overflow');
	});
}

function armHubOverflow(row: Element): void {
	if (!(row instanceof HTMLElement)) return;
	fitHubOverflow(row);
	if (row.dataset.rvHubOverflow === '1') return;
	row.dataset.rvHubOverflow = '1';
	const again = (): void => fitHubOverflow(row);
	globalThis.setTimeout(again, 0);
	if (typeof ResizeObserver === 'undefined') return;
	try {
		const observer = new ResizeObserver(again);
		observer.observe(row);
	} catch {
		/* The row is not a browser node. */
	}
}

function hubChip(doc: Document, path: string, hub: HubRef, index: number, host: NoteChromeHost): HTMLAnchorElement {
	const link = doc.createElement('a');
	link.className = 'internal-link rv-hub-chip';
	const label = doc.createElement('span');
	label.className = 'rv-hub-chip-label';
	label.textContent = hub.label;
	link.appendChild(label);
	const ellipsis = doc.createElement('span');
	ellipsis.className = 'rv-hub-chip-ellipsis';
	ellipsis.textContent = '…';
	ellipsis.setAttribute('aria-hidden', 'true');
	link.appendChild(ellipsis);
	link.href = hub.target;
	link.dataset.href = hub.target;
	armHoverTooltip(link, hub.label, { touch: false });
	link.addEventListener('click', (event) => {
		if (link.dataset.rvMenu === '1') {
			link.dataset.rvMenu = '';
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		host.openHub(path, hub.target);
	});
	const openMenu = (event: MouseEvent) => {
		if (!link.isConnected) {
			link.dataset.rvMenu = '';
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		link.dataset.rvMenu = '1';
		const menu = new Menu();
		menu.addItem((item) => {
			const named = item.setTitle(hub.label) as { setDisabled?: (disabled: boolean) => void };
			named.setDisabled?.(true);
		});
		if (index > 0) {
			menu.addItem((item) => {
				item.setTitle('Move Left');
				item.setIcon('chevrons-left');
				item.onClick(() => host.moveHub(path, hub.label));
			});
		}
		menu.addItem((item) => {
			item.setTitle('Remove');
			item.setIcon('trash');
			item.onClick(() => host.removeHub(path, hub.label));
		});
		menu.addItem((item) => {
			item.setTitle('Add a Hub');
			item.setIcon('plus');
			item.onClick(() => host.addHub(path));
		});
		const fromTouch = eventPointerType(event) === 'touch' || link.dataset.rvTouch === '1';
		if (fromTouch) {
			link.dataset.rvTouch = '';
			keepHubMenuAfterTouch(link);
		}
		menu.showAtMouseEvent(event);
		window.setTimeout(() => { link.dataset.rvMenu = ''; }, 400);
	};
	link.addEventListener('pointerdown', (event) => {
		if (event.pointerType === 'touch') link.dataset.rvTouch = '1';
	});
	link.addEventListener('pointerup', (event) => {
		if (event.pointerType === 'touch') link.dataset.rvTouch = '';
	});
	link.addEventListener('pointercancel', () => { link.dataset.rvTouch = ''; });
	link.addEventListener('contextmenu', openMenu);
	armLongPress(link, (event) => openMenu(event));
	return link;
}

function decorateSlotOverride(root: HTMLElement, path: string, data: Record<string, unknown>, host: NoteChromeHost): void {
	const callouts = root.matches('.callout') ? [root] : Array.from(root.querySelectorAll('.callout'));
	for (const callout of callouts) {
		if (!(callout instanceof HTMLElement)) continue;
		const title = callout.querySelector(':scope > .callout-title');
		if (!(title instanceof HTMLElement)) continue;
		const inner = title.querySelector('.callout-title-inner');
		const label = (inner?.textContent ?? title.textContent ?? '');
		if (!isLogCalloutTitle(label)) continue;
		const priority = finiteNumber(readProperty(data, 'Priority'));
		const urgency = noteUrgency(path, data, priority, host);
		const colors = urgencyColorsFor(host.settings.urgencyPalette, host.settings.urgencyCustomColors);
		const accent = host.ghostIcon(path) === 'moon' ? SNOOZE_SLATE : urgencyAccentColor(urgency, priority, colors);
		callout.style.setProperty('--rv-urgency-accent', accent);
		let badges = title.querySelector(':scope > .rv-qf-badges');
		if (!(badges instanceof HTMLElement)) badges = title.createSpan('rv-qf-badges');
		const button = badges.querySelector(':scope > button.rv-attempt-override');
		if (!(button instanceof HTMLElement)) {
			badges.empty();
			const created = badges.createEl('button', {
				cls: 'rv-locator-urgency rv-attempt-override',
				attr: { type: 'button', 'aria-label': 'Mark a daypart Try or Avoid' },
			});
			setIcon(created, 'calendar-plus-2');
			created.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				host.openSlotOverride(path);
			});
		}
	}
}

function propertyDays(value: unknown): number | null {
	const raw = dateTextFromUnknown(value);
	return raw ? calendarDaysSince(raw, new Date()) : null;
}

function noteUrgency(path: string, data: Record<string, unknown>, priority: number | null, host: NoteChromeHost): number | null {
	const spoke = propertyDays(readProperty(data, 'Last Spoke'));
	const attempted = propertyDays(readProperty(data, 'Last Attempted'));
	const known = [spoke, attempted].filter((day): day is number => day != null);
	const days = known.length === 0 ? null : Math.min(...known);
	return displayedUrgency(days, priority, host.settings, host.snoozeUntil(path), new Date());
}

function textList(value: unknown): string[] {
	const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
	const names: string[] = [];
	for (const item of source) {
		const text = wikiLabel(textOf(item));
		if (text) names.push(text);
	}
	return names;
}

function wikiLabel(text: string): string {
	const raw = text.replace(/^["']|["']$/g, '').trim();
	const wiki = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(raw);
	if (!wiki) return raw;
	const alias = wiki[2]?.trim();
	if (alias) return alias;
	const target = (wiki[1] ?? raw).trim();
	return (target.split('/').pop() ?? target).replace(/\.md$/i, '');
}

function textOf(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (Array.isArray(value)) return value.map((item) => textOf(item)).filter(Boolean).join(' · ');
	return '';
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
	return null;
}
