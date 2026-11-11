import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attemptLogDateParts, formatExactVisitStamp } from '../src/dates';
import { fittedFontScale } from '../src/glancable-density';
import { appendMetDateToFilename, rvNoteTitleFromIdentity } from '../src/note-name';
import { settingsGraphs } from '../src/settings-graphs';
import { sortRowsBy } from '../src/sort';
import { applyStatusPriority, matchesGenderFilter, matchesReturnScope, resolveStatus, statusForNewNote } from '../src/status';
import { DEFAULT_SETTINGS } from '../src/types';
import { applyVisitFrontmatter } from '../src/visit-log';
import { applyVisitChangeFrontmatter } from '../src/visit-editor';

describe('status and priority', () => {
	it('resolves Study, Active, and Inactive', () => {
		assert.equal(resolveStatus('Study', 4), 'Study');
		assert.equal(resolveStatus('Active', 4), 'Active');
		assert.equal(resolveStatus(undefined, 4), 'Active');
		assert.equal(resolveStatus('Inactive', 4), 'Inactive');
		assert.equal(resolveStatus('Study', 0), 'Inactive');
		assert.equal(resolveStatus('Active', 0), 'Inactive');
	});

	it('keeps status and priority in step', () => {
		const active = { status: 'Active' as const, priority: 4 };
		assert.deepEqual(applyStatusPriority(active, { status: 'Inactive' }), { status: 'Inactive', priority: 0 });
		assert.deepEqual(applyStatusPriority(active, { priority: 0 }), { status: 'Inactive', priority: 0 });
		assert.deepEqual(applyStatusPriority({ status: 'Inactive', priority: 0 }, { status: 'Active' }), { status: 'Active', priority: 1 });
		assert.deepEqual(applyStatusPriority({ status: 'Inactive', priority: 0 }, { priority: 3 }), { status: 'Active', priority: 3 });
		assert.deepEqual(applyStatusPriority({ status: 'Inactive', priority: 0 }, { status: 'Study' }), { status: 'Study', priority: 1 });
		assert.deepEqual(applyStatusPriority({ status: 'Study', priority: 2 }, { priority: 5 }), { status: 'Study', priority: 5 });
		assert.equal(statusForNewNote(0), 'Inactive');
		assert.equal(statusForNewNote(4), 'Active');
		assert.equal(statusForNewNote(null), 'Active');
	});

	it('filters return scope and gender', () => {
		assert.equal(matchesReturnScope('active', 'Study', 2), true);
		assert.equal(matchesReturnScope('active', 'Inactive', 2), false);
		assert.equal(matchesReturnScope('rvs', 'Study', 2), false);
		assert.equal(matchesReturnScope('rvs', 'Active', 2), true);
		assert.equal(matchesReturnScope('studies', 'Study', 2), true);
		assert.equal(matchesReturnScope('archive', 'Active', 0), true);
		assert.equal(matchesGenderFilter('all', undefined), true);
		assert.equal(matchesGenderFilter('men', undefined), false);
		assert.equal(matchesGenderFilter('men', 'Man'), true);
		assert.equal(matchesGenderFilter('women', 'Man'), false);
		assert.equal(matchesGenderFilter('women', 'female'), true);
	});
});

describe('met and exact stamps', () => {
	const created = '2026-09-02T16:32:00';

	it('leaves the creation Met alone when a visit is logged, edited, or deleted', () => {
		const home: Record<string, unknown> = { Met: created, Visits: 1, 'Successful Visits': 1 };
		applyVisitFrontmatter(home, 'home', new Date(2026, 9, 1, 12), 'Sam');
		assert.equal(home.Met, created);
		const miss: Record<string, unknown> = { Met: created, Visits: 1 };
		applyVisitFrontmatter(miss, 'miss', new Date(2026, 9, 2, 9), 'Sam');
		assert.equal(miss.Met, created);
		const edited: Record<string, unknown> = { Met: created };
		applyVisitChangeFrontmatter(edited, {
			removed: { when: new Date(2026, 8, 2, 16, 32), home: true, companion: '' },
			added: { when: new Date(2026, 8, 20, 9), home: false, companion: '' },
			remaining: [],
		});
		assert.equal(edited.Met, created);
		const deleted: Record<string, unknown> = { Met: created, Visits: 1, 'Successful Visits': 1 };
		applyVisitChangeFrontmatter(deleted, {
			removed: { when: new Date(2026, 8, 20, 9), home: true, companion: '' },
			remaining: [],
		});
		assert.equal(deleted.Met, created);
		const blank: Record<string, unknown> = { Visits: 1 };
		applyVisitChangeFrontmatter(blank, {
			removed: { when: new Date(2026, 8, 2, 16, 32), home: true, companion: '' },
			remaining: [{ when: new Date(2026, 8, 1, 9), home: true, companion: '' }],
		});
		assert.equal(blank.Met, undefined);
	});

	it('keeps minutes on the attempt log and shrinks only the date', () => {
		assert.equal(formatExactVisitStamp(new Date(2026, 8, 15, 16, 0, 0)), 'Tue, 4pm — Sep 15, 2026');
		assert.equal(formatExactVisitStamp(new Date(2026, 8, 15, 16, 32, 0)), 'Tue, 4:32pm — Sep 15, 2026');
		const parts = attemptLogDateParts('Tue, 4:32pm — Sep 15, 2026 — success');
		assert.deepEqual(parts, { lead: 'Tue, 4:32pm — ', date: 'Sep 15, 2026', tail: ' — success' });
		assert.equal(attemptLogDateParts('no date here'), null);
	});
});

describe('new note identity and card fit', () => {
	it('titles a blank name from gender and can append the Met date', () => {
		assert.equal(rvNoteTitleFromIdentity('', 'Man', '142 Maple Street'), 'Man on Maple Street');
		assert.equal(rvNoteTitleFromIdentity('Alex', 'Woman', '142 Maple Street'), 'Alex on Maple Street');
		assert.equal(appendMetDateToFilename('Man on Maple', '2026-10-01T16:32:00'), 'Man on Maple 2026-10-01 1632');
		assert.equal(appendMetDateToFilename('', '2026-10-01'), '');
	});

	it('scales on top of the current density so N cards fit', () => {
		const settings = {
			glancableFontScale: 1,
			glancablePaddingX: 10,
			glancableMaxLineChars: 34,
		};
		assert.equal(fittedFontScale(800, settings, 0), 1);
		assert.equal(fittedFontScale(800, settings, 1), 1);
		const fitted = fittedFontScale(800, settings, 4);
		assert.ok(fitted < 1);
		assert.ok(fitted >= 0.4);
		const larger = fittedFontScale(800, { ...settings, glancableFontScale: 1.5 }, 4);
		assert.ok(larger > fitted);
	});

	it('orders cities by the nearest note when a position exists', () => {
		const orlando = { name: 'o', lat: 28.54, lon: -81.38, sortKeys: { 'note.City': { kind: 'text' as const, value: 'Orlando' } } };
		const miami = { name: 'm', lat: 25.76, lon: -80.19, sortKeys: { 'note.City': { kind: 'text' as const, value: 'Miami' } } };
		const blank = { name: 'b', lat: null, lon: null, sortKeys: { 'note.City': { kind: 'empty' as const } } };
		const fix = { lat: 28.5, lon: -81.4 };
		const nearest = sortRowsBy([miami, blank, orlando], [{ property: 'note.City', direction: 'ASC' }], fix, 'note.Distance');
		assert.deepEqual(nearest.map((row) => row.name), ['o', 'm', 'b']);
		const alpha = sortRowsBy([orlando, blank, miami], [{ property: 'note.City', direction: 'ASC' }], null, 'note.Distance');
		assert.deepEqual(alpha.map((row) => row.name), ['m', 'o', 'b']);
	});

	it('labels both axes of every settings graph', () => {
		const graphs = settingsGraphs(DEFAULT_SETTINGS);
		for (const svg of [graphs.ladder, graphs.ramp, graphs.ideality, graphs.floors, graphs.suggester]) {
			assert.match(svg, /class="rv-graph-tick"/);
			assert.match(svg, /class="rv-graph-axis"/);
			assert.match(svg, /class="rv-graph-label"/);
		}
		assert.match(graphs.suggester, /Suggester Try and Avoid/);
		assert.match(graphs.suggester, />trials</);
		assert.match(graphs.suggester, />home rate</);
	});
});
