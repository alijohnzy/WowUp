// Run with `npm run test:scripts`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildUpdaterManifest, type ManifestOptions } from "./tauri-updater-manifest.mts";

const ASSETS = [
  { name: "WowUp-CF-Tauri_2.25.4.18_amd64.AppImage", signature: "sig-appimage\n" },
  { name: "WowUp-CF-Tauri_2.25.4.18_amd64.deb", signature: "sig-deb" },
  { name: "WowUp-CF-Tauri_2.25.4.18_x64-setup.exe", signature: "sig-nsis" },
  // Released, but never an update target.
  { name: "WowUp-CF-Tauri-2.25.4.18-portable.zip", signature: "" },
];

function opts(overrides: Partial<ManifestOptions> = {}): ManifestOptions {
  return {
    assets: ASSETS,
    repo: "alijohnzy/WowUp",
    tag: "tauri-v2.25.4-18",
    version: "2.25.4+18",
    pubDate: "2026-11-07T00:00:00Z",
    ...overrides,
  };
}

describe("buildUpdaterManifest", () => {
  it("gives each installer its own key and a generic fallback per OS", () => {
    const m = buildUpdaterManifest(opts());
    assert.deepEqual(Object.keys(m.platforms).sort(), [
      "linux-x86_64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "windows-x86_64",
      "windows-x86_64-nsis",
    ]);
    assert.equal(m.platforms["linux-x86_64"], m.platforms["linux-x86_64-appimage"]);
    assert.equal(m.platforms["windows-x86_64"], m.platforms["windows-x86_64-nsis"]);
    assert.equal(m.platforms["linux-x86_64-deb"].signature, "sig-deb");
    assert.equal(m.platforms["linux-x86_64-appimage"].signature, "sig-appimage");
  });

  it("points at the release's download URLs and page", () => {
    const m = buildUpdaterManifest(opts());
    assert.equal(
      m.platforms["windows-x86_64-nsis"].url,
      "https://github.com/alijohnzy/WowUp/releases/download/tauri-v2.25.4-18/WowUp-CF-Tauri_2.25.4.18_x64-setup.exe",
    );
    assert.equal(m.releaseUrl, "https://github.com/alijohnzy/WowUp/releases/tag/tauri-v2.25.4-18");
    assert.equal(m.version, "2.25.4+18");
    assert.equal(m.pub_date, "2026-11-07T00:00:00Z");
  });

  it("refuses a version without a CI build number, which clients could not order", () => {
    assert.throws(() => buildUpdaterManifest(opts({ version: "2.25.4" })), /build number/);
  });

  it("refuses an updatable asset with no signature", () => {
    const assets = [{ name: "WowUp-CF-Tauri_2.25.4.18_amd64.deb", signature: "  " }];
    assert.throws(() => buildUpdaterManifest(opts({ assets })), /empty signature/);
  });

  it("refuses two files for one platform", () => {
    const assets = [...ASSETS, { name: "Other_2.25.4.18_amd64.deb", signature: "x" }];
    assert.throws(() => buildUpdaterManifest(opts({ assets })), /linux-x86_64-deb/);
  });

  it("refuses a feed missing a platform installs depend on", () => {
    const linuxOnly = ASSETS.filter((a) => !a.name.endsWith(".exe"));
    const require = ["linux-x86_64-appimage", "linux-x86_64-deb", "windows-x86_64-nsis"];
    assert.throws(() => buildUpdaterManifest(opts({ assets: linuxOnly, require })), /windows-x86_64-nsis/);
    assert.doesNotThrow(() => buildUpdaterManifest(opts({ require })));
  });

  it("refuses a release with nothing to update to", () => {
    const assets = [{ name: "WowUp-CF-Tauri-2.25.4.18-portable.zip", signature: "" }];
    assert.throws(() => buildUpdaterManifest(opts({ assets })), /No updatable assets/);
  });
});
