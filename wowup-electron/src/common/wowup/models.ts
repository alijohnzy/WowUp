export enum AppUpdateState {
  CheckingForUpdate = 1,
  UpdateAvailable,
  UpdateNotAvailable,
  Downloading,
  Downloaded,
  Error,
}

export interface AppUpdateEvent {
  state: AppUpdateState;
  progress?: AppUpdateDownloadProgress;
  error?: string;
}

export interface AppUpdateDownloadProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export interface AppOptions {
  serve?: boolean;
  hidden?: boolean;
  quit?: boolean;
  /**
   * Which renderer to load. Defaults to "angular"; "svelte" loads the SvelteKit build from
   * renderer-svelte/ instead. Also settable with WOWUP_RENDERER=svelte.
   */
  renderer?: "angular" | "svelte";
}

export interface MenuConfig {
  editLabel: string;
  viewLabel: string;
  zoomOutLabel: string;
  zoomInLabel: string;
  zoomResetLabel: string;
  reloadLabel: string;
  forceReloadLabel: string;
  toggleDevToolsLabel: string;
  toggleFullScreenLabel: string;
  quitLabel: string;
  undoLabel: string;
  redoLabel: string;
  cutLabel: string;
  copyLabel: string;
  pasteLabel: string;
  selectAllLabel: string;
  windowLabel: string;
  windowCloseLabel: string;
}

export interface SystemTrayConfig {
  showLabel: string;
  quitLabel: string;
  checkUpdateLabel: string;
  /** Already formatted with the count, e.g. "Update All (4)". Tauri only. */
  updateAllLabel?: string;
}

export type PushAction = "addon-update";

export interface PushNotification<T extends PushNotificationData | string> {
  action: PushAction;
  sender: string;
  message: string | T;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PushNotificationData {}

export interface AddonUpdatePushNotification extends PushNotificationData {
  provider: string;
  addonName: string;
  addonId: string;
}
