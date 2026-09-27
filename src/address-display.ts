/**
 * Display-only split of a stored US address. The note keeps the full string.
 * Returns null when the line is not a street plus a city, so the UI can show the original.
 */
export interface DisplayAddress {
	street: string;
	city: string;
}

const STATE_ABBR = new Set([
	'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA', 'ID', 'IL', 'IN',
	'KS', 'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ',
	'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA',
	'WI', 'WV', 'WY',
]);

/** Full state names. New York and Washington stay available as city names. */
const STATE_NAMES = [
	'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
	'delaware', 'district of columbia', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois',
	'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts',
	'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
	'new hampshire', 'new jersey', 'new mexico', 'north carolina', 'north dakota', 'ohio',
	'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
	'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'west virginia', 'wisconsin', 'wyoming',
].sort((a, b) => b.length - a.length);

/** Stored `City` wins. Parsing the full address is only the fallback. */
export function displayCity(stored: string | null | undefined, address: string): string | null {
	const saved = typeof stored === 'string' ? stored.trim() : '';
	if (saved) return saved;
	return parseDisplayAddress(address)?.city ?? null;
}

export function parseDisplayAddress(raw: string): DisplayAddress | null {
	const text = raw.trim();
	if (!text) return null;
	const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
	if (parts.length < 2) return null;
	const street = parts[0] ?? '';
	if (!isStreetLine(street)) return null;
	const city = cityFromPart(parts[1] ?? '');
	if (!city) return null;
	return { street, city };
}

function isStreetLine(street: string): boolean {
	if (!/^\d+(?:-\d+)?[A-Za-z]?\s+\S/.test(street)) return false;
	return /[A-Za-z]/.test(street);
}

function cityFromPart(part: string): string | null {
	let city = part.replace(/\s+\d{5}(?:-\d{4})?$/, '').trim();
	city = city.replace(/\s+([A-Za-z]{2})\.?$/, (full, abbr: string) => {
		return STATE_ABBR.has(abbr.toUpperCase()) ? '' : full;
	}).trim();
	const lower = city.toLowerCase();
	for (const name of STATE_NAMES) {
		if (lower === name) return null;
		if (lower.endsWith(` ${name}`)) {
			city = city.slice(0, city.length - name.length).trim();
			break;
		}
	}
	if (!city) return null;
	if (STATE_ABBR.has(city.replace(/\.$/, '').toUpperCase())) return null;
	if (/^(united states|usa|u\.s\.a\.?|us)$/i.test(city)) return null;
	if (/^\d/.test(city)) return null;
	if (!/[A-Za-z]/.test(city)) return null;
	return city;
}
