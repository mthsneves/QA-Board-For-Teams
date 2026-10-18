//! External integrations module (Jira, Azure DevOps, Slack, and OS Keyring).
//! All HTTP calls and credential management run strictly inside Rust.
//! Secrets are stored only in the OS native credential store (`keyring`) and never returned to the frontend.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::multipart::{Form, Part};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::storage::resolve_safe_attachment_path;

pub const KEYRING_SERVICE_NAME: &str = "com.qaboard.desktop";

pub const KEY_JIRA_SECRET: &str = "jira_api_secret";
pub const KEY_ADO_PAT: &str = "azure_devops_pat";
pub const KEY_SLACK_WEBHOOK: &str = "slack_webhook_url";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretStatusResponse {
    pub jira_configured: bool,
    pub ado_configured: bool,
    pub slack_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraConfigPayload {
    /// "cloud" or "server"
    pub deployment_type: String,
    pub base_url: String,
    pub email: String,
    pub project_key: String,
    pub issue_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdoConfigPayload {
    /// Default is "https://dev.azure.com", overridable for self-hosted/mock tests
    pub base_url: Option<String>,
    pub organization: String,
    pub project: String,
    pub work_item_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BugSyncPayload {
    pub title: String,
    pub severity: String,
    pub priority: String,
    pub environment: String,
    pub build_version: String,
    pub module: String,
    pub tags: Vec<String>,
    pub steps_to_reproduce: String,
    pub expected_result: String,
    pub actual_result: String,
    pub attachment_paths: Vec<AttachmentUploadItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentUploadItem {
    pub file_name: String,
    pub mime_type: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatedExternalTicket {
    pub provider: String,
    pub key: String,
    pub url: String,
    pub status: String,
    pub attachments_uploaded: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalStatusResponse {
    pub key: String,
    pub status: String,
}

// ============================================================================
// OS Keyring Helpers (Secrets never leave Rust)
// ============================================================================
fn resolve_secret_key(service: &str) -> Result<&'static str, String> {
    match service {
        "jira" => Ok(KEY_JIRA_SECRET),
        "azure_devops" => Ok(KEY_ADO_PAT),
        "slack" => Ok(KEY_SLACK_WEBHOOK),
        _ => Err("Serviço de integração desconhecido.".to_string()),
    }
}

fn set_secret_in_keyring(account_key: &str, secret: &str) -> Result<(), String> {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return Err("O segredo/token informado não pode estar vazio.".to_string());
    }
    let entry = Entry::new(KEYRING_SERVICE_NAME, account_key)
        .map_err(|_| "Não foi possível acessar o cofre de credenciais do sistema operacional.".to_string())?;
    entry
        .set_password(trimmed)
        .map_err(|_| "Falha ao gravar credencial no cofre do sistema operacional.".to_string())
}

fn get_secret_from_keyring(account_key: &str) -> Result<String, String> {
    let entry = Entry::new(KEYRING_SERVICE_NAME, account_key)
        .map_err(|_| "Não foi possível acessar o cofre de credenciais do sistema operacional.".to_string())?;
    entry.get_password().map_err(|_| {
        "Credencial não configurada no cofre do sistema operacional. Configure-a na tela de Configurações.".to_string()
    })
}

fn has_secret_in_keyring(account_key: &str) -> bool {
    Entry::new(KEYRING_SERVICE_NAME, account_key)
        .and_then(|e| e.get_password())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

fn delete_secret_from_keyring(account_key: &str) -> Result<(), String> {
    if let Ok(entry) = Entry::new(KEYRING_SERVICE_NAME, account_key) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

// ============================================================================
// Friendly Error Handling (No Secret or URL Leakage)
// ============================================================================
pub fn map_http_status_error(service_label: &str, status: StatusCode) -> String {
    match status {
        StatusCode::UNAUTHORIZED => format!(
            "{service_label}: Token ou credencial inválida (401 Não Autorizado). Verifique o segredo salvo no cofre do sistema."
        ),
        StatusCode::FORBIDDEN => format!(
            "{service_label}: Sem permissão para executar esta ação no projeto (403 Acesso Negado)."
        ),
        StatusCode::NOT_FOUND => format!(
            "{service_label}: Recurso, projeto ou endpoint não encontrado (404). Verifique a URL base e o nome/chave do projeto."
        ),
        StatusCode::BAD_REQUEST => format!(
            "{service_label}: Requisição inválida (400). Verifique se o projeto e o tipo de item estão corretos."
        ),
        StatusCode::TOO_MANY_REQUESTS => format!(
            "{service_label}: Limite de requisições excedido (429). Aguarde alguns instantes e tente novamente."
        ),
        s if s.is_server_error() => format!(
            "{service_label}: O servidor externo retornou um erro interno ({}). Tente novamente mais tarde.",
            s.as_u16()
        ),
        s => format!(
            "{service_label}: Falha inesperada na comunicação HTTP (código {}).",
            s.as_u16()
        ),
    }
}

pub fn map_reqwest_transport_error(service_label: &str, err: &reqwest::Error) -> String {
    if err.is_timeout() {
        format!(
            "{service_label}: Tempo limite de conexão esgotado (timeout). Verifique sua rede ou VPN."
        )
    } else if err.is_connect() {
        format!(
            "{service_label}: Não foi possível conectar ao servidor. Verifique sua conexão de rede e a URL configurada."
        )
    } else {
        format!("{service_label}: Erro de comunicação de rede ao contatar o serviço.")
    }
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Falha ao inicializar cliente HTTP seguro.".to_string())
}

// ============================================================================
// 1. Slack Integration (Incoming Webhook)
// ============================================================================
pub async fn send_slack_message_with_url(
    client: &Client,
    webhook_url: &str,
    message_text: &str,
) -> Result<String, String> {
    let trimmed_url = webhook_url.trim();
    if !trimmed_url.starts_with("http://") && !trimmed_url.starts_with("https://") {
        return Err("Slack: URL de Webhook inválida.".to_string());
    }
    if message_text.trim().is_empty() {
        return Err("Slack: O texto da mensagem não pode ficar vazio.".to_string());
    }

    let payload = json!({
        "text": message_text
    });

    let response = client
        .post(trimmed_url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| map_reqwest_transport_error("Slack", &e))?;

    if !response.status().is_success() {
        return Err(map_http_status_error("Slack", response.status()));
    }

    Ok("Resumo enviado para o Slack com sucesso!".to_string())
}

// ============================================================================
// 2. Jira Integration (Cloud REST API v3 ADF & Data Center/Server REST API v2)
// ============================================================================
fn build_jira_auth_header(deployment_type: &str, email: &str, secret: &str) -> Result<HeaderValue, String> {
    if deployment_type.eq_ignore_ascii_case("cloud") {
        if email.trim().is_empty() {
            return Err("Jira Cloud requer o e-mail da conta Atlassian configurado.".to_string());
        }
        let credentials = format!("{}:{}", email.trim(), secret.trim());
        let encoded = BASE64.encode(credentials.as_bytes());
        HeaderValue::from_str(&format!("Basic {encoded}"))
            .map_err(|_| "Jira: Falha ao codificar cabeçalho de autenticação.".to_string())
    } else {
        // Jira Data Center / Server: supports Personal Access Token (Bearer) or Basic if email is provided
        if !email.trim().is_empty() {
            let credentials = format!("{}:{}", email.trim(), secret.trim());
            let encoded = BASE64.encode(credentials.as_bytes());
            HeaderValue::from_str(&format!("Basic {encoded}"))
                .map_err(|_| "Jira: Falha ao codificar cabeçalho de autenticação.".to_string())
        } else {
            HeaderValue::from_str(&format!("Bearer {}", secret.trim()))
                .map_err(|_| "Jira: Falha ao codificar token Bearer.".to_string())
        }
    }
}

fn jira_api_version(deployment_type: &str) -> &'static str {
    if deployment_type.eq_ignore_ascii_case("cloud") {
        "3"
    } else {
        "2"
    }
}

fn build_jira_description_value(deployment_type: &str, bug: &BugSyncPayload) -> serde_json::Value {
    let text_summary = format!(
        "Severidade: {} | Prioridade: {}\nAmbiente: {} | Build: {} | Módulo: {}\n\nPassos para Reproduzir:\n{}\n\nResultado Esperado:\n{}\n\nResultado Obtido:\n{}",
        bug.severity,
        bug.priority,
        if bug.environment.is_empty() { "N/A" } else { &bug.environment },
        if bug.build_version.is_empty() { "N/A" } else { &bug.build_version },
        if bug.module.is_empty() { "Geral" } else { &bug.module },
        if bug.steps_to_reproduce.is_empty() { "Não informado" } else { &bug.steps_to_reproduce },
        if bug.expected_result.is_empty() { "Não informado" } else { &bug.expected_result },
        if bug.actual_result.is_empty() { "Não informado" } else { &bug.actual_result },
    );

    if deployment_type.eq_ignore_ascii_case("cloud") {
        // Atlassian Document Format (ADF) required by Jira Cloud REST API v3
        json!({
            "type": "doc",
            "version": 1,
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {
                            "type": "text",
                            "text": text_summary
                        }
                    ]
                }
            ]
        })
    } else {
        // Plain/Wiki string required by Jira Server/Data Center REST API v2
        json!(text_summary)
    }
}

pub async fn test_jira_connection_with_secret(
    client: &Client,
    config: &JiraConfigPayload,
    secret: &str,
) -> Result<String, String> {
    let base = config.base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Jira: Informe a URL base do Jira.".to_string());
    }
    let auth_header = build_jira_auth_header(&config.deployment_type, &config.email, secret)?;
    let api_ver = jira_api_version(&config.deployment_type);
    let url = format!("{base}/rest/api/{api_ver}/myself");

    let response = client
        .get(&url)
        .header(AUTHORIZATION, auth_header)
        .send()
        .await
        .map_err(|e| map_reqwest_transport_error("Jira", &e))?;

    if !response.status().is_success() {
        return Err(map_http_status_error("Jira", response.status()));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Jira: Resposta inválida ao validar usuário.".to_string())?;
    let display_name = body
        .get("displayName")
        .and_then(|v| v.as_str())
        .unwrap_or("Usuário autenticado");

    Ok(format!("Conexão com Jira validada com sucesso ({display_name})!"))
}

pub async fn create_jira_issue_with_secret(
    client: &Client,
    config: &JiraConfigPayload,
    secret: &str,
    bug: &BugSyncPayload,
    app_data_dir: Option<&Path>,
) -> Result<CreatedExternalTicket, String> {
    let base = config.base_url.trim().trim_end_matches('/');
    if base.is_empty() || config.project_key.trim().is_empty() {
        return Err("Jira: Configure a URL base e a chave do projeto (Project Key).".to_string());
    }

    let auth_header = build_jira_auth_header(&config.deployment_type, &config.email, secret)?;
    let api_ver = jira_api_version(&config.deployment_type);
    let create_url = format!("{base}/rest/api/{api_ver}/issue");
    let issue_type = if config.issue_type.trim().is_empty() {
        "Bug"
    } else {
        config.issue_type.trim()
    };

    let payload = json!({
        "fields": {
            "project": { "key": config.project_key.trim() },
            "summary": bug.title,
            "issuetype": { "name": issue_type },
            "description": build_jira_description_value(&config.deployment_type, bug),
            "labels": bug.tags
        }
    });

    let response = client
        .post(&create_url)
        .header(AUTHORIZATION, auth_header.clone())
        .json(&payload)
        .send()
        .await
        .map_err(|e| map_reqwest_transport_error("Jira", &e))?;

    if !response.status().is_success() {
        return Err(map_http_status_error("Jira", response.status()));
    }

    let created_body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Jira: Não foi possível ler a chave da issue criada.".to_string())?;

    let issue_key = created_body
        .get("key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Jira: Resposta da API não retornou a chave da issue.".to_string())?
        .to_string();

    // Upload attachments if app_data_dir is provided
    let mut uploaded_count = 0usize;
    if let Some(base_dir) = app_data_dir {
        let attach_url = format!("{base}/rest/api/{api_ver}/issue/{issue_key}/attachments");
        for att in &bug.attachment_paths {
            if let Ok(full_path) = resolve_safe_attachment_path(base_dir, &att.relative_path) {
                if let Ok(bytes) = fs::read(&full_path) {
                    let part = Part::bytes(bytes)
                        .file_name(att.file_name.clone())
                        .mime_str(&att.mime_type)
                        .unwrap_or_else(|_| Part::bytes(Vec::new()));
                    let form = Form::new().part("file", part);

                    let att_resp = client
                        .post(&attach_url)
                        .header(AUTHORIZATION, auth_header.clone())
                        .header("X-Atlassian-Token", "nocheck")
                        .multipart(form)
                        .send()
                        .await;
                    if let Ok(r) = att_resp {
                        if r.status().is_success() {
                            uploaded_count += 1;
                        }
                    }
                }
            }
        }
    }

    let browse_url = format!("{base}/browse/{issue_key}");
    Ok(CreatedExternalTicket {
        provider: "jira".to_string(),
        key: issue_key,
        url: browse_url,
        status: "Open".to_string(),
        attachments_uploaded: uploaded_count,
    })
}

pub async fn fetch_jira_status_with_secret(
    client: &Client,
    config: &JiraConfigPayload,
    secret: &str,
    issue_key: &str,
) -> Result<ExternalStatusResponse, String> {
    let base = config.base_url.trim().trim_end_matches('/');
    let auth_header = build_jira_auth_header(&config.deployment_type, &config.email, secret)?;
    let api_ver = jira_api_version(&config.deployment_type);
    let url = format!(
        "{base}/rest/api/{api_ver}/issue/{}?fields=status",
        issue_key.trim()
    );

    let response = client
        .get(&url)
        .header(AUTHORIZATION, auth_header)
        .send()
        .await
        .map_err(|e| map_reqwest_transport_error("Jira", &e))?;

    if !response.status().is_success() {
        return Err(map_http_status_error("Jira", response.status()));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Jira: Resposta inválida ao consultar status.".to_string())?;

    let status_name = body
        .pointer("/fields/status/name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Jira: Campo status não encontrado na issue.".to_string())?
        .to_string();

    Ok(ExternalStatusResponse {
        key: issue_key.trim().to_string(),
        status: status_name,
    })
}

// ============================================================================
// 3. Azure DevOps Integration (REST API 7.1 JSON Patch + Attachments)
// ============================================================================
fn build_ado_auth_header(pat: &str) -> Result<HeaderValue, String> {
    let raw = format!(":{}", pat.trim());
    let encoded = BASE64.encode(raw.as_bytes());
    HeaderValue::from_str(&format!("Basic {encoded}"))
        .map_err(|_| "Azure DevOps: Falha ao codificar cabeçalho de autenticação PAT.".to_string())
}

fn resolve_ado_base_url(config: &AdoConfigPayload) -> String {
    config
        .base_url
        .as_deref()
        .unwrap_or("https://dev.azure.com")
        .trim()
        .trim_end_matches('/')
        .to_string()
}

pub async fn test_ado_connection_with_secret(
    client: &Client,
    config: &AdoConfigPayload,
    pat: &str,
) -> Result<String, String> {
    let org = config.organization.trim();
    let project = config.project.trim();
    if org.is_empty() || project.is_empty() {
        return Err("Azure DevOps: Informe a Organização e o Projeto.".to_string());
    }
    let base = resolve_ado_base_url(config);
    let auth_header = build_ado_auth_header(pat)?;
    let url = format!("{base}/{org}/_apis/projects/{project}?api-version=7.1");

    let response = client
        .get(&url)
        .header(AUTHORIZATION, auth_header)
        .send()
        .await
        .map_err(|e| map_reqwest_transport_error("Azure DevOps", &e))?;

    if !response.status().is_success() {
        return Err(map_http_status_error("Azure DevOps", response.status()));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Azure DevOps: Resposta inválida ao validar projeto.".to_string())?;
    let proj_name = body.get("name").and_then(|v| v.as_str()).unwrap_or(project);

    Ok(format!(
        "Conexão com Azure DevOps validada com sucesso (Projeto: {proj_name})!"
    ))
}

pub async fn create_ado_work_item_with_secret(
    client: &Client,
    config: &AdoConfigPayload,
    pat: &str,
    bug: &BugSyncPayload,
    app_data_dir: Option<&Path>,
) -> Result<CreatedExternalTicket, String> {
    let org = config.organization.trim();
    let project = config.project.trim();
    if org.is_empty() || project.is_empty() {
        return Err("Azure DevOps: Configure a Organização e o Projeto.".to_string());
    }

    let base = resolve_ado_base_url(config);
    let auth_header = build_ado_auth_header(pat)?;
    let wit_type = if config.work_item_type.trim().is_empty() {
        "Bug"
    } else {
        config.work_item_type.trim()
    };

    // 1. Upload attachments first so we can link them in the JSON Patch document
    let mut uploaded_urls: Vec<(String, String)> = Vec::new();
    if let Some(base_dir) = app_data_dir {
        for att in &bug.attachment_paths {
            if let Ok(full_path) = resolve_safe_attachment_path(base_dir, &att.relative_path) {
                if let Ok(bytes) = fs::read(&full_path) {
                    let attach_endpoint = format!(
                        "{base}/{org}/{project}/_apis/wit/attachments?fileName={}&api-version=7.1",
                        att.file_name
                    );
                    let resp = client
                        .post(&attach_endpoint)
                        .header(AUTHORIZATION, auth_header.clone())
                        .header(CONTENT_TYPE, "application/octet-stream")
                        .body(bytes)
                        .send()
                        .await;
                    if let Ok(r) = resp {
                        if r.status().is_success() {
                            if let Ok(att_json) = r.json::<serde_json::Value>().await {
                                if let Some(att_url) = att_json.get("url").and_then(|v| v.as_str())
                                {
                                    uploaded_urls.push((att.file_name.clone(), att_url.to_string()));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Build JSON Patch operations for Azure DevOps Bug
    let repro_html = format!(
        "<div><strong>Ambiente:</strong> {} | <strong>Build:</strong> {} | <strong>Módulo:</strong> {}</div><br/><div><strong>Passos para Reproduzir:</strong><br/><pre>{}</pre></div><div><strong>Resultado Esperado:</strong><br/><pre>{}</pre></div><div><strong>Resultado Obtido:</strong><br/><pre>{}</pre></div>",
        bug.environment,
        bug.build_version,
        bug.module,
        bug.steps_to_reproduce,
        bug.expected_result,
        bug.actual_result
    );

    let mut patch_ops = vec![
        json!({
            "op": "add",
            "path": "/fields/System.Title",
            "value": bug.title
        }),
        json!({
            "op": "add",
            "path": "/fields/Microsoft.VSTS.TCM.ReproSteps",
            "value": repro_html
        }),
    ];

    if !bug.tags.is_empty() {
        patch_ops.push(json!({
            "op": "add",
            "path": "/fields/System.Tags",
            "value": bug.tags.join("; ")
        }));
    }

    for (file_name, att_url) in &uploaded_urls {
        patch_ops.push(json!({
            "op": "add",
            "path": "/relations/-",
            "value": {
                "rel": "AttachedFile",
                "url": att_url,
                "attributes": {
                    "comment": format!("Evidência anexada via QA Board: {file_name}")
                }
            }
        }));
    }

    let create_url = format!("{base}/{org}/{project}/_apis/wit/workitems/${wit_type}?api-version=7.1");
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, auth_header);
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/json-patch+json"),
    );

    let response = client
        .post(&create_url)
        .headers(headers)
        .json(&patch_ops)
        .send()
        .await
        .map_err(|e| map_reqwest_transport_error("Azure DevOps", &e))?;

    if !response.status().is_success() {
        return Err(map_http_status_error("Azure DevOps", response.status()));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Azure DevOps: Não foi possível ler o Work Item criado.".to_string())?;

    let id_num = body
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "Azure DevOps: Resposta não contém o ID do Work Item.".to_string())?;
    let id_str = id_num.to_string();

    let state = body
        .pointer("/fields/System.State")
        .and_then(|v| v.as_str())
        .unwrap_or("New")
        .to_string();

    let web_url = body
        .pointer("/_links/html/href")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{base}/{org}/{project}/_workitems/edit/{id_str}"));

    Ok(CreatedExternalTicket {
        provider: "azure_devops".to_string(),
        key: id_str,
        url: web_url,
        status: state,
        attachments_uploaded: uploaded_urls.len(),
    })
}

pub async fn fetch_ado_status_with_secret(
    client: &Client,
    config: &AdoConfigPayload,
    pat: &str,
    work_item_id: &str,
) -> Result<ExternalStatusResponse, String> {
    let org = config.organization.trim();
    let project = config.project.trim();
    let base = resolve_ado_base_url(config);
    let auth_header = build_ado_auth_header(pat)?;
    let url = format!(
        "{base}/{org}/{project}/_apis/wit/workitems/{}?api-version=7.1",
        work_item_id.trim()
    );

    let response = client
        .get(&url)
        .header(AUTHORIZATION, auth_header)
        .send()
        .await
        .map_err(|e| map_reqwest_transport_error("Azure DevOps", &e))?;

    if !response.status().is_success() {
        return Err(map_http_status_error("Azure DevOps", response.status()));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Azure DevOps: Resposta inválida ao consultar status do Work Item.".to_string())?;

    let state = body
        .pointer("/fields/System.State")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Azure DevOps: Campo System.State não encontrado no Work Item.".to_string())?
        .to_string();

    Ok(ExternalStatusResponse {
        key: work_item_id.trim().to_string(),
        status: state,
    })
}

// ============================================================================
// Tauri Commands Exposed to Frontend (Tokens never passed to or from Frontend)
// ============================================================================
#[tauri::command]
pub fn get_integrations_secret_status() -> SecretStatusResponse {
    SecretStatusResponse {
        jira_configured: has_secret_in_keyring(KEY_JIRA_SECRET),
        ado_configured: has_secret_in_keyring(KEY_ADO_PAT),
        slack_configured: has_secret_in_keyring(KEY_SLACK_WEBHOOK),
    }
}

#[tauri::command]
pub fn save_integration_secret(service: String, secret: String) -> Result<SecretStatusResponse, String> {
    let key = resolve_secret_key(&service)?;
    set_secret_in_keyring(key, &secret)?;
    Ok(get_integrations_secret_status())
}

#[tauri::command]
pub fn delete_integration_secret(service: String) -> Result<SecretStatusResponse, String> {
    let key = resolve_secret_key(&service)?;
    delete_secret_from_keyring(key)?;
    Ok(get_integrations_secret_status())
}

#[tauri::command]
pub async fn test_jira_connection(config: JiraConfigPayload) -> Result<String, String> {
    let secret = get_secret_from_keyring(KEY_JIRA_SECRET)?;
    let client = build_http_client()?;
    test_jira_connection_with_secret(&client, &config, &secret).await
}

#[tauri::command]
pub async fn create_jira_issue(
    app: AppHandle,
    config: JiraConfigPayload,
    bug: BugSyncPayload,
) -> Result<CreatedExternalTicket, String> {
    let secret = get_secret_from_keyring(KEY_JIRA_SECRET)?;
    let client = build_http_client()?;
    let app_dir = app.path().app_data_dir().ok();
    create_jira_issue_with_secret(&client, &config, &secret, &bug, app_dir.as_deref()).await
}

#[tauri::command]
pub async fn fetch_jira_issue_status(
    config: JiraConfigPayload,
    issue_key: String,
) -> Result<ExternalStatusResponse, String> {
    let secret = get_secret_from_keyring(KEY_JIRA_SECRET)?;
    let client = build_http_client()?;
    fetch_jira_status_with_secret(&client, &config, &secret, &issue_key).await
}

#[tauri::command]
pub async fn test_ado_connection(config: AdoConfigPayload) -> Result<String, String> {
    let pat = get_secret_from_keyring(KEY_ADO_PAT)?;
    let client = build_http_client()?;
    test_ado_connection_with_secret(&client, &config, &pat).await
}

#[tauri::command]
pub async fn create_ado_work_item(
    app: AppHandle,
    config: AdoConfigPayload,
    bug: BugSyncPayload,
) -> Result<CreatedExternalTicket, String> {
    let pat = get_secret_from_keyring(KEY_ADO_PAT)?;
    let client = build_http_client()?;
    let app_dir = app.path().app_data_dir().ok();
    create_ado_work_item_with_secret(&client, &config, &pat, &bug, app_dir.as_deref()).await
}

#[tauri::command]
pub async fn fetch_ado_work_item_status(
    config: AdoConfigPayload,
    work_item_id: String,
) -> Result<ExternalStatusResponse, String> {
    let pat = get_secret_from_keyring(KEY_ADO_PAT)?;
    let client = build_http_client()?;
    fetch_ado_status_with_secret(&client, &config, &pat, &work_item_id).await
}

#[tauri::command]
pub async fn test_slack_connection() -> Result<String, String> {
    let webhook = get_secret_from_keyring(KEY_SLACK_WEBHOOK)?;
    let client = build_http_client()?;
    send_slack_message_with_url(
        &client,
        &webhook,
        "✅ *QA Board*: Teste de conexão com o Slack realizado com sucesso!",
    )
    .await
}

#[tauri::command]
pub async fn send_slack_run_summary(message_text: String) -> Result<String, String> {
    let webhook = get_secret_from_keyring(KEY_SLACK_WEBHOOK)?;
    let client = build_http_client()?;
    send_slack_message_with_url(&client, &webhook, &message_text).await
}

// ============================================================================
// Automated Rust Integration Tests with API Mocks (`mockito`)
// ============================================================================
#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::save_attachment_in_dir;
    use mockito::Server;
    use std::env;

    fn sample_bug_payload() -> BugSyncPayload {
        BugSyncPayload {
            title: "Erro ao aplicar cupom no carrinho".to_string(),
            severity: "Alta".to_string(),
            priority: "P2 - Alta".to_string(),
            environment: "Staging".to_string(),
            build_version: "v2.4.0".to_string(),
            module: "Checkout".to_string(),
            tags: vec!["regressao".to_string(), "cupom".to_string()],
            steps_to_reproduce: "1. Abrir carrinho\n2. Aplicar cupom".to_string(),
            expected_result: "Desconto aplicado".to_string(),
            actual_result: "Erro 500".to_string(),
            attachment_paths: vec![],
        }
    }

    #[tokio::test]
    async fn test_jira_cloud_create_issue_upload_attachment_and_fetch_status() {
        let mut server = Server::new_async().await;

        let temp_dir = env::temp_dir().join(format!("qaboard_jira_mock_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let saved_att = save_attachment_in_dir(
            &temp_dir,
            "att1",
            "print.png",
            &BASE64.encode(b"png-bytes"),
        )
        .unwrap();

        let mock_create = server
            .mock("POST", "/rest/api/3/issue")
            .with_status(201)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"10001","key":"QA-42"}"#)
            .create_async()
            .await;

        let mock_attach = server
            .mock("POST", "/rest/api/3/issue/QA-42/attachments")
            .match_header("X-Atlassian-Token", "nocheck")
            .with_status(200)
            .with_body(r#"[{"id":"9001","filename":"print.png"}]"#)
            .create_async()
            .await;

        let mock_status = server
            .mock("GET", "/rest/api/3/issue/QA-42?fields=status")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"key":"QA-42","fields":{"status":{"name":"Done"}}}"#)
            .create_async()
            .await;

        let config = JiraConfigPayload {
            deployment_type: "cloud".to_string(),
            base_url: server.url(),
            email: "qa@example.com".to_string(),
            project_key: "QA".to_string(),
            issue_type: "Bug".to_string(),
        };

        let mut bug = sample_bug_payload();
        bug.attachment_paths.push(AttachmentUploadItem {
            file_name: "print.png".to_string(),
            mime_type: "image/png".to_string(),
            relative_path: saved_att.relative_path,
        });

        let client = build_http_client().unwrap();
        let created = create_jira_issue_with_secret(
            &client,
            &config,
            "fake-jira-token",
            &bug,
            Some(&temp_dir),
        )
        .await
        .unwrap();

        assert_eq!(created.key, "QA-42");
        assert_eq!(created.attachments_uploaded, 1);
        mock_create.assert_async().await;
        mock_attach.assert_async().await;

        let status_res = fetch_jira_status_with_secret(&client, &config, "fake-jira-token", "QA-42")
            .await
            .unwrap();
        assert_eq!(status_res.status, "Done");
        mock_status.assert_async().await;

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_azure_devops_create_bug_json_patch_attachment_and_status() {
        let mut server = Server::new_async().await;

        let temp_dir = env::temp_dir().join(format!("qaboard_ado_mock_{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        let saved_att = save_attachment_in_dir(
            &temp_dir,
            "att2",
            "evidencia.png",
            &BASE64.encode(b"ado-image-bytes"),
        )
        .unwrap();

        let mock_upload = server
            .mock(
                "POST",
                "/myorg/myproj/_apis/wit/attachments?fileName=evidencia.png&api-version=7.1",
            )
            .with_status(201)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"att-guid","url":"https://dev.azure.com/myorg/_apis/wit/attachments/att-guid"}"#)
            .create_async()
            .await;

        let mock_create = server
            .mock("POST", "/myorg/myproj/_apis/wit/workitems/$Bug?api-version=7.1")
            .match_header("content-type", "application/json-patch+json")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":778,"fields":{"System.State":"Active"},"_links":{"html":{"href":"https://dev.azure.com/myorg/myproj/_workitems/edit/778"}}}"#)
            .create_async()
            .await;

        let mock_status = server
            .mock("GET", "/myorg/myproj/_apis/wit/workitems/778?api-version=7.1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":778,"fields":{"System.State":"Closed"}}"#)
            .create_async()
            .await;

        let config = AdoConfigPayload {
            base_url: Some(server.url()),
            organization: "myorg".to_string(),
            project: "myproj".to_string(),
            work_item_type: "Bug".to_string(),
        };

        let mut bug = sample_bug_payload();
        bug.attachment_paths.push(AttachmentUploadItem {
            file_name: "evidencia.png".to_string(),
            mime_type: "image/png".to_string(),
            relative_path: saved_att.relative_path,
        });

        let client = build_http_client().unwrap();
        let created = create_ado_work_item_with_secret(
            &client,
            &config,
            "fake-pat-secret",
            &bug,
            Some(&temp_dir),
        )
        .await
        .unwrap();

        assert_eq!(created.key, "778");
        assert_eq!(created.attachments_uploaded, 1);
        mock_upload.assert_async().await;
        mock_create.assert_async().await;

        let status_res = fetch_ado_status_with_secret(&client, &config, "fake-pat-secret", "778")
            .await
            .unwrap();
        assert_eq!(status_res.status, "Closed");
        mock_status.assert_async().await;

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_slack_webhook_and_friendly_error_without_secret_leak() {
        let mut server = Server::new_async().await;

        let mock_slack = server
            .mock("POST", "/services/T000/B000/SECRET123")
            .with_status(200)
            .with_body("ok")
            .create_async()
            .await;

        let client = build_http_client().unwrap();
        let webhook_url = format!("{}/services/T000/B000/SECRET123", server.url());
        let res = send_slack_message_with_url(
            &client,
            &webhook_url,
            "Regressão v2.4: 42 passaram, 3 falharam",
        )
        .await
        .unwrap();
        assert!(res.contains("sucesso"));
        mock_slack.assert_async().await;

        // Test 401 unauthorized error does NOT leak token or secret webhook URL
        let mock_unauth = server
            .mock("POST", "/services/T000/B000/SECRET123")
            .with_status(401)
            .create_async()
            .await;

        let err_msg = send_slack_message_with_url(&client, &webhook_url, "Teste")
            .await
            .unwrap_err();
        assert!(err_msg.contains("401 Não Autorizado"));
        assert!(!err_msg.contains("SECRET123"));
        mock_unauth.assert_async().await;
    }
}
