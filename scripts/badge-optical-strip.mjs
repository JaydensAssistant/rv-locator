import * as esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const html = '/tmp/badge-optical-strip.html';
const png = process.argv[2] || '/opt/cursor/artifacts/badge-optical-strip.png';

await esbuild.build({
	entryPoints: ['scripts/badge-optical-strip.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: '/tmp/badge-optical-strip.mjs',
	logLevel: 'silent',
});

const rendered = spawnSync(process.execPath, ['/tmp/badge-optical-strip.mjs', html], { stdio: 'inherit' });
if (rendered.status !== 0) process.exit(rendered.status ?? 1);

mkdirSync(dirname(png), { recursive: true });
const chrome = spawnSync('google-chrome', [
	'--headless=new',
	'--no-sandbox',
	'--disable-gpu',
	'--hide-scrollbars',
	'--force-device-scale-factor=2',
	'--window-size=1680,980',
	`--screenshot=${png}`,
	'--virtual-time-budget=2500',
	`file://${html}`,
], { timeout: 20000 });
if (chrome.error && chrome.error.code !== 'ETIMEDOUT') {
	console.error(chrome.error);
	process.exit(1);
}
process.exit(0);
