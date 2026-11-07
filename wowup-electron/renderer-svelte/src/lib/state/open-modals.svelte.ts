// How many modal <dialog>s are open, counted by the modalDialog attachment that every dialog
// in the app goes through — DialogHost's, and the page-local ones built on Modal (WTF backups,
// Install From URL, ...) that never enter the `dialogs` stack.
//
// The Tauri ad view is a native webview drawn above the page, so it has to know when anything
// modal is up; `dialogs.stack` alone missed every page-local dialog.

class OpenModals {
	count = $state(0);
}

export const openModals = new OpenModals();
