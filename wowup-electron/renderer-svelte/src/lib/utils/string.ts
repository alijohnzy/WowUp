// Port of src/app/utils/string.utils.ts (106 LOC).
//
// Dropped `getSha1Hash` — it imported Node's crypto.createHash and is called from nowhere
// in the app (verified by grep across src/). Removing it takes the last `crypto` import
// out of the renderer.

import { DAY_SECONDS, HOUR_SECONDS, MONTH_SECONDS, YEAR_SECONDS } from '$common/constants';

export const strIsNotNullOrEmpty = (value?: string): boolean =>
	typeof value === 'string' && value.length > 0;

export function stringIncludes(value: string | undefined, search: string): boolean {
	if (!value) return false;
	return value.trim().toLowerCase().indexOf(search.trim().toLowerCase()) >= 0;
}

export const removeExtension = (str: string): string => str.replace(/\.[^/.]+$/, '');

export function camelToSnakeCase(str: string): string {
	// All-caps strings are already snake-ish; leave them alone.
	if (str.toUpperCase() === str) return str;
	return str.charAt(0) + str.slice(1).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export const capitalizeString = (str: string): string =>
	str.charAt(0).toUpperCase() + str.toLowerCase().slice(1);

export function getProtocol(arg: string): string | null {
	const match = /^([a-z][a-z0-9+\-.]*):/.exec(arg);
	return match !== null && match.length > 1 ? match[1] : null;
}

export const isProtocol = (arg: string): boolean => getProtocol(arg) != null;

export const getProtocolParts = (protocol: string): string[] =>
	new URL(protocol).pathname
		.split('/')
		.filter((part) => !!part)
		.map((part) => part.toLowerCase());

/**
 * Map a timestamp onto a translation key plus its ICU args.
 * Returns ["", undefined] for empty or unparseable input.
 *
 * Accepts epoch millis as well as a date string: RelativeDurationPipe declared `value: string`
 * but the WTF backup list passed it a number, which Angular's loose template checking let
 * through. Both are real inputs, so both are typed.
 */
export function getRelativeDateFormat(
	value: string | number
): [string, Record<string, unknown> | undefined] {
	if (!value) return ['', undefined];

	const then = new Date(value);
	if (isNaN(then.getTime())) return ['', undefined];

	let tempSec = Math.floor((Date.now() - then.getTime()) / 1000);

	const years = Math.floor(tempSec / YEAR_SECONDS);
	if (years) return ['COMMON.DATES.YEARS_AGO', { count: years }];

	const months = Math.floor((tempSec %= YEAR_SECONDS) / MONTH_SECONDS);
	if (months) return ['COMMON.DATES.MONTHS_AGO', { count: months }];

	const days = Math.floor((tempSec %= MONTH_SECONDS) / DAY_SECONDS);
	if (days > 1) return ['COMMON.DATES.DAYS_AGO', { count: days }];
	if (days) return ['COMMON.DATES.YESTERDAY', undefined];

	const hours = Math.floor((tempSec % DAY_SECONDS) / HOUR_SECONDS);
	if (hours) return ['COMMON.DATES.HOURS_AGO', { count: hours }];

	return ['COMMON.DATES.JUST_NOW', undefined];
}
