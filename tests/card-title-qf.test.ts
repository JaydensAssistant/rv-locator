import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const man = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" class="svg-icon"><g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.5" r="2"/><path d="M12 6.5v6M9 21.5l3-9 3 9"/></g></svg>';
const woman = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100" class="svg-icon"><g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.5" r="2"/><path d="M12 6.5L9 21.5h6z"/></g></svg>';
const ring = '<svg class="rv-urgency-glyph" data-rv-glyph="ring" viewBox="0 0 28 28"><circle class="is-ring" cx="14" cy="14" r="12.22" fill="none" stroke="currentColor"></circle></svg>';

function page(css: string): string {
	const card = (id: string, name: string, age: string, figure: string) => `<article id="${id}" class="rv-locator-card has-actions is-compact-mode" style="--rv-urgency-accent:#d63c3c;--rv-control-size:22px;--rv-badge-count:3">
		<div class="rv-locator-card-name"><span class="rv-locator-status-icon"></span><a class="rv-locator-file-link" href="#">${name}</a><span class="rv-title-age">${age}</span><span class="rv-title-gender" aria-label="Man">${figure}</span></div>
		<div class="rv-locator-place"><span class="rv-locator-place-earth"></span><span class="rv-locator-card-street">1800 N Orange Ave</span><span class="rv-locator-city-lg">Orlando</span><span class="rv-locator-distance-lg is-live">· 2.0 mi</span></div>
		<span class="rv-locator-card-actions"><button type="button" class="rv-locator-urgency" data-band="0" data-rv-glyph="ring">${ring}</button><button type="button" class="rv-locator-priority-pill">4</button></span>
	</article>`;
	return `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --text-normal:#dadada; --text-muted:#999; --text-faint:#666; --text-accent:#7cb3ff; --background-primary:#1e1e1e; --background-secondary:#262626; --background-modifier-border:#3a3a3a; }
body { margin:0; background:#1e1e1e; color:var(--text-normal); font:16px/1.5 ui-sans-serif,system-ui,sans-serif; }
${css}
#lane { width:360px !important; } #slim { width:240px !important; } #dash { width:640px !important; }
#lane .rv-locator-card, #slim .rv-locator-card { width:100% !important; max-width:100% !important; }
</style></head><body>
<div id="lane" class="rv-locator-view rv-locator-glancable">${card('cman', 'Joshua', '~35 y/o', man)}${card('cwoman', 'Lisa', '42 y/o', woman)}</div>
<div id="slim" class="rv-locator-view rv-locator-glancable">${card('clong', 'Christopher Alexander Williamson', '~35 y/o', man)}</div>
<div id="dash" class="rv-dashboard"><div class="callout" data-callout="quote"><div class="callout-title"><div class="callout-title-inner"><span class="rv-dash-name">Joshua</span><span class="rv-title-age">~35 y/o</span><span class="rv-title-gender">${man}</span></div></div></div>
<div class="callout" data-callout="rv"><div class="callout-content"><div class="rv-qf-body">
<div class="rv-qf-row" data-label="spoke"><span class="rv-qf-icon"></span><span class="rv-qf-label">Last Spoke</span><span class="rv-qf-value"><span class="rv-qf-pill rv-qf-when"><span class="rv-cal"><span class="rv-cal-month">OCT</span><span class="rv-cal-day">14</span></span><span class="rv-qf-when-lead">Tue, 9:00am</span><span class="rv-stamp-ago">3d</span></span></span></div>
<div class="rv-qf-row" data-label="attempted"><span class="rv-qf-icon"></span><span class="rv-qf-label">Last Attempted</span><span class="rv-qf-value"><span class="rv-qf-pill rv-qf-when"><span class="rv-cal"></span><span class="rv-qf-when-lead">Mon, 6:00pm</span><span class="rv-stamp-ago">4d</span></span></span></div>
<div class="rv-qf-row" data-label="lit"><span class="rv-qf-icon"></span><span class="rv-qf-label">Literature</span><span class="rv-qf-value"><span class="rv-qf-chips is-single"><span class="rv-qf-chip"><span class="rv-qf-chip-title">Tract</span></span></span></span></div>
<div class="rv-qf-row" data-label="lessons"><span class="rv-qf-icon"></span><span class="rv-qf-label">Lessons</span><span class="rv-qf-value"><span class="rv-qf-chips is-halves"><span class="rv-qf-chip">Lesson 3 Pt 2</span><span class="rv-qf-chip">Lesson 3 Pt 1</span></span></span></div>
<div class="rv-qf-row" data-label="taken"><span class="rv-qf-icon"></span><span class="rv-qf-label">Taken</span><span class="rv-qf-value"><span class="rv-qf-chips is-halves"><span class="rv-qf-chip">Ada</span><span class="rv-qf-chip is-met">Mom</span></span></span></div>
</div></div></div></div>
<pre id="out"></pre>
<script>
const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, width: b.width, height: b.height }; };
const cs = (el) => getComputedStyle(el);
const row = (label) => document.querySelector('[data-label="'+label+'"]');
const data = {
  rows: [...document.querySelectorAll('.rv-qf-row')].map((el) => ({ label: el.dataset.label, height: el.getBoundingClientRect().height, border: parseFloat(cs(el).borderBottomWidth) })),
  gap: (() => { const kids = row('lessons').querySelector('.rv-qf-chips').children; return kids[1].getBoundingClientRect().left - kids[0].getBoundingClientRect().right; })(),
  half: cs(row('lessons').querySelector('.rv-qf-chip + .rv-qf-chip')),
  single: cs(row('lit').querySelector('.rv-qf-chip')),
  pill: cs(row('spoke').querySelector('.rv-qf-pill')),
  ago: cs(row('spoke').querySelector('.rv-stamp-ago')),
  street: cs(document.querySelector('#cman .rv-locator-card-street')),
  urgency: cs(document.querySelector('#cman .rv-locator-urgency')),
  glyph: cs(document.querySelector('#cman .rv-urgency-glyph circle')),
  rank: cs(document.querySelector('#cman .rv-locator-priority-pill')),
  man: { link: box(document.querySelector('#cman .rv-locator-file-link')), age: box(document.querySelector('#cman .rv-title-age')), gender: box(document.querySelector('#cman .rv-title-gender')), name: box(document.querySelector('#cman .rv-locator-card-name')), actions: box(document.querySelector('#cman .rv-locator-card-actions')) },
  ageStyle: cs(document.querySelector('#cman .rv-title-age')),
  genderStyle: cs(document.querySelector('#cman .rv-title-gender')),
  stroke: cs(document.querySelector('#cman .rv-title-gender circle')),
  womanStroke: cs(document.querySelector('#cwoman .rv-title-gender path')),
  long: (() => { const link = document.querySelector('#clong .rv-locator-file-link'); const age = document.querySelector('#clong .rv-title-age'); const gender = document.querySelector('#clong .rv-title-gender'); const name = document.querySelector('#clong .rv-locator-card-name'); return { link: box(link), linkScroll: link.scrollWidth, linkClient: link.clientWidth, age: box(age), ageScroll: age.scrollWidth, ageClient: age.clientWidth, gender: box(gender), name: box(name) }; })(),
  dashAge: cs(document.querySelector('#dash .rv-title-age')),
  dashGender: cs(document.querySelector('#dash .rv-title-gender')),
  dashStroke: cs(document.querySelector('#dash .rv-title-gender circle')),
};
for (const key of ['half','single','pill','ago','street','urgency','glyph','rank','ageStyle','genderStyle','stroke','womanStroke','dashAge','dashGender','dashStroke']) {
  const style = data[key];
  data[key] = { fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color, backgroundColor: style.backgroundColor, borderLeftWidth: style.borderLeftWidth, borderTopWidth: style.borderTopWidth, borderRadius: style.borderRadius, width: style.width, height: style.height, display: style.display, boxShadow: style.boxShadow, paddingTop: style.paddingTop, strokeWidth: style.strokeWidth, vectorEffect: style.vectorEffect, flex: style.flex };
}
document.getElementById('out').textContent = JSON.stringify(data);
</script></body></html>`;
}

async function measure(htmlPath: string): Promise<Record<string, unknown>> {
	const port = 9600 + Math.floor(Math.random() * 300);
	const chrome = spawn('google-chrome', [
		'--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
		`--remote-debugging-port=${port}`, `--user-data-dir=/tmp/chrome-rv-test-${port}`,
		'--no-first-run', 'about:blank',
	], { stdio: 'ignore' });
	const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
	try {
		let version: { webSocketDebuggerUrl: string } | null = null;
		for (let i = 0; i < 40 && !version; i++) {
			try {
				const res = await fetch(`http://127.0.0.1:${port}/json/version`);
				if (res.ok) version = await res.json() as { webSocketDebuggerUrl: string };
			} catch { /* chrome is still starting */ }
			if (!version) await delay(150);
		}
		assert.ok(version, 'Chrome did not open a debug port');
		const browser = new WebSocket(version.webSocketDebuggerUrl);
		await new Promise<void>((resolve, reject) => {
			browser.addEventListener('open', () => resolve());
			browser.addEventListener('error', () => reject(new Error('Chrome socket failed')));
		});
		let seq = 0;
		const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
		browser.addEventListener('message', (event) => {
			const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
			if (!msg.id || !pending.has(msg.id)) return;
			const waiter = pending.get(msg.id);
			pending.delete(msg.id);
			if (!waiter) return;
			if (msg.error) waiter.reject(new Error(msg.error.message));
			else waiter.resolve(msg.result);
		});
		const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
			const id = ++seq;
			const payload: { id: number; method: string; params: Record<string, unknown>; sessionId?: string } = { id, method, params };
			if (sessionId) payload.sessionId = sessionId;
			browser.send(JSON.stringify(payload));
			return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
		};
		const created = await send('Target.createTarget', { url: `file://${htmlPath}` }) as { targetId: string };
		const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true }) as { sessionId: string };
		await send('Runtime.enable', {}, attached.sessionId);
		await delay(600);
		const evaluated = await send('Runtime.evaluate', {
			expression: 'document.getElementById("out").textContent',
			returnByValue: true,
		}, attached.sessionId) as { result?: { value?: string }; exceptionDetails?: unknown };
		assert.equal(evaluated.exceptionDetails, undefined);
		browser.close();
		return JSON.parse(evaluated.result?.value ?? '{}') as Record<string, unknown>;
	} finally {
		chrome.kill();
	}
}

describe('glancable title and Quick Facts layout', () => {
	it('keeps equal Quick Facts rows, separate half chips, and a truncating card title', async () => {
		const htmlPath = '/tmp/rv-card-title-qf.html';
		writeFileSync(htmlPath, page(readFileSync('styles.css', 'utf8')));
		const data = await measure(htmlPath);
		const rows = data.rows as Array<{ label: string; height: number; border: number }>;
		const content = rows.map((row) => Number((row.height - row.border).toFixed(2)));
		assert.equal(new Set(content).size, 1, JSON.stringify(rows));
		assert.ok((data.gap as number) > 0);
		const half = data.half as { borderRadius: string; borderLeftWidth: string; height: string };
		assert.equal(half.borderRadius, '6px');
		assert.equal(half.borderLeftWidth, '1px');
		assert.equal(half.height, '24px');
		const single = data.single as { borderRadius: string; borderLeftWidth: string; height: string };
		assert.equal(single.borderRadius, '6px');
		assert.equal(single.borderLeftWidth, '1px');
		assert.equal(single.height, '24px');
		const pill = data.pill as { display: string; height: string };
		assert.equal(pill.display, 'flex');
		assert.equal(pill.height, '24px');
		const ago = data.ago as { boxShadow: string; borderTopWidth: string; fontSize: string };
		assert.equal(ago.boxShadow, 'none');
		assert.equal(ago.borderTopWidth, '0px');
		assert.equal(ago.fontSize, '11.52px');

		const man = data.man as { link: { right: number }; age: { left: number; right: number }; gender: { left: number; right: number; height: number }; name: { right: number }; actions: { left: number } };
		const ageGap = man.age.left - man.link.right;
		assert.ok(ageGap >= 4 && ageGap <= 8, `age gap ${ageGap}`);
		assert.ok(man.gender.left >= man.age.right - 0.5);
		assert.ok(man.name.right - man.gender.right > 40, 'age and gender sit with the name, not against the rail');
		assert.ok(man.actions.left > man.gender.right);
		const ageStyle = data.ageStyle as { fontSize: string; fontWeight: string; color: string; flex: string };
		assert.equal(ageStyle.fontSize, '13px');
		assert.equal(ageStyle.fontWeight, '400');
		assert.equal(ageStyle.color, 'rgb(153, 153, 153)');
		assert.equal(ageStyle.flex, '0 0 auto');
		const genderStyle = data.genderStyle as { width: string; height: string };
		assert.equal(genderStyle.width, '16px');
		assert.equal(genderStyle.height, '16px');
		assert.equal(man.gender.height, 16);
		const stroke = data.stroke as { strokeWidth: string; vectorEffect: string };
		const womanStroke = data.womanStroke as { strokeWidth: string; vectorEffect: string };
		assert.equal(stroke.strokeWidth, '2px');
		assert.equal(stroke.vectorEffect, 'non-scaling-stroke');
		assert.equal(womanStroke.vectorEffect, 'non-scaling-stroke');

		const long = data.long as { linkScroll: number; linkClient: number; ageScroll: number; ageClient: number; gender: { right: number }; name: { right: number } };
		assert.ok(long.linkScroll > long.linkClient + 8);
		assert.ok(long.ageScroll <= long.ageClient + 1);
		assert.ok(long.gender.right <= long.name.right + 0.6);

		const dashAge = data.dashAge as { fontSize: string };
		const dashGender = data.dashGender as { width: string; height: string };
		const dashStroke = data.dashStroke as { vectorEffect: string };
		assert.equal(dashAge.fontSize, '20.4px');
		assert.equal(dashGender.width, '18px');
		assert.equal(dashGender.height, '18px');
		assert.equal(dashStroke.vectorEffect, 'none');

		const street = data.street as { fontSize: string; color: string; fontWeight: string };
		assert.equal(street.fontSize, '9px');
		assert.equal(street.color, 'rgb(153, 153, 153)');
		assert.equal(street.fontWeight, '400');
		const urgency = data.urgency as { width: string; height: string; borderTopWidth: string };
		assert.equal(urgency.width, '22px');
		assert.equal(urgency.height, '22px');
		assert.equal(urgency.borderTopWidth, '2px');
		const glyph = data.glyph as { strokeWidth: string; vectorEffect: string };
		assert.equal(glyph.strokeWidth, '2px');
		assert.equal(glyph.vectorEffect, 'non-scaling-stroke');
		const rank = data.rank as { fontWeight: string; width: string; height: string };
		assert.equal(rank.fontWeight, '500');
		assert.equal(rank.width, '22px');
		assert.equal(rank.height, '22px');
	});
});
