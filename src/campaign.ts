export interface CampaignRecord {
	name: string;
	/** Local calendar day `YYYY-MM-DD`. */
	start: string;
	/** Empty when the campaign has no end date. */
	end: string;
	/** Vault paths marked covered for this campaign. */
	covered: string[];
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDay(date: Date = new Date()): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

export function sanitizeCampaign(value: unknown): CampaignRecord | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as { name?: unknown; start?: unknown; end?: unknown; covered?: unknown };
	const name = typeof raw.name === 'string' ? raw.name.trim() : '';
	const start = typeof raw.start === 'string' && DAY.test(raw.start) ? raw.start : '';
	if (!name || !start) return null;
	const end = typeof raw.end === 'string' && DAY.test(raw.end) ? raw.end : '';
	const covered = Array.isArray(raw.covered)
		? [...new Set(raw.covered.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
		: [];
	return { name, start, end, covered };
}

/** A stored campaign counts until it is cancelled or its end date is before today. */
export function campaignIsActive(campaign: CampaignRecord | null, today = localDay()): boolean {
	if (!campaign) return false;
	if (campaign.start > today) return false;
	if (campaign.end && campaign.end < today) return false;
	return true;
}

export function isCovered(campaign: CampaignRecord | null, path: string): boolean {
	if (!campaign || !path) return false;
	return campaign.covered.includes(path);
}

export function withCovered(campaign: CampaignRecord, path: string): CampaignRecord {
	if (!path || campaign.covered.includes(path)) return campaign;
	return { ...campaign, covered: [...campaign.covered, path] };
}
