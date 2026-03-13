use serde::{Deserialize, Serialize};

use crate::db::{AppDatabase, PromptRow};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRecord {
    pub id: String,
    pub name: String,
    pub content: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePromptInput {
    pub id: Option<String>,
    pub name: String,
    pub content: String,
    pub is_default: Option<bool>,
    pub make_active: Option<bool>,
}

fn map_prompt(row: PromptRow, active_prompt_id: Option<&str>) -> PromptRecord {
    PromptRecord {
        is_active: active_prompt_id == Some(row.id.as_str()),
        id: row.id,
        name: row.name,
        content: row.content,
        is_default: row.is_default,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

pub fn list_prompts(
    database: &AppDatabase,
    active_prompt_id: Option<&str>,
) -> Result<Vec<PromptRecord>, String> {
    database
        .list_prompts()
        .map_err(|error| error.to_string())
        .map(|rows| {
            rows.into_iter()
                .map(|row| map_prompt(row, active_prompt_id))
                .collect()
        })
}

pub fn save_prompt(
    database: &AppDatabase,
    input: &SavePromptInput,
    active_prompt_id: Option<&str>,
) -> Result<PromptRecord, String> {
    let row = database
        .save_prompt(
            input.id.as_deref(),
            input.name.trim(),
            input.content.trim(),
            input.is_default.unwrap_or(false),
        )
        .map_err(|error| error.to_string())?;
    Ok(map_prompt(row, active_prompt_id))
}
