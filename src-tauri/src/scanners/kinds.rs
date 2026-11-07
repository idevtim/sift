//! What sort of file something is, by extension. Drives the Home photo and
//! video categories and the external-drive breakdown.

use std::path::Path;

const PHOTO: &[&str] = &[
    "jpg", "jpeg", "png", "heic", "heif", "gif", "tif", "tiff", "webp", "bmp", "dng", "raw", "cr2", "cr3", "nef",
    "arw", "orf", "rw2", "raf", "srw", "pef",
];
const VIDEO: &[&str] = &[
    "mp4", "mov", "m4v", "avi", "mkv", "wmv", "mts", "m2ts", "webm", "3gp", "mpg", "mpeg", "flv", "braw", "r3d",
];
const AUDIO: &[&str] = &["mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "ogg", "opus", "wma", "alac"];
const DOCUMENT: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pages", "numbers", "key", "txt", "md", "rtf", "csv", "odt",
    "ods", "odp", "epub", "psd", "ai", "indd", "sketch", "fig", "zip", "rar", "7z",
];
const INSTALLER: &[&str] = &["dmg", "pkg", "mpkg", "msi", "msix", "exe", "deb", "rpm", "appimage", "iso"];
/// Folders that are really one media document.
const MEDIA_PACKAGES: &[&str] = &["photoslibrary", "fcpbundle", "imovielibrary", "musiclibrary", "tvlibrary", "aplibrary"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Photo,
    Video,
    Audio,
    Document,
    App,
    Other,
}

fn ext(path: &Path) -> Option<String> {
    path.extension().and_then(|x| x.to_str()).map(str::to_ascii_lowercase)
}

pub fn of(path: &Path) -> FileKind {
    let Some(x) = ext(path) else { return FileKind::Other };
    let x = x.as_str();
    if PHOTO.contains(&x) {
        FileKind::Photo
    } else if VIDEO.contains(&x) {
        FileKind::Video
    } else if AUDIO.contains(&x) {
        FileKind::Audio
    } else if DOCUMENT.contains(&x) {
        FileKind::Document
    } else if INSTALLER.contains(&x) || x == "app" {
        FileKind::App
    } else {
        FileKind::Other
    }
}

/// A folder that should be counted as one thing rather than walked
/// file by file: an app bundle or a media library.
pub fn package_kind(dir: &Path) -> Option<FileKind> {
    let x = ext(dir)?;
    if x == "app" {
        Some(FileKind::App)
    } else if MEDIA_PACKAGES.contains(&x.as_str()) {
        Some(FileKind::Photo)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_by_extension() {
        assert_eq!(of(Path::new("IMG_0001.HEIC")), FileKind::Photo);
        assert_eq!(of(Path::new("clip.MOV")), FileKind::Video);
        assert_eq!(of(Path::new("notes.pdf")), FileKind::Document);
        assert_eq!(of(Path::new("setup.exe")), FileKind::App);
        assert_eq!(of(Path::new("README")), FileKind::Other);
        assert_eq!(package_kind(Path::new("/Volumes/X/Photos Library.photoslibrary")), Some(FileKind::Photo));
    }
}
