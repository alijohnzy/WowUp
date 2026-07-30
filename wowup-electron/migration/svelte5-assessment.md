# Svelte 5 migration assessment — wowup-electron

Date: 2026-07-28 · Analyst run against `master` @ `58272e50`
Every figure is tagged **[measured]**, **[bounded]**, or **[projected]**.

> **Superseded in part.** The owner elected to proceed with a Phase 1 pilot despite this
> report's verdict, in order to test the skill's accuracy. Results — including which of the
> predictions below held — are in **[`phase1-results.md`](./phase1-results.md)**. Headline: the
> bundle predictions landed within 6%; the effort band remains unvalidated; the two largest risk
> items (ag-grid, 25 of 26 Material modules) were not exercised. The verdict below is unchanged
> on its merits and should be read alongside §3 of that document.

---

## 1. Verdict

**Do not migrate — not now.** Not because Svelte is the wrong target, but because the two things a
Svelte migration sells are both worth almost nothing to *this* app, and the prerequisite work that
would make it worth something is 1/6 complete.

The three numbers that drive it:

- The Angular runtime is **443.9 KB raw of a 4394.3 KB JS bundle — 10.1%** [measured]. The two
  UI libraries the migration must *rewrite around* (ag-grid 980.4 KB, Angular Material 585.0 KB)
  are **35.6%** — three and a half times larger, and a swap, not a saving.
- This is an Electron app: the bundle is read from local disk, never downloaded. Parse + compile
  of the **entire** 4.26 MB bundle is **42 ms** median [measured, 7 fresh processes]. Deleting all
  of Angular buys roughly **4 ms** [bounded] of a cold start otherwise dominated by Electron
  process launch.
- The safety net is **71 `it()` blocks** total, and the only E2E file asserts `app-home h1` reads
  *"App works !"* — Angular scaffold text — on **Spectron, archived since 2022** [measured]. There
  is nothing that would tell you a rewrite preserved behaviour.

Headline cost: **60–110 person-days** [projected] to reach parity, of which the largest single item
is replacing ag-grid across the two primary screens — with feature-loss risk, not just effort.

Largest risk: **11 renderer files import Node builtins directly** (`fs`, `path`, `os`). The
renderer is not portable UI code; it is Node code in an Angular costume. Porting it to Svelte
without first finishing the decoupling work means carrying that coupling into the new UI.

**What would change this verdict** is in §9. Short version: finish the UI decoupling plan. If a UI
rewrite is happening anyway — and the repo's own docs say it is planned — Svelte 5 is a defensible
target, arguably better than the React named in `CLAUDE.md`. The problem is sequencing, not Svelte.

---

## 2. What you have today [measured]

| | |
|---|---|
| Framework | Angular 17.3.4 (current Angular is v20+; this is ~2 majors behind) |
| Shell | Electron 43.1.1, `nodeIntegration: true`, `contextIsolation: false` |
| Routes | **1** (`/home`). `path: ""` redirects to it. |
| Components | **49** `.component.ts` + 50 templates, 13,034 LOC (ts+html+scss) |
| Services | 33, 8,079 LOC |
| Addon providers | 6, 2,740 LOC |
| Main process | 3,873 LOC (`app/`) — untouched by a UI migration |
| Tests | 47 spec files / 3,248 LOC / **71 `it()` blocks**; 1 E2E file (dead) |
| State | **152 `BehaviorSubject`/`Subject`** instances; `session.service.ts` alone has 17 |

**The route count is the headline correction.** The five directories under `src/app/pages/`
(`my-addons`, `get-addons`, `options`, `account-page`, `home`) are **not routes**. They are
`<mat-tab>` panels inside `home.component.html`. The app has exactly one route.

This matters because SvelteKit's entire value proposition — filesystem routing, `load` functions,
form actions, `+server.ts`, SSR, streaming — addresses problems this app does not have. There is no
server, no navigation, no data-loading waterfall to flatten. A migration here would use SvelteKit
as a Vite wrapper.

> **Note on the skill's own inventory tool.** `analyze.mjs` reported *12 components* and an effort
> band of *13–38 person-days*. Its component detector looks for JSX (`<Tag>` inside the `.ts` file),
> so Angular's separate-template components are invisible to it. The real count is 49. Every
> estimate derived from that number was low by ~4×; §7 is recalculated from the real inventory.

---

## 3. Bundle: where the bytes go

Built with `npx ng build -c production --base-href ./ --source-map=true` (production config has
`sourceMap: false`; enabled for this measurement).

### Totals [measured — exact, off the emitted files]

| | raw | gzip | brotli |
|---|---|---|---|
| JS (3 chunks) | 4394.3 KB | 1011.5 KB | 755.3 KB |
| CSS (1 file) | 720.0 KB | 83.7 KB | — |

### ⚠ The per-package table from `attribute.mjs` is not usable for this bundle

`attribute.mjs:129` weights each package's share by its **original `sourcesContent` length**, not
by emitted bytes. Packages that tree-shake well are therefore credited with bytes they do not ship,
and because shares are normalized to the chunk total, that error is subtracted from everything else.

Verified on FontAwesome, which imports 44 named icons and ships 40 definitions:

| method | @fortawesome (3 packs) |
|---|---|
| `attribute.mjs` (original-source weighting) | **547 KB raw** |
| Emitted-span attribution (below) | **20.7 KB raw** |
| Independent regex count of icon definitions in `main.js` | **20.2 KB raw** |

A 26× over-attribution. The skill's own docs bound this method at ±15%. I re-attributed by decoding
the sourcemap `mappings` VLQ and charging each generated span to its source
(`migration/baseline/attribute-emitted.mjs`); it agrees with the independent count to **2.5%**.

**All per-package figures below are emitted-span attribution [measured].** Raw bytes are exact;
the `~gzip` column applies the whole-payload gzip ratio (23.0%) uniformly and is approximate.

### Attribution [measured]

| package | raw KB | ~gzip KB | % of raw JS |
|---|---:|---:|---:|
| **(your app code)** | **1413.3** | 325.2 | **32.2%** |
| ag-grid-community | 980.4 | 225.6 | 22.3% |
| @angular/material | 585.0 | 134.6 | 13.3% |
| rxjs | 149.8 | 34.5 | 3.4% |
| lodash | 144.5 | 33.2 | 3.3% |
| @angular/core | 131.4 | 30.2 | 3.0% |
| @angular/cdk | 112.4 | 25.9 | 2.6% |
| ng-gallery | 74.7 | 17.2 | 1.7% |
| @messageformat/core | 74.3 | 17.1 | 1.7% |
| @angular/router | 70.4 | 16.2 | 1.6% |
| zone.js | 69.5 | 16.0 | 1.6% |
| @angular/animations | 62.5 | 14.4 | 1.4% |
| @angular/common | 51.0 | 11.7 | 1.2% |
| markdown-it | 49.7 | 11.4 | 1.1% |
| @microsoft/applicationinsights-* (8 pkgs) | ~128 | ~29 | 2.9% |
| axios | 37.7 | 8.7 | 0.9% |
| ag-grid-angular | 33.1 | 7.6 | 0.8% |
| @angular/forms | 31.7 | 7.3 | 0.7% |
| @fortawesome/* (3 packs) | 20.7 | 4.8 | 0.5% |
| @angular/platform-browser | 14.0 | 3.2 | 0.3% |
| reflect-metadata | 13.4 | 3.1 | 0.3% |

### Buckets

| bucket | raw KB | % of JS | note |
|---|---:|---:|---|
| **Eliminated** — Angular runtime | **443.9** | **10.1%** | core, router, common, forms, animations, platform-browser, zone.js, reflect-metadata |
| **Swapped** — net dependency saving **zero** | **1785.6** | **40.6%** | ag-grid (1013.5), Material + CDK (697.4), ng-gallery (74.7) |
| **Kept** — framework-agnostic | ~751 | 17.1% | rxjs, lodash, messageformat, markdown-it, app-insights, axios, FA icons |
| **App code** | 1413.3 | 32.2% | shrinks by an unmeasured amount |

**Ceiling [bounded]:** removing the Angular runtime and adding Svelte's (~45–55 KB raw / ~14 KB
gzip [projected, from the skill's reference measurement of svelte 5.56.8]) yields
**≥ 3995 KB raw JS — a ~9% reduction** that does not depend on estimates. App code also shrinks;
how much is unknown until a pilot measures it.

### CSS

The 720 KB stylesheet is dominated by the two libraries the migration must replace, not by
Angular: **8,727** Material/MDC token and class occurrences, **7,465** ag-grid ones [measured].
Replacing Material means rewriting `src/custom-theme.scss` (20 KB of source) and re-theming
ag-grid; it does not mean the CSS disappears.

---

## 4. Dependencies

### Removed — nothing installed in its place

| package | raw KB shipped | replaced by |
|---|---:|---|
| @angular/core | 131.4 | Svelte compiler output |
| @angular/router | 70.4 | **nothing** — the app has 1 route |
| zone.js | 69.5 | no equivalent needed (runes are explicit) |
| @angular/animations | 62.5 | `transition:` / `animate:` built-ins |
| @angular/common | 51.0 | `{#if}` `{#each}` blocks |
| @angular/forms | 31.7 | `bind:value` |
| @angular/platform-browser | 14.0 | compiler output |
| reflect-metadata | 13.4 | DI disappears |
| **total** | **443.9** | **add back ~45–55 KB** Svelte runtime |

### Reduced — partially covered, audit before counting

| package | raw KB | covered | not covered |
|---|---:|---|---|
| rxjs | 149.8 | UI-level `BehaviorSubject` → `$state` | real stream algebra in services: `combineLatest`, `switchMap`, `debounceTime`, retry/backoff. 152 subjects — most are UI state, but the addon-sync pipelines are genuine reactive programming and should stay RxJS. |
| lodash | 144.5 | most call sites → native JS | a handful of deep-equality/collection helpers. **Cuttable today without any migration.** |

### Swapped — **net dependency saving: zero**

This is the column that argues against the migration.

| package | raw KB | Svelte path | cost |
|---|---:|---|---|
| ag-grid-community + ag-grid-angular | **1013.5** | ag-grid has **no official Svelte adapter**. Either keep it via its framework-agnostic vanilla JS API (bytes unchanged, cell renderers rewritten), or hand-roll on `svelte-virtual`. | Highest-risk item. Drives `my-addons` (1,945 LOC) and `get-addons` (890 LOC) — the two primary screens. Hand-rolling loses column state persistence, multi-sort, context menus, and 7 custom cell-renderer components. |
| @angular/material + @angular/cdk | **697.4** | bits-ui / Melt / Skeleton, or native `<dialog>`/`<details>`/`<popover>` | **230 `<mat-*>` element instances**, 26 distinct Material modules, 14 `matXxx` directives, across 50 templates. Plus re-theming 20 KB of SCSS. |
| ng-gallery | 74.7 | a Svelte lightbox, or hand-roll | small |
| @ngx-translate/core + messageformat | ~88 | `paraglide-js` / `svelte-i18n` | 13 locale files must keep working; ICU MessageFormat support is required |
| @fortawesome/angular-fontawesome | small | `svelte-fa` or inline SVG | mechanical |

### Closure summary [measured]

- Direct dependencies: **17** → 17 survive + ~5 Svelte packages.
- Transitive closure: **103** → 103 survive. **Packages cut: 0.**
- Install size freed: **0.0 MB**. `node_modules` will **grow** — SvelteKit adds ~57 packages /
  ~67 MB of build toolchain (compiler + Vite) as devDependencies. The defensible version of the
  dependency claim is *SvelteKit has zero runtime dependencies*, not *node_modules shrinks*.
- These figures are an **upper bound** on the win: they count only surviving packages and exclude
  SvelteKit's own footprint, which is not installed here.

### Correction to the skill's dependency map

`dep-map.json` classifies **axios** as *eliminated → `fetch`*. That is wrong for this app: axios is
not a direct dependency and is imported nowhere in `src/` or `app/`. It arrives transitively through
**`curseforge-v2`**, which the CurseForge addon provider depends on and which a UI framework change
does not touch [measured: `npm ls axios`]. Its 37.7 KB stays.

---

## 5. Performance

### Lighthouse: not applicable, and not faked

There is no URL to profile. The renderer boots with `nodeIntegration: true` and immediately touches
`process.platform`, `fs`, and Electron IPC; served in a browser it does not reach first paint. LCP,
TBT, CLS and transfer-size all describe a network-loaded page — this bundle is read from local disk.
Reporting Lighthouse numbers here would be inventing them.

What I measured instead:

### Parse + compile [measured — 7 fresh Node processes each, median]

| | median | note |
|---|---:|---|
| Lazy compile (default — the real startup path) | **42 ms** | V8 pre-parses, compiles function bodies on first call |
| Eager compile (`--no-lazy`, worst case) | **138 ms** | upper bound if every function ran |

For the whole 4.26 MB `main.js`. The Angular runtime is 10.1% of that.

**Removing all of Angular saves ~4 ms of a 42 ms parse [bounded]**, or ~14 ms against the eager
upper bound. For scale: Electron's own process launch — Chromium + Node bootstrap, window creation,
GPU init — is measured in **hundreds of milliseconds to low seconds** on desktop hardware, and the
app then stays open for hours.

**Caveat, stated plainly:** this measures parse and compile, not *execution*. Angular's bootstrap
(DI graph construction, zone.js monkey-patching every async primitive, change-detection setup) is
real startup cost that Svelte would reduce more than proportionally, and I did not measure it —
doing so needs a DOM and the Electron preload. It is plausibly another few tens of ms. It does not
change the order of magnitude, and it is not what users perceive as slow in an addon manager.

### What the migration would not change

The work that actually makes this app feel slow is already outside Angular:

- Addon folder scanning runs in the **main process** (`app/curse-folder-scanner.ts` 262 LOC,
  `app/wowup-folder-scanner.ts` 219 LOC), with a **native C++ addon** (`native/curse.cc`) for
  CurseForge fingerprinting [measured: `binding.gyp`].
- Addon metadata comes from network calls to CurseForge / Wago / WowUp APIs.
- Grid rendering for large addon lists is **ag-grid**, which survives the migration.

Fine-grained reactivity replacing change detection is a genuine Svelte win for interaction latency,
and with 152 `BehaviorSubject`s feeding templates through `async` pipes there is real change-detection
work to remove. But the frames that drop when a user scrolls 500 addons are ag-grid's, and ag-grid
is still there afterwards.

---

## 6. Hazards

**1. No behavioural safety net.** 71 `it()` blocks across 47 spec files — mostly `should create`
smoke tests. The single E2E file asserts `app-home h1` contains *"App works !"* (Angular starter
text — it would fail against the real app) and runs on **Spectron**, archived in 2022 and
incompatible with Electron 43. There is effectively **zero** regression protection for a UI rewrite.
Building a real Playwright-for-Electron suite first is the largest hidden line item: **15–25
person-days** [projected], and it is not optional.

**2. The renderer is not portable UI code.** 11 files under `src/app` import Node builtins
directly:

```
addon-providers/zip-provider.ts          services/addons/addon.service.ts
services/toc/toc.service.ts              services/addons/addon-install.service.ts
services/warcraft/warcraft.service.ts    services/warcraft/warcraft-installation.service.ts
services/wowup/wowup.service.ts          services/wowup/wowup-addon.service.ts
services/wtf/wtf.service.ts              pages/my-addons/my-addons.component.ts
components/options/wow-client-options/wow-client-options.component.ts
```

Two of these are components. A framework migration does not fix this; it ports it.

**3. The decoupling plan is 1/6 done and its tracking document does not exist.** `CLAUDE.md` names
`wowup-electron/UI_DECOUPLING_PLAN.md` as "the source of truth for what's done vs. pending". That
file is **not on disk and has never been committed** [measured: `git log --all -- '*UI_DECOUPLING*'`
is empty]. What exists: 2 controllers (`AddonController`, `WarcraftController`), 1 API service
(`warcraft-api.service.ts`), and no `src/common/api/contracts/` directory. Phase 1 done, Phase 2
in progress, Phases 3–6 not started.

**4. ag-grid.** See §4. No official Svelte adapter; the vanilla API works but every cell renderer
is an Angular component today.

**5. Angular Material surface area.** 230 element instances / 26 modules / 14 directives / 50
templates. No Svelte library is a drop-in; this is a design-system reimplementation.

**6. Team mental model.** The playbook flags Angular as *"the largest conceptual jump… expect the
team's mental model to be the bottleneck rather than the code."* DI, NgModules, RxJS-everywhere and
decorator metadata all have no counterpart. 152 subjects must be triaged one at a time into
`$state`, `$derived`, or *keep as RxJS*.

**7. The repo does not build from a clean checkout.** Two independent stale-dependency failures hit
before I could measure anything:
- `node_modules/wowup-lib-core` is a **copy, not a symlink**, and predates `wowup-lib/src` —
  missing `WowClientType.Anniversary` and `WowClientGroup.Mists`. `npm run build:lib` rebuilds
  `../wowup-lib` but does **not** refresh the copy; only `npm install` does. The documented build
  order in `CLAUDE.md` is therefore insufficient.
- `package.json` pins `curseforge-v2@1.5.0`; **1.3.0** was installed, missing
  `CF2WowGameVersionType.Mists`.

Both are pre-existing and unrelated to Svelte, but they are a signal about migration-readiness: a
long-lived migration branch needs a reproducible build on day one.

---

## 7. Effort [projected]

Recalculated from the real 49-component inventory, not `analyze.mjs`'s 12.

| item | person-days |
|---|---:|
| Playwright-for-Electron E2E suite (Phase 0 — prerequisite) | 15–25 |
| 22 simple components (< 100 LOC) | 5–8 |
| 17 medium components (100–400 LOC) | 12–20 |
| 10 complex components (> 400 LOC, incl. `my-addons` 1,945 / `get-addons` 890 / `options-app-section` 760) | 20–35 |
| Angular Material → Svelte primitives (230 instances, 26 modules, re-theming) | 15–25 |
| ag-grid strategy (vanilla adapter + 7 cell renderers, or hand-roll) | 10–20 |
| State layer: 152 subjects → runes / retained RxJS | 8–15 |
| i18n (13 locales, ICU MessageFormat) | 4–7 |
| Build, packaging, Electron integration, CI | 5–10 |
| **Total** | **~94–165**, or **~60–110** excluding the E2E suite and assuming ag-grid is kept via its vanilla API |

This is a **heuristic band, not a measurement**. It would be replaced by the measured throughput of
a pilot slice — which, per §1, I am not recommending you fund yet.

---

## 8. Roadmap

Originally withheld, since the skill gates the roadmap on a verdict that supports migrating. The
owner subsequently chose to proceed to a Phase 1 pilot anyway, to test this report's accuracy.

**Decisions taken at the approval gate:**

| decision | choice |
|---|---|
| ag-grid | **Keep**, via its framework-agnostic vanilla JS API; drop only `ag-grid-angular` |
| Component library | **bits-ui + hand-rolled**, styled against the existing custom theme |
| Kit vs plain Svelte | **SvelteKit + `adapter-static`** |

**Workspace strategy — deviating from the playbook, deliberately.** The playbook prescribes
`git mv src original/` with the new app at the repo root. That is wrong for an Electron app: the
renderer already lives in a subdirectory, and moving `src/` would break `angular.json`,
`tsconfig.app.json`, and Karma — costing the working Angular test suite the owner explicitly wants
to keep during the migration. Instead the Svelte renderer lives at **`renderer-svelte/`** with its
own `package.json` (`"type": "module"`), which also avoids an ESM/CommonJS collision with the
CommonJS main process. The Angular tree is untouched and still builds.

Phase 1 is complete — see [`phase1-results.md`](./phase1-results.md). Pilot slice was the
**Options tab** (shell + About + Debug), not `account-page`: it is grid-free, self-contained, and
exercises the Material→bits-ui swap that is the largest line item.

Remaining phases, in dependency order: shared primitives (the other 25 Material modules) →
state layer (152 subjects) → the Node-coupled services → ag-grid screens → Electron packaging and
cutover. Each needs the Playwright-for-Electron suite from §6 ahead of it.

---

## 9. What would change this assessment

The verdict rests on four assumptions. Each is falsifiable:

1. **"Bundle size does not matter here."** Rests on this being a locally-installed Electron app.
   If WowUp ships a web build over a network, transfer size becomes real and the ~9% ceiling
   [bounded] starts to count. → *Re-run §3.*

2. **"Startup is not framework-bound."** Rests on 42 ms parse vs. Electron's own launch cost, and
   on my *not* having measured Angular's bootstrap execution. If you instrument real cold start and
   Angular bootstrap turns out to be a large share, the calculus shifts. → *Instrument
   `main.ts` bootstrap and window `ready-to-show`; that is the measurement I could not take.*

3. **"A UI rewrite is not already happening."** This is the assumption most likely to break, and it
   is the one that flips the verdict. `CLAUDE.md` states the decoupling plan's goal is *"so a future
   UI swap (e.g. React) only has to replace thin API-wrapper services."* **If the team is going to
   rewrite the UI regardless, then the marginal cost of choosing Svelte 5 over React is small, and
   Svelte is the better target for this app** — no VDOM for a grid-heavy desktop UI, and runes are
   a far better fit than 152 `BehaviorSubject`s. The blocker is sequencing: today the renderer still
   owns file I/O, addon scanning, and provider HTTP, so "swap the UI" is not yet a bounded job.
   → *Revisit the moment Phases 3–5 land.*

4. **"ag-grid stays."** If the team independently decides to drop ag-grid, ~1013 KB raw and the
   single largest migration risk leave the equation, and the balance improves materially.

### Do these first — they are cheaper and they are not migrations

- **Fix the build.** Refresh the vendored `wowup-lib-core` copy and reinstall `curseforge-v2@1.5.0`;
  document that `npm run build:lib` must be followed by `npm install`.
- **Commit `UI_DECOUPLING_PLAN.md`,** or remove the `CLAUDE.md` reference to it. Right now the
  stated source of truth does not exist.
- **Build the Playwright-for-Electron suite** and delete the dead Spectron scaffold. It is 15–25
  days you need regardless of whether you ever migrate, it de-risks the decoupling work already in
  flight, and without it *no* large refactor of this app is safe.
- **Finish Phases 2–5 of the decoupling plan.** This is the work that makes the UI actually
  swappable — and it makes a future Svelte migration cheaper and better-scoped than anything in §7.

---

## Appendix — provenance

| artifact | file |
|---|---|
| Dependency closure (skill tool) | `migration/baseline/deps.json` |
| Bundle attribution (skill tool — see §3 caveat) | `migration/baseline/bundle.json` |
| Bundle attribution (emitted-span, used above) | `migration/baseline/bundle-emitted.txt` |
| Emitted-span attributor | `migration/baseline/attribute-emitted.mjs` |

Commands:

```bash
npx ng build -c production --base-href ./ --source-map=true    # totals
node migration/baseline/attribute-emitted.mjs dist             # per-package [measured]
node --no-lazy /tmp/compile-bench.js dist/main.*.js            # parse+compile [measured]
```

**The official Svelte MCP server was not available for this run.** No `mcp__svelte__*` tools are
registered, so `svelte-autofixer`, `get-documentation` and `playground-link` could not be used, and
no Svelte 5 code was written or verified against it. Svelte 5 API claims above come from the skill's
`references/svelte5-idioms.md` (verified against svelte 5.56.8 / kit 2.70.1 on 2026-07-27). Before
writing any Svelte during a real migration:

```bash
claude mcp add -t http -s user svelte https://mcp.svelte.dev/mcp
```
