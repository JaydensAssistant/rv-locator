/**
 * Pinned extras download. The ref is the release tag for this plugin version.
 * Download URLs never use a floating branch such as `main` or `unstable`.
 * Nothing here reads or writes the Geoapify key or plugin `data.json`.
 */
export const EXTRAS_SYNC_REPO = 'JaydensAssistant/rv-locator';
/** Release tag baked into this build. Matches manifest version 1.1.5. */
export const EXTRAS_SYNC_REF = 'v1.1.5';
export const EXTRAS_SYNC_HOST = 'raw.githubusercontent.com';
export const EXTRAS_MAX_FILE_BYTES = 256 * 1024;
export const EXTRAS_MAX_TOTAL_BYTES = 1024 * 1024;

/**
 * `vault` is a path from the vault root.
 * `configRelative` is placed under the vault config directory (`app.vault.configDir`),
 * and only as a snippets CSS file. Plugin folders are never a destination.
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

const FLOATING_REFS = new Set(['main', 'master', 'unstable', 'head', 'HEAD']);

export function assertPinnedRef(ref: string): string {
	const text = ref.trim();
	if (!text || FLOATING_REFS.has(text) || text.includes('/') || text.includes('\\') || text.includes('..')) {
		throw new Error(`Refusing unpinned extras ref ${ref}`);
	}
	if (/^v\d+\.\d+\.\d+$/.test(text) || /^[0-9a-f]{40}$/.test(text)) return text;
	throw new Error(`Refusing unpinned extras ref ${ref}`);
}

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
	/** URL the bytes actually came from. A redirect off the pin must be reported here. */
	finalUrl: string;
}

export interface ExtrasSyncFile {
	vaultPath: string;
	contents: string;
	sha256: string;
	bytes: number;
}

export interface ExtrasSyncFailure {
	vaultPath: string;
	reason: string;
}

export interface ExtrasSyncPlan {
	ref: string;
	files: ExtrasSyncFile[];
	failed: ExtrasSyncFailure[];
}

export type ExtrasWriteAction = 'create' | 'overwrite' | 'skip';

/** Existing files are skipped unless the confirm dialog's overwrite checkbox is on. */
export function planExtrasWrite(exists: boolean, overwriteExisting: boolean): ExtrasWriteAction {
	if (!exists) return 'create';
	return overwriteExisting ? 'overwrite' : 'skip';
}

export function extrasFileUrl(repoPath: string, ref = EXTRAS_SYNC_REF): string {
	const pin = assertPinnedRef(ref);
	const clean = repoPath.trim().replace(/^\/+/, '');
	if (!clean || clean.includes('..') || clean.includes('\\') || clean.startsWith('/')) {
		throw new Error(`Refusing extras path ${repoPath}`);
	}
	if (!allowedExtrasExtension(clean)) throw new Error(`Refusing extras file type ${repoPath}`);
	const url = `https://${EXTRAS_SYNC_HOST}/${EXTRAS_SYNC_REPO}/${pin}/${encodeURI(clean)}`;
	assertExtrasDownloadUrl(url, pin);
	return url;
}

/** HTTPS raw URL for this repo and the pinned ref only. Other hosts are rejected. */
export function assertExtrasDownloadUrl(raw: string, ref = EXTRAS_SYNC_REF): void {
	const pin = assertPinnedRef(ref);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Refusing extras URL');
	}
	if (url.protocol !== 'https:') throw new Error('Refusing non-HTTPS extras URL');
	if (url.username || url.password) throw new Error('Refusing extras URL credentials');
	if (url.host !== EXTRAS_SYNC_HOST) throw new Error(`Refusing extras host ${url.host}`);
	let path = url.pathname;
	try {
		path = decodeURIComponent(url.pathname);
	} catch {
		throw new Error('Refusing extras URL');
	}
	const prefix = `/${EXTRAS_SYNC_REPO}/${pin}/`;
	if (!path.startsWith(prefix)) throw new Error('Refusing extras URL outside the pinned ref');
	const rest = path.slice(prefix.length);
	if (!rest || rest.split('/').some((part) => !part || part === '.' || part === '..')) {
		throw new Error('Refusing extras URL');
	}
	if (!allowedExtrasExtension(rest)) throw new Error('Refusing extras file type');
}

/**
 * One same-pin redirect is acceptable. Any other Location is an error.
 * Callers must not follow a hop this function rejects.
 */
export function extrasRedirectUrl(requestUrl: string, location: string, ref = EXTRAS_SYNC_REF): string {
	assertExtrasDownloadUrl(requestUrl, ref);
	if (!location.trim()) throw new Error('Refusing redirect');
	const next = new URL(location, requestUrl).href;
	assertExtrasDownloadUrl(next, ref);
	return next;
}

/** Exact vault destinations only. Rejects traversal, plugins, secrets, and other extensions. */
export function isAllowlistedExtrasPath(path: string, configDir: string): boolean {
	if (!isSafeRelativeExtrasPath(path)) return false;
	let destinations: { repo: string; vault: string }[];
	try {
		destinations = extrasDestinations(configDir);
	} catch {
		return false;
	}
	return destinations.some((file) => file.vault === path.trim());
}

export function isSafeRelativeExtrasPath(path: string): boolean {
	const text = path.trim();
	if (!text || text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:/.test(text)) return false;
	if (text.includes('\\') || text.includes('\0')) return false;
	const parts = text.split('/');
	if (parts.some((part) => !part || part === '.' || part === '..')) return false;
	const lower = text.toLowerCase();
	if (/(^|\/)plugins(\/|$)/.test(lower)) return false;
	if (/(^|\/)data\.json$/.test(lower)) return false;
	if (lower.includes('secret')) return false;
	if (!allowedExtrasExtension(text)) return false;
	const folder = parts[0]?.toLowerCase() ?? '';
	if (folder === 'templates' || folder === 'scripts') return true;
	return parts.length === 3 && parts[1] === 'snippets';
}

function allowedExtrasExtension(path: string): boolean {
	return /\.(md|js|css)$/i.test(path);
}

export async function sha256Hex(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error('SHA-256 is unavailable');
	const digest = await subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function downloadExtras(
	fetchText: (url: string) => Promise<ExtrasFetchResult>,
	configDir: string,
	ref = EXTRAS_SYNC_REF,
): Promise<ExtrasSyncPlan> {
	const pin = assertPinnedRef(ref);
	const files: ExtrasSyncFile[] = [];
	const failed: ExtrasSyncFailure[] = [];
	let total = 0;
	for (const file of extrasDestinations(configDir)) {
		if (!isAllowlistedExtrasPath(file.vault, configDir) || !allowedExtrasExtension(file.repo)) {
			failed.push({ vaultPath: file.vault, reason: 'not allowlisted' });
			continue;
		}
		let url: string;
		try {
			url = extrasFileUrl(file.repo, pin);
		} catch (error) {
			failed.push({ vaultPath: file.vault, reason: errorMessage(error) });
			continue;
		}
		try {
			const response = await fetchText(url);
			assertExtrasDownloadUrl(url, pin);
			assertExtrasDownloadUrl(response.finalUrl, pin);
			if (!response.ok) {
				failed.push({ vaultPath: file.vault, reason: `HTTP ${response.status}` });
				continue;
			}
			const bytes = new TextEncoder().encode(response.text).byteLength;
			if (bytes > EXTRAS_MAX_FILE_BYTES) {
				failed.push({ vaultPath: file.vault, reason: 'file exceeds size cap' });
				continue;
			}
			if (total + bytes > EXTRAS_MAX_TOTAL_BYTES) {
				failed.push({ vaultPath: file.vault, reason: 'total size cap' });
				continue;
			}
			total += bytes;
			files.push({
				vaultPath: file.vault,
				contents: response.text,
				sha256: await sha256Hex(response.text),
				bytes,
			});
		} catch (error) {
			failed.push({ vaultPath: file.vault, reason: errorMessage(error) });
		}
	}
	return { ref: pin, files, failed };
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : 'download failed';
}
