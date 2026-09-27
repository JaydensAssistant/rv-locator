/** File name Templater runs for a new return visit. The template itself prompts and geocodes. */
export const NEW_RV_TEMPLATE_NAME = 'New RV.md';
export const DEFAULT_NEW_RV_TEMPLATE = `Templates/${NEW_RV_TEMPLATE_NAME}`;
export const TEMPLATER_PLUGIN_ID = 'templater-obsidian';

/**
 * Where to look for the template. Templater’s templates folder wins.
 * `Templates/New RV.md` stays in the list because that is the documented vault path.
 */
export function newRvTemplateCandidates(templatesFolder: unknown): string[] {
	const raw = typeof templatesFolder === 'string' ? templatesFolder.trim().replace(/\\/g, '/') : '';
	const folder = raw.replace(/^\/+|\/+$/g, '');
	const paths: string[] = [];
	if (folder && !folder.includes('..') && !folder.startsWith('/') && !/^[A-Za-z]:/.test(folder)) {
		paths.push(`${folder}/${NEW_RV_TEMPLATE_NAME}`);
	}
	if (!paths.includes(DEFAULT_NEW_RV_TEMPLATE)) paths.push(DEFAULT_NEW_RV_TEMPLATE);
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
