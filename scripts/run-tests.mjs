import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

mkdirSync('tests-dist', { recursive: true });

await esbuild.build({
	entryPoints: ['tests/logic.test.ts', 'tests/disk-proof.test.ts', 'tests/scoring.test.ts', 'tests/visit-editor.test.ts', 'tests/status.test.ts', 'tests/release-135.test.ts', 'tests/catalog.test.ts', 'tests/regressions-135.test.ts', 'tests/reading-fold.test.ts', 'tests/live-preview.test.ts'],
	bundle: true,
	format: 'cjs',
	platform: 'node',
	outdir: 'tests-dist',
	entryNames: '[name]',
	outExtension: { '.js': '.cjs' },
	external: ['node:test', 'node:assert/strict', 'node:fs', 'node:path', 'jsdom'],
	alias: {
		obsidian: path.join(process.cwd(), 'tests/obsidian-stub.ts'),
	},
	logLevel: 'warning',
});

const result = spawnSync(process.execPath, ['--test', '--experimental-test-isolation=process', 'tests-dist/logic.test.cjs', 'tests-dist/disk-proof.test.cjs', 'tests-dist/scoring.test.cjs', 'tests-dist/visit-editor.test.cjs', 'tests-dist/status.test.cjs', 'tests-dist/release-135.test.cjs', 'tests-dist/catalog.test.cjs', 'tests-dist/regressions-135.test.cjs', 'tests-dist/reading-fold.test.cjs', 'tests-dist/live-preview.test.cjs'], {
	stdio: 'inherit',
});

process.exit(result.status ?? 1);
