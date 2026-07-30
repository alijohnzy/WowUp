// Electron renderer: everything runs client-side off file://.
//
// `ssr = false` / `prerender = false` used to live here. They are implied by
// `router.type: 'hash'` in vite.config.ts, and SvelteKit rejects the build if both are set:
//   "Page options are ignored when `router.type === 'hash'`"
export {};
