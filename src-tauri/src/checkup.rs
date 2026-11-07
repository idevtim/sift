//! Weekly check-up. The OS starts Sift every Sunday at 10:00 with
//! `--weekly-check` (a launchd agent on macOS, a Task Scheduler task on
//! Windows, a systemd user timer on Linux). In that mode Sift opens no
//! window: it sizes Home's safe categories and, when there's space worth
//! freeing, posts one notification. It never removes anything.
//!
//! All three schedulers catch up on a missed Sunday when the computer
//! next wakes.

use crate::models::Safety;
use crate::process_ext::output;
use crate::scanners;
use std::fs;
use std::path::PathBuf;

pub const FLAG: &str = "--weekly-check";

/// Must match `identifier` in tauri.conf.json: macOS and Windows attribute
/// notifications to it, and clicking one opens Sift.
const IDENTIFIER: &str = "com.sift.app";

/// Below this it isn't worth interrupting anyone.
const MIN_BYTES: u64 = 1_000_000_000;

pub fn requested() -> bool {
    std::env::args().any(|a| a == FLAG)
}

/// Check-up mode: measure, maybe notify, return (the caller exits).
pub fn run() {
    // Without Full Disk Access, looking in Downloads from the background
    // could pop up a macOS permission prompt out of nowhere. Skip instead.
    if !crate::access::granted() {
        return;
    }
    let bytes: u64 = scanners::findings::scan()
        .iter()
        .filter(|f| f.safety == Safety::Safe)
        .map(|f| f.size_bytes)
        .sum();
    if bytes >= MIN_BYTES {
        notify(&format!("You can free up {}", gb(bytes)));
    }
}

/// "9.1 GB" — same as the app's `fmtGB`.
fn gb(bytes: u64) -> String {
    let tenths = (bytes as f64 / 1e8).round() / 10.0;
    format!("{tenths} GB")
}

fn notify(title: &str) {
    let mut n = notify_rust::Notification::new();
    n.summary(title)
        .body("Open Sift to see what's safe to remove. Nothing is removed until you say so.")
        .auto_icon();
    #[cfg(target_os = "macos")]
    let _ = notify_rust::set_application(IDENTIFIER);
    #[cfg(windows)]
    n.app_id(IDENTIFIER);
    if let Err(e) = n.show() {
        eprintln!("weekly check-up notification failed: {e}");
    }
}

/// Turn the weekly schedule on or off. Called at every launch so the
/// schedule follows the app if it moves (or an AppImage is replaced).
pub fn schedule(enabled: bool) -> Result<(), String> {
    let exe = program()?;
    if cfg!(target_os = "macos") {
        launchd(enabled, &exe)
    } else if cfg!(windows) {
        task_scheduler(enabled, &exe)
    } else {
        systemd(enabled, &exe)
    }
}

/// What the scheduler should start. An AppImage runs from a temporary
/// mount, so point at the AppImage file itself.
fn program() -> Result<PathBuf, String> {
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return Ok(appimage.into());
    }
    std::env::current_exe().map_err(|e| format!("Couldn't find Sift's own program: {e}"))
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "No home folder".to_owned())
}

// ── macOS: ~/Library/LaunchAgents ─────────────────────────────────────

fn launchd(enabled: bool, exe: &std::path::Path) -> Result<(), String> {
    let label = format!("{IDENTIFIER}.weekly-check");
    let plist_path = home()?.join(format!("Library/LaunchAgents/{label}.plist"));
    let domain = format!("gui/{}", uid()?);
    let service = format!("{domain}/{label}");

    if !enabled {
        let _ = output("launchctl", &["bootout", &service]);
        return match fs::remove_file(&plist_path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Couldn't turn off the check-up: {e}")),
            _ => Ok(()),
        };
    }

    let mut when = plist::Dictionary::new();
    when.insert("Weekday".into(), 0.into());
    when.insert("Hour".into(), 10.into());
    when.insert("Minute".into(), 0.into());
    let mut job = plist::Dictionary::new();
    job.insert("Label".into(), label.clone().into());
    job.insert(
        "ProgramArguments".into(),
        vec![plist::Value::from(exe.to_string_lossy().into_owned()), FLAG.into()].into(),
    );
    job.insert("StartCalendarInterval".into(), when.into());
    job.insert("ProcessType".into(), "Background".into());
    let mut xml = Vec::new();
    plist::to_writer_xml(&mut xml, &job).map_err(|e| e.to_string())?;

    // Already scheduled with the same program: leave it be.
    let loaded = output("launchctl", &["print", &service]).is_some();
    if loaded && fs::read(&plist_path).is_ok_and(|old| old == xml) {
        return Ok(());
    }
    if let Some(dir) = plist_path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&plist_path, &xml).map_err(|e| format!("Couldn't save the check-up schedule: {e}"))?;
    let _ = output("launchctl", &["bootout", &service]);
    output("launchctl", &["bootstrap", &domain, &plist_path.to_string_lossy()])
        .map(drop)
        .ok_or_else(|| "macOS didn't accept the check-up schedule".to_owned())
}

/// The current user's id, without unsafe libc calls: it owns their home.
#[cfg(unix)]
fn uid() -> Result<u32, String> {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(home()?).map(|m| m.uid()).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn uid() -> Result<u32, String> {
    Err("not supported".into())
}

// ── Windows: Task Scheduler ───────────────────────────────────────────

const TASK_NAME: &str = "Sift weekly check-up";

fn task_scheduler(enabled: bool, exe: &std::path::Path) -> Result<(), String> {
    // PowerShell single-quoted strings: the only escape is '' for '.
    let quote = |s: &str| format!("'{}'", s.replace('\'', "''"));
    let script = if enabled {
        format!(
            "$a = New-ScheduledTaskAction -Execute {exe} -Argument {flag}; \
             $t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 10am; \
             $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries \
                  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30); \
             Register-ScheduledTask -TaskName {name} -Action $a -Trigger $t -Settings $s -Force | Out-Null",
            exe = quote(&exe.to_string_lossy()),
            flag = quote(FLAG),
            name = quote(TASK_NAME),
        )
    } else {
        format!(
            "Unregister-ScheduledTask -TaskName {} -Confirm:$false -ErrorAction SilentlyContinue",
            quote(TASK_NAME)
        )
    };
    output("powershell", &["-NoProfile", "-NonInteractive", "-Command", &script])
        .map(drop)
        .ok_or_else(|| "Windows didn't accept the check-up schedule".to_owned())
}

// ── Linux: systemd user timer ─────────────────────────────────────────

const UNIT: &str = "sift-weekly-check";

fn systemd(enabled: bool, exe: &std::path::Path) -> Result<(), String> {
    let dir = home()?.join(".config/systemd/user");
    let service = dir.join(format!("{UNIT}.service"));
    let timer = dir.join(format!("{UNIT}.timer"));
    let timer_name = format!("{UNIT}.timer");

    if !enabled {
        let _ = output("systemctl", &["--user", "disable", "--now", &timer_name]);
        let _ = fs::remove_file(&service);
        let _ = fs::remove_file(&timer);
        let _ = output("systemctl", &["--user", "daemon-reload"]);
        return Ok(());
    }

    // systemd unit quoting: wrap in "", escape \ and ".
    let exec = exe.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    let service_text = format!(
        "[Unit]\nDescription=Sift weekly check-up\n\n[Service]\nType=oneshot\nExecStart=\"{exec}\" {FLAG}\n"
    );
    let timer_text = "[Unit]\nDescription=Sift weekly check-up\n\n[Timer]\nOnCalendar=Sun *-*-* 10:00:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n";

    let unchanged = fs::read_to_string(&service).is_ok_and(|s| s == service_text)
        && fs::read_to_string(&timer).is_ok_and(|s| s == timer_text);
    if !unchanged {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(&service, service_text).map_err(|e| format!("Couldn't save the check-up schedule: {e}"))?;
        fs::write(&timer, timer_text).map_err(|e| format!("Couldn't save the check-up schedule: {e}"))?;
        output("systemctl", &["--user", "daemon-reload"]).ok_or_else(|| "systemd isn't available".to_owned())?;
    }
    output("systemctl", &["--user", "enable", "--now", &timer_name])
        .map(drop)
        .ok_or_else(|| "systemd didn't accept the check-up schedule".to_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn sizes_read_like_the_app() {
        assert_eq!(super::gb(9_140_000_000), "9.1 GB");
        assert_eq!(super::gb(12_000_000_000), "12 GB");
    }
}
