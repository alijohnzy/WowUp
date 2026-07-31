# Electron → Tauri: scope, decisions, and phased plan

Baseline: branch `migrate/svelte5` @ `a33a2295`. Every claim below was verified against
the tree; file:line references are load-bearing, not illustrative.

---

## 0. Corrections to the starting brief

Six things differ from the brief. Three make the job easier, three harder.

| # | Brief said | Actually | Impact |
|---|---|---|---|
| 1 | `ipc.ts` is the only renderer file touching Electron | True for `import … from 'electron'`, but the bridge surface is wider — see §1.1 | ⚠️ harder |
| 2 | 68 handler registrations in `ipc-events.ts` | 61 via a local `handle()` helper + 3 `ipcMain.handle` + 3 `ipcMain.on` = **67**; 55 distinct channels | neutral |
| 3 | providers are CurseForge/Wago/GitHub/TukUI/WowInterface | TukUI and WowInterface are **gone**. Actual: curse, wago, github, zip, raiderio, wowup-companion | ✅ easier |
| 4 | *(not mentioned)* | **A native C++ N-API addon** — `native/curse.cc`, 125 LOC, `binding.gyp` | ⚠️ harder (but see §3.1 — it's a *win*) |
| 5 | `auto-launch` needs a Rust answer | Only used by the **Angular** renderer (`src/app/services/wowup/wowup.service.ts:439`). Svelte never calls it | ✅ easier |
| 6 | *(not mentioned)* | `sendSync` — Tauri has **no sync IPC** — but the only consumer is dead code | ✅ easier |

### 1.1 The seam is `ipc.ts` **plus five injected globals**

The grep in the brief only catches `from 'electron'`. The preload (`app/preload.ts:88-104`)
also injects globals that the Svelte renderer reads directly:

| global | consumer | Tauri answer |
|---|---|---|
| `window.libs.handlebars` | `services/wowup-addon.ts:220` | bundle handlebars into the renderer (it's pure JS) |
| `window.platform` | 2 sites | `@tauri-apps/plugin-os` `platform()` |
| `window.userDataPath` | 1 site | `@tauri-apps/api/path` `appDataDir()` |
| `window.logPath` | 1 site | `appLogDir()` |
| `window.baseBgColor` | 1 site | init script or a `get_config` command |

Plus `openExternal` / `openPath` — **15 call sites** — which are on the bridge but not IPC
channels. They map cleanly to `@tauri-apps/plugin-opener`.

So the seam is ~6 files, not 1. Still small. The brief's core claim survives: **there is no
business logic in the renderer's Electron coupling.**

---

## 1. The 94 IPC channels, grouped

Verified counts: **94** constants in `src/common/constants.ts`. Of those — **75** are
request/response handlers, **17** are main→renderer events (one of which is never emitted),
and **2** are entirely unreferenced.

### Group A — Filesystem · 21 channels → `plugin-fs` + custom Rust
`CREATE_DIRECTORY` `DELETE_DIRECTORY` `LIST_DIRECTORIES` `STAT_FILES` `PATH_EXISTS`
`LIST_FILES` `READ_FILE` `READ_FILE_BUFFER` `WRITE_FILE` `COPY_FILE` `SHOW_DIRECTORY`
`GET_HOME_DIR` `GET_ASSET_FILE_PATH` `LIST_ENTRIES` `READDIR` `GET_LATEST_DIR_UPDATE_TIME`
`LIST_DIR_RECURSIVE` `GET_DIRECTORY_TREE` `SHOW_OPEN_DIALOG`

`@tauri-apps/plugin-fs` + `plugin-dialog` covers ~80%. The recursive/tree/mtime ones are
custom Rust over `std::fs` + `walkdir` — trivial, and *faster* than the current
`fs/promises` + `rxjs mergeMap` implementation in `app/file.utils.ts`.

**Dead — delete, don't port:** `COPY_DIRECTORY_CHANNEL`, `STAT_DIRECTORY_CHANNEL` — zero
references anywhere, including as literal strings.

A third, `IPC_REQUEST_INSTALL_FROM_URL`, is dead in a more interesting way: nothing in
`app/` ever emits it, but `src/app/app.component.ts:237` (**Angular**) subscribes to it.
A listener for an event that is never sent. Since Tauri keeps only the Svelte renderer, it
drops out — but note the distinction, because it means the count of genuinely-unreferenced
channels is 2, not 3.

### Group B — Zip + download · 2 channels → **custom Rust**
`UNZIP_FILE_CHANNEL` (`ipc-events.ts:411`, yauzl) · `DOWNLOAD_FILE_CHANNEL` (`:649`)

`zip` crate + `reqwest` with a progress stream. The download handler already emits
progress events to the renderer, so the shape carries over 1:1. **Drops `yauzl` and
`adm-zip`.**

### Group C — Addon folder scanners · 2 channels → **custom Rust (hard, see §3.1)**
`CURSE_GET_SCAN_RESULTS` · `WOWUP_GET_SCAN_RESULTS`
`app/curse-folder-scanner.ts` (262) + `app/wowup-folder-scanner.ts` (219). **This is the
native addon consumer.**

### Group D — Store · 5 channels → `plugin-store`
`STORE_GET_OBJECT` `STORE_GET_OBJECT_SYNC` `STORE_GET_ALL` `STORE_SET_OBJECT` `STORE_REMOVE_OBJECT`

`electron-store` → `@tauri-apps/plugin-store`. Same JSON-file-in-appdata model.

> **`STORE_GET_OBJECT_SYNC` needs no answer.** `storage.ts:49` defines `getSync`, and it has
> **zero callers**. This is a sixth instance of the exact defect class documented in
> `full-migration-results.md` §14 — a writer with no reader. Delete the method, the channel,
> and `app/stores.ts:54`. Tauri's lack of sync IPC then costs nothing.

### Group E — Addon database · 8 channels → **custom Rust**
All `IPC_ADDONS_*`, handled by `app/controllers/addon.controller.ts` (128 LOC).
Currently `electron-store`-backed. Candidate for `plugin-sql` (SQLite) instead — the
controller does `getAllForInstallation` / `getByExternalIds` / `getAvailableForUpdate`,
which are queries pretending to be array filters.

### Group F — Warcraft detection · 6 channels → **custom Rust, platform-split**
All `IPC_WARCRAFT_*`. `app/services/warcraft/warcraft-platform.{win,mac,linux}.ts`
(163/107/174 LOC) behind `warcraft-platform.service.ts`. **This is the vertical slice — §4.**

### Group G — Window control · 16 channels → `plugin-window-state` + core API
Maximize/minimize/close/focus/fullscreen/zoom + the `WINDOW_*` event echoes.
Core `Window` API covers all of it; `app/window-state.ts` (131 LOC) is replaced wholesale
by `@tauri-apps/plugin-window-state`.

Zoom (`GET/SET_ZOOM_FACTOR`, `SET_ZOOM_LIMITS`, the 3 `MENU_ZOOM_*` events) has **no direct
Tauri equivalent** — implement as CSS `zoom` on the document root, persisted to the store.
Arguably better: it survives a webview swap.

### Group H — App lifecycle · 6 channels → core API + `plugin-process`
`RESTART_APP` `QUIT_APP` `GET_APP_VERSION` `GET_LOCALE` `GET_LAUNCH_ARGS` `UPDATE_APP_BADGE`
All covered (`plugin-process` `relaunch`/`exit`, `app.getVersion`, `plugin-os` `locale`,
`plugin-cli` for args). Badge is macOS/Linux-only in Tauri — matches current behaviour.

### Group I — OS integration · 7 channels → mixed
| channel | answer |
|---|---|
| `CREATE_TRAY_MENU` / `CREATE_APP_MENU` | core `TrayIcon` + `Menu` — full rewrite of `app/app-menu.ts` (192) + `system-tray.ts` (59) |
| `GET/SET_LOGIN_ITEM_SETTINGS` | `plugin-autostart` |
| `IS/SET/REMOVE_AS_DEFAULT_PROTOCOL_CLIENT` | `plugin-deep-link` |
| `CUSTOM_PROTOCOL_RECEIVED`, `GET_PENDING_OPEN_URLS` | `plugin-deep-link` events |
| `SYSTEM_PREFERENCES_GET_USER_DEFAULT` | macOS-only; custom `objc` command or drop |
| `LIST_DISKS_WIN32` | **drop** — `node-disk-info`, and the Svelte renderer never calls it (rend=0) |

### Group J — Power monitor · 4 events → **custom Rust**
`POWER_MONITOR_RESUME/SUSPEND/LOCK/UNLOCK`. No Tauri plugin. Needs per-platform native
work, and it is **not cosmetic** — `app/wago-handler.ts:14` reloads the Wago token webview
on resume, and the renderer refreshes addons. See §3.4.

### Group K — Auto-update · 3 channels → `plugin-updater` (with a caveat, §3.2)
### Group L — Push · 5 channels → **no answer** (§3.3)
### Group M — Overwolf · 2 channels → build-flavour specific, out of scope for v1

---

## 2. The addon-providers question: **webview, not Rust**

Keep all 2,868 lines in the renderer. The reason is stronger than "it's less work":

**The entire renderer HTTP surface is three call sites.**

```
renderer-svelte/src/lib/services/network.ts:37   ← the shared request(); curse, wago,
                                                   github, news, install-from-url all
                                                   route through CircuitBreakerWrapper
renderer-svelte/src/lib/addon-providers/github-addon-provider.ts:611
renderer-svelte/src/lib/addon-providers/zip-provider.ts:187   (a HEAD probe)
```

`network.ts` already abstracts HTTP behind `getJson`/`getText`/`postJson`/`deleteJson` +
an `opossum` circuit breaker. Swapping its `fetch` import to
`@tauri-apps/plugin-http`'s drop-in `fetch` is a **one-line change** that fixes ~95% of
the traffic. The plugin's fetch runs in Rust, so it bypasses CORS the same way
`webSecurity: false` does today.

This matters because **`app/main.ts:297` sets `webSecurity: false`.** Every provider call
currently relies on CORS not being enforced. Tauri has no such switch — the webview
enforces CORS against `tauri://localhost`.

> **Correction (measured after the fact).** This section originally called that "the single
> highest-risk item in the whole migration". **It is not.** Every host the providers
> actually use already answers with permissive CORS headers, checked against the live APIs
> with `Origin: tauri://localhost`:
>
> | host | `access-control-allow-origin` |
> |---|---|
> | `api.curseforge.com` | reflects the origin |
> | `addons.wago.io` | `*` |
> | `api.github.com` | `*` |
> | `raider.io` | reflects the origin |
>
> (`api.wago.io` sends none, but no provider calls it — Wago uses `addons.wago.io`.)
>
> Confirmed end-to-end: a live CurseForge request from the Tauri webview returned
> `200` **with the plugin-http routing disabled**. The providers would have worked
> untouched.
>
> The swap is still worth keeping, for one reason that is not CORS: `webSecurity: false` is
> strictly more permissive than any CORS policy, so leaving the requests in the webview
> makes the app depend on four third parties never tightening their headers — and if one
> does, the failure is an opaque network error with no status code, which the UI reports as
> a generic provider failure. Routing through Rust is the actual parity match for
> `webSecurity: false`.
>
> **This is also why the `http` capability allows `https://**` rather than a host
> allowlist.** An allowlist would be a *new* failure mode rather than parity: a provider
> that redirects to an unlisted CDN would fail where it currently succeeds. Narrowing it is
> a deliberate hardening step to take with measurement, not a side effect of the port.

Porting the providers to Rust would mean reimplementing CurseForge/Wago/GitHub response
mapping, dependency resolution, and channel/flavour matching — the most bug-prone logic in
the app, all of it currently covered by the Svelte test suite. No.

### 2.1 The exception: `curseforge-v2` uses axios

`curse-addon-provider.ts:127` does `new cfv2.CFV2Client({...})`, and `curseforge-v2` depends
on **axios**, which in a browser bundle uses `XMLHttpRequest`. **Tauri's fetch shim cannot
intercept XHR.** Ten live call sites (`:395 :428 :485 :510 :706 :715 :907 :924 :966 :1013`)
would fail CORS.

**Done, and simpler than expected — no custom adapter needed.** Axios 1.18 ships a `fetch`
adapter that takes a caller-supplied implementation: `getFetch(config)` reads
`config.env.fetch` when resolving, and `env` is absent from axios's merge map so it
deep-merges from defaults. `curseforge-v2` passes no `env`, so it inherits:

```ts
axios.defaults.adapter = 'fetch';
axios.defaults.env = { ...axios.defaults.env, fetch: httpFetch };
```

Two lines in `configureAxiosForTauri()` (`src/lib/http.ts`), called from bootstrap before
providers load. Verified against the live API from inside a Tauri window:
`status=200 mods=1 name=DBM - Deadly Boss Mods (DBM-Core)`.

Given the correction above, this is defence-in-depth rather than a fix for a live break —
but it costs two lines and removes the XHR path as a thing to reason about.

### 2.2 Secret handling improves
The CF API key is currently baked into the renderer bundle (hence
`scripts/verify-cf-key.mjs` and the bcrypt-`$`-expansion trap). If CF calls route through a
Rust command instead, the key lives in the Rust binary — still extractable, but no longer
sitting in a JS chunk. Worth doing opportunistically, not worth blocking on.

---

## 3. What has no Tauri answer

Stated plainly, as asked.

### 3.1 The native C++ addon — `native/curse.cc`
**Not mentioned anywhere in the brief or the plan docs.** `app/curse-folder-scanner.ts:14`
does `require(path.join(app.getAppPath(), "build/Release/addon.node"))` and calls
`nativeAddon.computeHash(buffer, length)` at `:238` and `:250`.

It's the CurseForge fingerprint — a whitespace-stripping murmur2 over addon files. Without
it, **CurseForge addon matching does not work at all.**

This is the one item that is *strictly better* under Tauri. Today it's a `node-gyp` build
requiring a C++ toolchain on all three CI runners and a rebuild per Electron ABI bump.
In Rust it's ~40 lines over the `murmur2` crate, cross-compiled by the same toolchain that
builds everything else. **Porting it removes `node-addon-api`, `binding.gyp`, and the
native build step from CI.**

Verification is exact: same input bytes must produce the same `u32`. Golden-file test
against the current addon before deleting it.

### 3.2 Auto-update signing — a real decision, not a blocker
`plugin-updater` exists and works, but it is **not** `electron-updater`:
- Different manifest format; the existing update feed must be regenerated.
- Signing is Tauri's own minisign keypair, **not** the Authenticode/notarization identity
  `electron-builder` uses. Both are still needed for OS trust, but they're separate.
- **No delta updates.** `electron-updater` does differential downloads on Windows; Tauri
  ships full bundles. Users re-download the whole app each update.
- macOS `.app` bundle updates need the updater to handle the `.app` swap — supported, but
  the code-sign identity must be configured or updates silently fail Gatekeeper.

Not blocking, but it needs its own phase and a real signing-key migration plan. Existing
installs cannot auto-update *into* the Tauri build — v1 Tauri is a manual-install upgrade.
**Say this to users explicitly.**

### 3.3 Push notifications — no answer, recommend dropping
`pushy-electron` + `protobufjs`, 5 channels, `app/push.ts` (64 LOC). Pushy has no Rust SDK.
Options: (a) drop push, (b) poll the existing endpoint on a timer, (c) reimplement Pushy's
MQTT-over-protobuf in Rust.

(c) is disproportionate. **Recommend (b)** — the renderer already has hourly-timer
infrastructure the E2E harness knows how to fast-forward (`page.clock`), and the payloads
are addon-update notices that a poll covers fine. Confirm before building.

### 3.4 The `<webview>` ad panel — **the hardest item**
`AdWebView.svelte` creates an Electron `<webview>` with its own `preload`, `partition`,
`nodeintegration`, and `allowpopups`, and `app/wago-handler.ts` (120 LOC) drives a token
handshake through it — reloading it on power-resume and forwarding `wago-token-received`.

**Tauri has no `<webview>` tag.** The nearest equivalents:
- A child `WebviewWindow` — a separate OS window, wrong for an embedded nav-rail panel.
- Multi-webview (`Webview::new` on one window) — unstable, and positioning it inside a
  Svelte layout means manually syncing pixel coordinates on every resize/scroll.
- An `<iframe>` — loses the isolated session partition and the injected preload, which is
  precisely how the Wago token is captured.

There is no clean port. This needs a product decision before it needs an engineering one:
does the ad panel survive, and does Wago auth move to a system-browser OAuth flow
(`plugin-opener` + `plugin-deep-link` callback)? The deep-link plumbing is already in
Group I, so the OAuth route is cheaper than it sounds.

### 3.5 `win-ca` — needs measurement, probably free
`app/preload.ts:13` + `app/main.ts:82` load Windows enterprise root CAs into Node's trust
store, so corporate MITM proxies don't break addon HTTP. Tauri's `reqwest` can use
`rustls-native-certs` / `schannel`, which reads the same Windows store — likely a config
flag rather than code. **Verify on a machine behind a corporate proxy before claiming it.**

### 3.6 Smaller drops
`node-disk-info` — drop (Svelte renderer never calls it). `auto-launch` — drop
(Angular-only; `plugin-autostart` covers the Svelte path). `handlebars` — bundle into the
renderer. `electron-log` → `plugin-log`. `globrex`/`minimist`/`nanoid` → `globset` /
`clap` / `uuid`, or just keep them renderer-side.

### 3.7 What survives untouched
**`wowup-lib-core` is pure TypeScript** — deps are `lodash`, `markdown-it`,
`string-similarity`, `ts-custom-error`, `uuid`; zero node builtins. All 66 consuming files
are unaffected. Nothing to do here, which removes the largest theoretical risk.

---

## 3a. Plugin map (verified against crates.io, July 2026)

All 30 official plugins were reviewed; these are the ones this app can use. Versions are
the current stable releases, and `tauri` itself is **2.11.5**.

| need | plugin | ver | notes |
|---|---|---|---|
| filesystem | `tauri-plugin-fs` | 2.5.1 | covers ~80% of Group A |
| file dialogs | `tauri-plugin-dialog` | 2.7.2 | `SHOW_OPEN_DIALOG` |
| HTTP from the webview | `tauri-plugin-http` | 2.5.9 | **the CORS answer** — §2 |
| key/value store | `tauri-plugin-store` | 2.4.4 | replaces `electron-store` |
| SQLite | `tauri-plugin-sql` | 2.4.0 | candidate for the addon DB, §Group E |
| logging | `tauri-plugin-log` | 2.9.0 | replaces `electron-log` |
| open URLs/paths | `tauri-plugin-opener` | 2.5.4 | `shell.openExternal`/`openPath` |
| OS info | `tauri-plugin-os` | 2.3.2 | platform, locale, arch |
| relaunch/exit | `tauri-plugin-process` | 2.3.1 | `RESTART_APP`, `QUIT_APP` |
| launch args | `tauri-plugin-cli` | 2.4.1 | `GET_LAUNCH_ARGS` |
| start at login | `tauri-plugin-autostart` | 2.5.1 | replaces `auto-launch` |
| window geometry | `tauri-plugin-window-state` | 2.4.1 | replaces `app/window-state.ts` |
| protocol handler | `tauri-plugin-deep-link` | 2.4.9 | `wowup://`, and the Wago OAuth route in §3.4 |
| single instance | `tauri-plugin-single-instance` | 2.4.3 | `app/main.ts` already enforces this |
| notifications | `tauri-plugin-notification` | 2.3.3 | partial answer for §3.3 |

**Not covered by any plugin**, confirmed by review: zip/unzip (`zip` crate), file download
with progress (`reqwest`), the CurseForge fingerprint (§3.1), power-monitor events
(Group J — `tauri-plugin-screen-lock-status` is v1-only and unmaintained), tray/menu
(core API, but a full rewrite), and zoom (no equivalent; do it in CSS).

**Rejected:** `tauri-plugin-cors-fetch`, an unofficial plugin that hooks global `fetch`
transparently. Tempting for §2, but it explicitly does **not** support `XMLHttpRequest` —
so it would not fix the axios path in §2.1, the one place that actually needs help — and it
requires `withGlobalTauri`, which widens the JS API surface. Use official `plugin-http`
plus an axios adapter instead.

---

## 3b. What Phase 0 actually cost (findings from the build)

Phase 0 is done and committed (`d0f8392c`). Four things were not visible from reading:

1. **`webSecurity: false` is not the only file:// accommodation.** Hash routing
   (`router.type`), relative asset paths (`paths.relative`), and the bespoke
   `renderer-svelte/scripts/relative-paths.mjs` all exist for Electron's `file://` origin.
   Under `tauri://localhost` all three are wrong: `goto()` degraded to a full-page
   navigation, and because `+page.svelte` redirects to `/my-addons` on mount, the app
   reloaded roughly thirty times a second. **Nothing was logged** — no error, no failed
   request, just a window that never finished starting. All three are now conditional on
   `BUILD_SHELL=tauri`.

2. **Tauri's IPC is JSON; Electron's is structured clone.** `get-installed-products` is
   typed `Map<WowClientType, InstalledProduct>` and its only consumer calls `.get()`. Under
   Tauri the Map would have arrived as `{}` and every lookup returned undefined — the app
   would have reported no WoW installation rather than failing. Anything crossing IPC as a
   `Map`, `Set` or `Date` needs the same treatment; these are the only ones today.

3. **`isElectron()` is used as "is a desktop shell present" in 14 places** — menus, tray,
   zoom, auto-update, push, titlebar, language init. Under Tauri they all silently take the
   browser branch. `isDesktop()` now exists for them, but flipping a guard before its Rust
   command lands just moves the failure, so they migrate per phase. **This is the
   per-phase checklist**; grep `isElectron(` to see what remains.

4. **`wowup-lib-core` breaks the Vite dev server.** It is Parcel-built CommonJS whose
   re-exports go through a runtime `$parcel$exportWildcard` helper, which defeats Vite's
   static named-export detection — every named import is a missing binding in dev
   (`SyntaxError: Importing binding name 'getTocForGameType' is not found`). Production is
   unaffected because Rollup resolves it at build time, which is why it had gone unnoticed.
   Fixed with `optimizeDeps.include`. **This affected `npm run svelte:dev` too** — it is not
   a Tauri problem, it was just never hit because the dev server is rarely used.

### Two bugs with one symptom, which is why the first diagnosis was wrong

The boot loop was reported mid-session as an unresolved WebKitGTK 2.52 problem —
*"Importing a module script failed"* plus *"IPC custom protocol failed, Tauri will now use
the postMessage interface instead"*. **That was wrong.** There was no WebKitGTK bug. There
were two independent defects that both present as "the app reloads forever, nothing
logged":

1. **Relative asset paths.** `./_app/…` under `tauri://localhost` failed to resolve, so the
   entry module never loaded → *"Importing a module script failed"*.
2. **Hash routing on a custom scheme.** `goto('#/x')` degraded to a full-page navigation,
   and `+page.svelte` redirects on mount → reload, redirect, reload.

Fixing (1) left the loop in place, because (2) was still there — which is what made the
first fix look ineffective and sent the diagnosis toward the webview. Both are fixed and
both fixes are conditional on `BUILD_SHELL`, so Electron is untouched.

Current state of the embedded-asset (production) path on the same machine: **1 page load,
0 module failures, 0 IPC protocol warnings**, bootstrap runs to completion, and a live
CurseForge request returns 200. The custom protocol was never the problem.

The lesson worth keeping: two bugs sharing one symptom defeats the usual
change-one-thing-and-retest loop, because a correct fix looks like a failed one. Injecting a
probe on every page load (`on_page_load` → `webview.eval`) is what separated them — it cost
one rebuild and would have saved four.

`scripts/verify-tauri-boot.mjs` now encodes the check, because neither defect produces
anything on stdout — WebKitGTK does not forward the webview console to the host, so the
failure mode is a live process and an unpainted window. It asserts on the app's own log:
exactly one page load, no module failures, no unexpected renderer errors. Verified to fail
by rebuilding the renderer the Electron way and watching it report 135 page loads.

### 3c. Packaging — done

`npm run tauri:build` produces a working AppImage, and it boots:

```
$ npm run tauri:verify:boot -- --appimage
page loads 1 · module failures 0 · ipc protocol warnings 0 · unexpected errors 0
OK: renderer booted once and ran.
```

| | AppImage |
|---|---|
| Electron (`release-svelte/`) | 130.7 MB |
| Tauri | 103.8 MB |
| | **−26.9 MB (−20.6%)** |

Two things had to be settled, neither of them about this app:

- **`NO_STRIP=1` is required**, now baked into the `tauri:build` script. `linuxdeploy`
  bundles a `strip` too old to parse `.relr.dyn` (`SHT_RELR`, ELF section type 0x13), which
  every current distro emits for packed relative relocations. It fails on ~40 system
  libraries and aborts the entire bundle with only `failed to run linuxdeploy` — the real
  error appears solely under `--verbose`. Note this inflates the artifact: the 20.6% saving
  above is *with stripping off*, so the real margin is larger.
- **`bundle.category`** was `Utility`; `electron-builder-svelte.json` declares `Game`.
  Corrected.

**Running both shells side by side.** The AppImage filenames already differed
(`WowUp-CF-Tauri_…` vs `WowUp-CF-Svelte-…`), but the *window titles* did not: Electron
titles its window `WowUp CF` for the `ow` flavour (`app/main.ts:290`) and Tauri's was the
same string, so the two were indistinguishable in alt-tab and the taskbar. Tauri's is now
`WowUp CF (Tauri)`.

`npm run tauri:link` points `~/Applications/WowUp-CF-Tauri.AppImage` at the current build.
It exists because the bundler emits a versioned filename, so a hand-made symlink goes stale
on the next version bump; the script repoints it, and refuses to replace anything that is
not already a symlink.

Still to do for full packaging parity: the `wowup://` protocol association (comes with
`plugin-deep-link`, Group I), Windows and macOS bundles (untested — this was a Linux host),
and updater signing (§3.2).

---

## 4. Phased plan

Sequenced so each phase ends with a **runnable app**, and the riskiest unknown is answered
in Phase 1 rather than Phase 6.

### Phase 1 (part) — store, addons, window, app data ✅

Driven by the app being unusable: it booted to a spinner behind an error banner because
`store-get-object` had no command, so bootstrap threw and `ready` never flipped.

Migrated: the three key/value stores (Group D), the eight addon-database channels
(Group E), window controls and their state events (Group G), `get-app-version`,
`get-locale`, `get-asset-file-path`, `update-app-badge`, and the three
default-protocol-client channels via `plugin-deep-link`.

Three things this surfaced that the plan did not have:

1. **`electron-store` stringifies primitives.** `store.set` does `value.toString()` unless
   the value is an object or array, so `true` persists as `"true"` — and `getBool()`
   compares against exactly that. Storing a JSON boolean would make every boolean
   preference read as false. `coerce_for_storage` in store.rs reproduces it.
2. **A fresh identifier means a fresh app.** `io.wowupcf.tauri` has its own data directory,
   so a machine with a working Electron install still started with no WoW clients and no
   addons. `import.rs` copies the three store files once on first run — which real users
   switching builds need too, not just developers. It works because store.rs kept
   electron-store's on-disk format.
3. **`-webkit-app-region` is Electron-only.** The titlebar's drag region is defined with it,
   and Tauri wants `data-tauri-drag-region` instead. Since the window is `decorations:
   false`, that plus the unmigrated window channels meant the title bar could neither move
   the window nor close it.

**Known open:** two unhandled rejections per sync — `The resource id … is invalid` — from a
plugin-http response body. Ruled out: the fetch call itself, `network.ts`'s body read, the
axios adapter (disabling it changes nothing), and the invoke path (patching
`__TAURI_INTERNALS__.invoke` catches nothing). That leaves the Channel plugin-http streams
bodies over, which does not surface through the invoke promise. Non-fatal — the UI is
unaffected — but it means some addon's update check is failing silently, so it wants
finishing before Phase 2. `npm run tauri:verify:boot` fails on it, deliberately.

### Phase 0 — Prove the seam. `WarcraftController`. ✅ done (`d0f8392c`)

Delivered: `src-tauri/` crate, all six `IPC_WARCRAFT_*` channels as Rust commands with a
`#[cfg(target_os)]` split, a hand-rolled `product.db` protobuf decoder, `ipc.ts` selecting
its backend at runtime, and renderer console forwarding to the Rust log.

Verified end-to-end in a running Tauri window — every command round-tripped:
`ext=exe exe=WowClassic.exe clientType=6 isWow=true products=0 isMap=true`.
21 Rust tests, 137 renderer tests, 88 E2E, `svelte-check` 0 errors, lint clean, and the
Electron build still boots (`verify-boot.mjs`: 1 boot, 0 console errors).

**Also done:** renderer HTTP now goes through `$lib/http`'s `httpFetch` (§2), with
`http-callers.spec.ts` guarding against a bare `fetch()` creeping back in, and axios
pointed at the same transport for `curseforge-v2` (§2.1). Verified with a live CurseForge
call from a Tauri window against an `ow`-flavour build — and, in the course of verifying
it, the CORS premise turned out to be wrong; see the correction in §2.

<details><summary>original plan</summary>
Right call: 6 channels, already isolated behind
`renderer-svelte/src/lib/services/api/warcraft-api.service.ts`, and the win/mac/linux split
exercises `#[cfg(target_os)]` on day one.

Scope:
1. Tauri shell + SvelteKit adapter change; get the existing renderer to *boot* with every
   non-Warcraft channel stubbed to reject.
2. `ipc.ts` gains a Tauri backend behind the same 6 exports. Keep the Electron one — same
   runtime-switch pattern the Angular/Svelte split already uses.
3. Port `warcraft-platform.{win,mac,linux}.ts` → Rust `#[tauri::command]`s.
4. **Also do `network.ts:37` in this phase** — it's one line, and it de-risks §2, the
   highest-risk item, immediately. Confirm a real CurseForge call succeeds under CORS.

Exit criteria: app boots in Tauri, WoW install detection works on Linux, one live CF
request returns 200, and `warcraft-api.service` tests pass unmodified.

**Settle the routing question here too** — Tauri serves from a custom protocol, so hash
routing, `paths.relative`, and the `resolve()` workaround in `src/lib/routes.ts` may all be
removable. Measure it in Phase 0; it changes every route assertion downstream.

</details>

*(Outcome: the routing question was not optional — see §3b.1. Tauri now builds with
pathname routing and absolute asset paths; Electron keeps hash routing and relative ones.)*

### Phase 1 — Filesystem + store (Groups A, D)
The widest, dullest, least risky surface. Delete the 3 dead channels and `getSync` as you go.

### Phase 2 — Zip, download, fingerprint (Groups B, C + §3.1)
Port `curse.cc` to Rust first, golden-file it, then the scanners, then unzip/download.
Ends the `node-gyp` dependency.

### Phase 3 — Window, tray, menu, lifecycle (Groups G, H, I)
Largest rewrite-by-LOC (`app-menu.ts`, `system-tray.ts`, `window-state.ts` ≈ 380 lines) but
mechanical. CSS-zoom decision lands here.

### Phase 4 — Addon DB (Group E)
Decide `plugin-store` vs `plugin-sql` on measured cold-start with a realistic addon count.

### Phase 5 — The open questions
Auto-update signing (§3.2), push (§3.3), the ad panel + Wago auth (§3.4), power monitor
(Group J). Each needs a product answer first. **Do not let these block Phases 0–4.**

### Cross-cutting
- The E2E harness (`stubPreload`, `window.__emitIpc`, `window.__sentIpc`) should be
  refactored in Phase 0 to stub whichever backend `ipc.ts` selects, so all 88 E2E tests
  keep running against Tauri unchanged. This is the main guard against silent regressions.
- Apply the §14/§15 discipline throughout: **disable each fix and watch the test go red.**
  The `getSync` finding above is proof the codebase still has writer-without-reader dead
  code, and a migration is exactly where that hides.

---

## 5. Effort shape

| | |
|---|---|
| Rewrite in Rust | ~3,900 LOC of `app/` → est. 2,500–3,500 Rust |
| Renderer changes | ~6 files (`ipc.ts`, `network.ts`, 5 global consumers, `AdWebView`) |
| Untouched | all 20,903 LOC of Svelte UI, all of `wowup-lib-core`, 2,868 LOC of providers |
| Deleted outright | `binding.gyp`, `native/`, `node-disk-info`, `auto-launch`, `yauzl`, `adm-zip`, `electron-store`, 3 dead channels, `getSync` |
| No answer yet | push, ad panel/Wago auth, delta updates, power monitor |

The renderer really is nearly free. The cost is `app/`, and the schedule risk is entirely
in §3.4 (ad panel) and §3.2 (update signing) — neither of which is technical difficulty so
much as an unmade product decision.
