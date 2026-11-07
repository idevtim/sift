//! Developer cleanups that go through a tool rather than a folder: Docker's
//! dangling images and Xcode's unavailable simulators. Both are permanent
//! (the tools manage that data themselves).

use crate::process_ext::output;
use std::path::PathBuf;

/// Bytes held by dangling Docker images, or None if Docker isn't available.
pub fn docker_dangling_bytes() -> Option<u64> {
    let sizes = output("docker", &["image", "ls", "--filter", "dangling=true", "--format", "{{.Size}}"])?;
    Some(sizes.lines().filter_map(parse_docker_size).sum())
}

pub fn docker_prune() -> Result<(), String> {
    output("docker", &["image", "prune", "--force"]).map(|_| ()).ok_or_else(|| "Docker isn't running".into())
}

/// "1.2GB", "350MB", "12.5kB" → bytes (Docker uses decimal units).
fn parse_docker_size(s: &str) -> Option<u64> {
    let s = s.trim();
    let split = s.find(|c: char| c.is_ascii_alphabetic())?;
    let (num, unit) = s.split_at(split);
    let n: f64 = num.parse().ok()?;
    let mult = match unit.to_ascii_lowercase().as_str() {
        "b" => 1.0,
        "kb" => 1e3,
        "mb" => 1e6,
        "gb" => 1e9,
        "tb" => 1e12,
        _ => return None,
    };
    Some((n * mult) as u64)
}

/// Device folders of simulators Xcode marks unavailable (old runtimes).
fn unavailable_simulators() -> Vec<PathBuf> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let Some(json) = output("xcrun", &["simctl", "list", "devices", "unavailable", "--json"]) else { return Vec::new() };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) else { return Vec::new() };
    let Some(devices_root) = dirs::home_dir().map(|h| h.join("Library/Developer/CoreSimulator/Devices")) else {
        return Vec::new();
    };
    v["devices"]
        .as_object()
        .into_iter()
        .flat_map(|runtimes| runtimes.values())
        .filter_map(|list| list.as_array())
        .flatten()
        .filter_map(|d| d["udid"].as_str())
        .map(|udid| devices_root.join(udid))
        .filter(|p| p.is_dir())
        .collect()
}

pub fn simulator_bytes() -> Option<u64> {
    let sims = unavailable_simulators();
    (!sims.is_empty()).then(|| sims.iter().map(|p| super::dir_size(p).0).sum())
}

pub fn delete_unavailable_simulators() -> Result<(), String> {
    output("xcrun", &["simctl", "delete", "unavailable"]).map(|_| ()).ok_or_else(|| "Xcode tools aren't available".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_docker_sizes() {
        assert_eq!(super::parse_docker_size("1.2GB"), Some(1_200_000_000));
        assert_eq!(super::parse_docker_size("350MB"), Some(350_000_000));
        assert_eq!(super::parse_docker_size("12.5kB"), Some(12_500));
        assert_eq!(super::parse_docker_size("weird"), None);
    }
}
