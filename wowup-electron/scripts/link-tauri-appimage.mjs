// Points ~/Applications/WowUp-CF-Tauri.AppImage at the AppImage just built, and installs the
// desktop entry and icons that go with it.
//
// Convenience for running the Tauri build alongside the Electron one during the migration.
// The bundler emits a versioned filename (WowUp-CF-Tauri_2.23.0_amd64.AppImage), so a
// symlink made by hand goes stale the next time the version changes; this repoints it.
//
// The desktop entry is not cosmetic. On Wayland a window carries no icon of its own — there
// is no _NET_WM_ICON to set, that being an X11 property — so the compositor matches the
// window's app_id against installed .desktop files and draws whatever `Icon=` names. With
// nothing installed, alt-tab falls back to a generic low-resolution icon. Installing an
// entry whose StartupWMClass matches the app_id, plus icons under hicolor, is what makes the
// real icon appear. A .deb install does this for you; an AppImage integrates nothing.
//
// Usage: npm run tauri:link  [--dir <target directory>]

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const targetDir = dirFlag !== -1 ? args[dirFlag + 1] : path.join(homedir(), "Applications");

const LINK_NAME = "WowUp-CF-Tauri.AppImage";

const bundleDir = path.join(root, "src-tauri/target/release/bundle/appimage");
const built = existsSync(bundleDir) && readdirSync(bundleDir).find((f) => f.endsWith(".AppImage"));
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
let alreadyLinked = false;

// Replace only a symlink. A real file of that name is someone else's, and clobbering a
// 100 MB binary because a name happened to match is not a thing to do silently.
if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) {
  if (!lstatSync(link).isSymbolicLink()) {
    console.error(`${link} exists and is not a symlink — refusing to replace it.`);
    process.exit(1);
  }
  if (readlinkSync(link) === source) {
    // Not an early exit: the desktop entry below still has to be written, and skipping it
    // because the symlink happened to be current is how it silently never gets installed.
    alreadyLinked = true;
  } else {
    unlinkSync(link);
  }
}

if (alreadyLinked) {
  console.log(`already current: ${link}\n             -> ${source}`);
} else {
  symlinkSync(source, link);
  console.log(`linked: ${link}\n     -> ${source}`);
}

// ---- desktop integration ---------------------------------------------------------------

/** Must match StartupWMClass in the generated entry, which is the window's app_id. */
const APP_ID = "wowup";

const dataHome = process.env.XDG_DATA_HOME || path.join(homedir(), ".local/share");
const iconSource = path.join(root, "src-tauri/icons");

// The sizes the compositor picks from. `icon.png` is the 512 master; the rest are the
// bundler's own set, named by their real dimensions.
const ICONS = [
  ["icon.png", "512x512"],
  ["128x128@2x.png", "256x256"],
  ["128x128.png", "128x128"],
  ["64x64.png", "64x64"],
  ["32x32.png", "32x32"],
];

let installed = 0;
for (const [file, size] of ICONS) {
  const from = path.join(iconSource, file);
  if (!existsSync(from)) continue;
  const dir = path.join(dataHome, "icons/hicolor", size, "apps");
  mkdirSync(dir, { recursive: true });
  copyFileSync(from, path.join(dir, `${APP_ID}.png`));
  installed += 1;
}

const desktopDir = path.join(dataHome, "applications");
mkdirSync(desktopDir, { recursive: true });
const desktopFile = path.join(desktopDir, `${APP_ID}.desktop`);

// Exec points at the symlink rather than the versioned build, so the entry survives a
// rebuild the same way the link does.
writeFileSync(
  desktopFile,
  `[Desktop Entry]
Type=Application
Name=WowUp-CF (Tauri)
Comment=World of Warcraft addon updater
Categories=Game;
Terminal=false
Exec=${link} %U
Icon=${APP_ID}
StartupWMClass=${APP_ID}
`,
);

console.log(`installed: ${desktopFile}`);
console.log(`           ${installed} icon size(s) as ${APP_ID}.png under ${path.join(dataHome, "icons/hicolor")}`);
console.log("log out and back in if the icon does not change immediately");
