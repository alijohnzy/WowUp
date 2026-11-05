import type { DownloadAuth } from 'wowup-lib-core';

/**
 * Download auth as it is safe to log: which headers and query parameters are sent, never their
 * values. The renderer console is forwarded into the app's log file, and these carry a GitHub
 * personal access token, a Wago bearer token or a CurseForge key.
 */
export function describeDownloadAuth(auth: DownloadAuth | undefined): string {
	const parts = [
		['headers', Object.keys(auth?.headers ?? {})],
		['query', Object.keys(auth?.queryParams ?? {})]
	] as const;
	const described = parts
		.filter(([, names]) => names.length > 0)
		.map(([kind, names]) => `${kind}: ${names.join(', ')}`);
	return described.length > 0 ? described.join('; ') : 'none';
}
