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
import { googleMapsAddressLink } from '../src/address';
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
import { applyVisitBody, applyVisitFrontmatter, type VisitOutcome } from '../src/visit-log';

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
	assert.equal(markdown.includes(`Map Link: ${yamlQuote(googleMapsAddressLink(address))}`), true, markdown);
	assert.equal(markdown.includes(`maps?q=${LAT}`), false, markdown);
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
		) => (tp: unknown) => Promise<{ addressYaml: string; created: string; stamp: string; title: string; mapUrl: string }>;
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
		assert.equal(rv.mapUrl, googleMapsAddressLink(address));
		assert.equal(hooks.length, 1);

		const template = readFileSync('extras/templater-metabind/New RV.md', 'utf8');
		const rendered = template
			.replace(/^<%\*[\s\S]*?-%>\n/, '')
			.replaceAll('<% rv.addressYaml %>', rv.addressYaml)
			.replaceAll('<% rv.created %>', rv.created)
			.replaceAll('<% rv.stamp %>', rv.stamp)
			.replaceAll('<% rv.mapUrl %>', rv.mapUrl);
		assert.equal(rendered.includes('<%'), false);
		writeFileSync(file, rendered);
		const createdText = readFileSync(file, 'utf8');
		console.log(`\n----- NEW RV BEFORE GEOCODE ${file} -----\n${createdText}`);
		assert.equal(addressLine(createdText), `Address: ${yamlQuote(address)}`);
		assert.equal(createdText.includes(`Met: ${yamlQuote(created)}`), true);
		assert.equal(createdText.includes(`Last Spoke: ${yamlQuote(created)}`), true);
		assert.equal(createdText.includes(`Last Attempted: ${yamlQuote(created)}`), true);
		assert.equal(createdText.includes('Visits: 1'), true);
		assert.equal(createdText.includes('Successful Visits: 1'), true);
		assert.equal(createdText.includes('> **Hubs:** `INPUT[inlineListSuggester(optionQuery("")):Hub]`\n> **Address:** `INPUT[text:Address]` [🗺️](' + rv.mapUrl + ')\n'), true);
		assert.equal(createdText.includes('VIEW[{["Map Link"]}]'), false);
		assert.equal(createdText.includes('VIEW[{Map Link}]'), false);
		assert.equal(createdText.includes('Map Link:'), false);
		assert.equal(createdText.includes('> [!rv]- 👤 RV Dashboard'), true);
		assert.equal(createdText.includes('> [!info]-'), false);
		assert.equal(createdText.includes('Log visit'), false);
		assert.equal(createdText.includes('`BUTTON[rv-log-home, rv-log-miss]`'), true);
		assert.equal(createdText.includes('templateFile: Templates/RV Log Home.md'), true);
		assert.equal(createdText.includes('templateFile: Templates/RV Log Miss.md'), true);
		assert.equal(createdText.includes('INPUT[number:["Successful Visits"]]'), true);
		assert.equal(createdText.includes('INPUT[dateTime:["Last Attempted"]]'), true);
		assert.equal(createdText.includes('City'), false);
		const hubsAt = createdText.indexOf('> **Hubs:**');
		const addressInputAt = createdText.indexOf('> **Address:** `INPUT[text:Address]`');
		const iconAt = createdText.indexOf(`[🗺️](${rv.mapUrl})`);
		const buttonAt = createdText.indexOf('`BUTTON[rv-log-home, rv-log-miss]`');
		const dividerAt = createdText.indexOf('\n---\n\n> [!rv]- 👤 RV Dashboard');
		const dashAt = createdText.indexOf('> [!rv]- 👤 RV Dashboard');
		const stampAt = createdText.indexOf(`### ${stamp}`);
		const logAt = createdText.indexOf('> [!note]- Attempt Log');
		assert.ok(hubsAt >= 0 && hubsAt < addressInputAt && addressInputAt < iconAt && iconAt < buttonAt);
		assert.ok(buttonAt < dividerAt && dividerAt < dashAt && dashAt < stampAt && stampAt < logAt);
		const callout = createdText.slice(dashAt, stampAt);
		assert.equal(callout.includes('inlineListSuggester'), false);
		assert.ok(callout.indexOf('**Priority**') < callout.indexOf('**Visits**'));
		assert.ok(callout.indexOf('**Visits**') < callout.indexOf('**Successful Visits**'));
		assert.ok(callout.indexOf('**Successful Visits**') < callout.indexOf('**Met**'));
		assert.ok(callout.indexOf('**Met**') < callout.indexOf('**Last Spoke**'));
		assert.ok(callout.indexOf('**Last Spoke**') < callout.indexOf('**Last Attempted**'));
		assert.ok(callout.indexOf('**Last Attempted**') < callout.indexOf('**Met With**'));
		assert.ok(callout.indexOf('**Met With**') < callout.indexOf('**Taken**'));
		assert.match(createdText, /`BUTTON\[rv-log-home, rv-log-miss\]`\n\n---\n/);
		assert.ok(logAt < createdText.indexOf('id: rv-log-home'));
		assert.equal(createdText.includes(`### ${stamp}`), true);
		assert.equal(createdText.split('\n').filter((line) => line === `### ${stamp}`).length, 1);
		const stampLine = createdText.split('\n').findIndex((line) => line === `### ${stamp}`);
		const createdLines = createdText.split('\n');
		assert.equal(createdLines[stampLine + 1], '');
		assert.equal(createdLines[stampLine + 2], '> [!note]- Attempt Log');
		assert.equal(createdText.includes('## Attempt Log'), false);
		assert.equal(createdText.includes('> [!note]- Attempt Log'), true);
		assert.equal(createdText.includes(`> - ${stamp} — success`), true);
		assert.equal(createdText.split('\n').filter((line) => line === `> - ${stamp} — success`).length, 1);
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
		assert.equal(disk.includes(`### ${stamp}`), true);
		assert.equal(disk.split('\n').filter((line) => line === `### ${stamp}`).length, 1);
		assert.equal(disk.includes(`[🗺️](${rv.mapUrl})`), true);
		assert.equal(disk.includes('## Attempt Log'), false);
		assert.equal(disk.includes('> [!note]- Attempt Log'), true);
		assert.equal(disk.includes(`> - ${stamp} — success`), true);
		assert.equal(disk.split('\n').filter((line) => line === `> - ${stamp} — success`).length, 1);
		assert.equal(disk.includes(`Met: ${yamlQuote(created)}`), true);
		assert.equal(disk.includes('Visits: 1'), true);
		assert.equal(disk.includes('Successful Visits: 1'), true);
		assert.equal(disk.includes('rv-dashboard'), true);
		assert.equal(bodyOf(disk).includes(`### ${stamp}`), true);
		const loggedBody = bodyOf(disk);
		assert.ok(loggedBody.indexOf(`### ${stamp}`) < loggedBody.indexOf('> [!note]- Attempt Log'));
	});

	it('writes a home visit to disk without touching Address, and a miss appends inside the callout', () => {
		const dir = join(ROOT, 'visit-log');
		resetDir(dir);
		const now = new Date(2026, 8, 26, 23, 12, 4);
		const address = '142 Maple Street, Orlando';
		const before = [
			'---',
			`Address: ${yamlQuote(address)}`,
			'Visits: 2',
			'Successful Visits: 1',
			'Last Spoke: "2026-09-01T10:00:00"',
			'---',
			'',
			'Talked on the porch.',
			'',
		].join('\n');
		const file = join(dir, 'home.md');
		writeFileSync(file, before);
		const home = commitVisit(before, 'home', now);
		writeFileSync(file, home);
		const disk = readFileSync(file, 'utf8');
		console.log(`\n----- VISIT HOME ${file} -----\n${disk}`);
		assert.equal(addressLine(disk), addressLine(before));
		assert.equal(disk.includes('Visits: 3'), true);
		assert.equal(disk.includes('Successful Visits: 2'), true);
		assert.equal(disk.includes('Last Attempted: "2026-09-26T23:12:04"'), true);
		assert.equal(disk.includes('Last Spoke: "2026-09-26T23:12:04"'), true);
		assert.equal(disk.includes('## Attempt Log'), false);
		assert.match(disk, /### Sat, 11pm — Sep 26, 2026\n\n> \[!note\]- Attempt Log\n> - Sat, 11pm — Sep 26, 2026 — success\n$/);
		assert.ok(disk.indexOf('\n### Sat, 11pm — Sep 26, 2026') < disk.indexOf('> [!note]- Attempt Log'));
		assert.equal(bodyOf(disk).includes('Talked on the porch.'), true);

		const missFile = join(dir, 'miss.md');
		writeFileSync(missFile, disk);
		const miss = commitVisit(disk, 'miss', now);
		writeFileSync(missFile, miss);
		const missDisk = readFileSync(missFile, 'utf8');
		console.log(`\n----- VISIT MISS ${missFile} -----\n${missDisk}`);
		assert.equal(addressLine(missDisk), addressLine(before));
		assert.equal(missDisk.includes('Visits: 4'), true);
		assert.equal(missDisk.includes('Successful Visits: 2'), true);
		assert.equal(missDisk.includes('Last Spoke: "2026-09-26T23:12:04"'), true);
		assert.match(missDisk, /> \[!note\]- Attempt Log\n> - Sat, 11pm — Sep 26, 2026 — success\n> - Sat, 11pm — Sep 26, 2026 — not home\n$/);
		assert.equal(missDisk.split('\n### Sat, 11pm — Sep 26, 2026\n').length, 2);
	});

	it('migrates a legacy Attempt Log heading on disk and does not invent Address', () => {
		const dir = join(ROOT, 'visit-migrate');
		resetDir(dir);
		const now = new Date(2026, 8, 26, 23, 12, 4);
		const before = [
			'---',
			'Visits: 0',
			'---',
			'',
			'## Attempt Log',
			'- Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n');
		const file = join(dir, 'legacy.md');
		writeFileSync(file, before);
		const next = commitVisit(before, 'miss', now);
		writeFileSync(file, next);
		const disk = readFileSync(file, 'utf8');
		console.log(`\n----- VISIT MIGRATE ${file} -----\n${disk}`);
		assert.equal(disk.includes('\nAddress:'), false);
		assert.equal(disk.includes('## Attempt Log'), false);
		assert.equal(disk.includes('Visits: 1'), true);
		assert.equal(disk.includes('Last Attempted: "2026-09-26T23:12:04"'), true);
		assert.equal(disk.includes('Successful Visits:'), false);
		assert.match(disk, /> \[!note\]- Attempt Log\n> - Mon, 9am — Sep 1, 2026 — success\n> - Sat, 11pm — Sep 26, 2026 — not home\n$/);
		assert.equal(disk.includes('## Sat, 11pm — Sep 26, 2026'), false);
	});

	it('Templater rvLog creates a collapsed Attempt Log, appends, and leaves Address bytes', async () => {
		const dir = join(ROOT, 'rv-log-js');
		resetDir(dir);
		const address = '142 Maple Street, Orlando';
		const homeFile = join(dir, 'home.md');
		const before = [
			'---',
			`Address: ${yamlQuote(address)}`,
			'Visits: 2',
			'Successful Visits: 1',
			'Last Spoke: "2026-09-01T10:00:00"',
			'---',
			'',
			'Porch notes.',
			'',
		].join('\n');
		writeFileSync(homeFile, before);
		const notices: string[] = [];
		const rvLog = loadRvLog(notices);
		await rvLog({ config: { target_file: { path: homeFile } } }, 'home');
		const homeDisk = readFileSync(homeFile, 'utf8');
		console.log(`\n----- RVLOG HOME ${homeFile} -----\n${homeDisk}`);
		assert.equal(addressLine(homeDisk), `Address: ${yamlQuote(address)}`);
		assert.equal(homeDisk.includes('Visits: 3'), true);
		assert.equal(homeDisk.includes('Successful Visits: 2'), true);
		assert.match(homeDisk, /Last Attempted: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"/);
		assert.match(homeDisk, /Last Spoke: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}"/);
		assert.equal(homeDisk.includes('## Attempt Log'), false);
		const homeLines = homeDisk.split('\n');
		const homeLog = homeLines.findIndex((line) => line === '> [!note]- Attempt Log');
		assert.ok(homeLog > 1);
		assert.equal(homeLines[homeLog - 1], '');
		assert.match(homeLines[homeLog - 2] ?? '', /^### /);
		assert.match(homeLines[homeLog + 1] ?? '', /^> - .+ — success$/);
		assert.equal(homeLines.slice(0, homeLog).some((line) => line.startsWith('> - ')), false);
		assert.equal(notices.at(-1), 'Logged success');

		const missFile = join(dir, 'miss.md');
		const legacy = [
			'---',
			`Address: ${yamlQuote(address)}`,
			'Visits: 2',
			'Successful Visits: 1',
			'---',
			'',
			'## Attempt Log',
			'- Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n');
		writeFileSync(missFile, legacy);
		await rvLog({ config: { target_file: { path: missFile } } }, 'miss');
		const missDisk = readFileSync(missFile, 'utf8');
		console.log(`\n----- RVLOG MISS ${missFile} -----\n${missDisk}`);
		assert.equal(addressLine(missDisk), `Address: ${yamlQuote(address)}`);
		assert.equal(missDisk.includes('Visits: 3'), true);
		assert.equal(missDisk.includes('Successful Visits: 1'), true);
		assert.equal(missDisk.includes('## Attempt Log'), false);
		assert.match(missDisk, /> \[!note\]- Attempt Log\n> - Mon, 9am — Sep 1, 2026 — success\n> - .+ — not home\n$/);
		assert.equal(missDisk.includes('\n## '), false);
		assert.equal(notices.at(-1), 'Logged not home');

		const againFile = join(dir, 'again.md');
		writeFileSync(againFile, homeDisk);
		await rvLog({ config: { target_file: { path: againFile } } }, 'miss');
		const againDisk = readFileSync(againFile, 'utf8');
		console.log(`\n----- RVLOG APPEND ${againFile} -----\n${againDisk}`);
		assert.equal(addressLine(againDisk), `Address: ${yamlQuote(address)}`);
		assert.equal(againDisk.includes('Visits: 4'), true);
		assert.equal(againDisk.includes('Successful Visits: 2'), true);
		const againLines = againDisk.split('\n');
		const againLog = againLines.findIndex((line) => line === '> [!note]- Attempt Log');
		assert.match(againLines[againLog + 1] ?? '', /^> - .+ — success$/);
		assert.match(againLines[againLog + 2] ?? '', /^> - .+ — not home$/);

		const firstHeadings = homeDisk.split('\n').filter((line) => /^#{2,3} /.test(line));
		assert.equal(firstHeadings.length, 1);
		await rvLog({ config: { target_file: { path: homeFile } } }, 'home');
		const secondHome = readFileSync(homeFile, 'utf8');
		console.log(`\n----- RVLOG HOME AGAIN ${homeFile} -----\n${secondHome}`);
		assert.equal(addressLine(secondHome), `Address: ${yamlQuote(address)}`);
		assert.equal(secondHome.includes('Visits: 4'), true);
		assert.equal(secondHome.includes('Successful Visits: 3'), true);
		assert.deepEqual(secondHome.split('\n').filter((line) => /^#{2,3} /.test(line)), firstHeadings);
		assert.equal(secondHome.split('\n').filter((line) => /^> - .+ — success$/.test(line)).length, 2);

		const laterFile = join(dir, 'later.md');
		writeFileSync(laterFile, [
			'---',
			`Address: ${yamlQuote(address)}`,
			'Visits: 1',
			'Successful Visits: 1',
			'---',
			'',
			'## Mon, 9am — Sep 1, 2026',
			'',
			'> [!note]- Attempt Log',
			'> - Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n'));
		await rvLog({ config: { target_file: { path: laterFile } } }, 'home');
		const laterDisk = readFileSync(laterFile, 'utf8');
		console.log(`\n----- RVLOG LATER STAMP ${laterFile} -----\n${laterDisk}`);
		assert.equal(addressLine(laterDisk), `Address: ${yamlQuote(address)}`);
		assert.equal(laterDisk.includes('Visits: 2'), true);
		assert.equal(laterDisk.includes('Successful Visits: 2'), true);
		const laterHeadings = laterDisk.split('\n').filter((line) => /^#{2,3} /.test(line));
		assert.equal(laterHeadings[0], '## Mon, 9am — Sep 1, 2026');
		assert.equal(laterHeadings.length, 2);
		assert.equal(laterHeadings[1]?.startsWith('### '), true);
		assert.notEqual(laterHeadings[1], laterHeadings[0]);
	});
});

function commitVisit(markdown: string, outcome: VisitOutcome, now: Date): string {
	const frontmatter = parseFrontmatter(markdown);
	const before = { ...frontmatter };
	const addressBefore = frontmatter.Address;
	applyVisitFrontmatter(frontmatter, outcome, now);
	assert.equal(frontmatter.Address, addressBefore);
	let next = markdown;
	const keys = new Set([...Object.keys(before), ...Object.keys(frontmatter)]);
	for (const key of keys) {
		if (key.toLowerCase() === 'address') continue;
		if (before[key] === frontmatter[key]) continue;
		const value = frontmatter[key];
		const rendered = typeof value === 'number' ? String(value) : yamlQuote(String(value ?? ''));
		next = replaceTopLevel(next, key, [`${key}: ${rendered}`]);
	}
	if (markdown.includes('\nAddress:')) assert.equal(addressLine(next), addressLine(markdown));
	else assert.equal(next.includes('\nAddress:'), false);
	const nl = next.startsWith('---\r\n') ? '\r\n' : '\n';
	const start = 3 + nl.length;
	const close = `${nl}---`;
	const end = next.indexOf(close, start);
	if (end < 0) throw new Error('frontmatter did not close');
	const head = next.slice(0, end + close.length);
	return head + applyVisitBody(bodyOf(next), outcome, now);
}

function loadRvLog(notices: string[]): (tp: unknown, kind: string) => Promise<void> {
	const source = readFileSync('extras/templater-metabind/rvLog.js', 'utf8');
	const load = new Function('module', 'exports', 'app', 'Notice', `${source}\nreturn module.exports;`) as (
		module: { exports: unknown },
		exports: unknown,
		app: unknown,
		Notice: new (message: string) => unknown,
	) => (tp: unknown, kind: string) => Promise<void>;
	const module = { exports: {} as unknown };
	const app = {
		vault: {
			read: async (note: { path: string }) => readFileSync(note.path, 'utf8'),
			modify: async (note: { path: string }, text: string) => { writeFileSync(note.path, text); },
			getAbstractFileByPath: () => null,
		},
		workspace: { getActiveFile: () => null },
		fileManager: {
			processFrontMatter: async (file: { path: string }, updater: (fm: Record<string, unknown>) => void) => {
				const text = readFileSync(file.path, 'utf8');
				const fm = parseFrontmatter(text);
				for (const key of Object.keys(fm)) {
					const value = fm[key];
					if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) fm[key] = Number(value);
				}
				const addressBefore = fm.Address;
				const snapshot: Record<string, unknown> = { ...fm };
				updater(fm);
				if (fm.Address !== addressBefore) {
					throw new Error(`rvLog changed Address from ${String(addressBefore)} to ${String(fm.Address)}`);
				}
				let next = text;
				const keys = new Set([...Object.keys(snapshot), ...Object.keys(fm)]);
				for (const key of keys) {
					if (key.toLowerCase() === 'address') continue;
					if (snapshot[key] === fm[key]) continue;
					const value = fm[key];
					const rendered = typeof value === 'number' ? String(value) : yamlQuote(String(value ?? ''));
					next = replaceTopLevel(next, key, [`${key}: ${rendered}`]);
				}
				if (text.includes('\nAddress:')) assert.equal(addressLine(next), addressLine(text));
				writeFileSync(file.path, next);
			},
		},
	};
	return load(module, module.exports, app, class Notice {
		constructor(message: string) { notices.push(message); }
	});
}

function note(address: string): string {
	return ['---', `Address: ${yamlQuote(address)}`, '---', '', 'Body.', ''].join('\n');
}
