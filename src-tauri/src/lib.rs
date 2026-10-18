pub mod integrations;

#[tauri::command]
fn health_check() -> &'static str {
    "QA Board backend ready"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![health_check])
        .run(tauri::generate_context!())
        .expect("error while running QA Board application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check_returns_ready() {
        assert_eq!(health_check(), "QA Board backend ready");
    }
}
