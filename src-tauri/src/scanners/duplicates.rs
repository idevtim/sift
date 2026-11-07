//! Exact-duplicate detection over the index's candidate files: group by
//! size, then by a hash of the first 16 KB, then by a full hash. Only files
//! that survive every round are read in full. Hard links to one file
//! aren't copies and are dropped.

use super::index::FileRec;
use crate::models::{DuplicateCopy, DuplicateGroup};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

const HEAD_BYTES: usize = 16 * 1024;
const MAX_GROUPS: usize = 500;

/// Open a file for hashing, refusing cloud files that aren't downloaded:
/// reading one would make macOS fetch it (and block until it arrives).
/// Checked here, not just when the index was built, since files can be
/// offloaded at any time.
fn open_local(path: &Path) -> io::Result<File> {
    if super::is_dataless(&std::fs::metadata(path)?) {
        return Err(io::Error::other("not downloaded"));
    }
    File::open(path)
}

fn hash_head(path: &Path) -> io::Result<[u8; 32]> {
    let mut buf = vec![0u8; HEAD_BYTES];
    let mut f = open_local(path)?;
    let n = f.read(&mut buf)?;
    Ok(*blake3::hash(&buf[..n]).as_bytes())
}

/// Start, middle and end of the file. Near-certain for media of identical
/// size; used only where nothing is removed (external-drive copies).
fn hash_samples(path: &Path, size: u64) -> io::Result<[u8; 32]> {
    let mut f = open_local(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; HEAD_BYTES];
    for at in [0, size / 2, size.saturating_sub(HEAD_BYTES as u64)] {
        f.seek(SeekFrom::Start(at))?;
        let n = f.read(&mut buf)?;
        hasher.update(&buf[..n]);
    }
    Ok(*hasher.finalize().as_bytes())
}

fn hash_full(path: &Path) -> io::Result<[u8; 32]> {
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(open_local(path)?)?;
    Ok(*hasher.finalize().as_bytes())
}

/// Split each group by `key`, keeping only sub-groups with 2+ members,
/// each with the key they share.
fn refine<K: Eq + std::hash::Hash + Send>(
    groups: Vec<Vec<&FileRec>>,
    key: impl Fn(&FileRec) -> io::Result<K> + Sync,
) -> Vec<(K, Vec<&FileRec>)> {
    groups
        .into_par_iter()
        .flat_map(|group| {
            let mut by_key: HashMap<K, Vec<&FileRec>> = HashMap::new();
            for rec in group {
                if let Ok(k) = key(rec) {
                    by_key.entry(k).or_default().push(rec);
                }
            }
            by_key.into_iter().filter(|(_, g)| g.len() > 1).collect::<Vec<_>>()
        })
        .collect()
}

/// Hard links are one file under several names: removing one frees nothing.
#[cfg(unix)]
fn file_id(path: &Path) -> Option<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.dev(), meta.ino()))
}

#[cfg(not(unix))]
fn file_id(_path: &Path) -> Option<(u64, u64)> {
    None
}

/// `groups` minus anything at or under `removed`; groups left with one copy
/// are dropped. Keeps the cache right after a removal without re-hashing.
pub fn without(groups: &[DuplicateGroup], removed: &[std::path::PathBuf]) -> Vec<DuplicateGroup> {
    groups
        .iter()
        .filter_map(|g| {
            let copies: Vec<DuplicateCopy> = g
                .copies
                .iter()
                .filter(|c| !removed.iter().any(|r| Path::new(&c.path).starts_with(r)))
                .cloned()
                .collect();
            (copies.len() > 1).then(|| DuplicateGroup { copies, ..g.clone() })
        })
        .collect()
}

/// Groups of identical files, with the hash they share. `full` compares
/// whole files; otherwise sampled hashes (see `hash_samples`).
pub fn identical(recs: Vec<&FileRec>, full: bool) -> Vec<([u8; 32], Vec<&FileRec>)> {
    let mut by_size: HashMap<u64, Vec<&FileRec>> = HashMap::new();
    for rec in recs {
        by_size.entry(rec.size).or_default().push(rec);
    }
    let groups: Vec<_> = by_size.into_values().filter(|g| g.len() > 1).collect();
    let groups = refine(groups, |r| hash_head(&r.path)).into_iter().map(|(_, g)| g).collect();
    if full {
        refine(groups, |r| hash_full(&r.path))
    } else {
        refine(groups, |r| hash_samples(&r.path, r.size))
    }
}

/// `location` turns a path into plain words ("Documents › Taxes").
pub fn find(candidates: &[FileRec], location: impl Fn(&Path) -> String) -> Vec<DuplicateGroup> {
    let groups = identical(candidates.iter().collect(), true);

    let mut out: Vec<DuplicateGroup> = groups
        .into_iter()
        .filter_map(|(hash, mut g)| {
            g.sort_by_key(|r| r.modified_ms);
            let mut seen = HashSet::new();
            g.retain(|r| file_id(&r.path).is_none_or(|id| seen.insert(id)));
            (g.len() > 1).then_some((hash, g))
        })
        .map(|(hash, g)| {
            let name = g[0].path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            DuplicateGroup {
                hash: blake3::Hash::from_bytes(hash).to_hex().to_string(),
                kind: super::kinds::of(Path::new(&name)),
                name,
                size_bytes: g[0].size,
                copies: g
                    .iter()
                    .map(|r| DuplicateCopy {
                        path: r.path.to_string_lossy().into_owned(),
                        location: location(&r.path),
                        modified_ms: r.modified_ms,
                    })
                    .collect(),
            }
        })
        .collect();
    // Most space wasted first.
    out.sort_by_key(|g| std::cmp::Reverse(g.size_bytes * (g.copies.len() as u64 - 1)));
    out.truncate(MAX_GROUPS);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanners::kinds::FileKind;

    #[test]
    fn removal_prunes_cached_groups() {
        let copy = |p: &str| DuplicateCopy { path: p.into(), location: String::new(), modified_ms: 0 };
        let group = |name: &str, copies| DuplicateGroup {
            hash: name.into(),
            name: name.into(),
            kind: FileKind::Other,
            size_bytes: 1,
            copies,
        };
        let groups = vec![
            group("a", vec![copy("/x/a"), copy("/y/a"), copy("/z/a")]),
            group("b", vec![copy("/x/b"), copy("/y/b")]),
        ];
        let left = without(&groups, &["/y".into()]);
        assert_eq!(left.len(), 1, "a group down to one copy is no longer a duplicate");
        assert_eq!(left[0].copies.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), ["/x/a", "/z/a"]);
    }

    #[test]
    fn finds_exact_copies_only() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a.jpg");
        let b = tmp.path().join("b.jpg");
        let c = tmp.path().join("c.jpg");
        std::fs::write(&a, vec![1u8; 40_000]).unwrap();
        std::fs::write(&b, vec![1u8; 40_000]).unwrap();
        let mut differs = vec![1u8; 40_000];
        differs[39_999] = 2; // same size and same first 16 KB
        std::fs::write(&c, differs).unwrap();

        let recs = [(&a, 2), (&b, 1), (&c, 3)]
            .iter()
            .map(|(p, t)| FileRec { path: p.to_path_buf(), size: 40_000, modified_ms: *t })
            .collect::<Vec<_>>();
        let groups = find(&recs, |_| "Here".into());
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].copies.len(), 2);
        // Oldest first.
        assert!(groups[0].copies[0].path.ends_with("b.jpg"));
        assert_eq!(groups[0].kind, FileKind::Photo);
        assert_eq!(groups[0].hash, blake3::hash(&vec![1u8; 40_000]).to_hex().as_str());
    }

    #[cfg(unix)]
    #[test]
    fn hard_links_are_not_copies() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a.pdf");
        let b = tmp.path().join("b.pdf");
        let c = tmp.path().join("c.pdf");
        std::fs::write(&a, vec![7u8; 30_000]).unwrap();
        std::fs::hard_link(&a, &b).unwrap();
        let rec = |p: &Path| FileRec { path: p.to_path_buf(), size: 30_000, modified_ms: 0 };
        assert!(find(&[rec(&a), rec(&b)], |_| String::new()).is_empty());

        std::fs::write(&c, vec![7u8; 30_000]).unwrap();
        let groups = find(&[rec(&a), rec(&b), rec(&c)], |_| String::new());
        assert_eq!(groups[0].copies.len(), 2, "one name per file");
    }
}
