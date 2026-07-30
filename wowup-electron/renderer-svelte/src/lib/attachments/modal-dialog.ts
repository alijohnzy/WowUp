// Opens a <dialog> modally and gives it MatDialog's dismissal semantics.
//
// This existed as a near-identical local `modal()` helper in five components (DialogHost,
// Modal, AddonDetail, AddonManageDialog, WtfBackup), which is how they drifted: only two of
// them honoured `disableClose`, and none of them closed on a backdrop click.
//
// MatDialog closes on both Escape and a backdrop click unless `disableClose` is set. A native
// modal <dialog> only does the first — clicking the backdrop does nothing — so the port
// silently lost click-outside-to-close on every dialog in the app.
//
// `closedBy` expresses exactly that distinction:
//   'any'   light dismiss + Escape  -> MatDialog default
//   'none'  neither                 -> MatDialog disableClose: true
//
// It needs Chromium 134+; the renderer is Chromium 150 (Electron 43), so there is no fallback
// path here. If this ever has to run somewhere older, the shim is a pointerdown listener that
// compares the click against getBoundingClientRect() — the backdrop is a pseudo-element, so a
// click on it targets the dialog itself and cannot be detected by event.target alone.

/**
 * The `closedby` values, per spec.
 *
 * Declared here rather than taken from `lib.dom.d.ts` because which definition applies depends
 * on which TypeScript is resolving the file. `renderer-svelte` is on 6.x, which has
 * `closedBy: string`; the outer `wowup-electron` workspace still pins 5.2, which has no such
 * property at all — so an editor resolving that install reports "Property 'closedBy' does not
 * exist on type 'HTMLDialogElement'" even though `npm run check` is clean.
 *
 * The local declaration also types it more tightly than 6.x does: these three values are the
 * whole of the spec, so a typo is a compile error instead of an attribute the browser ignores.
 */
type DialogClosedBy = 'any' | 'closerequest' | 'none';

type DialogElement = HTMLDialogElement & { closedBy: DialogClosedBy };

/**
 * Usage: <dialog {@attach modalDialog(disableClose)}>…</dialog>
 *
 * The element still emits `close`, so callers keep using `onclose` to resolve their result.
 */
export function modalDialog(disableClose = false) {
	return (node: HTMLDialogElement) => {
		(node as DialogElement).closedBy = disableClose ? 'none' : 'any';
		node.showModal();
	};
}
