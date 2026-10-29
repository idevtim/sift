# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

Only the latest release receives security updates.

## Reporting a Vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, email **security@idevtim.com** with:

- A description of the vulnerability
- Steps to reproduce
- Your Sift version and operating system (macOS, Windows or Linux, with version)

You can expect an initial response within 48 hours. If the vulnerability is confirmed, a fix will be prioritized and released as soon as possible. You'll be credited in the release notes unless you prefer to remain anonymous.

## Scope

Sift reads your whole disk and moves or deletes files you choose, so issues in these areas are especially relevant:

- Removing, holding or restoring anything outside what you selected (path handling, symlinks, other users' or system locations)
- Anything that deletes for good without the warnings Sift shows (Trash, caches, "Clear now")
- Uninstalling apps: running an app's uninstaller, and which leftovers are removed
- The weekly check-up's scheduled job (launch agent, Task Scheduler task, systemd timer)
- macOS Full Disk Access handling
- The update check and update installation (signature verification)
