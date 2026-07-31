import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

const angularSrc = fileURLToPath(new URL('../src/', import.meta.url)).replace(/\\/g, '/');

// The Angular build compiles in place: tsc drops a .js next to every .ts under src/.
// They are gitignored (.gitignore, "src/**/*.js") so they are invisible in git status,
// but they are on disk, and Vite probes .js before .ts for extensionless imports.
//
// So `$common/constants` resolved to a June build artifact that predated half the IPC
// channel constants. Nothing threw — the absent exports were simply `undefined`, and the
// renderer invoked channel `undefined`, which surfaced hours downstream as an empty grid.
// Twelve modules under src/common were shadowed this way.
//
// Deleting the artifacts is not a fix: the next `npm run build` recreates them. Scoped to
// the shared Angular directories on purpose — reordering resolve.extensions globally would
// also change how node_modules resolves.
const tsSourceCache = new Map<string, string | null>();

function preferTsSources(): Plugin {
	return {
		name: 'wowup:prefer-ts-sources',
		enforce: 'pre',
		resolveId(id) {
			// This runs for every import in the graph, so the cheap prefix reject comes first
			// and the stat is cached. Vite normalises ids to forward slashes already.
			if (!id.startsWith(angularSrc) || /\.\w+$/.test(id)) return null;
			let resolved = tsSourceCache.get(id);
			if (resolved === undefined) {
				resolved = existsSync(`${id}.ts`) ? `${id}.ts` : null;
				tsSourceCache.set(id, resolved);
			}
			return resolved;
		}
	};
}

// Replaces angular.json's `fileReplacements`, which swapped src/environments/environment.ts
// for a flavour-specific sibling per build configuration. BUILD_FLAVOR is the same variable
// the npm scripts already set (`cross-env BUILD_FLAVOR=wago ...`).
//
// Unset flavour keeps environment.ts, so `npm run build` and the test runs are unaffected.
function environmentFile(): string | undefined {
	const flavour = process.env.BUILD_FLAVOR;
	if (!flavour) return undefined;

	const prod = process.env.NODE_ENV === 'production';
	const name =
		flavour === 'ow'
			? prod
				? 'environment.prod.ow.ts'
				: 'environment.dev.ow.ts'
			: prod
				? 'environment.prod.ts'
				: 'environment.dev.ts';

	return fileURLToPath(new URL(`../src/environments/${name}`, import.meta.url));
}

const environmentAlias = environmentFile();

// The environment files ship `apiKey: "{{CURSEFORGE_API_KEY}}"` as a literal placeholder; the
// real key is a build secret. Without substitution the CurseForge client sends the placeholder
// and every request is rejected — which surfaces as "No description found" and an empty
// changelog while previews still work, because those come from the stored addon record rather
// than a live call.
//
// gulpfile-ow.js does this by rewriting the tracked env files in place, i.e. writing a secret
// into version control for the duration of the build. Doing it as a transform keeps the working
// tree clean, and warns rather than failing so a keyless build is still runnable — just without
// CurseForge descriptions.
//
// The key is read from wowup-electron/.env (gitignored, and the same file gulpfile-ow.js and
// electron-build/after-sign.js already load via dotenv) or from the shell, which wins. Vite's
// own .env handling only exposes VITE_-prefixed variables to client code and does not populate
// process.env here, so the file is parsed directly.
const CF_PLACEHOLDER = '{{CURSEFORGE_API_KEY}}';

/**
 * CurseForge keys are bcrypt-shaped (`$2a$10$…`). Checking that is not pedantry: a wrong key
 * fails at runtime as a 403 on every CurseForge call, which surfaces only as "an error occurred
 * checking for updates from Curse" — no mention of the key, and the addon list still renders
 * from the local database, so the app looks broadly fine.
 */
const looksLikeCfKey = (key: string) => /^\$2[aby]\$\d{2}\$/.test(key);

function curseforgeKey(): string | undefined {
	// Quotes stripped here too. `process.env` is not necessarily clean: a `.env` holding
	// CURSEFORGE_API_KEY="$2a$10$…" that gets `set -a; . ./.env`-ed into the shell arrives with
	// the quotes gone but the `$2a`/`$10` segments expanded away as shell variables — 60 valid
	// characters become 54 invalid ones. That silently shipped in every build until a 403 on
	// /v1/mods/featured led back here.
	const fromEnv = process.env.CURSEFORGE_API_KEY?.trim().replace(/^["']|["']$/g, '');
	if (fromEnv) return fromEnv;

	const envPath = fileURLToPath(new URL('../.env', import.meta.url));
	if (!existsSync(envPath)) return undefined;

	// Deliberately minimal: one KEY=value per line, optional quotes, # comments ignored.
	for (const line of readFileSync(envPath, 'utf8').split('\n')) {
		const match = /^\s*(?:export\s+)?CURSEFORGE_API_KEY\s*=\s*(.*)$/.exec(line);
		if (match) return match[1].trim().replace(/^["']|["']$/g, '') || undefined;
	}
	return undefined;
}

function injectCurseforgeKey(): Plugin {
	let warned = false;
	return {
		name: 'wowup:inject-curseforge-key',
		transform(code, id) {
			if (!id.includes('/src/environments/') || !code.includes(CF_PLACEHOLDER)) return null;

			const key = curseforgeKey();
			if (key && !looksLikeCfKey(key)) {
				this.warn(
					`CURSEFORGE_API_KEY does not look like a CurseForge key (got ${key.length} chars ` +
						`starting "${key.slice(0, 4)}"; expected a bcrypt-style "$2a$10$…"). Every ` +
						'CurseForge request will 403. If it came from a shell that sourced .env, the ' +
						'`$` segments were expanded — pass the file through instead of exporting it.'
				);
			}
			if (!key) {
				if (!warned) {
					warned = true;
					this.warn(
						'CURSEFORGE_API_KEY is not set — CurseForge addon descriptions and changelogs ' +
							'will be empty. Previews and installed-addon data are unaffected.'
					);
				}
				return null;
			}

			return { code: code.split(CF_PLACEHOLDER).join(key), map: null };
		}
	};
}

export default defineConfig({
	plugins: [
		preferTsSources(),
		injectCurseforgeKey(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Electron loads the renderer off disk via file://, so this is a pure SPA:
			// no server, no prerendering, relative asset paths.
			adapter: adapter({ fallback: 'index.html', pages: 'build', assets: 'build' }),
			// `relative: true` exists for Electron, which loads the renderer off file://, where an
			// absolute /_app/… would resolve against the filesystem root. Tauri serves from
			// tauri://localhost, i.e. a real origin with a root, so absolute paths are correct —
			// and relative ones are actively wrong: SvelteKit derives `base` from the document
			// location, and at tauri://localhost it derived a base that made goto() fall back to a
			// full-page navigation. index.html redirects to /my-addons on mount, so that reloaded,
			// redirected, and reloaded again — a boot loop, ~30 loads/second, no error logged.
			paths: { relative: process.env.BUILD_SHELL !== 'tauri' },
			// Hash routing exists because Electron loads the renderer off file://, where the
			// document URL is a filesystem path and history routing cannot work. Tauri serves
			// from tauri://localhost — a real origin — so history routing is available, and hash
			// routing is actively harmful there: goto('#/x') against a non-special URL scheme
			// fell back to a full-page navigation, and index.html redirects on mount, so the app
			// reloaded in a loop.
			router: { type: process.env.BUILD_SHELL === 'tauri' ? 'pathname' : 'hash' },
			alias: {
				// src/common/ contains zero Angular imports — constants, models and warcraft
				// helpers shared with the main process. Both renderers consume it directly;
				// there is nothing to port. Declared here rather than in Vite's resolve.alias
				// so `svelte-kit sync` also writes the tsconfig paths.
				$common: fileURLToPath(new URL('../src/common', import.meta.url)),
				// Also Angular-free. The file-specific entry must come first: aliases are
				// matched in order, and '$config' alone would swallow '$config/environment'.
				...(environmentAlias ? { '$config/environment': environmentAlias } : {}),
				$config: fileURLToPath(new URL('../src/environments', import.meta.url))
			}
		})
	],
	// wowup-lib-core is Parcel-built CommonJS whose re-exports go through a runtime
	// `$parcel$exportWildcard` helper. Vite's dev-time CJS interop detects named exports by
	// static analysis, which that helper defeats, so every named import from the package is a
	// missing binding in dev — `SyntaxError: Importing binding name 'getTocForGameType' is not
	// found`, thrown before the app mounts. Production is unaffected because Rollup resolves
	// the wildcard at build time, which is why this only ever showed up on the dev server.
	//
	// Linked (`file:`) dependencies are excluded from pre-bundling by default; naming it here
	// opts it back in, and esbuild does resolve the wildcard.
	optimizeDeps: {
		include: ['wowup-lib-core']
	},
	// routes.ts needs to know which router is in play to build an address, and the router is
	// chosen at build time. Inlined as a literal so the dead branch is dropped from the bundle.
	define: {
		__HASH_ROUTING__: JSON.stringify(process.env.BUILD_SHELL !== 'tauri')
	},
	build: {
		// Needed for the emitted-span bundle attribution in migration/baseline.
		sourcemap: true
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},
			{
				// Component tests. The scaffold only wired the node project (sv create cannot
				// express vitest's multi-select via flags), and the ag-grid cell-renderer
				// bridge mounts real components, so it needs a DOM.
				extends: './vite.config.ts',
				// Without the browser condition Vite resolves svelte's server build, where
				// mount() throws lifecycle_function_unavailable.
				resolve: { conditions: ['browser'] },
				test: {
					name: 'client',
					environment: 'jsdom',
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			}
		]
	}
});
