//! Helpers for running external tools (docker, xcrun, diskutil, …) from a
//! GUI app.

use std::process::Command;

/// GUI launches inherit a minimal PATH (launchd on macOS), so tools from
/// Homebrew or Docker Desktop aren't found. Prepend the usual dirs. Call
/// once at startup, before any threads exist.
pub fn augment_path() {
    use std::path::PathBuf;
    let mut candidates: Vec<PathBuf> = if cfg!(target_os = "macos") {
        vec!["/opt/homebrew/bin".into(), "/usr/local/bin".into()]
    } else if cfg!(unix) {
        vec!["/usr/local/bin".into(), "/snap/bin".into()]
    } else {
        Vec::new()
    };
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin"));
    }
    let current = std::env::var_os("PATH").unwrap_or_default();
    let existing: Vec<PathBuf> = std::env::split_paths(&current).collect();
    let mut merged: Vec<PathBuf> = candidates
        .into_iter()
        .filter(|p| p.is_dir() && !existing.contains(p))
        .collect();
    merged.extend(existing);
    if let Ok(joined) = std::env::join_paths(merged) {
        // SAFETY: called once at startup, before any threads are spawned.
        unsafe { std::env::set_var("PATH", joined) };
    }
}

/// Keep child processes from flashing a console window on Windows.
pub trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for Command {
    #[cfg(windows)]
    fn no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        self.creation_flags(CREATE_NO_WINDOW)
    }

    #[cfg(not(windows))]
    fn no_window(&mut self) -> &mut Self {
        self
    }
}

/// Run a command and return trimmed stdout, or None if it couldn't run or failed.
pub fn output(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).no_window().output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}
