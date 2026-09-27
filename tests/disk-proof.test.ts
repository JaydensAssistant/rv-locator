/**
 * On-disk proof for 1.1.1. Reads the note files back after the same write
 * sequence the plugin uses (applyGeocodeHit, then a YAML dump that leaves
 * Location as bare numbers, then ensureQuotedLocationList). Counts come from
 * those file diffs. No Geoapify call and no toast.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { googleMapsLink } from '../src/address';
import { formatGlancableVisitStamp } from '../src/dates';
import {
	applyGeocodeHit,
	ensureQuotedLocationList,
	hasCoordinates,
	locationPair,
	planGeocodeWork,
	readAddress,
} from '../src/frontmatter';
import { decideGeocodePick } from '../src/home-base';
import { rvNoteTitle } from '../src/note-name';
import { schedulePickerDismiss } from '../src/picker-gate';
import { DEFAULT_SETTINGS, type GeocodeHit, type RVLocatorSettings } from '../src/types';

const ROOT = '/tmp/rv-locator-disk-proof';
const MESSY = '142 maple st apt b, o-town fl';
const FORMATTED = '142 Maple Street, Orlando, FL 32801, United States of America';
const LAT = 29.0313846;
const LON = -82.5209372;
const QUOTED_LOCATION = [
	'Location:',
	'  - "29.0313846"',
	'  - "-82.5209372"',
].join('\n');
const BARE_NEGATIVE = '  - -82.5209372';

const settings: RVLocatorSettings = { ...DEFAULT_SETTINGS, homeCounties: ['Orange'] };

function hit(partial: Partial<GeocodeHit> & Pick<GeocodeHit, 'confidence'>): GeocodeHit {
	return {
		lat: LAT,
		lon: LON,
		formattedAddress: FORMATTED,
		city: 'Orlando',
		county: 'Orange County',
		...partial,
	};
}

function resetDir(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
}

function addressLine(markdown: string): string {
	const line = markdown.split(/\r?\n/).find((row) => /^Address\s*:/.test(row));
	if (!line) throw new Error('Address line missing');
	return line;
}

function bodyOf(markdown: string): string {
	const nl = markdown.startsWith('---\r\n') ? '\r\n' : '\n';
	const start = 3 + nl.length;
	const close = `${nl}---`;
	const end = markdown.indexOf(close, start);
	if (end < 0) throw new Error('frontmatter did not close');
	return markdown.slice(end + close.length);
}

function parseFrontmatter(markdown: string): Record<string, unknown> {
	const nl = markdown.startsWith('---\r\n') ? '\r\n' : markdown.startsWith('---\n') ? '\n' : null;
	if (!nl) return {};
	const start = 3 + nl.length;
	const close = `${nl}---`;
	const end = markdown.indexOf(close, start);
	if (end < 0) return {};
	const lines = markdown.slice(start, end).split(/\r?\n/);
	const frontmatter: Record<string, unknown> = {};
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		if (/^\s/.test(line) || !line.trim()) continue;
		const match = /^([^:#][^:]*?)\s*:(.*)$/.exec(line);
		if (!match) continue;
		const key = match[1]?.trim() ?? '';
		const rest = (match[2] ?? '').trim();
		if (!rest) {
			const items: unknown[] = [];
			let next = index + 1;
			while (next < lines.length && /^\s+-\s+/.test(lines[next] ?? '')) {
				items.push(unquote((lines[next] ?? '').replace(/^\s+-\s+/, '').trim()));
				next += 1;
			}
			frontmatter[key] = items;
			index = next - 1;
			continue;
		}
		frontmatter[key] = unquote(rest);
	}
	return frontmatter;
}

function unquote(value: string): string {
	if (value.length >= 2) {
		const open = value[0];
		const close = value[value.length - 1];
		if ((open === '"' && close === '"') || (open === "'" && close === "'")) {
			return value.slice(1, -1);
		}
	}
	return value;
}

function yamlQuote(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function replaceTopLevel(markdown: string, key: string, blockLines: string[]): string {
	if (key.trim().toLowerCase() === 'address') throw new Error('refusing to rewrite Address');
	const nl = markdown.startsWith('---\r\n') ? '\r\n' : '\n';
	if (!markdown.startsWith(`---${nl}`)) throw new Error('missing frontmatter');
	const start = 3 + nl.length;
	const close = `${nl}---`;
	const end = markdown.indexOf(close, start);
	if (end < 0) throw new Error('frontmatter did not close');
	const lines = markdown.slice(start, end).split(/\r?\n/);
	const wanted = key.trim().toLowerCase();
	const index = lines.findIndex((line) => {
		if (/^\s/.test(line)) return false;
		const match = /^([^:#][^:]*?)\s*:/.exec(line);
		return match?.[1]?.trim().toLowerCase() === wanted;
	});
	let nextLines: string[];
	if (index < 0) {
		const trimmed = lines.join(nl).replace(/(?:\r?\n)+$/, '');
		nextLines = trimmed.trim() ? [...trimmed.split(/\r?\n/), ...blockLines] : blockLines;
	} else {
		let stop = index + 1;
		while (stop < lines.length && /^\s/.test(lines[stop] ?? '')) stop += 1;
		nextLines = [...lines.slice(0, index), ...blockLines, ...lines.slice(stop)];
	}
	return `---${nl}${nextLines.join(nl)}${markdown.slice(end)}`;
}

/**
 * Same two steps as writeHit: processFrontMatter (simulated by dumping Location
 * as bare YAML numbers, which is what a numeric dump does to a negative
 * longitude) and then ensureQuotedLocationList.
 */
function commitGeocode(markdown: string, chosen: GeocodeHit, active: RVLocatorSettings): string {
	const frontmatter = parseFrontmatter(markdown);
	const addressBefore = frontmatter.Address;
	applyGeocodeHit(frontmatter, chosen, active);
	assert.equal(frontmatter.Address, addressBefore);
	const pair = locationPair(chosen);
	assert.deepEqual(pair, [String(pair[0]), String(pair[1])]);
	assert.equal(typeof pair[0], 'string');
	assert.equal(typeof pair[1], 'string');
	const hostile = replaceTopLevel(markdown, active.locationProperty, [
		`${active.locationProperty}:`,
		`  - ${pair[0]}`,
		`  - ${pair[1]}`,
	]);
	assert.equal(hostile.includes(BARE_NEGATIVE), pair[1].startsWith('-'));
	let next = hostile;
	if (typeof frontmatter.City === 'string') next = replaceTopLevel(next, 'City', [`City: ${yamlQuote(frontmatter.City)}`]);
	const mapLink = frontmatter['Map Link'];
	if (typeof mapLink === 'string') next = replaceTopLevel(next, active.mapLinkProperty, [`${active.mapLinkProperty}: ${yamlQuote(mapLink)}`]);
	assert.equal(addressLine(next), addressLine(markdown));
	const quoted = ensureQuotedLocationList(next, active.locationProperty, pair, active.addressProperty);
	assert.equal(addressLine(quoted), addressLine(markdown));
	assert.equal(bodyOf(quoted), bodyOf(markdown));
	return quoted;
}

function assertLanded(markdown: string, address: string): void {
	assert.equal(addressLine(markdown), `Address: ${yamlQuote(address)}`);
	assert.equal(markdown.includes(QUOTED_LOCATION), true, markdown);
	assert.equal(markdown.includes(`\n${BARE_NEGATIVE}`), false, markdown);
	assert.equal(markdown.includes('\n  - 29.0313846\n'), false, markdown);
	assert.equal(markdown.includes('City: "Orlando"'), true, markdown);
	assert.equal(markdown.includes(`Map Link: ${yamlQuote(googleMapsLink(LAT, LON))}`), true, markdown);
	assert.equal(markdown.includes('\nDistance:'), false);
}

/** Obsidian closes the suggest modal before it reports the chosen row. */
function askForHit(choice: 'accept' | 'dismiss', chosen: GeocodeHit): Promise<GeocodeHit | null> {
	return new Promise((resolve) => {
		let settled = false;
		let chose = false;
		const finish = (value: GeocodeHit | null) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		schedulePickerDismiss(
			() => chose,
			() => finish(null),
			(run) => { setTimeout(run, 0); },
		);
		if (choice === 'accept') {
			chose = true;
			finish(chosen);
		}
	});
}

describe('disk proof', () => {
	it('single-note Accept writes quoted Location and leaves Address bytes', async () => {
		const dir = join(ROOT, 'single');
		resetDir(dir);
		const file = join(dir, 'single.md');
		const before = [
			'---',
			`Address: ${yamlQuote(MESSY)}`,
			'Location:',
			'  - 28.985237',
			'  - -82.4867061',
			'City: "Oldtown"',
			'---',
			'',
			'Keep this body.',
			'',
		].join('\n');
		writeFileSync(file, before);
		const chosen = hit({ confidence: 0.5 });
		assert.notEqual(MESSY, chosen.formattedAddress);
		assert.equal(decideGeocodePick([chosen], settings.homeCounties).hit, null);
		const picked = await askForHit('accept', chosen);
		assert.ok(picked);
		const after = commitGeocode(readFileSync(file, 'utf8'), picked, settings);
		writeFileSync(file, after);
		const disk = readFileSync(file, 'utf8');
		console.log(`\n----- SINGLE ${file} -----\n${disk}`);
		assert.equal(disk.includes('28.985237'), false);
		assert.equal(disk.includes('-82.4867061'), false);
		assertLanded(disk, MESSY);
		assert.equal(bodyOf(disk), '\n\nKeep this body.\n');
		assert.equal(addressLine(disk), addressLine(before));
	});

	it('bulk filled and skipped counts match file diffs, and a messy address modals unless confidence is 1.00 and it is the only home-county hit', async () => {
		const dir = join(ROOT, 'bulk');
		resetDir(dir);
		const full = hit({ confidence: 1 });
		assert.notEqual(MESSY, full.formattedAddress);
		const cases: Array<{
			name: string;
			before: string;
			hits: GeocodeHit[];
			choice: 'accept' | 'dismiss';
			modal: boolean;
		}> = [
			{
				name: 'accept-modal.md',
				before: note(MESSY),
				hits: [hit({ confidence: 0.5 })],
				choice: 'accept',
				modal: true,
			},
			{
				name: 'dismiss-modal.md',
				before: note(MESSY),
				hits: [hit({ confidence: 0.5 })],
				choice: 'dismiss',
				modal: true,
			},
			{
				name: 'already-located.md',
				before: [
					'---',
					'Address: "10 Oak Hammock Lane, Orlando, FL"',
					'Location:',
					'  - "28.1000001"',
					'  - "-81.2000001"',
					'---',
					'',
					'Already had a location.',
					'',
				].join('\n'),
				hits: [full],
				choice: 'dismiss',
				modal: false,
			},
			{
				name: 'autopick-messy.md',
				before: note(MESSY),
				hits: [full],
				choice: 'dismiss',
				modal: false,
			},
			{
				name: 'low-confidence.md',
				before: note(MESSY),
				hits: [hit({ confidence: 0.99 })],
				choice: 'dismiss',
				modal: true,
			},
			{
				name: 'missing-confidence.md',
				before: note(MESSY),
				hits: [hit({ confidence: undefined })],
				choice: 'dismiss',
				modal: true,
			},
			{
				name: 'two-home.md',
				before: note(MESSY),
				hits: [full, hit({ lat: 28.5, lon: -81.4, confidence: 1, formattedAddress: '88 Cypress Ave, Orlando, FL 32801, United States of America' })],
				choice: 'dismiss',
				modal: true,
			},
			{
				name: 'out-of-county.md',
				before: note(MESSY),
				hits: [hit({ confidence: 1, county: 'Lake County' })],
				choice: 'dismiss',
				modal: true,
			},
		];

		const files = cases.map((item) => {
			const file = join(dir, item.name);
			writeFileSync(file, item.before);
			return { ...item, file };
		});
		const snapshots = files.map((item) => ({
			path: item.file,
			frontmatter: parseFrontmatter(item.before),
		}));
		const withAddress = snapshots.filter((item) => readAddress(item.frontmatter, settings.addressProperty)).length;
		const work = planGeocodeWork(snapshots, settings, false);
		const skipped = Math.max(0, withAddress - work.length);
		let updated = 0;
		let passed = 0;
		const modals: string[] = [];

		for (const item of work) {
			const noteFile = files.find((candidate) => candidate.file === item.path);
			assert.ok(noteFile);
			const decision = decideGeocodePick(noteFile.hits, settings.homeCounties);
			assert.equal(decision.hit == null, noteFile.modal, noteFile.name);
			if (decision.hit) {
				assert.equal(noteFile.name, 'autopick-messy.md');
				assert.notEqual(item.address, decision.hit.formattedAddress);
				assert.equal(decision.hit.confidence, 1);
				const next = commitGeocode(readFileSync(noteFile.file, 'utf8'), decision.hit, settings);
				writeFileSync(noteFile.file, next);
				updated += 1;
				continue;
			}
			modals.push(noteFile.name);
			const picked = await askForHit(noteFile.choice, noteFile.hits[0] as GeocodeHit);
			if (!picked) {
				passed += 1;
				continue;
			}
			const next = commitGeocode(readFileSync(noteFile.file, 'utf8'), picked, settings);
			writeFileSync(noteFile.file, next);
			updated += 1;
		}

		const changed: string[] = [];
		const unchangedLocated: string[] = [];
		const unchangedQueued: string[] = [];
		const workPaths = new Set(work.map((item) => item.path));
		for (const item of files) {
			const disk = readFileSync(item.file, 'utf8');
			if (disk !== item.before) {
				changed.push(item.name);
				assertLanded(disk, MESSY);
			} else if (hasCoordinates(parseFrontmatter(item.before).Location)) {
				unchangedLocated.push(item.name);
			} else if (workPaths.has(item.file)) {
				unchangedQueued.push(item.name);
			}
			console.log(`\n----- BULK ${item.file} changed=${disk !== item.before} -----\n${disk}`);
		}

		assert.deepEqual(changed.sort(), ['accept-modal.md', 'autopick-messy.md']);
		assert.deepEqual(unchangedLocated, ['already-located.md']);
		assert.equal(updated, changed.length);
		assert.equal(skipped, unchangedLocated.length);
		assert.equal(passed, unchangedQueued.length);
		assert.deepEqual(modals.sort(), [
			'accept-modal.md',
			'dismiss-modal.md',
			'low-confidence.md',
			'missing-confidence.md',
			'out-of-county.md',
			'two-home.md',
		]);
		const summary = `Updated ${updated} (0 from saved lookups). Skipped ${skipped}. Picker skipped ${passed}. No match 0. Failed 0. Filled Successful Visits on 0. Filled City on 0.`;
		console.log(`\n----- BULK COUNTS FROM FILE DIFFS -----\n${summary}\nchanged ${changed.join(', ')}\nskipped ${unchangedLocated.join(', ')}\npicker skipped ${unchangedQueued.join(', ')}`);
		assert.match(summary, new RegExp(`Updated ${changed.length} `));
		assert.match(summary, new RegExp(`Skipped ${unchangedLocated.length}`));
		assert.match(summary, new RegExp(`Picker skipped ${unchangedQueued.length}`));

		const emptyDir = join(ROOT, 'bulk-empty-home');
		resetDir(emptyDir);
		const emptyFile = join(emptyDir, 'empty-home.md');
		const emptyBefore = note(MESSY);
		writeFileSync(emptyFile, emptyBefore);
		const emptySettings = { ...settings, homeCounties: [] as string[] };
		const emptyWork = planGeocodeWork([{ path: emptyFile, frontmatter: parseFrontmatter(emptyBefore) }], emptySettings, false);
		assert.equal(emptyWork.length, 1);
		assert.equal(decideGeocodePick([full], emptySettings.homeCounties).hit, null);
		const emptyPick = await askForHit('dismiss', full);
		assert.equal(emptyPick, null);
		assert.equal(readFileSync(emptyFile, 'utf8'), emptyBefore);
		console.log(`\n----- EMPTY HOME ${emptyFile} unchanged -----\n${emptyBefore}`);
	});

	it('creates one New RV note, then geocode lands on that file', async () => {
		const dir = join(ROOT, 'new-rv');
		resetDir(dir);
		const address = '142 Maple Street, Orlando, FL';
		const created = '2026-09-09T13:38:03';
		const stamp = formatGlancableVisitStamp(new Date(2026, 8, 9, 13, 38, 3));
		assert.equal(stamp, 'Wed, 2pm — Sep 9, 2026');
		const title = rvNoteTitle('Alex', address);
		assert.equal(title, 'Alex on Maple');
		const file = join(dir, `${title}.md`);
		const target = { path: file };
		const hooks: Array<() => Promise<void>> = [];
		const executed: string[] = [];
		let pending = Promise.resolve();
		const chosen = hit({ confidence: 0.5 });
		const app = {
			vault: {
				read: async (note: { path: string }) => readFileSync(note.path, 'utf8'),
				getAbstractFileByPath: () => null,
			},
			workspace: {
				getActiveFile: () => target,
				getLeaf: () => ({ openFile: async () => { throw new Error('note should already be the active file'); } }),
			},
			commands: {
				commands: { 'rv-locator:geocode-current-note': { id: 'rv-locator:geocode-current-note' } },
				executeCommandById: (id: string) => {
					executed.push(id);
					pending = (async () => {
						assert.equal(decideGeocodePick([chosen], settings.homeCounties).hit, null);
						const picked = await askForHit('accept', chosen);
						assert.ok(picked);
						writeFileSync(file, commitGeocode(readFileSync(file, 'utf8'), picked, settings));
					})();
				},
			},
			fileManager: {
				processFrontMatter: async () => { throw new Error('Address was already written by the template'); },
			},
		};
		const source = readFileSync('extras/templater-metabind/newRv.js', 'utf8');
		const load = new Function('module', 'exports', 'app', 'Notice', `${source}\nreturn module.exports;`) as (
			module: { exports: unknown },
			exports: unknown,
			app: unknown,
			Notice: new (message: string) => unknown,
		) => (tp: unknown) => Promise<{ addressYaml: string; created: string; stamp: string; title: string }>;
		const module = { exports: {} as unknown };
		const newRv = load(module, module.exports, app, class Notice { constructor(_message: string) {} });
		let renamed = '';
		const prompts = ['Alex', address];
		const rv = await newRv({
			system: { prompt: async () => prompts.shift() ?? '' },
			file: {
				creation_date: () => created,
				rename: async (next: string) => { renamed = next; },
				path: 'Untitled.md',
			},
			config: { target_file: target },
			hooks: { on_all_templates_executed: (callback: () => Promise<void>) => { hooks.push(callback); } },
		});
		assert.equal(renamed, 'Alex on Maple');
		assert.equal(rv.title, 'Alex on Maple');
		assert.equal(rv.stamp, stamp);
		assert.equal(rv.created, created);
		assert.equal(hooks.length, 1);

		const template = readFileSync('extras/templater-metabind/New RV.md', 'utf8');
		const rendered = template
			.replace(/^<%\*[\s\S]*?-%>\n/, '')
			.replaceAll('<% rv.addressYaml %>', rv.addressYaml)
			.replaceAll('<% rv.created %>', rv.created)
			.replaceAll('<% rv.stamp %>', rv.stamp);
		assert.equal(rendered.includes('<%'), false);
		writeFileSync(file, rendered);
		const createdText = readFileSync(file, 'utf8');
		console.log(`\n----- NEW RV BEFORE GEOCODE ${file} -----\n${createdText}`);
		assert.equal(addressLine(createdText), `Address: ${yamlQuote(address)}`);
		assert.equal(createdText.includes(`Met: ${yamlQuote(created)}`), true);
		assert.equal(createdText.includes(`Last Spoke: ${yamlQuote(created)}`), true);
		assert.equal(createdText.includes(`Last Attempted: ${yamlQuote(created)}`), true);
		assert.equal(createdText.includes('Visits: 0'), true);
		assert.equal(createdText.includes(`## ${stamp}`), true);
		assert.equal(createdText.includes('## Attempt Log'), true);
		assert.equal(createdText.includes(`- ${stamp} — success`), true);
		assert.equal(createdText.includes('Location:'), false);

		const hook = hooks[0];
		assert.ok(hook);
		await hook();
		for (let attempt = 0; executed.length === 0 && attempt < 20; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		assert.deepEqual(executed, ['rv-locator:geocode-current-note']);
		await pending;
		const disk = readFileSync(file, 'utf8');
		console.log(`\n----- NEW RV AFTER GEOCODE ${file} -----\n${disk}`);
		assert.equal(file.endsWith('Alex on Maple.md'), true);
		assertLanded(disk, address);
		assert.equal(disk.includes(`## ${stamp}`), true);
		assert.equal(disk.includes('## Attempt Log'), true);
		assert.equal(disk.includes(`- ${stamp} — success`), true);
		assert.equal(disk.includes(`Met: ${yamlQuote(created)}`), true);
		assert.equal(disk.includes('Visits: 0'), true);
		assert.equal(disk.includes('rv-dashboard'), true);
		assert.equal(bodyOf(disk).includes(`## ${stamp}`), true);
	});
});

function note(address: string): string {
	return ['---', `Address: ${yamlQuote(address)}`, '---', '', 'Body.', ''].join('\n');
}
