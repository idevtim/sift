//! Full Disk Access (macOS). There's no API to ask whether an app has it,
//! so Sift tries to read a few places only Full Disk Access unlocks. The
//! attempt also makes macOS list Sift in System Settings → Full Disk Access.
//! Windows and Linux have no equivalent, so they always report access.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

const SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/// Whether Sift can see macOS's private folders. Reading these never shows
/// a prompt: without access the read just fails.
pub fn granted() -> bool {
    if !cfg!(target_os = "macos") {
        return true;
    }
    let mut probes = vec![PathBuf::from("/Library/Application Support/com.apple.TCC/TCC.db")];
    if let Some(home) = dirs::home_dir() {
        probes.push(home.join("Library/Safari"));
        probes.push(home.join("Library/Mail"));
    }
    let mut denied = false;
    for p in &probes {
        let read = if p.is_dir() { fs::read_dir(p).map(drop) } else { fs::File::open(p).map(drop) };
        match read {
            Ok(()) => return true,
            Err(e) if e.kind() == ErrorKind::PermissionDenied => denied = true,
            Err(_) => {}
        }
    }
    !denied
}

/// Open System Settings at Full Disk Access. Probes first so Sift is already
/// in the list when the pane appears.
pub fn open_settings() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    granted();
    std::process::Command::new("open")
        .arg(SETTINGS_URL)
        .status()
        .map_err(|e| format!("Couldn't open System Settings: {e}"))
        .map(drop)
}
