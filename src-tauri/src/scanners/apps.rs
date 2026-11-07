//! Installed apps with the files they scatter around.
//!
//! - **macOS:** .app bundles plus leftovers in ~/Library by bundle id and
//!   name. Apple's own apps are skipped — they're part of the system.
//! - **Windows:** programs from the registry's uninstall list, plus
//!   leftovers in AppData. Runtimes, drivers and updates are skipped.
//! - **Linux:** Flatpaks, Snaps and AppImages (apps from the distro's
//!   package manager need root and aren't listed).
//!
//! Bundles and AppImages are moved to Restore. Everything else runs its own
//! uninstaller first (`run_uninstaller`); only the leftovers in the home
//! folder go to Restore.

use super::dir_size;
use crate::models::{AppInfo, AppList, AppPart, AppPartKind, AppSource};
use crate::process_ext::output;
use rayon::prelude::*;
use std::path::{Path, PathBuf};

pub fn list() -> AppList {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::new().with_exe(sysinfo::UpdateKind::Always).with_environ(sysinfo::UpdateKind::Always),
    );
    let procs = Procs {
        exes: sys.processes().values().filter_map(|p| p.exe().map(Path::to_path_buf)).collect(),
        appimages: sys
            .processes()
            .values()
            .flat_map(|p| p.environ())
            .filter_map(|e| e.to_str()?.strip_prefix("APPIMAGE=").map(PathBuf::from))
            .collect(),
    };
    let (supported, mut apps) = if cfg!(target_os = "macos") {
        (true, mac::list(&procs))
    } else if cfg!(windows) {
        (true, windows::list(&procs))
    } else {
        linux::list(&procs)
    };
    apps.retain(|a| !is_sift(a));
    apps.sort_by_key(|a| std::cmp::Reverse(a.parts.iter().map(|p| p.size_bytes).sum::<u64>()));
    AppList { supported, apps }
}

/// Sift itself: its bundle (or install folder) holds the running program,
/// or it's the AppImage this process was started from. Never offered.
fn is_sift(app: &AppInfo) -> bool {
    if app.path.is_empty() {
        return false;
    }
    let me = std::env::current_exe().ok();
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    me.is_some_and(|me| me.starts_with(&app.path)) || appimage.is_some_and(|a| a == Path::new(&app.path))
}

/// Run the app's own uninstaller (Windows programs, Flatpaks, Snaps) and
/// wait until it's really gone. Bundles and AppImages need nothing here.
pub fn run_uninstaller(app: &AppInfo) -> Result<(), String> {
    match app.source {
        AppSource::Bundle | AppSource::AppImage => Ok(()),
        AppSource::Installer => windows::uninstall(app),
        AppSource::Flatpak => linux::flatpak_uninstall(app),
        AppSource::Snap => linux::snap_remove(app),
    }
}

/// What to move to Restore: everything for bundles and AppImages, only the
/// leftovers for apps with their own uninstaller. Only paths still there.
pub fn paths_to_free(app: &AppInfo) -> Vec<PathBuf> {
    let own_uninstaller = !matches!(app.source, AppSource::Bundle | AppSource::AppImage);
    app.parts
        .iter()
        .filter(|p| !(own_uninstaller && p.kind == AppPartKind::App))
        .flat_map(|p| p.paths.iter().map(PathBuf::from))
        .filter(|p| std::fs::symlink_metadata(p).is_ok())
        .collect()
}

struct Procs {
    exes: Vec<PathBuf>,
    /// AppImages report their mount as the exe; the env var names the file.
    appimages: Vec<PathBuf>,
}

impl Procs {
    fn running_from(&self, dir: &Path) -> bool {
        !dir.as_os_str().is_empty() && self.exes.iter().any(|exe| exe.starts_with(dir))
    }
}

/// A bundle id or app name is only used as a path segment if it's one plain
/// name. Both come from the app itself (Info.plist, registry, file name), so
/// a hostile app could otherwise point "its" leftovers at, say, ~/Documents
/// with an absolute path or `..`.
pub(super) fn safe_segment(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('.')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ' | '+' | '(' | ')'))
}

/// `(kind, path)` candidates under `root`, kept only when they're plain
/// names that exist and sit directly inside a subfolder of `root`.
fn existing_under(root: &Path, candidates: Vec<(AppPartKind, PathBuf)>) -> Vec<(AppPartKind, PathBuf)> {
    let mut out: Vec<_> = candidates
        .into_iter()
        // Belt and braces: every leftover must sit directly inside a subfolder of root.
        .filter(|(_, p)| p.parent().and_then(Path::parent) == Some(root))
        .filter(|(_, p)| std::fs::symlink_metadata(p).is_ok())
        .collect();
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out.dedup_by(|a, b| a.1 == b.1);
    out
}

/// The app itself plus Caches and Support parts, sized. Empty parts dropped.
fn parts(app: AppPart, leftovers: Vec<(AppPartKind, PathBuf)>) -> Vec<AppPart> {
    let mut parts = vec![app];
    for kind in [AppPartKind::Caches, AppPartKind::Support] {
        let paths: Vec<PathBuf> = leftovers.iter().filter(|(k, _)| *k == kind).map(|(_, p)| p.clone()).collect();
        let size: u64 = paths.iter().map(|p| dir_size(p).0).sum();
        if size > 0 {
            parts.push(AppPart { kind, size_bytes: size, paths: paths.iter().map(|p| p.to_string_lossy().into_owned()).collect() });
        }
    }
    parts
}

fn ms_of(t: std::io::Result<std::time::SystemTime>) -> Option<u64> {
    t.ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

mod mac {
    use super::*;

    pub(super) fn list(procs: &Procs) -> Vec<AppInfo> {
        let mut roots = vec![PathBuf::from("/Applications")];
        roots.extend(dirs::home_dir().map(|h| h.join("Applications")));
        let bundles: Vec<PathBuf> = roots
            .iter()
            .filter_map(|r| std::fs::read_dir(r).ok())
            .flat_map(|rd| rd.flatten().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "app"))
            .collect();
        bundles
            .par_iter()
            .filter_map(|bundle| {
                let info = info_plist(bundle);
                let id = info.as_ref().and_then(|i| i.get("CFBundleIdentifier")).and_then(|v| v.as_string()).map(str::to_owned);
                if id.as_deref().is_some_and(|id| id.starts_with("com.apple.")) {
                    return None;
                }
                let name = bundle.file_stem()?.to_string_lossy().into_owned();
                let path = bundle.to_string_lossy().into_owned();
                let app = AppPart { kind: AppPartKind::App, size_bytes: dir_size(bundle).0, paths: vec![path.clone()] };
                Some(AppInfo {
                    id: path.clone(),
                    parts: parts(app, leftovers(&name, id.as_deref())),
                    last_opened_ms: last_opened(bundle),
                    installed_ms: None,
                    running: procs.running_from(bundle),
                    source: AppSource::Bundle,
                    icon: info.as_ref().and_then(|i| icon_file(bundle, i)),
                    path,
                    name,
                })
            })
            .collect()
    }

    fn info_plist(bundle: &Path) -> Option<plist::Dictionary> {
        plist::from_file(bundle.join("Contents/Info.plist")).ok()
    }

    /// The bundle's `.icns`: `CFBundleIconFile` (extension optional), else
    /// `CFBundleIconName` for apps that also ship an asset catalog.
    fn icon_file(bundle: &Path, info: &plist::Dictionary) -> Option<String> {
        let resources = bundle.join("Contents/Resources");
        ["CFBundleIconFile", "CFBundleIconName"]
            .iter()
            .filter_map(|key| info.get(key)?.as_string())
            .filter(|name| safe_segment(name))
            .map(|name| {
                let file = if name.ends_with(".icns") { name.to_owned() } else { format!("{name}.icns") };
                resources.join(file)
            })
            .find(|p| p.is_file())
            .map(|p| p.to_string_lossy().into_owned())
    }

    /// Spotlight's last-used date; None if Spotlight never saw it opened.
    fn last_opened(bundle: &Path) -> Option<u64> {
        let raw = output("mdls", &["-raw", "-name", "kMDItemLastUsedDate", &bundle.to_string_lossy()])?;
        let t = chrono::DateTime::parse_from_str(&raw, "%Y-%m-%d %H:%M:%S %z").ok()?;
        u64::try_from(t.timestamp_millis()).ok()
    }

    /// Leftover locations in ~/Library, by kind. Only ones that exist.
    pub(super) fn leftovers(name: &str, id: Option<&str>) -> Vec<(AppPartKind, PathBuf)> {
        let Some(lib) = dirs::home_dir().map(|h| h.join("Library")) else { return Vec::new() };
        let mut out = Vec::new();
        if safe_segment(name) {
            out.extend([
                (AppPartKind::Support, lib.join("Application Support").join(name)),
                (AppPartKind::Caches, lib.join("Caches").join(name)),
                (AppPartKind::Caches, lib.join("Logs").join(name)),
            ]);
        }
        if let Some(id) = id.filter(|id| safe_segment(id)) {
            out.extend([
                (AppPartKind::Support, lib.join("Application Support").join(id)),
                (AppPartKind::Support, lib.join("Preferences").join(format!("{id}.plist"))),
                (AppPartKind::Caches, lib.join("Caches").join(id)),
                (AppPartKind::Caches, lib.join("HTTPStorages").join(id)),
                (AppPartKind::Caches, lib.join("WebKit").join(id)),
                (AppPartKind::Caches, lib.join("Saved Application State").join(format!("{id}.savedState"))),
            ]);
        }
        existing_under(&lib, out)
    }
}

mod windows {
    use super::*;
    use std::time::{Duration, Instant};

    /// Runtimes, drivers and updates other programs depend on.
    const SKIP_WORDS: &[&str] = &["Redistributable", "Runtime", "Driver", "SDK", "Update for", "Hotfix", "Security Update"];
    /// How long to wait for an uninstaller that hands off to a helper and exits.
    const WAIT_FOR_GONE: Duration = Duration::from_secs(10 * 60);

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct Entry {
        #[serde(rename = "PSPath")]
        ps_path: String,
        display_name: String,
        publisher: Option<String>,
        install_location: Option<String>,
        install_date: Option<String>,
        estimated_size: Option<u64>,
        uninstall_string: String,
        display_icon: Option<String>,
    }

    /// Every uninstall entry with a name and an uninstaller, as JSON from
    /// PowerShell (UTF-8, unlike `reg query`).
    fn entries() -> Vec<Entry> {
        let script = r#"[Console]::OutputEncoding=[Text.Encoding]::UTF8
$keys='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$e=@(Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.UninstallString -and -not $_.SystemComponent -and -not $_.ParentKeyName } | Select-Object PSPath,DisplayName,Publisher,InstallLocation,InstallDate,EstimatedSize,UninstallString,DisplayIcon)
ConvertTo-Json -InputObject $e -Compress"#;
        output("powershell", &["-NoProfile", "-NonInteractive", "-Command", script])
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default()
    }

    pub(super) fn list(procs: &Procs) -> Vec<AppInfo> {
        entries()
            .into_par_iter()
            .filter(|e| !SKIP_WORDS.iter().any(|w| e.display_name.contains(w)))
            .map(|e| {
                let location = PathBuf::from(e.install_location.as_deref().unwrap_or("").trim_matches('"'));
                let size = e.estimated_size.map(|kb| kb * 1024).filter(|s| *s > 0).unwrap_or_else(|| {
                    if location.as_os_str().is_empty() { 0 } else { dir_size(&location).0 }
                });
                let app = AppPart {
                    kind: AppPartKind::App,
                    size_bytes: size,
                    paths: vec![location.to_string_lossy().into_owned()].into_iter().filter(|p| !p.is_empty()).collect(),
                };
                AppInfo {
                    parts: parts(app, leftovers(&e, &location)),
                    last_opened_ms: None,
                    installed_ms: e.install_date.as_deref().and_then(parse_date),
                    running: procs.running_from(&location),
                    source: AppSource::Installer,
                    icon: e.display_icon.as_deref().and_then(icon_path),
                    path: location.to_string_lossy().into_owned(),
                    name: e.display_name,
                    id: e.ps_path,
                }
            })
            .collect()
    }

    /// `DisplayIcon` is `"C:\…\app.exe",0`: drop the quotes and the index.
    pub(super) fn icon_path(raw: &str) -> Option<String> {
        let path = raw.trim().rsplit_once(',').filter(|(_, n)| n.trim().parse::<i32>().is_ok()).map_or(raw.trim(), |(p, _)| p);
        let path = path.trim().trim_matches('"');
        (!path.is_empty()).then(|| path.to_owned())
    }

    /// Registry dates are "YYYYMMDD".
    fn parse_date(s: &str) -> Option<u64> {
        let d = chrono::NaiveDate::parse_from_str(s.trim(), "%Y%m%d").ok()?;
        u64::try_from(d.and_hms_opt(12, 0, 0)?.and_utc().timestamp_millis()).ok()
    }

    /// "7-Zip 23.01 (x64)" → "7-Zip": drop the version and anything in brackets.
    pub(super) fn short_name(display: &str) -> String {
        let base = display.split(" (").next().unwrap_or(display);
        let is_version = |w: &str| {
            let w = w.strip_prefix(['v', 'V']).unwrap_or(w);
            w.starts_with(|c: char| c.is_ascii_digit()) && w.chars().all(|c| c.is_ascii_digit() || c == '.')
        };
        let words: Vec<&str> = base.split(' ').collect();
        // The first word always stays ("7-Zip").
        let end = words.iter().skip(1).position(|w| is_version(w)).map_or(words.len(), |i| i + 1);
        words[..end].join(" ")
    }

    /// Folders in AppData named after the app (or its install folder),
    /// directly or under the publisher. Never the install folder itself —
    /// per-user programs live in AppData too, and that's the uninstaller's job.
    fn leftovers(e: &Entry, location: &Path) -> Vec<(AppPartKind, PathBuf)> {
        let Some(home) = dirs::home_dir() else { return Vec::new() };
        let roaming = dirs::config_dir().unwrap_or_else(|| home.join("AppData/Roaming"));
        let local = dirs::cache_dir().unwrap_or_else(|| home.join("AppData/Local"));
        let mut names = vec![e.display_name.clone(), short_name(&e.display_name)];
        names.extend(location.file_name().map(|n| n.to_string_lossy().into_owned()));
        names.retain(|n| safe_segment(n));
        names.dedup();
        let publisher = e.publisher.as_deref().map(str::trim).filter(|p| safe_segment(p));

        let mut out = Vec::new();
        for (root, kind) in [(&roaming, AppPartKind::Support), (&local, AppPartKind::Caches)] {
            for name in &names {
                out.push((kind, root.join(name)));
                if let Some(p) = publisher {
                    out.push((kind, root.join(p).join(name)));
                }
            }
        }
        let is_install = |p: &Path| !location.as_os_str().is_empty() && (p.starts_with(location) || location.starts_with(p));
        out.retain(|(_, p)| !is_install(p));
        // Up to two levels (publisher\name) below AppData\Roaming or Local.
        let mut kept: Vec<_> = out
            .into_iter()
            .filter(|(_, p)| {
                [&roaming, &local].iter().any(|r| p.parent() == Some(r.as_path()) || p.parent().and_then(Path::parent) == Some(r.as_path()))
            })
            .filter(|(_, p)| std::fs::symlink_metadata(p).is_ok())
            .collect();
        kept.sort_by(|a, b| a.1.cmp(&b.1));
        kept.dedup_by(|a, b| a.1 == b.1);
        kept
    }

    /// Split an UninstallString into program and arguments. Windows Installer
    /// entries often say `/I{GUID}` (change), which should be `/X` (remove).
    pub(super) fn split_command(cmd: &str) -> (String, String) {
        let cmd = cmd.trim();
        let (exe, args) = if let Some(rest) = cmd.strip_prefix('"') {
            let end = rest.find('"').unwrap_or(rest.len());
            (rest[..end].to_owned(), rest.get(end + 1..).unwrap_or("").trim().to_owned())
        } else {
            let lower = cmd.to_ascii_lowercase();
            let end = lower.find(".exe").map_or(cmd.find(' ').unwrap_or(cmd.len()), |i| i + 4);
            (cmd[..end].to_owned(), cmd[end..].trim().to_owned())
        };
        let args = if exe.to_ascii_lowercase().ends_with("msiexec.exe") || exe.eq_ignore_ascii_case("msiexec") {
            args.replacen("/I{", "/X{", 1).replacen("/i{", "/X{", 1)
        } else {
            args
        };
        (exe, args)
    }

    pub(super) fn uninstall(app: &AppInfo) -> Result<(), String> {
        let entry = entries()
            .into_iter()
            .find(|e| e.ps_path == app.id)
            .ok_or_else(|| format!("{} is already uninstalled.", app.name))?;
        let (exe, args) = split_command(&entry.uninstall_string);
        // Start-Process goes through the shell, so uninstallers that need
        // admin rights get the usual Windows prompt.
        let quote = |s: &str| format!("'{}'", s.replace('\'', "''"));
        let mut script = format!("Start-Process -Wait -FilePath {}", quote(&exe));
        if !args.is_empty() {
            script.push_str(&format!(" -ArgumentList {}", quote(&args)));
        }
        if output("powershell", &["-NoProfile", "-NonInteractive", "-Command", &script]).is_none() {
            return Err(format!("{}'s uninstaller didn't start.", app.name));
        }
        // Many uninstallers hand off to a copy of themselves and exit at
        // once, so wait for the entry to disappear.
        let started = Instant::now();
        while started.elapsed() < WAIT_FOR_GONE {
            if !entries().iter().any(|e| e.ps_path == app.id) {
                return Ok(());
            }
            std::thread::sleep(Duration::from_secs(2));
        }
        Err(format!("{} is still installed, so Sift left its files alone.", app.name))
    }
}

mod linux {
    use super::*;

    /// Snaps that are platform pieces other snaps run on.
    const SNAP_PLATFORM: &[&str] = &["core", "bare", "snapd", "gnome-", "gtk-common-themes", "kde-frameworks", "mesa-"];

    pub(super) fn list(procs: &Procs) -> (bool, Vec<AppInfo>) {
        let Some(home) = dirs::home_dir() else { return (false, Vec::new()) };
        let flatpaks = flatpaks(&home);
        let snaps = snaps(&home, procs);
        let appimages = appimages(&home, procs);
        let supported = flatpaks.is_some() || snaps.is_some() || !appimages.is_empty();
        let apps = flatpaks.into_iter().flatten().chain(snaps.into_iter().flatten()).chain(appimages).collect();
        (supported, apps)
    }

    /// None when Flatpak isn't installed.
    fn flatpaks(home: &Path) -> Option<Vec<AppInfo>> {
        let out = output("flatpak", &["list", "--app", "--columns=application,name,installation"])?;
        let running = output("flatpak", &["ps", "--columns=application"]).unwrap_or_default();
        let apps = out
            .lines()
            .filter_map(|line| {
                let mut cols = line.split('\t');
                let id = cols.next()?.trim().to_owned();
                let name = cols.next()?.trim().to_owned();
                let installation = cols.next().unwrap_or("system").trim().to_owned();
                if !safe_segment(&id) {
                    return None;
                }
                let dir = if installation == "user" {
                    dirs::data_dir()?.join("flatpak/app").join(&id)
                } else {
                    PathBuf::from("/var/lib/flatpak/app").join(&id)
                };
                let app = AppPart { kind: AppPartKind::App, size_bytes: dir_size(&dir).0, paths: Vec::new() };
                // Its sandboxed home: settings, caches and anything saved inside the app.
                let data_dir = home.join(".var/app").join(&id);
                let data: Vec<_> = data_dir.exists().then_some((AppPartKind::Support, data_dir)).into_iter().collect();
                let exports = if installation == "user" {
                    dirs::data_dir().map(|d| d.join("flatpak/exports/share/icons/hicolor"))
                } else {
                    Some(PathBuf::from("/var/lib/flatpak/exports/share/icons/hicolor"))
                };
                let icon = exports.and_then(|root| {
                    ["128x128", "256x256", "512x512", "64x64", "scalable"]
                        .iter()
                        .flat_map(|size| ["png", "svg"].map(|ext| root.join(size).join("apps").join(format!("{id}.{ext}"))))
                        .find(|p| p.is_file())
                });
                Some(AppInfo {
                    id: format!("flatpak:{installation}:{id}"),
                    icon: icon.map(|p| p.to_string_lossy().into_owned()),
                    path: dir.to_string_lossy().into_owned(),
                    source: AppSource::Flatpak,
                    last_opened_ms: None,
                    installed_ms: None,
                    running: running.lines().any(|l| l.trim() == id),
                    parts: parts(app, data),
                    name,
                })
            })
            .collect();
        Some(apps)
    }

    /// None when snapd isn't installed.
    fn snaps(home: &Path, procs: &Procs) -> Option<Vec<AppInfo>> {
        let out = output("snap", &["list"])?;
        let apps = out
            .lines()
            .skip(1)
            .filter_map(|line| {
                let cols: Vec<&str> = line.split_whitespace().collect();
                let (name, rev) = (*cols.first()?, *cols.get(2)?);
                let notes = cols.get(5).copied().unwrap_or("");
                if !safe_segment(name)
                    || SNAP_PLATFORM.iter().any(|p| name.starts_with(p))
                    || ["base", "core", "snapd", "gadget", "kernel"].iter().any(|n| notes.contains(n))
                {
                    return None;
                }
                let file = PathBuf::from(format!("/var/lib/snapd/snaps/{name}_{rev}.snap"));
                let size = std::fs::metadata(&file).map_or(0, |m| m.len());
                let app = AppPart { kind: AppPartKind::App, size_bytes: size, paths: Vec::new() };
                let data = existing_under(home, vec![(AppPartKind::Support, home.join("snap").join(name))]);
                let gui = PathBuf::from(format!("/snap/{name}/current/meta/gui"));
                let icon = ["icon.png", "icon.svg", &format!("{name}.png"), &format!("{name}.svg")]
                    .iter()
                    .map(|f| gui.join(f))
                    .find(|p| p.is_file());
                Some(AppInfo {
                    id: format!("snap:{name}"),
                    icon: icon.map(|p| p.to_string_lossy().into_owned()),
                    name: name.to_owned(),
                    path: format!("/snap/{name}"),
                    source: AppSource::Snap,
                    last_opened_ms: None,
                    installed_ms: None,
                    running: procs.running_from(&PathBuf::from(format!("/snap/{name}"))),
                    parts: parts(app, data),
                })
            })
            .collect();
        Some(apps)
    }

    /// AppImages in the usual places, plus the menu entries made for them.
    fn appimages(home: &Path, procs: &Procs) -> Vec<AppInfo> {
        let dirs = [home.join("Applications"), home.join("AppImages"), home.join(".local/bin")];
        let menu = home.join(".local/share/applications");
        let menu_entries: Vec<(PathBuf, String)> = std::fs::read_dir(&menu)
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().is_some_and(|x| x == "desktop"))
                    .filter_map(|p| Some((p.clone(), std::fs::read_to_string(&p).ok()?)))
                    .collect()
            })
            .unwrap_or_default();
        dirs.iter()
            .filter_map(|d| std::fs::read_dir(d).ok())
            .flat_map(|rd| rd.flatten().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("appimage")) && p.is_file())
            .map(|file| {
                let stem = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let name = app_name(&stem);
                let file_str = file.to_string_lossy().into_owned();
                let mut app_paths = vec![file_str.clone()];
                app_paths.extend(
                    menu_entries.iter().filter(|(_, text)| text.contains(&file_str)).map(|(p, _)| p.to_string_lossy().into_owned()),
                );
                let size = app_paths.iter().map(|p| dir_size(Path::new(p)).0).sum();
                let meta = std::fs::metadata(&file).ok();
                // Its menu entry's `Icon=`, when that's a file path.
                let icon = menu_entries
                    .iter()
                    .filter(|(_, text)| text.contains(&file_str))
                    .flat_map(|(_, text)| text.lines())
                    .find_map(|l| l.strip_prefix("Icon=").map(str::trim).filter(|p| p.starts_with('/')).map(str::to_owned));
                AppInfo {
                    id: file_str.clone(),
                    icon,
                    parts: parts(AppPart { kind: AppPartKind::App, size_bytes: size, paths: app_paths }, leftovers(home, &name)),
                    last_opened_ms: meta.as_ref().and_then(|m| ms_of(m.accessed())),
                    installed_ms: meta.as_ref().and_then(|m| ms_of(m.modified())),
                    running: procs.appimages.iter().any(|p| p == &file),
                    source: AppSource::AppImage,
                    path: file_str,
                    name,
                }
            })
            .collect()
    }

    /// "Obsidian-1.5.3-x86_64" → "Obsidian".
    pub(super) fn app_name(stem: &str) -> String {
        stem.split(['-', '_']).next().unwrap_or(stem).trim().to_owned()
    }

    /// ~/.config, ~/.cache and ~/.local/share folders named after the app
    /// (as written, and lower-case).
    fn leftovers(home: &Path, name: &str) -> Vec<(AppPartKind, PathBuf)> {
        if !safe_segment(name) {
            return Vec::new();
        }
        let config = dirs::config_dir().unwrap_or_else(|| home.join(".config"));
        let cache = dirs::cache_dir().unwrap_or_else(|| home.join(".cache"));
        let share = dirs::data_dir().unwrap_or_else(|| home.join(".local/share"));
        let mut out = Vec::new();
        for n in [name.to_owned(), name.to_lowercase()] {
            out.push((AppPartKind::Support, config.join(&n)));
            out.push((AppPartKind::Caches, cache.join(&n)));
            out.push((AppPartKind::Support, share.join(&n)));
        }
        out.retain(|(_, p)| [&config, &cache, &share].iter().any(|r| p.parent() == Some(r.as_path())));
        out.retain(|(_, p)| std::fs::symlink_metadata(p).is_ok());
        out.sort_by(|a, b| a.1.cmp(&b.1));
        out.dedup_by(|a, b| a.1 == b.1);
        out
    }

    pub(super) fn flatpak_uninstall(app: &AppInfo) -> Result<(), String> {
        let mut parts = app.id.splitn(3, ':').skip(1);
        let (Some(installation), Some(id)) = (parts.next(), parts.next()) else {
            return Err("That app isn't a Flatpak.".into());
        };
        let scope = if installation == "user" { "--user" } else { "--system" };
        output("flatpak", &["uninstall", "--noninteractive", "-y", scope, id])
            .map(|_| ())
            .ok_or_else(|| format!("Couldn't uninstall {}. It may need your password.", app.name))
    }

    pub(super) fn snap_remove(app: &AppInfo) -> Result<(), String> {
        let name = app.id.strip_prefix("snap:").filter(|n| safe_segment(n)).ok_or("That app isn't a Snap.")?;
        // Removing a snap needs root; pkexec shows the system's password prompt.
        output("pkexec", &["snap", "remove", name])
            .map(|_| ())
            .ok_or_else(|| format!("Couldn't uninstall {}. It may need your password.", app.name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostile_bundle_ids_are_ignored() {
        assert!(safe_segment("com.figma.Desktop"));
        assert!(safe_segment("Final Cut Pro"));
        assert!(!safe_segment("/Users/me/Documents"));
        assert!(!safe_segment("../../Documents"));
        assert!(!safe_segment(".."));
        assert!(!safe_segment(""));
        assert!(!safe_segment("C:\\Users\\me\\Documents"));
        // An absolute id would otherwise replace the whole joined path.
        let docs = dirs::home_dir().unwrap().join("Documents");
        let found = mac::leftovers("Safe", Some(&docs.to_string_lossy()));
        assert!(found.iter().all(|(_, p)| p != &docs));
    }

    #[test]
    fn windows_icon_paths() {
        assert_eq!(windows::icon_path(r#""C:\Program Files\App\app.exe",0"#).as_deref(), Some(r"C:\Program Files\App\app.exe"));
        assert_eq!(windows::icon_path(r"C:\Tools\tool.ico").as_deref(), Some(r"C:\Tools\tool.ico"));
        assert_eq!(windows::icon_path(r"C:\A, B\app.exe,-101").as_deref(), Some(r"C:\A, B\app.exe"));
        assert_eq!(windows::icon_path("  "), None);
    }

    #[test]
    fn windows_names_and_commands() {
        assert_eq!(windows::short_name("7-Zip 23.01 (x64)"), "7-Zip");
        assert_eq!(windows::short_name("Mozilla Firefox (x64 en-US)"), "Mozilla Firefox");
        assert_eq!(windows::short_name("Notepad++ v8.6.2"), "Notepad++");
        assert_eq!(
            windows::split_command(r#""C:\Program Files\App\uninstall.exe" /S"#),
            (r"C:\Program Files\App\uninstall.exe".to_owned(), "/S".to_owned())
        );
        assert_eq!(
            windows::split_command("MsiExec.exe /I{1234-ABCD}"),
            ("MsiExec.exe".to_owned(), "/X{1234-ABCD}".to_owned())
        );
        assert_eq!(
            windows::split_command(r"C:\Program Files\Tool\unins000.exe"),
            (r"C:\Program Files\Tool\unins000.exe".to_owned(), String::new())
        );
    }

    #[test]
    fn appimage_names() {
        assert_eq!(linux::app_name("Obsidian-1.5.3"), "Obsidian");
        assert_eq!(linux::app_name("Joplin_2.14.x86_64"), "Joplin");
    }
}
