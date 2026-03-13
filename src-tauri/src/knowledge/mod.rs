use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::db::{AppDatabase, KnowledgeFileRow};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeFileRecord {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub sha256: String,
    pub excerpt: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveKnowledgeFileInput {
    pub name: String,
    pub mime_type: String,
    pub content: String,
}

fn map_file(row: KnowledgeFileRow) -> KnowledgeFileRecord {
    let excerpt = fs::read_to_string(
        row.extracted_text_path
            .as_deref()
            .unwrap_or(row.storage_path.as_str()),
    )
    .unwrap_or_default();

    KnowledgeFileRecord {
        id: row.id,
        name: row.name,
        mime_type: row.mime_type,
        sha256: row.sha256,
        excerpt: excerpt
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(180)
            .collect(),
        created_at: row.created_at,
    }
}

pub fn list_files(database: &AppDatabase) -> Result<Vec<KnowledgeFileRecord>, String> {
    database
        .list_knowledge_files()
        .map_err(|error| error.to_string())
        .map(|rows| rows.into_iter().map(map_file).collect())
}

pub fn ingest_text_file(
    database: &AppDatabase,
    app_dir: &Path,
    input: &SaveKnowledgeFileInput,
) -> Result<KnowledgeFileRecord, String> {
    let normalized_content = input.content.replace("\r\n", "\n");
    let mut hasher = Sha256::new();
    hasher.update(normalized_content.as_bytes());
    let sha256 = hex::encode(hasher.finalize());

    let knowledge_dir = app_dir.join("knowledge");
    let extracted_dir = knowledge_dir.join("extracted");
    fs::create_dir_all(&knowledge_dir).map_err(|error| error.to_string())?;
    fs::create_dir_all(&extracted_dir).map_err(|error| error.to_string())?;

    let safe_name = input
        .name
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '.'
                || character == '-'
                || character == '_'
            {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();

    let storage_path = knowledge_dir.join(format!("{sha256}-{safe_name}.txt"));
    let extracted_path = extracted_dir.join(format!("{sha256}-{safe_name}.txt"));
    fs::write(&storage_path, &normalized_content).map_err(|error| error.to_string())?;
    fs::write(&extracted_path, &normalized_content).map_err(|error| error.to_string())?;

    let row = database
        .insert_knowledge_file(
            input.name.trim(),
            &storage_path.to_string_lossy(),
            input.mime_type.trim(),
            &sha256,
            Some(&extracted_path.to_string_lossy()),
        )
        .map_err(|error| error.to_string())?;

    Ok(map_file(row))
}

pub fn delete_file(database: &AppDatabase, knowledge_file_id: &str) -> Result<(), String> {
    let rows = database
        .list_knowledge_files()
        .map_err(|error| error.to_string())?;
    if let Some(row) = rows
        .into_iter()
        .find(|candidate| candidate.id == knowledge_file_id)
    {
        let _ = fs::remove_file(&row.storage_path);
        if let Some(extracted_text_path) = row.extracted_text_path {
            let _ = fs::remove_file(extracted_text_path);
        }
    }

    database
        .delete_knowledge_file(knowledge_file_id)
        .map_err(|error| error.to_string())
}
