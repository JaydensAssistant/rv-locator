import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { stripRenameState } from '../src/rename-guard';
import { isRvLocatorSurface } from '../src/rv-note-view';
import { pinMatches, storeFrontmatter } from '../src/visit-paint-guard';

const source = (file: string): string => readFileSync(file, 'utf8');

describe('locked next build', () => {
	it('RV-67A keeps a stale parse from replacing the visit pin', () => {
		const pinned = {
			'Last Spoke': '2026-11-02T15:00:00',
			Visits: 4,
			'Left Publications': 'Will Suffering Ever End?',
		};
		const stale = {
			'Last Spoke': '2026-10-01T15:00:00',
			Visits: 3,
			'Left Publications': '',
			Address: '123 Oak St',
		};
		const behind = storeFrontmatter(stale, pinned);
		assert.equal(behind.clearPin, false);
		assert.equal(behind.stored['Last Spoke'], '2026-11-02T15:00:00');
		assert.equal(behind.stored.Visits, 4);
		assert.equal(behind.stored.Address, '123 Oak St');
		const fresh = { ...stale, ...pinned };
		assert.equal(pinMatches(fresh, pinned), true);
		const caughtUp = storeFrontmatter(fresh, pinned);
		assert.equal(caughtUp.clearPin, true);
		assert.equal(caughtUp.stored.Visits, 4);
		const main = source('src/main.ts');
		const commit = main.slice(main.indexOf('private async commitVisit'), main.indexOf('promptPastVisit(file: TFile)'));
		assert.ok(commit.indexOf('writeVisitHeadThenBody') < commit.indexOf('rememberShare'));
		assert.equal(commit.includes('vault.process'), false);
		const changed = main.slice(main.indexOf("metadataCache.on('changed'"), main.indexOf("vault.on('modify'"));
		assert.match(changed, /storeFrontmatter/);
		assert.match(changed, /clearPin/);
		const front = main.slice(main.indexOf('noteFrontmatter(path: string)'), main.indexOf('private async writeAddress'));
		assert.equal(front.includes('this.visitPaint.delete'), false);
	});

	it('RV-157 strips a Templater rename request after New RV', () => {
		assert.deepEqual(stripRenameState({ rename: 'all', mode: 'preview' }), { mode: 'preview' });
		assert.deepEqual(stripRenameState({ mode: 'preview' }), { mode: 'preview' });
		assert.equal(stripRenameState(null), null);
		const main = source('src/main.ts');
		const launch = main.slice(main.indexOf('private async launchNewRvTemplate'), main.indexOf('private async writeNewRvShare'));
		assert.match(launch, /installRenameSwallow\(WorkspaceLeaf\)/);
		assert.match(launch, /dismissNoteTitleModal/);
		assert.match(source('src/new-rv-modal.ts'), /Address is required\./);
		assert.match(source('src/new-rv-modal.ts'), /setLimits\(1,\s*5\)/);
	});

	it('RV-159 routes the heading strip through fitTitleRow and keeps two lines', () => {
		const controls = source('src/visit-controls.ts');
		const paint = controls.slice(controls.indexOf('function paintItemStrip'), controls.indexOf('export function fillItemStrip'));
		assert.match(paint, /fitHeadingStrip/);
		assert.equal(paint.includes('refitItemStrip'), false);
		assert.match(controls, /export function fitHeadingStrip/);
		assert.match(controls, /fitTitleRow\(strip\)/);
		assert.match(controls, /Campaign stays/);
		assert.match(controls, /\+n button/);
		const css = source('styles.css');
		assert.match(css, /\.rv-item-strip\.is-two-line:not\(\.is-ghost\) > \.rv-strip-break \{[^}]*display:\s*block/);
		assert.match(css, /\.rv-item-strip:not\(\.is-ghost\) > \.rv-item,[\s\S]{0,80}\.rv-fit \{[^}]*min-width:\s*0/);
		assert.match(css, /\.rv-item-strip:not\(\.is-ghost\) > \.rv-item\.is-campaign \{[^}]*flex:\s*0 0 auto/);
	});

	it('RV-74B keeps the age and restroom icon from shrinking', () => {
		const css = source('styles.css');
		assert.match(css, /\.rv-locator-glancable \.rv-locator-card-name \.rv-locator-file-link \{[^}]*flex:\s*0 1 auto/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-card-name \.rv-title-age \{[^}]*flex-shrink:\s*0/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-card-name \.rv-title-gender \{[^}]*flex-shrink:\s*0/);
	});

	it('RV-160D and RV-160E center the embed and cap the frame', () => {
		const css = source('styles.css');
		assert.match(css, /--file-margins-x:\s*0px/);
		assert.match(css, /--file-margins-y:\s*0px/);
		assert.match(css, /--bases-embed-transform:\s*none/);
		assert.match(css, /\.is-embed-capped \{[^}]*height:\s*var\(--rv-embed-cap\) !important/);
		assert.match(css, /transform:\s*none !important/);
		const view = source('src/glancable-view.ts');
		const frame = view.slice(view.indexOf('private sizeEmbedFrame'), view.indexOf('private bindHubHandle'));
		assert.match(frame, /is-embed-capped/);
		assert.match(frame, /transform', 'none'/);
		assert.match(frame, /overflow', 'hidden'/);
		assert.equal(frame.includes("overflow', 'visible'"), false);
		assert.match(frame, /Math\.max\(160/);
		assert.equal(isRvLocatorSurface({ cssclasses: ['rv-locator-full-base'] }), true);
		assert.equal(isRvLocatorSurface({ cssclass: 'rv-dashboard' }), true);
		assert.equal(isRvLocatorSurface({ cssclasses: ['other'] }), false);
		const main = source('src/main.ts');
		assert.match(main, /rv-hide-mobile-nav/);
		assert.match(main, /isRvLocatorSurface/);
		assert.match(css, /body\.rv-hide-mobile-nav \.mobile-navbar \{[^}]*display:\s*none !important/);
		assert.match(css, /content:\s*'Return Visits'/);
		assert.match(css, /body\.is-phone \.workspace-leaf-content:has\(\.rv-locator-full-base\) > \.view-header::after/);
		assert.match(css, /body\.is-phone \.markdown-preview-view\.rv-locator-full-base[\s\S]*overflow:\s*hidden !important/);
		assert.match(css, /\.modal\.rv-locator-modal button\.rv-priority-seg\.is-selected \{[^}]*box-shadow:[^}]*0 0 0 4px #d6d6d6 !important/);
		const edit = source('src/new-rv-modal.ts').slice(source('src/new-rv-modal.ts').indexOf('export class EditAttributesModal'));
		assert.ok(edit.indexOf("mountGenderButton(button, 'Woman'") < edit.indexOf("mountGenderButton(button, 'Man'"));
		assert.match(source('src/main.ts'), /pointNewNoteAtLogTemplates/);
		assert.match(source('src/main.ts'), /scheduleReadingDecorate/);
	});

	it('RV-162 through RV-165 lock the phone forehead and the Visit Facts row', () => {
		const css = source('styles.css');
		const phoneAt = css.indexOf('/* RV-162.');
		const phoneQuote = css.slice(phoneAt, css.indexOf('body.is-phone .markdown-preview-view.rv-locator-full-base', phoneAt));
		assert.match(phoneQuote, /body\.is-phone \.markdown-preview-view\.rv-dashboard \.markdown-preview-sizer > \.el-div > \.callout\[data-callout="quote"\]:not\(\.rv-locator-return-suggestions\) \{\s*margin-top:\s*0 !important;\s*\}/);
		assert.match(phoneQuote, /body\.is-phone \.markdown-preview-view\.rv-dashboard \.markdown-preview-sizer > \.el-div:has\(> \.callout\[data-callout="quote"\]:not\(\.rv-locator-return-suggestions\)\) \{\s*margin-top:\s*-5px !important;\s*\}/);
		assert.equal(phoneQuote.includes('markdown-source-view'), false);
		const headAt = css.indexOf('/* RV-163.');
		const head = css.slice(headAt, css.indexOf('.rv-qf-row {', headAt));
		assert.match(head, /\.rv-dashboard \.rv-qf-head \{[^}]*gap:\s*0;/);
		assert.match(head, /\.rv-dashboard \.rv-qf-head-label \{[^}]*font-size:\s*16px;[^}]*font-weight:\s*var\(--bold-weight, 600\);[^}]*line-height:\s*1\.2;[^}]*letter-spacing:\s*normal;[^}]*color:\s*var\(--text-muted\);/);
		assert.match(head, /\.rv-dashboard \.rv-qf-head-dot \{[^}]*margin-left:\s*9px;[^}]*margin-right:\s*8px;/);
		assert.match(head, /\.rv-dashboard \.rv-qf-head-count \{[^}]*font-size:\s*10px;[^}]*font-weight:\s*400;[^}]*line-height:\s*11px;/);
		assert.match(head, /\.rv-dashboard \.rv-qf-head-ratio \{[^}]*font-size:\s*10px;[^}]*line-height:\s*11px;/);
		assert.match(head, /\.rv-dashboard \.rv-qf-head-icon \{[^}]*margin-left:\s*-3px;/);
		assert.match(head, /\.rv-dashboard \.rv-qf-head-icon svg \{[^}]*width:\s*11px;[^}]*height:\s*11px;/);
		assert.match(head, /\.rv-dashboard \.callout\[data-callout="rv"\] > \.callout-title > \.callout-fold \{[^}]*color:\s*var\(--text-muted\);[^}]*font-weight:\s*var\(--bold-weight, 600\);/);
		assert.equal(head.includes('font-size: 13px'), false);
		assert.equal(head.includes('font-size: 11px'), false);
		assert.equal(head.includes('.rv-qf-badges'), false);
	});
});
