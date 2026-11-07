//! Home's "App leftovers" (macOS): settings and caches in ~/Library named
//! after an app that's no longer installed. Deliberately cautious — an
//! entry only counts when every check agrees:
//!
//! - its name is a plain reverse-DNS id (`com.vendor.App`), not Apple's;
//! - no installed app, background agent or helper comes from that vendor;
//! - nothing in it has changed for `MIN_AGE` (an app in use writes here);
//! - Spotlight doesn't know an app with that id anywhere on the disk.
//!
//! Everything found is held in Restore like any other removal.

use super::apps::safe_segment;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const MIN_AGE: Duration = Duration::from_secs(90 * 24 * 60 * 60);

/// ~/Library subfolders apps leave things in, and the suffix their entries
/// carry ("" for folders named exactly by id).
const PLACES: &[(&str, &str)] = &[
    ("Application Support", ""),
    ("Caches", ""),
    ("HTTPStorages", ""),
    ("WebKit", ""),
    ("Logs", ""),
    ("Preferences", ".plist"),
    ("Saved Application State", ".savedState"),
];

/// Vendors of libraries that many apps embed (updaters, crash reporters,
/// image caches). Their folders aren't one app's leftovers.
const SHARED_VENDORS: &[&str] = &[
    "org.sparkle-project",
    "com.plausiblelabs",
    "com.onevcat",
    "org.webkit",
    "com.crashlytics",
    "io.sentry",
    "com.squirrel",
    "com.github.electron",
];

pub struct Leftovers {
    /// How many uninstalled apps these came from.
    pub apps: u64,
    pub paths: Vec<PathBuf>,
}

pub fn find() -> Leftovers {
    let none = Leftovers { apps: 0, paths: Vec::new() };
    if !cfg!(target_os = "macos") {
        return none;
    }
    let Some(home) = dirs::home_dir() else { return none };
    let lib = home.join("Library");
    let vendors = installed_vendors(&home);

    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    for (folder, suffix) in PLACES {
        let Ok(rd) = std::fs::read_dir(lib.join(folder)) else { continue };
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(id) = name.strip_suffix(suffix).filter(|id| is_app_id(id)) else { continue };
            if vendors.contains(&vendor(id)) || !untouched(&entry.path()) {
                continue;
            }
            candidates.push((id.to_ascii_lowercase(), entry.path()));
        }
    }

    // Last check: is an app with any of these ids installed anywhere?
    let ids: HashSet<String> = candidates.iter().map(|(id, _)| id.clone()).collect();
    match spotlight_installed(&ids) {
        Some(installed) => candidates.retain(|(id, _)| !installed.contains(id)),
        None => candidates.clear(),
    }

    let apps: HashSet<String> = candidates.iter().map(|(id, _)| app_key(id)).collect();
    let mut paths: Vec<PathBuf> = candidates.into_iter().map(|(_, p)| p).collect();
    paths.sort();
    Leftovers { apps: apps.len() as u64, paths }
}

/// `com.vendor.App` with at least three plain parts. Apple's are skipped.
fn is_app_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    safe_segment(id)
        && !id.contains(' ')
        && parts.len() >= 3
        && parts.iter().all(|p| !p.is_empty())
        && (2..=6).contains(&parts[0].len())
        && parts[0].chars().all(|c| c.is_ascii_lowercase())
        && !id.to_ascii_lowercase().starts_with("com.apple.")
        && !SHARED_VENDORS.contains(&vendor(id).as_str())
}

/// "com.vendor" — the part every app and helper from one company shares.
fn vendor(id: &str) -> String {
    id.split('.').take(2).collect::<Vec<_>>().join(".").to_ascii_lowercase()
}

/// "com.vendor.app" — helpers (`com.vendor.app.helper`) count as their app.
fn app_key(id: &str) -> String {
    id.split('.').take(3).collect::<Vec<_>>().join(".")
}

/// Neither the entry nor anything directly inside it changed recently.
fn untouched(path: &Path) -> bool {
    let Some(cutoff) = SystemTime::now().checked_sub(MIN_AGE) else { return false };
    let old = |p: &Path| std::fs::symlink_metadata(p).and_then(|m| m.modified()).is_ok_and(|t| t < cutoff);
    if !old(path) {
        return false;
    }
    match std::fs::read_dir(path) {
        Ok(rd) => rd.flatten().all(|e| old(&e.path())),
        Err(_) => path.is_file(),
    }
}

/// Vendors of everything installed: apps (and the helpers inside folders
/// like /Applications/Setapp), plus background agents and helper tools,
/// which often belong to apps installed somewhere unusual.
fn installed_vendors(home: &Path) -> HashSet<String> {
    let mut ids = HashSet::new();
    let app_roots = [
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        home.join("Applications"),
    ];
    for root in &app_roots {
        collect_bundle_ids(root, 2, &mut ids);
    }
    let agent_dirs = [
        home.join("Library/LaunchAgents"),
        PathBuf::from("/Library/LaunchAgents"),
        PathBuf::from("/Library/LaunchDaemons"),
        PathBuf::from("/Library/PrivilegedHelperTools"),
    ];
    for dir in &agent_dirs {
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            ids.insert(name.trim_end_matches(".plist").to_owned());
        }
    }
    ids.iter().filter(|id| id.contains('.')).map(|id| vendor(id)).collect()
}

fn collect_bundle_ids(dir: &Path, depth: u32, ids: &mut HashSet<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|x| x == "app") {
            let info: Option<plist::Dictionary> = plist::from_file(path.join("Contents/Info.plist")).ok();
            if let Some(id) = info.as_ref().and_then(|i| i.get("CFBundleIdentifier")).and_then(|v| v.as_string()) {
                ids.insert(id.to_owned());
            }
        } else if depth > 1 && entry.file_type().is_ok_and(|t| t.is_dir()) {
            collect_bundle_ids(&path, depth - 1, ids);
        }
    }
}

/// Which of `ids` Spotlight knows an installed app for, lowercased — one
/// `mdfind` for all of them. None if Spotlight is off or `mdfind` fails:
/// when unsure, leave everything alone.
fn spotlight_installed(ids: &HashSet<String>) -> Option<HashSet<String>> {
    // Only plain ids reach the query (no quotes or spaces to escape).
    let ids: Vec<&String> = ids.iter().filter(|id| is_app_id(id)).collect();
    if ids.is_empty() {
        return Some(HashSet::new());
    }
    let query = ids
        .iter()
        .map(|id| format!("kMDItemCFBundleIdentifier == '{id}'c"))
        .collect::<Vec<_>>()
        .join(" || ");
    let out = crate::process_ext::output("mdfind", &["-attr", "kMDItemCFBundleIdentifier", &query])?;
    // Lines look like "/Applications/X.app   kMDItemCFBundleIdentifier = com.x.App".
    Some(
        out.lines()
            .filter_map(|l| l.rsplit_once("kMDItemCFBundleIdentifier = "))
            .map(|(_, id)| id.trim().trim_matches('"').to_ascii_lowercase())
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_third_party_ids() {
        assert!(is_app_id("com.figma.Desktop"));
        assert!(is_app_id("org.videolan.vlc"));
        assert!(!is_app_id("com.apple.Safari"));
        assert!(!is_app_id("Google"));
        assert!(!is_app_id("com.vendor"));
        assert!(!is_app_id("Firefox Profiles.old.x"));
        assert!(!is_app_id("com..x"));
        assert!(!is_app_id("org.sparkle-project.Downloader"));
        assert_eq!(vendor("com.Figma.Desktop.helper"), "com.figma");
        assert_eq!(app_key("com.figma.desktop.helper"), "com.figma.desktop");
    }

    #[test]
    fn recently_changed_folders_are_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("com.example.App");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("state"), b"x").unwrap();
        assert!(!untouched(&dir));
    }
}

/// Manual check of what this machine would be offered (read-only):
/// `cargo test print_leftovers -- --ignored --nocapture`
#[cfg(test)]
mod manual {
    #[test]
    #[ignore]
    fn print_leftovers() {
        let found = super::find();
        println!("{} apps", found.apps);
        for p in &found.paths {
            println!("{:>10}  {}", super::super::dir_size(p).0, p.display());
        }
    }
}
