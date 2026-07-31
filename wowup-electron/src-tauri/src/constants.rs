//! The channel names shared with the renderer.
//!
//! Mirrors the entries in `src/common/constants.ts` that Rust needs to emit on. Only event
//! channels appear here: request/response channels are reached by command name, which
//! `src/lib/ipc-tauri.ts` derives from the channel string, so duplicating those would add a
//! second place to get them wrong.

pub const IPC_WINDOW_MAXIMIZED: &str = "window-maximized";
pub const IPC_WINDOW_UNMAXIMIZED: &str = "window-unmaximized";
pub const IPC_WINDOW_MINIMIZED: &str = "window-minimized";
pub const IPC_WINDOW_ENTER_FULLSCREEN: &str = "enter-full-screen";
pub const IPC_WINDOW_LEAVE_FULLSCREEN: &str = "leave-full-screen";
