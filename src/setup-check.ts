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
	/** True when a Geoapify API key is saved. The key itself is not copied here. */
	geoapifyConfigured: boolean;
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
	const templatesReady = templaterFolderReady(templatesRaw, snapshot.resolvedTemplatesFolder, snapshot.files);
	const scriptsReady = templaterFolderReady(scriptsRaw, snapshot.resolvedScriptsFolder, snapshot.files);
	return [
		{
			id: 'geoapify',
			ok: snapshot.geoapifyConfigured,
			title: snapshot.geoapifyConfigured ? 'Geoapify API key is set' : 'Geoapify API key is missing',
			detail: snapshot.geoapifyConfigured
				? 'Nearby and geocode use the key saved in RV Locator settings.'
				: 'Add a Geoapify API key in RV Locator settings. The setup notice stays up until that key is saved.',
		},
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
			ok: templatesReady,
			title: templatesRaw
				? `Templates folder: ${templatesRaw}`
				: templatesReady
					? `Templates folder: ${snapshot.resolvedTemplatesFolder} (Templater setting is empty)`
					: 'Templater template folder is empty',
			detail: templatesRaw
				? `Templates go in ${snapshot.resolvedTemplatesFolder}/ (Templater templates_folder).`
				: templatesReady
					? `Templater’s templates_folder is empty. The template files are already in ${snapshot.resolvedTemplatesFolder}/, and that fallback is enough until the setting is filled in.`
					: `Set the template folder in Templater (templates_folder). Until then, files go in ${snapshot.resolvedTemplatesFolder}/. The fallback counts only when those template files are already there.`,
		},
		{
			id: 'scripts-folder',
			ok: scriptsReady,
			title: scriptsRaw
				? `User scripts folder: ${scriptsRaw}`
				: scriptsReady
					? `User scripts folder: ${snapshot.resolvedScriptsFolder} (Templater setting is empty)`
					: 'Templater user scripts folder is empty',
			detail: scriptsRaw
				? `Scripts go in ${snapshot.resolvedScriptsFolder}/ (Templater user_scripts_folder).`
				: scriptsReady
					? `Templater’s user_scripts_folder is empty. The script files are already in ${snapshot.resolvedScriptsFolder}/, and that fallback is enough until the setting is filled in.`
					: `Set the user scripts folder in Templater (user_scripts_folder). Until then, files go in ${snapshot.resolvedScriptsFolder}/. The fallback counts only when those script files are already there.`,
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
			detail: `New RV priority is ${snapshot.defaultNewRvPriority} (0–5). New RV “${snapshot.newRvTemplateFile}”, Home “${snapshot.homeLogTemplateFile}”, Not home “${snapshot.missLogTemplateFile}”.`,
		},
	];
}

/** Checklist rows that stay informational. Empty home counties are a valid Skip. */
const OPTIONAL_SETUP_IDS = new Set(['home-counties', 'suggested']);

/**
 * A blank Templater folder is Ready when every extras file in the fallback
 * folder is already present. The wizard row and the setup notice share this
 * check, so Templates/ or Scripts/ does not nag once those files are there.
 */
function templaterFolderReady(raw: string, resolved: string, files: SetupFileStatus[]): boolean {
	if (raw.trim().length > 0) return true;
	const prefix = `${resolved.trim().replace(/\\/g, '/').replace(/\/+$/, '')}/`;
	if (prefix === '/') return false;
	const placed = files.filter((file) => file.path.replace(/\\/g, '/').startsWith(prefix));
	return placed.length > 0 && placed.every((file) => file.exists);
}

/**
 * Required gaps only. Home counties are omitted because the wizard lets you skip them.
 * The suggestion row is informational. Every other checklist row, including the
 * Geoapify key, is required, and the wizard shows that same row.
 * The key argument is what the checklist uses for Geoapify, so the notice cannot
 * disagree with the wizard about whether the key is set.
 */
export function requiredSetupGaps(snapshot: SetupSnapshot, geoapifyApiKey: string): string[] {
	const aligned: SetupSnapshot = {
		...snapshot,
		geoapifyConfigured: geoapifyApiKey.trim().length > 0,
	};
	const gaps: string[] = [];
	for (const check of setupChecklist(aligned)) {
		if (OPTIONAL_SETUP_IDS.has(check.id) || check.ok) continue;
		gaps.push(check.id);
	}
	return gaps;
}

/**
 * The unfinished-setup notice uses the same required gaps as the wizard.
 * Once those gaps are empty, the notice stays down even if `wizardCompleted`
 * is still false (setup finished in Settings, or the wizard already shows Ready).
 * Callers persist `setupWizardCompleted` when {@link shouldPersistSetupWizardCompleted}
 * is true. Closing the wizard with Done also persists that flag, including when
 * a gap remains. `nudgeDismissed` hides the notice while a gap remains and does
 * not by itself mark setup complete.
 */
export function shouldShowSetupNudge(input: {
	wizardCompleted: boolean;
	nudgeDismissed: boolean;
	geoapifyApiKey: string;
	snapshot: SetupSnapshot;
}): boolean {
	if (input.nudgeDismissed) return false;
	return requiredSetupGaps(input.snapshot, input.geoapifyApiKey).length > 0;
}

/**
 * Save `setupWizardCompleted` when every required gap is already gone and the
 * flag is still false. Done on the wizard saves the flag separately, even if
 * a gap remains, so closing the wizard is not the only way the flag is set.
 */
export function shouldPersistSetupWizardCompleted(
	wizardCompleted: boolean,
	snapshot: SetupSnapshot,
	geoapifyApiKey: string,
): boolean {
	if (wizardCompleted) return false;
	return requiredSetupGaps(snapshot, geoapifyApiKey).length === 0;
}
