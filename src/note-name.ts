const DIRECTIONALS = new Set([
	'n', 'north', 's', 'south', 'e', 'east', 'w', 'west',
	'ne', 'northeast', 'nw', 'northwest', 'se', 'southeast', 'sw', 'southwest',
]);

const UNIT_MARKERS = new Set(['apt', 'apartment', 'unit', 'ste', 'suite']);

/**
 * Short street name for `{Name} on {Street}`.
 * Drops the house number, a leading directional, and an apartment tail.
 * The street suffix stays, so `142 Lake Dr` → `Lake Dr`, not `Lake`.
 * `10 Oak Hammock Lane` → `Oak Hammock Lane`.
 */
export function streetShortName(address: string): string {
	const line = (address.split(',')[0] ?? address).trim();
	if (!line) return '';
	const remainder = line.replace(/^\s*\d+(?:-\d+)?[A-Za-z]?\s+/, '').trim();
	const source = remainder || line;
	const raw = source.split(/\s+/).filter((token) => token.length > 0);
	const named = significantStreetTokens(raw);
	const chosen = named.length > 0 ? named : raw;
	return chosen.map(titleWord).join(' ');
}

/** `Alex` + `142 Maple Street` → `Alex on Maple Street`. Empty pieces are omitted. */
export function rvNoteTitle(householder: string, address: string): string {
	const name = sanitizeNoteName(householder);
	const street = sanitizeNoteName(streetShortName(address));
	if (name && street) return `${name} on ${street}`;
	return name || street;
}

/**
 * A blank name uses Man or Woman. `''` + Man + `142 Maple Street` → `Man on Maple Street`.
 */
export function rvNoteTitleFromIdentity(name: string, gender: string, address: string): string {
	const named = sanitizeNoteName(name);
	const who = named || (gender === 'Woman' ? 'Woman' : gender === 'Man' ? 'Man' : '');
	return rvNoteTitle(who, address);
}

/**
 * Card title. Name-only keeps the person in `Name on Street`, including a
 * trailing met date. A title with no ` on ` stays whole so a street form
 * can ellipsize at the end.
 */
export function cardPersonTitle(title: string, nameOnly: boolean): string {
	const base = title.replace(/\s+\d{4}-\d{2}-\d{2}$/, '').trim();
	if (!nameOnly) return title.trim();
	const on = base.toLowerCase().indexOf(' on ');
	if (on > 0) return base.slice(0, on).trim();
	return base || title.trim();
}

/** `Man on Maple` + `2026-10-01T16:32:00` → `Man on Maple 2026-10-01`. */
export function appendMetDateToFilename(title: string, metIso: string): string {
	const base = sanitizeNoteName(title);
	const day = /^(\d{4}-\d{2}-\d{2})/.exec(metIso.trim())?.[1] ?? '';
	if (!base || !day) return base;
	return `${base} ${day}`;
}

export function sanitizeNoteName(value: string): string {
	return value
		.replace(/[\\/:*?"<>|#^[\]\r\n]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/\.+$/g, '')
		.trim();
}

function significantStreetTokens(raw: readonly string[]): string[] {
	let start = 0;
	while (start < raw.length && DIRECTIONALS.has(tokenKey(raw[start] ?? ''))) start += 1;
	let tokens = raw.slice(start);
	const unitAt = tokens.findIndex((token) => isUnitMarker(token));
	if (unitAt >= 0) tokens = tokens.slice(0, unitAt);
	if (tokens.length > 0) return tokens;
	return dropUnit(raw);
}

function dropUnit(tokens: readonly string[]): string[] {
	const unitAt = tokens.findIndex((token) => isUnitMarker(token));
	return unitAt >= 0 ? tokens.slice(0, unitAt) : [...tokens];
}

function isUnitMarker(token: string): boolean {
	const key = tokenKey(token);
	return UNIT_MARKERS.has(key) || token.startsWith('#');
}

function tokenKey(token: string): string {
	return token.toLowerCase().replace(/\./g, '');
}

function titleWord(token: string): string {
	const bare = token.replace(/\.+$/g, '');
	if (/[a-z]/.test(bare) && /[A-Z]/.test(bare)) return bare;
	if (!bare) return bare;
	return bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase();
}
