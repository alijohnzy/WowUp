// Builds the `latest.json` that tauri-plugin-updater reads (src-tauri/src/updater.rs).
//
// The plugin looks a running copy up by `{os}-{arch}-{installer}` first, then `{os}-{arch}`,
// so each installer gets its specific key and the generic key points at the format that
// covers "anything else" on that OS. The Windows portable zip has no installer marker and so
// reads the generic `windows-x86_64` entry — only for its version and `releaseUrl`, since it
// is never installed over (it is told where to download instead).

export interface SignedAsset {
  /** File name exactly as uploaded to the release. */
  name: string;
  /** Contents of the `.sig` file `tauri signer sign` wrote next to it. */
  signature: string;
}

export interface ManifestOptions {
  assets: SignedAsset[];
  /** `owner/repo` the release lives in. */
  repo: string;
  /** Release tag the assets are attached to. */
  tag: string;
  /** App version, with the CI build number: `2.25.4+18`. */
  version: string;
  notes?: string;
  /** RFC 3339. */
  pubDate: string;
  /**
   * Platform keys that must be present. The feed has one version, so publishing it without
   * an entry some installs read (a Windows build that failed) leaves those installs with an
   * error on every check.
   */
  require?: string[];
}

export interface PlatformEntry {
  signature: string;
  url: string;
}

export interface UpdaterManifest {
  version: string;
  notes: string;
  pub_date: string;
  /** Not part of Tauri's format; read by updater.rs for copies that update by hand. */
  releaseUrl: string;
  platforms: Record<string, PlatformEntry>;
}

const FORMATS: Array<{ pattern: RegExp; os: string; keys: (arch: string) => string[] }> = [
  { pattern: /\.AppImage$/, os: "linux", keys: (a) => [`linux-${a}-appimage`, `linux-${a}`] },
  { pattern: /\.deb$/, os: "linux", keys: (a) => [`linux-${a}-deb`] },
  { pattern: /-setup\.exe$/, os: "windows", keys: (a) => [`windows-${a}-nsis`, `windows-${a}`] },
];

/** The bundler names files `_amd64` (Linux) and `_x64` (Windows); the updater says `x86_64`. */
function archOf(name: string): string {
  if (/[_-](amd64|x64|x86_64)[_.-]/.test(name)) return "x86_64";
  if (/[_-](arm64|aarch64)[_.-]/.test(name)) return "aarch64";
  throw new Error(`Cannot tell the architecture of ${name}`);
}

/** Only a CI build number makes builds of one version comparable (see updater.rs). */
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?\+\d+$/;

export function buildUpdaterManifest(opts: ManifestOptions): UpdaterManifest {
  if (!VERSION.test(opts.version)) {
    throw new Error(`Version ${opts.version} has no CI build number (expected e.g. 2.25.4+18)`);
  }

  const base = `https://github.com/${opts.repo}/releases`;
  const platforms: Record<string, PlatformEntry> = {};

  for (const asset of opts.assets) {
    const format = FORMATS.find((f) => f.pattern.test(asset.name));
    if (!format) continue;

    const signature = asset.signature.trim();
    if (!signature) throw new Error(`${asset.name} has an empty signature`);

    const entry = {
      signature,
      url: `${base}/download/${encodeURIComponent(opts.tag)}/${encodeURIComponent(asset.name)}`,
    };
    for (const key of format.keys(archOf(asset.name))) {
      if (platforms[key]) throw new Error(`Two assets claim ${key}: ${asset.name} and ${platforms[key].url}`);
      platforms[key] = entry;
    }
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error("No updatable assets (AppImage, deb, NSIS installer) were given");
  }

  const missing = (opts.require ?? []).filter((key) => !platforms[key]);
  if (missing.length) {
    throw new Error(`Missing required platforms: ${missing.join(", ")}`);
  }

  return {
    version: opts.version,
    notes: opts.notes ?? `WowUpNight ${opts.version}`,
    pub_date: opts.pubDate,
    releaseUrl: `${base}/tag/${encodeURIComponent(opts.tag)}`,
    platforms,
  };
}
