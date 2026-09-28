import { DISTANCE_COLUMN_ID } from './constants';
import type { ActiveSort } from './sort';

/**
 * Active RVs in Return Visits.base. Nearby views mirror this layout in memory.
 * The map view's Hub link is a different note and is intentionally unused here.
 */
export const ACTIVE_HUB_NOTE = 'Return Visits Hub';
export const ACTIVE_EXCLUDED_FOLDER = '+/Templates';
export const ACTIVE_FILTER_OPTION = 'activeFilter';

/** Which return visits a Nearby layout keeps. Hub and folder guards apply to all three. */
export type NearbyScope = 'active' | 'all' | 'inactive';

/** Column order from the Active RVs table, without the live Distance column. */
export const ACTIVE_COLUMN_ORDER = [
	'file.name',
	'note.Priority',
	'note.Last Spoke',
	'note.Met',
	'note.Visits',
	'note.Address',
	'note.Met With',
	'note.Map Link',
] as const;

/**
 * Nearby always paints this order. A saved Base order cannot move Priority
 * away from Distance. Extras such as Taken are appended after Map Link.
 */
export const NEARBY_COLUMN_ORDER = [
	'file.name',
	DISTANCE_COLUMN_ID,
	'note.Priority',
	'note.Last Spoke',
	'note.Last Attempted',
	'note.Met',
	'note.Visits',
	'note.Successful Visits',
	'note.Address',
	'note.Met With',
	'note.Map Link',
] as const;

/** Sort chips. First tap uses `defaultDirection`. A second tap on the same chip flips it. */
export const SORT_PRESETS = [
	{
		property: DISTANCE_COLUMN_ID,
		defaultDirection: 'ASC',
		labels: { ASC: 'Nearest', DESC: 'Furthest' },
	},
	{
		property: 'note.Priority',
		defaultDirection: 'DESC',
		labels: { ASC: 'Priority · low', DESC: 'Priority · high' },
	},
	{
		property: 'note.Last Spoke',
		defaultDirection: 'ASC',
		labels: { ASC: 'Spoke · oldest', DESC: 'Spoke · newest' },
	},
	{
		property: 'note.Last Attempted',
		defaultDirection: 'ASC',
		labels: { ASC: 'Attempted · oldest', DESC: 'Attempted · newest' },
	},
	{
		property: 'note.Met',
		defaultDirection: 'DESC',
		labels: { ASC: 'Met · oldest', DESC: 'Met · newest' },
	},
] as const;

export type SortPreset = (typeof SORT_PRESETS)[number];

/**
 * Chip text. An idle chip shows the direction the next tap will apply.
 * The selected chip shows the direction that is on now.
 */
export function sortPresetChipLabel(preset: SortPreset, activeDirection: 'ASC' | 'DESC' | null): string {
	return preset.labels[activeDirection ?? preset.defaultDirection];
}

/** Same property flips ASC/DESC. A different chip starts at that preset’s default. */
export function nextPresetSort(
	current: { property: string; direction: 'ASC' | 'DESC' } | null,
	preset: SortPreset,
): { property: string; direction: 'ASC' | 'DESC' } {
	const same = current != null && current.property.toLowerCase() === preset.property.toLowerCase();
	if (!same) return { property: preset.property, direction: preset.defaultDirection };
	return {
		property: preset.property,
		direction: current.direction === 'ASC' ? 'DESC' : 'ASC',
	};
}

/** Active RVs sort. Distance is not part of this default. */
export const ACTIVE_SORT: readonly ActiveSort[] = [
	{ property: 'note.Priority', direction: 'DESC' },
	{ property: 'note.Last Spoke', direction: 'DESC' },
	{ property: 'note.Met', direction: 'DESC' }, // datetime, same family as Last Spoke
	{ property: 'file.backlinks', direction: 'DESC' },
	{ property: 'file.name', direction: 'DESC' },
];

export interface ActiveFilterInput {
	folder: string;
	priority: number | null;
	hubTexts: readonly string[];
}

/**
 * Hub contains a link to "Return Visits Hub", and the folder is not "+/Templates".
 * Priority is applied separately by {@link matchesNearbyScope}.
 */
export function passesHubGuard(input: ActiveFilterInput): boolean {
	if (input.folder.trim() === ACTIVE_EXCLUDED_FOLDER) return false;
	return input.hubTexts.some((text) => linkNamesNote(text, ACTIVE_HUB_NOTE));
}

/**
 * Active is Priority > 0. Inactive is Priority == 0. All skips the priority test.
 * Every scope still requires the Hub link and skips "+/Templates".
 */
export function matchesNearbyScope(scope: NearbyScope, input: ActiveFilterInput): boolean {
	if (!passesHubGuard(input)) return false;
	if (scope === 'all') return true;
	if (scope === 'inactive') return input.priority === 0;
	return input.priority != null && input.priority > 0;
}

/**
 * Same rules as the Active RVs filters:
 * Hub contains a link to "Return Visits Hub", the folder is not "+/Templates", Priority > 0.
 */
export function matchesActiveRvFilter(input: ActiveFilterInput): boolean {
	return matchesNearbyScope('active', input);
}

/**
 * Priority is a number from the 0–5 slider. Words such as High, Medium, and Low are not ranks.
 * Active notes are Priority > 0. Inactive notes are Priority == 0.
 */
export function parsePriority(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return null;
	const text = value.trim();
	if (!text || /^(high|medium|low)$/i.test(text)) return null;
	if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Hub is a YAML list of links, including quoted wikilinks like `"[[Return Visits Hub]]"`. */
export function hubListIncludesActive(items: readonly string[]): boolean {
	return items.some((item) => linkNamesNote(item, ACTIVE_HUB_NOTE));
}

export function visiblePropertyText(text: string): string {
	const raw = unwrapQuotes(text.trim());
	const wiki = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]$/.exec(raw);
	if (!wiki) return raw;
	const alias = wiki[2]?.trim();
	if (alias) return alias;
	const target = (wiki[1] ?? raw).trim();
	const base = target.split('/').pop() ?? target;
	return base.replace(/\.md$/i, '');
}

export function linkNamesNote(text: string, noteName: string): boolean {
	const wanted = noteName.trim().toLowerCase();
	if (!wanted) return false;
	const raw = unwrapQuotes(text.trim());
	if (!raw) return false;

	const wiki = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
	let sawWiki = false;
	for (const match of raw.matchAll(wiki)) {
		sawWiki = true;
		if (basenameEquals(match[1] ?? '', wanted)) return true;
	}
	if (sawWiki) return false;
	return basenameEquals(raw, wanted);
}

const FILE_NAME_IDS = new Set(['file.name', 'file.basename']);

/**
 * Bases property ids are `note.Name`, `file.name`, or `formula.Name`.
 * A view menu sometimes hands back the bare name (`Priority`, `Last Spoke`).
 */
export function normalizeBasesPropertyId(raw: string): string {
	const text = raw.trim();
	if (!text || text === DISTANCE_COLUMN_ID) return text;
	const prefixed = /^(note|file|formula)\.(.+)$/i.exec(text);
	if (prefixed?.[1] && prefixed[2]) {
		return `${prefixed[1].toLowerCase()}.${prefixed[2]}`;
	}
	if (/^(name|basename|path|folder|ext|extension|size|ctime|mtime|tags|links|backlinks|embeds)$/i.test(text)) {
		return `file.${text}`;
	}
	return `note.${text}`;
}

/**
 * Nearby columns are always the canonical order, then any extra properties from the Base.
 * A scrambled saved order (Priority after Map Link, for example) cannot hide Priority.
 * Nothing is written back to the Base.
 */
export function resolveNearbyOrder(configOrder: readonly string[], allProperties: readonly string[] = []): string[] {
	const configured = uniqueIds(configOrder
		.map((id) => canonicalPropertyId(id, allProperties))
		.filter((id) => id && id !== DISTANCE_COLUMN_ID));
	const canonical = NEARBY_COLUMN_ORDER.map((id) => canonicalPropertyId(id, allProperties));
	const extras = configured.filter((id) => !covers(canonical, id));
	return uniqueIds([...canonical, ...extras]);
}

/**
 * A brand-new view often has no sort, or only the file name.
 * Those still use the Active RVs sort. A sort the user set on another property is kept.
 */
export function shouldUseActiveSort(sorts: readonly { property: string }[]): boolean {
	if (sorts.length === 0) return true;
	return sorts.every((sort) => {
		const id = sort.property.trim().toLowerCase();
		return id === 'file.name' || id === 'file.basename';
	});
}

/** Toolbar defaults first (Spoke and Attempted: oldest; Met: newest). Then the Active RVs keys. */
export function preferredSortDirection(property: string): 'ASC' | 'DESC' {
	const preset = SORT_PRESETS.find((item) => item.property === property);
	if (preset) return preset.defaultDirection;
	const found = ACTIVE_SORT.find((item) => item.property === property);
	return found?.direction ?? 'ASC';
}

function canonicalPropertyId(raw: string, allProperties: readonly string[]): string {
	const normalized = normalizeBasesPropertyId(raw);
	if (!normalized || normalized === DISTANCE_COLUMN_ID) return normalized;
	const exact = allProperties.find((id) => id === normalized);
	if (exact) return exact;
	const folded = normalized.toLowerCase();
	return allProperties.find((id) => id.toLowerCase() === folded) ?? normalized;
}

function covers(order: readonly string[], wanted: string): boolean {
	const target = wanted.toLowerCase();
	return order.some((id) => sameColumn(id.toLowerCase(), target));
}

function sameColumn(left: string, right: string): boolean {
	if (left === right) return true;
	return FILE_NAME_IDS.has(left) && FILE_NAME_IDS.has(right);
}

function uniqueIds(ids: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of ids) {
		if (!id) continue;
		const key = id.toLowerCase();
		if (FILE_NAME_IDS.has(key)) {
			if ([...seen].some((item) => FILE_NAME_IDS.has(item))) continue;
		}
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(id);
	}
	return out;
}

function unwrapQuotes(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length >= 2) {
		const open = trimmed[0];
		const close = trimmed[trimmed.length - 1];
		if ((open === '"' && close === '"') || (open === "'" && close === "'")) {
			return trimmed.slice(1, -1).trim();
		}
	}
	return trimmed;
}

function basenameEquals(value: string, wantedLower: string): boolean {
	const cleaned = value.trim().replace(/\\/g, '/');
	const base = cleaned.split('/').pop() ?? cleaned;
	const noExt = base.replace(/\.md$/i, '').trim().toLowerCase();
	return noExt === wantedLower;
}
