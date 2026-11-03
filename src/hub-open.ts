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

/**
 * A hub that is already open with cards. Revealing that leaf skips a fresh
 * embed, which is what paints the empty toolbar while Bases is still loading.
 */
export function paintedHubLeaf<T extends HubOpenLeaf>(leaves: readonly T[], hubPath: string | null, target: string): T | null {
	const stem = hubStem(target);
	const pathStem = hubPath ? hubStem(hubPath) : '';
	for (const leaf of leaves) {
		const filePath = leaf.view?.file?.path ?? '';
		if (!filePath) continue;
		const fileStem = hubStem(filePath);
		const same = (hubPath != null && filePath === hubPath)
			|| (stem.length > 0 && fileStem === stem)
			|| (pathStem.length > 0 && fileStem === pathStem);
		if (!same) continue;
		const root = leaf.view?.containerEl;
		if (root?.querySelector('.rv-locator-card')) return leaf;
	}
	return null;
}
