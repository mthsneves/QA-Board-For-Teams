pub mod integrations;
pub mod storage;

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
        .invoke_handler(tauri::generate_handler![
            health_check,
            storage::save_attachment,
            storage::read_attachment,
            storage::delete_attachment,
            storage::export_backup_zip,
            storage::import_backup_zip,
            storage::save_export_file,
            integrations::get_integrations_secret_status,
            integrations::save_integration_secret,
            integrations::delete_integration_secret,
            integrations::test_jira_connection,
            integrations::create_jira_issue,
            integrations::fetch_jira_issue_status,
            integrations::test_ado_connection,
            integrations::create_ado_work_item,
            integrations::fetch_ado_work_item_status,
            integrations::test_slack_connection,
            integrations::send_slack_run_summary,
        ])
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
