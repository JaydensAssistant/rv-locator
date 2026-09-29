import { Modal, Setting, type App } from 'obsidian';
import type { SnoozeChoice } from './snooze';

export class ReturnSuggestModal extends Modal {
	constructor(app: App, private displayName: string, private markdown: string) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Return times');
		this.modalEl.addClass('rv-locator-modal');
		const { contentEl } = this;
		contentEl.createDiv({ cls: 'rv-locator-modal-copy', text: this.displayName });
		const host = contentEl.createDiv('rv-locator-return-digest');
		for (const line of this.markdown.split('\n')) {
			if (!line.trim()) continue;
			const row = host.createDiv({ cls: 'rv-locator-return-line' });
			if (line.startsWith('**Avoid**')) row.addClass('is-avoid');
			if (line.startsWith('**Try**')) row.addClass('is-try');
			if (line.startsWith('|')) row.addClass('is-table');
			row.setText(line.replaceAll('**', ''));
		}
		new Setting(contentEl).addButton((button) => {
			button.setButtonText('Close');
			button.onClick(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class UrgencySnoozeModal extends Modal {
	constructor(
		app: App,
		private displayName: string,
		private snoozed: boolean,
		private onChoose: (choice: SnoozeChoice | 'clear') => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Snooze urgency');
		this.modalEl.addClass('rv-locator-modal');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: `Hold urgency at 0 for “${this.displayName}”. Priority stays as it is.`,
		});
		const row = new Setting(contentEl);
		for (const choice of [
			['today', 'Today'],
			['7', '7 days'],
			['14', '14 days'],
		] as const) {
			row.addButton((button) => {
				button.setButtonText(choice[1]);
				button.onClick(() => {
					this.onChoose(choice[0]);
					this.close();
				});
			});
		}
		if (this.snoozed) {
			new Setting(contentEl).addButton((button) => {
				button.setButtonText('Clear snooze');
				button.onClick(() => {
					this.onChoose('clear');
					this.close();
				});
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class PriorityNudgeModal extends Modal {
	constructor(
		app: App,
		private current: number,
		private onChoose: (next: number) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Priority');
		this.modalEl.addClass('rv-locator-modal');
		const { contentEl } = this;
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: `Current priority is ${this.current}.`,
		});
		contentEl.createEl('p', {
			cls: 'rv-locator-modal-copy',
			text: 'Lower it if interest has cooled. Stay if progress is about the same. Raise it if you are closer to studying.',
		});
		new Setting(contentEl)
			.addButton((button) => {
				button.setButtonText('−1');
				button.setDisabled(this.current <= 0);
				button.onClick(() => {
					this.onChoose(Math.max(0, this.current - 1));
					this.close();
				});
			})
			.addButton((button) => {
				button.setButtonText('Stay');
				button.setCta();
				button.onClick(() => this.close());
			})
			.addButton((button) => {
				button.setButtonText('+1');
				button.setDisabled(this.current >= 5);
				button.onClick(() => {
					this.onChoose(Math.min(5, this.current + 1));
					this.close();
				});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
