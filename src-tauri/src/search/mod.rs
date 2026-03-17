use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{Duration as ChronoDuration, Utc};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, Notify};

use crate::db::{AppDatabase, SearchResultRow, SessionRow, TranscriptRow};
use crate::providers::llm::{generate_embedding, EmbeddingTaskType};
use crate::secrets::AppSecretStore;

const SEARCH_CHUNK_MAX_CHARS: usize = 1_200;
const SEARCH_CHUNK_OVERLAP_SEGMENTS: usize = 2;
const SEARCH_QUERY_CACHE_CAPACITY: usize = 64;
const SEARCH_JOB_POLL_INTERVAL: Duration = Duration::from_millis(800);
const SEARCH_JOB_MAX_ATTEMPTS: u32 = 5;
const SEARCH_JOB_BASE_BACKOFF_SECS: i64 = 30;
const SEARCH_FUSION_K: f32 = 40.0;
const SEARCH_LEXICAL_WEIGHT: f32 = 1.0;
const SEARCH_SEMANTIC_WEIGHT: f32 = 0.9;
const SEARCH_MIN_SEMANTIC_SIMILARITY: f32 = 0.58;
const CONTEXT_MIN_SEMANTIC_SIMILARITY: f32 = 0.42;

#[derive(Clone)]
pub struct SearchRuntime {
    inner: Arc<SearchRuntimeInner>,
}

#[derive(Clone)]
pub struct SearchIndexer {
    inner: Arc<SearchRuntimeInner>,
}

#[derive(Clone)]
pub struct SessionContextRetriever {
    inner: Arc<SearchRuntimeInner>,
}

struct SearchRuntimeInner {
    database: Arc<AppDatabase>,
    secret_store: Arc<dyn AppSecretStore>,
    provider: Arc<dyn EmbeddingProvider>,
    query_cache: Mutex<QueryEmbeddingCache>,
    notify: Notify,
    started: AtomicBool,
}

#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    fn provider_name(&self) -> &'static str;
    fn model_name(&self) -> &'static str;
    fn embedding_version(&self) -> &'static str;
    async fn embed(&self, api_key: &str, text: &str, task_type: EmbeddingTaskType)
        -> Result<Vec<f32>, String>;
}

#[derive(Default)]
struct GeminiEmbeddingProvider;

#[async_trait]
impl EmbeddingProvider for GeminiEmbeddingProvider {
    fn provider_name(&self) -> &'static str {
        "Gemini"
    }

    fn model_name(&self) -> &'static str {
        "gemini-embedding-001"
    }

    fn embedding_version(&self) -> &'static str {
        "gemini-embedding-001-v1"
    }

    async fn embed(
        &self,
        api_key: &str,
        text: &str,
        task_type: EmbeddingTaskType,
    ) -> Result<Vec<f32>, String> {
        generate_embedding(api_key, text, task_type)
            .await
            .map_err(|error| error.to_string())
    }
}

#[derive(Default)]
struct QueryEmbeddingCache {
    order: VecDeque<String>,
    values: HashMap<String, Vec<f32>>,
}

#[derive(Debug, Clone)]
struct SearchJob {
    session_id: String,
    attempts: u32,
}

#[derive(Debug, Clone)]
struct IndexedChunk {
    id: String,
    session_id: String,
    source_kind: String,
    chunk_index: i64,
    sequence_start: Option<i64>,
    sequence_end: Option<i64>,
    text: String,
    text_hash: String,
    token_estimate: i64,
}

#[derive(Debug, Clone)]
struct PendingEmbeddingChunk {
    id: String,
    text: String,
}

#[derive(Debug, Clone)]
struct ReadyChunk {
    session_id: String,
    title: String,
    status: String,
    updated_at: String,
    source_kind: String,
    chunk_index: i64,
    sequence_start: Option<i64>,
    sequence_end: Option<i64>,
    text: String,
    vector: Vec<f32>,
}

#[derive(Debug, Clone)]
struct SessionResultCandidate {
    row: SearchResultRow,
    rank_score: f32,
    semantic_hit: bool,
}

#[derive(Debug, Clone)]
pub struct RetrievedContextChunk {
    pub text: String,
    pub sequence_start: i64,
    pub sequence_end: i64,
}

#[derive(Debug, Clone)]
pub struct CrossSessionContextChunk {
    pub session_id: String,
    pub session_title: String,
    pub text: String,
    pub source_kind: String,
    pub sequence_start: i64,
    pub sequence_end: i64,
}

#[derive(Debug, Clone)]
struct ContextChunkCandidate {
    chunk: ReadyChunk,
    rank_score: f32,
}

impl QueryEmbeddingCache {
    fn get(&self, key: &str) -> Option<Vec<f32>> {
        self.values.get(key).cloned()
    }

    fn insert(&mut self, key: String, value: Vec<f32>) {
        if self.values.contains_key(&key) {
            self.order.retain(|existing| existing != &key);
        }
        self.order.push_back(key.clone());
        self.values.insert(key, value);

        while self.order.len() > SEARCH_QUERY_CACHE_CAPACITY {
            if let Some(oldest) = self.order.pop_front() {
                self.values.remove(&oldest);
            }
        }
    }
}

impl SearchRuntime {
    pub fn new(database: Arc<AppDatabase>, secret_store: Arc<dyn AppSecretStore>) -> Self {
        Self {
            inner: Arc::new(SearchRuntimeInner {
                database,
                secret_store,
                provider: Arc::new(GeminiEmbeddingProvider),
                query_cache: Mutex::new(QueryEmbeddingCache::default()),
                notify: Notify::new(),
                started: AtomicBool::new(false),
            }),
        }
    }

    pub fn indexer(&self) -> SearchIndexer {
        SearchIndexer {
            inner: Arc::clone(&self.inner),
        }
    }

    pub fn context_retriever(&self) -> SessionContextRetriever {
        SessionContextRetriever {
            inner: Arc::clone(&self.inner),
        }
    }

    pub fn start(&self) {
        if self
            .inner
            .started
            .swap(true, AtomicOrdering::SeqCst)
        {
            return;
        }

        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let _ = runtime.indexer().enqueue_all_sessions();

            loop {
                match runtime.indexer().process_next_job().await {
                    Ok(true) => continue,
                    Ok(false) => {}
                    Err(_) => {}
                }

                tokio::select! {
                    _ = runtime.inner.notify.notified() => {}
                    _ = tokio::time::sleep(SEARCH_JOB_POLL_INTERVAL) => {}
                }
            }
        });
    }

    pub fn enqueue_session_reindex(&self, session_id: &str) -> Result<(), String> {
        self.indexer().enqueue_session(session_id)
    }

    pub fn enqueue_all_sessions(&self) -> Result<(), String> {
        self.indexer().enqueue_all_sessions()
    }

    pub async fn search_sessions(
        &self,
        query: &str,
        mode: &str,
        limit: usize,
    ) -> Result<Vec<SearchResultRow>, String> {
        let lexical = self
            .inner
            .database
            .search_sessions(query, limit.saturating_mul(2).max(limit))
            .map_err(|error| error.to_string())?;
        if mode != "hybrid" {
            return Ok(lexical);
        }

        let Some(query_embedding) = self.cached_query_embedding(query).await? else {
            return Ok(lexical);
        };

        let ready_chunks = load_ready_chunks(self.inner.database.as_ref(), None, None)?;
        if ready_chunks.is_empty() {
            return Ok(lexical);
        }

        let semantic = score_semantic_session_candidates(&ready_chunks, &query_embedding);
        if semantic.is_empty() {
            return Ok(lexical);
        }

        Ok(fuse_session_results(lexical, semantic, limit))
    }

    pub async fn retrieve_session_context(
        &self,
        session_id: &str,
        prompt: &str,
        limit: usize,
    ) -> Result<Option<Vec<RetrievedContextChunk>>, String> {
        self.context_retriever()
            .retrieve(session_id, prompt, limit)
            .await
    }

    pub async fn retrieve_cross_session_context(
        &self,
        prompt: &str,
        limit: usize,
        exclude_session_id: Option<&str>,
    ) -> Result<Option<Vec<CrossSessionContextChunk>>, String> {
        let Some(query_embedding) = self.cached_query_embedding(prompt).await? else {
            return Ok(None);
        };

        let all_chunks = load_ready_chunks(self.inner.database.as_ref(), None, Some("transcript"))?;
        let chunks: Vec<ReadyChunk> = match exclude_session_id {
            Some(exclude) => all_chunks.into_iter().filter(|c| c.session_id != exclude).collect(),
            None => all_chunks,
        };

        if chunks.is_empty() {
            return Ok(None);
        }

        let mut scored: Vec<(f32, ReadyChunk)> = chunks
            .into_iter()
            .filter_map(|chunk| {
                let similarity = cosine_similarity(&query_embedding, &chunk.vector);
                if !similarity.is_finite() || similarity < CONTEXT_MIN_SEMANTIC_SIMILARITY {
                    return None;
                }
                Some((similarity, chunk))
            })
            .collect();

        if scored.is_empty() {
            return Ok(None);
        }

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
        scored.truncate(limit);

        Ok(Some(
            scored
                .into_iter()
                .map(|(_, chunk)| CrossSessionContextChunk {
                    session_id: chunk.session_id,
                    session_title: chunk.title,
                    text: chunk.text,
                    source_kind: chunk.source_kind,
                    sequence_start: chunk.sequence_start.unwrap_or_default(),
                    sequence_end: chunk
                        .sequence_end
                        .unwrap_or(chunk.sequence_start.unwrap_or_default()),
                })
                .collect(),
        ))
    }

    async fn cached_query_embedding(&self, query: &str) -> Result<Option<Vec<f32>>, String> {
        let normalized = normalize_query_key(query);
        if normalized.is_empty() {
            return Ok(None);
        }

        {
            let cache = self.inner.query_cache.lock().await;
            if let Some(value) = cache.get(&normalized) {
                return Ok(Some(value));
            }
        }

        let Some(api_key) = load_gemini_key(self.inner.secret_store.as_ref())? else {
            return Ok(None);
        };

        let embedding = self
            .inner
            .provider
            .embed(&api_key, query, EmbeddingTaskType::RetrievalQuery)
            .await?;
        let mut cache = self.inner.query_cache.lock().await;
        cache.insert(normalized, embedding.clone());
        Ok(Some(embedding))
    }
}

impl SearchIndexer {
    pub fn enqueue_session(&self, session_id: &str) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        let connection = self.inner.database.connect().map_err(|error| error.to_string())?;
        connection
            .execute(
                "
                INSERT INTO search_index_jobs (
                    session_id,
                    status,
                    attempts,
                    last_error,
                    next_run_at,
                    queued_at,
                    updated_at
                ) VALUES (?1, 'queued', 0, NULL, NULL, ?2, ?2)
                ON CONFLICT(session_id) DO UPDATE SET
                    status = 'queued',
                    attempts = 0,
                    last_error = NULL,
                    next_run_at = NULL,
                    queued_at = excluded.queued_at,
                    updated_at = excluded.updated_at
                ",
                params![session_id, now],
            )
            .map_err(|error| error.to_string())?;
        self.inner.notify.notify_one();
        Ok(())
    }

    pub fn enqueue_all_sessions(&self) -> Result<(), String> {
        for session in self
            .inner
            .database
            .list_sessions()
            .map_err(|error| error.to_string())?
        {
            self.enqueue_session(&session.id)?;
        }
        Ok(())
    }

    async fn process_next_job(&self) -> Result<bool, String> {
        let Some(job) = take_next_job(self.inner.database.as_ref())? else {
            return Ok(false);
        };

        match rebuild_session_index(&self.inner, &job.session_id).await {
            Ok(()) => {
                complete_job(self.inner.database.as_ref(), &job.session_id)?;
            }
            Err(error) => {
                fail_job(self.inner.database.as_ref(), &job.session_id, job.attempts + 1, &error)?;
            }
        }

        Ok(true)
    }
}

impl SessionContextRetriever {
    pub async fn retrieve(
        &self,
        session_id: &str,
        prompt: &str,
        limit: usize,
    ) -> Result<Option<Vec<RetrievedContextChunk>>, String> {
        let runtime = SearchRuntime {
            inner: Arc::clone(&self.inner),
        };
        let Some(query_embedding) = runtime.cached_query_embedding(prompt).await? else {
            return Ok(None);
        };

        let ready_chunks = load_ready_chunks(
            self.inner.database.as_ref(),
            Some(session_id),
            Some("transcript"),
        )?;
        if ready_chunks.is_empty() {
            return Ok(None);
        }

        let lexical_candidates = score_lexical_context_candidates(&ready_chunks, prompt);
        let semantic_candidates =
            score_semantic_context_candidates(&ready_chunks, &query_embedding);
        let fused = fuse_context_candidates(
            lexical_candidates,
            semantic_candidates,
            limit,
            ready_chunks,
        );

        if fused.is_empty() {
            return Ok(None);
        }

        Ok(Some(
            fused.into_iter()
                .map(|candidate| RetrievedContextChunk {
                    text: candidate.chunk.text,
                    sequence_start: candidate.chunk.sequence_start.unwrap_or_default(),
                    sequence_end: candidate
                        .chunk
                        .sequence_end
                        .unwrap_or(candidate.chunk.sequence_start.unwrap_or_default()),
                })
                .collect(),
        ))
    }
}

async fn rebuild_session_index(
    inner: &SearchRuntimeInner,
    session_id: &str,
) -> Result<(), String> {
    let Some(session) = inner
        .database
        .get_session(session_id)
        .map_err(|error| error.to_string())?
    else {
        cleanup_session_index(inner.database.as_ref(), session_id)?;
        return Ok(());
    };

    let transcripts = inner
        .database
        .list_transcript_segments(session_id)
        .map_err(|error| error.to_string())?;
    let chunks = build_index_chunks(&session, &transcripts);
    let pending = sync_chunks(inner.database.as_ref(), session_id, &chunks)?;

    if pending.is_empty() {
        return Ok(());
    }

    let Some(api_key) = load_gemini_key(inner.secret_store.as_ref())? else {
        return Err("Gemini API key is not configured.".to_string());
    };

    for chunk in pending {
        match inner
            .provider
            .embed(&api_key, &chunk.text, EmbeddingTaskType::RetrievalDocument)
            .await
        {
            Ok(vector) => save_ready_embedding(inner.database.as_ref(), &chunk.id, &vector, inner.provider.as_ref())?,
            Err(error) => {
                save_failed_embedding(inner.database.as_ref(), &chunk.id, &error, inner.provider.as_ref())?;
                return Err(error);
            }
        }
    }

    Ok(())
}

fn take_next_job(database: &AppDatabase) -> Result<Option<SearchJob>, String> {
    let now = Utc::now().to_rfc3339();
    let connection = database.connect().map_err(|error| error.to_string())?;
    let job = connection
        .query_row(
            "
            SELECT session_id, attempts
            FROM search_index_jobs
            WHERE status IN ('queued', 'failed')
              AND (next_run_at IS NULL OR next_run_at <= ?1)
            ORDER BY updated_at ASC
            LIMIT 1
            ",
            params![now],
            |row| {
                Ok(SearchJob {
                    session_id: row.get(0)?,
                    attempts: row.get::<_, i64>(1)?.max(0) as u32,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if let Some(job) = &job {
        connection
            .execute(
                "
                UPDATE search_index_jobs
                SET status = 'running',
                    updated_at = ?2
                WHERE session_id = ?1
                ",
                params![job.session_id, now],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(job)
}

fn complete_job(database: &AppDatabase, session_id: &str) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            UPDATE search_index_jobs
            SET status = 'completed',
                attempts = 0,
                last_error = NULL,
                next_run_at = NULL,
                updated_at = ?2
            WHERE session_id = ?1
            ",
            params![session_id, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn fail_job(
    database: &AppDatabase,
    session_id: &str,
    attempts: u32,
    error: &str,
) -> Result<(), String> {
    let now = Utc::now();
    let capped_attempts = attempts.min(SEARCH_JOB_MAX_ATTEMPTS);
    let backoff_multiplier = 1_i64 << capped_attempts.saturating_sub(1).min(4);
    let next_run_at =
        (now + ChronoDuration::seconds(SEARCH_JOB_BASE_BACKOFF_SECS * backoff_multiplier))
            .to_rfc3339();
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            UPDATE search_index_jobs
            SET status = 'failed',
                attempts = ?2,
                last_error = ?3,
                next_run_at = ?4,
                updated_at = ?5
            WHERE session_id = ?1
            ",
            params![
                session_id,
                capped_attempts as i64,
                error.chars().take(300).collect::<String>(),
                next_run_at,
                now.to_rfc3339()
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn cleanup_session_index(database: &AppDatabase, session_id: &str) -> Result<(), String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM search_embeddings WHERE chunk_id IN (SELECT id FROM search_chunks WHERE session_id = ?1)",
            params![session_id],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM search_chunks WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn sync_chunks(
    database: &AppDatabase,
    session_id: &str,
    chunks: &[IndexedChunk],
) -> Result<Vec<PendingEmbeddingChunk>, String> {
    let now = Utc::now().to_rfc3339();
    let mut connection = database.connect().map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    let existing_ids = {
        let mut statement = transaction
            .prepare("SELECT id FROM search_chunks WHERE session_id = ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![session_id], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<HashSet<_>, _>>()
            .map_err(|error| error.to_string())?
    };

    let next_ids = chunks.iter().map(|chunk| chunk.id.clone()).collect::<HashSet<_>>();
    for removed_id in existing_ids.difference(&next_ids) {
        transaction
            .execute(
                "DELETE FROM search_embeddings WHERE chunk_id = ?1",
                params![removed_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM search_chunks WHERE id = ?1", params![removed_id])
            .map_err(|error| error.to_string())?;
    }

    for chunk in chunks {
        transaction
            .execute(
                "
                INSERT INTO search_chunks (
                    id,
                    session_id,
                    knowledge_file_id,
                    source_kind,
                    chunk_index,
                    sequence_start,
                    sequence_end,
                    text,
                    text_hash,
                    token_estimate,
                    created_at,
                    updated_at
                ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
                ON CONFLICT(id) DO UPDATE SET
                    session_id = excluded.session_id,
                    source_kind = excluded.source_kind,
                    chunk_index = excluded.chunk_index,
                    sequence_start = excluded.sequence_start,
                    sequence_end = excluded.sequence_end,
                    text = excluded.text,
                    text_hash = excluded.text_hash,
                    token_estimate = excluded.token_estimate,
                    updated_at = excluded.updated_at
                ",
                params![
                    chunk.id,
                    chunk.session_id,
                    chunk.source_kind,
                    chunk.chunk_index,
                    chunk.sequence_start,
                    chunk.sequence_end,
                    chunk.text,
                    chunk.text_hash,
                    chunk.token_estimate,
                    now,
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "
                INSERT INTO search_embeddings (
                    chunk_id,
                    provider,
                    model,
                    dimensions,
                    vector_blob,
                    embedding_version,
                    status,
                    embedded_at,
                    last_error
                ) VALUES (?1, '', '', NULL, NULL, '', 'pending', NULL, NULL)
                ON CONFLICT(chunk_id) DO NOTHING
                ",
                params![chunk.id],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;

    let connection = database.connect().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT sc.id, sc.text
            FROM search_chunks sc
            LEFT JOIN search_embeddings se ON se.chunk_id = sc.id
            WHERE sc.session_id = ?1
              AND COALESCE(se.status, 'pending') != 'ready'
            ORDER BY sc.source_kind ASC, sc.chunk_index ASC
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![session_id], |row| {
            Ok(PendingEmbeddingChunk {
                id: row.get(0)?,
                text: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn save_ready_embedding(
    database: &AppDatabase,
    chunk_id: &str,
    vector: &[f32],
    provider: &dyn EmbeddingProvider,
) -> Result<(), String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    let vector_blob = serde_json::to_vec(vector).map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            UPDATE search_embeddings
            SET provider = ?2,
                model = ?3,
                dimensions = ?4,
                vector_blob = ?5,
                embedding_version = ?6,
                status = 'ready',
                embedded_at = ?7,
                last_error = NULL
            WHERE chunk_id = ?1
            ",
            params![
                chunk_id,
                provider.provider_name(),
                provider.model_name(),
                vector.len() as i64,
                vector_blob,
                provider.embedding_version(),
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn save_failed_embedding(
    database: &AppDatabase,
    chunk_id: &str,
    error: &str,
    provider: &dyn EmbeddingProvider,
) -> Result<(), String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            UPDATE search_embeddings
            SET provider = ?2,
                model = ?3,
                embedding_version = ?4,
                status = 'failed',
                last_error = ?5
            WHERE chunk_id = ?1
            ",
            params![
                chunk_id,
                provider.provider_name(),
                provider.model_name(),
                provider.embedding_version(),
                error.chars().take(300).collect::<String>()
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn load_ready_chunks(
    database: &AppDatabase,
    session_id: Option<&str>,
    source_kind: Option<&str>,
) -> Result<Vec<ReadyChunk>, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    let sql = match (session_id.is_some(), source_kind.is_some()) {
        (true, true) => "
            SELECT
                sc.session_id,
                s.title,
                s.status,
                s.updated_at,
                sc.source_kind,
                sc.chunk_index,
                sc.sequence_start,
                sc.sequence_end,
                sc.text,
                se.vector_blob
            FROM search_chunks sc
            JOIN sessions s ON s.id = sc.session_id
            JOIN search_embeddings se ON se.chunk_id = sc.id
            WHERE se.status = 'ready'
              AND sc.session_id = ?1
              AND sc.source_kind = ?2
            ORDER BY sc.chunk_index ASC
        ",
        (true, false) => "
            SELECT
                sc.session_id,
                s.title,
                s.status,
                s.updated_at,
                sc.source_kind,
                sc.chunk_index,
                sc.sequence_start,
                sc.sequence_end,
                sc.text,
                se.vector_blob
            FROM search_chunks sc
            JOIN sessions s ON s.id = sc.session_id
            JOIN search_embeddings se ON se.chunk_id = sc.id
            WHERE se.status = 'ready'
              AND sc.session_id = ?1
            ORDER BY sc.source_kind ASC, sc.chunk_index ASC
        ",
        (false, true) => "
            SELECT
                sc.session_id,
                s.title,
                s.status,
                s.updated_at,
                sc.source_kind,
                sc.chunk_index,
                sc.sequence_start,
                sc.sequence_end,
                sc.text,
                se.vector_blob
            FROM search_chunks sc
            JOIN sessions s ON s.id = sc.session_id
            JOIN search_embeddings se ON se.chunk_id = sc.id
            WHERE se.status = 'ready'
              AND sc.source_kind = ?1
            ORDER BY s.updated_at DESC, sc.chunk_index ASC
        ",
        (false, false) => "
            SELECT
                sc.session_id,
                s.title,
                s.status,
                s.updated_at,
                sc.source_kind,
                sc.chunk_index,
                sc.sequence_start,
                sc.sequence_end,
                sc.text,
                se.vector_blob
            FROM search_chunks sc
            JOIN sessions s ON s.id = sc.session_id
            JOIN search_embeddings se ON se.chunk_id = sc.id
            WHERE se.status = 'ready'
            ORDER BY s.updated_at DESC, sc.source_kind ASC, sc.chunk_index ASC
        ",
    };

    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = match (session_id, source_kind) {
        (Some(session_id), Some(source_kind)) => statement.query_map(params![session_id, source_kind], map_ready_chunk),
        (Some(session_id), None) => statement.query_map(params![session_id], map_ready_chunk),
        (None, Some(source_kind)) => statement.query_map(params![source_kind], map_ready_chunk),
        (None, None) => statement.query_map([], map_ready_chunk),
    }
    .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn map_ready_chunk(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReadyChunk> {
    let vector_blob: Vec<u8> = row.get(9)?;
    let vector =
        serde_json::from_slice::<Vec<f32>>(&vector_blob).unwrap_or_default();
    Ok(ReadyChunk {
        session_id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        updated_at: row.get(3)?,
        source_kind: row.get(4)?,
        chunk_index: row.get(5)?,
        sequence_start: row.get(6)?,
        sequence_end: row.get(7)?,
        text: row.get(8)?,
        vector,
    })
}

fn build_index_chunks(session: &SessionRow, transcripts: &[TranscriptRow]) -> Vec<IndexedChunk> {
    let mut chunks = build_transcript_chunks(&session.id, transcripts);

    for (source_kind, value) in [
        ("rolling_summary", session.rolling_summary.as_deref()),
        ("final_summary", session.final_summary.as_deref()),
        ("decisions_md", session.decisions_md.as_deref()),
        ("action_items_md", session.action_items_md.as_deref()),
        ("notes_md", session.notes_md.as_deref()),
    ] {
        let Some(text) = value.map(str::trim).filter(|value| !value.is_empty()) else {
            continue;
        };
        chunks.push(indexed_chunk(
            &session.id,
            source_kind,
            0,
            None,
            None,
            text.to_string(),
        ));
    }

    chunks
}

fn build_transcript_chunks(session_id: &str, transcripts: &[TranscriptRow]) -> Vec<IndexedChunk> {
    let final_segments = transcripts
        .iter()
        .filter(|segment| segment.is_final && !segment.text.trim().is_empty())
        .collect::<Vec<_>>();

    let mut chunks = Vec::new();
    let mut start = 0usize;
    let mut chunk_index = 0i64;

    while start < final_segments.len() {
        let mut end = start;
        let mut text = String::new();
        let sequence_start = final_segments[start].sequence_no;
        let mut sequence_end = sequence_start;

        while end < final_segments.len() {
            let line = format_transcript_segment(final_segments[end]);
            let addition = if text.is_empty() {
                line.clone()
            } else {
                format!("{text}\n{line}")
            };

            if !text.is_empty() && addition.len() > SEARCH_CHUNK_MAX_CHARS {
                break;
            }

            text = addition;
            sequence_end = final_segments[end].sequence_no;
            end += 1;

            if text.len() >= SEARCH_CHUNK_MAX_CHARS {
                break;
            }
        }

        chunks.push(indexed_chunk(
            session_id,
            "transcript",
            chunk_index,
            Some(sequence_start),
            Some(sequence_end),
            text,
        ));
        chunk_index += 1;

        if end >= final_segments.len() {
            break;
        }

        let consumed = end.saturating_sub(start);
        let overlap = SEARCH_CHUNK_OVERLAP_SEGMENTS.min(consumed.saturating_sub(1));
        start = end.saturating_sub(overlap);
    }

    chunks
}

fn indexed_chunk(
    session_id: &str,
    source_kind: &str,
    chunk_index: i64,
    sequence_start: Option<i64>,
    sequence_end: Option<i64>,
    text: String,
) -> IndexedChunk {
    let text_hash = hash_text(&text);
    IndexedChunk {
        id: chunk_id(session_id, source_kind, chunk_index, &text_hash),
        session_id: session_id.to_string(),
        source_kind: source_kind.to_string(),
        chunk_index,
        sequence_start,
        sequence_end,
        token_estimate: estimate_tokens(&text),
        text,
        text_hash,
    }
}

fn format_transcript_segment(segment: &TranscriptRow) -> String {
    let speaker = segment
        .speaker_label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Unattributed");
    format!("{speaker}: {}", segment.text.trim())
}

fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

fn chunk_id(session_id: &str, source_kind: &str, chunk_index: i64, text_hash: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(session_id.as_bytes());
    hasher.update(b":");
    hasher.update(source_kind.as_bytes());
    hasher.update(b":");
    hasher.update(chunk_index.to_string().as_bytes());
    hasher.update(b":");
    hasher.update(text_hash.as_bytes());
    format!("search_{}", hex::encode(hasher.finalize()))
}

fn estimate_tokens(text: &str) -> i64 {
    text.split_whitespace().count() as i64
}

fn load_gemini_key(secret_store: &dyn AppSecretStore) -> Result<Option<String>, String> {
    secret_store
        .read_secret("gemini_api_key")
        .map_err(|error| error.to_string())
        .map(|value| value.filter(|key| !key.trim().is_empty()))
}

fn normalize_query_key(query: &str) -> String {
    query
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.trim().is_empty())
        .map(|token| token.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_prompt_terms(prompt: &str) -> HashSet<String> {
    let stop_words = [
        "the", "and", "that", "with", "from", "about", "what", "when", "where", "does",
        "have", "will", "this", "they", "them", "into", "for", "you", "your", "were",
        "could", "should", "would", "then", "than", "there", "their", "it's", "its",
    ]
    .into_iter()
    .collect::<HashSet<_>>();

    prompt
        .split(|character: char| !character.is_alphanumeric())
        .filter_map(|term| {
            let normalized = term.trim().to_lowercase();
            if normalized.len() < 3 || stop_words.contains(normalized.as_str()) {
                None
            } else {
                Some(normalized)
            }
        })
        .collect::<HashSet<_>>()
}

fn lexical_overlap_score(text: &str, prompt_terms: &HashSet<String>) -> f32 {
    if prompt_terms.is_empty() {
        return 0.0;
    }

    let normalized = text.to_lowercase();
    prompt_terms
        .iter()
        .filter(|term| normalized.contains(term.as_str()))
        .count() as f32
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.is_empty() || right.is_empty() || left.len() != right.len() {
        return 0.0;
    }

    let mut dot = 0.0_f32;
    let mut left_norm = 0.0_f32;
    let mut right_norm = 0.0_f32;
    for (left_value, right_value) in left.iter().zip(right.iter()) {
        dot += left_value * right_value;
        left_norm += left_value * left_value;
        right_norm += right_value * right_value;
    }

    if left_norm <= f32::EPSILON || right_norm <= f32::EPSILON {
        return 0.0;
    }

    dot / (left_norm.sqrt() * right_norm.sqrt())
}

fn score_semantic_session_candidates(
    chunks: &[ReadyChunk],
    query_embedding: &[f32],
) -> Vec<SessionResultCandidate> {
    let mut candidates = chunks
        .iter()
        .filter_map(|chunk| {
            let similarity = cosine_similarity(query_embedding, &chunk.vector);
            if !similarity.is_finite() || similarity < SEARCH_MIN_SEMANTIC_SIMILARITY {
                return None;
            }

            let (matched_field, match_label) =
                semantic_match_metadata(&chunk.source_kind);
            Some(SessionResultCandidate {
                row: SearchResultRow {
                    session_id: chunk.session_id.clone(),
                    title: chunk.title.clone(),
                    status: chunk.status.clone(),
                    updated_at: chunk.updated_at.clone(),
                    snippet: compact_snippet(&chunk.text, 220),
                    matched_field: matched_field.to_string(),
                    match_label: match_label.to_string(),
                    retrieval_mode: "hybrid".to_string(),
                    transcript_sequence_start: chunk.sequence_start,
                    transcript_sequence_end: chunk.sequence_end,
                },
                rank_score: similarity,
                semantic_hit: true,
            })
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| {
        right
            .rank_score
            .partial_cmp(&left.rank_score)
            .unwrap_or(Ordering::Equal)
    });
    candidates
}

fn score_lexical_context_candidates(
    chunks: &[ReadyChunk],
    prompt: &str,
) -> Vec<ContextChunkCandidate> {
    let prompt_terms = build_prompt_terms(prompt);
    let mut candidates = chunks
        .iter()
        .filter_map(|chunk| {
            let overlap = lexical_overlap_score(&chunk.text, &prompt_terms);
            if overlap <= 0.0 {
                return None;
            }
            let recency_bonus = chunk.sequence_end.unwrap_or_default() as f32 / 10_000.0;
            Some(ContextChunkCandidate {
                chunk: chunk.clone(),
                rank_score: overlap + recency_bonus,
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .rank_score
            .partial_cmp(&left.rank_score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.chunk.chunk_index.cmp(&right.chunk.chunk_index))
    });
    candidates
}

fn score_semantic_context_candidates(
    chunks: &[ReadyChunk],
    query_embedding: &[f32],
) -> Vec<ContextChunkCandidate> {
    let mut candidates = chunks
        .iter()
        .filter_map(|chunk| {
            let similarity = cosine_similarity(query_embedding, &chunk.vector);
            if !similarity.is_finite() || similarity < CONTEXT_MIN_SEMANTIC_SIMILARITY {
                return None;
            }
            Some(ContextChunkCandidate {
                chunk: chunk.clone(),
                rank_score: similarity,
            })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .rank_score
            .partial_cmp(&left.rank_score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.chunk.chunk_index.cmp(&right.chunk.chunk_index))
    });
    candidates
}

fn fuse_session_results(
    lexical: Vec<SearchResultRow>,
    semantic: Vec<SessionResultCandidate>,
    limit: usize,
) -> Vec<SearchResultRow> {
    #[derive(Default)]
    struct SessionFusion {
        fused_score: f32,
        evidence: Option<SearchResultRow>,
        evidence_score: f32,
        updated_at: String,
        semantic_hit: bool,
    }

    let mut by_session = HashMap::<String, SessionFusion>::new();

    for (rank, row) in lexical.into_iter().enumerate() {
        let entry = by_session
            .entry(row.session_id.clone())
            .or_insert_with(SessionFusion::default);
        let score = reciprocal_rank_score(rank, SEARCH_LEXICAL_WEIGHT);
        entry.fused_score += score;
        if score >= entry.evidence_score {
            entry.evidence_score = score;
            entry.updated_at = row.updated_at.clone();
            entry.evidence = Some(row);
        }
    }

    for (rank, candidate) in semantic.into_iter().enumerate() {
        let entry = by_session
            .entry(candidate.row.session_id.clone())
            .or_insert_with(SessionFusion::default);
        entry.fused_score += reciprocal_rank_score(rank, SEARCH_SEMANTIC_WEIGHT);
        entry.semantic_hit |= candidate.semantic_hit;
        if candidate.rank_score >= entry.evidence_score {
            entry.evidence_score = candidate.rank_score;
            entry.updated_at = candidate.row.updated_at.clone();
            entry.evidence = Some(candidate.row);
        }
    }

    let mut rows = by_session
        .into_values()
        .filter_map(|entry| {
            let mut row = entry.evidence?;
            row.retrieval_mode = if entry.semantic_hit {
                "hybrid".to_string()
            } else {
                "lexical".to_string()
            };
            Some((entry.fused_score, entry.updated_at, row))
        })
        .collect::<Vec<_>>();

    rows.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(Ordering::Equal)
            .then_with(|| right.1.cmp(&left.1))
    });

    rows.into_iter().take(limit).map(|(_, _, row)| row).collect()
}

fn fuse_context_candidates(
    lexical: Vec<ContextChunkCandidate>,
    semantic: Vec<ContextChunkCandidate>,
    limit: usize,
    ready_chunks: Vec<ReadyChunk>,
) -> Vec<ContextChunkCandidate> {
    #[derive(Default)]
    struct ChunkFusion {
        fused_score: f32,
        evidence: Option<ContextChunkCandidate>,
    }

    let mut by_chunk = HashMap::<(Option<i64>, Option<i64>), ChunkFusion>::new();

    for (rank, candidate) in lexical.into_iter().enumerate() {
        let key = (candidate.chunk.sequence_start, candidate.chunk.sequence_end);
        let entry = by_chunk.entry(key).or_insert_with(ChunkFusion::default);
        entry.fused_score += reciprocal_rank_score(rank, SEARCH_LEXICAL_WEIGHT);
        if entry
            .evidence
            .as_ref()
            .map(|current| candidate.rank_score > current.rank_score)
            .unwrap_or(true)
        {
            entry.evidence = Some(candidate);
        }
    }

    for (rank, candidate) in semantic.into_iter().enumerate() {
        let key = (candidate.chunk.sequence_start, candidate.chunk.sequence_end);
        let entry = by_chunk.entry(key).or_insert_with(ChunkFusion::default);
        entry.fused_score += reciprocal_rank_score(rank, SEARCH_SEMANTIC_WEIGHT);
        if entry
            .evidence
            .as_ref()
            .map(|current| candidate.rank_score > current.rank_score)
            .unwrap_or(true)
        {
            entry.evidence = Some(candidate);
        }
    }

    let mut fused = by_chunk
        .into_values()
        .filter_map(|entry| entry.evidence.map(|candidate| (entry.fused_score, candidate)))
        .collect::<Vec<_>>();
    fused.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(Ordering::Equal)
            .then_with(|| {
                right
                    .1
                    .chunk
                    .sequence_end
                    .unwrap_or_default()
                    .cmp(&left.1.chunk.sequence_end.unwrap_or_default())
            })
    });

    let mut selected = fused
        .into_iter()
        .take(limit)
        .map(|(_, candidate)| candidate)
        .collect::<Vec<_>>();
    let selected_keys = selected
        .iter()
        .map(|candidate| (candidate.chunk.sequence_start, candidate.chunk.sequence_end))
        .collect::<HashSet<_>>();

    for chunk in ready_chunks.into_iter().rev().take(2).rev() {
        let key = (chunk.sequence_start, chunk.sequence_end);
        if selected.len() >= limit || selected_keys.contains(&key) {
            continue;
        }
        selected.push(ContextChunkCandidate {
            chunk,
            rank_score: 0.0,
        });
    }

    selected
}

fn reciprocal_rank_score(rank: usize, weight: f32) -> f32 {
    weight / (SEARCH_FUSION_K + rank as f32 + 1.0)
}

fn semantic_match_metadata(source_kind: &str) -> (&'static str, &'static str) {
    match source_kind {
        "rolling_summary" => ("rolling_summary", "Semantic rolling summary match"),
        "final_summary" => ("final_summary", "Semantic final summary match"),
        "decisions_md" => ("decisions", "Semantic decisions match"),
        "action_items_md" => ("action_items", "Semantic action items match"),
        "notes_md" => ("notes", "Semantic notes match"),
        _ => ("transcript", "Semantic transcript match"),
    }
}

fn compact_snippet(input: &str, max_chars: usize) -> String {
    let normalized = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.len() <= max_chars {
        normalized
    } else {
        format!("{}...", &normalized[..max_chars.saturating_sub(3)])
    }
}

#[cfg(test)]
mod tests {
    use crate::db::AppDatabase;

    use super::{
        build_index_chunks, compact_snippet, QueryEmbeddingCache, SEARCH_CHUNK_MAX_CHARS,
        SEARCH_CHUNK_OVERLAP_SEGMENTS,
    };

    #[test]
    fn query_embedding_cache_keeps_recent_values_only() {
        let mut cache = QueryEmbeddingCache::default();
        for index in 0..70 {
            cache.insert(format!("q{index}"), vec![index as f32]);
        }

        assert!(cache.get("q0").is_none());
        assert_eq!(cache.get("q69"), Some(vec![69.0]));
    }

    #[test]
    fn builds_overlapping_transcript_chunks_from_final_segments() {
        let database = AppDatabase::open_in_memory().expect("database should initialize");
        let session = database
            .create_session("Search session", "active", "manual", None, None)
            .expect("session should create");
        for index in 0..5 {
            database
                .append_transcript_segment_with_metadata(
                    &session.id,
                    Some("speaker"),
                    Some("Speaker"),
                    None,
                    &"x".repeat(SEARCH_CHUNK_MAX_CHARS / 3),
                    true,
                    "manual",
                    None,
                    None,
                    Some(&format!("chunk-{index}")),
                )
                .expect("segment should append");
        }

        let transcripts = database
            .list_transcript_segments(&session.id)
            .expect("transcripts should load");
        let chunks = build_index_chunks(&session, &transcripts);
        let transcript_chunks = chunks
            .into_iter()
            .filter(|chunk| chunk.source_kind == "transcript")
            .collect::<Vec<_>>();

        assert!(transcript_chunks.len() >= 2);
        assert_eq!(transcript_chunks[0].sequence_start, Some(1));
        let first_end = transcript_chunks[0]
            .sequence_end
            .expect("first chunk should have an end sequence");
        let second_start = transcript_chunks[1]
            .sequence_start
            .expect("second chunk should have a start sequence");
        let overlap = first_end - second_start + 1;
        assert!(overlap >= 1);
        assert!(overlap <= SEARCH_CHUNK_OVERLAP_SEGMENTS as i64);
    }

    #[test]
    fn uses_stable_chunk_ids_for_unchanged_text() {
        let first = super::indexed_chunk(
            "session-1",
            "transcript",
            0,
            Some(1),
            Some(2),
            "Speaker: rollout owner is Maya".to_string(),
        );
        let second = super::indexed_chunk(
            "session-1",
            "transcript",
            0,
            Some(1),
            Some(2),
            "Speaker: rollout owner is Maya".to_string(),
        );

        assert_eq!(first.id, second.id);
        assert_eq!(first.text_hash, second.text_hash);
    }

    #[test]
    fn compact_snippet_normalizes_whitespace() {
        assert_eq!(compact_snippet("alpha   beta\n gamma", 40), "alpha beta gamma");
    }
}
