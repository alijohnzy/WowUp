// Headless boot check for the Tauri build — the counterpart to verify-boot.mjs.
//
// A Tauri boot failure is quiet in a way the Electron one is not. WebKitGTK does not
// forward the webview console to the host process, so a renderer that throws on startup
// produces an empty stdout and a window that never paints. The two defects found porting
// this app both presented that way: relative asset paths that stopped the entry module
// loading, and hash routing that turned the startup redirect into a full-page navigation.
// Both looked identical from outside — a process that stays alive and does nothing.
//
// So this asserts on the log file the app itself writes (tauri-plugin-log's LogDir target,
// plus the renderer console forwarded by src/lib/log-tauri.ts), not on stdout:
//
//   - exactly one page load          (more than one means something is reloading)
//   - no module import failures      (the asset-path defect)
//   - no unexpected renderer errors  (unmigrated IPC channels are expected for now)
//
// Usage: node scripts/verify-tauri-boot.mjs [--appimage] [--release]

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);

const IDENTIFIER = 'io.wowupcf.tauri';
const BOOT_SECONDS = 25;

function binary() {
	if (args.includes('--appimage')) {
		const dir = path.join(root, 'src-tauri/target/release/bundle/appimage');
		const file = existsSync(dir) && readdirSync(dir).find((f) => f.endsWith('.AppImage'));
		if (!file) throw new Error(`no AppImage in ${dir} — run: npm run tauri:build`);
		return path.join(dir, file);
	}
	const profile = args.includes('--release') ? 'release' : 'debug';
	const bin = path.join(root, `src-tauri/target/${profile}/wowup`);
	if (!existsSync(bin)) throw new Error(`missing ${bin} — run: cargo build --manifest-path src-tauri/Cargo.toml`);
	return bin;
}

/** tauri-plugin-log's LogDir target on Linux. */
function logDir() {
	const base = process.env.XDG_DATA_HOME || path.join(homedir(), '.local/share');
	return path.join(base, IDENTIFIER, 'logs');
}

const bin = binary();
const logs = logDir();
if (existsSync(logs)) rmSync(logs, { recursive: true, force: true });

// ELECTRON_RUN_AS_NODE is commonly exported in this repo's shells and would be inherited;
// it means nothing to Tauri, but stripping it keeps the child's environment honest.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(bin, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
child.stdout.on('data', (d) => (stdout += d));
child.stderr.on('data', (d) => (stdout += d));

await new Promise((resolve) => setTimeout(resolve, BOOT_SECONDS * 1000));

// SIGTERM first; the webview can take a moment to tear down.
try {
	child.kill('SIGTERM');
	await new Promise((resolve) => setTimeout(resolve, 1500));
	if (child.exitCode === null) child.kill('SIGKILL');
} catch {
	/* already gone */
}

const logFile = existsSync(logs) && readdirSync(logs).find((f) => f.endsWith('.log'));
if (!logFile) {
	console.error('FAIL: the app wrote no log at all — it did not reach setup().');
	console.error(stdout.slice(0, 2000));
	process.exit(1);
}

const log = readFileSync(path.join(logs, logFile), 'utf8');
const lines = log.split('\n');
const count = (re) => lines.filter((l) => re.test(l)).length;

const pageLoads = count(/page load Started/);
const moduleFailures = count(/Importing a module script failed/i);
const protocolWarnings = count(/IPC custom protocol failed/i);

// Channels with no Rust command yet are the expected state mid-migration; they are
// reported loudly on purpose (see src/lib/ipc-tauri.ts) and are not boot failures.
const unexpectedErrors = lines.filter(
	(l) => /\[webview\]\[ERROR\]/.test(l) && !/has no Tauri command/.test(l)
);

const report = [
	['binary', path.relative(root, bin)],
	['page loads', String(pageLoads)],
	['module failures', String(moduleFailures)],
	['ipc protocol warnings', String(protocolWarnings)],
	['unexpected errors', String(unexpectedErrors.length)]
];
for (const [k, v] of report) console.log(k.padEnd(24), v);

const problems = [];
if (pageLoads === 0) problems.push('the webview never loaded a page');
if (pageLoads > 1) problems.push(`the page loaded ${pageLoads} times — something is reloading`);
if (moduleFailures > 0) problems.push('an entry module failed to load (check asset paths)');
if (unexpectedErrors.length > 0) {
	problems.push(`${unexpectedErrors.length} unexpected renderer error(s)`);
	for (const line of unexpectedErrors.slice(0, 5)) console.error('  ', line.trim());
}

if (problems.length > 0) {
	console.error(`\nFAIL: ${problems.join('; ')}`);
	process.exit(1);
}

console.log('\nOK: renderer booted once and ran.');
