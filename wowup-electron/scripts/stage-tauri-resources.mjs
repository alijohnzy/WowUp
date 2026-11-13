// Copies bundle.resources from src-tauri/tauri.conf.json into a directory, laid out the way
// the installers lay them out beside the executable. Used for the Windows portable zip, where
// resource_dir() is the executable's own directory.
//
//   node scripts/stage-tauri-resources.mjs <dest>
//
// Read from the config, not from the copy the build stages in target/release: tauri-build
// finds target/release by going three levels up from its OUT_DIR, and Cargo 1.100 puts
// OUT_DIR one level deeper, so the resources land in target/release/build instead. The
// installers were unaffected (the bundler reads the sources), but run 48's portable zip
// would have shipped without them.
//
// Handles the two forms the config uses: a file mapped to a file, and `dir/*` mapped to a
// directory. Anything else fails, so a new form cannot silently ship an incomplete copy.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const crate = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");

function fail(message) {
  console.error(`stage-tauri-resources: ${message}`);
  process.exit(1);
}

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`${from} -> ${to}`);
}

const dest = process.argv[2];
if (!dest) fail("usage: stage-tauri-resources.mjs <dest>");

const resources = JSON.parse(readFileSync(join(crate, "tauri.conf.json"), "utf8")).bundle?.resources;
if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
  fail("expected bundle.resources to be a map of source to target");
}

let copied = 0;
for (const [source, target] of Object.entries(resources)) {
  if (source.endsWith("/*") && !/[*?[{]/.test(source.slice(0, -2))) {
    const dir = join(crate, source.slice(0, -2));
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) fail(`${join(dir, entry.name)} is not a file`);
      copy(join(dir, entry.name), join(dest, target, entry.name));
      copied++;
    }
  } else if (/[*?[{]/.test(source)) {
    fail(`unsupported pattern ${source}`);
  } else {
    const file = join(crate, source);
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) fail(`${file} is not a file`);
    copy(file, join(dest, target));
    copied++;
  }
}

if (copied === 0) fail("bundle.resources lists no files");
