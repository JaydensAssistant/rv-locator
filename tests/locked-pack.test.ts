import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { pickFieldSummary } from '../src/catalog-fields';
import { VisitEditModal } from '../src/visit-modals';
import { RvMapView } from '../src/map-view';
import { buildMapPins, fanRadius, layoutIdenticalPins, PEEK_PX, type LayoutPin } from '../src/map-pins';
import { SNOOZE_SLATE } from '../src/snooze';
import { DEFAULT_SETTINGS } from '../src/types';

function source(file: string): string {
	return readFileSync(file, 'utf8');
}

function pin(path: string, lat: number, lon: number, x: number, y: number, urgency: number): LayoutPin {
	return { path, lat, lon, x, y, urgency, priority: 1 };
}

describe('locked pack', () => {
	it('fans identical pins past the cluster zoom and peeks them when zoomed out', () => {
		const same = [
			pin('c.md', 28.5, -81.3, 100, 200, 1),
			pin('a.md', 28.5, -81.3, 100, 200, 3),
			pin('b.md', 28.5, -81.3, 100, 200, 2),
		];
		const near = pin('near.md', 28.5004, -81.3004, 108, 200, 4);
		const fanned = layoutIdenticalPins([...same, near], 13);
		assert.deepEqual(fanned.dots, [{ x: 100, y: 200 }]);
		assert.deepEqual(fanned.points.get('near.md'), { x: 108, y: 200 });
		const radius = fanRadius(3);
		const ordered = ['a.md', 'b.md', 'c.md'];
		ordered.forEach((path, index) => {
			const point = fanned.points.get(path);
			assert.ok(point);
			const angle = -Math.PI / 2 + (index * 2 * Math.PI) / 3;
			assert.ok(Math.abs(point.x - (100 + radius * Math.cos(angle))) < 0.001);
			assert.ok(Math.abs(point.y - (200 + radius * Math.sin(angle))) < 0.001);
		});
		const stacked = layoutIdenticalPins([...same, near], 12);
		assert.deepEqual(stacked.dots, []);
		assert.deepEqual(stacked.points.get('a.md'), { x: 100, y: 200 });
		assert.deepEqual(stacked.points.get('b.md'), { x: 100, y: 200 - PEEK_PX });
		assert.deepEqual(stacked.points.get('c.md'), { x: 100, y: 200 - PEEK_PX * 2 });
		assert.deepEqual(stacked.points.get('near.md'), { x: 108, y: 200 });
		assert.ok(PEEK_PX >= 3 && PEEK_PX <= 4);
	});

	it('keeps a snoozed pin on the fixed slate under another palette', () => {
		const pins = buildMapPins([{
			path: 'a.md',
			name: 'A',
			lat: 1,
			lon: 2,
			priority: 3,
			days: 90,
			inactive: false,
			snoozed: true,
			card: {
				address: '',
				city: '',
				study: false,
				spoke: '',
				attempted: '',
				studied: '',
				met: '',
				metWith: '',
				visits: '',
				studyRatio: '',
				literature: '',
				media: '',
				lessons: [],
			},
		}], DEFAULT_SETTINGS.idealityFloorDays, DEFAULT_SETTINGS.urgencyThresholdDays, ['#111111', '#222222', '#333333', '#444444'], 'urgency');
		assert.equal(pins[0]?.color, '#6b7a99');
		assert.equal(SNOOZE_SLATE, '#6b7a99');
	});

	it('puts one title and type in the field, and a count when there are more', () => {
		assert.equal(pickFieldSummary([], 'literature'), '');
		assert.equal(pickFieldSummary(['Will You Ever See Your Loved Ones Tiny Tract'], 'literature'), 'Will You Ever See Your Loved Ones Tiny Tract');
		assert.match(pickFieldSummary(['Why Study the Bible?'], 'media'), /Why Study the Bible\? Video$/);
		assert.equal(pickFieldSummary([
			'Will You Ever See Your Loved Ones Tiny Tract',
			'Is Anyone Listening to Our Prayers? Tiny Tract',
			'Contact Card for JW.org',
		], 'literature'), 'Will You Ever See Your Loved Ones +2');
	});

	it('opens the edit sheet with tabs and confirms delete in the same sheet', () => {
		let deleted = false;
		const modal = new VisitEditModal({} as never, {
			title: 'Edit visit',
			recentCompanions: [],
			deleteMessage: 'Delete Sat, 9am — Aug 1, 2026 · Home?',
			onSave: () => {},
			onDelete: () => { deleted = true; },
		});
		modal.open();
		const title = modal.titleEl as { children: Array<{ text: string; click: () => void }> };
		assert.deepEqual(title.children.map((child) => child.text), ['Edit visit', 'Delete visit']);
		const content = modal.contentEl as { text: string; children: Array<{ text: string; hidden?: boolean; click: () => void; children: never[] }> };
		const texts: string[] = [];
		const stack = [content];
		while (stack.length > 0) {
			const node = stack.pop();
			if (!node) continue;
			if (node.text) texts.push(node.text);
			stack.push(...node.children);
		}
		assert.equal(texts.includes('Delete Sat, 9am — Aug 1, 2026 · Home?'), true);
		assert.equal(texts.includes('Delete visit'), true);
		assert.equal(texts.includes('Save'), true);
		title.children[1]?.click();
		const buttons: Array<{ text: string; click: () => void }> = [];
		const walk = [content];
		while (walk.length > 0) {
			const node = walk.pop();
			if (!node) continue;
			if (node.text === 'Delete visit' && typeof node.click === 'function') buttons.push(node);
			walk.push(...node.children);
		}
		buttons[0]?.click();
		assert.equal(deleted, true);
		const main = source('src/main.ts');
		assert.equal(main.includes("textContent = 'Undo'"), false);
		assert.match(main, /void this\.openRoute\(path\)/);
		assert.match(main, /void this\.openVisitTarget\(file, target, 'edit'\)/);
		assert.doesNotMatch(main, /setTitle\('Delete visit'\)/);
	});

	it('RV-215 reloads an open note map pin without moving the camera', () => {
		const map = Object.create(RvMapView.prototype) as {
			contentEl: { classList: { contains(name: string): boolean } };
			host: { listMapPins(): { path: string; color: string }[] };
			pins: { path: string; color: string }[];
			centerLat: number;
			zoom: number;
			paint(): void;
		};
		map.contentEl = { classList: { contains: (name) => name === 'rv-note-map' } };
		map.host = { listMapPins: () => [{ path: 'People/Eve.md', color: SNOOZE_SLATE }] };
		map.pins = [{ path: 'People/Eve.md', color: '#1f8a4c' }];
		map.centerLat = 28.5;
		map.zoom = 15;
		let painted = '';
		map.paint = () => { painted = map.pins[0]?.color ?? ''; };
		(RvMapView.prototype as unknown as { reloadPins(): void }).reloadPins.call(map);
		assert.equal(painted, '#6b7a99');
		assert.equal(map.centerLat, 28.5);
		assert.equal(map.zoom, 15);
		const main = source('src/main.ts');
		const schedule = main.slice(main.indexOf('private scheduleOpenNoteRepaint'), main.indexOf('private async afterVisitWrite'));
		assert.match(schedule, /repaintOpenMapPins\(\)/);
		const view = source('src/map-view.ts');
		const reload = view.slice(view.indexOf('private reloadPins(): void'), view.indexOf('recenter(): void'));
		assert.match(reload, /this\.pins = this\.pinsInRenderedOrder\(\)/);
		assert.equal(reload.includes('centerOnOpen'), false);
		assert.match(view, /reloadPins: \(\) => \{ this\.reloadPins\(\); \}/);
	});

	it('uses a 3px divider, the hub green, and a plain close control', () => {
		const css = source('styles.css');
		assert.match(css, /grid-template-rows: auto minmax\(0, 1fr\) 3px var\(--rv-note-map/);
		assert.match(css, /\.rv-note-map-handle \{[^}]*background:\s*#000;/);
		assert.match(css, /width:\s*40px;\s*height:\s*5px;/);
		assert.match(css, /width:\s*44px;\s*height:\s*44px;/);
		assert.match(css, /\.rv-locator-glancable,\s*\.rv-locator-view,[\s\S]*?--interactive-accent:\s*var\(--rv-hub-accent, #1f8a4c\);/);
		assert.match(css, /caret-color:\s*var\(--rv-urgency-accent\)/);
		assert.match(css, /a\.rv-map-button:active svg,\s*\.rv-dashboard a\.rv-map-button\.is-on svg[\s\S]*?color:\s*var\(--rv-urgency-accent\)/);
		assert.match(css, /\.modal-close-button \{[^}]*background:\s*transparent !important;[^}]*box-shadow:\s*none !important;/);
		assert.match(css, /\.modal-close-button svg \{[^}]*width:\s*18px !important;/);
		assert.match(css, /\.modal-header-button,[\s\S]*?background:\s*transparent !important;[\s\S]*?border-radius:\s*0 !important;/);
		assert.match(css, /\.modal-header-button:focus,[\s\S]*?outline:\s*none !important;/);
		assert.match(css, /\.modal-header-button:focus-visible,[\s\S]*?outline:\s*none !important;/);
		assert.match(css, /\.setting-item\.rv-modal-actions\[hidden\],[\s\S]*?display:\s*none !important;/);
		assert.match(css, /--slider-fill-background:\s*var\(--rv-modal-accent, #1f8a4c\)/);
		assert.match(css, /caret-color:\s*var\(--rv-modal-accent, #1f8a4c\)/);
		assert.match(css, /select\[aria-label="AM or PM"\]:not\(\.is-measuring\) \{[^}]*min-width:\s*4\.5rem !important/);
		assert.match(css, /\.rv-visit-tab \{[^}]*flex:\s*1 1 0;/);
	});
});
