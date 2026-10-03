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
import { createCompanionPromptGate } from '../src/companion-prompt';
import { formatStoredCompanion } from '../src/companions';
import { formatExactVisitStamp, formatGlancableVisitStamp } from '../src/dates';
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

function frontmatterBlock(key: string, value: unknown, flattenWikilinks = false): string[] {
	if (Array.isArray(value)) {
		return [key + ':', ...value.map((item) => renderFrontmatterItem(item, flattenWikilinks))];
	}
	const rendered = typeof value === 'number' ? String(value) : yamlQuote(String(value ?? ''));
	return [`${key}: ${rendered}`];
}

function renderFrontmatterItem(item: unknown, flattenWikilinks: boolean): string {
	const text = String(item ?? '');
	const link = /^\[\[([^\]]+)\]\]$/.exec(text);
	if (flattenWikilinks && link) return `  - - ${link[1]}`;
	return `  - ${yamlQuote(text)}`;
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
		const cardStamp = formatGlancableVisitStamp(new Date(2026, 8, 9, 13, 38, 3));
		assert.equal(cardStamp, 'Wed, 2pm — Sep 9, 2026');
		const stamp = formatExactVisitStamp(new Date(2026, 8, 9, 13, 38, 3));
		assert.equal(stamp, 'Wed, 1:38pm — Sep 9, 2026');
		const title = rvNoteTitle('Alex', address);
		assert.equal(title, 'Alex on Maple Street');
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
		) => (tp: unknown) => Promise<{ addressYaml: string; created: string; stamp: string; title: string; mapUrl: string; priority: number; companionYaml: string }>;
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
		assert.equal(renamed, 'Alex on Maple Street');
		assert.equal(rv.title, 'Alex on Maple Street');
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
			.replaceAll('<% rv.ago %>', rv.ago)
			.replaceAll('<% rv.mapUrl %>', rv.mapUrl)
			.replaceAll('<% rv.priority %>', String(rv.priority))
			.replaceAll('<% rv.companionYaml %>', rv.companionYaml)
			.replaceAll('<% rv.companionSuffix %>', rv.companionSuffix)
			.replaceAll('<% rv.gender %>', '');
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
		assert.equal(createdText.includes('> [!quote] RV Dashboard\n>**Hub:** `INPUT[inlineList:Hub]`\n>**Address:** `INPUT[text:Address]` [🗺️](' + rv.mapUrl + ')\n'), true);
		assert.equal(createdText.includes('Status: Active\n'), true);
		assert.equal(createdText.includes('Gender: ""\n'), true);
		assert.equal(createdText.includes('inlineListSuggester'), false);
		assert.equal(createdText.includes('> **Hubs:**      '), false);
		assert.equal(createdText.includes('VIEW[{["Map Link"]}]'), false);
		assert.equal(createdText.includes('VIEW[{Map Link}]'), false);
		assert.equal(createdText.includes('Map Link:'), false);
		assert.equal(createdText.includes('> > [!rv]- Quick Facts'), true);
		assert.equal(createdText.includes('> [!rv]- 👤 RV Dashboard'), false);
		assert.equal(createdText.includes('> [!info]-'), false);
		assert.equal(createdText.includes('Log visit'), false);
		assert.equal(createdText.includes('`BUTTON[rv-log-home, rv-log-miss, rv-log-past, rv-log-housemate, rv-archive]`'), true);
		assert.equal(createdText.split('\n').filter((line) => line === 'class: rv-visit-btn').length, 5);
		assert.equal(createdText.includes('    command: rv-locator:log-past-visit\n'), true);
		assert.equal(createdText.includes('    command: rv-locator:archive-rv\n'), true);
		assert.equal(createdText.includes('Priority: 4\n'), true);
		assert.equal(createdText.includes('\nMet With:\nTaken:\n'), true);
		assert.equal(createdText.includes('templateFile: Templates/99 RV Log Home.md'), true);
		assert.equal(createdText.includes('templateFile: Templates/99 RV Log Miss.md'), true);
		assert.equal(createdText.includes('INPUT[number:["Successful Visits"]]'), true);
		assert.equal(createdText.includes('INPUT[dateTime:["Last Attempted"]]'), true);
		assert.equal(createdText.includes('City'), false);
		const hubsAt = createdText.indexOf('>**Hub:**');
		const addressInputAt = createdText.indexOf('>**Address:** `INPUT[text:Address]`');
		const iconAt = createdText.indexOf(`[🗺️](${rv.mapUrl})`);
		const buttonAt = createdText.indexOf('`BUTTON[rv-log-home, rv-log-miss, rv-log-past, rv-log-housemate, rv-archive]`');
		const factsAt = createdText.indexOf('> > [!rv]- Quick Facts');
		const ruleAt = createdText.indexOf('\n---\n### Recent Notes:');
		const stampAt = createdText.indexOf(`##### ${stamp}`);
		const suggestionsAt = createdText.indexOf('> [!example] Return Suggestions');
		const digestAt = createdText.indexOf('> No May-go-out days');
		const logAt = createdText.indexOf('> > [!note]- Attempt Log');
		assert.ok(hubsAt >= 0 && hubsAt < addressInputAt && addressInputAt < iconAt && iconAt < buttonAt);
		assert.ok(buttonAt < factsAt && factsAt < ruleAt && ruleAt < stampAt && stampAt < suggestionsAt && suggestionsAt < digestAt && digestAt < logAt);
		const callout = createdText.slice(factsAt, ruleAt);
		assert.equal(callout.includes('inlineListSuggester'), false);
		assert.ok(callout.indexOf('**Status**') < callout.indexOf('**Priority**'));
		assert.ok(callout.indexOf('**Priority**') < callout.indexOf('**Visits**'));
		assert.ok(callout.indexOf('**Visits**') < callout.indexOf('**Last Spoke**'));
		assert.ok(callout.indexOf('**Last Spoke**') < callout.indexOf('**Last Attempted**'));
		assert.ok(callout.indexOf('**Last Attempted**') < callout.indexOf('**Met**'));
		assert.ok(callout.indexOf('**Met**') < callout.indexOf('**Taken**'));
		assert.equal(callout.includes('**Met With**'), false);
		assert.match(createdText, /`BUTTON\[rv-log-home, rv-log-miss, rv-log-past, rv-log-housemate, rv-archive\]`\n>\n> > \[!rv\]- Quick Facts/);
		assert.equal(createdText.includes('Notes would go here'), false);
		assert.match(createdText, /\n---\n\n```meta-bind-button\n/);
		const archiveAt = createdText.indexOf('id: rv-archive');
		const dashAt = createdText.indexOf('> [!quote] RV Dashboard');
		assert.ok(archiveAt > 0 && createdText.indexOf('id: rv-log-home') < dashAt && archiveAt < dashAt && dashAt < buttonAt);
		assert.equal(createdText.includes(`##### ${stamp}`), true);
		assert.equal(createdText.split('\n').filter((line) => line === `##### ${stamp} <span class="rv-stamp-ago">${rv.ago}</span>`).length, 1);
		const stampLine = createdText.split('\n').findIndex((line) => line === `##### ${stamp} <span class="rv-stamp-ago">${rv.ago}</span>`);
		const createdLines = createdText.split('\n');
		assert.equal(createdLines[stampLine - 1], '### Recent Notes:');
		assert.equal(createdLines[stampLine - 2], '---');
		assert.equal(createdLines[stampLine + 1], '`INPUT[textArea:sVisit1Notes]`');
		assert.equal(createdLines[stampLine + 2], '');
		assert.equal(createdLines[stampLine + 3], '---');
		assert.equal(createdLines[stampLine + 4], '> [!example] Return Suggestions');
		assert.equal(createdLines[stampLine + 5], '> No May-go-out days');
		assert.equal(createdLines[stampLine + 6], '>');
		assert.equal(createdLines[stampLine + 7], '> > [!note]- Attempt Log');
		assert.equal(createdLines[stampLine + 8], '> >');
		assert.equal(createdLines[stampLine + 9], '> >| | Mor | Aft | Eve |');
		assert.equal(createdLines.includes('> >| Sun | 0/0 | 0/0 | 0/0 |'), true);
		assert.equal(createdLines.includes('> >| Sat | 0/0 | 0/0 | 0/0 |'), true);
		assert.equal(createdLines.includes('> >| Sun | — | — | — |'), false);
		assert.equal(createdText.includes('## Attempt Log'), false);
		assert.equal(createdText.includes('> > [!note]- Attempt Log'), true);
		assert.equal(createdText.includes('> [!note]+ Attempt Log'), false);
		assert.equal(createdText.includes('%% rv-locator-digest %%'), false);
		assert.equal(createdText.includes('%% /rv-locator-digest %%'), false);
		assert.equal(createdText.includes('<!-- rv-locator-digest -->'), false);
		assert.ok(createdText.indexOf('> No May-go-out days') < createdText.indexOf('> > [!note]- Attempt Log'));
		assert.ok(createdText.indexOf('> > [!note]- Attempt Log') < createdText.indexOf(`> >- ${stamp} — success`));
		assert.equal(createdText.includes(`> >- ${stamp} — success`), true);
		assert.equal(createdText.split('\n').filter((line) => line === `> >- ${stamp} — success`).length, 1);
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
		assert.equal(file.endsWith('Alex on Maple Street.md'), true);
		assertLanded(disk, address);
		assert.equal(disk.includes(`##### ${stamp}`), true);
		assert.equal(disk.split('\n').filter((line) => line.startsWith(`##### ${stamp} `)).length, 1);
		assert.equal(disk.includes(`[🗺️](${rv.mapUrl})`), true);
		assert.equal(disk.includes('## Attempt Log'), false);
		assert.equal(disk.includes('> > [!note]- Attempt Log'), true);
		assert.equal(disk.includes(`> >- ${stamp} — success`), true);
		assert.equal(disk.split('\n').filter((line) => line === `> >- ${stamp} — success`).length, 1);
		assert.equal(disk.includes(`Met: ${yamlQuote(created)}`), true);
		assert.equal(disk.includes('Visits: 1'), true);
		assert.equal(disk.includes('Successful Visits: 1'), true);
		assert.equal(disk.includes('rv-dashboard'), true);
		assert.equal(bodyOf(disk).includes(`##### ${stamp}`), true);
		const loggedBody = bodyOf(disk);
		assert.ok(loggedBody.indexOf(`##### ${stamp}`) < loggedBody.indexOf('> > [!note]- Attempt Log'));
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
		assert.match(disk, /##### Sat, 11:12pm — Sep 26, 2026 <span class="rv-stamp-ago">Today<\/span>\n`INPUT\[textArea:sVisit1Notes\]`\n\n> \[!note\]\- Attempt Log\n> - Sat, 11:12pm — Sep 26, 2026 — success\n$/);
		assert.ok(disk.indexOf('\n##### Sat, 11:12pm — Sep 26, 2026') < disk.indexOf('> [!note]- Attempt Log'));
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
		assert.match(missDisk, /> \[!note\]\- Attempt Log\n> - Sat, 11:12pm — Sep 26, 2026 — success\n> - Sat, 11:12pm — Sep 26, 2026 — not home\n$/);
		assert.equal(missDisk.split('\n').filter((line) => line.startsWith('##### Sat, 11:12pm — Sep 26, 2026 <span class="rv-stamp-ago">')).length, 1);
	});

	it('appends a home companion to Taken on disk and leaves Met With', () => {
		const dir = join(ROOT, 'visit-companion');
		resetDir(dir);
		const now = new Date(2026, 8, 26, 23, 12, 4);
		const address = '142 Maple Street, Orlando';
		const before = [
			'---',
			`Address: ${yamlQuote(address)}`,
			'Visits: 1',
			'Successful Visits: 1',
			'Met With: "Door"',
			'Taken:',
			'  - "Ada"',
			'---',
			'',
			'> [!note]- Attempt Log',
			'> - Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n');
		const file = join(dir, 'home.md');
		writeFileSync(file, before);
		const home = commitVisit(before, 'home', now, 'TestCompanion');
		writeFileSync(file, home);
		const disk = readFileSync(file, 'utf8');
		console.log(`\n----- VISIT COMPANION ${file} -----\n${disk}`);
		assert.equal(addressLine(disk), addressLine(before));
		assert.equal(disk.includes('---###'), false);
		assert.equal(disk.includes('\n##### Sat, 11:12pm — Sep 26, 2026 <span class="rv-stamp-ago">Today</span>\n'), true);
		assert.equal(disk.includes('Met With: "Door"'), true);
		assert.equal(disk.includes('Met With: "TestCompanion"'), false);
		assert.equal(disk.includes('  - "Ada"'), true);
		assert.equal(disk.includes('  - "TestCompanion"'), true);
		assert.equal(disk.split('  - "TestCompanion"').length, 2);
		assert.equal(disk.includes('Visits: 2'), true);
		assert.equal(disk.includes('Successful Visits: 2'), true);

		const again = commitVisit(disk, 'home', now, 'TestCompanion');
		writeFileSync(file, again);
		const againDisk = readFileSync(file, 'utf8');
		assert.equal(againDisk.includes('Met With: "Door"'), true);
		assert.equal(againDisk.split('  - "TestCompanion"').length, 2);
		assert.equal(againDisk.includes('Visits: 3'), true);
		assert.equal(againDisk.includes('Successful Visits: 3'), true);
		assert.equal(againDisk.split('\n').filter((line) => line === '##### Sat, 11:12pm — Sep 26, 2026 <span class="rv-stamp-ago">Today</span>').length, 2);
		assert.equal(againDisk.split('\n').filter((line) => line.endsWith('— success')).length, 1);
		assert.equal(againDisk.split('\n').filter((line) => line.endsWith('— success with TestCompanion')).length, 2);

		const skipped = commitVisit(againDisk, 'home', now, '  ');
		writeFileSync(file, skipped);
		const skipDisk = readFileSync(file, 'utf8');
		assert.equal(skipDisk.includes('Met With: "Door"'), true);
		assert.equal(skipDisk.split('  - "TestCompanion"').length, 2);
		assert.equal(skipDisk.includes('Visits: 4'), true);

		const missed = commitVisit(skipDisk, 'miss', now, 'Pat');
		writeFileSync(file, missed);
		const missDisk = readFileSync(file, 'utf8');
		assert.equal(addressLine(missDisk), addressLine(before));
		assert.equal(missDisk.includes('Met With: "Door"'), true);
		assert.equal(missDisk.includes('Met With: "Pat"'), false);
		assert.equal(missDisk.split('  - "TestCompanion"').length, 2);
		assert.equal(missDisk.includes('  - "Pat"'), false);
		assert.equal(missDisk.includes('— not home'), true);
		assert.equal(missDisk.includes('Visits: 5'), true);
		assert.equal(missDisk.includes('Successful Visits: 4'), true);
		assert.equal(missDisk.includes('Last Attempted: "2026-09-26T23:12:04"'), true);
		assert.equal(missDisk.split('\n').filter((line) => line === '##### Sat, 11:12pm — Sep 26, 2026 <span class="rv-stamp-ago">Today</span>').length, 3);
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
		assert.match(disk, /> \[!note\]\- Attempt Log\n> - Mon, 9am — Sep 1, 2026 — success\n> - Sat, 11:12pm — Sep 26, 2026 — not home\n$/);
		assert.equal(disk.includes('## Sat, 11:12pm — Sep 26, 2026'), false);
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
		assert.equal(homeLines[homeLog - 2], '`INPUT[textArea:sVisit1Notes]`');
		assert.match(homeLines[homeLog - 3] ?? '', /^##### .+<span class="rv-stamp-ago">Today<\/span>$/);
		assert.equal(homeLines.includes('### Recent Notes:'), true);
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
		assert.match(missDisk, /> \[!note\]\- Attempt Log\n> - Mon, 9am — Sep 1, 2026 — success\n> - .+ — not home\n$/);
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

		const firstHeadings = homeDisk.split('\n').filter((line) => line.startsWith('##### '));
		assert.equal(firstHeadings.length, 1);
		await rvLog({ config: { target_file: { path: homeFile } } }, 'home');
		const secondHome = readFileSync(homeFile, 'utf8');
		console.log(`\n----- RVLOG HOME AGAIN ${homeFile} -----\n${secondHome}`);
		assert.equal(addressLine(secondHome), `Address: ${yamlQuote(address)}`);
		assert.equal(secondHome.includes('Visits: 4'), true);
		assert.equal(secondHome.includes('Successful Visits: 3'), true);
		const secondHeadings = secondHome.split('\n').filter((line) => line.startsWith('##### '));
		assert.deepEqual(secondHeadings, [firstHeadings[0], firstHeadings[0]]);
		const secondLines = secondHome.split('\n');
		const secondStamps = secondLines.flatMap((line, index) => line.startsWith('##### ') ? [index] : []);
		assert.deepEqual(secondStamps.map((index) => secondLines[index + 1]), ['`INPUT[textArea:sVisit2Notes]`', '`INPUT[textArea:sVisit1Notes]`']);
		assert.equal(secondLines[(secondStamps[1] ?? 0) - 1], '');
		assert.equal(secondHome.split('\n').filter((line) => /^> - .+ — success$/.test(line)).length, 2);
		assert.equal(notices.at(-1), 'Logged success');

		await rvLog({ config: { target_file: { path: missFile } } }, 'miss');
		const secondMiss = readFileSync(missFile, 'utf8');
		assert.equal(addressLine(secondMiss), `Address: ${yamlQuote(address)}`);
		assert.equal(secondMiss.includes('Visits: 4'), true);
		assert.equal(secondMiss.includes('Successful Visits: 1'), true);
		assert.equal(secondMiss.split('\n').filter((line) => line.includes('— not home')).length, 2);
		assert.equal(secondMiss.includes('\n### '), false);
		assert.equal(notices.at(-1), 'Logged not home');

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
		const laterHeadings = laterDisk.split('\n').filter((line) => /^## /.test(line) || line.startsWith('##### '));
		assert.equal(laterHeadings[0]?.startsWith('##### '), true);
		assert.equal(laterHeadings.length, 2);
		assert.equal(laterHeadings[1], '## Mon, 9am — Sep 1, 2026');
		assert.equal(laterDisk.includes('### Recent Notes:'), true);
		assert.notEqual(laterHeadings[1], laterHeadings[0]);
	});

	it('home stores one recent companion and a miss does not ask', async () => {
		const dir = join(ROOT, 'companion');
		resetDir(dir);
		const address = '142 Maple Street, Orlando';
		const homeFile = join(dir, 'home.md');
		writeFileSync(homeFile, [
			'---',
			`Address: ${yamlQuote(address)}`,
			'Visits: 1',
			'Successful Visits: 1',
			'Met With: "Door"',
			'Taken:',
			'  - "Ada"',
			'---',
			'',
			'> [!note]- Attempt Log',
			'> - Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n'));
		const files = [
			{ path: 'People/Pat Smith.md', basename: 'Pat Smith', stat: { mtime: 1 } },
			{ path: 'Notes/older.md', basename: 'older', stat: { mtime: 1 } },
		];
		const caches = new Map<string, Record<string, unknown>>([
			['People/Pat Smith.md', { 'Met With': '[[Pat Smith]]', Taken: ['Pat Smith'], 'Last Spoke': '2026-09-20T15:00:00' }],
			['Notes/older.md', { 'Met With': 'Jane', Taken: ['Jane', 'Sam'], 'Last Spoke': '2026-01-01T09:00:00' }],
		]);
		const notices: string[] = [];
		let seen: string[] = [];
		const rvLog = loadRvLog(notices, {
			getMarkdownFiles: () => files,
			getFileCache: (file: { path?: string }) => ({ frontmatter: caches.get(file.path ?? '') }),
			plugins: { plugins: { 'rv-locator': { settings: { linkCompanionsToNotes: true } } } },
		});
		await rvLog({
			config: { target_file: { path: homeFile } },
			system: {
				suggester: async (_label: unknown, choices: { kind?: string; name?: string }[]) => {
					seen = choices.filter((item) => item.kind === 'recent').map((item) => item.name ?? '');
					return choices.find((item) => item.name === 'Pat Smith') ?? null;
				},
				prompt: async () => { throw new Error('free text should not run when a recent name is chosen'); },
			},
		}, 'home');
		assert.deepEqual(seen, ['Pat Smith', 'Jane', 'Sam']);
		const disk = readFileSync(homeFile, 'utf8');
		console.log(`\n----- RVLOG COMPANION ${homeFile} -----\n${disk}`);
		assert.equal(addressLine(disk), `Address: ${yamlQuote(address)}`);
		assert.equal(disk.includes('Met With: "Door"'), true);
		assert.equal(disk.includes('[[Pat Smith]]'), false);
		assert.equal(disk.includes('  - "Ada"'), true);
		assert.equal(disk.includes('  - "Pat Smith"'), true);
		assert.equal(disk.split('  - "Pat Smith"').length, 2);
		assert.equal(disk.includes('Visits: 2'), true);
		assert.match(disk, /^> - .+ — success with Pat Smith$/m);

		const missFile = join(dir, 'miss.md');
		writeFileSync(missFile, disk);
		let missAsked = 0;
		await rvLog({
			config: { target_file: { path: missFile } },
			system: {
				suggester: async () => { missAsked += 1; return { kind: 'recent', name: 'Jane' }; },
				prompt: async () => { missAsked += 1; return 'Jane'; },
			},
		}, 'miss');
		assert.equal(missAsked, 0);
		const missDisk = readFileSync(missFile, 'utf8');
		assert.equal(addressLine(missDisk), `Address: ${yamlQuote(address)}`);
		assert.equal(missDisk.includes('Met With: "Door"'), true);
		assert.equal(missDisk.includes('[[Pat Smith]]'), false);
		assert.equal(missDisk.includes('  - "Jane"'), false);
		assert.equal(missDisk.includes('— not home'), true);
		assert.equal(notices.at(-1), 'Logged not home');
	});

	it('newRv asks for one companion after the address and seeds priority', async () => {
		const prompts = ['Ada', '10 Oak Street', 'Sam'];
		const app = {
			vault: {
				getMarkdownFiles: () => [{ path: 'People/Sam.md', basename: 'Sam', stat: { mtime: 1 } }],
				getAbstractFileByPath: () => null,
				read: async () => '',
			},
			metadataCache: { getFileCache: () => null },
			plugins: { plugins: { 'rv-locator': { settings: { defaultNewRvPriority: 4 } } } },
			workspace: { getActiveFile: () => null },
			commands: { commands: {}, executeCommandById: () => {} },
			fileManager: { processFrontMatter: async () => {} },
		};
		const rv = await loadNewRv(app)({
			system: { prompt: async () => prompts.shift() ?? '' },
			file: { creation_date: () => '2026-09-09T13:38:03', rename: async () => {}, path: 'Untitled.md' },
		});
		assert.equal(prompts.length, 0);
		assert.equal(rv.priority, 4);
		assert.equal(rv.companionYaml, 'Met With: "Sam"\nTaken:\n  - "Sam"');
		assert.equal(rv.companionSuffix, ' with Sam');
		assert.equal(rv.companionYaml.includes('[['), false);
		assert.equal(rv.title, 'Ada on Oak Street');

		const skipped = await loadNewRv({
			...app,
			plugins: { plugins: {} },
			vault: { ...app.vault, getMarkdownFiles: () => [] },
		})({
			system: { prompt: async () => '' },
			file: { creation_date: () => '2026-09-09T13:38:03', rename: async () => {}, path: 'Untitled.md' },
		});
		assert.equal(skipped.priority, 4);
		assert.equal(skipped.companionYaml, 'Met With:\nTaken:');
	});

	it('plugin promptCompanion appends Taken, leaves Met With, skip leaves both, and a miss does not ask', async () => {
		const dir = join(ROOT, 'companion-plugin');
		resetDir(dir);
		const address = '200 S Orange Ave, Orlando, FL';
		const homeFile = join(dir, 'home.md');
		const before = [
			'---',
			`Address: ${yamlQuote(address)}`,
			'Visits: 1',
			'Successful Visits: 1',
			'Met With: "Ada"',
			'Taken:',
			'  - "Ada"',
			'---',
			'',
			'> [!note]- Attempt Log',
			'> - Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n');
		writeFileSync(homeFile, before);
		let prompts = 0;
		const notices: string[] = [];
		const rvLog = loadRvLog(notices, {
			plugins: {
				plugins: {
					'rv-locator': {
						settings: {},
						promptCompanion: async () => {
							prompts += 1;
							return askedCompanion('TestCompanion');
						},
					},
				},
			},
		});
		await rvLog({
			config: { target_file: { path: homeFile } },
			system: {
				suggester: async () => { throw new Error('plugin promptCompanion should answer'); },
				prompt: async () => { throw new Error('free text should not run'); },
			},
		}, 'home');
		assert.equal(prompts, 1);
		const disk = readFileSync(homeFile, 'utf8');
		console.log(`\n----- PLUGIN COMPANION ${homeFile} -----\n${disk}`);
		assert.equal(addressLine(disk), addressLine(before));
		assert.equal(disk.includes('Met With: "Ada"'), true);
		assert.equal(disk.includes('Met With: "TestCompanion"'), false);
		assert.equal(disk.includes('  - "Ada"'), true);
		assert.equal(disk.includes('  - "TestCompanion"'), true);
		assert.equal(disk.includes('Visits: 2'), true);
		assert.equal(disk.includes('Successful Visits: 2'), true);
		assert.equal(notices.at(-1), 'Logged success');

		const skipFile = join(dir, 'skip.md');
		writeFileSync(skipFile, disk);
		const skipLog = loadRvLog(notices, {
			plugins: {
				plugins: {
					'rv-locator': {
						settings: {},
						promptCompanion: async () => {
							prompts += 1;
							return askedCompanion(null);
						},
					},
				},
			},
		});
		await skipLog({ config: { target_file: { path: skipFile } } }, 'home');
		const skipDisk = readFileSync(skipFile, 'utf8');
		assert.equal(addressLine(skipDisk), addressLine(before));
		assert.equal(skipDisk.includes('Met With: "Ada"'), true);
		assert.equal(skipDisk.includes('Met With: "TestCompanion"'), false);
		assert.equal(skipDisk.includes('  - "TestCompanion"'), true);
		assert.equal(skipDisk.split('  - "TestCompanion"').length, 2);
		assert.equal(skipDisk.includes('Visits: 3'), true);
		assert.equal(prompts, 2);

		const missFile = join(dir, 'miss.md');
		writeFileSync(missFile, skipDisk);
		const beforeMiss = prompts;
		await skipLog({ config: { target_file: { path: missFile } } }, 'miss');
		assert.equal(prompts, beforeMiss);
		const missDisk = readFileSync(missFile, 'utf8');
		assert.equal(addressLine(missDisk), addressLine(before));
		assert.equal(missDisk.includes('Met With: "Ada"'), true);
		assert.equal(missDisk.includes('Met With: "TestCompanion"'), false);
		assert.equal(missDisk.includes('— not home'), true);
		assert.equal(notices.at(-1), 'Logged not home');
	});

	it('stores a plain companion even when a note matches, and still quotes a flattened Taken wikilink', async () => {
		const dir = join(ROOT, 'companion-link');
		resetDir(dir);
		const address = '200 S Orange Ave, Orlando, FL';
		const notes = [{ path: 'People/Pat Smith.md', basename: 'Pat Smith', stat: { mtime: 1 } }];
		const homeFile = join(dir, 'home.md');
		const before = [
			'---',
			`Address: ${yamlQuote(address)}`,
			'Met With: "Ada"',
			'Taken:',
			'  - [[Existing Person]]',
			'Hub:',
			'  - [[Return Visits Hub]]',
			'---',
			'',
			'> [!note]- Attempt Log',
			'> - Mon, 9am — Sep 1, 2026 — success',
			'',
		].join('\n');
		writeFileSync(homeFile, before);
		const notices: string[] = [];
		const linked = loadRvLog(notices, {
			flattenWikilinks: true,
			getMarkdownFiles: () => notes,
			plugins: { plugins: { 'rv-locator': { settings: { linkCompanionsToNotes: true } } } },
		});
		await linked({
			config: { target_file: { path: homeFile } },
			system: {
				suggester: async () => null,
				prompt: async () => 'Pat Smith',
			},
		}, 'home');
		const disk = readFileSync(homeFile, 'utf8');
		assert.equal(addressLine(disk), addressLine(before));
		assert.equal(disk.includes('Met With: "Ada"'), true);
		assert.equal(disk.includes('[[Pat Smith]]'), false);
		assert.equal(disk.includes('  - "Pat Smith"'), true);
		assert.equal(disk.includes('  - "[[Existing Person]]"'), true);
		assert.equal(disk.includes('  - - Existing Person'), false);
		assert.equal(disk.includes('  - [[Return Visits Hub]]'), true);
	});

	it('newRv companion seed uses plugin.promptCompanion', async () => {
		const notes = [{ path: 'People/Sam.md', basename: 'Sam' }];
		const baseApp = {
			vault: {
				getMarkdownFiles: () => notes,
				getAbstractFileByPath: () => null,
				read: async () => '',
			},
			metadataCache: { getFileCache: () => null },
			workspace: { getActiveFile: () => null },
			commands: { commands: {}, executeCommandById: () => {} },
			fileManager: { processFrontMatter: async () => {} },
		};
		let textPrompts = 0;
		const prompts = ['Ada', '10 Oak Street'];
		const linked = await loadNewRv({
			...baseApp,
			plugins: {
				plugins: {
					'rv-locator': {
						settings: { defaultNewRvPriority: 3 },
						promptCompanion: async () => askedCompanion('Sam'),
					},
				},
			},
		})({
			system: {
				prompt: async () => {
					textPrompts += 1;
					return prompts.shift() ?? '';
				},
			},
			file: { creation_date: () => '2026-09-09T13:38:03', rename: async () => {}, path: 'Untitled.md' },
		});
		assert.equal(textPrompts, 2);
		assert.equal(prompts.length, 0);
		assert.equal(linked.companionYaml, 'Met With: "Sam"\nTaken:\n  - "Sam"');
		assert.equal(linked.title, 'Ada on Oak Street');

		const plainPrompts = ['Ada', '10 Oak Street'];
		const plain = await loadNewRv({
			...baseApp,
			plugins: {
				plugins: {
					'rv-locator': {
						settings: {},
						promptCompanion: async () => askedCompanion('TestCompanion'),
					},
				},
			},
		})({
			system: { prompt: async () => plainPrompts.shift() ?? '' },
			file: { creation_date: () => '2026-09-09T13:38:03', rename: async () => {}, path: 'Untitled.md' },
		});
		assert.equal(plain.companionYaml, 'Met With: "TestCompanion"\nTaken:\n  - "TestCompanion"');

		const skipped = await loadNewRv({
			...baseApp,
			plugins: {
				plugins: {
					'rv-locator': {
						settings: {},
						promptCompanion: async () => askedCompanion(null),
					},
				},
			},
		})({
			system: { prompt: async () => '' },
			file: { creation_date: () => '2026-09-09T13:38:03', rename: async () => {}, path: 'Untitled.md' },
		});
		assert.equal(skipped.companionYaml, 'Met With:\nTaken:');
	});
});

function commitVisit(markdown: string, outcome: VisitOutcome, now: Date, companion?: string | null): string {
	const frontmatter = parseFrontmatter(markdown);
	const before = { ...frontmatter };
	const addressBefore = frontmatter.Address;
	applyVisitFrontmatter(frontmatter, outcome, now, companion);
	assert.equal(frontmatter.Address, addressBefore);
	let next = markdown;
	const keys = new Set([...Object.keys(before), ...Object.keys(frontmatter)]);
	for (const key of keys) {
		if (key.toLowerCase() === 'address') continue;
		if (before[key] === frontmatter[key]) continue;
		next = replaceTopLevel(next, key, frontmatterBlock(key, frontmatter[key]));
	}
	if (markdown.includes('\nAddress:')) assert.equal(addressLine(next), addressLine(markdown));
	else assert.equal(next.includes('\nAddress:'), false);
	const nl = next.startsWith('---\r\n') ? '\r\n' : '\n';
	const start = 3 + nl.length;
	const close = `${nl}---`;
	const end = next.indexOf(close, start);
	if (end < 0) throw new Error('frontmatter did not close');
	const fenceEnd = end + close.length;
	const afterFence = next.slice(fenceEnd);
	// Obsidian's contentStart includes the newline after the closing fence.
	const separator = afterFence.startsWith(nl) ? nl : '';
	return next.slice(0, fenceEnd) + separator + applyVisitBody(afterFence.slice(separator.length), outcome, now, companion?.trim() ?? '');
}

function loadNewRv(app: unknown): (tp: unknown) => Promise<{ priority: number; companionYaml: string; title: string }> {
	const source = readFileSync('extras/templater-metabind/newRv.js', 'utf8');
	const load = new Function('module', 'exports', 'app', 'Notice', `${source}\nreturn module.exports;`) as (
		module: { exports: unknown },
		exports: unknown,
		app: unknown,
		Notice: new (message: string) => unknown,
	) => (tp: unknown) => Promise<{ priority: number; companionYaml: string; title: string }>;
	const module = { exports: {} as unknown };
	return load(module, module.exports, app, class Notice { constructor(_message: string) {} });
}

function loadRvLog(notices: string[], extra?: {
	getMarkdownFiles?: () => unknown[];
	getFileCache?: (file: { path?: string }) => { frontmatter?: Record<string, unknown> } | null;
	plugins?: unknown;
	flattenWikilinks?: boolean;
}): (tp: unknown, kind: string) => Promise<void> {
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
			getMarkdownFiles: extra?.getMarkdownFiles,
		},
		metadataCache: extra?.getFileCache ? { getFileCache: extra.getFileCache } : undefined,
		plugins: extra?.plugins,
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
					next = replaceTopLevel(next, key, frontmatterBlock(key, fm[key], extra?.flattenWikilinks === true));
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

async function askedCompanion(choice: string | null): Promise<string> {
	const picked = await new Promise<string | null>((resolve) => {
		const gate = createCompanionPromptGate(resolve);
		gate.closed((run) => { setTimeout(run, 0); });
		if (choice != null) gate.choose(choice);
	});
	const name = picked?.trim() ?? '';
	if (!name) return '';
	return formatStoredCompanion(name);
}

function note(address: string): string {
	return ['---', `Address: ${yamlQuote(address)}`, '---', '', 'Body.', ''].join('\n');
}
