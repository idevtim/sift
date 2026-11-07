//! App icons for the Apps page, as small PNG (or SVG) data URLs. Lists only
//! carry where an icon lives; this converts one when the row asks for it
//! and caches the PNG in Sift's data folder.
//!
//! - macOS: the bundle's `.icns`, converted with `sips`.
//! - Windows: the program's `DisplayIcon` (.exe/.ico), via PowerShell.
//! - Linux: Flatpak/Snap/AppImage `.png` or `.svg` files, read as-is.

use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};

/// Icons are drawn at 42 px; 128 covers 2x and 3x screens.
const SIZE: u32 = 128;
/// Bigger than any sane icon file; anything over is skipped.
const MAX_BYTES: u64 = 2_000_000;

pub fn data_url(source: &Path, cache_dir: &Path) -> Option<String> {
    let ext = source.extension()?.to_str()?.to_ascii_lowercase();
    let meta = fs::metadata(source).ok()?;
    if !meta.is_file() || meta.len() > MAX_BYTES * 20 {
        return None;
    }
    let (mime, bytes) = match ext.as_str() {
        "png" if meta.len() <= MAX_BYTES => ("image/png", fs::read(source).ok()?),
        "svg" if meta.len() <= MAX_BYTES => ("image/svg+xml", fs::read(source).ok()?),
        "icns" | "exe" | "ico" => ("image/png", converted(source, &meta, cache_dir)?),
        _ => return None,
    };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Convert to a cached PNG, keyed by path and modified time so an updated
/// app gets a fresh icon.
fn converted(source: &Path, meta: &fs::Metadata, cache_dir: &Path) -> Option<Vec<u8>> {
    let stamp = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    let key = blake3::hash(format!("{}|{stamp}", source.display()).as_bytes()).to_hex();
    let out: PathBuf = cache_dir.join(format!("{}.png", &key[..32]));
    if let Ok(bytes) = fs::read(&out) {
        return Some(bytes);
    }
    fs::create_dir_all(cache_dir).ok()?;
    let src = source.to_string_lossy();
    let dst = out.to_string_lossy();
    if cfg!(target_os = "macos") {
        let size = SIZE.to_string();
        crate::process_ext::output("sips", &["-s", "format", "png", "-Z", &size, &src, "--out", &dst])?;
    } else if cfg!(windows) {
        // PowerShell single-quoted strings: the only escape is '' for '.
        let quote = |s: &str| format!("'{}'", s.replace('\'', "''"));
        let script = format!(
            "Add-Type -AssemblyName System.Drawing; \
             $i = [System.Drawing.Icon]::ExtractAssociatedIcon({}); \
             $i.ToBitmap().Save({}, [System.Drawing.Imaging.ImageFormat]::Png)",
            quote(&src),
            quote(&dst)
        );
        crate::process_ext::output("powershell", &["-NoProfile", "-NonInteractive", "-Command", &script])?;
    } else {
        return None;
    }
    fs::read(&out).ok()
}

/// Manual check against a real app (macOS):
/// `cargo test icon_from_real_app -- --ignored --nocapture`
#[cfg(test)]
mod manual {
    #[test]
    #[ignore]
    fn icon_from_real_app() {
        let tmp = tempfile::tempdir().unwrap();
        let src = std::path::Path::new("/System/Applications/Calculator.app/Contents/Resources/AppIcon.icns");
        let url = super::data_url(src, tmp.path()).expect("converted");
        println!("{} bytes, starts {}", url.len(), &url[..30]);
    }
}
