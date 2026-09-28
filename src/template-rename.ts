import {
	DEFAULT_TEMPLATES_FOLDER,
	pathInsideFolder,
	safeTemplateFileName,
	safeVaultFolder,
} from './extras-sync';

/** What sits at a path inside the Templater templates folder. */
export type TemplatePathState = 'missing' | 'file' | 'other';

export type TemplateRenamePlan =
	| { action: 'noop'; reason: 'unchanged' }
	| { action: 'save-only'; reason: 'both-missing' | 'already-aligned' }
	| { action: 'rename'; from: string; to: string }
	| { action: 'refuse'; reason: 'destination-exists' | 'outside-folder' | 'not-a-file'; notice: string };

export interface TemplateRenameVault {
	fileState(path: string): TemplatePathState;
	renameFile(from: string, to: string): Promise<void>;
	markdownFiles(): { path: string }[];
	read(path: string): Promise<string>;
	modify(path: string, contents: string): Promise<void>;
}

export interface TemplateSettingChange {
	/** Name to keep in settings. The previous name when the rename is refused. */
	name: string;
	notice: string | null;
	/** Blur of an unfinished name should put the field back to the saved name. */
	revertField: boolean;
}

/**
 * Decide how a template file name change maps onto the templates folder.
 * Names that are not plain basenames are refused. An existing destination is
 * never overwritten.
 */
export function planTemplateRename(input: {
	templatesFolder: unknown;
	oldName: string;
	newName: string;
	oldState: TemplatePathState;
	newState: TemplatePathState;
}): TemplateRenamePlan {
	const folder = safeVaultFolder(input.templatesFolder, DEFAULT_TEMPLATES_FOLDER);
	const oldName = safeTemplateFileName(input.oldName, '');
	const newName = safeTemplateFileName(input.newName, '');
	if (!oldName || !newName) {
		return {
			action: 'refuse',
			reason: 'outside-folder',
			notice: 'That name is not a file name, so nothing was renamed.',
		};
	}
	if (oldName === newName) return { action: 'noop', reason: 'unchanged' };
	const from = `${folder}/${oldName}`;
	const to = `${folder}/${newName}`;
	if (!pathInsideFolder(folder, from) || !pathInsideFolder(folder, to)) {
		return {
			action: 'refuse',
			reason: 'outside-folder',
			notice: 'The file has to stay in Templater’s templates folder, so nothing was renamed.',
		};
	}
	if (input.oldState === 'other') {
		return {
			action: 'refuse',
			reason: 'not-a-file',
			notice: `${from} is not a note, so it was not renamed.`,
		};
	}
	if (input.newState !== 'missing') {
		if (input.oldState === 'missing' && input.newState === 'file') {
			return { action: 'save-only', reason: 'already-aligned' };
		}
		return {
			action: 'refuse',
			reason: 'destination-exists',
			notice: `Did not rename. ${to} already exists.`,
		};
	}
	if (input.oldState === 'missing') return { action: 'save-only', reason: 'both-missing' };
	return { action: 'rename', from, to };
}

/**
 * Replace Meta Bind `templateFile:` values that are exactly `fromPath`.
 * Other lines, including a longer path that only starts with that name, stay.
 */
export function rewriteTemplateFilePaths(contents: string, fromPath: string, toPath: string): string {
	const from = fromPath.trim();
	const to = toPath.trim();
	if (!from || !to || from === to) return contents;
	if (from.includes('\n') || to.includes('\n') || from.includes('\r') || to.includes('\r')) return contents;
	return contents.replace(
		/^([ \t]*templateFile:[ \t]*)([^\n\r]*)(\r?)$/gm,
		(full, prefix: string, raw: string, carriage: string) => {
			const parsed = unquoteTemplatePath(raw);
			if (parsed.value !== from) return full;
			const replacement = parsed.quote ? `${parsed.quote}${to}${parsed.quote}` : to;
			return `${prefix}${replacement}${carriage}`;
		},
	);
}

/**
 * Apply one real change of a template file name.
 * The same name, including a half-typed name, does not touch the vault.
 */
export async function applyTemplateSettingChange(
	vault: TemplateRenameVault,
	input: {
		templatesFolder: unknown;
		previous: string;
		typed: string;
		fallbackName: string;
		rewriteReferences: boolean;
		fromBlur: boolean;
	},
): Promise<TemplateSettingChange> {
	const previous = safeTemplateFileName(input.previous, input.fallbackName);
	const next = safeTemplateFileName(input.typed.trim(), previous);
	if (next === previous) {
		const unfinished = input.typed.trim() !== previous;
		return { name: previous, notice: null, revertField: input.fromBlur && unfinished };
	}
	const folder = safeVaultFolder(input.templatesFolder, DEFAULT_TEMPLATES_FOLDER);
	const plan = planTemplateRename({
		templatesFolder: folder,
		oldName: previous,
		newName: next,
		oldState: vault.fileState(`${folder}/${previous}`),
		newState: vault.fileState(`${folder}/${next}`),
	});
	if (plan.action === 'noop') return { name: previous, notice: null, revertField: false };
	if (plan.action === 'refuse') return { name: previous, notice: plan.notice, revertField: true };
	if (plan.action === 'save-only') return { name: next, notice: null, revertField: false };
	try {
		await vault.renameFile(plan.from, plan.to);
	} catch {
		if (vault.fileState(plan.to) !== 'missing') {
			return {
				name: previous,
				notice: `Did not rename. ${plan.to} already exists.`,
				revertField: true,
			};
		}
		return {
			name: previous,
			notice: `Could not rename ${plan.from} to ${plan.to}.`,
			revertField: true,
		};
	}
	if (!input.rewriteReferences) {
		return { name: next, notice: `Renamed ${plan.from} to ${plan.to}.`, revertField: false };
	}
	const rewritten = await rewriteTemplateReferences(vault, plan.from, plan.to);
	let notice = `Renamed ${plan.from} to ${plan.to}.`;
	if (rewritten.updated > 0) {
		const notes = rewritten.updated === 1 ? 'note' : 'notes';
		notice = `${notice} Updated ${rewritten.updated} ${notes} that pointed at the old template.`;
	}
	if (rewritten.failed > 0) notice = `${notice} Some notes could not be updated.`;
	return { name: next, notice, revertField: false };
}

async function rewriteTemplateReferences(
	vault: TemplateRenameVault,
	from: string,
	to: string,
): Promise<{ updated: number; failed: number }> {
	let updated = 0;
	let failed = 0;
	for (const file of vault.markdownFiles()) {
		try {
			const contents = await vault.read(file.path);
			const next = rewriteTemplateFilePaths(contents, from, to);
			if (next === contents) continue;
			await vault.modify(file.path, next);
			updated += 1;
		} catch {
			failed += 1;
		}
	}
	return { updated, failed };
}

function unquoteTemplatePath(raw: string): { value: string; quote: '"' | "'" | '' } {
	const text = raw.trim();
	if (text.length >= 2) {
		const quote = text[0];
		if ((quote === '"' || quote === "'") && text.endsWith(quote)) {
			return { value: text.slice(1, -1), quote };
		}
	}
	return { value: text, quote: '' };
}
