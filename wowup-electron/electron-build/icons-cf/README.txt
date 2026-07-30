Icon set for the Svelte AppImage, in the NNNxNNN.png naming electron-builder expects.

Sourced from electron-build/flatpak/icon_NNNxNNNx32.png — the PLAIN set, not icon_ow_*.
"ow" there means Overwolf branding (the orange wolf), not "the ow build flavour": the shipped
WowUp-CF release AppImage carries the plain icon, verified by md5 against its extracted
usr/share/icons/hicolor/512x512/apps/wowup-cf.png.

electron-build/flatpak/ itself cannot be used as linux.icon because electron-builder matches on
the NNNxNNN.png filename convention and silently falls back to the stock Electron icon otherwise.
