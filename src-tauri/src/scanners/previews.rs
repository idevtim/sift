//! Previews and facts for Duplicates, made on demand for the sets on
//! screen. Copies are byte-identical, so both are keyed by content hash
//! and come from whichever copy is still on disk.
//!
//! - macOS: thumbnails from Quick Look (`qlmanage`: photos, video poster
//!   frames, album art, first pages), cached as PNG; facts from Spotlight.
//! - Windows/Linux: photos a webview can draw are sent as they are (up to
//!   `MAX_RAW_BYTES`); everything else gets the drawn tile in the UI.

use crate::models::FileFacts;
use base64::Engine;
use std::fs;
use std::path::Path;

/// Cards are 148 px tall and ~200–300 px wide; 400 covers 2x screens.
#[cfg(target_os = "macos")]
const SIZE: &str = "400";
#[cfg(not(target_os = "macos"))]
const MAX_RAW_BYTES: u64 = 8_000_000;

/// A preview as a data URL, or None when there isn't one. Never opens a
/// cloud file that isn't downloaded.
pub fn thumbnail(path: &Path, hash: &str, cache_dir: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || super::is_dataless(&meta) {
        return None;
    }
    let (mime, bytes) = make(path, &meta, hash, cache_dir)?;
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(target_os = "macos")]
fn make(path: &Path, _meta: &fs::Metadata, hash: &str, cache_dir: &Path) -> Option<(&'static str, Vec<u8>)> {
    // Content hashes are hex; anything else never becomes a file name.
    if hash.is_empty() || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let out = cache_dir.join(format!("{hash}.png"));
    if let Ok(bytes) = fs::read(&out) {
        return Some(("image/png", bytes));
    }
    // qlmanage names its output after the source; give each run its own
    // folder, then move the result to its hash name.
    let work = cache_dir.join(format!("{hash}.tmp"));
    fs::create_dir_all(&work).ok()?;
    let made = crate::process_ext::output(
        "qlmanage",
        &["-t", "-s", SIZE, "-o", &work.to_string_lossy(), &path.to_string_lossy()],
    )
    .and_then(|_| fs::read_dir(&work).ok()?.flatten().map(|e| e.path()).find(|p| p.extension().is_some_and(|x| x == "png")))
    .and_then(|png| fs::rename(png, &out).ok());
    let _ = fs::remove_dir_all(&work);
    made?;
    Some(("image/png", fs::read(&out).ok()?))
}

#[cfg(not(target_os = "macos"))]
fn make(path: &Path, meta: &fs::Metadata, _hash: &str, _cache_dir: &Path) -> Option<(&'static str, Vec<u8>)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return None,
    };
    if meta.len() > MAX_RAW_BYTES {
        return None;
    }
    Some((mime, fs::read(path).ok()?))
}

/// Dimensions, length, pages and so on, from Spotlight.
#[cfg(target_os = "macos")]
pub fn facts(path: &Path) -> FileFacts {
    const ATTRS: [&str; 7] = [
        "kMDItemPixelWidth",
        "kMDItemPixelHeight",
        "kMDItemDurationSeconds",
        "kMDItemNumberOfPages",
        "kMDItemContentCreationDate",
        "kMDItemAudioBitRate",
        "kMDItemTotalBitRate",
    ];
    let mut args: Vec<&str> = ATTRS.iter().flat_map(|a| ["-name", *a]).collect();
    let p = path.to_string_lossy();
    args.push(&p);
    crate::process_ext::output("mdls", &args).map(|out| parse_mdls(&out)).unwrap_or_default()
}

#[cfg(not(target_os = "macos"))]
pub fn facts(_path: &Path) -> FileFacts {
    FileFacts::default()
}

/// `mdls` prints `kMDItemPixelWidth = 4032`, or `(null)` when unknown.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn parse_mdls(out: &str) -> FileFacts {
    let mut f = FileFacts::default();
    let num = |v: &str| v.parse::<f64>().ok().filter(|n| *n > 0.0);
    for line in out.lines() {
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim().trim_matches('"');
        match key.trim() {
            "kMDItemPixelWidth" => f.width = num(value).map(|n| n as u32),
            "kMDItemPixelHeight" => f.height = num(value).map(|n| n as u32),
            "kMDItemDurationSeconds" => f.duration_secs = num(value),
            "kMDItemNumberOfPages" => f.pages = num(value).map(|n| n as u32),
            "kMDItemContentCreationDate" => {
                f.created_ms = chrono::DateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S %z")
                    .ok()
                    .and_then(|d| u64::try_from(d.timestamp_millis()).ok())
            }
            // Bits per second; audio files have the first, some only the second.
            "kMDItemAudioBitRate" | "kMDItemTotalBitRate" if f.bit_rate_kbps.is_none() => {
                f.bit_rate_kbps = num(value).map(|n| (n / 1000.0).round() as u32)
            }
            _ => {}
        }
    }
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_spotlight_output() {
        let f = parse_mdls(
            "kMDItemAudioBitRate        = (null)\n\
             kMDItemContentCreationDate = 2024-06-12 10:00:00 +0000\n\
             kMDItemDurationSeconds     = 252.4\n\
             kMDItemNumberOfPages       = (null)\n\
             kMDItemPixelHeight         = 2160\n\
             kMDItemPixelWidth          = 3840\n\
             kMDItemTotalBitRate        = 256000",
        );
        assert_eq!((f.width, f.height), (Some(3840), Some(2160)));
        assert_eq!(f.duration_secs, Some(252.4));
        assert_eq!(f.pages, None);
        assert_eq!(f.created_ms, Some(1_718_186_400_000));
        assert_eq!(f.bit_rate_kbps, Some(256));
    }

    /// Manual check against a real photo (macOS):
    /// `SIFT_PREVIEW=~/Pictures/x.heic cargo test preview_real_file -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn preview_real_file() {
        let path = std::path::PathBuf::from(std::env::var("SIFT_PREVIEW").expect("SIFT_PREVIEW"));
        let tmp = tempfile::tempdir().unwrap();
        let url = thumbnail(&path, "abc123", tmp.path()).expect("preview");
        println!("{} bytes, starts {}", url.len(), &url[..30]);
        println!("{:?}", facts(&path));
    }
}
