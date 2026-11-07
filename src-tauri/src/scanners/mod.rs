pub mod disks;
pub mod apps;
pub mod devtools;
pub mod duplicates;
pub mod findings;
pub mod icons;
pub mod index;
pub mod kinds;
pub mod leftovers;
pub mod previews;
pub mod recycle_bin;
pub mod volume;

use std::fs::Metadata;
use std::path::Path;
use std::sync::OnceLock;
use walkdir::WalkDir;

/// Threads for a pool of parallel work on this computer. Sift runs
/// alongside whatever the person is doing, so it takes a share of the
/// machine rather than all of it.
pub fn pool_threads() -> usize {
    threads_for(std::thread::available_parallelism().map_or(4, |n| n.get()))
}

/// A quarter of the cores, at least 2 and at most 6. The walk is
/// kernel-bound, so extra threads mostly contend: measured on a 16-core Mac
/// over 4.5M files, 16 threads took 44s at 7.6 cores busy, 4 threads 58s at
/// 2.3, 2 threads 106s at 1.1. A quarter keeps a scan around 15–30% of any
/// machine.
fn threads_for(cores: usize) -> usize {
    (cores / 4).clamp(2, 6)
}

/// Ask the OS to treat the current thread as background work. On macOS
/// that's the "utility" QoS: efficiency cores first, and it yields to
/// anything the person is doing.
pub fn lower_priority() {
    #[cfg(target_os = "macos")]
    {
        const QOS_CLASS_UTILITY: u32 = 0x11;
        unsafe extern "C" {
            fn pthread_set_qos_class_self_np(qos_class: u32, relative_priority: i32) -> i32;
        }
        // SAFETY: only changes the calling thread's scheduling class.
        unsafe { pthread_set_qos_class_self_np(QOS_CLASS_UTILITY, 0) };
    }
}

/// Run long work (the disk index walk, duplicate hashing, external-drive
/// walks) on its own low-priority thread pool. Rayon's global pool stays
/// free for the quick checks and anything the person clicks; sharing one
/// pool meant Home's categories waited behind a minutes-long walk.
pub fn background<T: Send>(f: impl FnOnce() -> T + Send) -> T {
    static POOL: OnceLock<Option<rayon::ThreadPool>> = OnceLock::new();
    let pool = POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(pool_threads())
            .start_handler(|_| lower_priority())
            .thread_name(|i| format!("sift-scan-{i}"))
            // The index walk recurses once per folder level, several frames
            // deep through rayon each time; the 2 MiB default overflowed on
            // deeply nested trees (node_modules). 64 MiB is reserved address
            // space, not memory, and covers the deepest path macOS allows.
            .stack_size(64 * 1024 * 1024)
            .build()
            .ok()
    });
    match pool {
        Some(pool) => pool.install(f),
        None => f(),
    }
}

/// A cloud file whose contents aren't on this computer (iCloud Drive with
/// "Optimize Mac Storage", Desktop & Documents, other File Providers). It
/// takes no local space, and reading it would make macOS download it first,
/// so Sift never counts or opens one.
#[cfg(target_os = "macos")]
pub fn is_dataless(meta: &Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    const SF_DATALESS: u32 = 0x4000_0000;
    meta.st_flags() & SF_DATALESS != 0
}

#[cfg(not(target_os = "macos"))]
pub fn is_dataless(_meta: &Metadata) -> bool {
    false
}

/// Bytes a file takes on this computer: 0 for cloud files not downloaded.
pub fn local_len(meta: &Metadata) -> u64 {
    if is_dataless(meta) {
        0
    } else {
        meta.len()
    }
}

/// Total size in bytes of everything under `path`. Symlinks aren't followed
/// and unreadable entries are skipped, so the result is a lower bound on
/// permission-restricted trees (e.g. before macOS Full Disk Access).
pub fn dir_size(path: &Path) -> (u64, u64) {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok())
        .fold((0, 0), |(bytes, count), m| (bytes + local_len(&m), count + 1))
}

#[cfg(test)]
mod tests {
    #[test]
    fn threads_scale_with_cores() {
        let t = super::threads_for;
        assert_eq!([t(1), t(4), t(8), t(12), t(16), t(24), t(64)], [2, 2, 2, 3, 4, 6, 6]);
    }
}
