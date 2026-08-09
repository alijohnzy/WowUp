//! System tray — port of `app/system-tray.ts`.
//!
//! Built on demand from the renderer (`create-tray-menu`) rather than at startup, because
//! the labels are translated on the renderer side: the main process never knows the user's
//! language, so it cannot build this menu itself. That indirection is inherited from the
//! Electron build and is why this is a command rather than part of `setup`.

use serde::Deserialize;
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

/// Emitted when the tray's Update All is chosen. The renderer runs the same routine the
/// in-app button does; the work cannot happen here because it is all renderer-side.
const IPC_TRAY_UPDATE_ALL: &str = "tray-update-all";

/// Mirrors `SystemTrayConfig` (src/common/wowup/models.ts:55).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemTrayConfig {
    pub show_label: String,
    pub quit_label: String,
    /// Present in the contract but unused: the Electron build commented the entry out
    /// ("per discussion with zak") and this keeps the payload shape identical.
    #[serde(default)]
    pub check_update_label: String,
    /// Already carries the count, e.g. "Update All (4)" — the renderer owns both the
    /// translation and the number formatting, as it does for every other label here.
    #[serde(default)]
    pub update_all_label: String,
}

/// Holds the tray so it is not dropped — a `TrayIcon` unregisters itself when freed, which
/// is what makes a naive implementation flash an icon and then lose it.
#[derive(Default)]
pub struct TrayState {
    tray: Mutex<Option<TrayIcon>>,
    /// What the icon currently shows. Startup pushes the same number several times — tray
    /// creation, the selected-client effect and the badge sum all call in — and re-setting
    /// the icon each time repaints the tray for nothing.
    ///
    /// Keyed on the state as well as the count: a run starting does not change how many
    /// updates there are, only their colour, and memoising on the count alone would drop it.
    shown: Mutex<Option<(u32, BadgeState, Vec<String>)>>,
    /// The translated labels, kept so the menu can be rebuilt when the addon list changes
    /// without asking the renderer to send them again.
    config: Mutex<Option<SystemTrayConfig>>,
}

fn restore_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    // Unminimise first: `set_focus` on a minimised window is a no-op on some window
    // managers, which reads as the Show item doing nothing.
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    // Undo what close-to-tray set on the way out, or the restored window has no taskbar
    // entry and can only ever be raised from the tray again.
    let _ = window.set_skip_taskbar(false);
    let _ = window.set_focus();
}

/// Build the tray menu.
///
/// The pending addons go in as disabled items under the action. That is not where a tooltip
/// would go, but Linux has no tooltip to put them in: `TrayIcon::set_tooltip` is a no-op in
/// tray-icon's GTK backend, and menu items carry no tooltip at all. The menu is the only
/// surface that can show them.
fn build_menu(
    app: &AppHandle,
    config: &SystemTrayConfig,
    count: u32,
    addons: &[String],
) -> Result<tauri::menu::Menu<Wry>, String> {
    let name = app.package_info().name.clone();

    let title = MenuItemBuilder::with_id("title", &name)
        .enabled(false)
        .build(app)
        .map_err(|e| e.to_string())?;
    let show = MenuItemBuilder::with_id("show", nonempty(&config.show_label, "Show"))
        .build(app)
        .map_err(|e| e.to_string())?;
    let update_all = MenuItemBuilder::with_id(
        "update-all",
        nonempty(&config.update_all_label, "Update All"),
    )
    // Nothing to update means nothing to click.
    .enabled(count > 0)
    .build(app)
    .map_err(|e| e.to_string())?;
    let quit = MenuItemBuilder::with_id("quit", nonempty(&config.quit_label, "Quit"))
        .build(app)
        .map_err(|e| e.to_string())?;

    let mut builder = MenuBuilder::new(app)
        .items(&[&title, &show])
        .separator()
        .items(&[&update_all]);

    // Disabled, and indented so they read as a list belonging to the item above rather than
    // as more things to click.
    let mut listed = Vec::new();
    for addon in addons {
        listed.push(
            MenuItemBuilder::with_id(format!("addon-{addon}"), format!("    {addon}"))
                .enabled(false)
                .build(app)
                .map_err(|e| e.to_string())?,
        );
    }
    for item in &listed {
        builder = builder.item(item);
    }

    builder
        .separator()
        .items(&[&quit])
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_tray_menu(
    app: AppHandle,
    state: State<'_, TrayState>,
    config: SystemTrayConfig,
) -> Result<bool, String> {
    let name = app.package_info().name.clone();
    let menu = build_menu(&app, &config, 0, &[])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "no bundled window icon to use for the tray".to_string())?;

    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(&name)
        .menu(&menu)
        // Without this the menu also opens on left click, and the click-to-restore below
        // never fires.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => restore_window(app),
            "update-all" => {
                // Deliberately does not restore the window. The point of running it from the
                // tray is not having to look at the app; the renderer works the same hidden,
                // and the badge going down is the confirmation.
                if let Err(e) = app.emit(IPC_TRAY_UPDATE_ALL, ()) {
                    log::error!("could not forward the tray update-all: {e}");
                }
            }
            "quit" => {
                // Otherwise close-to-tray intercepts the resulting close and the app hides
                // instead of exiting — the tray's own Quit would do nothing.
                app.state::<crate::window::Quitting>().set();
                app.exit(0)
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left click restores, which is what users expect of a tray icon and what the
            // Electron build did via its own click handler.
            if let TrayIconEvent::Click { button, .. } = event {
                if button == tauri::tray::MouseButton::Left {
                    restore_window(tray.app_handle());
                }
            }
        })
        .build(&app)
        .map_err(|e| e.to_string())?;

    // Replacing the previous one: the renderer calls this again when the language changes.
    *state.tray.lock().map_err(|e| e.to_string())? = Some(tray);
    *state.config.lock().map_err(|e| e.to_string())? = Some(config);
    // The new icon carries no badge, whatever the old one showed.
    *state.shown.lock().map_err(|e| e.to_string())? = None;

    log::info!("tray created");
    Ok(true)
}

fn nonempty<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_fall_back_when_the_renderer_sends_nothing() {
        // The Electron build did `config.showLabel || "Show"`; an untranslated key arrives as
        // an empty string, and a blank tray entry is worse than an English one.
        assert_eq!(nonempty("", "Show"), "Show");
        assert_eq!(nonempty("   ", "Quit"), "Quit");
        assert_eq!(nonempty("Anzeigen", "Show"), "Anzeigen");
    }

    #[test]
    fn config_deserialises_from_the_renderer_camel_case_payload() {
        let cfg: SystemTrayConfig = serde_json::from_str(
            r#"{"showLabel":"Show","quitLabel":"Quit","checkUpdateLabel":"Check"}"#,
        )
        .unwrap();
        assert_eq!(cfg.show_label, "Show");
        assert_eq!(cfg.quit_label, "Quit");
    }

    /// A blank 8x8 icon, so a changed pixel is unambiguously the badge.
    fn blank(w: u32, h: u32) -> Vec<u8> {
        vec![0u8; (w * h * 4) as usize]
    }

    fn painted(rgba: &[u8]) -> usize {
        rgba.chunks_exact(4).filter(|p| p[3] != 0).count()
    }

    /// Zero updates means no badge at all — drawing a circle with "0" in it would announce
    /// something when there is nothing to announce.
    #[test]
    fn no_badge_when_there_is_nothing_to_update() {
        let base = blank(64, 64);
        let out = draw_badge(&base, 64, 64, 0, BadgeState::Pending);
        assert_eq!(out, base);
    }

    #[test]
    fn a_badge_is_drawn_when_updates_exist() {
        let base = blank(64, 64);
        let out = draw_badge(&base, 64, 64, 3, BadgeState::Pending);
        assert_eq!(out.len(), base.len(), "the buffer must keep its dimensions");
        assert!(painted(&out) > 0, "nothing was drawn");
    }

    /// It goes bottom-right, leaving the opposite corner — where the app's mark reads — clear.
    ///
    /// Checked against the far corner rather than the quadrant: a disc large enough to hold a
    /// digit legibly does reach past the midpoint, and that is fine. What must stay untouched
    /// is the corner the eye identifies the icon by.
    #[test]
    fn the_badge_sits_in_the_bottom_right() {
        let (w, h) = (64u32, 64u32);
        let out = draw_badge(&blank(w, h), w, h, 5, BadgeState::Pending);

        let mut far_corner = 0;
        let mut bottom_right = 0;
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                if out[i + 3] == 0 {
                    continue;
                }
                if x < w / 4 && y < h / 4 {
                    far_corner += 1;
                } else if x >= w / 2 && y >= h / 2 {
                    bottom_right += 1;
                }
            }
        }
        assert_eq!(
            far_corner, 0,
            "the badge must leave the icon's top-left corner alone"
        );
        assert!(bottom_right > 0, "the badge should be in the bottom-right");
    }

    /// Two digits do not fit legibly at tray size, so anything past nine says "9+".
    #[test]
    fn counts_past_nine_collapse() {
        assert_eq!(badge_text(1), "1");
        assert_eq!(badge_text(9), "9");
        assert_eq!(badge_text(10), "9+");
        assert_eq!(badge_text(204), "9+");
    }

    /// Different counts have to look different, or the number is decoration.
    #[test]
    fn different_counts_draw_differently() {
        let base = blank(64, 64);
        let one = draw_badge(&base, 64, 64, 1, BadgeState::Pending);
        let eight = draw_badge(&base, 64, 64, 8, BadgeState::Pending);
        assert_ne!(one, eight);
    }

    /// The real icon is 512px and a tray may hand back something much smaller; the badge is
    /// sized in proportion, so neither should panic or overflow the buffer.
    #[test]
    fn badge_scales_to_the_icon_it_is_given() {
        for dim in [16u32, 22, 32, 64, 512] {
            let out = draw_badge(&blank(dim, dim), dim, dim, 9, BadgeState::Pending);
            assert_eq!(out.len(), (dim * dim * 4) as usize, "size {dim}");
            assert!(painted(&out) > 0, "nothing drawn at {dim}px");
        }
    }

    /// The digit has to stay inside the disc.
    ///
    /// Regression: the glyph scale was derived from the text *width* only, so a single digit
    /// came out 2.25 radii tall inside a disc 1.7 radii across and hung out of the bottom of
    /// the circle. "9+" was fine — two glyphs force a smaller scale — so the earlier tests,
    /// which only asserted that pixels changed and that counts differ, all passed.
    #[test]
    fn glyphs_stay_inside_the_badge() {
        let (w, h) = (128u32, 128u32);
        let (cx, cy, radius) = badge_geometry(w, h);

        for count in [1u32, 4, 8, 10] {
            let out = draw_badge(&blank(w, h), w, h, count, BadgeState::Pending);
            for y in 0..h {
                for x in 0..w {
                    let i = ((y * w + x) * 4) as usize;
                    if out[i + 3] == 0 {
                        continue;
                    }
                    let dx = x as f32 + 0.5 - cx;
                    let dy = y as f32 + 0.5 - cy;
                    let d = (dx * dx + dy * dy).sqrt();
                    assert!(
                        d <= radius + 1.0,
                        "count {count}: pixel ({x},{y}) is {d:.1} from the centre, outside the \
                         disc of radius {radius:.1}"
                    );
                }
            }
        }
    }

    /// A run has to be visibly distinct from updates merely waiting, which is the whole point
    /// of the colour.
    #[test]
    fn each_state_draws_a_different_colour() {
        let base = blank(64, 64);
        let pending = draw_badge(&base, 64, 64, 4, BadgeState::Pending);
        let running = draw_badge(&base, 64, 64, 4, BadgeState::Running);
        let done = draw_badge(&base, 64, 64, 4, BadgeState::Done);

        assert_ne!(pending, running);
        assert_ne!(running, done);
        assert_ne!(pending, done);
    }

    /// White on amber is unreadable at the size this is actually drawn, so the running badge
    /// uses dark text. Guards against someone tidying the three states into one colour pair.
    #[test]
    fn the_amber_badge_uses_dark_text() {
        let (fill, text) = BadgeState::Running.colours();
        let luma = |c: [u8; 4]| 0.299 * c[0] as f32 + 0.587 * c[1] as f32 + 0.114 * c[2] as f32;
        assert!(
            luma(fill) - luma(text) > 100.0,
            "amber fill and its text are too close in brightness to read"
        );
    }

    /// The renderer omits it on the ordinary path, and that has to mean "updates waiting".
    #[test]
    fn a_missing_state_means_pending() {
        assert_eq!(BadgeState::default(), BadgeState::Pending);
        let parsed: BadgeState = serde_json::from_str(r#""running""#).unwrap();
        assert_eq!(parsed, BadgeState::Running);
    }

    /// Guards the `+` glyph, which is the one that is easy to leave out of the table.
    #[test]
    fn every_glyph_the_badge_can_spell_has_a_bitmap() {
        for count in [0u32, 1, 5, 9, 10, 99] {
            for ch in badge_text(count).chars() {
                assert!(glyph(ch).is_some(), "no bitmap for {ch:?}");
            }
        }
    }

    #[test]
    fn check_update_label_is_optional() {
        // It is unused, so a renderer that stops sending it must not break the command.
        let cfg: SystemTrayConfig =
            serde_json::from_str(r#"{"showLabel":"S","quitLabel":"Q"}"#).unwrap();
        assert_eq!(cfg.check_update_label, "");
        // Same for the update label: an older renderer must not break tray creation.
        assert_eq!(cfg.update_all_label, "");
    }
}

// ---- update badge ------------------------------------------------------------------------
//
// The count is drawn onto the tray icon rather than shown as text beside it: `TrayIcon::
// set_title` only renders on macOS, so on Linux and Windows a text badge would simply not
// appear. Compositing pixels works everywhere the tray does.
//
// The digits are hand-rolled 3x5 bitmaps rather than a font. A tray icon is around 22px on
// screen, so glyphs land at roughly 8px tall — at that size a rasterised font is a blur, and
// pulling in a font crate plus an embedded typeface to produce it is a poor trade.

/// What the badge is saying, which decides its colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum BadgeState {
    /// Updates are waiting.
    #[default]
    Pending,
    /// An update run is in progress.
    Running,
    /// The run finished. Shown briefly before the badge clears.
    Done,
}

impl BadgeState {
    /// Fill and text colour.
    ///
    /// The text colour is not always white: on amber it has to be dark, or the digit is
    /// unreadable at the size the badge is actually drawn.
    fn colours(self) -> ([u8; 4], [u8; 4]) {
        const WHITE: [u8; 4] = [255, 255, 255, 255];
        const NEAR_BLACK: [u8; 4] = [33, 33, 33, 255];
        match self {
            BadgeState::Pending => ([220, 53, 69, 255], WHITE),
            BadgeState::Running => ([255, 193, 7, 255], NEAR_BLACK),
            BadgeState::Done => ([40, 167, 69, 255], WHITE),
        }
    }
}

/// 3x5 bitmaps for the glyphs a badge can contain, row-major, one bit per pixel.
const GLYPHS: [(char, [u8; 5]); 11] = [
    ('0', [0b111, 0b101, 0b101, 0b101, 0b111]),
    ('1', [0b010, 0b110, 0b010, 0b010, 0b111]),
    ('2', [0b111, 0b001, 0b111, 0b100, 0b111]),
    ('3', [0b111, 0b001, 0b111, 0b001, 0b111]),
    ('4', [0b101, 0b101, 0b111, 0b001, 0b001]),
    ('5', [0b111, 0b100, 0b111, 0b001, 0b111]),
    ('6', [0b111, 0b100, 0b111, 0b101, 0b111]),
    ('7', [0b111, 0b001, 0b010, 0b010, 0b010]),
    ('8', [0b111, 0b101, 0b111, 0b101, 0b111]),
    ('9', [0b111, 0b101, 0b111, 0b001, 0b111]),
    ('+', [0b000, 0b010, 0b111, 0b010, 0b000]),
];

/// What the badge spells for a given count.
///
/// Anything above 9 becomes "9+". Two glyphs is what fits legibly in a circle a third the
/// width of a 22px icon; "12" at that size is a smudge, and the exact number is in the menu
/// item right below anyway.
fn badge_text(count: u32) -> String {
    if count > 9 {
        "9+".to_string()
    } else {
        count.to_string()
    }
}

fn glyph(c: char) -> Option<[u8; 5]> {
    GLYPHS.iter().find(|(g, _)| *g == c).map(|(_, bits)| *bits)
}

/// Centre and radius of the badge, in pixels, for an icon of the given size.
///
/// Shared with the tests so the two cannot disagree about where the badge is. Proportional
/// rather than fixed: the same code draws the 512px master and whatever size a platform asks
/// for, and a tray icon on Linux is often only 16px.
fn badge_geometry(width: u32, height: u32) -> (f32, f32, f32) {
    let dim = width.min(height) as f32;
    // Sized for legibility at tray scale, where the whole icon may be 16px and the digit
    // inside this disc is a third of that. It does cover part of the mark; a badge small
    // enough not to is a badge too small to read, which defeats the point of a number.
    let radius = dim * 0.36;
    // Negative: the disc is tucked into the corner and its outer edge runs a little past it,
    // clipped by the canvas. That buys back the middle of the icon — at a positive margin a
    // badge this size sits over the mark rather than beside it. The digit is centred in a box
    // well inside the disc, so nothing legible is lost to the clip.
    let margin = dim * -0.05;
    (
        width as f32 - radius - margin,
        height as f32 - radius - margin,
        radius,
    )
}

/// Draw the count over the bottom-right of an RGBA icon, returning a new buffer.
///
/// Returns the icon untouched when the count is zero — nothing to say, and a badge drawn with
/// "0" in it would be worse than none.
fn draw_badge(rgba: &[u8], width: u32, height: u32, count: u32, state: BadgeState) -> Vec<u8> {
    let mut out = rgba.to_vec();
    if count == 0 || width == 0 || height == 0 {
        return out;
    }

    let text = badge_text(count);
    let (cx, cy, radius) = badge_geometry(width, height);

    // Glyphs are 3x5 with a 1px gap. Scaled to fit the disc in *both* directions: sizing on
    // width alone made a single digit 2.25 radii tall inside a disc only 1.7 radii across, so
    // "4" spilled out of the bottom of the circle while "9+" — two glyphs, hence a smaller
    // scale — looked fine and hid it.
    let rim = radius * 0.14;
    let advance = 4.0;
    let text_w = advance * text.chars().count() as f32 - 1.0;
    // The largest square that fits inside the disc is (radius - rim) * sqrt(2) across; back
    // off from that so the glyph does not touch the rim.
    let box_side = (radius - rim) * 1.3;
    let scale = (box_side / text_w).min(box_side / 5.0);
    let origin_x = cx - (text_w * scale) / 2.0;
    let origin_y = cy - (5.0 * scale) / 2.0;

    let put = |out: &mut Vec<u8>, x: i64, y: i64, colour: [u8; 4]| {
        if x < 0 || y < 0 || x >= width as i64 || y >= height as i64 {
            return;
        }
        let i = ((y as u32 * width + x as u32) * 4) as usize;
        // Opaque paint, so the badge stays readable over a busy icon.
        out[i..i + 4].copy_from_slice(&colour);
    };

    // Filled disc with a lighter rim, which is what keeps it visible against both light and
    // dark panels.
    let (fill, text_colour) = state.colours();
    const RIM: [u8; 4] = [255, 255, 255, 255];

    let y0 = (cy - radius).floor() as i64;
    let y1 = (cy + radius).ceil() as i64;
    let x0 = (cx - radius).floor() as i64;
    let x1 = (cx + radius).ceil() as i64;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let d = (dx * dx + dy * dy).sqrt();
            if d <= radius - rim {
                put(&mut out, x, y, fill);
            } else if d <= radius {
                put(&mut out, x, y, RIM);
            }
        }
    }

    for (index, ch) in text.chars().enumerate() {
        let Some(bits) = glyph(ch) else { continue };
        let gx = origin_x + advance * index as f32 * scale;
        for (row, mask) in bits.iter().enumerate() {
            for col in 0..3u32 {
                // Bit 2 is the leftmost column.
                if mask & (1 << (2 - col)) == 0 {
                    continue;
                }
                // Each source pixel becomes a scale x scale block, so the glyph stays solid
                // instead of dropping rows when scaled up.
                let px0 = (gx + col as f32 * scale).round() as i64;
                let py0 = (origin_y + row as f32 * scale).round() as i64;
                let px1 = (gx + (col + 1) as f32 * scale).round() as i64;
                let py1 = (origin_y + (row + 1) as f32 * scale).round() as i64;
                for py in py0..py1.max(py0 + 1) {
                    for px in px0..px1.max(px0 + 1) {
                        put(&mut out, px, py, text_colour);
                    }
                }
            }
        }
    }

    out
}

/// Show the number of available updates on the tray icon and in its menu.
///
/// Called whenever the count changes. Both surfaces move together deliberately: a badge
/// promising four updates over a menu item that cannot be clicked is worse than neither.
#[tauri::command]
pub fn set_tray_update_count(
    app: AppHandle,
    tray_state: State<'_, TrayState>,
    count: u32,
    label: String,
    state: Option<BadgeState>,
    addons: Vec<String>,
) -> Result<(), String> {
    let state = state.unwrap_or_default();
    // Pending updates cannot be conjured on demand, which makes the badge awkward to look at
    // deliberately — the count is whatever the user's addons happen to need. This forces one:
    //   WOWUP_TRAY_COUNT=4 ./WowUp-CF-Tauri.AppImage
    let count = match std::env::var("WOWUP_TRAY_COUNT")
        .ok()
        .and_then(|v| v.parse().ok())
    {
        Some(forced) => forced,
        None => count,
    };
    let (label, addons) = if std::env::var_os("WOWUP_TRAY_COUNT").is_some() {
        // Synthesised names too, so the menu list can be looked at without waiting for real
        // updates — the list is the part that is awkward to see otherwise.
        (
            format!("Update All ({count})"),
            (1..=count).map(|i| format!("Test Addon {i}")).collect(),
        )
    } else {
        (label, addons)
    };

    let config = tray_state.config.lock().map_err(|e| e.to_string())?.clone();

    let mut shown = tray_state.shown.lock().map_err(|e| e.to_string())?;
    // The list is part of the key: the same number of updates can be a different set of
    // addons, and the menu has to follow.
    if shown.as_ref() == Some(&(count, state, addons.clone())) {
        return Ok(());
    }

    if let Some(tray) = tray_state.tray.lock().map_err(|e| e.to_string())?.as_ref() {
        // Rebuilt rather than relabelled: the pending addons are menu items, so the menu
        // changes shape as the list does.
        if let Some(config) = config {
            let mut config = config;
            config.update_all_label = nonempty(&label, "Update All").to_string();
            let menu = build_menu(&app, &config, count, &addons)?;
            tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        }

        let base = app
            .default_window_icon()
            .cloned()
            .ok_or_else(|| "no bundled window icon to badge".to_string())?;

        let badged = draw_badge(base.rgba(), base.width(), base.height(), count, state);
        tray.set_icon(Some(Image::new_owned(badged, base.width(), base.height())))
            .map_err(|e| e.to_string())?;
    }

    *shown = Some((count, state, addons));
    log::debug!("tray update count {count} ({state:?})");
    Ok(())
}

#[cfg(test)]
mod badge_preview {
    use super::*;

    /// Writes badge previews to /tmp so the result can actually be looked at — unit tests can
    /// prove pixels changed but not that a digit is legible at tray size.
    /// Ignored by default; run with `cargo test badge_preview -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn write_previews() {
        let icon = std::fs::read("icons/icon.png").expect("icons/icon.png");
        let decoder = png::Decoder::new(icon.as_slice());
        let mut reader = decoder.read_info().unwrap();
        let mut buf = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut buf).unwrap();
        let rgba = &buf[..info.buffer_size()];

        for (state, name) in [
            (BadgeState::Pending, "pending"),
            (BadgeState::Running, "running"),
            (BadgeState::Done, "done"),
        ] {
            let out = draw_badge(rgba, info.width, info.height, 4, state);
            let path = format!("/tmp/badge-{name}.raw");
            std::fs::write(&path, &out).unwrap();
            println!("{path} {}x{}", info.width, info.height);
        }
    }
}
