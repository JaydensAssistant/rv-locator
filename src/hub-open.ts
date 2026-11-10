export interface HubOpenLeaf {
	view?: {
		file?: { path?: string } | null;
		containerEl?: { querySelector(selector: string): unknown } | null;
	} | null;
}

function hubStem(value: string): string {
	const base = value.trim().split('/').pop() ?? '';
	return base.replace(/\.md$/i, '');
}

function sameHubFile(filePath: string, hubPath: string | null, target: string): boolean {
	const stem = hubStem(target);
	const pathStem = hubPath ? hubStem(hubPath) : '';
	const fileStem = hubStem(filePath);
	return (hubPath != null && filePath === hubPath)
		|| (stem.length > 0 && fileStem === stem)
		|| (pathStem.length > 0 && fileStem === pathStem);
}

/**
 * A hub file that is already open in any leaf. A leaf that already has cards
 * wins. Revealing either one skips a new embed and the empty Bases toolbar.
 */
export function paintedHubLeaf<T extends HubOpenLeaf>(leaves: readonly T[], hubPath: string | null, target: string): T | null {
	let open: T | null = null;
	for (const leaf of leaves) {
		const filePath = leaf.view?.file?.path ?? '';
		if (!filePath || !sameHubFile(filePath, hubPath, target)) continue;
		const root = leaf.view?.containerEl;
		if (root?.querySelector('.rv-locator-card')) return leaf;
		open ??= leaf;
	}
	return open;
}

export interface HubOpenFrame {
	phase: 'reveal' | 'pending' | 'cards' | 'empty';
	revealedExisting: boolean;
	viewsToolbarVisible: boolean;
	blankBodyVisible: boolean;
	cards: number;
	emptyResult: boolean;
}

/** Visible cards painted in the open turn. The rest follow in idle slices. */
export const HUB_FIRST_PAINT = 8;

/**
 * What a hub-link click shows. Desktop may reveal a leaf that already has
 * cards. Phone replaces the note, so the first frame is the visible slice of
 * this view's own cache. A cache miss is the only blank, and it is not the path we ship.
 */
export function hubClickFrames(input: {
	existingLeaf: boolean;
	existingCards: number;
	heldCards: number;
	cacheCards?: number;
}): HubOpenFrame[] {
	const ready = Math.max(0, input.existingCards, input.heldCards, input.cacheCards ?? 0);
	if (input.existingLeaf && ready > 0) {
		return [{
			phase: 'reveal',
			revealedExisting: true,
			viewsToolbarVisible: false,
			blankBodyVisible: false,
			cards: ready,
			emptyResult: false,
		}];
	}
	if (ready > 0) {
		return [{
			phase: 'cards',
			revealedExisting: false,
			viewsToolbarVisible: false,
			blankBodyVisible: false,
			cards: Math.min(HUB_FIRST_PAINT, ready),
			emptyResult: false,
		}];
	}
	return [{
		phase: 'pending',
		revealedExisting: false,
		viewsToolbarVisible: false,
		blankBodyVisible: true,
		cards: 0,
		emptyResult: false,
	}];
}
