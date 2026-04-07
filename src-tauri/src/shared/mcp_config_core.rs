use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use toml_edit::{Document, Item};

use crate::shared::config_toml_core;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpConfigSummary {
    pub configured_server_names: Vec<String>,
    pub startup_timeouts_ms: HashMap<String, u64>,
}

pub(crate) fn read_global_mcp_config_summary(codex_home: &Path) -> Result<McpConfigSummary, String> {
    let (_, document) = config_toml_core::load_global_config_document(codex_home)?;
    Ok(read_mcp_config_summary_from_document(&document))
}

fn read_mcp_config_summary_from_document(document: &Document) -> McpConfigSummary {
    let Some(mcp_servers) = document.get("mcp_servers").and_then(Item::as_table_like) else {
        return McpConfigSummary::default();
    };

    let mut configured_server_names = Vec::new();
    let mut startup_timeouts_ms = HashMap::new();

    for (server_name, server_item) in mcp_servers.iter() {
        let Some(server_table) = server_item.as_table_like() else {
            continue;
        };

        configured_server_names.push(server_name.to_string());

        let Some(timeout_item) = server_table.get("startup_timeout_sec") else {
            continue;
        };

        let timeout_seconds = timeout_item
            .as_float()
            .or_else(|| timeout_item.as_integer().map(|value| value as f64));
        let Some(timeout_seconds) = timeout_seconds else {
            continue;
        };

        if !timeout_seconds.is_finite() || timeout_seconds < 0.0 {
            continue;
        }

        startup_timeouts_ms.insert(server_name.to_string(), (timeout_seconds * 1000.0).round() as u64);
    }

    configured_server_names.sort();

    McpConfigSummary {
        configured_server_names,
        startup_timeouts_ms,
    }
}

pub(crate) fn parse_mcp_config_summary(content: &str) -> Result<McpConfigSummary, String> {
    let document = config_toml_core::parse_document(content)?;
    Ok(read_mcp_config_summary_from_document(&document))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{parse_mcp_config_summary, McpConfigSummary};

    #[test]
    fn parses_bare_and_quoted_mcp_server_sections() {
        let summary = parse_mcp_config_summary(
            r#"
[mcp_servers.xdebug]
startup_timeout_sec = 60

[mcp_servers."acme.server"]
startup_timeout_sec = 12.5

[mcp_servers."quoted.server".env]
FOO = "bar"
"#,
        )
        .expect("parse summary");

        assert_eq!(
            summary,
            McpConfigSummary {
                configured_server_names: vec!["acme.server".to_string(), "quoted.server".to_string(), "xdebug".to_string()],
                startup_timeouts_ms: HashMap::from([
                    ("acme.server".to_string(), 12_500),
                    ("xdebug".to_string(), 60_000),
                ]),
            }
        );
    }
}
