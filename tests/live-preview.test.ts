import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { JSDOM } from 'jsdom';
import { describe, it } from 'node:test';
import { layoutVisitNotes } from '../src/visit-display';
import {
	planLivePreviewVisits,
	refreshVisitPreviewEffect,
	setOlderVisitsOpen,
	visitPreviewExtension,
} from '../src/visit-live-preview';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
const host = globalThis as typeof globalThis & Record<string, unknown>;
host.window = window;
host.document = window.document;
host.HTMLElement = window.HTMLElement;
host.Element = window.Element;
host.Node = window.Node;
host.Document = window.Document;
host.DocumentFragment = window.DocumentFragment;
host.Range = window.Range;
host.getComputedStyle = window.getComputedStyle.bind(window);
host.getSelection = window.getSelection.bind(window);
host.requestAnimationFrame = window.requestAnimationFrame.bind(window);
host.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
host.MutationObserver = window.MutationObserver;

const stamps = [
	'Mon, 9am — Sep 1, 2026',
	'Tue, 2pm — Sep 2, 2026',
	'Wed, 3pm — Sep 3, 2026',
	'Thu, 4pm — Sep 4, 2026',
	'Fri, 5pm — Sep 5, 2026',
];
const note = stamps.map((stamp) => `##### ${stamp}\nnotes`).join('\n');

describe('live preview older visits', () => {
	it('plans a widget and hidden lines without touching the text', () => {
		const plan = planLivePreviewVisits(note, { collapseOlder: true, limit: 3 });
		assert.equal(plan.widgetAt != null, true);
		const hidden = plan.hiddenLines.map((from) => note.slice(from, note.indexOf('\n', from)));
		assert.deepEqual(hidden.filter((line) => line.startsWith('#####')), [
			'##### Thu, 4pm — Sep 4, 2026',
			'##### Fri, 5pm — Sep 5, 2026',
		]);
		assert.equal(note.includes('Older Visits'), false);
	});

	it('keeps the document byte-identical when the live preview pass runs repeatedly', async () => {
		const parent = window.document.createElement('div');
		parent.className = 'markdown-source-view is-live-preview';
		window.document.body.appendChild(parent);
		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: note,
				extensions: visitPreviewExtension(() => ({ collapseOlder: true, limit: 3 })),
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const before = view.state.doc.toString();
		assert.equal(before.includes('Older Visits'), false);
		for (let pass = 0; pass < 6; pass += 1) {
			const refresh = view.state.update({ effects: refreshVisitPreviewEffect.of(null) });
			assert.equal(refresh.docChanged, false);
			assert.equal(refresh.changes.empty, true);
			view.dispatch(refresh);
			const toggle = view.state.update({ effects: setOlderVisitsOpen.of(pass % 2 === 0) });
			assert.equal(toggle.docChanged, false);
			assert.equal(toggle.changes.empty, true);
			view.dispatch(toggle);
		}
		assert.equal(view.state.doc.toString(), before);
		assert.equal(Buffer.from(view.state.doc.toString(), 'utf8').equals(Buffer.from(before, 'utf8')), true);
		assert.match(view.dom.textContent ?? '', /Older Visits/);
		assert.equal((view.dom.textContent ?? '').includes('##### Thu'), true);
		const hidden = view.dom.querySelectorAll('.rv-older-hidden');
		assert.ok(hidden.length >= 2);
		view.dispatch({ effects: setOlderVisitsOpen.of(true) });
		assert.equal(view.state.doc.toString(), before);
		assert.equal(view.dom.querySelector('.rv-older-hidden'), null);
		view.destroy();

		const preview = window.document.createElement('div');
		preview.className = 'markdown-source-view';
		const content = window.document.createElement('div');
		content.className = 'cm-content';
		content.textContent = note;
		preview.appendChild(content);
		const text = content.textContent;
		const children = content.childNodes.length;
		for (let pass = 0; pass < 4; pass += 1) {
			layoutVisitNotes(preview, note, { newestFirst: true, collapseOlder: true, limit: 3 });
		}
		assert.equal(content.textContent, text);
		assert.equal(content.childNodes.length, children);
		assert.equal(preview.querySelector('.rv-older-visits'), null);
	});
});
