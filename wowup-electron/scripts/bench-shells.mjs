// Compares the three shells on the things a user actually feels: how long until the app is
// doing something, and what it costs to sit there.
//
//   node scripts/bench-shells.mjs            # all three, 3 runs each
//   node scripts/bench-shells.mjs --runs 5 --only tauri
//
// All three are built in the **wago** flavour and run **unpackaged** from a production
// build, so the comparison is renderer-and-shell, not packaging. Startup of a packaged
// AppImage differs (asar, compression, AppImage mount), so these numbers are not release
// numbers — they are parity numbers.
//
// Timed against a log line the renderers already print, rather than anything added for the
// benchmark: "Language setup start", i.e. the renderer is alive and running app code. It is
// read from the app's log file, not stdout — Electron does not forward the renderer console
// to stdout, so a stdout-based reading silently never matches.
//
// Svelte + Electron reports no boot time, and that is a finding rather than a gap in this
// script: that combination forwards its renderer console nowhere. `forwardConsoleToTauri()`
// exists for Tauri and `window.log` (app/preload.ts) serves the Angular renderer, but the
// Svelte renderer under Electron writes to a console nothing is reading. Its startup cannot
// be compared until that is fixed — and its renderer logs are lost in normal use too.
//
// `syncAllClients` would be the more interesting mark, but the renderers log it at debug
// level and electron-log drops it, so it cannot be compared. Startup here means "renderer
// running", not "addons on screen".
//
// On-disk counts only what each build produces. It is NOT what ships: an Electron app also
// carries the ~312MB Electron runtime, which these numbers exclude, while the Tauri figure
// is the whole application. Compare packaged artifacts for a shipping comparison.
//
// Memory is PSS, not RSS. Summing RSS across a process tree counts every shared page once
// per process, which for a multi-process browser engine is wildly wrong — it read ~4GB for
// Electron before this was fixed.
//
// The two Electron shells share a userData directory when unpackaged (both resolve to
// ~/.config/WowUp), so they run one at a time, never concurrently.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { argv } from "node:process";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};

const RUNS = Number(arg("--runs", 3));
const ONLY = arg("--only", null);

// Long enough for the addon sync to finish and memory to level off; shorter and the RSS
// reading is whatever the sync happened to be holding.
const SETTLE_MS = 30_000;
const BOOT_TIMEOUT_MS = 60_000;

// Electron's own binary, not `npx electron`: the wrapper sits between us and the app, so the
// process tree walk starts from a node process whose children are not the app's.
const ELECTRON_BIN = path.join(ROOT, "node_modules/electron/dist/electron");

const ELECTRON_LOG = path.join(process.env.HOME, ".config/WowUp/logs/main.log");
const TAURI_LOG = path.join(process.env.HOME, ".local/share/io.wowupwago.tauri/logs/WowUp-Wago-Tauri.log");

const SHELLS = [
  {
    id: "angular",
    label: "Angular + Electron",
    cmd: ELECTRON_BIN,
    args: ["."],
    log: ELECTRON_LOG,
    // ng build output; the shell is app-build/.
    payload: ["app-build", "dist"],
  },
  {
    id: "svelte",
    label: "Svelte + Electron",
    cmd: ELECTRON_BIN,
    args: [".", "--renderer=svelte"],
    log: ELECTRON_LOG,
    payload: ["app-build", "renderer-svelte/build"],
  },
  {
    id: "tauri",
    label: "Svelte + Tauri",
    cmd: "/tmp/WowUp-Wago-Tauri",
    args: [],
    log: TAURI_LOG,
    // One binary with the renderer compiled in.
    payload: ["src-tauri/target/release/wowup"],
  },
];

function dirSize(rel) {
  const abs = path.join(ROOT, rel);
  let total = 0;
  const walk = (p) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const e of readdirSync(p)) walk(path.join(p, e));
    else total += st.size;
  };
  walk(abs);
  return total;
}

/** PSS of the process tree, in MB — shared pages divided among the processes sharing them. */
function treePss(rootPid) {
  const pids = new Set([rootPid]);
  let grew = true;
  // /proc walk rather than pgrep: the children are not named predictably.
  while (grew) {
    grew = false;
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pids.has(pid)) continue;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
        if (pids.has(ppid)) {
          pids.add(pid);
          grew = true;
        }
      } catch {
        /* exited between readdir and read */
      }
    }
  }

  let kb = 0;
  for (const pid of pids) {
    try {
      const m = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+) kB/m);
      if (m) kb += Number(m[1]);
    } catch {
      /* exited, or not ours to read */
    }
  }
  return { pssMb: kb / 1024, procs: pids.size };
}

const BOOT_MARK = "Language setup start";

async function runOnce(shell) {
  // Truncate first: the marker is found by polling the file, and a previous run's line would
  // otherwise register instantly and report a boot time of ~0.
  try {
    writeFileSync(shell.log, "");
  } catch {
    /* first run, directory may not exist yet */
  }

  const started = Date.now();
  const child = spawn(shell.cmd, shell.args, {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: ["ignore", "ignore", "ignore"],
  });

  let boot = null;
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (boot === null && Date.now() < deadline && child.exitCode === null) {
    try {
      if (readFileSync(shell.log, "utf8").includes(BOOT_MARK)) boot = Date.now() - started;
    } catch {
      /* not written yet */
    }
    if (boot === null) await new Promise((r) => setTimeout(r, 50));
  }

  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const mem = child.exitCode === null ? treePss(child.pid) : { pssMb: NaN, procs: 0 };
  const exited = child.exitCode !== null;

  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 3000));
  if (child.exitCode === null) child.kill("SIGKILL");
  // The window manager needs a moment before the next run starts competing for the display.
  await new Promise((r) => setTimeout(r, 2000));

  return { boot, ...mem, exited };
}

const median = (xs) => {
  const v = xs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

const fmt = (n, unit) => (Number.isFinite(n) ? `${Math.round(n)}${unit}` : "—");

const results = [];
for (const shell of SHELLS) {
  if (ONLY && shell.id !== ONLY) continue;

  const size = shell.payload.reduce((sum, p) => sum + dirSize(p), 0);
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    process.stdout.write(`${shell.id} run ${i + 1}/${RUNS}… `);
    const r = await runOnce(shell);
    console.log(
      `boot=${fmt(r.boot, "ms")} pss=${fmt(r.pssMb, "MB")} procs=${r.procs}` + (r.exited ? "  (exited early)" : ""),
    );
    runs.push(r);
  }

  results.push({
    label: shell.label,
    boot: median(runs.map((r) => r.boot)),
    pss: median(runs.map((r) => r.pssMb)),
    procs: median(runs.map((r) => r.procs)),
    sizeMb: size / 1024 / 1024,
  });
}

console.log(`\nmedian of ${RUNS} runs, wago flavour, unpackaged production builds\n`);
console.log("shell                 boot      idle PSS   procs   on-disk");
console.log("-".repeat(62));
for (const r of results) {
  console.log(
    r.label.padEnd(22) +
      fmt(r.boot, "ms").padEnd(10) +
      fmt(r.pss, "MB").padEnd(11) +
      String(r.procs).padEnd(8) +
      fmt(r.sizeMb, "MB"),
  );
}
