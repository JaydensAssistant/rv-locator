import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { campaignIsActive, isCovered, sanitizeCampaign, withCovered } from '../src/campaign';
import { hubRefs, moveHubLeft, resolveReturnHub } from '../src/hub-row';
import { pagePreviewDecision } from '../src/page-preview';
import { cardPersonTitle } from '../src/note-name';
import { coveragePronoun, coverageQuestion } from '../src/modals';
import { cardReturnLead, currentReturnBucket, defaultAvailabilityGrid, stampDateTime, suggestReturnDigest } from '../src/schedule';
import { nextCampaignListFilter } from '../src/status';
import { urgencyBangShapes, urgencyMark } from '../src/scoring';
import { resetSettingsTab } from '../src/settings-reset';
import { formatSlotOverride, parseSlotOverrides, upsertSlotOverride } from '../src/slot-override';
import { lastListEntries, layoutTakenNames } from '../src/taken-row';
import { pickDayJump } from '../src/day-jump';
import { visibleStampText } from '../src/dates';
import { DEFAULT_SETTINGS, attemptLogFullWidth, mergeSettings } from '../src/types';
import { concealCollapsedVisitNotes, layoutVisitNotes, partitionVisits, type VisitStampRef } from '../src/visit-display';
import { refreshHomeStampAges, restoreExactVisitClocks } from '../src/visit-log';
import { createDoc, type DomEl } from './visit-dom';

describe('1.3.5 dogfood helpers', () => {
	it('draws a dash for an archived priority and cycles the campaign list', () => {
		assert.equal(urgencyMark(3, 0).glyphs, '—');
		assert.equal(urgencyBangShapes('—')[0]?.kind, 'rect');
		assert.equal(nextCampaignListFilter('all'), 'uncovered');
		assert.equal(nextCampaignListFilter('uncovered'), 'covered');
		assert.equal(nextCampaignListFilter('covered'), 'all');
		assert.equal(cardPersonTitle('Ada on Maple Street', true), 'Ada');
		assert.equal(cardPersonTitle('Ada on Maple Street 2026-10-03', true), 'Ada');
		assert.equal(cardPersonTitle('Man on Maple Street', true), 'Man');
		assert.equal(cardPersonTitle('Maple Street', true), 'Maple Street');
		assert.equal(cardPersonTitle('Ada on Maple Street', false), 'Ada on Maple Street');
		assert.equal(coveragePronoun('Woman'), 'her');
		assert.equal(coveragePronoun('Man'), 'him');
		assert.equal(coveragePronoun(''), 'them');
		assert.equal(coverageQuestion('her', 'Spring'), 'Did you cover her with the Spring campaign?');
		assert.equal(cardReturnLead(new Date(2026, 9, 2, 15, 4)), 'Fri aft');
		assert.equal(cardReturnLead(new Date(2026, 9, 3, 9, 0), 'short'), 'Sat mor');
		assert.equal(cardReturnLead(new Date(2026, 9, 2, 15, 4), 'long'), 'Friday afternoon — ');
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
		assert.deepEqual(lastListEntries(['Ada', 'Bo', 'Cy', 'Dale', 'Eve']), ['Cy', 'Dale', 'Eve']);
		assert.deepEqual(lastListEntries(['Ada', 'Bo']), ['Ada', 'Bo']);
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
			{ weekday: 2, daypart: 'evening', bucket: 'avoid', reason: '' },
			{ weekday: 1, daypart: 'morning', bucket: 'try', reason: '' },
			{ weekday: 5, daypart: 'afternoon', bucket: 'avoid', reason: '' },
		]);
		assert.equal(formatSlotOverride(parsed[0]!), 'Tue evening Avoid');
		assert.equal(formatSlotOverride({ weekday: 2, daypart: 'evening', bucket: 'avoid', reason: 'Works then' }), 'Tue evening Avoid — Works then');
		assert.equal(parseSlotOverrides(['Tue evening Avoid — Works then'])[0]?.reason, 'Works then');
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
		const heading = wrapped.sizer.querySelector('h3.rv-older-visits');
		assert.ok(heading);
		heading.click();
		const older = wrapped.sizer.children.find((node) => (node.textContent ?? '').includes('Thu, 4pm'));
		assert.equal(older?.classList.contains('rv-older-hidden'), false);
		heading.click();
		assert.equal(wrapped.sizer.querySelector('h3.rv-older-visits')?.textContent, 'Older Visits');
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

	it('keeps Older Visits after Recent Notes collapses and reopens', async () => {
		const stamps = [
			'Mon, 9am — Sep 1, 2026',
			'Tue, 2pm — Sep 2, 2026',
			'Wed, 3pm — Sep 3, 2026',
			'Thu, 4pm — Sep 4, 2026',
		];
		const markdown = `### Recent Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`;
		const tree = visitTree(stamps, 'flat');
		const doc = tree.preview.ownerDocument;
		const wrap = doc.createElement('div');
		wrap.className = 'el-h3';
		const notes = doc.createElement('h3');
		notes.textContent = 'Recent Notes:';
		const mark = doc.createElement('span');
		mark.className = 'collapse-indicator collapse-icon';
		const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('class', 'svg-icon lucide-chevron-down');
		const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', 'M3 8L12 17L21 8');
		svg.appendChild(path);
		mark.appendChild(svg);
		notes.appendChild(mark);
		wrap.appendChild(notes);
		tree.sizer.insertBefore(wrap, tree.sizer.children[0] ?? null);
		layoutVisitNotes(tree.preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		assertOlderVisits(tree.sizer, ['Mon, 9am', 'Tue, 2pm', 'Wed, 3pm'], 'Thu, 4pm');
		assert.equal(notes.querySelector('path')?.getAttribute('d'), 'm9 18 6-6-6-6');
		assert.equal(notes.classList.contains('is-open'), true);
		assert.equal(svg.parentElement, null);
		tree.preview.querySelectorAll('.rv-older-visits, .rv-older-rule').forEach((node) => node.remove());
		tree.preview.querySelectorAll('.rv-older-visit').forEach((node) => {
			node.classList.remove('rv-older-visit', 'rv-older-hidden');
		});
		wrap.classList.add('is-collapsed');
		notes.click();
		assert.equal(notes.classList.contains('is-open'), false);
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.ok(tree.sizer.querySelector('h3.rv-older-visits'));
		assert.equal(tree.sizer.querySelector('.callout')?.textContent?.includes('Return Suggestions'), true);
		wrap.classList.remove('is-collapsed');
		notes.click();
		await new Promise((resolve) => setTimeout(resolve, 150));
		assertOlderVisits(tree.sizer, ['Mon, 9am', 'Tue, 2pm', 'Wed, 3pm'], 'Thu, 4pm');
		assert.equal(notes.classList.contains('is-open'), true);
		assert.equal(notes.querySelector('path')?.getAttribute('d'), 'm9 18 6-6-6-6');
		assert.equal(markdown, `### Recent Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`);
	});

	it('keeps Older Visits and Return Suggestions when collapse removes the tail', async () => {
		const stamps = [
			'Mon, 9am — Sep 1, 2026',
			'Tue, 2pm — Sep 2, 2026',
			'Wed, 3pm — Sep 3, 2026',
			'Thu, 4pm — Sep 4, 2026',
		];
		const markdown = `### Recent Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`;
		const tree = visitTree(stamps, 'flat');
		const doc = tree.preview.ownerDocument;
		const wrap = doc.createElement('div');
		wrap.className = 'el-h3';
		const notes = doc.createElement('h3');
		notes.textContent = 'Recent Notes:';
		wrap.appendChild(notes);
		tree.sizer.insertBefore(wrap, tree.sizer.children[0] ?? null);
		const footer = doc.createElement('div');
		footer.className = 'mod-footer';
		tree.sizer.appendChild(footer);
		layoutVisitNotes(tree.preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		assertOlderVisits(tree.sizer, ['Mon, 9am', 'Tue, 2pm', 'Wed, 3pm'], 'Thu, 4pm');
		let cursor = wrap.nextElementSibling;
		while (cursor && cursor !== footer) {
			const next = cursor.nextElementSibling;
			cursor.remove();
			cursor = next;
		}
		assert.equal(wrap.nextElementSibling, footer);
		wrap.classList.add('is-collapsed');
		notes.click();
		await new Promise((resolve) => setTimeout(resolve, 150));
		const older = tree.sizer.querySelector('h3.rv-older-visits');
		const suggestions = tree.sizer.querySelector('.callout');
		assert.equal(older?.textContent, 'Older Visits');
		assert.equal(older?.parentElement != null, true);
		assert.equal(suggestions?.textContent?.includes('Return Suggestions'), true);
		assert.equal(suggestions?.parentElement != null, true);
		assert.notEqual(wrap.nextElementSibling, footer);
		assert.ok(tree.sizer.children.indexOf(footer) > tree.sizer.children.indexOf(older?.parentElement as DomEl));
		assert.equal(tree.sizer.querySelectorAll('h3.rv-older-visits').length, 1);
		assert.equal(tree.sizer.querySelectorAll('.callout').length, 1);
		const olderBody = tree.sizer.children.find((node) => (node.textContent ?? '').includes('Thu, 4pm'));
		assert.ok(olderBody);
		assert.ok(tree.sizer.children.indexOf(olderBody) < tree.sizer.children.indexOf(footer));
		wrap.classList.remove('is-collapsed');
		notes.click();
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.equal(tree.sizer.querySelectorAll('h3.rv-older-visits').length, 1);
		assert.equal(tree.sizer.querySelectorAll('.callout').length, 1);
		assert.equal(tree.sizer.querySelector('.callout')?.textContent?.includes('Return Suggestions'), true);
		assert.equal(markdown, `### Recent Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`);
	});

	it('gives an empty Older Visits stop a heading so the fold can end', () => {
		const stamps = ['Mon, 9am — Sep 1, 2026'];
		const markdown = `### Recent Notes:\n##### ${stamps[0]}`;
		const tree = visitTree(stamps, 'flat');
		layoutVisitNotes(tree.preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		const stop = tree.sizer.querySelector('.rv-notes-fold-stop');
		assert.equal(stop?.classList.contains('el-h3'), true);
		assert.equal(stop?.children[0]?.tagName, 'H3');
		assert.equal(tree.sizer.querySelector('.callout')?.textContent?.includes('Return Suggestions'), true);
	});

	it('hides folded visit text areas even when center-notes forces display block', () => {
		const css = readFileSync('styles.css', 'utf8');
		assert.match(css, /\.rv-visit-folded,[\s\S]*display:\s*none\s*!important/);
		assert.match(css, /\.rv-dashboard :is\(\.el-h3, \.el-h5\)\.is-collapsed \+ :is\(\.el-p, \.el-div, p\):has\(textarea, \.mb-input\)/);
		assert.match(css, /\.rv-dashboard \.cm-line:has\(\.cm-foldPlaceholder\) \+ \.cm-line:has\(textarea, \.mb-input\)/);
		assert.match(css, /body\.rv-center-visit-notes \.rv-dashboard \.rv-older-hidden:is\(p, \.el-p\):has\(textarea\)/);
	});

	it('hides text areas under a collapsed visit heading and shows them again when it opens', () => {
		const doc = createDoc();
		const preview = doc.createElement('div');
		preview.className = 'markdown-preview-view rv-dashboard';
		const sizer = doc.createElement('div');
		sizer.className = 'markdown-preview-section';
		preview.appendChild(sizer);
		const olderWrap = doc.createElement('div');
		olderWrap.className = 'el-h5 is-collapsed';
		const older = doc.createElement('h5');
		older.className = 'rv-visit-stamp';
		older.textContent = 'Mon, 9am — Sep 1, 2026';
		olderWrap.appendChild(older);
		const olderNotes = doc.createElement('div');
		olderNotes.className = 'el-p';
		const olderArea = doc.createElement('textarea');
		olderNotes.appendChild(olderArea);
		const latestWrap = doc.createElement('div');
		latestWrap.className = 'el-h5';
		const latest = doc.createElement('h5');
		latest.className = 'rv-visit-stamp';
		latest.textContent = 'Thu, 4pm — Sep 4, 2026';
		latestWrap.appendChild(latest);
		const latestNotes = doc.createElement('div');
		latestNotes.className = 'el-p';
		const latestArea = doc.createElement('textarea');
		latestNotes.appendChild(latestArea);
		sizer.appendChild(olderWrap);
		sizer.appendChild(olderNotes);
		sizer.appendChild(latestWrap);
		sizer.appendChild(latestNotes);
		concealCollapsedVisitNotes(preview as unknown as HTMLElement);
		assert.equal(olderNotes.classList.contains('rv-visit-folded'), true);
		assert.equal(latestNotes.classList.contains('rv-visit-folded'), false);
		assert.equal(olderWrap.classList.contains('rv-visit-folded'), false);
		const late = doc.createElement('div');
		late.className = 'el-p';
		late.appendChild(doc.createElement('textarea'));
		sizer.insertBefore(late, latestWrap);
		concealCollapsedVisitNotes(preview as unknown as HTMLElement);
		assert.equal(late.classList.contains('rv-visit-folded'), true);
		olderWrap.classList.remove('is-collapsed');
		concealCollapsedVisitNotes(preview as unknown as HTMLElement);
		assert.equal(olderNotes.classList.contains('rv-visit-folded'), false);
		assert.equal(late.classList.contains('rv-visit-folded'), false);
		assert.equal(latestNotes.classList.contains('rv-visit-folded'), false);
	});

	it('hides the next Live Preview line when that visit heading is folded', () => {
		const doc = createDoc();
		const preview = doc.createElement('div');
		preview.className = 'markdown-source-view rv-dashboard';
		const older = doc.createElement('div');
		older.className = 'cm-line HyperMD-header HyperMD-header-5';
		older.textContent = '##### Mon, 9am — Sep 1, 2026';
		const fold = doc.createElement('span');
		fold.className = 'cm-foldPlaceholder';
		older.appendChild(fold);
		const olderLine = doc.createElement('div');
		olderLine.className = 'cm-line';
		olderLine.appendChild(doc.createElement('textarea'));
		const latest = doc.createElement('div');
		latest.className = 'cm-line HyperMD-header HyperMD-header-5';
		latest.textContent = '##### Thu, 4pm — Sep 4, 2026';
		const latestLine = doc.createElement('div');
		latestLine.className = 'cm-line';
		latestLine.appendChild(doc.createElement('textarea'));
		preview.appendChild(older);
		preview.appendChild(olderLine);
		preview.appendChild(latest);
		preview.appendChild(latestLine);
		concealCollapsedVisitNotes(preview as unknown as HTMLElement);
		assert.equal(olderLine.classList.contains('rv-visit-folded'), true);
		assert.equal(latestLine.classList.contains('rv-visit-folded'), false);
		fold.remove();
		concealCollapsedVisitNotes(preview as unknown as HTMLElement);
		assert.equal(olderLine.classList.contains('rv-visit-folded'), false);
	});

	it('collapses older Live Preview visits under Older Visits and hides their text areas', () => {
		const stamps = [
			'Mon, 9am — Sep 1, 2026',
			'Tue, 2pm — Sep 2, 2026',
			'Wed, 3pm — Sep 3, 2026',
			'Thu, 4pm — Sep 4, 2026',
		];
		const markdown = stamps.map((stamp) => `##### ${stamp}`).join('\n');
		const doc = createDoc();
		const preview = doc.createElement('div');
		preview.className = 'markdown-source-view';
		const content = doc.createElement('div');
		content.className = 'cm-content';
		preview.appendChild(content);
		for (const stamp of stamps) {
			const heading = doc.createElement('div');
			heading.className = 'cm-line HyperMD-header HyperMD-header-5';
			heading.textContent = `##### ${stamp}`;
			const line = doc.createElement('div');
			line.className = 'cm-line';
			const area = doc.createElement('textarea');
			area.setAttribute('style', 'display: inline-block; height: 100px');
			line.appendChild(area);
			content.appendChild(heading);
			content.appendChild(line);
		}
		layoutVisitNotes(preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		const control = content.querySelector('h3.rv-older-visits');
		assert.equal(control?.textContent, 'Older Visits');
		assert.equal(control?.parentElement?.classList.contains('cm-line'), true);
		const hidden = content.children.filter((node) => node.classList.contains('rv-older-hidden'));
		assert.ok(hidden.some((node) => (node.textContent ?? '').includes('Thu, 4pm')));
		const hiddenArea = hidden.find((node) => node.querySelector('textarea'));
		assert.equal(hiddenArea?.classList.contains('rv-older-hidden'), true);
		assert.equal(content.querySelectorAll('h3.rv-older-visits').length, 1);
		layoutVisitNotes(preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		assert.equal(content.querySelectorAll('h3.rv-older-visits').length, 1);
		assert.equal(markdown, stamps.map((stamp) => `##### ${stamp}`).join('\n'));
		const css = readFileSync('styles.css', 'utf8');
		assert.match(css, /\.cm-line\.rv-older-hidden :is\(textarea, \.mb-input, \.cm-widget\)/);
	});

	it('hides every Live Preview widget line under a folded visit heading', () => {
		const doc = createDoc();
		const preview = doc.createElement('div');
		preview.className = 'markdown-source-view';
		const heading = doc.createElement('div');
		heading.className = 'cm-line HyperMD-header HyperMD-header-5';
		heading.textContent = '##### Thu, 4pm — Sep 4, 2026';
		const fold = doc.createElement('span');
		fold.className = 'cm-foldPlaceholder';
		heading.appendChild(fold);
		const first = doc.createElement('div');
		first.className = 'cm-line';
		first.appendChild(doc.createElement('textarea'));
		const second = doc.createElement('div');
		second.className = 'cm-line';
		second.appendChild(doc.createElement('textarea'));
		const next = doc.createElement('div');
		next.className = 'cm-line HyperMD-header HyperMD-header-5';
		next.textContent = '##### Wed, 3pm — Sep 3, 2026';
		const after = doc.createElement('div');
		after.className = 'cm-line';
		after.appendChild(doc.createElement('textarea'));
		preview.appendChild(heading);
		preview.appendChild(first);
		preview.appendChild(second);
		preview.appendChild(next);
		preview.appendChild(after);
		concealCollapsedVisitNotes(preview as unknown as HTMLElement);
		assert.equal(first.classList.contains('rv-visit-folded'), true);
		assert.equal(second.classList.contains('rv-visit-folded'), true);
		assert.equal(after.classList.contains('rv-visit-folded'), false);
	});

	it('does not loop when the latest visit heading fold notifies observers immediately', () => {
		const host = globalThis as { MutationObserver?: unknown };
		const previous = host.MutationObserver;
		let observerCalls = 0;
		const observers: SyncObserver[] = [];
		class SyncObserver {
			target: DomEl | null = null;
			subtree = false;
			constructor(private cb: (records: MutationRecord[]) => void) {}
			observe(target: DomEl, options?: { subtree?: boolean }): void {
				this.target = target;
				this.subtree = options?.subtree === true;
				observers.push(this);
			}
			disconnect(): void { /* test */ }
			takeRecords(): MutationRecord[] { return []; }
			notify(el: DomEl): void {
				if (!this.target) return;
				const hit = this.target === el || (this.subtree && this.target.contains(el));
				if (!hit) return;
				observerCalls += 1;
				if (observerCalls > 25) throw new Error('fold observer loop');
				this.cb([{
					type: 'attributes',
					attributeName: 'class',
					target: el,
					oldValue: null,
					addedNodes: [] as unknown as NodeList,
					removedNodes: [] as unknown as NodeList,
				} as MutationRecord]);
			}
		}
		host.MutationObserver = SyncObserver;
		try {
			const stamps = ['Thu, 4pm — Sep 4, 2026', 'Wed, 3pm — Sep 3, 2026'];
			const markdown = `### Recent Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`;
			const doc = createDoc();
			const preview = doc.createElement('div');
			preview.className = 'markdown-preview-view';
			const sizer = doc.createElement('div');
			sizer.className = 'markdown-preview-section';
			preview.appendChild(sizer);
			const notesWrap = doc.createElement('div');
			notesWrap.className = 'el-h3';
			const notes = doc.createElement('h3');
			notes.textContent = 'Recent Notes:';
			notesWrap.appendChild(notes);
			sizer.appendChild(notesWrap);
			const thuWrap = doc.createElement('div');
			thuWrap.className = 'el-h5';
			const thu = doc.createElement('h5');
			thu.className = 'rv-visit-stamp';
			thu.textContent = stamps[0] ?? '';
			thuWrap.appendChild(thu);
			const thuNotes = doc.createElement('div');
			thuNotes.className = 'el-p';
			thuNotes.appendChild(doc.createElement('textarea'));
			const wedWrap = doc.createElement('div');
			wedWrap.className = 'el-h5';
			const wed = doc.createElement('h5');
			wed.className = 'rv-visit-stamp';
			wed.textContent = stamps[1] ?? '';
			wedWrap.appendChild(wed);
			const wedNotes = doc.createElement('div');
			wedNotes.className = 'el-p';
			wedNotes.appendChild(doc.createElement('textarea'));
			sizer.appendChild(thuWrap);
			sizer.appendChild(thuNotes);
			sizer.appendChild(wedWrap);
			sizer.appendChild(wedNotes);
			layoutVisitNotes(preview as unknown as HTMLElement, markdown, {
				newestFirst: true,
				collapseOlder: true,
				limit: 3,
			});
			const fire = (el: DomEl): void => {
				for (const observer of observers.slice()) observer.notify(el);
			};
			const wrapList = (el: DomEl): void => {
				const list = el.classList as DomEl['classList'] & {
					add: (...values: string[]) => void;
					remove: (...values: string[]) => void;
					toggle: (value: string, force?: boolean) => boolean;
				};
				const add = list.add.bind(list);
				const remove = list.remove.bind(list);
				const toggle = list.toggle.bind(list);
				list.add = (...values: string[]) => { add(...values); fire(el); };
				list.remove = (...values: string[]) => { remove(...values); fire(el); };
				list.toggle = (value: string, force?: boolean) => {
					const result = toggle(value, force);
					fire(el);
					return result;
				};
				for (const kid of el.children) wrapList(kid);
			};
			wrapList(preview);
			thuWrap.classList.add('is-collapsed');
			assert.ok(observerCalls < 20);
			assert.equal(thuNotes.classList.contains('rv-visit-folded'), true);
			assert.equal(wedNotes.classList.contains('rv-visit-folded'), false);
			assert.equal(markdown, `### Recent Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`);
		} finally {
			if (previous === undefined) delete host.MutationObserver;
			else host.MutationObserver = previous;
		}
	});

	it('hides a text area that mounts after Older Visits is collapsed', () => {
		const stamps = [
			'Mon, 9am — Sep 1, 2026',
			'Tue, 2pm — Sep 2, 2026',
			'Wed, 3pm — Sep 3, 2026',
			'Thu, 4pm — Sep 4, 2026',
		];
		const markdown = stamps.map((stamp) => `##### ${stamp}`).join('\n');
		const tree = visitTree(stamps, 'flat');
		layoutVisitNotes(tree.preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		const hidden = tree.sizer.children.find((node) => node.classList.contains('rv-older-hidden') && (node.textContent ?? '').includes('Thu, 4pm'));
		assert.ok(hidden);
		const stray = tree.preview.ownerDocument.createElement('p');
		const area = tree.preview.ownerDocument.createElement('textarea');
		stray.appendChild(area);
		tree.sizer.insertBefore(stray, hidden.nextElementSibling);
		concealCollapsedVisitNotes(tree.preview as unknown as HTMLElement);
		assert.equal(stray.classList.contains('rv-older-hidden'), true);
		assert.equal(markdown, stamps.map((stamp) => `##### ${stamp}`).join('\n'));
	});

	it('keeps Older Visits while a visit notes box is focused', () => {
		const stamps = [
			'Mon, 9am — Sep 1, 2026',
			'Tue, 2pm — Sep 2, 2026',
			'Wed, 3pm — Sep 3, 2026',
			'Thu, 4pm — Sep 4, 2026',
		];
		const markdown = `### Recent Notes:\n${stamps.map((stamp) => `##### ${stamp}`).join('\n')}`;
		const tree = visitTree(stamps, 'flat');
		layoutVisitNotes(tree.preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		const area = tree.preview.ownerDocument.createElement('textarea');
		tree.sizer.appendChild(area);
		(tree.preview.ownerDocument as { activeElement?: unknown }).activeElement = area;
		layoutVisitNotes(tree.preview as unknown as HTMLElement, markdown, {
			newestFirst: true,
			collapseOlder: true,
			limit: 3,
		});
		assert.equal(tree.sizer.querySelector('h3.rv-older-visits')?.textContent, 'Older Visits');
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
	const heading = sizer.querySelector('h3.rv-older-visits');
	assert.equal(heading?.tagName, 'H3');
	assert.equal(heading?.textContent, 'Older Visits');
	assert.equal(heading?.classList.contains('rv-older-visits'), true);
	assert.equal(heading?.classList.contains('callout'), false);
	assert.equal(heading?.classList.contains('is-collapsed'), false);
	assert.equal(heading?.parentElement?.classList.contains('el-h3'), true);
	assert.ok(heading?.querySelector('.collapse-indicator'));
	assert.equal(heading?.querySelector('svg')?.getAttribute('class'), 'svg-icon lucide-chevron-right');
	assert.equal(heading?.querySelector('path')?.getAttribute('d'), 'm9 18 6-6-6-6');
	const wrap = heading?.parentElement;
	assert.equal(wrap?.children[0], heading);
	const siblings = wrap?.parentElement?.children ?? [];
	const rule = siblings[siblings.indexOf(wrap as DomEl) - 1];
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

describe('1.3.5 quick fact jump', () => {
	it('sends a home day to visit notes and a miss to the attempt log', () => {
		const home = new Date(2026, 8, 29, 10, 0, 0);
		const miss = new Date(2026, 8, 29, 17, 0, 0);
		const other = new Date(2026, 8, 28, 9, 0, 0);
		const items = [
			{ when: home, home: true, kind: 'notes' as const, id: 'notes' },
			{ when: home, home: true, kind: 'attempt' as const, id: 'home-line' },
			{ when: miss, home: false, kind: 'attempt' as const, id: 'miss-line' },
			{ when: other, home: true, kind: 'notes' as const, id: 'yesterday' },
		];
		assert.equal(pickDayJump(home, items)?.id, 'notes');
		assert.equal(pickDayJump(miss, items)?.id, 'miss-line');
		assert.equal(pickDayJump(new Date(2026, 8, 1, 12, 0, 0), items), null);
	});

	it('reads a visit heading after the rendered age and prefers those notes on a home day', () => {
		const aged = visibleStampText('Sat, 6:38am — Oct 3, 2026 Today');
		const when = stampDateTime(aged);
		assert.equal(when?.getFullYear(), 2026);
		assert.equal(when?.getMonth(), 9);
		assert.equal(when?.getDate(), 3);
		assert.equal(when?.getHours(), 6);
		assert.equal(when?.getMinutes(), 38);
		assert.equal(stampDateTime('Sat, 6:38am — Oct 3, 2026 20 days ago')?.getDate(), 3);
		const spoke = new Date(2026, 9, 3, 0, 0, 0);
		const notes = new Date(2026, 9, 3, 7, 0, 0);
		const success = new Date(2026, 9, 3, 6, 38, 0);
		assert.equal(pickDayJump(spoke, [
			{ when: notes, home: true, kind: 'notes' as const, id: 'notes' },
			{ when: success, home: true, kind: 'attempt' as const, id: 'success-line' },
		])?.id, 'notes');
		const attempted = new Date(2026, 8, 23, 10, 22, 0);
		assert.equal(pickDayJump(attempted, [
			{ when: new Date(2026, 8, 23, 9, 0, 0), home: true, kind: 'notes' as const, id: 'morning-notes' },
			{ when: attempted, home: false, kind: 'attempt' as const, id: 'miss-line' },
		])?.id, 'miss-line');
	});
});

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
