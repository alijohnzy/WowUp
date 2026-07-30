# Phase 1 pilot — measured results vs. the assessment's predictions

Date: 2026-07-28 · Branch `migrate/svelte5`
Companion to [`svelte5-assessment.md`](./svelte5-assessment.md). Per the playbook, Phase 1 exists
to replace that report's projections with measurements. This is that replacement.

Stack as built: **svelte 5.56.8 / @sveltejs/kit 2.70.1 / vite 8.1.5 / bits-ui 2.18.1** —
the same versions the skill's references were verified against.

---

## 1. Scorecard

| # | Prediction (2026-07-28, pre-pilot) | Measured | Verdict |
|---|---|---|---|
| 1 | Svelte runtime ~45–55 KB raw / ~14 KB gzip | **51.1 KB raw / ~14.9 KB gzip** | ✅ **hit** |
| 2 | Empty Kit floor ~28.3 KB gzip *(skill reference)* | **26.9 KB gzip** / 71.6 KB raw | ✅ within 5% |
| 3 | Kit router ~10.4 KB gzip *(skill reference)* | **7.8 KB gzip** / 26.8 KB raw | ✅ 25% better |
| 4 | Net framework saving ~390 KB raw | **366 KB raw** (443.9 Angular − 77.9 Svelte+Kit) | ✅ within 6% |
| 5 | i18n: swap `@ngx-translate` for paraglide/svelte-i18n, "4–7 person-days" | Kept `@messageformat/core`; **85-line module** replaced 3 packages. Locale chunk **30.2 KB raw** vs Angular's 36.0 KB asset | ⚠️ **easier and smaller than predicted** |
| 6 | Material → bits-ui is "a design-system reimplementation" | Tabs: **8.7 KB** + 15.4 KB shared deps, vs Material 585 + CDK 112.4 KB | ⚠️ directionally right, **1 of 26 modules** exercised — do not extrapolate |
| 7 | ag-grid "no official Svelte adapter" | Confirmed. Not exercised — pilot is deliberately grid-free | — untested |
| 8 | Effort band 60–110 person-days | **Not recalibrated.** See §5 | ⚠️ **still a projection** |

**The bundle predictions held. The effort prediction is still unvalidated, and the two largest
risk items — ag-grid and the other 25 Material modules — were not touched by this pilot.**

---

## 2. What was built

Pilot slice: the **Options tab** shell plus two of its sections.

| Angular original | LOC | Svelte port | LOC |
|---|---:|---|---:|
| `pages/options/options.component.{ts,html,scss}` | 222 | `routes/options/+page.svelte` | 132 |
| `components/options/about/about.component.*` | 216 | `lib/components/options/About.svelte` | 153 |
| `components/options/options-debug-section/*` | 118 | `lib/components/options/DebugSection.svelte` | 123 |
| `services/wowup/patch-notes.service.ts` | 750 | `lib/data/changelogs.{ts,json}` | 21 + data |
| `directives/external-link.directive.ts` | 18 | `lib/attachments/external-link.ts` | 32 |
| — | — | `lib/i18n.svelte.ts` *(replaces 3 packages)* | 85 |
| — | — | `lib/ipc.ts` *(replaces 367-LOC ElectronService)* | 71 |
| — | — | `lib/state/session.svelte.ts` *(slice of a 17-subject service)* | 29 |
| **Components only** | **556** | **Components only** | **408** |

Components came out **~27% smaller**. The reusable infrastructure (i18n + IPC + state = 185 LOC)
is one-time cost that the remaining 46 components amortise against.

`patch-notes.service.ts` is the standout: 750 LOC of `@Injectable` wrapping a hardcoded array of
HTML strings. It is data, not behaviour — extracted to `changelogs.json` (38 entries) and a
21-line module. That kind of finding is the real argument for the migration and it does not
show up in any bundle metric.

---

## 3. Bundle [measured]

`npm run build` in `renderer-svelte/`, attribution by emitted sourcemap spans.

### Framework floor — the clean comparison

| | Angular | Svelte + Kit | delta |
|---|---:|---:|---:|
| Framework runtime | **443.9 KB raw** | **77.9 KB raw** | **−366.0 KB (−82%)** |

Angular: core 131.4 + router 70.4 + zone.js 69.5 + animations 62.5 + common 51.0 + forms 31.7 +
platform-browser 14.0 + reflect-metadata 13.4.
Svelte: svelte 51.1 + @sveltejs/kit 26.8.

### Pilot bundle composition

| package | raw KB | % |
|---|---:|---:|
| **@messageformat/core** | **71.8** | **11.2%** |
| svelte | 51.1 | 8.0% |
| (app code) | 49.2 | 7.7% |
| @sveltejs/kit | 26.8 | 4.2% |
| bits-ui | 8.7 | 1.4% |
| svelte-toolbelt / runed / inline-style-parser | 9.2 | 1.4% |

**The i18n formatter is now the single largest dependency — bigger than the entire UI framework.**
It was 74.3 KB in the Angular bundle and 71.8 KB here: a *kept* dependency, unaffected by the
migration, that now dominates. Once Angular is gone, the next optimisation target is not the
framework — it is compiling ICU messages at build time instead of shipping the compiler.

### Startup payload

| | raw | gzip | brotli |
|---|---:|---:|---:|
| Pilot startup JS (11 chunks + `en` locale) | 249.2 KB | ~79.4 KB | — |
| — excluding locale | 219.0 KB | 69.1 KB | 60.2 KB |
| CSS | 1.9 KB | 0.8 KB | — |

The 12 other locales are separate lazy chunks (423.3 KB raw total, never loaded together).
Angular's CSS for the whole app is 720 KB raw; the pilot's is 1.9 KB — but that is 3 components
against 49, and the bulk of Angular's CSS is Material/MDC + ag-grid theming.

---

## 4. Parse + compile [measured]

Median of 7 fresh processes.

| | size | lazy (real path) | eager (`--no-lazy`) |
|---|---:|---:|---:|
| Angular, whole app | 4362 KB | **42 ms** | 138 ms |
| Svelte pilot, startup | 249.2 KB | **6.3 ms** | 15.3 ms |

**These are not comparable and should not be quoted as a speedup** — 3 components against 49, and
different V8 entry points (`vm.Script` for Angular's IIFE bundle, `vm.SourceTextModule` for
Svelte's ESM chunks). What survives the caveats: the assessment's core claim that startup parse
cost is a handful of milliseconds either way, and that this is not where the user's time goes.

---

## 5. Effort — deliberately NOT recalibrated

The playbook says Phase 1 should replace the effort heuristic with measured throughput. **I am not
doing that, because I cannot measure it honestly.** An agent porting 3 components in one session is
not a proxy for a person-day, and treating it as one would reproduce exactly the failure this skill
exists to prevent.

What the pilot does establish:

- The **patterns** the remaining 46 components copy are now fixed and working (state module, IPC
  wrapper, i18n, attachments, bits-ui usage).
- The **infrastructure** cost (185 LOC) is paid once.
- Components shrink **~27%** by LOC.
- **Nothing was learned about the hard 40%**: ag-grid and 25 unexercised Material modules.

The 60–110 person-day band from the assessment stands unchanged. It should be recalibrated by a
human porting a grid-bearing component — `my-addons` (1,945 LOC) is the honest next test.

---

## 6. Behaviour verified [measured]

5 Playwright tests, all green (`renderer-svelte/e2e/options.e2e.ts`):

```
✓ renders the vertical tab rail with translated labels
✓ About tab shows the app version fetched over IPC
✓ external links open in the OS browser instead of navigating the renderer
✓ Debug tab fires the log-folder IPC channel
✓ tab rail is keyboard navigable
```

For contrast, the Angular tree's entire E2E suite is one file asserting `app-home h1` reads
*"App works !"* on Spectron (archived 2022) — it cannot run against Electron 43.

### Two defects found and fixed in the new code

Per the playbook: fix forward, never touch `original/`, record it.

1. **`ExternalLinkDirective` is dead code.** Its `@HostListener` body is entirely commented out, so
   `<a appExternalLink href="https://…">` lets the renderer navigate away from the app — and the
   main process only intercepts `will-navigate` for the wago webview, not the app window. The
   attachment now calls `shell.openExternal` and prevents default. Covered by test 3.
2. **The tab rail had no tab semantics.** Material's `<mat-action-list>` of buttons driving an index
   is not a tablist; there was no `role="tab"`, no roving focus, no arrow-key navigation. bits-ui
   supplies all three. Covered by test 5.

---

## 7. What this pilot did not test

Stated plainly, because the scorecard above is otherwise easy to over-read:

- **ag-grid** — 980.4 KB raw, both primary screens, the single largest migration risk. Untouched.
- **25 of 26 Angular Material modules** — only Tabs was exercised. Dialogs, selects, menus,
  form-fields, tooltips, expansion panels, trees and snackbars are all unbuilt.
- **The 152 `BehaviorSubject` state layer** — the pilot's state module covers 5 fields. The addon
  sync pipelines are real RxJS stream algebra and are the hard part.
- **The 11 renderer files importing Node builtins** — none are in this slice.
- **Electron packaging** — the Svelte renderer builds to `renderer-svelte/build/` but is not yet
  wired into `app/main.ts` or electron-builder.
- **The other 46 components.**

---

## 8. Notes on the skill itself

Recorded since evaluating the skill was half the point of this exercise.

**Wrong, and would have produced a misleading report:**

1. **`attribute.mjs` per-package attribution is unsound.** It weights packages by original
   `sourcesContent` length rather than emitted bytes, so tree-shaken packages are credited with
   bytes they never ship. Measured on FontAwesome: attributed **547 KB**, actually ships **20.2 KB**
   — a 26× error, against a documented ±15% tolerance. Because shares are normalized, every other
   package is understated to compensate; it put `@angular/core` at 504 KB when the emitted figure is
   131.4 KB. Replaced with `migration/baseline/attribute-emitted.mjs`, which decodes the sourcemap
   VLQ and agrees with an independent count to 2.5%.
2. **`analyze.mjs` cannot see Angular components.** Its detector looks for JSX inside the `.ts`
   file, so separate-template components are invisible. It reported **12 components; there are 49**,
   and its effort band was low by ~4×.
3. **`dep-map.json` marks axios as eliminable → `fetch`.** Here it is transitive via `curseforge-v2`
   and imported nowhere in app code; a UI migration cannot remove it.

**Missing:**

4. **No Electron awareness anywhere.** The skill's entire value model is network transfer size and
   Lighthouse. For a desktop app loading off local disk, both are inapplicable, and nothing in the
   skill says so. This is the single biggest gap — it would happily recommend a migration on the
   strength of a metric that does not exist for the target.
5. **The MCP autofixer never ran.** The skill calls it "the quality gate for every component" but
   the server is not registered by default, and registering it mid-session does not load its tools.
   Every component here was written against `references/svelte5-idioms.md` and verified only by
   `svelte-check` (0 errors) and behavioural tests. The idioms doc proved accurate, but the gate the
   skill specifies was not available.
6. **No guidance on `sv create` in non-interactive use.** Its `vitest` add-on cannot express its
   own multi-select default via flags (`usages:unit+usages:component` is rejected as conflicting),
   so scaffolding blocks on a prompt.

**Right:**

7. The floor measurements in `measurement.md` (28.3 KB gzip empty Kit, ~14 KB svelte runtime) are
   accurate — within 5% of what this machine built.
8. `references/svelte5-idioms.md` is current and correct: runes, attachments over actions,
   `{@render}`, `$props()`, class-based state modules all matched svelte 5.56.8 behaviour.
9. The insistence on provenance tags and on "do not migrate" being a real verdict is what caught
   items 1–4 above. The methodology is sound; the tooling under it is not.

---

## 9. Reproducing

```bash
cd wowup-electron/renderer-svelte
npm install
npm run build
npx playwright install chromium --only-shell
npx playwright test

# bundle attribution (both apps)
node ../migration/baseline/attribute-emitted.mjs build
node ../migration/baseline/attribute-emitted.mjs ../dist
```
