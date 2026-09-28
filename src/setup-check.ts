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
		? 'No template or script files were found.'
		: files.map((file) => `${file.exists ? 'Present' : 'Missing'}: ${file.path}`).join(' ');
	const templatesRaw = snapshot.templatesFolder.trim();
	const scriptsRaw = snapshot.scriptsFolder.trim();
	return [
		{
			id: 'templater',
			ok: snapshot.templaterEnabled,
			title: snapshot.templaterEnabled ? 'Templater is enabled' : 'Templater is not enabled',
			detail: snapshot.templaterEnabled
				? 'Templater runs New RV and the Home and Not home templates.'
				: 'Enable Templater in Community plugins. RV Locator does not install it or turn on Templater system commands.',
		},
		{
			id: 'meta-bind',
			ok: snapshot.metaBindEnabled,
			title: snapshot.metaBindEnabled ? 'Meta Bind is enabled' : 'Meta Bind is not enabled',
			detail: snapshot.metaBindEnabled
				? 'Meta Bind runs the Home and Not home buttons on the note.'
				: 'Enable Meta Bind in Community plugins. RV Locator does not install it or turn on the Meta Bind JS Engine.',
		},
		{
			id: 'templates-folder',
			ok: templatesRaw.length > 0,
			title: templatesRaw ? `Templates folder: ${templatesRaw}` : 'Templater template folder is empty',
			detail: templatesRaw
				? `Templates go in ${snapshot.resolvedTemplatesFolder}/ (Templater templates_folder).`
				: `Set the template folder in Templater (templates_folder). Until then, files go in ${snapshot.resolvedTemplatesFolder}/.`,
		},
		{
			id: 'scripts-folder',
			ok: scriptsRaw.length > 0,
			title: scriptsRaw ? `User scripts folder: ${scriptsRaw}` : 'Templater user scripts folder is empty',
			detail: scriptsRaw
				? `Scripts go in ${snapshot.resolvedScriptsFolder}/ (Templater user_scripts_folder).`
				: `Set the user scripts folder in Templater (user_scripts_folder). Until then, files go in ${snapshot.resolvedScriptsFolder}/.`,
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
				? 'A fully confident hit in one of these can be saved without asking. A hit in another county still asks you to confirm.'
				: 'None saved, so every match asks you to confirm. Add them here or under Home counties in settings.',
		},
		{
			id: 'suggested',
			ok: true,
			title: 'Suggested RV Locator settings',
			detail: `New RV priority is ${snapshot.defaultNewRvPriority} (0–5). New RV “${snapshot.newRvTemplateFile}”, Home “${snapshot.homeLogTemplateFile}”, Not home “${snapshot.missLogTemplateFile}”. Link companions to notes is ${snapshot.linkCompanionsToNotes ? 'on' : 'off'}.`,
		},
	];
}

/** Checklist rows that stay informational. Empty home counties are a valid Skip. */
const OPTIONAL_SETUP_IDS = new Set(['home-counties', 'suggested']);

/**
 * Required gaps only. Home counties are omitted because the wizard lets you skip them.
 * A blank Geoapify key is required even though the wizard checklist does not list it.
 */
export function requiredSetupGaps(snapshot: SetupSnapshot, geoapifyApiKey: string): string[] {
	const gaps: string[] = [];
	if (!geoapifyApiKey.trim()) gaps.push('geoapify');
	for (const check of setupChecklist(snapshot)) {
		if (OPTIONAL_SETUP_IDS.has(check.id) || check.ok) continue;
		gaps.push(check.id);
	}
	return gaps;
}

/** Notice while the wizard was never closed, or a required step is still missing. */
export function shouldShowSetupNudge(input: {
	wizardCompleted: boolean;
	nudgeDismissed: boolean;
	geoapifyApiKey: string;
	snapshot: SetupSnapshot;
}): boolean {
	if (input.nudgeDismissed) return false;
	if (!input.wizardCompleted) return true;
	return requiredSetupGaps(input.snapshot, input.geoapifyApiKey).length > 0;
}
