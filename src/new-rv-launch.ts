import {
	DEFAULT_NEW_RV_TEMPLATE_FILE,
	DEFAULT_TEMPLATES_FOLDER,
	LEGACY_NEW_RV_TEMPLATE_FILE,
	safeTemplateFileName,
	safeVaultFolder,
} from './extras-sync';

/** File name Templater runs for a new return visit. The template itself prompts and geocodes. */
export const NEW_RV_TEMPLATE_NAME = DEFAULT_NEW_RV_TEMPLATE_FILE;
export const DEFAULT_NEW_RV_TEMPLATE = `${DEFAULT_TEMPLATES_FOLDER}/${NEW_RV_TEMPLATE_NAME}`;
export const TEMPLATER_PLUGIN_ID = 'templater-obsidian';

/**
 * Where to look for the template. The configured name under Templater's
 * `templates_folder` is first. The older `New RV.md` name, then `Templates/`,
 * stay in the list so an existing vault still opens.
 */
export function newRvTemplateCandidates(templatesFolder: unknown, templateFileName?: unknown): string[] {
	const configured = safeTemplateFileName(templateFileName, DEFAULT_NEW_RV_TEMPLATE_FILE);
	const names = configured.toLowerCase() === LEGACY_NEW_RV_TEMPLATE_FILE.toLowerCase()
		? [configured]
		: [configured, LEGACY_NEW_RV_TEMPLATE_FILE];
	const folder = safeVaultFolder(templatesFolder, '');
	const folders: string[] = [];
	if (folder) folders.push(folder);
	if (!folders.some((item) => item.toLowerCase() === DEFAULT_TEMPLATES_FOLDER.toLowerCase())) {
		folders.push(DEFAULT_TEMPLATES_FOLDER);
	}
	const paths: string[] = [];
	for (const dir of folders) {
		for (const name of names) {
			const path = `${dir}/${name}`;
			if (!paths.includes(path)) paths.push(path);
		}
	}
	return paths;
}

/** Null when the tap can call Templater. Otherwise the toast text. */
export function newRvLaunchError(pluginPresent: boolean, templateFound: boolean, looked: readonly string[]): string | null {
	if (!pluginPresent) return 'Templater is not enabled. Enable Templater, then try New RV again.';
	if (!templateFound) {
		const where = looked.length ? looked.join(' or ') : DEFAULT_NEW_RV_TEMPLATE;
		return `New RV template was not found (${where}).`;
	}
	return null;
}
