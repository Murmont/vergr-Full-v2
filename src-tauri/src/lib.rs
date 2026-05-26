use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Method, Response, Server};
use sysinfo::{System, ProcessesToUpdate};
use sha2::{Digest, Sha256};

// ─── Anti-cheat scan ───────────────────────────────────────────────────
// Enumerates running processes + hashes their executable paths.
// Returns to JS; JS-side calls the antiCheatIngest callable which matches
// the hashes against the `cheat_signatures/` Firestore collection.
//
// Why hash and not just list names? Names are easily faked (rename
// cheatengine.exe → notepad.exe). Path hashes are stable per-install and
// our signature DB stores expected hashes.

#[derive(Clone, Serialize, Deserialize)]
struct ProcEntry {
    name: String,
    pid: u32,
    exe_hash: Option<String>,
    cmd_join: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct ScanResult {
    processes: Vec<ProcEntry>,
    scanned_at_ms: u64,
    process_count: usize,
}

#[tauri::command]
async fn scan_processes() -> Result<ScanResult, String> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All);
    let mut entries = Vec::new();
    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_string();
        let exe_hash = process.exe().and_then(|p| {
            std::fs::metadata(p).ok().map(|_| {
                let mut h = Sha256::new();
                h.update(p.to_string_lossy().as_bytes());
                hex::encode(h.finalize())
            })
        });
        let cmd_join = process.cmd().iter().take(3)
            .map(|c| c.to_string_lossy().to_string())
            .collect::<Vec<_>>().join(" ");
        entries.push(ProcEntry {
            name, pid: pid.as_u32(),
            exe_hash, cmd_join: cmd_join.chars().take(200).collect(),
        });
    }
    let scanned_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    Ok(ScanResult {
        process_count: entries.len(),
        processes: entries,
        scanned_at_ms,
    })
}

// ─── HUD window control ─────────────────────────────────────────────────
#[tauri::command]
async fn open_hud(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("hud") {
        let _ = win.show();
        let _ = win.set_always_on_top(true);
        let _ = win.set_skip_taskbar(true);
        // Default to click-through; the renderer can toggle when user mouses over.
        #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
        let _ = win.set_ignore_cursor_events(true);
    }
    Ok(())
}

#[tauri::command]
async fn close_hud(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("hud") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
async fn set_hud_click_through(app: AppHandle, click_through: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("hud") {
        let _ = win.set_ignore_cursor_events(click_through);
    }
    Ok(())
}

#[tauri::command]
async fn set_hud_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("hud") {
        let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
    }
    Ok(())
}

/// Payload emitted when OAuth callback is received
#[derive(Clone, Serialize, Deserialize)]
struct OAuthPayload {
    access_token: Option<String>,
    error: Option<String>,
    state: Option<String>,
}

/// Start a localhost HTTP server for OAuth callback, return the port
#[tauri::command]
async fn start_oauth_listener(app: AppHandle) -> Result<u16, String> {
    // Bind to port 0 = OS picks a free port
    let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("Failed to get port")?;

    // Spawn the listener in a background thread
    std::thread::spawn(move || {
        // We only need to handle 2 requests: the initial redirect + the token POST
        let token_received = Arc::new(Mutex::new(false));

        for mut request in server.incoming_requests() {
            let url = request.url().to_string();

            // Step 1: Google redirects here with hash fragment (implicit flow)
            // The fragment isn't sent to the server, so we serve a page that extracts it
            if url.starts_with("/callback") {
                let html = r#"<!DOCTYPE html>
<html>
<head>
    <title>VERGR — Logging In</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #07080D;
            color: #ECEFFE;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .card {
            background: rgba(15, 17, 24, 0.9);
            border: 1px solid rgba(35, 38, 64, 0.6);
            border-radius: 20px;
            padding: 48px;
            text-align: center;
            backdrop-filter: blur(20px);
            box-shadow: 0 0 60px rgba(77, 255, 212, 0.06);
            max-width: 400px;
        }
        h1 {
            background: linear-gradient(135deg, #4DFFD4 0%, #7B6FFF 50%, #C87FFF 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-size: 28px;
            font-weight: 800;
            margin-bottom: 12px;
        }
        p { color: #7B82A8; font-size: 15px; line-height: 1.5; }
        .spinner {
            width: 40px; height: 40px; margin: 20px auto;
            border: 3px solid rgba(77, 255, 212, 0.15);
            border-top-color: #4DFFD4;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .success { color: #4DFFD4; display: none; }
    </style>
</head>
<body>
    <div class="card">
        <h1>VERGR</h1>
        <div class="spinner" id="spinner"></div>
        <p id="status">Completing sign-in...</p>
        <p class="success" id="success">✓ Signed in! You can close this tab.</p>
    </div>
    <script>
        (function() {
            // Extract token from hash fragment
            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);
            const accessToken = params.get('access_token');
            const state = params.get('state');
            const error = params.get('error');

            // Send token back to our localhost server
            fetch('/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    access_token: accessToken,
                    state: state,
                    error: error
                })
            }).then(() => {
                document.getElementById('spinner').style.display = 'none';
                document.getElementById('status').style.display = 'none';
                document.getElementById('success').style.display = 'block';
                setTimeout(() => window.close(), 1500);
            }).catch(() => {
                document.getElementById('status').textContent = 'Sign-in complete. You can close this tab.';
                document.getElementById('spinner').style.display = 'none';
            });
        })();
    </script>
</body>
</html>"#;

                let response = Response::from_string(html)
                    .with_header(
                        tiny_http::Header::from_bytes(
                            &b"Content-Type"[..],
                            &b"text/html; charset=utf-8"[..],
                        )
                        .unwrap(),
                    )
                    .with_header(
                        tiny_http::Header::from_bytes(
                            &b"Access-Control-Allow-Origin"[..],
                            &b"*"[..],
                        )
                        .unwrap(),
                    );

                let _ = request.respond(response);
            }
            // Step 2: The served page POSTs the token here
            else if url == "/token" {
                let mut body = String::new();
                let reader = request.as_reader();
                let _ = reader.read_to_string(&mut body);

                let payload: OAuthPayload = serde_json::from_str(&body).unwrap_or(OAuthPayload {
                    access_token: None,
                    error: Some("Failed to parse token response".into()),
                    state: None,
                });

                // Emit the token to the Tauri frontend
                let _ = app.emit("oauth-callback", payload);

                let response = Response::from_string("{\"ok\":true}")
                    .with_header(
                        tiny_http::Header::from_bytes(
                            &b"Content-Type"[..],
                            &b"application/json"[..],
                        )
                        .unwrap(),
                    )
                    .with_header(
                        tiny_http::Header::from_bytes(
                            &b"Access-Control-Allow-Origin"[..],
                            &b"*"[..],
                        )
                        .unwrap(),
                    );

                let _ = request.respond(response);

                // Token received, shut down the server
                *token_received.lock().unwrap() = true;
                break;
            }
            // Handle CORS preflight
            else if *request.method() == Method::Options {
                let response = Response::from_string("")
                    .with_header(
                        tiny_http::Header::from_bytes(
                            &b"Access-Control-Allow-Origin"[..],
                            &b"*"[..],
                        )
                        .unwrap(),
                    )
                    .with_header(
                        tiny_http::Header::from_bytes(
                            &b"Access-Control-Allow-Methods"[..],
                            &b"POST, GET, OPTIONS"[..],
                        )
                        .unwrap(),
                    )
                    .with_header(
                        tiny_http::Header::from_bytes(
                            &b"Access-Control-Allow-Headers"[..],
                            &b"Content-Type"[..],
                        )
                        .unwrap(),
                    );
                let _ = request.respond(response);
            }
        }
    });

    Ok(port)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            start_oauth_listener,
            scan_processes,
            open_hud,
            close_hud,
            set_hud_click_through,
            set_hud_position,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VERGR desktop");
}