import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('tests-dist', { recursive: true });

await esbuild.build({
	entryPoints: ['tests/logic.test.ts', 'tests/disk-proof.test.ts'],
	bundle: true,
	format: 'cjs',
	platform: 'node',
	outdir: 'tests-dist',
	entryNames: '[name]',
	outExtension: { '.js': '.cjs' },
	external: ['node:test', 'node:assert/strict', 'node:fs', 'node:path'],
	logLevel: 'warning',
});

const result = spawnSync(process.execPath, ['--test', 'tests-dist/logic.test.cjs', 'tests-dist/disk-proof.test.cjs'], {
	stdio: 'inherit',
});

process.exit(result.status ?? 1);
