/**
 * Files the settings button may download from the public GitHub repo.
 * Branch is `unstable`. Nothing else is written: not notes, not Address,
 * and not the plugin `data.json` that holds the Geoapify key.
 */
export const EXTRAS_SYNC_REPO = 'JaydensAssistant/rv-locator';
export const EXTRAS_SYNC_BRANCH = 'unstable';

/**
 * `vault` is a path from the vault root.
 * `configRelative` is placed under the vault config directory (`app.vault.configDir`).
 */
export const EXTRAS_SYNC_FILES = [
	{ repo: 'extras/templater-metabind/New RV.md', vault: 'Templates/New RV.md' },
	{ repo: 'extras/templater-metabind/RV Log Home.md', vault: 'Templates/RV Log Home.md' },
	{ repo: 'extras/templater-metabind/RV Log Miss.md', vault: 'Templates/RV Log Miss.md' },
	{ repo: 'extras/templater-metabind/newRv.js', vault: 'Scripts/newRv.js' },
	{ repo: 'extras/templater-metabind/rvLog.js', vault: 'Scripts/rvLog.js' },
	{ repo: 'extras/templater-metabind/geocodeNewRv.js', vault: 'Scripts/geocodeNewRv.js' },
	{ repo: 'extras/templater-metabind/rv-dashboard.css', configRelative: 'snippets/rv-dashboard.css' },
	{ repo: 'extras/templater-metabind/NEW-RV-GEOCODE.md', vault: 'Templates/NEW-RV-GEOCODE.md' },
	{ repo: 'extras/templater-metabind/RV-LOG-BUTTONS-TEMPLATER.md', vault: 'Templates/RV-LOG-BUTTONS-TEMPLATER.md' },
] as const;

export function safeConfigDir(configDir: string): string {
	const dir = configDir.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
	if (!dir || dir === '.' || dir === '..' || dir.includes('..') || dir.includes('/')) {
		throw new Error('Refusing config directory');
	}
	return dir;
}

export function extrasDestinations(configDir: string): { repo: string; vault: string }[] {
	const dir = safeConfigDir(configDir);
	return EXTRAS_SYNC_FILES.map((file) => {
		if ('configRelative' in file) {
			return { repo: file.repo, vault: `${dir}/${file.configRelative}` };
		}
		return { repo: file.repo, vault: file.vault };
	});
}

export interface ExtrasFetchResult {
	ok: boolean;
	status: number;
	text: string;
}

export interface ExtrasSyncFile {
	vaultPath: string;
	contents: string;
}

export interface ExtrasSyncFailure {
	vaultPath: string;
	reason: string;
}

export interface ExtrasSyncPlan {
	updated: ExtrasSyncFile[];
	failed: ExtrasSyncFailure[];
}

export function extrasFileUrl(repoPath: string, branch = EXTRAS_SYNC_BRANCH): string {
	const clean = repoPath.trim().replace(/^\/+/, '');
	if (!clean || clean.includes('..') || clean.includes('\\')) {
		throw new Error(`Refusing extras path ${repoPath}`);
	}
	return `https://raw.githubusercontent.com/${EXTRAS_SYNC_REPO}/${branch}/${encodeURI(clean)}`;
}

/** Exact vault destinations only. Rejects traversal, absolute paths, and plugin data. */
export function isAllowlistedExtrasPath(path: string, configDir: string): boolean {
	const text = path.trim();
	if (!text || text.includes('..') || text.startsWith('/') || text.startsWith('\\') || text.includes('\\')) {
		return false;
	}
	if (/(^|\/)data\.json$/i.test(text)) return false;
	let destinations: { repo: string; vault: string }[];
	try {
		destinations = extrasDestinations(configDir);
	} catch {
		return false;
	}
	return destinations.some((file) => file.vault === text);
}

export async function downloadExtras(
	fetchText: (url: string) => Promise<ExtrasFetchResult>,
	configDir: string,
	branch = EXTRAS_SYNC_BRANCH,
): Promise<ExtrasSyncPlan> {
	const updated: ExtrasSyncFile[] = [];
	const failed: ExtrasSyncFailure[] = [];
	const files = extrasDestinations(configDir);
	for (const file of files) {
		if (!isAllowlistedExtrasPath(file.vault, configDir)) {
			failed.push({ vaultPath: file.vault, reason: 'not allowlisted' });
			continue;
		}
		const url = extrasFileUrl(file.repo, branch);
		try {
			const response = await fetchText(url);
			if (!response.ok) {
				failed.push({ vaultPath: file.vault, reason: `HTTP ${response.status}` });
				continue;
			}
			updated.push({ vaultPath: file.vault, contents: response.text });
		} catch (error) {
			const reason = error instanceof Error && error.message ? error.message : 'download failed';
			failed.push({ vaultPath: file.vault, reason });
		}
	}
	return { updated, failed };
}
