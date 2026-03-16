use serde::Serialize;

#[derive(Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.github.com/repos/QuantableX/QuantCode/releases/latest")
        .header("User-Agent", "QuantCode")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("GitHub API returned {}", res.status()));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let latest = data["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();

    if latest.is_empty() {
        return Err("Could not determine latest version".into());
    }

    let available = latest != current;

    let download_url = if available {
        find_platform_asset(&data).unwrap_or_default()
    } else {
        String::new()
    };

    Ok(UpdateInfo {
        available,
        current_version: current,
        latest_version: latest,
        download_url,
    })
}

fn find_platform_asset(release: &serde_json::Value) -> Option<String> {
    let assets = release["assets"].as_array()?;
    let asset = if cfg!(target_os = "windows") {
        assets.iter().find(|a| {
            let n = a["name"].as_str().unwrap_or("");
            n.ends_with("-setup.exe")
        })
    } else if cfg!(target_os = "macos") {
        assets
            .iter()
            .find(|a| a["name"].as_str().unwrap_or("").ends_with(".dmg"))
    } else {
        assets
            .iter()
            .find(|a| a["name"].as_str().unwrap_or("").ends_with(".AppImage"))
    };
    asset.and_then(|a| a["browser_download_url"].as_str().map(|s| s.to_string()))
}

#[tauri::command]
pub async fn download_and_install_update(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("User-Agent", "QuantCode")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Download failed: HTTP {}", res.status()));
    }

    let filename = url
        .split('/')
        .last()
        .unwrap_or("update_installer")
        .to_string();
    let file_path = std::env::temp_dir().join(&filename);

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&file_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("chmod")
            .args(["+x", &file_path.to_string_lossy()])
            .status()
            .map_err(|e| e.to_string())?;
        std::process::Command::new(&file_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(file_path.to_string_lossy().to_string())
}
