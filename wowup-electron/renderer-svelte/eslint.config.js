import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',

			// A leading underscore marks a binding that exists only to satisfy a signature — a
			// callback parameter the implementation ignores, a destructured field being skipped.
			// Without this the only ways to express that are a disable comment at each site or
			// deleting the parameter, which changes the type.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			]
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		rules: {
			// Off because its premise does not hold for this app.
			//
			// The rule wants every internal navigation to go through `resolve()` from
			// `$app/paths`, which returns `base + (hash_routing ? '#' : '') + route`. This
			// renderer is hash-routed, uses `paths.relative: true`, and is loaded from `file://`
			// inside Electron — and in that combination `base` resolves to the absolute build
			// directory. Measured:
			//
			//   resolve('/my-addons') === '/home/…/renderer-svelte/build#/my-addons'
			//
			// `goto()` treats that as a path navigation, Electron reports ERR_FILE_NOT_FOUND, the
			// window reloads index.html, and bootstrap redirects again — an infinite reload loop.
			// The nav-rail links break identically.
			//
			// `src/lib/routes.ts` owns the one correct form (`'#' + path`), so there is a single
			// place to change if the base ever becomes empty. Re-enable this rule if the app
			// stops being served off the filesystem.
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
