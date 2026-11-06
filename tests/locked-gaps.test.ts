import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { householdLinkNames, mergeHouseholdHubs } from '../src/hub-row';
import { tapZoomsStack, zoomToRevealPin } from '../src/map-pins';
import { overlayOnChip } from '../src/title-fit';

describe('locked gaps past 678111b', () => {
	it('RV-196 a lone pin at zoom 12 zooms to 13', () => {
		assert.equal(tapZoomsStack(12, 1), true);
		assert.equal(tapZoomsStack(11, 1), true);
		assert.equal(tapZoomsStack(13, 1), false);
		assert.equal(zoomToRevealPin(11), 13);
		assert.equal(zoomToRevealPin(13), 13);
	});

	it('RV-199 household links are both ways and skip a lone address', () => {
		const plan = householdLinkNames([
			{ path: 'People/Curtis.md', name: 'Curtis', addressKey: 'beach plum' },
			{ path: 'People/Jo.md', name: 'Jo', addressKey: 'beach plum' },
			{ path: 'People/Solo.md', name: 'Solo', addressKey: 'oak' },
		]);
		assert.deepEqual(plan.get('People/Curtis.md'), ['Jo']);
		assert.deepEqual(plan.get('People/Jo.md'), ['Curtis']);
		assert.equal(plan.has('People/Solo.md'), false);
		assert.deepEqual(mergeHouseholdHubs(['[[Return Visits Hub]]'], ['Jo']), ['[[Return Visits Hub]]', '[[Jo]]']);
	});

	it('RV-158A keeps a chip that fits and pulls one that would leave the screen', () => {
		assert.deepEqual(overlayOnChip({ left: 40, width: 180 }, 390), { left: 40, width: 180 });
		const pulled = overlayOnChip({ left: 300, width: 180 }, 390);
		assert.equal(pulled.left + pulled.width <= 382, true);
		assert.equal(pulled.left >= 8, true);
	});

	it('RV-188 a hub link lands on the visible card, not the swap cover', () => {
		const main = readFileSync('src/main.ts', 'utf8');
		const view = readFileSync('src/glancable-view.ts', 'utf8');
		assert.match(main, /peekHubArrival\(\)/);
		assert.match(main, /notifyHubArrival\(\)/);
		assert.match(view, /closest\('\.rv-hub-swap-cover'\)/);
		assert.match(view, /if \(!cover\) this\.plugin\.takeHubArrival\(\)/);
	});

	it('RV-187 RV-188 RV-197 RV-B17 RV-B25 are wired', () => {
		const main = readFileSync('src/main.ts', 'utf8');
		const css = readFileSync('styles.css', 'utf8');
		assert.match(main, /mountNewRvCover/);
		assert.match(main, /waitForDashboard/);
		assert.match(main, /id: 'link-households'/);
		assert.match(main, /openSplitNote\(path: string\)/);
		assert.match(main, /this\.hubArrivalPath = sourcePath/);
		assert.match(main, /void this\.linkHousehold\(null, file\)/);
		assert.match(css, /mask-image: none !important/);
		assert.match(css, /\.rv-new-rv-cover/);
		assert.match(css, /\.rv-card-land::after/);
		assert.match(css, /\.modal\.rv-locator-modal \.modal-header \{\s*border-bottom: 1px solid/);
		assert.match(css, /padding-bottom: 16px !important/);
		assert.match(css, /button:not\(\.mod-cta\):not\(\.rv-suggest-chevron\)/);
		assert.match(css, /\.setting-item-control > button\.rv-suggest-chevron \{\s*border:\s*1px solid #2e9e5b !important;\s*box-shadow:\s*none !important;/);
		assert.match(css, /\.modal\.rv-locator-modal \.modal-content \{\s*display:\s*flex;\s*flex-direction:\s*column;/);
		assert.match(css, /\.modal\.rv-locator-modal \.setting-item\.rv-modal-actions,\s*\.modal\.rv-locator-modal \.modal-content > \.rv-modal-actions,\s*\.rv-study-change-modal > \.rv-modal-actions \{\s*margin-top:\s*auto;/);
	});
});
