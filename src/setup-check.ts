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
	/** Saved home-base counties. Empty means geocode always asks you to confirm. */
	homeCounties: string[];
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
				: 'Enable Templater from Community plugins. RV Locator does not install or enable it, and it does not turn on Templater system commands.',
		},
		{
			id: 'meta-bind',
			ok: snapshot.metaBindEnabled,
			title: snapshot.metaBindEnabled ? 'Meta Bind is enabled' : 'Meta Bind is not enabled',
			detail: snapshot.metaBindEnabled
				? `Meta Bind (${META_BIND_PLUGIN_ID}) runs the Home and Not home buttons on the note.`
				: 'Enable Meta Bind from Community plugins. RV Locator does not install or enable it, and it does not turn on the Meta Bind JS Engine.',
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
			id: 'home-counties',
			ok: true,
			title: snapshot.homeCounties.length > 0
				? `Home counties: ${snapshot.homeCounties.join(', ')}`
				: 'Home counties: none',
			detail: snapshot.homeCounties.length > 0
				? 'These are the counties where you normally work return visits. A fully confident geocode hit in one of them can be saved without asking. A hit in another county still asks you to confirm, so a wrong city is less likely to be saved.'
				: 'No home counties are saved, so every geocode match asks you to confirm. Add them in this wizard or under Home base counties in RV Locator settings.',
		},
		{
			id: 'suggested',
			ok: true,
			title: 'Suggested RV Locator settings',
			detail: `defaultNewRvPriority is ${snapshot.defaultNewRvPriority} (0–5). New RV file “${snapshot.newRvTemplateFile}”, Home “${snapshot.homeLogTemplateFile}”, Not home “${snapshot.missLogTemplateFile}”. linkCompanionsToNotes is ${snapshot.linkCompanionsToNotes ? 'on' : 'off'}. Change these in RV Locator settings. Companion linking is a single toggle, with no prefix or suffix.`,
		},
	];
}
