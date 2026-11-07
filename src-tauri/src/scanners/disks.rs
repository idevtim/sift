use crate::models::{Drive, DriveKind};
use sysinfo::Disks;

/// Mounted volumes worth showing. On macOS the APFS system/data split shows
/// up as several mounts under `/System/Volumes`; `/` already reports the
/// shared container's capacity, so those are skipped.
pub fn list() -> Vec<Drive> {
    let disks = Disks::new_with_refreshed_list();
    let mut out: Vec<Drive> = disks
        .list()
        .iter()
        .filter_map(|d| {
            let mount = d.mount_point().to_string_lossy().into_owned();
            if !is_user_visible(&mount) || d.total_space() == 0 {
                return None;
            }
            let name = display_name(&d.name().to_string_lossy(), &mount);
            let kind = classify(&name, &mount, d.is_removable());
            Some(Drive {
                id: mount.clone(),
                name,
                kind,
                capacity_bytes: d.total_space(),
                used_bytes: d.total_space().saturating_sub(d.available_space()),
                protected: kind == DriveKind::Backup,
                mount_point: mount,
            })
        })
        .collect();
    // System drive first, then by name.
    out.sort_by_key(|d| (d.kind != DriveKind::Internal || !is_root(&d.mount_point), d.name.clone()));
    out.dedup_by(|a, b| a.mount_point == b.mount_point);
    out
}

fn is_root(mount: &str) -> bool {
    mount == "/" || mount.eq_ignore_ascii_case("C:\\")
}

fn is_user_visible(mount: &str) -> bool {
    if cfg!(target_os = "macos") {
        return mount == "/" || mount.starts_with("/Volumes/");
    }
    if cfg!(target_os = "linux") {
        return mount == "/"
            || mount == "/home"
            || mount.starts_with("/media/")
            || mount.starts_with("/mnt/")
            || mount.starts_with("/run/media/");
    }
    true
}

fn display_name(raw: &str, mount: &str) -> String {
    if !raw.is_empty() && !raw.starts_with("/dev/") {
        return raw.to_string();
    }
    if cfg!(target_os = "macos") && mount == "/" {
        return "Macintosh HD".into();
    }
    mount.rsplit(['/', '\\']).find(|s| !s.is_empty()).unwrap_or(mount).to_string()
}

fn classify(name: &str, mount: &str, removable: bool) -> DriveKind {
    let lower = name.to_lowercase();
    if lower.contains("time machine") || lower.contains("backup") {
        return DriveKind::Backup;
    }
    if is_root(mount) || mount == "/home" {
        return DriveKind::Internal;
    }
    // Camera cards conventionally carry a DCIM folder at the root.
    if std::path::Path::new(mount).join("DCIM").is_dir() {
        return DriveKind::Sd;
    }
    if removable || mount.starts_with("/Volumes/") || mount.starts_with("/media/") || mount.starts_with("/run/media/") {
        return DriveKind::External;
    }
    DriveKind::Internal
}
