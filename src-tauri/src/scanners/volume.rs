//! What's on an external drive or SD card: one read-only walk sorted into
//! photos & videos, documents, apps and other, plus how much of it is a copy
//! of something already on this computer. Sift never changes these drives.

use super::index::{FileRec, DUPE_MIN};
use super::{dir_size, duplicates, kinds, kinds::FileKind};
use crate::models::{Category, CategoryTotal, DriveBreakdown};
use rayon::prelude::*;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Volume bookkeeping folders: never walked, counted as nothing.
const SKIP: &[&str] = &[
    ".Spotlight-V100",
    ".fseventsd",
    ".DocumentRevisions-V100",
    ".TemporaryItems",
    "System Volume Information",
    "lost+found",
];

#[derive(Default)]
struct Tally {
    media: u64,
    documents: u64,
    apps: u64,
    other: u64,
    photos: u64,
    videos: u64,
    /// Files worth comparing against this computer's.
    candidates: Vec<(FileRec, FileKind)>,
}

impl Tally {
    fn add_file(&mut self, path: PathBuf, size: u64, modified_ms: u64) {
        let kind = kinds::of(&path);
        match kind {
            FileKind::Photo => {
                self.media += size;
                self.photos += 1;
            }
            FileKind::Video => {
                self.media += size;
                self.videos += 1;
            }
            FileKind::Audio => self.media += size,
            FileKind::Document => self.documents += size,
            FileKind::App => self.apps += size,
            FileKind::Other => self.other += size,
        }
        if size >= DUPE_MIN && kind != FileKind::Other && kind != FileKind::App {
            self.candidates.push((FileRec { path, size, modified_ms }, kind));
        }
    }

    fn merge(mut self, other: Tally) -> Tally {
        self.media += other.media;
        self.documents += other.documents;
        self.apps += other.apps;
        self.other += other.other;
        self.photos += other.photos;
        self.videos += other.videos;
        self.candidates.extend(other.candidates);
        self
    }
}

fn walk(dir: &Path) -> Tally {
    let Ok(rd) = fs::read_dir(dir) else { return Tally::default() };
    let mut tally = Tally::default();
    let mut dirs = Vec::new();
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        let path = entry.path();
        if ft.is_dir() {
            if SKIP.iter().any(|s| entry.file_name() == *s) {
                continue;
            }
            match kinds::package_kind(&path) {
                Some(FileKind::App) => tally.apps += dir_size(&path).0,
                Some(_) => tally.media += dir_size(&path).0,
                None => dirs.push(path),
            }
        } else if ft.is_file() {
            if let Ok(meta) = entry.metadata() {
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_millis() as u64);
                tally.add_file(path, super::local_len(&meta), modified);
            }
        }
    }
    dirs.into_par_iter().map(|d| walk(&d)).reduce(Tally::default, Tally::merge).merge(tally)
}

/// Break down the drive at `mount`. `home_files` are this computer's
/// duplicate candidates (from the index), to spot copies.
pub fn breakdown(mount: &Path, home_files: &[FileRec]) -> DriveBreakdown {
    let mut tally = walk(mount);

    // Copies: drive files identical to one on this computer. Sampled hashes
    // are enough here — nothing on the drive is ever removed.
    let home_sizes: HashSet<u64> = home_files.iter().map(|r| r.size).collect();
    let drive_sizes: HashSet<u64> = tally.candidates.iter().map(|(r, _)| r.size).collect();
    let recs: Vec<&FileRec> = home_files
        .iter()
        .filter(|r| drive_sizes.contains(&r.size))
        .chain(tally.candidates.iter().map(|(r, _)| r).filter(|r| home_sizes.contains(&r.size)))
        .collect();
    let mut copies = 0;
    for (_, group) in duplicates::identical(recs, false) {
        if !group.iter().any(|r| !r.path.starts_with(mount)) {
            continue;
        }
        for rec in group.iter().filter(|r| r.path.starts_with(mount)) {
            copies += rec.size;
            let kind = tally.candidates.iter().find(|(r, _)| r.path == rec.path).map(|(_, k)| *k);
            match kind {
                Some(FileKind::Document) => tally.documents -= rec.size,
                _ => tally.media = tally.media.saturating_sub(rec.size),
            }
        }
    }

    let categories = [
        (Category::Freeable, copies),
        (Category::Media, tally.media),
        (Category::Documents, tally.documents),
        (Category::Apps, tally.apps),
        (Category::Other, tally.other),
    ]
    .into_iter()
    .filter(|(_, b)| *b > 0)
    .map(|(category, size_bytes)| CategoryTotal { category, size_bytes })
    .collect();
    DriveBreakdown { categories, photos: tally.photos, videos: tally.videos }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_files_and_finds_copies_of_home_files() {
        let drive = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let photo = vec![7u8; 600_000];
        fs::create_dir_all(drive.path().join("DCIM/100")).unwrap();
        fs::write(drive.path().join("DCIM/100/a.jpg"), &photo).unwrap();
        fs::write(drive.path().join("DCIM/100/b.jpg"), vec![8u8; 600_000]).unwrap();
        fs::write(drive.path().join("notes.pdf"), vec![1u8; 1000]).unwrap();
        fs::create_dir_all(drive.path().join(".Spotlight-V100")).unwrap();
        fs::write(drive.path().join(".Spotlight-V100/store"), vec![1u8; 5000]).unwrap();
        fs::write(home.path().join("a copy.jpg"), &photo).unwrap();

        let home_files = vec![FileRec { path: home.path().join("a copy.jpg"), size: 600_000, modified_ms: 0 }];
        let b = breakdown(drive.path(), &home_files);
        let total = |c: Category| b.categories.iter().find(|x| x.category == c).map_or(0, |x| x.size_bytes);
        assert_eq!(b.photos, 2);
        assert_eq!(total(Category::Freeable), 600_000);
        assert_eq!(total(Category::Media), 600_000);
        assert_eq!(total(Category::Documents), 1000);
        assert_eq!(total(Category::Other), 0);
    }
}
