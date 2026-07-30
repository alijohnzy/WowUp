// Boots the app and asserts the renderer actually ran.
//
// Written because the obvious check is wrong in a way that always passes. Grepping the log for
// errors returns zero when the renderer never loaded at all — no renderer means no console
// output means no errors — so a page-load failure reads as a clean boot. That produced three
// false "0 console errors" reports in a row while `ERR_FAILED (-2)` sat in the main log.
//
// So this asserts positively: the renderer must have logged something, and the main process
// must not have reported a load failure.
//
// Usage:
//   node scripts/verify-boot.mjs [--renderer=svelte|angular] [--ow]
//
// --ow launches the Overwolf/CurseForge binary instead of Electron. Note that both the wago and
// ow npm scripts run app-env/inject-env.js, which rewrites app/env/environment.ts and
// package.json in place; this script does not, so it verifies whatever flavour is already built.

import { spawn } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const useOw = args.includes('--ow');
const renderer = args.find((a) => a.startsWith('--renderer='))?.split('=')[1] ?? 'svelte';

const BOOT_SECONDS = 20;
const binary = useOw ? 'ow-electron' : 'electron';

// The sandbox and GPU flags are for headless/CI environments; they do not change what loads.
// ELECTRON_RUN_AS_NODE makes the binary behave as plain Node, so `require('electron')` returns
// path strings and the app never opens a window. It has to be deleted rather than set to
// undefined — spreading an undefined value into `env` can reach the child as the string
// "undefined", which is truthy to Electron.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(
	'npx',
	[binary, '.', `--renderer=${renderer}`, '--no-sandbox', '--disable-gpu', '--enable-logging=stderr'],
	{ env, stdio: ['ignore', 'pipe', 'pipe'] }
);

let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

setTimeout(() => child.kill('SIGTERM'), BOOT_SECONDS * 1000);

child.on('close', () => {
	// Scoped to the renderer document on purpose. The ad <webview> reports its own
	// did-fail-provisional-load whenever the ad network is unreachable — offline, in CI, or
	// behind a blocklist — and that says nothing about whether the app itself booted.
	const loadFailed = /ERR_FAILED[^\n]*index\.html/.test(log);
	// electron-log echoes main-process lines through the renderer console, so those are excluded
	// — only genuine renderer output counts as evidence that the page ran.
	const rendererLines = (log.match(/INFO:CONSOLE/g) ?? []).length;
	const fromElectronLog = (log.match(/electron-log/g) ?? []).length;
	const appLines = rendererLines - fromElectronLog;

	// A reload loop reads as a healthy boot to every other check here: the renderer logs plenty,
	// index.html loads fine each time, and the only errors are whatever the half-finished
	// startup happened to hit. It showed up as `resolve()` returning an absolute filesystem path
	// under file://, so `goto()` navigated to a nonexistent file and the window reset. The
	// renderer's first log line is emitted once per load, so counting it catches this.
	const boots = (log.match(/Language setup start/g) ?? []).length;

	const flavour = log.match(/App flavor: (\w+)/)?.[1] ?? 'unknown';
	// Scoped to `file://` sources — i.e. the app's own bundle. The ad <webview> loads
	// third-party script from overwolf.com, and a throw in their GPP library says nothing about
	// this app. Without the scope the ow flavour fails intermittently on someone else's bug.
	const errorLines = (log.match(/INFO:CONSOLE[^\n]*/g) ?? []).filter(
		(line) => /Uncaught|TypeError|ReferenceError/.test(line) && /source: file:\/\//.test(line)
	);
	const errors = errorLines.length;

	console.log(`binary          ${binary}`);
	console.log(`renderer        ${renderer}`);
	console.log(`app flavour     ${flavour}`);
	console.log(`renderer output ${appLines} line(s)`);
	console.log(`load failure    ${loadFailed ? 'YES' : 'no'}`);
	console.log(`renderer boots  ${boots}`);
	console.log(`console errors  ${errors}`);
	if (errors > 0) {
		for (const line of errorLines) console.log(`  ${line.trim()}`);
	}

	const problems = [];
	if (loadFailed) problems.push('the renderer failed to load (ERR_FAILED)');
	if (appLines <= 0) problems.push('the renderer produced no output — it did not run');
	if (errors > 0) problems.push(`${errors} console error(s)`);
	if (boots > 1) problems.push(`renderer reloaded ${boots}x — navigation is looping`);
	if (boots === 0) problems.push('renderer never reached language setup');

	if (problems.length) {
		console.error('\nFAIL: ' + problems.join('; '));
		process.exit(1);
	}
	console.log('\nOK: renderer booted and ran.');
});
