# 轻净 LightClean 微信清理

LightClean is based on Kudu and adds a dedicated WeChat history cleaner for Windows and macOS.

## Safety model

- Scans only known WeChat message and media folder names inside known or user-selected WeChat roots.
- Shows account/folder, data type, path, last-modified date, and size before deletion.
- Selects nothing by default.
- Refuses deletion while WeChat is running.
- Accepts only opaque IDs produced by the most recent scan; the renderer cannot submit arbitrary paths.
- Moves selected folders to the system Recycle Bin/Trash instead of permanently shredding them.
- Skips symbolic links and validates that every deletion target remains inside a scanned root.

The automatic scan covers standard Windows and macOS locations. A folder picker handles custom WeChat storage locations. Tencent can change storage layouts between releases, so always review paths and back up important chats first.

## Build

Run `npm ci`, `npm test`, then `npm run package:win` on Windows. Build macOS artifacts on a Mac with `npm run package:mac`; public distribution requires Apple signing and notarization credentials.
