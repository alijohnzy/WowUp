// Points ~/Applications/WowUp-CF-Tauri.AppImage at the AppImage just built.
//
// Convenience for running the Tauri build alongside the Electron one during the migration.
// The bundler emits a versioned filename (WowUp-CF-Tauri_2.23.0_amd64.AppImage), so a
// symlink made by hand goes stale the next time the version changes; this repoints it.
//
// Usage: npm run tauri:link  [--dir <target directory>]

import { existsSync, lstatSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const targetDir = dirFlag !== -1 ? args[dirFlag + 1] : path.join(homedir(), 'Applications');

const LINK_NAME = 'WowUp-CF-Tauri.AppImage';

const bundleDir = path.join(root, 'src-tauri/target/release/bundle/appimage');
const built = existsSync(bundleDir) && readdirSync(bundleDir).find((f) => f.endsWith('.AppImage'));
if (!built) {
	console.error(`No AppImage in ${bundleDir}\nBuild one first: npm run tauri:build`);
	process.exit(1);
}

if (!existsSync(targetDir)) {
	console.error(`${targetDir} does not exist. Pass --dir <path> to use another location.`);
	process.exit(1);
}

const source = path.join(bundleDir, built);
const link = path.join(targetDir, LINK_NAME);

// Replace only a symlink. A real file of that name is someone else's, and clobbering a
// 100 MB binary because a name happened to match is not a thing to do silently.
if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) {
	if (!lstatSync(link).isSymbolicLink()) {
		console.error(`${link} exists and is not a symlink — refusing to replace it.`);
		process.exit(1);
	}
	const current = readlinkSync(link);
	if (current === source) {
		console.log(`already current: ${link}\n             -> ${source}`);
		process.exit(0);
	}
	unlinkSync(link);
}

symlinkSync(source, link);
console.log(`linked: ${link}\n     -> ${source}`);
