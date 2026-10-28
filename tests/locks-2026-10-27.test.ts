import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ageCaption, genderIcon, replacePersonName, RESTROOM_MAN, RESTROOM_WOMAN } from '../src/person-meta';
import { urgencyInk } from '../src/urgency-palette';

const source = (file: string): string => readFileSync(file, 'utf8');
const css = source('styles.css');

describe('next build locks', () => {
	it('1 full-base leaves one scrollbar and hides the raw base link', () => {
		const view = source('src/glancable-view.ts');
		assert.match(view, /export function concealRawBaseEmbed/);
		assert.match(view, /rv-base-source-hidden/);
		assert.match(view, /overflow', 'visible'/);
		assert.match(css, /\.markdown-preview-view\.rv-locator-full-base[\s\S]*scrollbar-width:\s*auto/);
		assert.match(css, /overflow:\s*visible !important/);
	});

	it('2 reopens every leaf that had the note, on that same leaf', () => {
		const main = source('src/main.ts');
		assert.match(main, /holdOpenLeaves\(file\)/);
		assert.match(main, /for \(const open of opens\) await this\.reopenOnLeaf\(open\.leaf, renamed, open\.held\)/);
		assert.match(main, /leaf\.setViewState\(\{ type: 'empty', state: \{\} \}\)/);
		assert.doesNotMatch(main, /leaf\.detach\(\)/);
	});

	it('3 title row is campaign, status, name, muted age, muted gender', () => {
		const chrome = source('src/note-chrome.ts');
		const heading = chrome.slice(chrome.indexOf('function decorateDashboardHeading'), chrome.indexOf('function decorateNoteTitle'));
		assert.ok(heading.indexOf('rv-dash-campaign') < heading.indexOf('rv-dash-status'));
		assert.ok(heading.indexOf('rv-dash-name') < heading.indexOf('appendPersonMeta'));
		assert.match(css, /\.rv-title-age \{[^}]*color:\s*var\(--text-muted\)/);
		assert.match(css, /\.rv-title-gender \{[^}]*color:\s*var\(--text-muted\)/);
		assert.match(source('src/glancable-view.ts'), /cardPersonTitle\(row\.name, true\)/);
	});

	it('4 restroom figures replace mars and venus on the gender buttons', () => {
		const modal = source('src/new-rv-modal.ts');
		assert.equal(genderIcon('Man'), RESTROOM_MAN);
		assert.equal(genderIcon('Woman'), RESTROOM_WOMAN);
		assert.match(modal, /RESTROOM_MAN/);
		assert.match(modal, /RESTROOM_WOMAN/);
		assert.doesNotMatch(modal, /'mars'|'venus'/);
	});

	it('5 estimated age keeps the sprout icon', () => {
		assert.match(source('src/modal-chrome.ts'), /\/estimated age\|\^age\$\/i, 'sprout'/);
	});

	it('6 foot line uses list-checks, no hash, and a 3px gap', () => {
		const foot = source('src/glance-foot.ts');
		assert.match(foot, /setIcon\(icon, 'list-checks'\)/);
		assert.match(foot, /setIcon\(moon, 'moon'\)/);
		assert.match(foot, /rv-locator-return-when/);
		assert.match(foot, /rv-foot-days/);
		assert.doesNotMatch(foot, /# \$\{/);
		assert.match(css, /gap:\s*3px/);
	});

	it('7 calendar tiles are 26px with no band, and Quick Facts tiles are 18px', () => {
		assert.match(css, /\.rv-cal \{[^}]*width:\s*26px/);
		assert.match(css, /\.rv-cal \{[^}]*height:\s*26px/);
		assert.match(css, /\.rv-cal \{[^}]*background:\s*#2f2f2f/);
		assert.match(css, /\.rv-cal \{[^}]*border:\s*1px solid #4a4a4a/);
		assert.match(css, /\.rv-cal-month \{[^}]*font-size:\s*7\.5px/);
		assert.match(css, /\.rv-cal-month \{[^}]*font-weight:\s*700/);
		assert.match(css, /\.rv-cal-day \{[^}]*font-size:\s*12px/);
		assert.match(css, /\.rv-cal-day \{[^}]*color:\s*#fff/);
		assert.doesNotMatch(css, /border-top:\s*2px solid var\(--rv-urgency-accent/);
		assert.match(css, /\.rv-qf-pill \.rv-cal \{[^}]*width:\s*18px/);
	});

	it('8 note sections use 16px and 8px while visits stay 24px apart', () => {
		assert.match(css, /margin-top:\s*16px;\s*margin-bottom:\s*8px/);
		assert.match(css, /has\(> h5\.rv-visit-stamp\) \{\s*margin-top:\s*24px/);
		assert.match(css, /margin-top:\s*8px !important/);
		assert.match(css, /\.cm-s-obsidian \.cm-line\.rv-lp-visit-heading ~ \.cm-line\.rv-lp-visit-heading \{\s*padding-top:\s*24px/);
	});

	it('9 Quick Facts leads with the visit count and puts Met With on the right', () => {
		const chrome = source('src/note-chrome.ts');
		assert.match(chrome, /function mountQuickFactsHead/);
		assert.match(chrome, /setIcon\(icon, 'list-checks'\)/);
		assert.match(chrome, /chip\.met \? 'rv-qf-chip is-met'/);
		assert.match(css, /\.rv-qf-chip\.is-met \{[^}]*border-color:\s*var\(--rv-urgency-accent/);
		assert.match(css, /\.rv-qf-row:last-child \{\s*border-bottom:\s*0/);
		const body = chrome.slice(chrome.indexOf('function paintFactsBody'), chrome.indexOf('function visitsPercent'));
		assert.doesNotMatch(body, /factRow\(content, 'gauge'/);
		assert.doesNotMatch(body, /Status', ''\)/);
	});

	it('10 Edit attributes keeps the name as the person and adds status and age', () => {
		const modal = source('src/new-rv-modal.ts');
		const main = source('src/main.ts');
		assert.match(modal, /setName\('Status'\)/);
		assert.match(modal, /setName\('Estimated age'\)/);
		assert.match(modal, /setButtonText\('Approx'\)/);
		assert.match(modal, /setButtonText\('Exact'\)/);
		assert.match(main, /cardPersonTitle\(file\.basename, true\)/);
		assert.match(main, /replacePersonName\(current\.basename, next\.name\)/);
		assert.match(css, /\.modal\.rv-edit-attributes \.rv-gender-choice \.setting-item-control button/);
	});

	it('11 RV modals use urgency ink and general modals use #1f8a4c', () => {
		assert.equal(urgencyInk('#d6a100'), '#111111');
		assert.equal(urgencyInk('#d63c3c'), '#ffffff');
		assert.match(source('src/modal-chrome.ts'), /function markModalTone/);
		assert.match(css, /background-color:\s*#1f8a4c !important/);
		assert.match(css, /background-color:\s*var\(--rv-modal-accent\) !important/);
		assert.match(source('src/campaign-modal.ts'), /markModalTone\(this\.modalEl, 'general'\)/);
		assert.match(source('src/score-modals.ts'), /markModalTone\(this\.modalEl, 'rv', this\.buttonAccent\)/);
	});

	it('12 campaign start and end dates are equal full-width pickers', () => {
		const campaign = source('src/campaign-modal.ts');
		assert.match(campaign, /setClass\('rv-date-line'\)/);
		assert.match(campaign, /inputEl\.type = 'date'/);
		assert.match(css, /\.modal\.rv-campaign \.rv-date-line input\[type="date"\] \{\s*width:\s*100%/);
	});

	it('13 literature and media stay visible and the log stays collapsed', () => {
		const main = source('src/main.ts');
		assert.match(main, /showLiterature: true/);
		assert.match(main, /literatureCollapsed: study/);
		assert.match(main, /studyFirst: study/);
		const body = source('src/note-chrome.ts');
		assert.match(body, /paintQuickList\(content, 'book', 'Literature'/);
		assert.match(body, /paintQuickList\(content, 'film', 'Media'/);
	});

	it('14 the dashboard title stays hidden so the callout can sit up', () => {
		assert.match(css, /\.markdown-preview-view\.rv-dashboard \.inline-title[\s\S]*display:\s*none/);
	});

	it('15 suggestion bullets share the Attempt Log edges', () => {
		assert.match(css, /callout\.rv-locator-return-suggestions > \.callout-content > :is\(ul, ol\) \{[^}]*width:\s*100%/);
		assert.match(css, /\.rv-dashboard \.callout\.rv-locator-attempt-log \{[^}]*width:\s*100%/);
	});

	it('16 age reads with a tilde unless it is exact', () => {
		assert.equal(ageCaption(35, false), '~35 y/o');
		assert.equal(ageCaption('42', true), '42 y/o');
		assert.equal(ageCaption('', false), '');
		assert.equal(replacePersonName('Joshua on Maple St', 'Josh'), 'Josh on Maple St');
		assert.equal(replacePersonName('Joshua', 'Josh'), 'Josh');
	});

	it('17 18 19 chips overlay and each list has its own search', () => {
		const chrome = source('src/note-chrome.ts');
		assert.match(chrome, /function armChipOverlay/);
		assert.match(chrome, /showTitlePopover\(el, full\)/);
		assert.match(chrome, /LONG_PRESS_MS/);
		assert.match(chrome, /cls: 'rv-qf-search'/);
		assert.match(chrome, /chip\.hidden = !hit/);
		assert.doesNotMatch(chrome, /tr\.hidden/);
		assert.match(chrome, /cls: 'rv-qf-chevron'/);
	});

	it('20 the time and with share one space', () => {
		assert.match(source('src/visit-controls.ts'), /function stampWhenGroup/);
		assert.match(css, /\.rv-stamp-when-group \{[^}]*gap:\s*0\.25em/);
		assert.match(css, /\.rv-stamp-with \{[^}]*margin-left:\s*0/);
		assert.match(css, /\.rv-stamp-with \{[^}]*font-size:\s*12\.9px/);
	});

	it('21 the weekday and time use the surrounding weight', () => {
		assert.match(css, /\.rv-stamp-when \{[^}]*font-size:\s*15px;\s*font-weight:\s*400/);
	});

	it('smoke 603f8a1 pills, spacing, and gender stretch match the measured edges', () => {
		const chrome = source('src/note-chrome.ts');
		const meta = source('src/person-meta.ts');
		// Title padding-right 6px + badge margin-inline-end 2px = the 8px the pills overshot the route ring.
		const titleRight = Number(/\.rv-dashboard \.callout\[data-callout="rv"\] > \.callout-title \{[^}]*padding-right:\s*(\d+)px/.exec(css)?.[1]);
		const badgeEnd = Number(/\.rv-qf-badges \{[^}]*margin-inline-end:\s*(\d+)px/.exec(css)?.[1]);
		assert.equal(titleRight + badgeEnd, 8);
		assert.match(css, /\.rv-qf-body \{[^}]*--rv-qf-route-inset:\s*8px/);
		assert.match(css, /\.rv-qf-body \{[^}]*padding-right:\s*var\(--rv-qf-route-inset\)/);
		assert.match(css, /\.rv-qf-body \{[^}]*grid-template-columns:\s*1\.25em max-content minmax\(0, 1fr\)/);
		assert.match(css, /\.rv-qf-body > \.rv-qf-row \{[^}]*grid-template-columns:\s*subgrid/);
		assert.match(css, /\.rv-qf-body \.rv-qf-value \{[^}]*justify-self:\s*stretch/);
		assert.match(css, /\.rv-qf-body \.rv-qf-value \{[^}]*width:\s*100%/);
		assert.match(css, /\.rv-qf-chips\.is-single > \.rv-qf-chip \{[^}]*width:\s*100%/);
		assert.match(css, /\.rv-qf-chips\.is-halves \{[^}]*gap:\s*6px/);
		assert.match(css, /\.rv-qf-chips\.is-halves > \.rv-qf-chip \{[^}]*flex:\s*1 1 0/);
		assert.match(css, /\.rv-qf-chips\.is-halves > \.rv-qf-chip \{[^}]*border-radius:\s*var\(--pill-r, 5px\)/);
		assert.match(css, /\.rv-qf-chips\.is-halves > \.rv-qf-chip \{[^}]*border-left-width:\s*1px/);
		assert.match(css, /\.rv-qf-body \.rv-qf-value > \.rv-qf-pill \{[^}]*display:\s*flex/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-card-name \.rv-locator-file-link \{[^}]*flex:\s*1 1 auto/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-card-name \.rv-locator-file-link \{[^}]*max-width:\s*max-content/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-card-name \.rv-title-age \{[^}]*font-size:\s*calc\(13px \* var\(--rv-font-scale, 1\)\)/);
		assert.match(css, /\.rv-locator-glancable \.rv-locator-card-name \.rv-title-age \{[^}]*flex:\s*0 0 auto/);
		assert.match(css, /\.rv-title-gender svg :is\(circle, path, line, polyline\) \{[^}]*stroke-width:\s*1\.5px/);
		assert.doesNotMatch(css, /\.rv-dashboard[^{]*\.rv-title-age \{[^}]*font-size:\s*calc\(13px/);
		const ago = css.match(/\.rv-qf-pill \.rv-stamp-ago \{[^}]*\}/)?.[0] ?? '';
		assert.match(ago, /border:\s*0/);
		assert.match(ago, /box-shadow:\s*none/);
		assert.match(ago, /14%/);
		assert.doesNotMatch(ago, /inset/);
		assert.match(css, /\.rv-qf-row:not\(:has\(~ \.rv-qf-row\)\) \{\s*border-bottom:\s*0/);
		assert.match(css, /h5\.rv-visit-stamp \+ \.rv-item-strip \{\s*margin-top:\s*8px !important/);
		assert.match(css, /\.markdown-preview-section:has\(\.rv-visit-notes-host\) ~ \.markdown-preview-section:has\(> h5\.rv-visit-stamp\)[^}]*margin-top:\s*24px !important/);
		assert.match(css, /\.cm-s-obsidian \.cm-line\.rv-lp-notes ~ \.cm-line\.rv-lp-visit-heading \{[^}]*padding-top:\s*24px !important/);
		assert.match(css, /\.modal\.rv-edit-attributes\.rv-locator-modal \.setting-item\.rv-gender-choice \{[^}]*flex-direction:\s*column !important/);
		assert.match(css, /\.modal\.rv-edit-attributes\.rv-locator-modal \.setting-item\.rv-gender-choice \.setting-item-control button \{[^}]*flex:\s*1 1 0 !important/);
		assert.match(css, /\.modal\.rv-edit-attributes \.rv-age-choice button\.is-selected[\s\S]*?background-color:\s*transparent !important/);
		assert.match(css, /\.modal\.rv-edit-attributes \.rv-age-choice button\.is-selected[\s\S]*?box-shadow:\s*inset 0 0 0 1px var\(--rv-menu-ink, var\(--rv-modal-accent\)\) !important/);
		assert.match(css, /\.modal\.rv-edit-attributes \.rv-gender-choice \.setting-item-control button svg \{[^}]*width:\s*16px !important[^}]*height:\s*16px !important/);
		assert.match(meta, /<circle cx="12" cy="5" r="3"\/><path d="M8 10\.5h8"\/><path d="M12 8\.5v6\.5"\/><path d="m12 15-3\.5 7"\/><path d="m12 15 3\.5 7"\/>/);
		assert.match(meta, /<circle cx="12" cy="5" r="3"\/><path d="M9\.5 8\.5h5"\/><path d="M9\.5 8\.5 5\.5 17h13L14\.5 8\.5"\/><path d="M10 17v5"\/><path d="M14 17v5"\/>/);
		assert.match(meta, /viewBox="0 0 24 24"/);
		assert.match(chrome, /function showChipOverlay/);
		assert.doesNotMatch(chrome, /valueEl\.addEventListener\('mouseenter'/);
		assert.doesNotMatch(chrome, /createEl\('button'[\s\S]{0,80}rv-qf-chevron/);
	});

	it('22 the priority badge still opens the slider after the priority row is gone', () => {
		const chrome = source('src/note-chrome.ts');
		const title = chrome.slice(chrome.indexOf('function paintFactsTitle'), chrome.indexOf('function paintFactsBody'));
		assert.match(title, /host\.openPriority\(path, name\)/);
		const body = chrome.slice(chrome.indexOf('function paintFactsBody'), chrome.indexOf('function visitsPercent'));
		assert.doesNotMatch(body, /openPriority|rv-qf-priority/);
	});
});
