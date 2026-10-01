import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

mkdirSync('tests-dist', { recursive: true });

await esbuild.build({
	entryPoints: ['tests/logic.test.ts', 'tests/disk-proof.test.ts', 'tests/scoring.test.ts', 'tests/visit-editor.test.ts', 'tests/status.test.ts'],
	bundle: true,
	format: 'cjs',
	platform: 'node',
	outdir: 'tests-dist',
	entryNames: '[name]',
	outExtension: { '.js': '.cjs' },
	external: ['node:test', 'node:assert/strict', 'node:fs', 'node:path'],
	alias: {
		obsidian: path.join(process.cwd(), 'tests/obsidian-stub.ts'),
	},
	logLevel: 'warning',
});

const result = spawnSync(process.execPath, ['--test', 'tests-dist/logic.test.cjs', 'tests-dist/disk-proof.test.cjs', 'tests-dist/scoring.test.cjs', 'tests-dist/visit-editor.test.cjs', 'tests-dist/status.test.cjs'], {
	stdio: 'inherit',
});

process.exit(result.status ?? 1);
