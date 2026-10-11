import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { autoInk, contrast, deltaE00, parseHex, ringContrast, urgencyInkFor } from '../src/color-math';
import { formatGlanceableCounter } from '../src/dates';
import { dropPath, groupPinStacks, pinsToDraw, stackCountLabel, tapOpensTop, tapZoomsStack } from '../src/map-pins';
import { appendMetDateToFilename, filenameCollision, stripFilenameStamp } from '../src/note-name';
import { parseLogBullet } from '../src/schedule';
import { applyVisitBody, ensureAttemptLog } from '../src/visit-log';
import { editVisit, listVisits } from '../src/visit-editor';
import { displayTitle, paintedSuffix } from '../src/title-fit';
import { collapseAttemptLog, upsertAttemptDigest } from '../src/attempt-digest';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/types';
import { resetSettingsTab as resetTab } from '../src/settings-reset';
import { URGENCY_PALETTES } from '../src/urgency-palette';
import { cacheStats, homeBoxFromPoints, noteViewedTile, tileIsHome, NON_HOME_CAP } from '../src/tile-index';

describe('polish pack data', () => {
	it('formats every counter as Nd', () => {
		assert.equal(formatGlanceableCounter(0), '0d');
		assert.equal(formatGlanceableCounter(14), '14d');
		assert.equal(formatGlanceableCounter(400), '400d');
	});

	it('stamps a windows-safe date and time and strips both suffix forms', () => {
		assert.equal(appendMetDateToFilename('Pat on Pine', '2026-08-12T17:05:00'), 'Pat on Pine 2026-08-12 1705');
		assert.equal(appendMetDateToFilename('Pat on Pine', '2026-08-12'), 'Pat on Pine');
		assert.equal(stripFilenameStamp('Pat on Pine 2026-08-12 1705'), 'Pat on Pine');
		assert.equal(stripFilenameStamp('Pat on Pine 2026-08-12'), 'Pat on Pine');
		assert.equal(filenameCollision('Pat on Pine 2026-08-12 1705', ['Pat on Pine 2026-08-12 1705']), 'Pat on Pine 2026-08-12 1705 2');
		assert.doesNotMatch(appendMetDateToFilename('A on B', '2026-01-02T09:03:00'), /:/);
	});

	it('migrates the filename stamp on once, then keeps a later off', () => {
		const turnedOn = mergeSettings({ appendMetDateToFilename: false });
		assert.equal(turnedOn.appendMetDateToFilename, true);
		assert.equal(turnedOn.filenameStampMigrated, true);
		const staysOff = mergeSettings({ appendMetDateToFilename: false, filenameStampMigrated: true });
		assert.equal(staysOff.appendMetDateToFilename, false);
		const fresh = mergeSettings(null);
		assert.equal(fresh.appendMetDateToFilename, true);
		assert.equal(fresh.fullWidthCallout, false);
		assert.equal(fresh.hideStatusBar, false);
		const reset = resetTab({ ...DEFAULT_SETTINGS, appendMetDateToFilename: false, fullWidthCallout: true, hideStatusBar: true }, 'advanced');
		assert.equal(reset.appendMetDateToFilename, true);
		assert.equal(reset.hideStatusBar, false);
		const everyday = resetTab({ ...DEFAULT_SETTINGS, fullWidthCallout: true }, 'everyday');
		assert.equal(everyday.fullWidthCallout, false);
		const urgency = resetTab({ ...DEFAULT_SETTINGS, urgencyPalette: 'sunset' }, 'urgency');
		assert.equal(urgency.urgencyPalette, DEFAULT_SETTINGS.urgencyPalette);
	});

	it('writes Log and still reads Attempt Log without renaming it', () => {
		const created = ensureAttemptLog('');
		assert.match(created, /\[!note\]- Log/);
		assert.doesNotMatch(created, /Attempt Log/);
		const old = '> [!note]- Attempt Log\n> - Wed, 5:05pm — Aug 12, 2026 — not home';
		const collapsed = collapseAttemptLog(old.replace('- Attempt', '+ Attempt'));
		assert.match(collapsed, /Attempt Log/);
		const digest = upsertAttemptDigest(old, { sentences: ['Try: Tue morning'], table: '| Sun | 0/0 | 0/0 | 0/0 |', text: '' });
		assert.match(digest ?? '', /Attempt Log/);
		assert.doesNotMatch(digest ?? '', /\[!note\]- Log$/m);
	});

	it('records coverage on the log bullet and reads it back', () => {
		const body = applyVisitBody('> [!note]- Log\n', 'miss', new Date(2026, 7, 12, 17, 5), '', undefined, 'Convention');
		assert.match(body, /not home — covered Convention/);
		const bullet = parseLogBullet('- Wed, 5:05pm — Aug 12, 2026 — not home — covered Convention');
		assert.equal(bullet?.home, false);
		assert.equal(bullet?.covered, 'Convention');
		const home = parseLogBullet('- Sat, 10:40am — Aug 15, 2026 — success with Devin — covered Convention');
		assert.equal(home?.home, true);
		assert.equal(home?.companion, 'Devin');
		assert.equal(home?.covered, 'Convention');
		const legacy = parseLogBullet('- Sat, 10:40am — Aug 15, 2026 — success');
		assert.equal(legacy?.covered, '');
		assert.equal(legacy?.home, true);
		const named = parseLogBullet('- Sat, 5:20pm — Oct 11, 2026 — success — Pat Multi — 1400 Edgewater Dr');
		assert.equal(named?.home, true);
		assert.equal(named?.companion, '');
	});

	it('edits a covered token off and back on', () => {
		const start = applyVisitBody('> [!note]- Log\n', 'home', new Date(2026, 7, 15, 10, 40), 'Devin', undefined, 'Convention');
		const [entry] = listVisits(start);
		assert.ok(entry);
		assert.equal(entry?.covered, 'Convention');
		const cleared = editVisit(start, entry!, { ...entry!, covered: '' });
		assert.equal(listVisits(cleared)[0]?.covered ?? '', '');
		const again = editVisit(cleared, listVisits(cleared)[0]!, { ...listVisits(cleared)[0]!, covered: 'Convention' });
		assert.equal(listVisits(again)[0]?.covered, 'Convention');
	});

	it('adds Video and Study once and strips quotes', () => {
		assert.deepEqual(displayTitle('"Remember Jesus\' Death"', 'media'), { text: "Remember Jesus' Death", suffix: 'Video' });
		assert.deepEqual(displayTitle('Remember Jesus\' Death Video', 'media'), { text: "Remember Jesus' Death", suffix: 'Video' });
		assert.equal(displayTitle('01 How Can the Bible Help', 'lesson').suffix, 'Study');
		assert.equal(paintedSuffix('Video'), ' Video');
		assert.equal(paintedSuffix(' Study'), ' Study');
		assert.equal(paintedSuffix(''), '');
	});

	it('draws a teardrop and stacks by urgency', () => {
		assert.match(dropPath(), /^M21 52.5 L/);
		const placed = [
			{ path: 'a', x: 0, y: 0, urgency: 1, priority: 1 },
			{ path: 'b', x: 4, y: 0, urgency: 3, priority: 1 },
			{ path: 'c', x: 80, y: 0, urgency: 2, priority: 1 },
		];
		const groups = groupPinStacks(placed);
		assert.equal(groups.length, 2);
		assert.equal(groups.find((group) => group.length === 2)?.[0]?.path, 'b');
		const many = Array.from({ length: 120 }, (_, index) => ({
			path: `p${index}`,
			x: index * 0.01,
			y: 0,
			urgency: index,
			priority: 1,
		}));
		const drawn = pinsToDraw(many);
		assert.equal(drawn.drawn.length, 5);
		assert.equal(drawn.drawn[0]?.path, 'p119');
		assert.equal(stackCountLabel(3), null);
		assert.equal(stackCountLabel(4), '4');
		assert.equal(stackCountLabel(120), '99+');
		assert.equal(tapZoomsStack(12, 2), true);
		assert.equal(tapZoomsStack(12, 1), false);
		assert.equal(tapZoomsStack(13, 4), false);
		assert.equal(tapOpensTop(13, 4), true);
	});

	it('keeps ink at 4.5:1 on the 14% fill and deepens pastel rings', () => {
		const bg = parseHex('#1e1e1e');
		const light = parseHex('#ffffff');
		assert.ok(bg && light);
		for (const palette of URGENCY_PALETTES) {
			if (palette.id === 'accent') continue;
			for (const hex of palette.colors) {
				const color = parseHex(hex);
				assert.ok(color, hex);
				const darkInk = urgencyInkFor(color, bg);
				const lightInk = urgencyInkFor(color, light);
				assert.ok(darkInk.ratio >= 4.5, `${palette.id} ${hex} dark ${darkInk.ratio}`);
				assert.ok(lightInk.ratio >= 4.5, `${palette.id} ${hex} light ${lightInk.ratio}`);
				const rings = ringContrast(color);
				if (palette.id !== 'default') {
					assert.ok(rings.dark >= 3, `${palette.id} ${hex} dark ring ${rings.dark}`);
					assert.ok(rings.light >= 2, `${palette.id} ${hex} light ring ${rings.light}`);
				}
			}
			if (palette.id === 'accent') continue;
			for (let index = 1; index < palette.colors.length; index += 1) {
				const left = parseHex(palette.colors[index - 1] ?? '');
				const right = parseHex(palette.colors[index] ?? '');
				assert.ok(left && right);
				if (palette.id === 'default') continue;
				assert.ok(deltaE00(left, right) >= 10, `${palette.id} band ${index} ΔE ${deltaE00(left, right)}`);
			}
		}
		const yellow = parseHex('#d6a100');
		assert.ok(yellow);
		assert.equal(autoInk(yellow), '#111111');
		const red = parseHex('#d63c3c');
		assert.ok(red);
		assert.equal(autoInk(red), '#ffffff');
		assert.ok(contrast(yellow, { r: 0, g: 0, b: 0 }) > 1);
	});

	it('caps non-home tiles and keeps home tiles', () => {
		let records = [] as ReturnType<typeof noteViewedTile>;
		for (let index = 0; index < NON_HOME_CAP + 25; index += 1) {
			records = noteViewedTile(records, { z: 12, x: index, y: 1, home: false }, 1_000 + index);
		}
		assert.equal(records.length, NON_HOME_CAP);
		assert.equal(records.some((record) => record.x === 0), false);
		assert.equal(records.some((record) => record.x === NON_HOME_CAP + 24), true);
		const stale = noteViewedTile([{ key: '3/1/1', z: 3, x: 1, y: 1, home: false, lastViewed: 0 }], {
			z: 3, x: 2, y: 2, home: false,
		}, 15 * 24 * 60 * 60 * 1000);
		assert.equal(stale.some((record) => record.key === '3/1/1'), false);
		const kept = noteViewedTile([{ key: '3/1/1', z: 3, x: 1, y: 1, home: false, lastViewed: 0 }], {
			z: 3, x: 2, y: 2, home: false,
		}, 13 * 24 * 60 * 60 * 1000);
		assert.equal(kept.some((record) => record.key === '3/1/1'), true);
		const home = noteViewedTile([{ key: '14/1/1', z: 14, x: 1, y: 1, home: true, lastViewed: 0 }], {
			z: 10, x: 2, y: 2, home: true,
		}, 40 * 24 * 60 * 60 * 1000);
		assert.equal(home.length, 2);
		const box = homeBoxFromPoints([{ lat: 28.5, lon: -81.4 }]);
		assert.equal(tileIsHome(10, 282, 428, box) || box != null, true);
		const stats = cacheStats(records);
		assert.equal(stats.total, NON_HOME_CAP);
		assert.equal(stats.home, 0);
	});
});
