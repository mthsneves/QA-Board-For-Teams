use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedAttachmentFile {
    pub relative_path: String,
    pub size_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadedAttachmentFile {
    pub base64_data: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupValidationSummary {
    pub version: u32,
    pub columns_count: usize,
    pub bugs_count: usize,
    pub attachments_count: usize,
}

/// Sanitizes a file name to keep only safe characters.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "attachment.bin".to_string()
    } else {
        cleaned
    }
}

/// Ensures a relative path stays strictly inside the `attachments/` folder with no traversal.
pub fn resolve_safe_attachment_path(base_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let normalized = relative_path.replace('\\', "/");
    if normalized.contains("..") || !normalized.starts_with("attachments/") {
        return Err("Caminho de anexo inválido ou não permitido.".to_string());
    }
    let file_part = normalized.trim_start_matches("attachments/");
    if file_part.is_empty() || file_part.contains('/') {
        return Err("Nome de arquivo de anexo inválido.".to_string());
    }
    Ok(base_dir.join("attachments").join(file_part))
}

pub fn save_attachment_in_dir(
    base_dir: &Path,
    attachment_id: &str,
    file_name: &str,
    base64_data: &str,
) -> Result<SavedAttachmentFile, String> {
    let attachments_dir = base_dir.join("attachments");
    fs::create_dir_all(&attachments_dir)
        .map_err(|e| format!("Falha ao criar diretório de anexos: {e}"))?;

    let safe_id = sanitize_file_name(attachment_id);
    let safe_name = sanitize_file_name(file_name);
    let stored_name = format!("{safe_id}_{safe_name}");
    let relative_path = format!("attachments/{stored_name}");
    let full_path = attachments_dir.join(&stored_name);

    let bytes = BASE64
        .decode(base64_data.trim())
        .map_err(|e| format!("Dados de anexo em Base64 inválidos: {e}"))?;

    fs::write(&full_path, &bytes)
        .map_err(|e| format!("Falha ao gravar arquivo de anexo no disco: {e}"))?;

    Ok(SavedAttachmentFile {
        relative_path,
        size_bytes: bytes.len(),
    })
}

pub fn read_attachment_from_dir(
    base_dir: &Path,
    relative_path: &str,
    mime_type: &str,
) -> Result<LoadedAttachmentFile, String> {
    let full_path = resolve_safe_attachment_path(base_dir, relative_path)?;
    let bytes = fs::read(&full_path)
        .map_err(|e| format!("Não foi possível ler o anexo '{relative_path}': {e}"))?;
    let base64_data = BASE64.encode(&bytes);
    Ok(LoadedAttachmentFile {
        base64_data,
        mime_type: mime_type.to_string(),
    })
}

pub fn delete_attachment_from_dir(base_dir: &Path, relative_path: &str) -> Result<(), String> {
    let full_path = resolve_safe_attachment_path(base_dir, relative_path)?;
    if full_path.exists() {
        fs::remove_file(&full_path)
            .map_err(|e| format!("Não foi possível remover o arquivo de anexo: {e}"))?;
    }
    Ok(())
}

/// Validates the structure of `backup.json` before exporting or importing.
pub fn validate_backup_json(json_str: &str) -> Result<BackupValidationSummary, String> {
    let value: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("O arquivo de backup não contém um JSON válido: {e}"))?;

    let version = value
        .get("version")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "Campo obrigatório 'version' ausente ou inválido no backup.".to_string())?
        as u32;

    if version == 0 || version > 10 {
        return Err(format!("Versão de backup não suportada: {version}."));
    }

    let columns = value
        .get("columns")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Lista 'columns' ausente ou inválida no backup.".to_string())?;

    if columns.is_empty() {
        return Err("O backup deve conter pelo menos uma coluna do board.".to_string());
    }

    for col in columns {
        if col.get("id").and_then(|v| v.as_str()).is_none()
            || col.get("name").and_then(|v| v.as_str()).is_none()
        {
            return Err("Uma ou mais colunas do backup não possuem 'id' ou 'name'.".to_string());
        }
    }

    let bugs = value
        .get("bugs")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Lista 'bugs' ausente ou inválida no backup.".to_string())?;

    for bug in bugs {
        if bug.get("id").and_then(|v| v.as_str()).is_none()
            || bug.get("title").and_then(|v| v.as_str()).is_none()
            || bug.get("column_id").and_then(|v| v.as_str()).is_none()
        {
            return Err(
                "Um ou mais bugs do backup não possuem 'id', 'title' ou 'column_id'.".to_string(),
            );
        }
    }

    let attachments = value
        .get("attachments")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Lista 'attachments' ausente ou inválida no backup.".to_string())?;

    Ok(BackupValidationSummary {
        version,
        columns_count: columns.len(),
        bugs_count: bugs.len(),
        attachments_count: attachments.len(),
    })
}

pub fn export_backup_zip_from_dir(
    base_dir: &Path,
    destination_zip: &Path,
    backup_json: &str,
) -> Result<BackupValidationSummary, String> {
    let summary = validate_backup_json(backup_json)?;

    let file = File::create(destination_zip)
        .map_err(|e| format!("Falha ao criar arquivo de backup ZIP: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    zip.start_file("backup.json", options)
        .map_err(|e| format!("Erro ao adicionar backup.json ao ZIP: {e}"))?;
    zip.write_all(backup_json.as_bytes())
        .map_err(|e| format!("Erro ao escrever backup.json no ZIP: {e}"))?;

    let attachments_dir = base_dir.join("attachments");
    if attachments_dir.exists() {
        let entries = fs::read_dir(&attachments_dir)
            .map_err(|e| format!("Erro ao ler pasta de anexos: {e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    let zip_entry_name = format!("attachments/{file_name}");
                    zip.start_file(&zip_entry_name, options)
                        .map_err(|e| format!("Erro ao adicionar anexo ao ZIP: {e}"))?;
                    let bytes = fs::read(&path)
                        .map_err(|e| format!("Erro ao ler anexo para o backup: {e}"))?;
                    zip.write_all(&bytes)
                        .map_err(|e| format!("Erro ao gravar bytes do anexo no ZIP: {e}"))?;
                }
            }
        }
    }

    zip.finish()
        .map_err(|e| format!("Erro ao finalizar arquivo ZIP de backup: {e}"))?;

    Ok(summary)
}

pub fn import_backup_zip_to_dir(base_dir: &Path, source_zip: &Path) -> Result<String, String> {
    let file =
        File::open(source_zip).map_err(|e| format!("Falha ao abrir arquivo de backup ZIP: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("Arquivo ZIP inválido ou corrompido: {e}"))?;

    let mut backup_json = String::new();
    {
        let mut json_file = archive.by_name("backup.json").map_err(|_| {
            "Arquivo 'backup.json' não encontrado dentro do pacote ZIP.".to_string()
        })?;
        json_file
            .read_to_string(&mut backup_json)
            .map_err(|e| format!("Não foi possível ler o 'backup.json' do ZIP: {e}"))?;
    }

    // Validate the JSON payload before extracting any files
    validate_backup_json(&backup_json)?;

    let attachments_dir = base_dir.join("attachments");
    fs::create_dir_all(&attachments_dir)
        .map_err(|e| format!("Falha ao preparar pasta de anexos: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Erro ao ler entrada do ZIP: {e}"))?;
        let Some(enclosed_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            return Err("Arquivo ZIP contém caminhos inseguros.".to_string());
        };

        let normalized = enclosed_path.to_string_lossy().replace('\\', "/");
        if normalized.starts_with("attachments/") && !entry.is_dir() {
            let target_path = resolve_safe_attachment_path(base_dir, &normalized)?;
            let mut buffer = Vec::new();
            entry
                .read_to_end(&mut buffer)
                .map_err(|e| format!("Erro ao extrair anexo do backup: {e}"))?;
            fs::write(&target_path, &buffer)
                .map_err(|e| format!("Erro ao restaurar anexo no disco: {e}"))?;
        }
    }

    Ok(backup_json)
}

fn get_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Não foi possível obter a pasta de dados do app: {e}"))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Não foi possível criar a pasta de dados do app: {e}"))?;
    Ok(dir)
}

#[tauri::command]
pub fn save_attachment(
    app: AppHandle,
    attachment_id: String,
    file_name: String,
    base64_data: String,
) -> Result<SavedAttachmentFile, String> {
    let base_dir = get_app_data_dir(&app)?;
    save_attachment_in_dir(&base_dir, &attachment_id, &file_name, &base64_data)
}

#[tauri::command]
pub fn read_attachment(
    app: AppHandle,
    relative_path: String,
    mime_type: String,
) -> Result<LoadedAttachmentFile, String> {
    let base_dir = get_app_data_dir(&app)?;
    read_attachment_from_dir(&base_dir, &relative_path, &mime_type)
}

#[tauri::command]
pub fn delete_attachment(app: AppHandle, relative_path: String) -> Result<(), String> {
    let base_dir = get_app_data_dir(&app)?;
    delete_attachment_from_dir(&base_dir, &relative_path)
}

#[tauri::command]
pub fn export_backup_zip(
    app: AppHandle,
    destination_path: String,
    backup_json: String,
) -> Result<BackupValidationSummary, String> {
    let base_dir = get_app_data_dir(&app)?;
    export_backup_zip_from_dir(&base_dir, Path::new(&destination_path), &backup_json)
}

#[tauri::command]
pub fn import_backup_zip(app: AppHandle, source_path: String) -> Result<String, String> {
    let base_dir = get_app_data_dir(&app)?;
    import_backup_zip_to_dir(&base_dir, Path::new(&source_path))
}

#[tauri::command]
pub fn save_export_file(destination_path: String, bytes_base64: String) -> Result<(), String> {
    let bytes = BASE64
        .decode(bytes_base64.trim())
        .map_err(|e| format!("Dados de exportação inválidos: {e}"))?;
    fs::write(Path::new(&destination_path), &bytes)
        .map_err(|e| format!("Falha ao salvar arquivo exportado: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_test_dir(prefix: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!(
            "qaboard_test_{}_{}",
            prefix,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_save_read_delete_attachment_and_path_traversal_guard() {
        let dir = temp_test_dir("attachments");
        let payload = BASE64.encode(b"fake-png-bytes");

        let saved = save_attachment_in_dir(&dir, "att-1", "print tela.png", &payload).unwrap();
        assert_eq!(saved.relative_path, "attachments/att-1_print_tela.png");
        assert_eq!(saved.size_bytes, 14);

        let loaded = read_attachment_from_dir(&dir, &saved.relative_path, "image/png").unwrap();
        assert_eq!(loaded.base64_data, payload);
        assert_eq!(loaded.mime_type, "image/png");

        // Reject path traversal
        assert!(resolve_safe_attachment_path(&dir, "attachments/../secret.txt").is_err());
        assert!(resolve_safe_attachment_path(&dir, "../secret.txt").is_err());

        delete_attachment_from_dir(&dir, &saved.relative_path).unwrap();
        assert!(read_attachment_from_dir(&dir, &saved.relative_path, "image/png").is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_export_and_import_backup_zip_with_validation() {
        let source_dir = temp_test_dir("backup_src");
        let target_dir = temp_test_dir("backup_dst");
        let zip_path = source_dir.join("qa_backup.zip");

        let payload = BASE64.encode(b"screenshot-content");
        let saved = save_attachment_in_dir(&source_dir, "att-99", "evidencia.png", &payload).unwrap();

        let valid_json = r#"{
            "version": 1,
            "exported_at": "2026-10-18T17:00:00Z",
            "columns": [{"id": "col-new", "name": "Novo", "position": 0, "is_done_column": 0}],
            "bugs": [{"id": "bug-1", "column_id": "col-new", "title": "Erro no login", "position": 0}],
            "attachments": [{"id": "att-99", "parent_type": "bug", "parent_id": "bug-1", "file_name": "evidencia.png", "mime_type": "image/png", "relative_path": "attachments/att-99_evidencia.png", "size_bytes": 18}]
        }"#;

        let summary = export_backup_zip_from_dir(&source_dir, &zip_path, valid_json).unwrap();
        assert_eq!(summary.version, 1);
        assert_eq!(summary.columns_count, 1);
        assert_eq!(summary.bugs_count, 1);
        assert_eq!(summary.attachments_count, 1);

        let imported_json = import_backup_zip_to_dir(&target_dir, &zip_path).unwrap();
        assert!(imported_json.contains("Erro no login"));

        let restored_att =
            read_attachment_from_dir(&target_dir, &saved.relative_path, "image/png").unwrap();
        assert_eq!(restored_att.base64_data, payload);

        // Invalid JSON should fail validation
        assert!(validate_backup_json(r#"{"version": 1, "columns": []}"#).is_err());

        let _ = fs::remove_dir_all(&source_dir);
        let _ = fs::remove_dir_all(&target_dir);
    }
}
