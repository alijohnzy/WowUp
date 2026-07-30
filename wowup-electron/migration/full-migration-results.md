# Full migration — measured results vs. the assessment's predictions

Date: 2026-07-28 · Branch `migrate/svelte5`
Companion to [`svelte5-assessment.md`](./svelte5-assessment.md) (the "do not migrate" verdict) and
[`phase1-results.md`](./phase1-results.md) (the 3-component pilot).

The assessment recommended against this migration. It was then carried out in full anyway, to test
what the assessment and the skill behind it actually got right. **All 49 Angular components are
accounted for.** This document records what the completed port measured, against what was predicted
before it started.

Provenance tags as in the assessment: `[measured]` on this machine, `[bounded]` derived from a
measurement, `[projected]` still an estimate.

---

## 1. Coverage

| | count |
|---|---:|
| Angular components in `src/app` | **49** |
| Ported to Svelte | **46** |
| Deleted as dead code | **2** |
| Replaced by CSS, no component | **1** |

The three that did not become components:

- **`horizontal-tabs`** (188 LOC) — its only call site is commented out in `app.component.html`.
- **`telemetry-dialog`** — no usages anywhere in `src/app`.
- **`cell-wrap-text`** — an `ICellRendererAngularComp` whose entire body was a 3-line clamp. It is
  now `cellClass: 'cell-wrap-text'` plus 9 lines of CSS in `AgGrid.svelte`. It was used on the
  `author` column of both grids, so this removes one component instance per visible row, per grid.

Several Angular components collapsed into one Svelte component: `alert-dialog`, `confirm-dialog`,
`consent-dialog`, `external-url-confirmation-dialog` and `patch-notes-dialog` are all
`DialogHost.svelte`, because in Angular they differed only by their body and button row.

---

## 2. Dependencies removed [measured]

Counted by `grep -rl 'from "<pkg>"' src/app` — files in the Angular renderer that import each
package. A package is only listed as removed if the Svelte renderer has no equivalent dependency.

| Package | Angular renderer files | Replaced by | Cost |
|---|---:|---|---:|
| `@angular/core` | 122 | `svelte` runes | — |
| `rxjs` | **75** | `$state` / `$derived` / `$effect`, plus a 12-line `Emitter` for genuine events | 12 LOC |
| `@ngx-translate/core` + `/http-loader` + `ngx-translate-messageformat-compiler` | 65 | `lib/i18n.svelte.ts` | 85 LOC |
| `@angular/material` | 50 | `bits-ui` (kept) + own components | — |
| `lodash` | **25** | `lib/utils/collection.ts` — but see the caveat below | ~90 LOC |
| `ag-grid-angular` | 11 | `ag-grid-community` vanilla `createGrid` + a 40-line `ICellRendererComp` bridge | 40 LOC |
| `@angular/cdk` | 10 | native `<dialog showModal()>`, `navigator.clipboard`, CSS | — |
| `@angular/forms` | 10 | `bind:value` / `bind:checked` | — |
| `ng-gallery` | 5 | `lib/components/common/ImageGallery.svelte` | 185 LOC |
| `nanoid` | 3 | `crypto.randomUUID()` | — |
| `zone.js` | 0 (implicit) | nothing — runes need no change detection | — |
| `core-js` | 0 (implicit) | nothing — the renderer is Chromium 150 | — |
| `@angular/{common,router,platform-browser,platform-browser-dynamic,compiler,animations}` | — | SvelteKit + Svelte transitions | — |

**Answering "what else can be stripped that Svelte provides natively":**

1. **`@angular/animations` (62.5 KB raw)** — Svelte ships `transition:`/`animate:` in the compiler
   output. Nothing was imported to replace it.
2. **`zone.js` (69.5 KB raw)** — the entire reason it exists is monkey-patching async APIs so
   Angular knows when to re-render. Runes track dependencies directly.
3. **`@angular/cdk`'s overlay, focus-trap and a11y modules (112.4 KB raw)** — native `<dialog
   showModal()>` supplies modality, focus trap, inert background, Escape handling and `::backdrop`.
4. **`@angular/cdk/clipboard`** — `navigator.clipboard.writeText`. Reads still go over IPC, because
   `navigator.clipboard.readText()` needs a secure context and the renderer is loaded from `file://`.
5. **`nanoid`** — `crypto.randomUUID()` has been in Electron since Chromium 92.
6. **`ng-gallery`** — it needed a `Gallery` service injected into the component, an `ImageItem`
   wrapper per URL, a `gallery.ref().load()` call, `<mat-grid-list>`/`<mat-grid-tile>` and a
   `[lightbox]` directive. It is a thumbnail grid plus an overlay: CSS grid and a fixed-position div.
7. **`lodash`** — every call site used `first`, `last`, `sortBy`, `uniq`, `differenceBy`, `some`,
   `filter` or `orderBy`. All are `Array.prototype` methods or four lines.

### Still there, and why

| Package | Reason |
|---|---|
| `@messageformat/core` | ICU plurals are used in real translation strings. **Still the largest single dependency** — see §4. |
| `ag-grid-community` | Both primary screens. The *Angular adapter* went; the grid did not. |
| `@fortawesome/*` (3 packs) | Named imports stay tree-shakeable; the emitted cost is the ~40 icons actually referenced. |
| `bits-ui` | Tabs and a few primitives. Not a Material replacement — most Material usage became plain markup. |
| `curseforge-v2`, `opossum`, `slug`, `ts-custom-error`, `wowup-lib-core` | Domain/infrastructure, untouched by a UI migration. |

### Removed from the renderer ≠ removed from the bundle [measured]

This is the correction the emitted-byte attribution forced, and it is worth stating loudly because
it is the same mistake the assessment caught the skill making about `axios`.

**`lodash` still ships — 78.7 KB of it.** The renderer's own 25 import sites went to zero, and
`lib/utils/collection.ts` is real. But `wowup-lib-core` — the shared domain library, which a UI
migration does not touch — depends on `lodash`, `markdown-it` and `uuid`, and `curseforge-v2`
depends on `axios`. Together that is **198.0 KB raw** of "eliminated" dependency still in the
bundle:

| Package | raw KB | arrives via |
|---|---:|---|
| `lodash` | 78.7 | `wowup-lib-core` |
| `markdown-it` (+ `linkify-it`, `mdurl`, `uc.micro`, `punycode`) | 54.1 (+21.0) | `wowup-lib-core` |
| `axios` | 49.8 | `curseforge-v2` |
| `uuid` | 15.4 | `wowup-lib-core` |

So the honest form of every row in the table above is *"no longer imported by renderer code"*, not
*"no longer in the bundle"*. The distinction matters: removing these for real means changing
`wowup-lib`, which is a separate project with its own consumers.

The app's own HTTP (`HttpClient`) did become `fetch` + `AbortSignal.timeout`, and that one is a
genuine removal — the renderer no longer contributes an HTTP client of its own.

---

## 3. Source size [measured]

| | LOC |
|---|---:|
| Angular renderer (`src/app`, `.ts` + `.html` + `.scss`, excl. specs) | **25,494** |
| Svelte renderer (`renderer-svelte/src`, `.svelte` + `.ts`, excl. specs) | **19,235** |
| Delta | **−6,259 (−25%)** |

This tracks the pilot's ~27% figure closely, which is the one effort-adjacent prediction that held
up across the full port.

Tests are additional and have no Angular counterpart worth comparing (see §6):

| | LOC |
|---|---:|
| Unit specs (`src/**/*.spec.ts`) | 537 |
| E2E specs (`e2e/*.e2e.ts`) | 1,372 |

---

## 4. Bundle [measured]

Clean production build of both renderers on this machine. Angular: `dist/` (one eager IIFE bundle
plus polyfills and runtime). Svelte: `renderer-svelte/build/` (25 ESM chunks, route-split).

| | Angular | Svelte | delta |
|---|---:|---:|---:|
| **JS emitted, all of it** | 4394.5 KB | 2317.8 KB | **−47%** |
| **JS to render the first screen**, raw | 4394.5 KB | 1811.5 KB | **−59%** |
| **JS to render the first screen**, gzip | 1008.4 KB | 511.0 KB | **−49%** |
| Shell only (before the route resolves), raw | — | 699.3 KB | — |
| Shell only, gzip | — | 229.2 KB | — |
| CSS, raw | 719.9 KB | 308.5 KB | **−57%** |
| CSS, gzip | 83.4 KB | 46.6 KB | −44% |

Angular's figure is the same in every row because `main.js` is one eager bundle: there is no
splitting, so "all of it" and "what the first screen needs" are the same 4.4 MB.

**The route split is where the difference actually comes from.** ag-grid — 958.3 KB emitted, 41% of
the whole Svelte bundle — lands entirely in `nodes/2.js`, the page node, and is not in the shell.
That happened for free from SvelteKit's route-based splitting; no manual `import()` was written.
It is a waterfall rather than a saving on first paint (the initial route still needs it), but it is
a real saving on every screen that is not a grid, and it is the single biggest structural
difference between the two builds.

### Package attribution (Svelte, emitted bytes)

| package | raw KB | % |
|---|---:|---:|
| **ag-grid-community** | **958.3** | **41.4%** |
| (app code) | 376.3 | 16.2% |
| @messageformat/core | 81.5 | 3.5% |
| *lodash* † | 78.7 | 3.4% |
| bits-ui | 72.5 | 3.1% |
| **svelte** | **59.2** | **2.6%** |
| *markdown-it* † | 54.1 | 2.3% |
| *axios* † | 49.8 | 2.2% |
| **@sveltejs/kit** | **26.8** | **1.2%** |
| *uuid* † | 15.4 | 0.7% |
| @fortawesome (3 packs) | 17.8 | 0.8% |

† transitive via `wowup-lib-core` / `curseforge-v2` — see §2.

**Svelte + Kit together are 86.0 KB: 3.7% of the bundle they are the framework for.** Angular's
equivalent was 443.9 KB. Both the UI framework and the app code are now smaller than the grid.

### Parse + compile [measured]

Median of 7 fresh processes, `migration/baseline/parse-bench.mjs`.

| | size | parse+compile |
|---|---:|---:|
| Angular, whole app (`vm.Script`) | 4394.5 KB | **48.6 ms** |
| Svelte, shell (`vm.SourceTextModule`) | 699.3 KB | **20.7 ms** |
| Svelte, first screen (shell + page node) | 1811.5 KB | **33.6 ms** |

**These use different V8 entry points and should not be quoted as a clean speedup.** What survives
the caveat is the assessment's original point, now confirmed at full scale: the whole range is
20–50 ms. On a desktop app that a user leaves open for hours, a 15 ms difference in startup parse
is not a reason to do anything.

---

### CSS composition [measured]

> **Corrected.** An earlier revision of this section reported the app's own CSS as **17.6 KB** and
> called it "the largest proportional change anywhere in the build". That was wrong. It was
> measuring a **missing stylesheet**: none of `custom-theme.scss`, `controls.scss`, `styles.scss`
> or `markdown.scss` had been ported, so the renderer shipped no theme at all and rendered
> unstyled. The figures below are from the build after the theme port. See §10.

| | raw KB |
|---|---:|
| Angular `styles.css` (all of it) | 719.9 |
| Svelte, page node (ag-grid theming — 2,525 `ag-*` selectors) | 261.5 |
| Svelte, the app's own CSS (theme + controls + markdown + Tailwind + scoped blocks) | 47.0 |
| **Svelte total** | **308.5** (gzip 46.6) |

Angular's non-grid CSS was ~459 KB; the Svelte equivalent is **47.0 KB**. That is still a large
reduction, but the honest explanation is narrower than "Svelte is leaner": ~459 KB of the Angular
figure is Material/MDC component theming generated by `mat.all-component-themes`, and the app is
no longer using Material. WowUp's own identity — six theme variants, `wu-btn`, the markdown body —
ports across at roughly its original size.

---

## 5. Prediction vs. measurement

The assessment's job was to be right about whether to do this. Scoring it honestly:

| # | Assessment said | Measured | Verdict |
|---|---|---|---|
| 1 | Bundle ceiling **≥ 3995 KB raw JS, a ~9% reduction** [bounded] | **2317.8 KB total / 1811.5 KB first screen — 47% / 59%** | ❌ **badly wrong**, and wrong in migration's favour |
| 2 | Angular runtime 443.9 KB → Svelte "~45–55 KB raw" [projected] | svelte 59.2 + Kit 26.8 = **86.0 KB** | ⚠️ svelte alone within band; the prediction forgot to add Kit |
| 3 | Material + CDK (697.4 KB) is a **"swap — net dependency saving zero"** | bits-ui **72.5 KB**. Most `<mat-*>` became plain markup | ❌ **wrong** — a 625 KB saving predicted as zero |
| 4 | ag-grid (1013.5 KB) is a swap, saving zero | 958.3 KB, still there | ✅ **right** |
| 5 | "Removing all of Angular saves ~4 ms of a 42 ms parse" [bounded] | 48.6 ms → 33.6 ms | ⚠️ number low, **conclusion right**: it is tens of ms either way |
| 6 | CSS is "dominated by the two libraries the migration must replace" | ag-grid 261 KB stays; Material's ~459 KB → **47.0 KB** of ported theme | ✅ **right** — the split it predicted is exactly what happened |
| 7 | `rxjs`, `lodash`, `markdown-it`, `axios` are **"kept — framework-agnostic"** | rxjs **gone** (75 files → 0). lodash/markdown-it/axios still ship, but via `wowup-lib-core`/`curseforge-v2`, not the renderer | ⚠️ right on the packages, wrong on rxjs |
| 8 | App code "shrinks by an unmeasured amount" | **25,494 → 19,235 LOC (−25%)** | ✅ direction right, magnitude now measured |
| 9 | Effort **60–110 person-days** [projected] | **Still not validated** — see below | ⚠️ unresolved |
| 10 | ag-grid has no official Svelte adapter; budget 10–20 person-days | Confirmed. `createGrid` + a **40-line** `ICellRendererComp` bridge | ✅ right, and it was one of the easier items |

### Where the assessment went wrong, and why it still reached the right verdict

**The bundle prediction was off by 5×.** Two errors compounded: it assumed app code held its size
(it fell 25%), and it modelled Angular Material as a *swap* — one component library traded for
another of similar weight. That is not what happened. Most Material usage was not replaced by a
library at all; `<mat-dialog>` became `<dialog showModal()>`, `<mat-menu>` became a positioned div,
`<mat-slide-toggle>` became a styled checkbox. bits-ui ended up covering Tabs and little else.
**697.4 KB was replaced by 72.5 KB, plus CSS that fell from ~459 KB to 17.6 KB.**

That is a real methodological lesson: *"swap library A for library B"* is the wrong model for a
migration to a framework whose primitives are closer to the platform's. The right question is how
much of library A exists only to paper over the framework, and the answer here was: most of it.

**And yet the verdict — "do not migrate" — survives.** The verdict never rested on the bundle
number. It rested on this: the renderer loads from local disk, so bundle size is not transfer cost;
it is disk and ~15 ms of parse. A 2 MB reduction that nobody waits for is not worth 60–110
person-days, and none of the measurements above change that. The assessment was wrong about the
size of the prize and right about the prize not being the point.

**Effort remains unvalidated, deliberately.** An agent porting 49 components across a long session
is not a proxy for person-days, and converting it into one would reproduce exactly the failure the
provenance tagging exists to prevent. What can be said: the patterns are fixed, the infrastructure
is written once, and components come out 25% smaller. The two items flagged as highest-risk —
ag-grid and the 26 Material modules — both came in *easier* than projected. That is evidence the
band's upper half is pessimistic; it is not a measurement of the band.

---

## 6. What the migration found in the Angular code

Defects and dead code surfaced by porting, listed because they are the part of the return that no
bundle metric shows. Fixed forward in the Svelte tree; `src/app` is untouched.

1. **`ExternalLinkDirective` is dead code.** Its `@HostListener` body is entirely commented out, so
   `<a appExternalLink>` navigated the renderer away from the app. (Found in the pilot.)
2. **The tab rail had no tab semantics** — no `role="tab"`, no roving focus, no arrow keys.
3. **`AddonManageDialog` computed `didError` per import row and never rendered it**, so a failed
   install was indistinguishable from one still running.
4. **`RelativeDurationPipe` is typed `transform(value: string)` but the WTF backup list passes a
   number.** Angular's loose template checking let it through.
5. **`webview.component.ts` ends with `this.webviewContainer.nativeElement.innerHTML = 0`** —
   assigning the number `0`, which stringifies to `"0"` and leaves a stray text node.
6. **`install-from-protocol-dialog` returns `"'"`** (a bare apostrophe) as the fallback author.
7. **Two arbitrary delays**: `delay(1000)` before the protocol dialog's addon lookup and
   `delay(500)` before the news refresh. Nothing depended on either.
8. **`horizontal-tabs` and `telemetry-dialog` are unreachable** (§1).

---

## 7. Behaviour verified [measured]

```
svelte-check   1280 files, 0 errors, 0 warnings
vitest           75 tests, 6 files
playwright       55 tests, 5 files
```

E2E coverage by screen: `options` (5), `get-addons` (6), `my-addons` (9), `addon-detail` (10),
`addon-dialogs` (10) — and 15 more across the primitives.

The Angular tree's entire E2E suite is one file asserting `app-home h1` reads *"App works !"*, on
Spectron, archived in 2022. It cannot run against Electron 43.

---

## 8. The bug that cost the most, and why it is a migration lesson

Worth recording because it is a hazard specific to migrating *alongside* an existing build, and no
part of the skill warns about it.

The Angular build compiles in place: `tsc` drops a `.js` next to every `.ts` under `src/`. Those
files are gitignored (`.gitignore`, `src/**/*.js`), so they never appear in `git status` — but they
are on disk, and **Vite's default `resolve.extensions` probes `.js` before `.ts`**.

So `import { IPC_ADDONS_GET_ALL } from '$common/constants'` resolved to a **June build artifact**
that predated half the IPC channel constants. Nothing threw. The absent exports were simply
`undefined`, and the renderer called `ipcRenderer.invoke(undefined, …)`, which surfaced hours later
and several layers away as an empty grid. Twelve modules under `src/common` were shadowed this way;
`IPC_ADDONS_SAVE_ALL` happened to exist in the stale copy, which is why *some* addon IPC worked and
made the failure look like a data problem rather than a resolution problem.

Deleting the artifacts is not a fix — the next `npm run build` recreates them. The fix is a scoped
`resolveId` plugin in `vite.config.ts` that prefers `.ts` for exactly the shared Angular
directories, plus `src/lib/services/addon-storage.svelte.spec.ts`, which pins every channel name so
the failure mode is a red test rather than an empty screen.

**Generalisable rule: when a new renderer aliases into an existing app's source tree, check what
that tree's own build leaves lying around.**

---

## 9. Electron wiring [measured]

The renderer is selected at launch, defaulting to Angular so shipped behaviour is unchanged:

```bash
npx electron . --renderer=svelte     # or WOWUP_RENDERER=svelte
npm run svelte:electron:local        # build + launch
npm run svelte:start                 # vite dev server + electron
```

- `app/main.ts` loads `renderer-svelte/build/index.html` instead of `dist/index.html`, and points
  `--serve` at Vite's port 5173 instead of Angular's 4200.
- All four `electron-build/*.json` configs now include `renderer-svelte/build/**/*.*`.
- Flavour swapping (`wago`/`ow`, dev/prod) is a Vite alias on `$config/environment` driven by
  `BUILD_FLAVOR`, replacing `angular.json`'s `fileReplacements`.

**`app/preload.ts` needed no changes.** It exposes `window.wowup` with no Angular in it, so both
renderers use the same bridge — which is the clearest evidence that the original architecture's
IPC boundary was drawn in the right place, whatever else is true of it.

### Three bugs only the real Electron boot caught [measured]

All 55 Playwright tests were green against `vite preview` over `http://` while every one of these
was broken. They are all `file://` or lifecycle problems, which is precisely what a dev server
cannot show you.

1. **`adapter-static`'s SPA fallback emits absolute asset URLs.** `paths.relative: true` only
   applies to prerendered pages, which know their own depth; the fallback cannot. So `index.html`
   referenced `/_app/immutable/entry/start.*.js`, which under `file://` resolves against the
   *filesystem root*. Every module 404'd, the window rendered nothing, and the main process
   reported only a bare `ERR_FAILED (-2)`. Fixed by `scripts/relative-paths.mjs`, which rewrites
   `"/_app/` → `"./_app/` after the build and exits non-zero if any absolute URL survives.

2. **SvelteKit's router 404'd on every route.** It matches `location.pathname`, which over
   `file://` is `/home/…/build/index.html`. The layout rendered and the page did not — console
   said `Error: Not found: /home/…/index.html`. Fixed with `router: { type: 'hash' }`, which reads
   `location.hash` instead. This required dropping `ssr`/`prerender` from `+layout.ts` (SvelteKit
   rejects the build if both are set) and updating two E2E tests to `goto('/#/options')`.

3. **The grid was destroyed and rebuilt on every row change.** `AgGrid.svelte` created the grid
   inside an `$effect` that read `options` and `rowData` reactively, so the effect re-ran on every
   update — each keystroke in the filter box tore down the grid and built a new one. It also left
   callers holding a destroyed `GridApi`, which is what surfaced in the log as *"Grid API function
   applyColumnState() cannot be called as the grid has been destroyed"*. Fixed by reading both
   through `untrack()` at creation and pushing later changes in via `setGridOption`, which is what
   the separate update effects below it already existed to do.

Boot is now clean: zero console errors, zero ag-grid warnings.

**The lesson generalises past this app.** A browser-based E2E suite validates component behaviour,
not the deployment target. For an Electron renderer the `file://` boot is a distinct integration
surface, and nothing short of launching the binary exercises it.

---

## 10. The stylesheet that was never ported

Recorded prominently because it is the largest single defect the migration produced, it survived
every automated check, and the shape of it generalises.

**Symptom.** The app booted, all 49 components rendered, 75 unit tests and 55 E2E tests passed,
`svelte-check` reported 0 errors — and the running app looked nothing like WowUp. White background,
default browser buttons, an unthemed white grid on dark chrome, no logo.

**Cause.** 47.8 KB of stylesheets had no counterpart in the Svelte tree:

| file | KB | contents |
|---|---:|---|
| `src/custom-theme.scss` | 19.7 | 6 blocks of ~65 CSS custom properties (default/horde/alliance × dark/light), the `--ag-*` grid theme, one-line utilities |
| `src/markdown.scss` | 16.8 | `.markdown-body` for addon descriptions and changelogs |
| `src/styles.scss` | 9.6 | base resets, app rules, a Bootstrap-ish utility layer |
| `src/controls.scss` | 1.0 | `.wu-btn` and variants |

`renderer-svelte` had **no global stylesheet at all** — only per-component `<style>` blocks. The
components referenced the missing classes constantly (`wu-btn` 60×, `wu-btn-primary` 32×, `text-1`
23×, `bg-secondary-4` 14×) and CSS fails silently: an undefined class is not an error, it is simply
no rule.

**Why nothing caught it.** Every test asserted on structure and behaviour — `toBeVisible`,
`toHaveCount`, `toHaveText`. All of those pass on unstyled markup. `svelte-check` type-checks
scripts, not class names. There was no test whose failure mode was "this looks wrong", and the
Electron boot check I did run asserted only that the console was clean.

**The other half.** The port had also invented a `--wu-*` custom-property namespace
(`--wu-bg-secondary-4`, `--wu-text-1`) with hardcoded fallback colours, rather than using the app's
real `--background-secondary-4` / `--text-1`. Because every reference carried a fallback, this too
rendered plausibly — a generic dark grey — instead of failing.

**Fix.** `src/app.css` imports Tailwind v4 then `styles/theme.css` (the six theme blocks, ag-grid
variables and semantic utilities), `styles/controls.css` and `styles/markdown.css`. The latter two
are the Angular files with line-leading `//` comments stripped: their nesting and `&` are valid
native CSS in Chromium 150, so they needed no rewrite. The 26 `mat.*` mixin lines and ~36
`.mat-*`/`.mdc-*` overrides were dropped; only ~36 rules of 847 lines were Material-specific.

Two bugs in the original CSS were corrected rather than copied — `rgba(var(--text-1), 0.38)` and
`hsl(var(--background-secondary-2), 95%)` both pass a colour where a channel list is required, so
the browser dropped those declarations.

One further defect surfaced only once the theme was in place: ag-grid sets `line-height` on
`.ag-cell` to roughly the row height, and **cell renderers inherit it**, so every line box inside
them inflates — the Update button rendered as tall as its row and the addon name and version drifted
apart. The Angular cell pinned explicit `font-size`/`line-height` pairs for exactly this reason. It
is now reset once on the bridge element rather than per renderer.

**Generalisable rule: a component port is not done when the tests pass. Behavioural tests cannot
see appearance, so a migration needs at least one check whose failure mode is visual.**
`e2e/visual-capture.e2e.ts` renders My Addons, Options and the addon-detail dialog with
representative data and writes screenshots to `screenshots/` for exactly that purpose.

### A second round, found only by running the app

Landing the theme fixed the obvious breakage and exposed four more defects, each invisible to the
test suite and each still green across 75 unit and 58 E2E tests:

1. **Every heading in the app rendered at 16px/400.** Angular Material supplied the type scale via
   `mat.all-component-typographies()`; that went with the mixins, and Tailwind's preflight then
   resets `h1`–`h6` to `font-size: inherit; font-weight: inherit`. Measured rather than assumed —
   a computed-style probe returned `h1: 16px/400` through `h4: 16px/400`, identical to `<p>`. The
   UA scale is now restored explicitly in `app.css`; margins deliberately are not, because the
   components already set their own spacing against the preflight `margin: 0`.

2. **Modal dialogs anchored to the top-left corner.** A `<dialog>` opened with `showModal()` is
   centred by the UA stylesheet's `margin: auto`, which preflight zeroes. `margin: auto` is now
   explicit on `.wu-dialog`.

3. **`.wu-dialog` was defined twice, both times scoped.** It lived in `DialogHost.svelte`'s and
   `Modal.svelte`'s `<style>` blocks, so the three components that render their own `<dialog
   class="wu-dialog">` — `AddonDetail`, `AddonManageDialog`, `WtfBackup` — matched nothing and fell
   back to the UA default: a white, unpadded, top-left box. Now global, with only size overrides
   left in the components.

4. **Native `<select>` popups were white-on-white in dark themes.** Angular used `<mat-select>`,
   which renders its own popup inside the page; a native option list is painted by the browser and
   ignores page styles, so the popup drew white while the options inherited the page's white text.
   Fixed with `color-scheme: dark|light` per theme block, plus explicit `select`/`option` colours
   using the opaque `-fill` background token, since popups cannot be translucent.

Also restored: markdown list markers and indentation inside `.markdown-body`, which
github-markdown-css leaves to the UA and preflight removes.

**Adopting Tailwind mid-migration has a cost that is easy to miss: preflight is a reset, and a
half-ported app is exactly the situation where the UA defaults were still load-bearing.** Three of
these four were preflight interactions.

### A third round: the cascade, and colours that were never tokens

Landing the theme still left the grid white on dark themes and the whole app unusable on light
ones. The causes were different again:

5. **The grid rendered in ag-grid's stock white palette.** `theme.css` and ag-grid's own
   `ag-theme-material.css` declare the *same* selector, `.ag-theme-material`, at identical
   specificity — and ag-grid's is imported by `AgGrid.svelte`, which lives in the lazily-loaded
   page node, so its stylesheet is appended after. Later sheet wins. Measured:
   `--ag-background-color` resolved to `#fff` and `.ag-row` to `rgb(255,255,255)`. Fixed by
   repeating the class (`.ag-theme-material.ag-theme-material`), which raises specificity above
   the load order — chunk order is not guaranteed stable between builds, so specificity is the
   only reliable lever here.

6. **17 components hardcoded `rgb(255 255 255 / n%)`** for hover and selected tints, and `#fff`
   for the toggle thumb. Every one is invisible on a light theme. These were never theme tokens
   because Angular Material generated its own state layers. Added `--overlay-subtle/-hover/
   -selected/-strong/-border` to all six theme blocks and swept the call sites.

7. **The nav-rail logo vanished on light themes — self-inflicted.** WowUp has two logo
   variables: `--title-logo` is always the white mark (the rail uses it, and light themes invert
   it to black), while `--theme-logo` is already theme-appropriate and is used undimmed as the
   About/Account/News watermark. The port bound the rail to `--theme-logo`, so light mode drew a
   dark logo that the invert then flipped back to white.

Fixing the debug-panel plumbing also surfaced **five invented IPC channels** —
`window-unmaximize`, `window-close`, `window-leave-full-screen`, `show-logs-folder`,
`show-config-folder`, `log-debug-data`, plus a wrong argument shape for
`system-preferences-get-user-default`. None of them are registered by the main process, and none
failed visibly: `invoke()` rejects asynchronously and the message lands only in the Electron main
log. In every case the correct implementation already existed in the state layer; the components
had simply gone around it. `src/lib/ipc-channels.spec.ts` now walks every channel literal in the
renderer and requires it to be declared in `src/common/constants.ts` or explicitly allow-listed.

**The through-line across all three rounds: none of this was caught by the type checker or by 78
unit and 60 E2E tests, because none of them can see a colour, a cascade, or an unhandled IPC
rejection.** The checks that do are the visual-capture harness, the channel guard, and reading the
Electron console log.

### Round four: two behavioural regressions and a wrong build flavour

8. **Clicking an addon name did nothing; only double-clicking the row opened it.** ag-grid merges
   `cellRendererParams` *into* `params` rather than passing them separately, and the bridge only
   forwarded `params` — so `MyAddonsAddonCell`'s `onViewDetails` prop was `undefined` and its click
   handler was a silent no-op. Double-click worked because that is the grid's own
   `onRowDoubleClicked`. `PotentialAddonCell` on Get Addons was hit too (`channel` *and*
   `onViewDetails`). The bridge now reads `colDef.cellRendererParams` and forwards exactly those
   keys — deliberately not spreading all of `params`, so ag-grid internals like `data` or `value`
   cannot shadow a component's own prop. Four unit tests plus an E2E pin it.

9. **No dialog closed on a backdrop click.** MatDialog dismisses on Escape *and* a backdrop click
   unless `disableClose` is set; a native modal `<dialog>` only does the first. The port had five
   near-identical local `modal()` helpers, and they had drifted — only two honoured `disableClose`,
   none implemented light dismiss. Replaced by one `modalDialog()` attachment setting
   `closedBy = 'any' | 'none'`, which maps onto MatDialog's two modes exactly.

10. **The Svelte build was neither flavour.** `svelte:build` set no `BUILD_FLAVOR`, so the Vite
    alias fell through to `src/environments/environment.ts` — which has **both** wago and
    curseforge disabled. Not the wago build, the neutral dev default, which is why CurseForge
    addons had no detail content. Added `svelte:ow:*` scripts mirroring the Angular `ow:*` set
    (including launching via `ow-electron`), and pinned `BUILD_FLAVOR=wago` on the default ones.
    Verified by grepping the built chunks: the ow build carries the CurseForge API key
    placeholder and no wago terms URL; the wago build the reverse.

**Note for anyone running the Angular build scripts:** `npm run build` and the `ow:*` scripts call
`app-env/inject-env.js`, which rewrites tracked files in place — `app/env/environment.ts` plus
`name`, `productName` and `repository.url` in `package.json`. That is deliberate (it is how the
app picks its userData directory, `WowUp` vs `WowUpCf`), but it means `svelte:electron:local` and
`svelte:ow:electron:local` do not merely build a flavour — they switch the whole installation,
including which addon database it reads.

### The verification that always passed

Worth recording separately, because it invalidated three consecutive reports in this document's
history rather than causing a bug in the app.

The Electron boot check was `grep INFO:CONSOLE <log> | grep -c error`. **That returns zero when
the renderer never loads** — no renderer, no console output, no errors — so a hard page-load
failure (`ERR_FAILED (-2)`, sitting plainly in the main-process log) read as "0 console errors,
clean boot". Absence of evidence was being reported as evidence of absence.

`scripts/verify-boot.mjs` replaces it and asserts *positively*: the renderer must have produced
output of its own (excluding electron-log's main-process echo), the main process must not have
reported a load failure, and only then are console errors counted. It is wired up as
`npm run svelte:verify:boot` and `npm run svelte:ow:verify:boot`, and was validated against a
deliberately broken build — removing `build/index.html` makes it fail, which the old check did
not.

This is the same shape as the missing stylesheet in §10: **a check whose failure mode is silence
is not a check.**

Two further notes from getting the CurseForge flavour running locally:

- **`@overwolf/ow-electron` ships without its binary until its `postinstall` completes.** If
  `ow-electron` throws *"Electron failed to install correctly"*, run
  `node node_modules/@overwolf/ow-electron/install.js` — it fetches a ~285 MB runtime.
- **The CurseForge API key is a build secret.** The environment files carry a literal
  `{{CURSEFORGE_API_KEY}}` placeholder, and `gulpfile-ow.js` substitutes it by rewriting the
  tracked env files during packaging. Without substitution, CurseForge rejects every request, so
  addon **descriptions and changelogs come back empty while previews still render** — previews
  are stored on the addon record, descriptions are a live call. `vite.config.ts` now substitutes
  it from `CURSEFORGE_API_KEY` at build time, warning if unset, and without writing the secret
  into version control:

  ```bash
  CURSEFORGE_API_KEY=… npm run svelte:ow:electron:local
  ```
- **The app takes a single-instance lock.** A leftover Electron process from an earlier run makes
  the next launch quit, which destroys the window mid-load and surfaces as `ERR_FAILED (-2)` —
  easily mistaken for a broken build.

---

## 11. The systematic audit: four lenses over the whole port

Rounds one to four in §10 were all reactive — a screenshot arrived, a defect got fixed. That
finds what is visible on the pages you happen to look at. The question worth answering was
different: **what else did the port drop that nobody has looked at yet?**

Four mechanical comparisons against the Angular tree, each catching what the previous ones
structurally could not.

### Lens 1 — i18n keys

Every translation key the Angular sources reference, minus every key the port references. A
missing key means missing UI: a message, a menu item, a confirmation.

Started at 80 flagged keys, ending at 12 — 9 dead in Angular too (a telemetry dialog nothing
opens, a portable-update path called only from a commented-out line, the tab titles of a
`horizontal-tabs` component commented out of the shell), and 3 that the port builds by string
interpolation.

The gap it closed, in order of severity: the Options → Application setting descriptions, the
Patreon link in the nav rail, scan/sync/install error snackbars that had emitters but no
listeners, the app self-update prompt, the multi-select remove confirmation (the port asked
once per addon — ten dialogs to remove ten), and the ten `INSTALL_FROM_URL.ERROR.*` messages
that map a failure to a cause (`HttpError` → "no addon found", `EOPENBREAKER` → "failed to
connect", `AssetMissingError` → the per-client-group message). The port had shown `err.message`
for all of them.

**Where this lens is blind:** it credited `PAGES.X.${dynamic}` as covering every key under that
prefix. Re-running it with exact matching only found
`ADDON_CONTEXT_MENU.AUTO_UPDATE_ADDON_NOTIFICATIONS_ENABLED_BUTTON` — a real missing menu item
hidden by the very prefix rule that made the audit tractable. An audit's convenience assumption
is where its blind spot lives.

### Lens 2 — IPC channels

Every channel the Angular renderer invokes, minus every channel the port invokes. 23 flagged,
most of them regex noise (`.on('open')` on an EventSource is not IPC). Three were real:

| Channel | What was broken |
|---|---|
| `restart-app` | The port invoked `restart-application`, which nothing registers. Changing the language or toggling hardware acceleration saved the preference and then silently failed to restart. |
| `set-release-channel` | The port wrote the release-channel preference but never told the main process, so switching to the beta channel did not change what electron-updater fetched. |
| `menu-zoom-in` / `-out` / `-reset` | Sent by the native View menu; nothing listened. |

`restart-application` is the sharper finding, because a test existed specifically to prevent it.
`ipc-channels.spec.ts` checks every channel literal against `src/common/constants.ts`, with an
allowlist for channels the main process registers with inline literals — and
`restart-application` was **on the allowlist**, put there on the assumption it was one of those.
The escape hatch was never verified. The spec now checks that each allowlisted channel actually
appears in `app/`, which immediately flagged three more entries as redundant.

### Lens 3 — template event bindings

Every `(click)`/`(change)`/`(keyup)` handler name in an Angular template, checked against the
whole port. 28 flagged across 17 components; most were renames (`onClickMoveUp`/`onClickMoveDown`
became one `move(direction)`). Two were real: the **auto-update notifications** checkbox in the
My Addons context menu, and the **Debug ad frame** button in Options → Debug.

The notifications item is a good example of a defect that survives casual inspection. It is
hidden unless system notifications are on *and* the addon auto-updates *and* it is not ignored
*and* it has no warning — so with default fixtures the menu looks complete. The E2E test added
for it seeds those conditions explicitly and asserts the item is absent for an addon that does
not qualify.

### Lens 4 — emitters with a missing side

The `Emitter` class replaced Angular's `Subject`s. Any emitter with publishers but no
subscribers is wiring that was cut halfway. Five flagged, four real — all of them "the UI
silently does not update":

- `session.addonsChanged`, `session.rescanComplete`, `session.targetFileInstallComplete` — My
  Addons refreshed on all three in Angular. In the port a WTF restore, an addon installed from a
  URL, and a rescan from Options all left a stale grid.
- `addonService.addonAction` — the taskbar badge count updated on sync and scan.
- `session.debugAdFrame` — the *subscriber* existed in `AdWebView`; the button that emits was
  the missing half.

The fifth, `getAddonsHiddenColumns`, is declared and never used on either side; removed.

### What the lenses did not find, and how

Three whole subsystems were missing, and no lens above would have caught them, because they are
not keys or channels or handlers — they are **calls that were never made**:

- **The native menu bar.** `createAppMenu()` translates 18 labels and ships them to the main
  process. Never called, so the app ran with Electron's default menu.
- **The system tray.** Same shape, 3 labels.
- **The auto-update job.** `initializeAutoUpdate()` — a one-hour interval that syncs every
  client, installs pending updates, raises a desktop notification and refreshes the badge.
  Never started, so addons with auto-update enabled were never updated in the background, and
  `--quit` (the scheduled-task mode) never terminated.

These surfaced from reading `app.component.ts`'s `ngAfterViewInit` against the port's
`bootstrap()` line by line — the thing the user actually asked for, and the thing no script
substitutes for. The lesson is symmetrical to §10's: **a lens finds what its axis can express.**
A dropped call has no key, no channel and no handler; it has only an absence in a sequence.

### Cost of the audit

| | |
|---|---|
| Defects found | 20 |
| Of which user-visible | 17 |
| Files changed | 21 |
| New modules | `native-menu.ts`, `auto-update.ts` |
| Verification after | 1285 files / 0 errors, 83 unit, 65 E2E, clean boot on both flavours |

---

## 12. Phase B: routes and `runed`

Two things the first pass carried over from Angular's shape rather than Svelte's.

### The `{#if}` chain that stood in for routing

`src/app/pages/home/home.component.html` is a `<mat-tab-group class="header-less-tabs">` — its
headers are hidden with CSS because the real navigation is the vertical rail, which drove it
through `sessionService.selectedHomeTab$`. The port reproduced that literally: one
`+page.svelte` with an `{#if}` over a number, importing all five screens.

Now each screen is a route:

```
src/routes/+page.svelte            redirect -> /my-addons
src/routes/my-addons/+page.svelte
src/routes/get-addons/+page.svelte
src/routes/account/+page.svelte
src/routes/news/+page.svelte
src/routes/options/+page.svelte
```

What that changed, beyond the URL:

- **`session.selectedHomeTab` stopped being writable state.** It was assigned by the nav rail
  and read by everything else — two writers for one fact. It is now
  `$derived(tabIndexForRoute(page.route?.id))`. `TAB_INDEX_*` survives only because preferences
  and the footer still speak in indices; `src/lib/routes.ts` is the single translation point.
- **`setContextText(tabIndex, text)` lost its guard.** The index argument existed because a
  hidden Material tab stayed mounted and could finish an async callback late. A route component
  is unmounted on navigation and its effects are cleaned up, so the callers now own the value
  for as long as they are on screen and clear it on the way out.
- **The rail's tabs became links.** Middle-click, the back button and a deep link into a screen
  work because the browser handles them, not because the component reimplemented them. A
  disabled tab keeps its `href` and reports state through `aria-disabled` — dropping the href
  would also drop it from the tab order.
- **Per-route code splitting.** Measured by recording what the browser actually fetches:

  | route | JS fetched |
  |---|---:|
  | `/my-addons` | 1870 KB |
  | `/options` | 825 KB |
  | `/account` | 778 KB |
  | `/news` | 779 KB |

  Reaching Options used to cost the same as My Addons, because ag-grid was in the one bundle
  everything imported. `e2e/code-splitting.e2e.ts` asserts this both ways — Options must not
  fetch the grid, My Addons must.

**Three traps, worth recording.** Under `router.type: 'hash'` the route lives in
`location.hash` and `page.url.pathname` is always `/`.

- `goto('/options')` resolves against the *pathname*, lands outside the app, and SvelteKit hands
  it to the browser as a real navigation — the app 404s. `goto` needs the same `#/...` form the
  docs prescribe for `<a href>`. Both go through one `href()` helper.
- Comparing `page.url.pathname` to a route silently matches nothing. The fix is
  `page.route.id`, which is SvelteKit's resolved route and needs no string handling. The Options
  screen rendered while its rail entry showed as unselected — the kind of half-working state
  that is easy to mistake for a CSS problem.
- **`resolve()` from `$app/paths` is not usable here**, and finding that out cost a reload loop.
  `svelte/no-navigation-without-resolve` flags every `goto()` and internal `<a href>` that does
  not go through it, and the rule is right in general: `resolve()` returns
  `base + (hash_routing ? '#' : '') + route`, which is hash-aware and also applies the base path.
  But with `paths.relative: true` and a `file://` document, `base` resolves to the absolute build
  directory:

  ```
  resolve('/my-addons') === '/home/…/renderer-svelte/build#/my-addons'
  ```

  `goto()` treats that as a path navigation, Electron reports `ERR_FILE_NOT_FOUND`, the window
  reloads `index.html`, and bootstrap redirects again. Six full renderer boots in twenty seconds.
  The rule is off in `eslint.config.js` with that measurement in the comment; `routes.ts` owns
  the one correct form.

  It is worth being precise about what went wrong here: switching to `resolve()` was a
  *correction* — the hand-rolled helper really was reimplementing the framework — that happened
  to be wrong for this deployment. The lesson is not "ignore the linter"; it is that a rule
  encoding a framework assumption has to be checked against the environment the app actually
  runs in, and `npm run build && npx playwright test` could not tell the difference because
  Playwright serves over `http://`, where `base` is empty and `resolve()` is correct.

### `runed`, at four sites and no more

The class-with-`$state` singleton pattern stayed; it is already idiomatic. What `runed` replaced
is the code that was reimplementing rxjs by hand.

| Site | Before | After |
|---|---|---|
| `ClientSelector` | `$effect` + `let cancelled = false` + teardown flipping it — a hand-rolled `switchMap` | `resource` over two sources |
| `AddonDetail` | four independent fetches sharing one `cancelled` flag, each writing a value *and* its own `fetching` boolean | three `resource`s; `loading` is the resource's |
| `AddonManageDialog` | one async chain with three `if (cancelled) return` checkpoints, plus a `hasError` flag set only by its catch | one `resource`; `hasError` is `resource.error !== undefined` |
| `MyAddonsPage` filter | hand-rolled `debounce`, with the input's `value` bound to the *debounced* string | `Debounced`; the input owns `filterText`, the grid reads the debounced value |
| `AddonSection` tokens | the same hand-rolled `debounce` | `useDebounce` |

The filter is the one where the swap fixed a latent bug rather than just shortening the code:
binding `value=` to the debounced string means the DOM value is reassigned 200 ms after every
keystroke, which is the standard setup for a caret that jumps to the end mid-word.
`src/lib/utils/misc.ts`'s `debounce` had no callers left afterwards and is gone.

One `resource` subtlety: it starts `loading` **false** when you give it an `initialValue`. The
changelog and description resources therefore take no initial value, so their spinners show
from the first frame the way the original `fetching = $state(true)` did.

### Splitting `session.svelte.ts`

Not a file-shuffling exercise — only the parts where moving the code removed some:

- **`adSpace`** was a `$state` kept current by an `onProviderChange` subscription calling a
  private `#updateAdSpace()`. It is a pure function of the provider list, and `addonProviders`
  already exposes a revision counter for `$derived` readers, so it is a `$derived` and the
  subscription is gone.
- **`theme`** moved to `src/lib/state/theme.svelte.ts`. The shell puts it on `<div class="app-root">`
  and Options → Application writes it; nothing about it is session state. `theme.set()` now owns
  both halves of what was a two-line "assign the field, then persist it" at the call site.

The three `Emitter` classes stayed. They carry occurrences, not state — the documented
counter-example to porting every `Subject` to a rune.

### Lint, and the check that was never run

`npm run lint` (`prettier --check . && eslint .`) had never been run against this tree. It
reported 39 errors and 59 unformatted files. Most were small — unused imports, an `_`-prefixed
callback parameter the config had no pattern for, three `any`s in the Wago provider — but two
categories are worth noting:

- **`svelte-ignore` with a reason.** The Svelte compiler accepts
  `<!-- svelte-ignore a11y_autofocus -- because … -->`; `eslint-plugin-svelte`'s
  `no-unused-svelte-ignore` parses everything after the code as *more* codes, so each word of
  the reason became an unknown ignore. The rationale moved to its own comment line.
- **`eslint-disable-next-line` in Svelte templates** covers exactly the next line, and both
  `no-at-html-tags` and `no-navigation-without-resolve` report on the *expression*, which is
  often several lines inside the element. Four disables were silently doing nothing.

The `{@html}` sites are all translation strings containing anchor markup, or markdown already
converted by the provider layer — the same content Angular passed to `[innerHTML]`. Two `Set`
instances flagged by `prefer-svelte-reactivity` are a listener registry and a local dedupe in a
pure function; both are disabled with the reason rather than converted, since neither is ever
read reactively.

`verify-boot.mjs` gained two assertions as a result of the reload loop: the renderer must boot
exactly once, and console errors are now counted only from `file://` sources. The second one
matters because the Overwolf ad `<webview>` loads third-party script that throws on its own
schedule, which was making the ow flavour fail intermittently on someone else's bug.

### Verification

`npm run lint` clean, 1365 files / 0 errors, 83 unit, 67 E2E, single-boot on both flavours.

---

## 13. Packaged AppImage: measured on the target machine

Everything before this was measured on bundles and a dev boot. This is the shipped artifact, on
the machine that will run it (Manjaro, Wayland, x64), against the same 198 addons and two WoW
installations.

### Building it

The renderer choice was a CLI flag (`--renderer=svelte`) and an env var, neither of which
survives an AppImage double-click or a desktop entry that a launcher has rewritten. So it is now
baked at build time: `app-env/inject-env.js` writes `AppEnv.renderer` from `BUILD_RENDERER`, and
`main.ts` reads flag → env → baked value in that order.

The build also gets its own identity, because it has to coexist with the installed release:

| | installed release | Svelte build |
|---|---|---|
| AppImage | `WowUp-CF-2.23.0.AppImage` | `WowUp-CF-Svelte-2.23.0.AppImage` |
| desktop name | WowUp-CF | WowUp-CF (Svelte) |
| `StartupWMClass` | `wowup-cf` | `wowup-cf-svelte` |
| userData | `~/.config/WowUpCf` | `~/.config/WowUpCfSvelte` |

`StartupWMClass` is what lets the desktop environment tell the two windows and tray icons apart;
without it they collapse into one entry. `npm run svelte:appimage` does the whole thing.

### The comparison that looked spectacular and meant nothing

Benchmarked against the installed AppImage, the first numbers were:

| metric | installed | Svelte | delta |
|---|---:|---:|---:|
| App ready (main process) | 787 ms | 174 ms | −77.9% |
| Renderer first app code | 1565 ms | 645 ms | −58.8% |
| Memory (PSS) | 715 MB | 606 MB | −15.2% |

**`App ready` is identical main-process code in both.** It cannot legitimately differ by 4.5×.
Two confounds, found by chasing that:

1. The installed release is **ow-electron 39.8.10 / Chromium 142**; this build is **Electron
   43.1.1 / Chromium 150**. Most of the gap is four Electron majors, not the framework.
2. Before that, each app ran against its own real profile — where the installed app has a
   **1.5 GB** Chromium cache and the new one had 524 KB. Both apps now run against a wiped,
   identically-seeded `--user-data-dir`, so nothing touches the real profile either.

That table is still what the user feels if they switch today. It is not a framework measurement.

### The comparison that means something

An Angular AppImage built from the same tree, same Electron 43, same packaging — differing only
in renderer. Five runs each, alternating, first discarded, medians:

| metric | Angular | Svelte | delta |
|---|---:|---:|---:|
| App ready (main) | 173 ms | 173 ms | **+0.0%** |
| Loading app URL (main) | 240 ms | 239 ms | **−0.4%** |
| Renderer first app code | 762 ms | 655 ms | −14.0% |
| Renderer locale loaded | 795 ms | 673 ms | −15.3% |
| Addon providers constructed | 762 ms | 678 ms | −11.0% |
| Memory (PSS, process tree) | 636 MB | 589 MB | −7.4% |

Re-measured after the defect round in §14. An earlier run of the same harness gave −16.9% on
renderer startup and −2.7% on memory; both builds changed between the two, so the run-to-run
movement is not a trend — only the head-to-head within a single run is comparable.

**The control almost lied here.** The Angular build shipped `{{CURSEFORGE_API_KEY}}`
un-substituted, so it 403'd on every CurseForge call while the Svelte build — once its own key
was fixed (§14) — did the real work. Left alone that would have credited Svelte for work the
control never performed. The Angular pipeline substitutes the key by rewriting a tracked
environment file (`gulpfile-ow.js`); doing that, rebuilding, and restoring the file is what the
numbers above are measured against. **A control is only a control for the variables you thought
to equalise**, and "both builds talk to the same APIs" was not on that list until it was.

The first two rows are the control: identical code, and they came out identical. That is what
makes the rest readable.

**Renderer startup is ~14% faster. That is the honest headline, and it is a lot smaller than the
bundle numbers in §4 would suggest** (JS in the renderer: 4.4 MB across 3 files → 2.5 MB across
47). Parsing less JavaScript is real but it is one term in a sum that also includes Electron
init, window creation, the preload bridge and IPC round-trips — none of which the migration
touched. A 43% bundle reduction buying a 14% startup improvement is the correct shape of result,
and anyone quoting the bundle number as if it were the user-visible number is overselling.

Memory moves 7.4%. Chromium dominates and both renderers drive the same ag-grid over the same
198 rows, so most of the footprint is common to both.

### The splash art costs nothing, measured

The 4K key art restored in §14 was the obvious suspect for the ~13 ms that renderer startup moved
between runs, and the obvious optimisation was to defer or lazy-load it. Both were wrong. Built
with the art removed and A/B'd against the shipped build on the same harness:

| metric | no art | with art | delta |
|---|---:|---:|---:|
| Renderer first app code | 658 ms | 656 ms | −0.2% |
| Renderer locale loaded | 675 ms | 675 ms | −0.1% |
| Memory (PSS, tree) | 589 MB | 589 MB | −0.1% |

A CSS `background-image` on a `<div>` is fetched off the critical path and rasterised on the
compositor thread; it cannot block script execution, and 3840×2160 at 352 KB does not change the
process footprint measurably either. Deferring it would have added complexity for nothing — and
since the art *is* the splash, lazy-loading it would have made the thing it was meant to improve
visibly worse. **The cheap experiment that kills an optimisation is worth more than the
optimisation.**

### Size

| artifact | size |
|---|---:|
| installed release (ow-electron 39) | 121 MB |
| Angular control (Electron 43) | 131 MB |
| Svelte (Electron 43) | 130 MB |

**1 MB apart.** Electron is ~120 MB of that, so a 1.9 MB reduction in renderer JS is almost
invisible at the artifact level. Worth stating plainly because "we halved the bundle" invites
the assumption that the download halves; it does not move at all.

One packaging defect found here: the first Svelte image shipped **9.1 MB of Vite sourcemaps**
against 2.5 MB of actual JS, which the Angular build does not emit. Excluded from the image
(kept on disk); without that the size comparison would have been wrong in the other direction.

### The bug the packaged build found that nothing else did

First real launch on the target machine: roughly twenty identical
*"An error occurred checking for updates from Curse, please try again later."* toasts stacked
down the middle of the window, covering the grid entirely.

Two separate things, and only one of them is a bug.

**The error was transient.** The key and the API were healthy when checked — a batch request for
all 187 CurseForge addons in the user's database returned 187 mods in 0.59s. The probable cause
is self-inflicted: the benchmark above launched the app twenty-six times in about fifteen
minutes, each run syncing those 187 addons through the same API key, which is enough to trip
rate limiting. `Curse_main`'s circuit breaker then holds open for 60s.

**The presentation was the bug, and it was mine.** `MatSnackBar` shows exactly one snack bar at
a time — opening another dismisses the current one. The port kept an array of toasts and
rendered every entry:

```svelte
{#each snackbar.toasts as toast (toast.id)}
```

That is indistinguishable from correct for the one-off success messages it was built against
("Copied", "Pasted"). It is catastrophic in the failure case, because failures are not one-off:
`syncStandardProviders` emits a sync error per provider *per installation*, `syncBatchProviders`
adds its own, and the auto-update interval runs the whole thing again. One provider outage times
two WoW installations is a burst, and the burst is what the user saw.

The store now holds a single message, replacing on `show()` and clearing the outgoing timer so a
dismissed toast cannot cut short the one that replaced it.

**Why no existing test caught it.** Every snackbar assertion in the suite showed one message and
checked that it appeared. Nothing ever raised two. The regression tests added here do the
opposite: six unit tests on the store's replace/timer semantics, and an E2E that clicks a
snackbar trigger five times and asserts `toHaveCount(1)` on the rendered elements — counting DOM
nodes rather than store entries, so it holds regardless of how the store is shaped later. That
E2E was checked against the old implementation and reports `Received: 5`.

The general lesson is the one from §10 and §11 again, in a third form: this port's defects are
overwhelmingly in the *failure* paths, because the happy path is what gets exercised while
building. A component that is correct for one item and wrong for twenty will look finished right
up until the day something goes wrong.

### Method notes

`scripts/benchmark-appimages.mjs`. Milestones are log lines that exist verbatim in both ports;
main-process lines are self-timing (`App ready: Nms`), renderer lines are wall-clock and are
converted to ms-since-start using the `App ready` line, which carries both. Memory is **PSS, not
RSS** — summing RSS across an Electron process tree counts every shared page once per process
and reported a nonsensical 1.5 GB for an idle app.

---

## 14. The defect the audit could not have found

Reported as: *"the status seems to be wrong on addons. it says 3 updates and shows it on angular but
not on ours."* Both builds showed the same **3 updates** badge; Angular listed those three at the
top of My Addons with Update buttons, the port buried them in an alphabetical list of 198.

### Ruling things out with data, not reasoning

The two builds keep separate profiles (`~/.config/WowUpCf` vs `WowUpCfSvelte`), so the first
question was whether they even disagreed about the data. Running the ported `needsUpdate()` over
both `addons.json` files directly:

```
=== WowUpCf ===        addons: 198  needsUpdate: 3
=== WowUpCfSvelte ===  addons: 198  needsUpdate: 3
    Raider.IO …               v202607290600 -> v202607300600
    Cooldown Manager Centered  …-v4.3.1.zip -> …-v4.3.2.zip
    Coolinator                          112 -> 113
```

Identical. So `needsUpdate`, `sortOrder` and the status cell were all fine, and the badge was fine —
it counts rows independently. Only the **order** was wrong. That halved the search space before a
line of component code was read.

### Two defects, and the one that mattered was invisible

`AddonStatusSortOrder` is declared `Warning, Install, Update, UpToDate, Ignored, Unknown`, so
ascending is not an arbitrary default — it is what puts everything needing attention above the fold.
Angular applies it imperatively in a lifecycle hook:

```ts
public onGridReady(params: GridReadyEvent): void {
  this.gridColumnApi.applyColumnState({
    state: [{ colId: "sortOrder", sort: "asc" }],
    defaultState: { sort: null },
  });
  this.loadSortOrder().catch(…);   // saved order, if any, overlaid after
}
```

The port carried over `loadSortOrder` and **not the four lines above it**. With no saved sort the
grid rendered in load order.

The second defect was in `compareElement`, which had lost its tie-break:

```ts
// Angular — ties fall back to the addon name
if (nodeA.data[prop] === nodeB.data[prop]) {
  return nodeA.data.canonicalName > nodeB.data.canonicalName ? 1 : -1;
}
// the port
if (a === b) return 0;
```

`return 0` looks harmless because ag-grid's sort is stable and rows arrive alphabetical — so
**ascending looks correct and only descending exposes it**, since a stable sort does not reverse
ties. Notably the Get Addons port kept this fallback; only My Addons lost it. A defect present in
one of two near-identical files is exactly what a per-component audit is blind to: both files were
reviewed, and each looked self-consistent.

### Why no lens in §11 could reach this

The §11 lenses were i18n keys, IPC channels, template bindings and emitters — every one of them an
axis on which a **name** is either present or absent. This defect has no name. It is a call that
was made in one file and not the other, whose absence changes nothing structural: the column exists,
the comparator exists, the persisted preference is read, the grid sorts. `svelte-check`, eslint, 75
unit tests and 55 E2E tests all passed over it, and so did a component-by-component read, because
nothing is *missing* — the default is simply never applied.

> Generalised: **imperative setup inside a framework lifecycle hook is the highest-risk code in any
> migration.** `ngOnInit`/`onGridReady`/`ngAfterViewInit` bodies do not appear in the template, do
> not appear in the state model, and have no counterpart to diff against in the target framework —
> the porter reads the hook, ports the parts that look like logic, and drops the parts that look
> like configuration. §11 found three whole subsystems this way (menu, tray, auto-update job); this
> is the same failure at one-statement scale, and it is harder to see for being smaller.

### The persisted format, which had quietly diverged

Angular's `onSortChanged` persists **one entry per column**, unsorted ones carrying `sort: null`;
its restore treats anything shorter than 2 entries as legacy and resets it. The port filtered to
sorted columns only, writing one entry. That is not cosmetic — `app/main.ts` supports
`--renderer=angular|svelte` **over a single profile**, so the two renderers read each other's
preferences, and Angular would silently discard anything Svelte wrote. Restoring the format also
fixed a bug the shorter shape would have caused on its own: applying a one-column saved sort over
the new default would stack into a two-column sort instead of replacing it, hence `defaultState`.

One further trap, avoided: applying the default synchronously and overlaying the saved order after
makes ag-grid emit `sortChanged` for the *default*, which `onSortChanged` would persist — over the
user's real saved order, while the read of it was still in flight. Read first, apply once.

### The tests

Five E2E cases, all asserting **rendered row order** — read from `row-index`, not DOM order, since
ag-grid positions rows absolutely and recycles their elements:

| test | before |
|---|---|
| updates sort to the top with no saved sort order | ❌ `DBM, Details, WeakAuras` |
| a saved sort on another column wins over the default | ✅ |
| a saved sort replaces the default rather than stacking | ✅ |
| a legacy saved sort order is discarded for the default | ✅ |
| same status falls back to name order | ❌ `Alpha, DBM, Zulu` |

The two that failed are the two defects; the three that passed are the regressions the fix could
have introduced. This is the discipline §10 arrived at the hard way — **assert what the user sees,
not the mechanism being changed**. An assertion on "is `applyColumnState` called" would have been
green before and after the real fix.

Verification after: 1367 files / 0 errors, 90 unit, 81 E2E, clean packaged boot.

---

## 15. Reproducing

```bash
cd wowup-electron/renderer-svelte
npm install
npm run check
npx vitest run
npx playwright install chromium --only-shell
npx playwright test

npm run build
node ../migration/baseline/attribute-emitted.mjs build
node ../migration/baseline/attribute-emitted.mjs ../dist
```
