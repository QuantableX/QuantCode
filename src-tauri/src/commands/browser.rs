use tauri::{AppHandle, Manager};

#[derive(serde::Deserialize)]
pub struct ClipRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[tauri::command]
pub fn navigate_browser(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let parsed_url: url::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
    webview
        .navigate(parsed_url)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn eval_browser(app: AppHandle, label: String, js: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    webview.eval(&js).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_browser_url(app: AppHandle, label: String) -> Result<String, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    Ok(webview.url().map_err(|e: tauri::Error| e.to_string())?.to_string())
}

/// Clip the browser webview HWND to its visible region by subtracting
/// obscuring rectangles (higher-z canvas windows / sidebars).
#[tauri::command]
pub fn set_browser_clip_region(
    app: AppHandle,
    label: String,
    full_width: i32,
    full_height: i32,
    obscuring_rects: Vec<ClipRect>,
) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    #[cfg(target_os = "windows")]
    {
        webview
            .with_webview(move |wv| {
                unsafe { apply_window_region(wv, full_width, full_height, &obscuring_rects) };
            })
            .map_err(|e| format!("with_webview: {}", e))?;
    }

    Ok(())
}

// ---- Win32 region clipping (Windows only) ----

#[cfg(target_os = "windows")]
unsafe fn apply_window_region(
    wv: tauri::webview::PlatformWebview,
    full_width: i32,
    full_height: i32,
    obscuring_rects: &[ClipRect],
) {
    // Get the container HWND from the WebView2 controller.
    // ParentWindow is a COM method with an out-pointer; HWND is repr(transparent)
    // wrapping a pointer-sized value, so we can safely cast through isize.
    let controller = wv.controller();
    let mut hwnd: isize = 0;
    let _ = controller.ParentWindow(&mut hwnd as *mut isize as *mut _);
    if hwnd == 0 {
        return;
    }

    if obscuring_rects.is_empty() {
        // No obscuring — remove region to show full webview
        SetWindowRgn(hwnd, 0, 1);
    } else {
        // Start with the full webview rectangle
        let full_rgn = CreateRectRgn(0, 0, full_width, full_height);

        // Subtract each obscuring rectangle
        for r in obscuring_rects {
            let obs_rgn = CreateRectRgn(r.x, r.y, r.x + r.w, r.y + r.h);
            CombineRgn(full_rgn, full_rgn, obs_rgn, RGN_DIFF);
            DeleteObject(obs_rgn);
        }

        // SetWindowRgn takes ownership of the region handle
        SetWindowRgn(hwnd, full_rgn, 1);
    }
}

#[cfg(target_os = "windows")]
const RGN_DIFF: i32 = 4;

#[cfg(target_os = "windows")]
#[link(name = "gdi32")]
extern "system" {
    fn CreateRectRgn(x1: i32, y1: i32, x2: i32, y2: i32) -> isize;
    fn CombineRgn(hrgnDst: isize, hrgnSrc1: isize, hrgnSrc2: isize, iMode: i32) -> i32;
    fn DeleteObject(ho: isize) -> i32;
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn SetWindowRgn(hWnd: isize, hRgn: isize, bRedraw: i32) -> i32;
}

#[tauri::command]
pub fn find_in_browser(app: AppHandle, label: String, query: String, forward: bool) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;

    let js = if query.is_empty() {
        "window.getSelection().removeAllRanges();".to_string()
    } else {
        format!(
            "window.find('{}', false, {}, true, false, true, false);",
            query.replace('\\', "\\\\").replace('\'', "\\'"),
            if forward { "false" } else { "true" }
        )
    };

    webview.eval(&js).map_err(|e| e.to_string())
}
