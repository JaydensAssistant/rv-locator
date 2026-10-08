/** Study, Active, or Inactive. Stored on the note as `Status`. */
export type RvStatus = 'Study' | 'Active' | 'Inactive';

export type ReturnScope = 'active' | 'rvs' | 'studies' | 'archive';

export type GenderFilter = 'all' | 'men' | 'women';

/** Glancable list cycle, to the left of Active. Three clicks return to all. */
export type CampaignListFilter = 'all' | 'uncovered' | 'covered';

export type RvGender = 'Man' | 'Woman';

export const RETURN_SCOPE_ORDER: readonly ReturnScope[] = ['active', 'rvs', 'studies', 'archive'];

export const GENDER_FILTER_ORDER: readonly GenderFilter[] = ['all', 'men', 'women'];

export const RETURN_SCOPE_LABEL: Record<ReturnScope, string> = {
	active: 'Active',
	rvs: 'RVs Only',
	studies: 'Studies',
	archive: 'Archive',
};

export const GENDER_FILTER_LABEL: Record<GenderFilter, string> = {
	all: 'Men+Women',
	men: 'Men',
	women: 'Women',
};

export function sanitizeReturnScope(value: unknown): ReturnScope {
	return value === 'rvs' || value === 'studies' || value === 'archive' || value === 'active' ? value : 'active';
}

export function sanitizeGenderFilter(value: unknown): GenderFilter {
	return value === 'men' || value === 'women' || value === 'all' ? value : 'all';
}

export function nextReturnScope(current: ReturnScope): ReturnScope {
	const index = RETURN_SCOPE_ORDER.indexOf(current);
	return RETURN_SCOPE_ORDER[(index + 1) % RETURN_SCOPE_ORDER.length] ?? 'active';
}

export function nextGenderFilter(current: GenderFilter): GenderFilter {
	const index = GENDER_FILTER_ORDER.indexOf(current);
	return GENDER_FILTER_ORDER[(index + 1) % GENDER_FILTER_ORDER.length] ?? 'all';
}

export const CAMPAIGN_LIST_ORDER: readonly CampaignListFilter[] = ['all', 'uncovered', 'covered'];

export const CAMPAIGN_LIST_LABEL: Record<CampaignListFilter, string> = {
	all: 'Campaign',
	uncovered: 'Campaign uncovered',
	covered: 'Campaign covered',
};

export function sanitizeCampaignListFilter(value: unknown): CampaignListFilter {
	return value === 'uncovered' || value === 'covered' || value === 'all' ? value : 'all';
}

export function nextCampaignListFilter(current: CampaignListFilter): CampaignListFilter {
	const index = CAMPAIGN_LIST_ORDER.indexOf(current);
	return CAMPAIGN_LIST_ORDER[(index + 1) % CAMPAIGN_LIST_ORDER.length] ?? 'all';
}

/** True when Campaign, Active, or Men+Women is not the default list. */
export function filtersDifferFromDefault(scope: ReturnScope, gender: GenderFilter, campaign: CampaignListFilter): boolean {
	return scope !== 'active' || gender !== 'all' || campaign !== 'all';
}

export function sanitizeStatus(value: unknown): RvStatus | null {
	if (typeof value !== 'string') return null;
	const text = value.trim().toLowerCase();
	if (text === 'study') return 'Study';
	if (text === 'active') return 'Active';
	if (text === 'inactive') return 'Inactive';
	return null;
}

export function sanitizeGender(value: unknown): RvGender | null {
	if (typeof value !== 'string') return null;
	const text = value.trim().toLowerCase();
	if (text === 'man' || text === 'men' || text === 'male') return 'Man';
	if (text === 'woman' || text === 'women' || text === 'female') return 'Woman';
	return null;
}

/**
 * Priority 0 is Inactive. An explicit Inactive stays Inactive.
 * Study stays Study while priority is above 0. Anything else is Active.
 */
export function resolveStatus(status: unknown, priority: number | null): RvStatus {
	if (priority === 0) return 'Inactive';
	const named = sanitizeStatus(status);
	if (named === 'Inactive') return 'Inactive';
	if (named === 'Study') return 'Study';
	return 'Active';
}

export function statusIcon(status: RvStatus): 'user-round-check' | 'user-round-x' | 'book-user' {
	if (status === 'Inactive') return 'user-round-x';
	if (status === 'Study') return 'book-user';
	return 'user-round-check';
}

export interface StatusPriority {
	status: RvStatus;
	priority: number;
}

/**
 * Inactive forces priority 0. Priority 0 forces Inactive.
 * Inactive to Active sets priority 1. A priority above 0 on an Inactive note
 * makes it Active. Study on an inactive note starts at priority 1.
 */
export function applyStatusPriority(current: StatusPriority, next: { status?: RvStatus; priority?: number }): StatusPriority {
	const status = next.status ?? current.status;
	const priority = next.priority ?? current.priority;
	if (next.status === 'Inactive' || next.priority === 0) return { status: 'Inactive', priority: 0 };
	if (next.status === 'Active' && current.status === 'Inactive') {
		return { status: 'Active', priority: next.priority != null && next.priority > 0 ? next.priority : 1 };
	}
	if (next.status === 'Study' && (current.status === 'Inactive' || priority <= 0)) return { status: 'Study', priority: 1 };
	if (next.priority != null && next.priority > 0 && current.status === 'Inactive' && next.status == null) {
		return { status: 'Active', priority: next.priority };
	}
	if (status === 'Inactive' || priority <= 0) return { status: 'Inactive', priority: 0 };
	return { status, priority };
}

/** Status written the first time a note is seen without one. */
export function statusForNewNote(priority: number | null): RvStatus {
	return priority === 0 ? 'Inactive' : 'Active';
}

export function matchesReturnScope(scope: ReturnScope, status: unknown, priority: number | null): boolean {
	const resolved = resolveStatus(status, priority);
	if (scope === 'archive') return resolved === 'Inactive';
	if (scope === 'studies') return resolved === 'Study';
	if (scope === 'rvs') return resolved === 'Active';
	return resolved === 'Active' || resolved === 'Study';
}

/** A note with no gender stays in Men+Women only. */
export function matchesGenderFilter(filter: GenderFilter, gender: unknown): boolean {
	if (filter === 'all') return true;
	const named = sanitizeGender(gender);
	if (filter === 'men') return named === 'Man';
	return named === 'Woman';
}
