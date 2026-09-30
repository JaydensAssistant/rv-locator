import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLogBullet } from '../src/schedule';
import { notesBoxHeight } from '../src/notes-autosize';
import { applyVisitBody, ensureVisitButtons, iconizeVisitButtons } from '../src/visit-log';
import {
	applyVisitChangeFrontmatter,
	editVisit,
	hintFor,
	hourLabel,
	insertVisit,
	isFutureVisit,
	listVisits,
	parseFrontmatterDateTime,
	removeVisit,
	resolveVisit,
	roundedHour,
	defaultPastVisitTime,
	visitFacts,
	visitWhenFrom,
} from '../src/visit-editor';

const NOW = new Date(2026, 8, 29, 18, 0, 0);

function note(): string {
	return [
		'',
		'> [!quote] RV Dashboard',
		'>**Address:** `INPUT[text:Address]` [🗺️](https://maps.example/x)',
		'',
		'---',
		'### Visit Notes:',
		'##### Mon, 5pm — Sep 21, 2026 <span class="rv-stamp-ago">8 days ago</span>',
		'`INPUT[textArea:sVisit1Notes]`',
		'',
		'##### Sat, 10am — Sep 26, 2026 <span class="rv-stamp-ago">3 days ago</span>',
		'`INPUT[textArea:sVisit2Notes]`',
		'',
		'---',
		'> [!example] Return Suggestions',
		'> No May-go-out days',
		'>',
		'> > [!note]- Attempt Log',
		'> >',
		'> >| | Morning | Afternoon | Evening |',
		'> >| --- | --- | --- | --- |',
		'> >',
		'> >- Mon, 5pm — Sep 21, 2026 — success',
		'> >- Thu, 6pm — Sep 24, 2026 — not home',
		'> >- Sat, 10am — Sep 26, 2026 — success with Devin',
	].join('\n');
}

describe('visit editor', () => {
	it('parses the companion on a log bullet', () => {
		const bullet = parseLogBullet('> >- Sat, 10am — Sep 26, 2026 — success with Devin');
		assert.equal(bullet?.home, true);
		assert.equal(bullet?.companion, 'Devin');
		assert.equal(bullet?.when.getTime(), new Date(2026, 8, 26, 10).getTime());
		assert.equal(parseLogBullet('> >- Thu, 6pm — Sep 24, 2026 — not home')?.home, false);
		assert.equal(parseLogBullet('> >- Mon, 5pm — Sep 21, 2026 — success')?.companion, '');
	});

	it('writes the companion on a new Home bullet', () => {
		const body = applyVisitBody(note(), 'home', NOW, 'Ana');
		assert.match(body, /> >- Tue, 6pm — Sep 29, 2026 — success with Ana$/m);
		assert.match(applyVisitBody(note(), 'miss', NOW, 'Ana'), /— not home$/m);
	});

	it('lists visits oldest first and pairs stamps with bullets', () => {
		const visits = listVisits(note());
		assert.equal(visits.length, 3);
		assert.deepEqual(visits.map((visit) => [visit.home, visit.companion, visit.notesProperty]), [
			[true, '', 'sVisit1Notes'],
			[false, '', null],
			[true, 'Devin', 'sVisit2Notes'],
		]);
		assert.equal(visits[0]?.headingLine, 6);
		assert.equal(visits[1]?.headingLine, null);
		assert.equal(visits[2]?.bulletLine, 23);
	});

	it('lists a stamp with no bullet as a Home', () => {
		const body = note().replace('> >- Mon, 5pm — Sep 21, 2026 — success\n', '');
		const visits = listVisits(body);
		assert.equal(visits[0]?.bulletLine, null);
		assert.equal(visits[0]?.home, true);
	});

	it('inserts a past Home where it belongs by time', () => {
		const body = insertVisit(note(), { when: new Date(2026, 8, 23, 19), home: true, companion: 'Ana' }, { now: NOW });
		const lines = body.split('\n');
		const stamps = lines.filter((line) => line.startsWith('#####'));
		assert.deepEqual(stamps.map((line) => line.replace(/ <span.*$/, '')), [
			'##### Mon, 5pm — Sep 21, 2026',
			'##### Wed, 7pm — Sep 23, 2026',
			'##### Sat, 10am — Sep 26, 2026',
		]);
		const at = lines.findIndex((line) => line.startsWith('##### Wed'));
		assert.equal(lines[at + 1], '`INPUT[textArea:sVisit3Notes]`');
		assert.equal(lines[at + 2], '');
		assert.match(lines[at] ?? '', /6 days ago/);
		const bullets = lines.filter((line) => line.startsWith('> >-'));
		assert.deepEqual(bullets, [
			'> >- Mon, 5pm — Sep 21, 2026 — success',
			'> >- Wed, 7pm — Sep 23, 2026 — success with Ana',
			'> >- Thu, 6pm — Sep 24, 2026 — not home',
			'> >- Sat, 10am — Sep 26, 2026 — success with Devin',
		]);
	});

	it('appends a past visit later than every other one', () => {
		const body = insertVisit(note(), { when: new Date(2026, 8, 28, 9), home: true, companion: '' }, { now: NOW });
		const lines = body.split('\n');
		const at = lines.findIndex((line) => line.startsWith('##### Mon, 9am — Sep 28, 2026'));
		assert.ok(at > lines.findIndex((line) => line.startsWith('##### Sat')));
		assert.equal(lines[at + 1], '`INPUT[textArea:sVisit3Notes]`');
		assert.ok(at < lines.indexOf('> [!example] Return Suggestions'));
		assert.match(body, /> >- Mon, 9am — Sep 28, 2026 — success\n?$/);
	});

	it('inserts a past Not home as a bullet only', () => {
		const body = insertVisit(note(), { when: new Date(2026, 8, 22, 12), home: false, companion: 'X' }, { now: NOW });
		assert.equal(body.split('\n').filter((line) => line.startsWith('#####')).length, 2);
		const bullets = body.split('\n').filter((line) => line.startsWith('> >-'));
		assert.equal(bullets[1], '> >- Tue, 12pm — Sep 22, 2026 — not home');
	});

	it('removes a Home stamp, its notes box, and its bullet', () => {
		const visits = listVisits(note());
		const body = removeVisit(note(), visits[0]!);
		assert.doesNotMatch(body, /Sep 21/);
		assert.doesNotMatch(body, /sVisit1Notes/);
		const lines = body.split('\n');
		assert.equal(lines[lines.indexOf('### Visit Notes:') + 1]?.startsWith('##### Sat'), true);
		assert.equal(listVisits(body).length, 2);
	});

	it('removes a Not home from the Attempt Log', () => {
		const visits = listVisits(note());
		const body = removeVisit(note(), visits[1]!);
		assert.doesNotMatch(body, /not home/);
		assert.equal(body.split('\n').filter((line) => line.startsWith('#####')).length, 2);
	});

	it('removes the notes written under a legacy stamp', () => {
		const legacy = note().replace('`INPUT[textArea:sVisit1Notes]`', 'Talked about the garden.\nWill bring tract.');
		const body = removeVisit(legacy, listVisits(legacy)[0]!);
		assert.doesNotMatch(body, /garden|tract/);
		assert.match(body, /##### Sat/);
	});

	it('edits a Home in place, keeping its notes box', () => {
		const entry = listVisits(note())[2]!;
		const body = editVisit(note(), entry, { when: new Date(2026, 8, 20, 14), home: true, companion: 'Ana' }, NOW);
		const lines = body.split('\n');
		const stamps = lines.filter((line) => line.startsWith('#####')).map((line) => line.replace(/ <span.*$/, ''));
		assert.deepEqual(stamps, ['##### Sun, 2pm — Sep 20, 2026', '##### Mon, 5pm — Sep 21, 2026']);
		const at = lines.findIndex((line) => line.startsWith('##### Sun'));
		assert.equal(lines[at + 1], '`INPUT[textArea:sVisit2Notes]`');
		assert.match(body, /> >- Sun, 2pm — Sep 20, 2026 — success with Ana\n> >- Mon, 5pm/);
		assert.doesNotMatch(body, /Devin/);
		assert.match(body, /`INPUT\[textArea:sVisit1Notes\]`\n\n---/);
	});

	it('edits a Not home into a Home with a new notes box', () => {
		const entry = listVisits(note())[1]!;
		const body = editVisit(note(), entry, { when: entry.when, home: true, companion: '' }, NOW);
		assert.match(body, /##### Thu, 6pm — Sep 24, 2026 <span class="rv-stamp-ago">5 days ago<\/span>\n`INPUT\[textArea:sVisit3Notes\]`/);
		assert.match(body, /> >- Thu, 6pm — Sep 24, 2026 — success$/m);
	});

	it('edits a Home into a Not home and drops its stamp', () => {
		const entry = listVisits(note())[0]!;
		const body = editVisit(note(), entry, { when: entry.when, home: false, companion: '' }, NOW);
		assert.doesNotMatch(body, /##### Mon/);
		assert.match(body, /> >- Mon, 5pm — Sep 21, 2026 — not home$/m);
	});

	it('rejects a visit later than now', () => {
		assert.equal(isFutureVisit(new Date(2026, 8, 29, 19), NOW), true);
		assert.equal(isFutureVisit(new Date(2026, 8, 29, 18), new Date(2026, 8, 29, 17, 40)), false);
		assert.equal(isFutureVisit(new Date(2026, 8, 28, 19), NOW), false);
	});
});

describe('visit change frontmatter', () => {
	const base = (): Record<string, unknown> => ({
		Visits: 3,
		'Successful Visits': 2,
		'Last Attempted': '2026-09-26T10:12:00',
		'Last Spoke': '2026-09-26T10:12:00',
		Met: '2026-09-21T17:00:00',
		'Met With': 'Ana',
		Taken: ['Ana', 'Devin'],
		sVisit2Notes: 'Went well',
	});
	const visits = () => listVisits(note()).map(visitFacts);

	it('deleting the latest Home rolls both dates back and drops its companion', () => {
		const frontmatter = base();
		const all = visits();
		applyVisitChangeFrontmatter(frontmatter, { removed: all[2], remaining: all.slice(0, 2), removedNotesProperty: 'sVisit2Notes' });
		assert.equal(frontmatter.Visits, 2);
		assert.equal(frontmatter['Successful Visits'], 1);
		assert.equal(frontmatter['Last Attempted'], '2026-09-24T18:00:00');
		assert.equal(frontmatter['Last Spoke'], '2026-09-21T17:00:00');
		assert.deepEqual(frontmatter.Taken, ['Ana']);
		assert.equal('sVisit2Notes' in frontmatter, false);
		assert.equal(frontmatter.Met, '2026-09-21T17:00:00');
		assert.equal(frontmatter['Met With'], 'Ana');
	});

	it('deleting an older Not home leaves the dates alone', () => {
		const frontmatter = base();
		const all = visits();
		applyVisitChangeFrontmatter(frontmatter, { removed: all[1], remaining: [all[0]!, all[2]!] });
		assert.equal(frontmatter.Visits, 2);
		assert.equal(frontmatter['Successful Visits'], 2);
		assert.equal(frontmatter['Last Attempted'], '2026-09-26T10:12:00');
		assert.deepEqual(frontmatter.Taken, ['Ana', 'Devin']);
	});

	it('keeps Met With in Taken and a companion another visit records', () => {
		const frontmatter = base();
		const removed = { when: new Date(2026, 8, 21, 17), home: true, companion: 'Ana' };
		applyVisitChangeFrontmatter(frontmatter, { removed, remaining: [] });
		assert.deepEqual(frontmatter.Taken, ['Ana', 'Devin']);
		const second = base();
		const devin = { when: new Date(2026, 8, 20, 9), home: true, companion: 'Devin' };
		applyVisitChangeFrontmatter(second, { removed: devin, remaining: visits() });
		assert.deepEqual(second.Taken, ['Ana', 'Devin']);
	});

	it('deleting the last visit clears the dates and never goes below zero', () => {
		const frontmatter: Record<string, unknown> = { Visits: 0, 'Last Attempted': '2026-09-26T10:00:00', 'Last Spoke': '2026-09-26T10:00:00' };
		applyVisitChangeFrontmatter(frontmatter, { removed: { when: new Date(2026, 8, 26, 10), home: true, companion: '' }, remaining: [] });
		assert.equal(frontmatter.Visits, 0);
		assert.equal(frontmatter['Successful Visits'], 0);
		assert.equal(frontmatter['Last Attempted'], '');
		assert.equal(frontmatter['Last Spoke'], '');
	});

	it('backfilling an older visit bumps counts only', () => {
		const frontmatter = base();
		const added = { when: new Date(2026, 8, 22, 12), home: true, companion: 'Mia' };
		applyVisitChangeFrontmatter(frontmatter, { added, remaining: visits() });
		assert.equal(frontmatter.Visits, 4);
		assert.equal(frontmatter['Successful Visits'], 3);
		assert.equal(frontmatter['Last Attempted'], '2026-09-26T10:12:00');
		assert.deepEqual(frontmatter.Taken, ['Ana', 'Devin', 'Mia']);
	});

	it('backfilling a later visit moves the dates forward', () => {
		const frontmatter = base();
		applyVisitChangeFrontmatter(frontmatter, { added: { when: new Date(2026, 8, 28, 9), home: false, companion: '' }, remaining: visits() });
		assert.equal(frontmatter['Last Attempted'], '2026-09-28T09:00:00');
		assert.equal(frontmatter['Last Spoke'], '2026-09-26T10:12:00');
	});

	it('editing a Home into a Not home moves Last Spoke and drops the notes property', () => {
		const frontmatter = base();
		const all = visits();
		const removed = all[2]!;
		applyVisitChangeFrontmatter(frontmatter, {
			removed,
			added: { when: removed.when, home: false, companion: '' },
			remaining: all.slice(0, 2),
			removedNotesProperty: 'sVisit2Notes',
		});
		assert.equal(frontmatter.Visits, 3);
		assert.equal(frontmatter['Successful Visits'], 1);
		assert.equal(frontmatter['Last Attempted'], '2026-09-26T10:12:00');
		assert.equal(frontmatter['Last Spoke'], '2026-09-21T17:00:00');
		assert.equal('sVisit2Notes' in frontmatter, false);
	});

	it('editing a Home keeps its notes property', () => {
		const frontmatter = base();
		const all = visits();
		applyVisitChangeFrontmatter(frontmatter, {
			removed: all[2],
			added: { when: all[2]!.when, home: true, companion: 'Devin' },
			remaining: all.slice(0, 2),
			removedNotesProperty: 'sVisit2Notes',
		});
		assert.equal(frontmatter.sVisit2Notes, 'Went well');
		assert.equal(frontmatter.Visits, 3);
		assert.equal(frontmatter['Last Spoke'], '2026-09-26T10:12:00');
	});

	it('reads stored local date-times', () => {
		assert.equal(parseFrontmatterDateTime('2026-09-26T10:12:00')?.getTime(), new Date(2026, 8, 26, 10, 12).getTime());
		assert.equal(parseFrontmatterDateTime('nope'), null);
	});
});

describe('visit resolution', () => {
	it('finds a visit again by stamp line, then by ordinal', () => {
		const list = listVisits(note());
		const sat = list[2]!;
		assert.equal(resolveVisit(list, { when: sat.when, home: true, headingLine: sat.headingLine }), sat);
		assert.equal(resolveVisit(list, { when: sat.when, home: true, headingLine: 99 }), sat);
		assert.equal(resolveVisit(list, { when: sat.when, home: false }), null);
		const hint = hintFor(list, list[1]!);
		assert.equal(resolveVisit(listVisits(note()), hint)?.bulletLine, list[1]!.bulletLine);
	});

	it('tells two Homes in the same hour apart', () => {
		const twice = insertVisit(note(), { when: new Date(2026, 8, 26, 10), home: true, companion: 'Mia' }, { now: NOW });
		const list = listVisits(twice);
		const same = list.filter((entry) => entry.when.getTime() === new Date(2026, 8, 26, 10).getTime());
		assert.equal(same.length, 2);
		assert.notEqual(same[0]?.headingLine, same[1]?.headingLine);
		assert.equal(resolveVisit(list, hintFor(list, same[1]!)), same[1]);
	});
});

describe('past visit form', () => {
	it('builds the local date and hour', () => {
		assert.equal(visitWhenFrom('2026-09-23', 19)?.getTime(), new Date(2026, 8, 23, 19).getTime());
		assert.equal(visitWhenFrom('2026-02-30', 9), null);
		assert.equal(visitWhenFrom('', 9), null);
		assert.equal(hourLabel(0), '12am');
		assert.equal(hourLabel(12), '12pm');
		assert.equal(hourLabel(19), '7pm');
	});

	it('starts a past visit at 10am, yesterday while it is still before 10am', () => {
		const afternoon = defaultPastVisitTime(new Date(2026, 8, 29, 15, 20));
		assert.equal(afternoon.hour, 10);
		assert.equal(afternoon.date.getDate(), 29);
		const early = defaultPastVisitTime(new Date(2026, 8, 29, 1, 5));
		assert.equal(early.hour, 10);
		assert.equal(early.date.getDate(), 28);
		assert.equal(defaultPastVisitTime(new Date(2026, 8, 1, 9, 59)).date.getMonth(), 7);
		assert.equal(defaultPastVisitTime(new Date(2026, 8, 29, 10, 0)).date.getDate(), 29);
	});

	it('starts on the hour the stamp would show', () => {
		assert.equal(roundedHour(new Date(2026, 8, 29, 17, 40)).hour, 18);
		const late = roundedHour(new Date(2026, 8, 29, 23, 45));
		assert.equal(late.hour, 0);
		assert.equal(late.date.getDate(), 30);
	});
});

describe('visit notes box', () => {
	const measure = { lineHeight: 20, paddingY: 8, borderY: 2, borderBox: true };
	it('is one line when empty', () => {
		assert.deepEqual(notesBoxHeight({ ...measure, scrollHeight: 8 }), { height: 30, scroll: false });
	});
	it('grows with the text', () => {
		assert.deepEqual(notesBoxHeight({ ...measure, scrollHeight: 68 }), { height: 70, scroll: false });
	});
	it('stops at five lines and scrolls', () => {
		assert.deepEqual(notesBoxHeight({ ...measure, scrollHeight: 208 }), { height: 110, scroll: true });
	});
	it('shrinks a box left tall on a narrower screen', () => {
		assert.equal(notesBoxHeight({ ...measure, scrollHeight: 28 }).height, 30);
	});
});

describe('visit buttons', () => {
	const two = [
		'',
		'> [!quote] RV Dashboard',
		'> `BUTTON[rv-log-home, rv-log-miss]`',
		'>',
		'---',
		'```meta-bind-button',
		'id: rv-log-home',
		'```',
		'',
	].join('\n');

	it('adds Log past visit and Archive to an older note once', () => {
		const next = ensureVisitButtons(two);
		assert.match(next, /^> `BUTTON\[rv-log-home, rv-log-miss, rv-log-past, rv-archive\]`$/m);
		assert.match(next, /id: rv-log-past\nhidden: true\nactions:\n {2}- type: command\n {4}command: rv-locator:log-past-visit\n```/);
		assert.match(next, /command: rv-locator:archive-rv/);
		assert.equal(ensureVisitButtons(next), next);
	});

	it('turns the four visit buttons into icons with tooltips, once', () => {
		const old = [
			'> `BUTTON[rv-log-home, rv-log-miss, rv-log-past, rv-archive]`',
			'',
			'```meta-bind-button',
			'label: Home',
			'style: primary',
			'class: rv-visit-btn',
			'id: rv-log-home',
			'hidden: true',
			'actions:',
			'  - type: runTemplaterFile',
			'    templateFile: Templates/99 RV Log Home.md',
			'```',
			'',
			'```meta-bind-button',
			'style: default',
			'id: rv-archive',
			'```',
			'',
			'```meta-bind-button',
			'label: Other',
			'id: someone-else',
			'```',
		].join('\n');
		const next = iconizeVisitButtons(old);
		const lines = next.split('\n');
		assert.deepEqual(lines.slice(3, 6), ['label: ""', 'icon: door-open', 'tooltip: Home']);
		assert.equal(lines[6], 'style: primary');
		assert.equal(next.includes('    templateFile: Templates/99 RV Log Home.md'), true);
		assert.equal(next.includes('```meta-bind-button\nlabel: ""\nicon: archive\ntooltip: Archive\nstyle: default\nid: rv-archive\n```'), true);
		assert.equal(next.includes('label: Other'), true);
		assert.equal(iconizeVisitButtons(next), next);
		const two = ensureVisitButtons('> `BUTTON[rv-log-home, rv-log-miss]`\n');
		assert.equal(two.includes('icon: rotate-ccw-clock'), true);
		assert.equal(two.includes('tooltip: Log past visit'), true);
		assert.equal(two.includes('label: Log past visit'), false);
	});

	it('leaves a note without the button line alone', () => {
		assert.equal(ensureVisitButtons('> [!quote] RV Dashboard\n> hi'), '> [!quote] RV Dashboard\n> hi');
	});
});
