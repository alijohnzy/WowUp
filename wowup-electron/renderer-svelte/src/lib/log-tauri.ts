// Renderer console -> Rust log file, the Tauri equivalent of what electron-log does for
// the Electron build (app/preload.ts injects `window.log`).
//
// Without this the webview's console goes nowhere a user or a bug report can reach it: on
// Linux WebKitGTK does not forward console output to the host process's stdout, so a
// renderer exception in a packaged build is completely invisible.

import { debug, error, info, warn } from '@tauri-apps/plugin-log';

type ConsoleMethod = 'log' | 'debug' | 'info' | 'warn' | 'error';

const FORWARDERS: Record<ConsoleMethod, (m: string) => Promise<void>> = {
	log: info,
	debug,
	info,
	warn,
	error
};

/** Console arguments are arbitrary; the Rust log takes a string. */
function format(args: unknown[]): string {
	return args
		.map((a) => {
			if (typeof a === 'string') return a;
			if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
			try {
				return JSON.stringify(a);
			} catch {
				// Cyclic objects, DOM nodes, proxies.
				return String(a);
			}
		})
		.join(' ');
}

let attached = false;

/**
 * Patches `console.*` to also write to the Rust log. Idempotent, and it keeps the original
 * behaviour so devtools still work.
 */
export function forwardConsoleToTauri(): void {
	if (attached) return;
	attached = true;

	for (const method of Object.keys(FORWARDERS) as ConsoleMethod[]) {
		const original = console[method].bind(console);
		const forward = FORWARDERS[method];

		console[method] = (...args: unknown[]) => {
			original(...args);
			// A logging failure must never take down the caller, and must not recurse back
			// into console.error.
			void forward(format(args)).catch(() => {});
		};
	}

	// Unhandled failures never reach console.error on their own.
	window.addEventListener('error', (e) => {
		void error(`Uncaught: ${e.message} (${e.filename}:${e.lineno}:${e.colno})`).catch(() => {});
	});
	window.addEventListener('unhandledrejection', (e) => {
		void error(`Unhandled rejection: ${format([e.reason])}`).catch(() => {});
	});
}
