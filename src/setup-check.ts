import { TEMPLATER_PLUGIN_ID } from './new-rv-launch';

/** Community plugin id for Meta Bind. RV Locator never installs it. */
export const META_BIND_PLUGIN_ID = 'obsidian-meta-bind-plugin';

export interface SetupFileStatus {
	path: string;
	exists: boolean;
}

export interface SetupSnapshot {
	templaterEnabled: boolean;
	metaBindEnabled: boolean;
	/** Raw Templater `templates_folder`, before the Templates fallback. */
	templatesFolder: string;
	/** Raw Templater `user_scripts_folder`, before the Scripts fallback. */
	scriptsFolder: string;
	resolvedTemplatesFolder: string;
	resolvedScriptsFolder: string;
	files: SetupFileStatus[];
	defaultNewRvPriority: number;
	linkCompanionsToNotes: boolean;
	newRvTemplateFile: string;
	homeLogTemplateFile: string;
	missLogTemplateFile: string;
}

export interface SetupCheck {
	id: string;
	ok: boolean;
	title: string;
	detail: string;
}

export function setupChecklist(snapshot: SetupSnapshot): SetupCheck[] {
	const files = snapshot.files;
	const missing = files.filter((file) => !file.exists);
	const fileDetail = files.length === 0
		? 'No template or script destinations were resolved.'
		: files.map((file) => `${file.exists ? 'Present' : 'Missing'}: ${file.path}`).join(' ');
	const templatesRaw = snapshot.templatesFolder.trim();
	const scriptsRaw = snapshot.scriptsFolder.trim();
	return [
		{
			id: 'templater',
			ok: snapshot.templaterEnabled,
			title: snapshot.templaterEnabled ? 'Templater is enabled' : 'Templater is not enabled',
			detail: snapshot.templaterEnabled
				? `Templater (${TEMPLATER_PLUGIN_ID}) runs New RV and the Home / Not home templates.`
				: 'Enable Templater from Community plugins. RV Locator does not install it for you.',
		},
		{
			id: 'meta-bind',
			ok: snapshot.metaBindEnabled,
			title: snapshot.metaBindEnabled ? 'Meta Bind is enabled' : 'Meta Bind is not enabled',
			detail: snapshot.metaBindEnabled
				? `Meta Bind (${META_BIND_PLUGIN_ID}) runs the Home and Not home buttons on the note.`
				: 'Enable Meta Bind from Community plugins. RV Locator does not install it for you.',
		},
		{
			id: 'templates-folder',
			ok: templatesRaw.length > 0,
			title: templatesRaw ? `Templates folder: ${templatesRaw}` : 'Templater template folder is empty',
			detail: templatesRaw
				? `Extras write templates into ${snapshot.resolvedTemplatesFolder}/. Templater stores this as templates_folder.`
				: `Set Template folder location in Templater settings (templates_folder). Until then, extras use ${snapshot.resolvedTemplatesFolder}/.`,
		},
		{
			id: 'scripts-folder',
			ok: scriptsRaw.length > 0,
			title: scriptsRaw ? `User scripts folder: ${scriptsRaw}` : 'Templater user scripts folder is empty',
			detail: scriptsRaw
				? `Extras write scripts into ${snapshot.resolvedScriptsFolder}/. Templater stores this as user_scripts_folder.`
				: `Set User script folder in Templater settings (user_scripts_folder). Until then, extras use ${snapshot.resolvedScriptsFolder}/.`,
		},
		{
			id: 'extras',
			ok: files.length > 0 && missing.length === 0,
			title: missing.length === 0 && files.length > 0
				? 'Templates and scripts are in place'
				: 'Templates or scripts are missing',
			detail: fileDetail,
		},
		{
			id: 'suggested',
			ok: true,
			title: 'Suggested RV Locator settings',
			detail: `defaultNewRvPriority is ${snapshot.defaultNewRvPriority} (0–5). New RV file “${snapshot.newRvTemplateFile}”, Home “${snapshot.homeLogTemplateFile}”, Not home “${snapshot.missLogTemplateFile}”. linkCompanionsToNotes is ${snapshot.linkCompanionsToNotes ? 'on' : 'off'}. Change these in RV Locator settings. Companion linking is a single toggle, with no prefix or suffix.`,
		},
	];
}
