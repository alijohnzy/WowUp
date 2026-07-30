// Browser-safe replacements for the Node `path` functions the renderer uses.
//
// 11 files under src/app import Node builtins directly (`path`, `fs`, `os`) — the coupling
// the UI-decoupling plan exists to remove. The `path` usage is entirely join/dirname/
// basename/extname, which are pure string manipulation and need no Node at all.
//
// WoW installation paths come from the main process and may use either separator, so the
// parsing helpers accept both. `join` emits the host separator.

const isWindows = (): boolean => typeof window !== 'undefined' && window.platform === 'win32';

const SEP_RE = /[\\/]/;

/** Host path separator. */
export const sep = (): string => (isWindows() ? '\\' : '/');

/** Join segments, collapsing repeated and trailing separators. */
export function join(...segments: string[]): string {
	const parts = segments.filter((s) => s !== undefined && s !== null && s !== '');
	if (!parts.length) return '.';

	const joined = parts.join('/').replace(/\\/g, '/');
	// Preserve a UNC or leading-root prefix while collapsing everything else.
	const isAbsolute = joined.startsWith('/');
	const normalized = joined
		.split('/')
		.filter((p, i) => p !== '' || i === 0)
		.filter((p) => p !== '.')
		.join('/');

	const out = isAbsolute && !normalized.startsWith('/') ? `/${normalized}` : normalized;
	return isWindows() ? out.replace(/\//g, '\\') : out;
}

/** Last path segment, ignoring any trailing separator. */
export function basename(p: string, ext?: string): string {
	if (!p) return '';
	const trimmed = p.replace(/[\\/]+$/, '');
	const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	const base = idx === -1 ? trimmed : trimmed.slice(idx + 1);
	return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

/** Everything before the last segment. Returns "." when there is no separator. */
export function dirname(p: string): string {
	if (!p) return '.';
	// A path that is nothing but separators is the root, and is its own dirname.
	if (/^[\\/]+$/.test(p)) return p[0];
	const trimmed = p.replace(/[\\/]+$/, '');
	const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	if (idx === -1) return '.';
	if (idx === 0) return trimmed[0];
	return trimmed.slice(0, idx);
}

/** Extension including the leading dot, or "" — matches Node for dotfiles and trailing dots. */
export function extname(p: string): string {
	const base = basename(p);
	const idx = base.lastIndexOf('.');
	// A leading dot is a dotfile, not an extension.
	if (idx <= 0) return '';
	return base.slice(idx);
}

export function isAbsolute(p: string): boolean {
	if (!p) return false;
	if (p.startsWith('/') || p.startsWith('\\')) return true;
	return /^[a-zA-Z]:[\\/]/.test(p); // Windows drive letter
}

/** Split a path into its segments, on either separator. */
export const split = (p: string): string[] => p.split(SEP_RE).filter(Boolean);
