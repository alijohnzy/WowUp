// Prints a build's "What's new" release-notes section from the in-app changelog, or nothing
// when the build has no entry. Run by the release job in .github/workflows/tauri-build.yml:
//
//   node scripts/release-notes.mts --build 44 --next
//
// --next: the build is the one being released now, so a "#next" entry is its own.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { whatsNew, type ChangelogEntry } from "./lib/release-notes.mts";

const { values } = parseArgs({
  options: {
    build: { type: "string" },
    next: { type: "boolean", default: false },
  },
});

const build = Number(values.build);
if (!Number.isInteger(build) || build <= 0) {
  console.error("--build must be a build number");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const log = JSON.parse(
  readFileSync(path.join(here, "../renderer-svelte/src/lib/data/changelogs.json"), "utf8"),
) as ChangelogEntry[];

process.stdout.write(whatsNew(log, build, values.next));
