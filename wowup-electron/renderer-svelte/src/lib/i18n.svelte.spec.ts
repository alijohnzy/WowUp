// The first-run language comes from the OS tag Tauri reports ("tr-TR", "de_DE"), which has
// to be mapped onto the locale files before i18n.load() can find one.

import { describe, expect, it } from 'vitest';
import { availableLocales, resolveLocale } from './i18n.svelte';

describe('resolveLocale', () => {
	it('ships the locales it maps to', () => {
		expect(availableLocales).toEqual(expect.arrayContaining(['de', 'en', 'tr', 'zh', 'zh-TW']));
	});

	it('keeps an exact match', () => {
		expect(resolveLocale('tr')).toBe('tr');
		expect(resolveLocale('zh-TW')).toBe('zh-TW');
	});

	it('falls back from a region tag to the base language', () => {
		expect(resolveLocale('tr-TR')).toBe('tr');
		expect(resolveLocale('de_DE')).toBe('de');
		expect(resolveLocale('en-CA')).toBe('en');
		expect(resolveLocale('pt-BR')).toBe('pt');
	});

	it('matches regardless of case', () => {
		expect(resolveLocale('zh-tw')).toBe('zh-TW');
		expect(resolveLocale('TR-tr')).toBe('tr');
	});

	it('sends Traditional Chinese tags to zh-TW and the rest to zh', () => {
		expect(resolveLocale('zh-Hant-TW')).toBe('zh-TW');
		expect(resolveLocale('zh-HK')).toBe('zh-TW');
		expect(resolveLocale('zh-CN')).toBe('zh');
		expect(resolveLocale('zh-Hans')).toBe('zh');
	});

	it('returns unknown tags unchanged so load() still rejects them', () => {
		expect(resolveLocale('xx-YY')).toBe('xx-YY');
	});
});
