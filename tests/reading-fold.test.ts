import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { concealCollapsedVisitNotes, foldClassChangeIsOwn } from '../src/visit-display';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const host = globalThis as typeof globalThis & Record<string, unknown>;
host.HTMLElement = window.HTMLElement;
host.Element = window.Element;
host.Node = window.Node;
host.Document = window.Document;
host.MutationObserver = window.MutationObserver;
host.document = window.document;
host.getComputedStyle = window.getComputedStyle.bind(window);
host.requestAnimationFrame = window.requestAnimationFrame.bind(window);
host.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 80));
}

describe('reading view visit fold', () => {
	it('treats an empty class diff as our own write', () => {
		assert.equal(foldClassChangeIsOwn('el-p rv-visit-folded', 'el-p rv-visit-folded'), true);
		assert.equal(foldClassChangeIsOwn('el-p', 'el-p rv-visit-folded'), true);
		assert.equal(foldClassChangeIsOwn('el-p rv-older-hidden', 'el-p'), true);
		assert.equal(foldClassChangeIsOwn('el-h5', 'el-h5 is-collapsed'), false);
		assert.equal(foldClassChangeIsOwn(null, ''), true);
	});

	it('settles after the heading fold indicator collapses and a no-op pass writes nothing', async () => {
		const doc = window.document;
		const preview = doc.createElement('div');
		preview.className = 'markdown-preview-view';
		const sizer = doc.createElement('div');
		sizer.className = 'markdown-preview-section';
		preview.appendChild(sizer);
		const thuWrap = doc.createElement('div');
		thuWrap.className = 'el-h5';
		const indicator = doc.createElement('div');
		indicator.className = 'heading-collapse-indicator collapse-indicator';
		const thu = doc.createElement('h5');
		thu.className = 'rv-visit-stamp';
		thu.textContent = 'Thu, 4pm — Sep 4, 2026';
		thuWrap.append(indicator, thu);
		const thuNotes = doc.createElement('div');
		thuNotes.className = 'el-p';
		thuNotes.appendChild(doc.createElement('textarea'));
		const wedWrap = doc.createElement('div');
		wedWrap.className = 'el-h5';
		const wed = doc.createElement('h5');
		wed.className = 'rv-visit-stamp';
		wed.textContent = 'Wed, 3pm — Sep 3, 2026';
		wedWrap.appendChild(wed);
		const wedNotes = doc.createElement('div');
		wedNotes.className = 'el-p';
		wedNotes.appendChild(doc.createElement('textarea'));
		sizer.append(thuWrap, thuNotes, wedWrap, wedNotes);
		doc.body.appendChild(preview);

		concealCollapsedVisitNotes(preview);
		assert.equal(thuNotes.classList.contains('rv-visit-folded'), false);

		let calls = 0;
		const seen = new window.MutationObserver(() => {
			calls += 1;
			if (calls > 12) throw new Error(`fold observer livelock (${calls})`);
		});
		seen.observe(preview, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeOldValue: true,
			attributeFilter: ['class', 'style'],
		});
		const maintainer = new window.MutationObserver(() => {
			if (!indicator.classList.contains('is-collapsed')) return;
			if (thuNotes.style.display === 'none') return;
			thuNotes.style.display = 'none';
		});
		maintainer.observe(thuNotes, { attributes: true, attributeFilter: ['style'] });

		indicator.classList.add('is-collapsed');
		await flush();
		await flush();
		assert.equal(thuNotes.classList.contains('rv-visit-folded'), true);
		assert.equal(wedNotes.classList.contains('rv-visit-folded'), false);
		const settled = calls;
		assert.ok(settled < 8, `observer still running (${settled})`);
		await flush();
		assert.equal(calls, settled);

		seen.takeRecords();
		const before = calls;
		concealCollapsedVisitNotes(preview);
		await flush();
		assert.equal(seen.takeRecords().length, 0);
		assert.equal(calls, before);
		maintainer.disconnect();
		seen.disconnect();
	});

	it('hides the following section when is-collapsed is on the el-h5', async () => {
		const doc = window.document;
		const preview = doc.createElement('div');
		preview.className = 'markdown-reading-view';
		const host = doc.createElement('div');
		host.className = 'el-h5';
		const heading = doc.createElement('h5');
		heading.className = 'rv-visit-stamp';
		heading.textContent = 'Thu, 4pm — Sep 4, 2026';
		host.appendChild(heading);
		const notes = doc.createElement('div');
		notes.className = 'el-p';
		notes.appendChild(doc.createElement('textarea'));
		preview.append(host, notes);
		doc.body.appendChild(preview);
		host.classList.add('is-collapsed');
		concealCollapsedVisitNotes(preview);
		assert.equal(notes.classList.contains('rv-visit-folded'), true);
		const probe = new window.MutationObserver(() => {});
		probe.observe(preview, { subtree: true, attributes: true, attributeFilter: ['class'] });
		concealCollapsedVisitNotes(preview);
		await flush();
		assert.equal(probe.takeRecords().length, 0);
		probe.disconnect();
	});
});
