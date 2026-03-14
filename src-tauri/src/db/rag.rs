use rusqlite::Connection;
use uuid::Uuid;
use super::DatabaseError;

#[derive(Debug, Clone)]
pub struct RepoChunkRow {
    pub id: String,
    pub repo_name: String,
    pub file_path: String,
    pub chunk_index: i64,
    pub text: String,
    pub embedding: Option<Vec<f32>>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct RepoChunkSimilarity {
    pub file_path: String,
    pub text: String,
    pub similarity: f32,
}

fn compute_cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    
    let mut dot = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;
    
    for (va, vb) in a.iter().zip(b.iter()) {
        dot += va * vb;
        norm_a += va * va;
        norm_b += vb * vb;
    }
    
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    
    dot / (norm_a.sqrt() * norm_b.sqrt())
}

pub fn insert_repo_chunk(
    connection: &Connection,
    repo_name: &str,
    file_path: &str,
    chunk_index: i64,
    text: &str,
    embedding: &[f32]
) -> Result<(), rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    
    let embedding_bytes: Vec<u8> = embedding
        .iter()
        .flat_map(|val| val.to_ne_bytes())
        .collect();

    connection.execute(
        "
        INSERT OR REPLACE INTO repo_chunks (
            id, repo_name, file_path, chunk_index, text, embedding_blob
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ",
        rusqlite::params![id, repo_name, file_path, chunk_index, text, embedding_bytes],
    )?;
    Ok(())
}

pub fn delete_repo_chunks(connection: &Connection, repo_name: &str) -> Result<(), rusqlite::Error> {
    connection.execute(
        "DELETE FROM repo_chunks WHERE repo_name = ?1",
        rusqlite::params![repo_name],
    )?;
    Ok(())
}

pub fn search_repo_chunks(
    connection: &Connection,
    repo_name: &str,
    query_embedding: &[f32],
    limit: usize,
) -> Result<Vec<RepoChunkSimilarity>, rusqlite::Error> {
    let mut statement = connection.prepare(
        "SELECT file_path, text, embedding_blob FROM repo_chunks WHERE repo_name = ?1"
    )?;
    
    let mut results = Vec::new();
    
    let rows = statement.query_map(rusqlite::params![repo_name], |row| {
        let file_path: String = row.get(0)?;
        let text: String = row.get(1)?;
        let blob: Option<Vec<u8>> = row.get(2)?;
        
        let embedding = if let Some(bytes) = blob {
            let mut vec = Vec::with_capacity(bytes.len() / 4);
            for chunk in bytes.chunks_exact(4) {
                let arr: [u8; 4] = chunk.try_into().unwrap_or_default();
                vec.push(f32::from_ne_bytes(arr));
            }
            vec
        } else {
            Vec::new()
        };
        
        Ok((file_path, text, embedding))
    })?;
    
    for row in rows {
        let (file_path, text, embedding) = row?;
        if embedding.is_empty() {
            continue;
        }
        
        let similarity = compute_cosine_similarity(query_embedding, &embedding);
        results.push(RepoChunkSimilarity {
            file_path,
            text,
            similarity,
        });
    }
    
    results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));
    
    if results.len() > limit {
        results.truncate(limit);
    }
    
    Ok(results)
}

impl super::AppDatabase {
    pub fn insert_repo_chunk(
        &self,
        repo_name: &str,
        file_path: &str,
        chunk_index: i64,
        text: &str,
        embedding: &[f32]
    ) -> Result<(), DatabaseError> {
        self.with_connection(|connection| {
            insert_repo_chunk(connection, repo_name, file_path, chunk_index, text, embedding)
        })
    }

    pub fn delete_repo_chunks(&self, repo_name: &str) -> Result<(), DatabaseError> {
        self.with_connection(|connection| {
            delete_repo_chunks(connection, repo_name)
        })
    }

    pub fn search_repo_chunks(
        &self,
        repo_name: &str,
        query_embedding: &[f32],
        limit: usize,
    ) -> Result<Vec<RepoChunkSimilarity>, DatabaseError> {
        self.with_connection(|connection| {
            search_repo_chunks(connection, repo_name, query_embedding, limit)
        })
    }
}
