// Writes the updater's latest.json for a published Tauri release. Run by the release job in
// .github/workflows/tauri-build.yml after the installers are signed and renamed:
//
//   node scripts/tauri-updater-manifest.mts --dir dist --repo owner/repo --tag tauri-v2.25.4-18 \
//     --version 2.25.4+18 --out latest.json
//
// Each updatable file must have its `.sig` beside it (`tauri signer sign` writes them).
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { buildUpdaterManifest } from "./lib/tauri-updater-manifest.mts";

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    repo: { type: "string" },
    tag: { type: "string" },
    version: { type: "string" },
    notes: { type: "string" },
    out: { type: "string" },
    // Comma-separated platform keys that must be in the feed, e.g. windows-x86_64-nsis.
    require: { type: "string" },
  },
});

for (const required of ["dir", "repo", "tag", "version", "out"] as const) {
  if (!values[required]) {
    console.error(`--${required} is required`);
    process.exit(2);
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const UPDATABLE = /\.(AppImage|deb)$|-setup\.exe$|\.app\.tar\.gz$/;
const assets = walk(values.dir!)
  .filter((p) => UPDATABLE.test(p))
  .map((p) => {
    const sig = `${p}.sig`;
    if (!existsSync(sig)) throw new Error(`${p} has no ${path.basename(sig)}; was it signed?`);
    return { name: path.basename(p), signature: readFileSync(sig, "utf8") };
  });

const manifest = buildUpdaterManifest({
  assets,
  repo: values.repo!,
  tag: values.tag!,
  version: values.version!,
  notes: values.notes,
  pubDate: new Date().toISOString(),
  require: values.require
    ? values.require
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [],
});

writeFileSync(values.out!, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${values.out}: ${manifest.version}, ${Object.keys(manifest.platforms).join(", ")}`);
