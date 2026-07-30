// Measures V8 parse+compile cost of a set of JS files, in a fresh process per sample.
//
// Angular ships one IIFE bundle (vm.Script); SvelteKit ships ESM chunks
// (vm.SourceTextModule). Those are different V8 entry points, so this reports each
// separately and does NOT print a ratio — see full-migration-results.md.
//
// Usage: node parse-bench.mjs <script|module> <file>...
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const [, , kind, ...files] = process.argv;
const sources = files.map((f) => readFileSync(f, 'utf8'));

const t0 = process.hrtime.bigint();
for (const [i, src] of sources.entries()) {
	if (kind === 'module') {
		new vm.SourceTextModule(src, { identifier: files[i] });
	} else {
		new vm.Script(src, { filename: files[i] });
	}
}
const t1 = process.hrtime.bigint();

console.log(Number(t1 - t0) / 1e6);
