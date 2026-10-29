# Privacy

Sift looks at your whole disk, so here's exactly what it does with what it sees. The short version: **everything stays on your computer.** No account, no analytics, no uploads.

## What Sift reads

- **Names, sizes and dates** of files and folders, to measure what's taking up space. This is all a scan does.
- **File contents, only to find exact duplicates.** When two photos or documents are the same size, Sift compares their bytes (a hash) to confirm they're identical copies. The result never leaves your computer.
- **Installed apps**: names, versions, icons and where they keep their settings, so the Apps page can show what each one takes up.
- **On macOS, Spotlight's "last used" date for apps**, shown on the Apps page. For files, Sift uses the file's own opened/modified dates.

Sift never opens files that live only in iCloud Drive (or other cloud storage) and never walks cloud-sync folders, so a scan can't trigger downloads.

## What Sift writes

- **Its holding area** for things you remove: a folder on the same drive, kept for 30 days so you can restore them.
- **A small list of what you removed** and a summary of the last scan, in Sift's own app data folder.
- **Your preferences** (theme, sounds, weekly check-up) in the same place.
- **If the weekly check-up is on**, one scheduled job so your computer can start Sift on Sundays: a launch agent in `~/Library/LaunchAgents` on macOS, a Task Scheduler task on Windows, or a systemd user timer on Linux. Turning the check-up off removes it.

## Permissions

- **macOS Full Disk Access** lets Sift measure folders macOS keeps private (Mail, Messages, other apps' data). It's optional; you can turn it off any time in System Settings › Privacy & Security.
- **Notifications** are only used by the weekly check-up.
- Sift itself never asks for an administrator password. When you uninstall a Windows program, a Snap or a system-wide Flatpak, that program's own uninstaller (or your system) may ask.

## What leaves your computer

**Only the update check.** On launch, Sift asks GitHub Releases whether a newer version exists (`https://github.com/idevtim/sift/releases/latest/download/latest.json`) and downloads it if so. That request carries nothing about you or your files beyond what any web request does (your IP address, seen by GitHub).

There is no analytics, crash reporting, telemetry or account of any kind.

## Questions

Open an [issue](https://github.com/idevtim/sift/issues) or email **security@idevtim.com** for anything sensitive.
