#!/usr/bin/env bash
# Repacks the AppImage Tauri builds so it contains WowUpNight only, and runs on the system's
# WebKitGTK — the way the .deb does, and the way the Windows build uses Edge WebView2.
#
# An AppImage cannot declare dependencies, so Tauri's bundler copies WebKitGTK, GTK, ICU and
# (for the video ad) GStreamer with every codec it links into the file: 446 MB unpacked,
# 154 MB to download, for an app whose own binary is 27 MB. Carrying a browser engine is the
# thing a Tauri app exists to avoid, and those bundled copies were also behind the gray
# window and the Wayland/EGL failures on newer distros.
#
# What is kept: the binary (stripped), its desktop entry and icons, and tauri.conf.json's
# bundle.resources (usr/lib/<productName>). The binary is taken from Tauri's AppImage rather
# than built separately because the bundler marks it as the AppImage build, which is how the
# updater knows to replace an AppImage.
#
# The trade-off: WebKitGTK 4.1 has to be installed. AppRun checks for it and, if anything is
# missing, says what to install instead of failing silently.
#
# Usage: thin-appimage.sh [AppImage] [appimagetool]
#   AppImage      defaults to the one in src-tauri/target/release/bundle/appimage
#   appimagetool  defaults to a cached download of appimagetool 1.9.0
# Replaces the AppImage in place. Running it on an AppImage that is already thin is a no-op.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"

app="${1:-}"
if [ -z "$app" ]; then
  shopt -s nullglob
  images=("$root"/src-tauri/target/release/bundle/appimage/*.AppImage)
  if [ ${#images[@]} -ne 1 ]; then
    echo "Expected one AppImage in src-tauri/target/release/bundle/appimage, found ${#images[@]}" >&2
    exit 1
  fi
  app="${images[0]}"
fi
app="$(readlink -f "$app")"

tool="${2:-}"
if [ -z "$tool" ]; then
  tool="${XDG_CACHE_HOME:-$HOME/.cache}/wowup-build/appimagetool-1.9.0-x86_64.AppImage"
  if [ ! -x "$tool" ]; then
    mkdir -p "$(dirname "$tool")"
    curl -fsSL -o "$tool.part" \
      https://github.com/AppImage/appimagetool/releases/download/1.9.0/appimagetool-x86_64.AppImage
    chmod +x "$tool.part"
    mv "$tool.part" "$tool"
  fi
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Extraction needs no FUSE, which CI runners do not have. Run from the work directory: the
# runtime extracts into ./squashfs-root. A parent AppImage's variables (APPIMAGE, APPDIR, ...)
# must not leak into it.
(cd "$work" && env -u APPIMAGE -u APPDIR -u ARGV0 -u OWD "$app" --appimage-extract > /dev/null)
src="$work/squashfs-root"

if ! compgen -G "$src/usr/lib/libwebkit2gtk-4.1.so*" > /dev/null; then
  echo "already thin: $app"
  exit 0
fi

dst="$work/WowUpNight.AppDir"
mkdir -p "$dst/usr/bin"
cp "$src/usr/bin/wowup" "$dst/usr/bin/wowup"
strip "$dst/usr/bin/wowup"
[ -d "$src/usr/share" ] && cp -a "$src/usr/share" "$dst/usr/"
# The bundled resources. The binary looks for them in ../lib/<productName> beside itself
# (Tauri's resource_dir), the same place the .deb installs them. Builds 27 to 45 left them out,
# so the WowUp data addon templates were missing and the in-game Addon Update Notifications
# list was never written again.
product="$(sed -n 's/^ *"productName": *"\([^"]*\)".*/\1/p' "$root/src-tauri/tauri.conf.json" | head -1)"
if [ -z "$product" ] || [ ! -d "$src/usr/lib/$product" ]; then
  echo "No bundled resources at usr/lib/${product:-<productName>} in $app" >&2
  exit 1
fi
mkdir -p "$dst/usr/lib"
cp -a "$src/usr/lib/$product" "$dst/usr/lib/"
# Top-level desktop entry and icons, which appimagetool requires. -L: some are symlinks into
# usr/share, which keep their meaning only inside the old tree.
for f in "$src"/*.desktop "$src"/*.png "$src"/*.svg; do
  [ -e "$f" ] && cp -L "$f" "$dst/"
done
icon="$(sed -n 's/^Icon=//p' "$dst"/*.desktop | head -1)"
[ -n "$icon" ] && [ -e "$dst/$icon.png" ] && ln -s "$icon.png" "$dst/.DirIcon"

cat > "$dst/AppRun" <<'APPRUN'
#!/bin/sh
# WowUpNight only: WebKitGTK, GTK and GStreamer come from the system (see thin-appimage.sh).
here="$(dirname "$(readlink -f "$0")")"
bin="$here/usr/bin/wowup"

missing="$(ldd "$bin" 2>/dev/null | awk '/not found/ { print $1 }' | tr '\n' ' ')"
if [ -n "$missing" ]; then
  msg="WowUpNight uses the WebKitGTK 4.1 web engine installed on your system, and it is missing.

Install it, then start WowUpNight again:
  Arch, Manjaro:   sudo pacman -S webkit2gtk-4.1
  Debian, Ubuntu:  sudo apt install libwebkit2gtk-4.1-0
  Fedora:          sudo dnf install webkit2gtk4.1
  openSUSE:        sudo zypper install libwebkit2gtk-4_1-0

Missing: $missing"
  echo "$msg" >&2
  if command -v zenity > /dev/null 2>&1; then
    zenity --error --title=WowUpNight --no-wrap --text="$msg" 2> /dev/null
  elif command -v kdialog > /dev/null 2>&1; then
    kdialog --title WowUpNight --error "$msg" 2> /dev/null
  elif command -v notify-send > /dev/null 2>&1; then
    notify-send WowUpNight "$msg" 2> /dev/null
  fi
  exit 1
fi

exec "$bin" "$@"
APPRUN
chmod +x "$dst/AppRun"

before=$(stat -c %s "$app")
# Absolute paths: extract-and-run changes the tool's working directory.
(cd "$work" && env -u APPIMAGE -u APPDIR -u ARGV0 -u OWD ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 \
  "$tool" --no-appstream "$dst" "$work/thin.AppImage" > "$work/appimagetool.log" 2>&1) || {
  cat "$work/appimagetool.log" >&2
  exit 1
}
mv "$work/thin.AppImage" "$app"
chmod +x "$app"
after=$(stat -c %s "$app")
echo "thinned: $app ($((before / 1048576)) MB -> $((after / 1048576)) MB)"
