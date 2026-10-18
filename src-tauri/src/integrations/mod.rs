//! External integrations module (Jira, Azure DevOps, Slack, and OS Keyring).
//! All HTTP calls and credential management run strictly inside Rust.

pub const KEYRING_SERVICE_NAME: &str = "com.qaboard.desktop";
