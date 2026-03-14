use std::io::Read;
use flate2::read::GzDecoder;
use tar::Archive;
use thiserror::Error;

use crate::db::AppDatabase;
use crate::providers::llm::{generate_embedding, EmbeddingTaskType, LlmProviderError};
use crate::db::DatabaseError;

#[derive(Debug, Error)]
pub enum RagError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("llm error: {0}")]
    Llm(#[from] LlmProviderError),
    #[error("db error: {0}")]
    Db(#[from] DatabaseError),
    #[error("internal error: {0}")]
    Internal(String),
}

pub async fn ingest_repository_tarball(
    db: &AppDatabase,
    repo_name: &str,
    tarball_bytes: &[u8],
    gemini_api_key: &str,
) -> Result<usize, RagError> {
    db.delete_repo_chunks(repo_name)?;
    
    let tar = GzDecoder::new(tarball_bytes);
    let mut archive = Archive::new(tar);
    
    let mut extracted_files = Vec::new();
    
    for entry in archive.entries()? {
        let mut entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = match entry.path() {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => continue,
        };
        
        let file_type = entry.header().entry_type();
        if !file_type.is_file() {
            continue;
        }

        let is_text = path.ends_with(".rs") || path.ends_with(".ts") || path.ends_with(".tsx") 
            || path.ends_with(".js") || path.ends_with(".jsx") || path.ends_with(".md")
            || path.ends_with(".py") || path.ends_with(".go") || path.ends_with(".java")
            || path.ends_with(".html") || path.ends_with(".css") || path.ends_with(".json")
            || path.ends_with(".toml") || path.ends_with(".yml") || path.ends_with(".yaml");

        if !is_text {
            continue;
        }

        let mut contents = String::new();
        if entry.read_to_string(&mut contents).is_ok() {
            extracted_files.push((path, contents));
        }
    }
    
    drop(archive);

    let mut total_chunks_inserted = 0;

    for (path, contents) in extracted_files {
        let chars: Vec<char> = contents.chars().collect();
        let chunk_size = 1500;
        let overlap = 200;
        
        let mut start = 0;
        let mut chunk_index = 0;
        
        while start < chars.len() {
            let end = (start + chunk_size).min(chars.len());
            let chunk_text: String = chars[start..end].iter().collect();
            
            if chunk_text.trim().is_empty() {
                start = end;
                continue;
            }
            
            // Provide context about the file path being chunked
            let label = format!("File: {}\n\n{}", path, chunk_text);
            
            if let Ok(embedding) = generate_embedding(
                gemini_api_key,
                &label,
                EmbeddingTaskType::RetrievalDocument,
            ).await {
                db.insert_repo_chunk(
                    repo_name,
                    &path,
                    chunk_index,
                    &label,
                    &embedding
                )?;
                total_chunks_inserted += 1;
            }
            
            chunk_index += 1;
            
            if end == chars.len() {
                break;
            }
            start += chunk_size - overlap;
        }
    }
    
    Ok(total_chunks_inserted)
}
