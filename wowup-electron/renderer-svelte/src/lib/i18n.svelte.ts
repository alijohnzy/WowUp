// Replaces @ngx-translate/core + @ngx-translate/http-loader + ngx-translate-messageformat-compiler.
//
// The 13 locale JSON files stay exactly where they are (src/assets/i18n) and keep their
// ICU MessageFormat syntax — @messageformat/core is framework-agnostic and survives the
// migration. What goes away is the Angular layer: the DI service, the pipe, and the HTTP
// loader that fetched locale JSON at runtime. Vite resolves them at build time instead.

import MessageFormat from '@messageformat/core';

type Messages = Record<string, unknown>;

// Build-time glob of the shared Angular locale assets — this is the http-loader replacement.
const locales = import.meta.glob<{ default: Messages }>('../../../src/assets/i18n/*.json');

const DEFAULT_LOCALE = 'en';

function localeFromPath(p: string): string {
	return p.split('/').pop()!.replace('.json', '');
}

export const availableLocales: string[] = Object.keys(locales).map(localeFromPath).sort();

/** Dot-path lookup: "PAGES.OPTIONS.TABS.ABOUT" -> "About" */
function lookup(messages: Messages, key: string): string | undefined {
	let node: unknown = messages;
	for (const part of key.split('.')) {
		if (typeof node !== 'object' || node === null) return undefined;
		node = (node as Record<string, unknown>)[part];
	}
	return typeof node === 'string' ? node : undefined;
}

class I18n {
	locale = $state(DEFAULT_LOCALE);

	#messages = $state<Messages>({});
	#fallback: Messages = {};
	#mf = new MessageFormat(DEFAULT_LOCALE);
	#compiled = new Map<string, (params?: Record<string, unknown>) => string>();

	/** Load a locale (and the English fallback on first call). Idempotent. */
	async load(locale: string): Promise<void> {
		const entry = Object.entries(locales).find(([p]) => localeFromPath(p) === locale);
		if (!entry) throw new Error(`Unknown locale: ${locale}`);

		if (!Object.keys(this.#fallback).length) {
			const fb = Object.entries(locales).find(([p]) => localeFromPath(p) === DEFAULT_LOCALE);
			if (fb) this.#fallback = (await fb[1]()).default;
		}

		this.#messages = (await entry[1]()).default;
		this.#mf = new MessageFormat(locale);
		this.#compiled.clear();
		this.locale = locale;
	}

	/**
	 * Translate a key, with optional ICU params.
	 * Falls back to English, then to the key itself — same contract ngx-translate had.
	 */
	t = (key: string, params?: Record<string, unknown>): string => {
		// Read `locale` so callers re-run when it changes.
		void this.locale;

		const raw = lookup(this.#messages, key) ?? lookup(this.#fallback, key);
		if (raw === undefined) return key;
		if (!params) return raw;

		let fn = this.#compiled.get(key);
		if (!fn) {
			try {
				fn = this.#mf.compile(raw) as (p?: Record<string, unknown>) => string;
			} catch {
				return raw; // malformed ICU — degrade to the raw string rather than throwing
			}
			this.#compiled.set(key, fn);
		}
		return fn(params);
	};
}

export const i18n = new I18n();

/** Convenience binding so templates read `{t('KEY')}` rather than `{i18n.t('KEY')}`. */
export const t = i18n.t;
