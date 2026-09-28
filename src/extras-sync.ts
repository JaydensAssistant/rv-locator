/**
 * Pinned extras download. The ref is the release tag for this plugin version.
 * Download URLs never use a floating branch such as `main` or `unstable`.
 * Nothing here reads or writes the Geoapify key or plugin `data.json`.
 *
 * Destinations come from Templater's `templates_folder` and `user_scripts_folder`
 * (SilentVoid13/Templater settings) plus the configured template file names.
 * Snippets and documentation files are not synced.
 */
export const EXTRAS_SYNC_REPO = 'JaydensAssistant/rv-locator';
/**
 * Release tag this build downloads. Matches manifest 1.2.3.
 * The GitHub tag must exist before Update from GitHub can fetch these files.
 * This plugin does not create that tag. Do not point this pin at v1.2.2,
 * v1.2.1, v1.2.0, v1.1.5, `main`, or `unstable`.
 */
export const EXTRAS_SYNC_REF = 'v1.2.3';
export const EXTRAS_SYNC_HOST = 'raw.githubusercontent.com';
export const EXTRAS_MAX_FILE_BYTES = 256 * 1024;
export const EXTRAS_MAX_TOTAL_BYTES = 1024 * 1024;

export const DEFAULT_TEMPLATES_FOLDER = 'Templates';
export const DEFAULT_SCRIPTS_FOLDER = 'Scripts';
export const DEFAULT_NEW_RV_TEMPLATE_FILE = '99 New RV.md';
export const DEFAULT_HOME_LOG_TEMPLATE_FILE = '99 RV Log Home.md';
export const DEFAULT_MISS_LOG_TEMPLATE_FILE = '99 RV Log Miss.md';
/** Previous New RV file name. The + button still accepts it. */
export const LEGACY_NEW_RV_TEMPLATE_FILE = 'New RV.md';

export interface ExtrasPlacement {
	templatesFolder: string;
	scriptsFolder: string;
	newRvFileName: string;
	homeLogFileName: string;
	missLogFileName: string;
}

/** Only this fetched body may have Home / Not home `templateFile:` paths rewritten. */
export const NEW_RV_TEMPLATE_REPO = 'extras/templater-metabind/New RV.md';

type ExtrasSyncEntry =
	| { repo: string; role: 'new-rv' | 'home-log' | 'miss-log' }
	| { repo: string; role: 'script'; file: string };

/** Basename only. Starts with a letter or digit. No directories. */
const TEMPLATE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}\.md$/;
const SCRIPT_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.js$/;
/** A path segment. `+` alone is the vault folder used by `+/Templates`. */
const FOLDER_SEGMENT = /^(?:\+|[A-Za-z0-9][A-Za-z0-9 ._+-]{0,80})$/;

/**
 * Templates and user scripts only. No CSS snippet and no documentation.
 * Vault paths are resolved from {@link extrasDestinations}.
 */
export const EXTRAS_SYNC_FILES: readonly ExtrasSyncEntry[] = [
	{ repo: NEW_RV_TEMPLATE_REPO, role: 'new-rv' },
	{ repo: 'extras/templater-metabind/RV Log Home.md', role: 'home-log' },
	{ repo: 'extras/templater-metabind/RV Log Miss.md', role: 'miss-log' },
	{ repo: 'extras/templater-metabind/newRv.js', role: 'script', file: 'newRv.js' },
	{ repo: 'extras/templater-metabind/rvLog.js', role: 'script', file: 'rvLog.js' },
	{ repo: 'extras/templater-metabind/geocodeNewRv.js', role: 'script', file: 'geocodeNewRv.js' },
];

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

/** A vault-relative folder Templater may store. Unsafe or empty values use the fallback. */
export function safeVaultFolder(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const raw = value.trim();
	if (!raw || raw === fallback) return fallback;
	if (raw.includes('\\') || raw.includes('\0') || raw.includes(':') || raw.includes('..')) return fallback;
	if (raw.startsWith('/') || raw.startsWith('~') || /^[A-Za-z]:/.test(raw)) return fallback;
	const folder = raw.replace(/^\/+|\/+$/g, '');
	if (!folder || folder === fallback) return fallback;
	const parts = folder.split('/');
	if (parts.some((part) => !FOLDER_SEGMENT.test(part))) return fallback;
	const lowerParts = parts.map((part) => part.toLowerCase());
	if (lowerParts.includes('plugins') || lowerParts.some((part) => part.includes('secret'))) return fallback;
	return folder;
}

/** A template file name with no directory. Unsafe values use the fallback. */
export function safeTemplateFileName(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const name = value.trim();
	if (!name || name === fallback) return fallback;
	if (name.includes('..') || name.includes('\\') || name.includes('/') || name.includes('\0')) return fallback;
	if (name.startsWith('/') || name.startsWith('~') || /^[A-Za-z]:/.test(name)) return fallback;
	if (!TEMPLATE_FILE_NAME.test(name)) return fallback;
	if (name.toLowerCase().includes('secret')) return fallback;
	return name;
}

/**
 * True when `filePath` is exactly `folder/basename` and the basename has no slash.
 * Rejects traversal, absolute paths, and a file that merely starts with the folder name.
 */
export function pathInsideFolder(folder: string, filePath: string): boolean {
	const dir = folder.trim();
	const file = filePath.trim();
	if (!dir || !file) return false;
	if (dir.includes('\\') || file.includes('\\') || dir.includes('\0') || file.includes('\0')) return false;
	if (dir.startsWith('/') || file.startsWith('/') || dir.startsWith('~') || file.startsWith('~')) return false;
	if (/^[A-Za-z]:/.test(dir) || /^[A-Za-z]:/.test(file)) return false;
	if (dir.includes('..') || file.includes('..')) return false;
	const prefix = `${dir}/`;
	if (!file.startsWith(prefix)) return false;
	const base = file.slice(prefix.length);
	if (!base || base.includes('/') || base === '.' || base === '..') return false;
	return true;
}

export function resolveExtrasPlacement(partial?: Partial<ExtrasPlacement> | null): ExtrasPlacement {
	return {
		templatesFolder: safeVaultFolder(partial?.templatesFolder, DEFAULT_TEMPLATES_FOLDER),
		scriptsFolder: safeVaultFolder(partial?.scriptsFolder, DEFAULT_SCRIPTS_FOLDER),
		newRvFileName: safeTemplateFileName(partial?.newRvFileName, DEFAULT_NEW_RV_TEMPLATE_FILE),
		homeLogFileName: safeTemplateFileName(partial?.homeLogFileName, DEFAULT_HOME_LOG_TEMPLATE_FILE),
		missLogFileName: safeTemplateFileName(partial?.missLogFileName, DEFAULT_MISS_LOG_TEMPLATE_FILE),
	};
}

export function extrasDestinations(
	configDir: string,
	placement?: Partial<ExtrasPlacement> | null,
): { repo: string; vault: string }[] {
	safeConfigDir(configDir);
	const place = resolveExtrasPlacement(placement);
	return EXTRAS_SYNC_FILES.map((file) => ({
		repo: file.repo,
		vault: vaultPathFor(file, place),
	}));
}

/**
 * Point the New RV Meta Bind buttons at the resolved Home and Not home templates.
 * Other lines are left as they are.
 */
export function rewriteNewRvTemplate(contents: string, placement?: Partial<ExtrasPlacement> | null): string {
	const place = resolveExtrasPlacement(placement);
	const home = `${place.templatesFolder}/${place.homeLogFileName}`;
	const miss = `${place.templatesFolder}/${place.missLogFileName}`;
	if (!pathInsideFolder(place.templatesFolder, home) || !pathInsideFolder(place.templatesFolder, miss)) {
		throw new Error('templateFile path left the templates folder');
	}
	const withHome = replaceTemplateFileForId(contents, 'rv-log-home', home);
	const rewritten = replaceTemplateFileForId(withHome, 'rv-log-miss', miss);
	const targets = templateFileTargets(rewritten);
	if (targets.some((target) => !pathInsideFolder(place.templatesFolder, target))) {
		throw new Error('templateFile path left the templates folder');
	}
	if (targets.length === 0) return contents;
	if (!targets.includes(home) || !targets.includes(miss)) {
		throw new Error('templateFile path left the templates folder');
	}
	return rewritten;
}

function templateFileTargets(contents: string): string[] {
	const targets: string[] = [];
	for (const match of contents.matchAll(/^[ \t]*templateFile:[ \t]*([^\n\r]*)$/gm)) {
		targets.push((match[1] ?? '').trim());
	}
	return targets;
}

function replaceTemplateFileForId(contents: string, id: string, templatePath: string): string {
	const pattern = new RegExp(`(id:\\s*${id}\\b[\\s\\S]*?templateFile:)\\s*[^\\n\\r]*`);
	if (!pattern.test(contents)) return contents;
	const safe = templatePath.replace(/\$/g, '$$');
	return contents.replace(pattern, `$1 ${safe}`);
}

function vaultPathFor(file: ExtrasSyncEntry, place: ExtrasPlacement): string {
	if (file.role === 'script') return `${place.scriptsFolder}/${assertScriptFileName(file.file)}`;
	if (file.role === 'home-log') return `${place.templatesFolder}/${place.homeLogFileName}`;
	if (file.role === 'miss-log') return `${place.templatesFolder}/${place.missLogFileName}`;
	return `${place.templatesFolder}/${place.newRvFileName}`;
}

function assertScriptFileName(name: string): string {
	if (!SCRIPT_FILE_NAME.test(name) || name.includes('..') || name.includes('/') || name.includes('\\')) {
		throw new Error(`Refusing script file name ${name}`);
	}
	return name;
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
export function isAllowlistedExtrasPath(
	path: string,
	configDir: string,
	placement?: Partial<ExtrasPlacement> | null,
): boolean {
	if (!isSafeRelativeExtrasPath(path)) return false;
	let destinations: { repo: string; vault: string }[];
	try {
		destinations = extrasDestinations(configDir, placement);
	} catch {
		return false;
	}
	const text = path.trim();
	const match = destinations.find((file) => file.vault === text);
	if (!match) return false;
	const entry = EXTRAS_SYNC_FILES.find((file) => file.repo === match.repo);
	if (!entry) return false;
	const place = resolveExtrasPlacement(placement);
	const folder = entry.role === 'script' ? place.scriptsFolder : place.templatesFolder;
	return pathInsideFolder(folder, text);
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
	return true;
}

function allowedExtrasExtension(path: string): boolean {
	return /\.(md|js)$/i.test(path);
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
	placement?: Partial<ExtrasPlacement> | null,
): Promise<ExtrasSyncPlan> {
	const pin = assertPinnedRef(ref);
	const place = resolveExtrasPlacement(placement);
	const files: ExtrasSyncFile[] = [];
	const failed: ExtrasSyncFailure[] = [];
	let total = 0;
	for (const file of extrasDestinations(configDir, place)) {
		if (!isAllowlistedExtrasPath(file.vault, configDir, place) || !allowedExtrasExtension(file.repo)) {
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
			const text = file.repo === NEW_RV_TEMPLATE_REPO
				? rewriteNewRvTemplate(response.text, place)
				: response.text;
			const bytes = new TextEncoder().encode(text).byteLength;
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
				contents: text,
				sha256: await sha256Hex(text),
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
