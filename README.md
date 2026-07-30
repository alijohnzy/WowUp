<p align="center">
  <img src="https://cdn.wowup.io/site/assets/icons/android-chrome-512x512.png" width="200" />
</p>

# WowUp Client Repository

[![WowUp on Discord](https://img.shields.io/static/v1?label=Discord&message=WowUp&color=7289DA)](https://discord.gg/rk4F5aD)
[![WowUp on Patreon](https://img.shields.io/static/v1?label=Patreon&message=WowUp&color=f96854)](https://www.patreon.com/jliddev)

This is the repository for our [WowUp](https://wowup.io) client with [CurseForge](https://curseforge.com) support for Windows, Mac, and Linux.

> ### ⚠️ `migrate/svelte5` — experimental branch, not for production
>
> This branch is **test work for the [`svelte5-migration-analyst`](https://github.com/gageracer/svelte5-migration-analyst) skill**, not a proposal to migrate WowUp. It exists to put the skill's
> assessment through the one check an assessment cannot give itself: carry the migration out in
> full, ship it, measure it, and score the predictions against what actually happened.
>
> **The skill's verdict was "do not migrate", and the results below support it.** The migration
> went ahead anyway so the verdict could be tested rather than trusted.
>
> See [`wowup-electron/migration/`](wowup-electron/migration/) for the assessment, the phase
> results and the full write-up.

---

## What is on this branch

The Angular 17 renderer was ported to Svelte 5 + SvelteKit 2 in full — 49 components, 25,494 →
19,235 LOC — and lives alongside the original in [`wowup-electron/renderer-svelte/`](wowup-electron/renderer-svelte/).
Nothing in `src/` (Angular) was removed; the Electron main process picks a renderer at build time,
so both are buildable from one tree.

```bash
cd wowup-electron
npm run svelte:start        # dev: Vite + Electron
npm run svelte:appimage     # packaged AppImage with the Svelte renderer
npm start                   # the Angular original, unchanged
```

## Results

Measured on Manjaro x64, packaged AppImages built from this tree on the same Electron 43, same
198 addons, same seeded profile. Five runs each, alternating, first discarded, medians. The two
main-process rows are **identical code in both builds** — they are the control that says the runs
were comparable.

| metric | Angular | Svelte | delta |
|---|---:|---:|---:|
| App ready (main process) | 173 ms | 173 ms | **+0.0%** ← control |
| Loading app URL (main process) | 240 ms | 239 ms | **−0.4%** ← control |
| Renderer first app code | 762 ms | 655 ms | **−14.0%** |
| Renderer locale loaded | 795 ms | 673 ms | −15.3% |
| Addon providers constructed | 762 ms | 678 ms | −11.0% |
| Memory (PSS, process tree) | 636 MB | 589 MB | −7.4% |
| AppImage size | 131 MB | 130 MB | −0.8% |
| Renderer JS shipped | 4.4 MB / 3 files | 2.5 MB / 47 files | **−43%** |

**A 43% smaller renderer bundle buys ~14% of renderer startup — about 107 ms, once, on an app
that stays open for hours.** The AppImage barely moves because Electron is ~120 MB of it. This is
the number that matters and it is much smaller than the bundle figure implies: parsing less
JavaScript is one term in a sum that also includes Electron init, window creation and IPC, none of
which a framework migration touches.

### Dependencies removed

`@angular/*` (11 packages), `@angular/material` + `cdk`, `rxjs` (75 files → 0), `zone.js`,
`@ngx-translate/*`, `ng-gallery`, `@angular/forms`. `ag-grid` stayed — it is a genuine widget, not
a framework workaround.

Most Angular Material usage was replaced by the platform rather than by another library:
`<mat-dialog>` → `<dialog showModal()>`, `<mat-menu>` → a positioned div, `<mat-slide-toggle>` → a
styled checkbox. **697 KB → 72 KB of `bits-ui`.**

### How the assessment scored

Nine predictions: 3 right, 4 partly right, 2 badly wrong. It under-predicted the bundle saving by
5× (it priced Angular Material as a library swap), and the axis it explicitly flagged as
*unmeasured* — bootstrap execution, as opposed to parse — turned out to be where the real win was.

**The verdict survived being wrong about the numbers**, because it never rested on them: this
renderer loads from local disk, so bundle size is disk and parse, not transfer. The same migration
on a web deployment would have flipped it, and the assessment said so.

### What this cost that the plan did not model

- **47.8 KB of stylesheets** nobody counted — the app's entire appearance lived in four SCSS files
  and the HTML shell, none of which a component-by-component plan mentions.
- **20 defects** found by a systematic audit *after* the port passed every test, via four
  mechanical lenses (i18n keys, IPC channels, template event bindings, dead emitters).
- **Three whole subsystems missing** — native menu bar, system tray, background auto-update — that
  no lens caught, because a dropped call has no key, no channel and no handler.
- **Defects cluster in failure paths.** The port's snackbar rendered every queued message instead
  of one; correct for the one-off successes it was built against, catastrophic on a provider
  outage.

## Reading order

| file | |
|---|---|
| [`migration/svelte5-assessment.md`](wowup-electron/migration/svelte5-assessment.md) | the original assessment and its "do not migrate" verdict |
| [`migration/phase1-results.md`](wowup-electron/migration/phase1-results.md) | pilot slice, predictions vs first measurements |
| [`migration/full-migration-results.md`](wowup-electron/migration/full-migration-results.md) | the full write-up: bundles, benchmarks, every defect and why it was missed |

## Status

Functional and packaged, with 90 unit and 76 end-to-end tests. **Not production quality** — it was
built to be measured, not shipped, and the write-up above is candid about what four rounds of
visual defects and a post-hoc audit had to fix. Treat it as evidence about the migration, not as a
replacement for the Angular client.

---

## Upstream README

## WowUp

![image](https://user-images.githubusercontent.com/20467484/150164985-673d02da-e7ec-42aa-b77d-655c8e3117ff.png)

WowUp is the community centered World of Warcraft addon updater. We attempt to bring the addon community together in an easy to use updater application. We have an ever growing list of supported features.

- Support for all major addon sources
- Discover or find new addons across addon sources
- Handle all your different World of Warcraft clients
- Auto updates
- [Companion addon](https://github.com/WowUp/WowUp.Addon)

## Installing

### Latest Releases

The latest WowUp release is always available on our website [wowup.io](https://wowup.io)

### Beta Releases

If you feel like helping us test the latest and greatest changes beta builds are available on [GitHub](https://github.com/WowUp/WowUp/releases)

### Community Support Alternatives

#### [WinGet](https://learn.microsoft.com/en-us/windows/package-manager/winget/)

Ships with Windows 10 and 11.  You can install WowUp With Wago using:

```cmd
winget install wowup.wowup
```

Or Wowup with CurseForge with:

```cmd
winget install wowup.cf
```

#### [Chocolatey](https://chocolatey.org)

You can also install the latest version via Chocolatey package manager:

```cmd
choco install wowup
```

## Contributing

We welcome any and all contributions from translations to feature pull requests.

Please read our [contribution guide](https://github.com/WowUp/WowUp/blob/master/CONTRIBUTING.md) to get started.

## Feedback

If you have a question, comment, or request we have several ways you can communicate them.

- Create a [bug or feature request](https://github.com/WowUp/WowUp/issues)
- Contact us on [Discord](https://discord.gg/rk4F5aD)

## Related Projects

We have a couple companion projects that are related to WowUp

- [Companion Addon](https://github.com/WowUp/WowUp.Addon)
- [App Updater](https://github.com/WowUp/WowUpUpdater) (Deprecated)

## Code of Conduct

Please read and understand our [Code of Coduct](https://github.com/WowUp/WowUp/blob/master/CODE_OF_CONDUCT.md) when submitting a bug or feature request here or on Discord.

## License

Copyright (c) WowUp LLC. All rights reserved.

Licensed under the [GNU General Public License v3.0](https://github.com/WowUp/WowUp/blob/master/LICENSE) license.
