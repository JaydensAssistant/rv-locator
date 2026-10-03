import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { campaignIsActive, isCovered, sanitizeCampaign, withCovered } from '../src/campaign';
import { hubRefs, moveHubLeft, resolveReturnHub } from '../src/hub-row';
import { pagePreviewDecision } from '../src/page-preview';
import { cardReturnLead, currentReturnBucket, defaultAvailabilityGrid, suggestReturnDigest } from '../src/schedule';
import { nextCampaignListFilter } from '../src/status';
import { urgencyBangShapes, urgencyMark } from '../src/scoring';
import { resetSettingsTab } from '../src/settings-reset';
import { formatSlotOverride, parseSlotOverrides, upsertSlotOverride } from '../src/slot-override';
import { layoutTakenNames } from '../src/taken-row';
import { DEFAULT_SETTINGS, attemptLogFullWidth, mergeSettings } from '../src/types';
import { layoutVisitNotes, partitionVisits, type VisitStampRef } from '../src/visit-display';
import { refreshHomeStampAges, restoreExactVisitClocks } from '../src/visit-log';
import { createDoc, type DomEl } from './visit-dom';

describe('1.3.5 dogfood helpers', () => {
	it('draws a dash for an archived priority and cycles the campaign list', () => {
		assert.equal(urgencyMark(3, 0).glyphs, '—');
		assert.equal(urgencyBangShapes('—')[0]?.kind, 'rect');
		assert.equal(nextCampaignListFilter('all'), 'uncovered');
		assert.equal(nextCampaignListFilter('uncovered'), 'covered');
		assert.equal(nextCampaignListFilter('covered'), 'all');
		assert.equal(cardReturnLead(new Date(2026, 9, 2, 15, 4)), 'Friday afternoon — ');
		assert.deepEqual(resolveReturnHub({ target: 'Return Visits Hub', label: 'Return Visits Hub' }, 'Ministry Hub'), {
			target: 'Ministry Hub',
			label: 'Ministry Hub',
		});
		assert.deepEqual(resolveReturnHub({ target: 'North', label: 'North' }, 'Ministry Hub'), {
			target: 'North',
			label: 'North',
		});
	});
});

describe('1.3.5 hub row', () => {
	it('keeps every hub and moves one left without rewriting the first', () => {
		const hubs = hubRefs(['[[North]]', '[[East|East hub]]', 'South']);
		assert.deepEqual(hubs.map((hub) => hub.label), ['North', 'East hub', 'South']);
		assert.equal(moveHubLeft(hubs.map((hub) => `[[${hub.target}]]`), 'North'), null);
		const moved = moveHubLeft(['[[North]]', '[[East]]', '[[South]]'], 'South');
		assert.deepEqual(moved, ['[[North]]', '[[South]]', '[[East]]']);
	});
});

describe('1.3.5 taken row', () => {
	it('pins Met With and the latest Taken name', () => {
		const layout = layoutTakenNames(['Ada', 'Bo', 'Cy'], 'Ada');
		assert.equal(layout.met, 'Ada');
		assert.deepEqual(layout.scroll, ['Bo']);
		assert.equal(layout.recent, 'Cy');
		const same = layoutTakenNames(['Ada'], 'Ada');
		assert.equal(same.met, 'Ada');
		assert.equal(same.recent, null);
		assert.deepEqual(same.scroll, []);
	});
});

describe('1.3.5 campaign', () => {
	it('is active only inside its dates and records one path once', () => {
		const saved = sanitizeCampaign({ name: 'Spring', start: '2026-10-01', end: '2026-10-03', covered: ['a.md', 'a.md'] });
		assert.equal(campaignIsActive(saved, '2026-10-02'), true);
		assert.equal(campaignIsActive(saved, '2026-10-04'), false);
		assert.equal(campaignIsActive(saved, '2026-09-30'), false);
		const covered = withCovered(saved!, 'b.md');
		assert.equal(isCovered(covered, 'a.md'), true);
		assert.equal(isCovered(covered, 'b.md'), true);
		assert.equal(withCovered(covered, 'b.md'), covered);
	});
});

describe('1.3.5 slot override', () => {
	it('parses a daypart mark and lets it win the current bucket', () => {
		const parsed = parseSlotOverrides(['Tue evening: Avoid', 'nope', 'Monday mor: Try', 'Fri aft Avoid']);
		assert.deepEqual(parsed, [
			{ weekday: 2, daypart: 'evening', bucket: 'avoid' },
			{ weekday: 1, daypart: 'morning', bucket: 'try' },
			{ weekday: 5, daypart: 'afternoon', bucket: 'avoid' },
		]);
		assert.equal(formatSlotOverride(parsed[0]!), 'Tue evening Avoid');
		const fromYaml = parseSlotOverrides([{ 'Tue evening': 'Avoid' }, { 'Monday mor': 'Try' }]);
		assert.deepEqual(fromYaml, parsed.slice(0, 2));
		const grid = defaultAvailabilityGrid();
		grid['2:evening'] = 'may';
		const bucket = currentReturnBucket({
			buckets: { '2:evening': { homes: 2, trials: 2 } },
			grid,
			overrides: parsed,
			now: new Date(2026, 9, 6, 18, 0, 0),
		});
		assert.equal(bucket, 'Avoid');
		assert.equal(upsertSlotOverride(parsed, { weekday: 2, daypart: 'evening', bucket: 'try' }).at(-1)?.bucket, 'try');
		const forced = suggestReturnDigest({
			buckets: { '2:evening': { homes: 2, trials: 3 } },
			grid,
			overrides: [{ weekday: 2, daypart: 'evening', bucket: 'avoid' }],
		});
		assert.equal(forced.sentences.some((line) => line.startsWith('- Try:') && line.includes('Tue evening')), false);
		assert.match(forced.sentences.join('\n'), /^- Avoid: \*\*Tue evening \(2\/3\)\*\*/m);
		const flipped = suggestReturnDigest({
			buckets: { '2:evening': { homes: 0, trials: 4 } },
			grid,
			overrides: [{ weekday: 2, daypart: 'evening', bucket: 'try' }],
		});
		assert.match(flipped.sentences.join('\n'), /^- Try: \*\*Tue evening \(0\/4\)\*\*/m);
		assert.equal(flipped.sentences.some((line) => line.startsWith('- Avoid:')), false);
	});
});

describe('1.3.5 visit display order', () => {
	it('shows the newest visits and parks the rest without changing file order', () => {
		const stamps: VisitStampRef[] = [
			{ text: 'first', when: 1, fileIndex: 0 },
			{ text: 'second', when: 2, fileIndex: 1 },
			{ text: 'third', when: 3, fileIndex: 2 },
			{ text: 'fourth', when: 4, fileIndex: 3 },
		];
		const newest = partitionVisits(stamps, true, true, 3);
		assert.deepEqual(newest.visible.map((item) => item.text), ['fourth', 'third', 'second']);
		assert.deepEqual(newest.older.map((item) => item.text), ['first']);
		const oldest = partitionVisits(stamps, false, false, 3);
		assert.deepEqual(oldest.visible.map((item) => item.text), ['first', 'second', 'third', 'fourth']);
		assert.deepEqual(oldest.older, []);
	});

	it('keeps file order and collapses the rest under Older Visits', () => {
		const stamps = [
			'Mon, 9am — Sep 1, 2026',
			'Tue, 2pm — Sep 2, 2026',
			'Wed, 3pm — Sep 3, 2026',
			'Thu, 4pm — Sep 4, 2026',
		];
		const markdown = stamps.map((stamp) => `##### ${stamp}`).join('\n');
		const flat = visitTree(stamps, 'flat');
		layoutVisitNotes(flat.preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		assert.equal(markdown, stamps.map((stamp) => `##### ${stamp}`).join('\n'));
		assertOlderVisits(flat.sizer, ['Mon, 9am', 'Tue, 2pm', 'Wed, 3pm'], 'Thu, 4pm');

		const wrapped = visitTree(stamps, 'wrapped');
		layoutVisitNotes(wrapped.preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		assertOlderVisits(wrapped.sizer, ['Mon, 9am', 'Tue, 2pm', 'Wed, 3pm'], 'Thu, 4pm');
		const heading = wrapped.sizer.querySelector('h2');
		assert.ok(heading);
		heading.click();
		const older = wrapped.sizer.children.find((node) => (node.textContent ?? '').includes('Thu, 4pm'));
		assert.equal(older?.classList.contains('rv-older-hidden'), false);
		heading.click();
		assert.equal(wrapped.sizer.querySelector('h2')?.textContent, 'Older Visits');
		assert.equal(older?.classList.contains('rv-older-hidden'), true);
		assert.equal(heading.classList.contains('is-collapsed'), false);
	});

	it('keeps Visit Notes above the stamps when a rule precedes that heading', () => {
		const stamps = [
			'Mon, 9am — Sep 1, 2026',
			'Tue, 2pm — Sep 2, 2026',
			'Wed, 3pm — Sep 3, 2026',
			'Thu, 4pm — Sep 4, 2026',
		];
		const markdown = `### Visit Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`;
		for (const shape of ['flat', 'wrapped'] as const) {
			const tree = visitTree(stamps, shape, true);
			layoutVisitNotes(tree.preview as unknown as HTMLElement, markdown, {
				newestFirst: true,
				collapseOlder: true,
				limit: 3,
			});
			assert.equal(markdown, `### Visit Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`);
			assertVisitNotesStaysAbove(tree.sizer, ['Mon, 9am', 'Tue, 2pm', 'Wed, 3pm']);
		}
	});
});

describe('exact clocks on stamps already in the note', () => {
	it('rewrites an hour-only stamp from Last Spoke and from a paired Attempt Log line', () => {
		const note = [
			'##### Tue, 10am — Sep 29, 2026',
			'> - Tue, 10am — Sep 29, 2026 — success',
			'##### Wed, 1am — Sep 30, 2026 <span class="rv-stamp-ago">Today</span>',
			'> - Wed, 1:17am — Sep 30, 2026 — not home',
			'##### Wed, 3am — Oct 1, 2026',
		].join('\n');
		const next = restoreExactVisitClocks(note, { 'Last Spoke': '2026-09-29T10:07:00' });
		assert.equal(next.includes('Tue, 10am'), false);
		assert.equal(next.includes('Tue, 10:07am — Sep 29, 2026'), true);
		assert.equal(next.includes('Wed, 1am'), false);
		assert.equal(next.includes('Wed, 1:17am — Sep 30, 2026'), true);
		assert.equal(next.includes('##### Wed, 3am — Oct 1, 2026'), true);
		const aged = refreshHomeStampAges(note, new Date(2026, 8, 30, 8, 0, 0));
		assert.equal(aged.includes('Wed, 1:17am — Sep 30, 2026'), true);
		assert.equal(aged.includes('Wed, 3am — Oct 1, 2026'), true);
	});

	it('leaves an hour-only stamp alone when two minutes would round to it', () => {
		const note = '##### Tue, 10am — Sep 29, 2026';
		const next = restoreExactVisitClocks(note, {
			'Last Spoke': '2026-09-29T10:07:00',
			'Last Attempted': '2026-09-29T10:21:00',
		});
		assert.equal(next, note);
	});
});

describe('1.3.5 page preview', () => {
	it('blocks dashboard hovers until the setting is on, then uses the core preview source', () => {
		assert.deepEqual(pagePreviewDecision(false, true), { inScope: true, suppress: true, open: false });
		assert.deepEqual(pagePreviewDecision(true, true), { inScope: true, suppress: true, open: true });
		assert.deepEqual(pagePreviewDecision(true, false), { inScope: false, suppress: false, open: false });
	});
});

function visitTree(stamps: readonly string[], shape: 'flat' | 'wrapped', leadingRule = false): { preview: DomEl; sizer: DomEl } {
	const doc = createDoc();
	const preview = doc.createElement('div');
	preview.className = 'markdown-preview-view';
	const sizer = doc.createElement('div');
	sizer.className = 'markdown-preview-section';
	preview.appendChild(sizer);
	if (leadingRule) {
		const lead = doc.createElement('hr');
		const notes = doc.createElement('h3');
		notes.textContent = 'Visit Notes:';
		if (shape === 'flat') {
			sizer.appendChild(lead);
			sizer.appendChild(notes);
		} else {
			const leadWrap = doc.createElement('div');
			leadWrap.appendChild(lead);
			const notesWrap = doc.createElement('div');
			notesWrap.appendChild(notes);
			sizer.appendChild(leadWrap);
			sizer.appendChild(notesWrap);
		}
	}
	for (const stamp of stamps) {
		const heading = doc.createElement('h3');
		heading.className = 'rv-visit-stamp';
		heading.textContent = stamp;
		const ago = doc.createElement('span');
		ago.className = 'rv-stamp-ago';
		ago.textContent = 'Today';
		heading.appendChild(ago);
		const note = doc.createElement('p');
		note.textContent = stamp;
		if (shape === 'flat') {
			sizer.appendChild(heading);
			sizer.appendChild(note);
		} else {
			const headWrap = doc.createElement('div');
			headWrap.appendChild(heading);
			const noteWrap = doc.createElement('div');
			noteWrap.appendChild(note);
			sizer.appendChild(headWrap);
			sizer.appendChild(noteWrap);
		}
	}
	const rule = doc.createElement('hr');
	const callout = doc.createElement('div');
	callout.className = 'callout';
	const title = doc.createElement('div');
	title.className = 'callout-title';
	title.textContent = 'Return Suggestions';
	callout.appendChild(title);
	if (shape === 'flat') {
		sizer.appendChild(rule);
		sizer.appendChild(callout);
	} else {
		const ruleWrap = doc.createElement('div');
		ruleWrap.appendChild(rule);
		sizer.appendChild(ruleWrap);
		sizer.appendChild(callout);
	}
	return { preview, sizer };
}

function assertOlderVisits(sizer: DomEl, visible: readonly string[], older: string): void {
	const heading = sizer.querySelector('h2');
	assert.equal(heading?.tagName, 'H2');
	assert.equal(heading?.textContent, 'Older Visits');
	assert.equal(heading?.classList.contains('rv-older-visits'), true);
	assert.equal(heading?.classList.contains('callout'), false);
	assert.equal(heading?.classList.contains('is-collapsed'), false);
	assert.ok(heading?.querySelector('.collapse-indicator'));
	assert.equal(heading?.querySelector('svg')?.getAttribute('class'), 'svg-icon lucide-chevron-right');
	assert.equal(heading?.querySelector('path')?.getAttribute('d'), 'm9 18 6-6-6-6');
	const rule = heading?.parentElement?.children[heading.parentElement.children.indexOf(heading) - 1];
	assert.equal(rule?.tagName, 'HR');
	assert.equal(rule?.classList.contains('rv-older-rule'), true);
	const labels = sizer.children.map((node) => node.textContent ?? '');
	const headingAt = labels.indexOf('Older Visits');
	assert.ok(headingAt > 0);
	for (const stamp of visible) {
		const at = labels.findIndex((label) => label.includes(stamp));
		assert.ok(at >= 0 && at < headingAt, stamp);
		const node = sizer.children[at];
		assert.equal(node?.classList.contains('rv-older-hidden'), false);
	}
	const olderAt = labels.findIndex((label) => label.includes(older));
	assert.ok(olderAt > headingAt);
	assert.equal(sizer.children[olderAt]?.classList.contains('rv-older-hidden'), true);
	const suggestions = labels.findIndex((label) => label.includes('Return Suggestions'));
	assert.ok(suggestions > olderAt);
}

function assertVisitNotesStaysAbove(sizer: DomEl, visible: readonly string[]): void {
	const labels = sizer.children.map((node) => node.textContent ?? '');
	const notesAt = labels.findIndex((label) => /^visit notes:?$/i.test(label.trim()));
	const olderAt = labels.indexOf('Older Visits');
	const firstStamp = visible
		.map((stamp) => labels.findIndex((label) => label.includes(stamp)))
		.filter((at) => at >= 0)
		.sort((a, b) => a - b)[0];
	assert.ok(notesAt >= 0);
	assert.ok(firstStamp != null && notesAt < firstStamp);
	assert.ok(olderAt > notesAt);
	const lead = sizer.children.slice(0, notesAt).find((node) => node.tagName === 'HR' || node.querySelector('hr'));
	assert.ok(lead);
	assert.equal(lead.classList.contains('rv-older-rule'), false);
	const afterOlder = sizer.children.slice(olderAt + 1);
	const trailing = afterOlder.find((node) => (node.tagName === 'HR' || node.querySelector('hr')) && !node.classList.contains('rv-older-rule'));
	assert.ok(trailing);
	assert.ok(sizer.children.indexOf(trailing) > olderAt);
}

describe('1.3.5 settings reset', () => {
	it('resets one tab and leaves the API key and the other tabs', () => {
		const current = mergeSettings({
			geoapifyApiKey: 'secret',
			geoapifyRegion: 'eu',
			wideQuickFacts: false,
			urgencyPalette: 'pink',
			distanceUnit: 'kilometers',
			newRvTemplateFile: 'Custom.md',
		});
		const everyday = resetSettingsTab(current, 'everyday');
		assert.equal(everyday.geoapifyApiKey, 'secret');
		assert.equal(everyday.geoapifyRegion, 'global');
		assert.equal(everyday.wideQuickFacts, true);
		assert.equal(everyday.urgencyPalette, 'pink');
		assert.equal(everyday.distanceUnit, 'kilometers');
		const urgency = resetSettingsTab(current, 'urgency');
		assert.equal(urgency.urgencyPalette, DEFAULT_SETTINGS.urgencyPalette);
		assert.equal(urgency.geoapifyRegion, 'eu');
		assert.equal(urgency.distanceUnit, 'kilometers');
		const nearby = resetSettingsTab(current, 'nearby');
		assert.equal(nearby.distanceUnit, 'miles');
		assert.equal(nearby.newRvTemplateFile, 'Custom.md');
		assert.equal(attemptLogFullWidth(mergeSettings({ attemptLogWidth: 'auto', digestOrientation: 'rows' })), true);
	});
});
