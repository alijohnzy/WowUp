// Compares the shipped Angular AppImage against the Svelte one on this machine.
//
// Both builds share app/main.ts, so `App ready` and `Loading app URL` run identical code in
// both — they are the control. If those two diverge, the runs were not comparable and the
// renderer numbers below them mean nothing.
//
// The renderer milestones are log lines that exist verbatim in both ports:
//   Language setup start     first app code running in the renderer
//   Language setup complete  locale loaded
//   Create circuit breaker … addon providers constructed
// Angular's renderer logs through electron-log, Svelte's through plain console, so the two
// arrive in stderr in different formats; both are parsed back to ms-since-process-start using
// the `App ready: Nms` line, which carries both a wall clock and a delta.
//
// Runs alternate between the two apps so thermal drift and page-cache warming hit both equally,
// and the first run of each is discarded as a warm-up.
//
// Both apps are pointed at a throwaway --user-data-dir seeded identically from the real install
// (same 198 addons, same two WoW installations) and wiped between runs. That is not tidiness:
// the first attempt at this ran each app against its own real profile, where the installed
// Angular app has a 1.5 GB Chromium cache and the freshly-built Svelte one had 524 KB. `App
// ready` — identical main-process code in both — came out 797ms vs 174ms, which measured the
// cache, not the framework. Nothing here touches ~/.config/WowUpCf.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const RUNS = Number(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 5);
const HOLD_MS = 14_000; // long enough for providers to construct and memory to settle

// The real profile these are seeded from. Read only.
const SEED_DIR = join(homedir(), '.config', 'WowUpCf');
const SEED_FILES = ['addons.json', 'preferences.json', 'sensitive.json'];
const PROFILE_DIR = join(tmpdir(), 'wowup-bench-profile');

const APPS = [
	{
		key: 'angular',
		label: 'Angular',
		// Built from this tree on Electron 43, not the installed release. The shipped AppImage
		// is ow-electron 39.8.10 / Chromium 142 against this build's 43.1.1 / Chromium 150, and
		// comparing them measured the Electron bump: `App ready` — identical main-process code —
		// came out 787ms vs 177ms. This control differs from the Svelte build only in renderer.
		// --angular=<path> switches to the installed release. That comparison is what the user
		// actually feels day to day, but it is not a framework measurement: see above.
		path:
			process.argv.find((a) => a.startsWith('--angular='))?.split('=')[1] ??
			join(process.cwd(), 'release-angular', 'WowUp-CF-Angular-2.23.0.AppImage')
	},
	{
		key: 'svelte',
		label: 'Svelte',
		path: join(process.cwd(), 'release-svelte', 'WowUp-CF-Svelte-2.23.0.AppImage')
	}
];

const MILESTONES = [
	{ key: 'appReady', label: 'App ready (main)', self: /App ready: (\d+)ms/ },
	{ key: 'loadUrl', label: 'Loading app URL (main)', self: /Loading app URL: (\d+)ms/ },
	{ key: 'rendererFirstCode', label: 'Renderer first app code', match: 'Language setup start' },
	{ key: 'rendererLocale', label: 'Renderer locale loaded', match: 'Language setup complete' },
	{ key: 'providers', label: 'Addon providers constructed', match: 'Create circuit breaker wowup_addon_provider' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** electron-log console transport: `HH:MM:SS.mmm › msg`. Chromium: `[pid:MMDD/HHMMSS.uuuuuu:...]`. */
function wallClockMs(line) {
	const logger = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+›/);
	if (logger) {
		const [, h, m, s, ms] = logger;
		return ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;
	}
	// `[pid:MMDD/HHMMSS.uuuuuu:INFO:CONSOLE:…]` — the time follows the '/', not a ':'.
	const chromium = line.match(/\/(\d{2})(\d{2})(\d{2})\.(\d{6}):/);
	if (chromium) {
		const [, h, m, s, us] = chromium;
		return ((+h * 60 + +m) * 60 + +s) * 1000 + Math.round(+us / 1000);
	}
	return undefined;
}

/** Every pid on the system with its parent, for walking the app's process tree. */
function listPids() {
	const out = [];
	for (const name of readdirSync('/proc')) {
		if (!/^\d+$/.test(name)) continue;
		try {
			const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
			// comm can contain spaces and parens, so ppid is located from the LAST ')'.
			const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
			out.push({ pid: Number(name), ppid: Number(after[1]) });
		} catch {
			/* raced with exit */
		}
	}
	return out;
}

/**
 * Total PSS across the app's process tree, in MB.
 *
 * PSS, not RSS. An Electron app is a main process plus a GPU process, a network service and one
 * renderer per window, and they share a great deal of mapped memory — summing RSS counts every
 * shared page once per process and produced a nonsensical 1.5 GB for an idle app here. PSS
 * divides each shared page by the number of processes mapping it, so the tree total is the
 * app's actual footprint.
 */
function treePssMb(rootPid) {
	const all = listPids();
	const pids = new Set([rootPid]);
	// Repeat until no new children are found — the list is not in parent-before-child order.
	for (let grew = true; grew; ) {
		grew = false;
		for (const { pid, ppid } of all) {
			if (!pids.has(pid) && pids.has(ppid)) {
				pids.add(pid);
				grew = true;
			}
		}
	}

	let kb = 0;
	for (const pid of pids) {
		try {
			const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
			kb += Number(rollup.match(/^Pss:\s+(\d+) kB/m)?.[1] ?? 0);
		} catch {
			/* exited between listing and reading */
		}
	}
	return kb / 1024;
}

/** A fresh profile with the same addons and installations for whichever app is about to run. */
function resetProfile() {
	rmSync(PROFILE_DIR, { recursive: true, force: true });
	mkdirSync(PROFILE_DIR, { recursive: true });
	for (const f of SEED_FILES) {
		if (existsSync(join(SEED_DIR, f))) copyFileSync(join(SEED_DIR, f), join(PROFILE_DIR, f));
	}
}

async function runOnce(app) {
	resetProfile();

	// ELECTRON_RUN_AS_NODE is set in this shell and makes the binary behave as plain Node. It
	// has to be deleted, not set to undefined — spreading an undefined value can reach the child
	// as the string "undefined", which is truthy to Electron.
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;

	// Identical flags for both, so whatever they cost is charged to both equally.
	const child = spawn(
		app.path,
		[`--user-data-dir=${PROFILE_DIR}`, '--no-sandbox', '--disable-gpu', '--enable-logging=stderr'],
		{ env, stdio: ['ignore', 'pipe', 'pipe'] }
	);

	let log = '';
	child.stdout.on('data', (d) => (log += d));
	child.stderr.on('data', (d) => (log += d));

	await sleep(HOLD_MS);
	const pssMb = treePssMb(child.pid);

	child.kill('SIGTERM');
	await new Promise((r) => child.on('close', r));
	await sleep(1200); // let the single-instance lock clear

	const result = { pssMb };

	// `App ready: Nms` gives both a wall clock and a delta, so process start is derivable and
	// every other timestamped line can be expressed as ms-since-start.
	const readyLine = log.split('\n').find((l) => /App ready: \d+ms/.test(l));
	const readyDelta = Number(readyLine?.match(/App ready: (\d+)ms/)?.[1]);
	const readyWall = readyLine ? wallClockMs(readyLine) : undefined;
	const startWall = readyWall !== undefined ? readyWall - readyDelta : undefined;

	for (const m of MILESTONES) {
		if (m.self) {
			result[m.key] = Number(log.match(m.self)?.[1]);
			continue;
		}
		const line = log.split('\n').find((l) => l.includes(m.match));
		const wall = line ? wallClockMs(line) : undefined;
		result[m.key] = wall !== undefined && startWall !== undefined ? wall - startWall : undefined;
	}

	result.ok = Number.isFinite(result.appReady) && Number.isFinite(result.rendererFirstCode);
	return result;
}

const median = (xs) => {
	const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
	if (!v.length) return undefined;
	const mid = v.length >> 1;
	return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

for (const app of APPS) {
	if (!existsSync(app.path)) {
		console.error(`missing: ${app.path}`);
		process.exit(1);
	}
}

const samples = { angular: [], svelte: [] };

console.log(`${RUNS} runs each (first discarded), ${HOLD_MS / 1000}s hold, alternating.`);
console.log(`Both apps run against a wiped-and-reseeded ${PROFILE_DIR}.\n`);

for (let i = 0; i <= RUNS; i++) {
	for (const app of APPS) {
		const r = await runOnce(app);
		const tag = i === 0 ? 'warmup' : `run ${i}`;
		console.log(
			`${app.key.padEnd(8)} ${tag.padEnd(7)} ready=${String(r.appReady).padStart(5)}ms  ` +
				`renderer=${String(r.rendererFirstCode).padStart(5)}ms  pss=${r.pssMb.toFixed(0)}MB` +
				(r.ok ? '' : '  [INCOMPLETE]')
		);
		if (i > 0) samples[app.key].push(r);
	}
}

console.log('\n' + '='.repeat(78));
console.log('MEDIANS');
console.log('='.repeat(78));
const rows = [...MILESTONES.map((m) => ({ ...m, unit: 'ms' })), { key: 'pssMb', label: 'Memory (PSS, tree)', unit: 'MB' }];
console.log(`${'metric'.padEnd(30)} ${'Angular'.padStart(10)} ${'Svelte'.padStart(10)} ${'delta'.padStart(12)}`);
for (const row of rows) {
	const a = median(samples.angular.map((s) => s[row.key]));
	const s = median(samples.svelte.map((x) => x[row.key]));
	if (a === undefined || s === undefined) {
		console.log(`${row.label.padEnd(30)} ${String(a ?? '—').padStart(10)} ${String(s ?? '—').padStart(10)} ${'—'.padStart(12)}`);
		continue;
	}
	const pct = ((s - a) / a) * 100;
	console.log(
		`${row.label.padEnd(30)} ${(a.toFixed(0) + row.unit).padStart(10)} ${(s.toFixed(0) + row.unit).padStart(10)} ` +
			`${((pct >= 0 ? '+' : '') + pct.toFixed(1) + '%').padStart(12)}`
	);
}

rmSync(PROFILE_DIR, { recursive: true, force: true });
