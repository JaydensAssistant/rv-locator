import { Modal, Setting, TFile, normalizePath, type App } from 'obsidian';
import { extrasDestinations, type ExtrasPlacement } from './extras-sync';
import { TEMPLATER_PLUGIN_ID } from './new-rv-launch';
import { META_BIND_PLUGIN_ID, setupChecklist, type SetupSnapshot } from './setup-check';
import type { RVLocatorSettings } from './types';

interface PluginHost {
	plugins?: {
		enabledPlugins?: { has?: (id: string) => boolean };
		plugins?: Record<string, unknown>;
	};
}

export function pluginEnabled(app: App, id: string): boolean {
	const host = app as App & PluginHost;
	if (host.plugins?.enabledPlugins?.has?.(id)) return true;
	return Boolean(host.plugins?.plugins?.[id]);
}

export async function readSetupSnapshot(
	app: App,
	settings: RVLocatorSettings,
	placement: ExtrasPlacement,
	templaterSettings: { templates_folder?: unknown; user_scripts_folder?: unknown } | null,
): Promise<SetupSnapshot> {
	const files: SetupSnapshot['files'] = [];
	for (const file of extrasDestinations(app.vault.configDir, placement)) {
		const path = normalizePath(file.vault);
		files.push({ path, exists: app.vault.getAbstractFileByPath(path) instanceof TFile });
	}
	const templatesFolder = typeof templaterSettings?.templates_folder === 'string' ? templaterSettings.templates_folder : '';
	const scriptsFolder = typeof templaterSettings?.user_scripts_folder === 'string' ? templaterSettings.user_scripts_folder : '';
	return {
		templaterEnabled: pluginEnabled(app, TEMPLATER_PLUGIN_ID),
		metaBindEnabled: pluginEnabled(app, META_BIND_PLUGIN_ID),
		templatesFolder,
		scriptsFolder,
		resolvedTemplatesFolder: placement.templatesFolder,
		resolvedScriptsFolder: placement.scriptsFolder,
		files,
		defaultNewRvPriority: settings.defaultNewRvPriority,
		linkCompanionsToNotes: settings.linkCompanionsToNotes,
		newRvTemplateFile: settings.newRvTemplateFile,
		homeLogTemplateFile: settings.homeLogTemplateFile,
		missLogTemplateFile: settings.missLogTemplateFile,
	};
}

export interface SetupWizardActions {
	onDismiss: () => void;
	onPlaceExtras: () => void;
	openCommunityPlugins: () => void;
	openTemplaterSettings: () => void;
	openMetaBindSettings: () => void;
}

export class SetupWizardModal extends Modal {
	private closed = false;
	private renderGeneration = 0;

	constructor(
		app: App,
		private load: () => Promise<SetupSnapshot>,
		private actions: SetupWizardActions,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('RV Locator setup');
		void this.render();
	}

	onClose(): void {
		this.closed = true;
		this.renderGeneration += 1;
		this.actions.onDismiss();
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		const generation = ++this.renderGeneration;
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', {
			text: 'Check Templater and Meta Bind, then place the New RV templates and scripts into the folders Templater is using. RV Locator does not install community plugins.',
		});
		const snapshot = await this.load();
		if (this.closed || generation !== this.renderGeneration) return;
		const list = contentEl.createEl('ul', { cls: 'rv-locator-check-list' });
		for (const check of setupChecklist(snapshot)) {
			const item = list.createEl('li', { cls: check.ok ? 'rv-locator-check-ok' : 'rv-locator-check-miss' });
			item.createDiv({
				cls: 'rv-locator-check-title',
				text: `${check.ok ? 'Ready' : 'Needs attention'}: ${check.title}`,
			});
			item.createDiv({ cls: 'rv-locator-check-detail', text: check.detail });
		}
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Community plugins');
				button.onClick(() => { this.actions.openCommunityPlugins(); });
			})
			.addButton((button) => {
				button.setButtonText('Templater settings');
				button.onClick(() => { this.actions.openTemplaterSettings(); });
			})
			.addButton((button) => {
				button.setButtonText('Meta Bind settings');
				button.onClick(() => { this.actions.openMetaBindSettings(); });
			});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Place extras');
				button.setCta();
				button.onClick(() => { this.actions.onPlaceExtras(); });
			})
			.addButton((button) => {
				button.setButtonText('Check again');
				button.onClick(() => { void this.render(); });
			});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('Done');
				button.onClick(() => { this.close(); });
			});
	}
}
