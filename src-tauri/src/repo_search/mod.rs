use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{Duration as ChronoDuration, Utc};
use flate2::read::GzDecoder;
use regex::Regex;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tar::Archive;
use tokio::sync::{Mutex, Notify};

use crate::db::AppDatabase;
use crate::github::{self, BranchHead, CodeSearchHit, RepoTreeEntry};
use crate::providers::llm::{
    check_for_tool_call, generate_embedding, generate_embeddings_batched, EmbeddingTaskType,
    LlmGenerationOptions,
};
use crate::secrets::AppSecretStore;

const REPO_QUERY_CACHE_CAPACITY: usize = 64;
const REPO_BRANCH_HEAD_CACHE_CAPACITY: usize = 16;
const REPO_BRANCH_HEAD_CACHE_TTL: Duration = Duration::from_secs(20);
const REPO_CODE_SEARCH_CACHE_CAPACITY: usize = 96;
const REPO_CODE_SEARCH_CACHE_TTL: Duration = Duration::from_secs(90);
const REPO_FILE_CACHE_CAPACITY: usize = 96;
const REPO_FILE_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const REPO_JOB_POLL_INTERVAL: Duration = Duration::from_millis(900);
const REPO_JOB_MAX_ATTEMPTS: u32 = 5;
const REPO_JOB_BASE_BACKOFF_SECS: i64 = 45;
const REPO_FTS_CANDIDATE_LIMIT: usize = 60;
const REPO_RERANK_LIMIT: usize = 20;
const REPO_FINAL_EVIDENCE_LIMIT: usize = 4;
const REPO_LIVE_PATH_LIMIT: usize = 12;
const REPO_LIVE_FILE_LIMIT: usize = 8;
const REPO_MAX_FILE_BYTES: u64 = 512 * 1024;
const REPO_MIN_LOCAL_SCORE: f32 = 0.62;
const REPO_MIN_LIVE_SCORE: f32 = 0.42;
const REPO_MIN_SEMANTIC_SIMILARITY: f32 = 0.46;
const REPO_MIN_LEXICAL_SCORE: f32 = 0.14;
const REPO_MIN_MATCH_COVERAGE: f32 = 0.34;
const REPO_WINDOW_MAX_LINES: usize = 60;
const REPO_WINDOW_OVERLAP_LINES: usize = 15;
const REPO_SYNC_EMBEDDING_CONCURRENCY: usize = 4;

#[derive(Clone)]
pub struct RepoSearchRuntime {
    inner: Arc<RepoSearchRuntimeInner>,
}

struct RepoSearchRuntimeInner {
    database: Arc<AppDatabase>,
    secret_store: Arc<dyn AppSecretStore>,
    query_cache: Mutex<QueryEmbeddingCache>,
    branch_head_cache: Mutex<TimedLruCache<BranchHead>>,
    code_search_cache: Mutex<TimedLruCache<Vec<CodeSearchHit>>>,
    file_cache: Mutex<TimedLruCache<Vec<u8>>>,
    notify: Notify,
    started: AtomicBool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RepoSyncStatus {
    pub owner_repo: Option<String>,
    pub branch: String,
    pub live_search_enabled: bool,
    pub status: String,
    pub last_synced_commit: Option<String>,
    pub last_synced_at: Option<String>,
    pub current_commit: Option<String>,
    pub changed_file_count: usize,
    pub indexed_file_count: usize,
    pub indexed_chunk_count: usize,
    pub last_error: Option<String>,
    pub sync_source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RepoContext {
    pub owner_repo: String,
    pub owner: String,
    pub repo_name: String,
    pub branch: String,
    pub snapshot_commit: Option<String>,
    pub snapshot_synced_at: Option<String>,
    pub live_search_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RepoSearchStatus {
    pub attempted: bool,
    pub used: bool,
    pub mode: Option<String>,
    pub reason: Option<String>,
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub snapshot_commit: Option<String>,
    pub resolved_commit: Option<String>,
    pub latency_ms: Option<u64>,
    pub result_count: usize,
    pub freshness: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct RepoCitation {
    pub label: String,
    pub repo: String,
    pub branch: String,
    pub commit: String,
    pub path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub symbol_name: Option<String>,
    pub source: String,
    pub score: f32,
    pub snippet: String,
    pub url: String,
}

#[derive(Debug, Clone, Default)]
pub struct RepoSearchOutcome {
    pub prompt_context: Option<String>,
    pub repo_search: RepoSearchStatus,
    pub repo_citations: Vec<RepoCitation>,
}

#[derive(Debug, Clone)]
pub struct RepoSearchRequest {
    pub repo_context: Option<RepoContext>,
    pub question: String,
    pub transcript_context: String,
    pub recent_messages: String,
    pub rolling_summary: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RepoSnapshot {
    pub commit: String,
    pub synced_at: String,
}

#[derive(Default)]
struct QueryEmbeddingCache {
    order: VecDeque<String>,
    values: HashMap<String, Vec<f32>>,
}

#[derive(Debug, Clone)]
struct TimedCacheEntry<T> {
    value: T,
    inserted_at: Instant,
}

struct TimedLruCache<T> {
    order: VecDeque<String>,
    values: HashMap<String, TimedCacheEntry<T>>,
    capacity: usize,
    ttl: Duration,
}

#[derive(Debug, Clone)]
struct RepoSyncJob {
    owner_repo: String,
    branch: String,
    attempts: u32,
}

#[derive(Debug, Clone)]
struct RepoRunSeed {
    id: String,
}

#[derive(Debug, Clone)]
struct RepoFileSeed {
    id: String,
    owner_repo: String,
    branch: String,
    indexed_commit: String,
    path: String,
    blob_sha: String,
    language: String,
    size_bytes: u64,
}

#[derive(Debug, Clone)]
struct RepoChunkSeed {
    id: String,
    file_id: String,
    owner_repo: String,
    branch: String,
    indexed_commit: String,
    path: String,
    chunk_kind: String,
    symbol_name: Option<String>,
    chunk_index: i64,
    start_line: usize,
    end_line: usize,
    text: String,
    text_hash: String,
    token_estimate: i64,
}

#[derive(Debug, Clone)]
struct RepoChunkVersion {
    symbol_name: Option<String>,
    chunk_kind: String,
    start_line: usize,
    end_line: usize,
    text: String,
    text_hash: String,
    token_estimate: i64,
    vector: Option<Vec<f32>>,
}

#[derive(Debug, Clone)]
struct LocalCandidate {
    path: String,
    symbol_name: Option<String>,
    start_line: usize,
    end_line: usize,
    text: String,
    lexical_score: f32,
    vector: Option<Vec<f32>>,
}

#[derive(Debug, Clone)]
struct ScoredCandidate {
    citation: RepoCitation,
    score: f32,
}

#[derive(Debug, Clone, Copy, Default)]
struct QueryMatchSignals {
    matched_terms: usize,
    coverage: f32,
    path_coverage: f32,
    symbol_coverage: f32,
    exact_phrase: bool,
}

#[derive(Debug, Clone)]
struct PlannedRepoQueries {
    queries: Vec<String>,
    needs_live: bool,
    reason: String,
}

#[derive(Debug, Clone, Deserialize)]
struct PlannerToolArgs {
    queries: Vec<String>,
    #[serde(default)]
    needs_live: bool,
    #[serde(default)]
    reason: Option<String>,
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

        while self.order.len() > REPO_QUERY_CACHE_CAPACITY {
            if let Some(oldest) = self.order.pop_front() {
                self.values.remove(&oldest);
            }
        }
    }
}

impl<T> TimedLruCache<T> {
    fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            order: VecDeque::new(),
            values: HashMap::new(),
            capacity,
            ttl,
        }
    }

    fn retain_fresh(&mut self) {
        let ttl = self.ttl;
        self.values
            .retain(|_, entry| entry.inserted_at.elapsed() <= ttl);
        self.order
            .retain(|key| self.values.contains_key(key));
    }

    fn insert(&mut self, key: String, value: T) {
        self.retain_fresh();
        if self.values.contains_key(&key) {
            self.order.retain(|existing| existing != &key);
        }
        self.order.push_back(key.clone());
        self.values.insert(
            key,
            TimedCacheEntry {
                value,
                inserted_at: Instant::now(),
            },
        );

        while self.order.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.values.remove(&oldest);
            }
        }
    }
}

impl<T: Clone> TimedLruCache<T> {
    fn get(&mut self, key: &str) -> Option<T> {
        self.retain_fresh();
        let entry = self.values.get(key)?.clone();
        self.order.retain(|existing| existing != key);
        self.order.push_back(key.to_string());
        Some(entry.value)
    }
}

impl RepoSearchRuntime {
    pub fn new(database: Arc<AppDatabase>, secret_store: Arc<dyn AppSecretStore>) -> Self {
        Self {
            inner: Arc::new(RepoSearchRuntimeInner {
                database,
                secret_store,
                query_cache: Mutex::new(QueryEmbeddingCache::default()),
                branch_head_cache: Mutex::new(TimedLruCache::new(
                    REPO_BRANCH_HEAD_CACHE_CAPACITY,
                    REPO_BRANCH_HEAD_CACHE_TTL,
                )),
                code_search_cache: Mutex::new(TimedLruCache::new(
                    REPO_CODE_SEARCH_CACHE_CAPACITY,
                    REPO_CODE_SEARCH_CACHE_TTL,
                )),
                file_cache: Mutex::new(TimedLruCache::new(
                    REPO_FILE_CACHE_CAPACITY,
                    REPO_FILE_CACHE_TTL,
                )),
                notify: Notify::new(),
                started: AtomicBool::new(false),
            }),
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
            loop {
                match runtime.process_next_job().await {
                    Ok(true) => continue,
                    Ok(false) => {}
                    Err(_) => {}
                }

                tokio::select! {
                    _ = runtime.inner.notify.notified() => {}
                    _ = tokio::time::sleep(REPO_JOB_POLL_INTERVAL) => {}
                }
            }
        });
    }

    pub fn enqueue_sync(&self, owner_repo: &str, branch: &str) -> Result<RepoSyncStatus, String> {
        let trimmed_repo = owner_repo.trim();
        let trimmed_branch = branch.trim();
        if trimmed_repo.is_empty() || !trimmed_repo.contains('/') {
            return Err("GitHub repo must be formatted as owner/repo.".to_string());
        }
        if trimmed_branch.is_empty() {
            return Err("GitHub branch is required.".to_string());
        }

        enqueue_repo_sync(self.inner.database.as_ref(), trimmed_repo, trimmed_branch)?;
        self.inner.notify.notify_one();
        configured_repo_status(self.inner.database.as_ref())
    }

    pub fn configured_status(&self) -> Result<RepoSyncStatus, String> {
        configured_repo_status(self.inner.database.as_ref())
    }

    pub fn latest_snapshot(
        &self,
        owner_repo: &str,
        branch: &str,
    ) -> Result<Option<RepoSnapshot>, String> {
        latest_repo_snapshot(self.inner.database.as_ref(), owner_repo, branch)
    }

    pub async fn search_context(
        &self,
        request: RepoSearchRequest,
    ) -> Result<RepoSearchOutcome, String> {
        let Some(repo_context) = request.repo_context else {
            return Ok(RepoSearchOutcome {
                repo_search: RepoSearchStatus {
                    attempted: false,
                    used: false,
                    reason: Some("No repo is pinned to this session.".to_string()),
                    ..RepoSearchStatus::default()
                },
                ..RepoSearchOutcome::default()
            });
        };

        let started_at = Instant::now();
        let mut repo_search = RepoSearchStatus {
            attempted: true,
            used: false,
            repo: Some(repo_context.owner_repo.clone()),
            branch: Some(repo_context.branch.clone()),
            snapshot_commit: repo_context.snapshot_commit.clone(),
            freshness: Some(if repo_context.snapshot_commit.is_some() {
                "snapshot".to_string()
            } else {
                "unsynced".to_string()
            }),
            ..RepoSearchStatus::default()
        };

        let planned = plan_repo_queries(
            self.inner.secret_store.as_ref(),
            &request.question,
            &request.transcript_context,
            &request.recent_messages,
            request.rolling_summary.as_deref(),
        )
        .await?;

        let query_embeddings =
            self.cached_query_embeddings(&planned.queries).await.unwrap_or_default();
        let local_citations = if let Some(snapshot_commit) = repo_context.snapshot_commit.as_deref()
        {
            search_local_snapshot(
                self.inner.database.as_ref(),
                &repo_context.owner_repo,
                &repo_context.branch,
                snapshot_commit,
                &planned.queries,
                &query_embeddings,
            )?
        } else {
            Vec::new()
        };

        let local_best = local_citations.first().map(|candidate| candidate.score).unwrap_or_default();
        let mut resolved_commit = repo_context.snapshot_commit.clone();
        let mut citations = local_citations;
        let live_allowed = repo_context.live_search_enabled;
        let need_live = live_allowed && (planned.needs_live || local_best < REPO_MIN_LOCAL_SCORE);

        if need_live {
            if let Some(github_pat) = load_secret(self.inner.secret_store.as_ref(), "github_pat")? {
                match self.cached_branch_head(
                    &repo_context.owner_repo,
                    &repo_context.branch,
                    &github_pat,
                )
                .await
                {
                    Ok(head) => {
                        let snapshot_stale = repo_context
                            .snapshot_commit
                            .as_deref()
                            .map(|snapshot| snapshot != head.commit_sha)
                            .unwrap_or(true);
                        if planned.needs_live || snapshot_stale || local_best < REPO_MIN_LOCAL_SCORE {
                            let live_citations = search_live_branch(
                                self,
                                &repo_context,
                                &head,
                                &planned.queries,
                                &query_embeddings,
                                &github_pat,
                            )
                            .await?;
                            resolved_commit = Some(head.commit_sha.clone());
                            if !live_citations.is_empty() {
                                citations.extend(live_citations);
                            }
                            if snapshot_stale {
                                repo_search.freshness = Some("live_head".to_string());
                            }
                        }
                    }
                    Err(error) => {
                        repo_search.reason = Some(format!("Live repo lookup degraded: {error}"));
                        repo_search.freshness = Some("degraded".to_string());
                    }
                }
            } else {
                repo_search.reason = Some("GitHub PAT is not configured.".to_string());
                repo_search.freshness = Some("disabled".to_string());
            }
        }

        citations = dedupe_and_trim_citations(citations, REPO_FINAL_EVIDENCE_LIMIT);
        repo_search.latency_ms = Some(started_at.elapsed().as_millis() as u64);
        repo_search.resolved_commit = resolved_commit;
        repo_search.result_count = citations.len();

        if citations.is_empty() {
            if repo_search.reason.is_none() {
                repo_search.reason = Some("Repo search found no strong match.".to_string());
            }
            return Ok(RepoSearchOutcome {
                repo_search,
                repo_citations: Vec::new(),
                prompt_context: None,
            });
        }

        repo_search.used = true;
        repo_search.mode = Some(if need_live {
            if repo_context.snapshot_commit.is_some() {
                "hybrid".to_string()
            } else {
                "live".to_string()
            }
        } else {
            "snapshot".to_string()
        });
        if repo_search.reason.is_none() {
            repo_search.reason = Some(planned.reason);
        }
        let prompt_context = format_repo_prompt_context(&repo_search, &citations);

        Ok(RepoSearchOutcome {
            prompt_context: Some(prompt_context),
            repo_search,
            repo_citations: citations.into_iter().map(|candidate| candidate.citation).collect(),
        })
    }

    async fn process_next_job(&self) -> Result<bool, String> {
        let Some(job) = take_next_repo_job(self.inner.database.as_ref())? else {
            return Ok(false);
        };

        match sync_repo_job(&self.inner, &job.owner_repo, &job.branch).await {
            Ok(()) => complete_repo_job(self.inner.database.as_ref(), &job.owner_repo, &job.branch)?,
            Err(error) => fail_repo_job(
                self.inner.database.as_ref(),
                &job.owner_repo,
                &job.branch,
                job.attempts + 1,
                &error,
            )?,
        }

        Ok(true)
    }

    async fn cached_query_embeddings(
        &self,
        queries: &[String],
    ) -> Result<HashMap<String, Vec<f32>>, String> {
        let mut map = HashMap::new();
        for query in queries {
            if let Some(vector) = self.cached_query_embedding(query).await? {
                map.insert(query.clone(), vector);
            }
        }
        Ok(map)
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

        let Some(api_key) = load_secret(self.inner.secret_store.as_ref(), "gemini_api_key")? else {
            return Ok(None);
        };

        let embedding = generate_embedding(&api_key, query, EmbeddingTaskType::RetrievalQuery)
            .await
            .map_err(|error| error.to_string())?;

        let mut cache = self.inner.query_cache.lock().await;
        cache.insert(normalized, embedding.clone());
        Ok(Some(embedding))
    }

    async fn cached_branch_head(
        &self,
        owner_repo: &str,
        branch: &str,
        github_pat: &str,
    ) -> Result<BranchHead, String> {
        let cache_key = format!("{owner_repo}:{branch}");
        {
            let mut cache = self.inner.branch_head_cache.lock().await;
            if let Some(head) = cache.get(&cache_key) {
                return Ok(head);
            }
        }

        let head = github::resolve_branch_head(owner_repo, branch, github_pat)
            .await
            .map_err(|error| error.to_string())?;
        let mut cache = self.inner.branch_head_cache.lock().await;
        cache.insert(cache_key, head.clone());
        Ok(head)
    }

    async fn cached_code_search(
        &self,
        owner_repo: &str,
        branch: &str,
        commit: &str,
        query: &str,
        github_pat: &str,
    ) -> Result<Vec<CodeSearchHit>, String> {
        let cache_key = format!("{owner_repo}:{branch}:{commit}:{}", normalize_query_key(query));
        {
            let mut cache = self.inner.code_search_cache.lock().await;
            if let Some(hits) = cache.get(&cache_key) {
                return Ok(hits);
            }
        }

        let hits = github::search_code(owner_repo, branch, query, github_pat)
            .await
            .map_err(|error| error.to_string())?;
        let mut cache = self.inner.code_search_cache.lock().await;
        cache.insert(cache_key, hits.clone());
        Ok(hits)
    }

    async fn cached_file_bytes(
        &self,
        owner_repo: &str,
        path: &str,
        commit: &str,
        github_pat: &str,
    ) -> Result<Vec<u8>, String> {
        let cache_key = format!("{owner_repo}:{commit}:{path}");
        {
            let mut cache = self.inner.file_cache.lock().await;
            if let Some(bytes) = cache.get(&cache_key) {
                return Ok(bytes);
            }
        }

        let bytes = github::fetch_file(owner_repo, path, commit, github_pat)
            .await
            .map_err(|error| error.to_string())?;
        let mut cache = self.inner.file_cache.lock().await;
        cache.insert(cache_key, bytes.clone());
        Ok(bytes)
    }
}

async fn plan_repo_queries(
    secret_store: &dyn AppSecretStore,
    question: &str,
    transcript_context: &str,
    recent_messages: &str,
    rolling_summary: Option<&str>,
) -> Result<PlannedRepoQueries, String> {
    let fallback = fallback_repo_query_plan(
        question,
        transcript_context,
        recent_messages,
        rolling_summary,
    );
    let Some(api_key) = load_secret(secret_store, "gemini_api_key")? else {
        return Ok(fallback);
    };

    let tools = serde_json::json!({
        "functionDeclarations": [{
            "name": "plan_repo_search",
            "description": "Plans up to 4 repo search queries and whether live GitHub lookup is needed for freshness.",
            "parameters": {
                "type": "OBJECT",
                "properties": {
                    "queries": {
                        "type": "ARRAY",
                        "items": { "type": "STRING" },
                        "description": "Up to four short search queries."
                    },
                    "needs_live": {
                        "type": "BOOLEAN",
                        "description": "Whether branch-head freshness is important for this question."
                    },
                    "reason": { "type": "STRING" }
                },
                "required": ["queries", "needs_live", "reason"]
            }
        }]
    });

    let prompt = format!(
        "Question:\n{question}\n\nRolling summary:\n{}\n\nRecent Ask TPMCluely conversation:\n{recent_messages}\n\nTranscript context:\n{transcript_context}\n\nIf codebase context could materially improve the answer, call the tool. Prefer short implementation-focused queries.",
        rolling_summary.unwrap_or("No rolling summary available.")
    );
    let options = LlmGenerationOptions {
        response_mime_type: None,
        max_output_tokens: Some(180),
        tools: Some(tools),
    };

    match check_for_tool_call(
        &api_key,
        "You plan repo search. Only call the tool when code search could materially improve the meeting answer.",
        &prompt,
        &options,
    )
    .await
    {
        Ok(Some((name, args))) if name == "plan_repo_search" => {
            let parsed: PlannerToolArgs = serde_json::from_value(args).unwrap_or(PlannerToolArgs {
                queries: fallback.queries.clone(),
                needs_live: fallback.needs_live,
                reason: Some(fallback.reason.clone()),
            });
            let queries = dedupe_queries(parsed.queries);
            if queries.is_empty() {
                Ok(fallback)
            } else {
                Ok(PlannedRepoQueries {
                    queries,
                    needs_live: parsed.needs_live,
                    reason: parsed
                        .reason
                        .unwrap_or_else(|| "LLM planner requested repo search.".to_string()),
                })
            }
        }
        _ => Ok(fallback),
    }
}

fn fallback_repo_query_plan(
    question: &str,
    transcript_context: &str,
    recent_messages: &str,
    rolling_summary: Option<&str>,
) -> PlannedRepoQueries {
    let mut queries = Vec::new();
    queries.push(question.trim().to_string());

    if let Some(summary) = rolling_summary {
        let summary_terms = build_query_terms(summary)
            .into_iter()
            .take(4)
            .collect::<Vec<_>>()
            .join(" ");
        if !summary_terms.is_empty() {
            queries.push(format!("{question} {summary_terms}"));
        }
    }

    let transcript_terms = build_query_terms(transcript_context)
        .into_iter()
        .take(6)
        .collect::<Vec<_>>()
        .join(" ");
    if !transcript_terms.is_empty() {
        queries.push(format!("{question} {transcript_terms}"));
    }

    let recent_message_terms = build_query_terms(recent_messages)
        .into_iter()
        .take(5)
        .collect::<Vec<_>>()
        .join(" ");
    if !recent_message_terms.is_empty() {
        queries.push(format!("{question} {recent_message_terms}"));
    }

    let lowered = question.to_lowercase();
    let needs_live = lowered.contains("current")
        || lowered.contains("latest")
        || lowered.contains("today")
        || lowered.contains("head")
        || lowered.contains("branch")
        || lowered.contains("recent");

    PlannedRepoQueries {
        queries: dedupe_queries(queries),
        needs_live,
        reason: "Deterministic fallback planned repo search.".to_string(),
    }
}

async fn sync_repo_job(
    inner: &RepoSearchRuntimeInner,
    owner_repo: &str,
    branch: &str,
) -> Result<(), String> {
    let github_pat = load_secret(inner.secret_store.as_ref(), "github_pat")?
        .ok_or_else(|| "GitHub PAT is not configured.".to_string())?;
    let gemini_key = load_secret(inner.secret_store.as_ref(), "gemini_api_key")?
        .ok_or_else(|| "Gemini API key is not configured.".to_string())?;

    let head = github::resolve_branch_head(owner_repo, branch, &github_pat)
        .await
        .map_err(|error| error.to_string())?;
    let previous_commit = latest_repo_snapshot(inner.database.as_ref(), owner_repo, branch)?
        .map(|snapshot| snapshot.commit);
    let run = start_repo_run(
        inner.database.as_ref(),
        owner_repo,
        branch,
        &head.commit_sha,
        previous_commit.as_deref(),
        "tree",
    )?;

    match github::list_tree_recursive(owner_repo, &head.tree_sha, &github_pat).await {
        Ok(tree) if !tree.truncated => {
            let changed_count = sync_tree_snapshot(
                inner.database.as_ref(),
                owner_repo,
                branch,
                &head.commit_sha,
                &tree.entries,
                &gemini_key,
                &github_pat,
            )
            .await?;
            let (file_count, chunk_count) = repo_counts(
                inner.database.as_ref(),
                owner_repo,
                branch,
                &head.commit_sha,
            )?;
            complete_repo_run(
                inner.database.as_ref(),
                &run.id,
                changed_count,
                file_count,
                chunk_count,
                "tree",
            )?;
            Ok(())
        }
        Ok(_) | Err(_) => {
            let changed_count = sync_tarball_snapshot(
                inner.database.as_ref(),
                owner_repo,
                branch,
                &head.commit_sha,
                &gemini_key,
                &github_pat,
            )
            .await?;
            let (file_count, chunk_count) = repo_counts(
                inner.database.as_ref(),
                owner_repo,
                branch,
                &head.commit_sha,
            )?;
            complete_repo_run(
                inner.database.as_ref(),
                &run.id,
                changed_count,
                file_count,
                chunk_count,
                "tarball",
            )?;
            Ok(())
        }
    }
}

async fn sync_tree_snapshot(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
    indexed_commit: &str,
    entries: &[RepoTreeEntry],
    gemini_key: &str,
    github_pat: &str,
) -> Result<usize, String> {
    let eligible_entries = entries
        .iter()
        .filter(|entry| entry.kind == "blob")
        .filter(|entry| is_indexable_path(&entry.path, entry.size))
        .cloned()
        .collect::<Vec<_>>();
    let previous_commit = latest_repo_snapshot(database, owner_repo, branch)?
        .map(|snapshot| snapshot.commit);
    let previous_files = previous_commit
        .as_deref()
        .map(|commit| load_file_versions(database, owner_repo, branch, commit))
        .transpose()?
        .unwrap_or_default();

    let mut changed_files = 0usize;
    for entry in eligible_entries {
        let prior = previous_files.get(&entry.path);
        if let Some(previous) = prior {
            if previous.blob_sha == entry.sha {
                clone_file_version(database, previous, indexed_commit)?;
                continue;
            }
        }

        let bytes = github::fetch_blob(owner_repo, &entry.sha, github_pat)
            .await
            .map_err(|error| error.to_string())?;
        if let Some(text) = decode_indexable_text(&bytes) {
            let file_seed = build_repo_file_seed(
                owner_repo,
                branch,
                indexed_commit,
                &entry.path,
                &entry.sha,
                entry.size.unwrap_or_default(),
            );
            let chunks = build_repo_chunks(&file_seed, &text);
            save_repo_file_version(database, &file_seed, &chunks, gemini_key).await?;
            changed_files += 1;
        }
    }

    Ok(changed_files)
}

async fn sync_tarball_snapshot(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
    indexed_commit: &str,
    gemini_key: &str,
    github_pat: &str,
) -> Result<usize, String> {
    let tarball = github::download_tarball(owner_repo, branch, github_pat)
        .await
        .map_err(|error| error.to_string())?;
    let tar = GzDecoder::new(tarball.as_slice());
    let mut archive = Archive::new(tar);
    let mut pending_files = Vec::new();

    for entry in archive.entries().map_err(|error| error.to_string())? {
        let mut entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = match entry.path() {
            Ok(path) => path.to_string_lossy().to_string(),
            Err(_) => continue,
        };
        let normalized_path = strip_tarball_prefix(&path);
        if !is_indexable_path(&normalized_path, Some(entry.size())) {
            continue;
        }
        let mut contents = Vec::new();
        if entry.read_to_end(&mut contents).is_err() {
            continue;
        }
        let Some(text) = decode_indexable_text(&contents) else {
            continue;
        };
        let blob_sha = hash_text(&text);
        let file_seed = build_repo_file_seed(
            owner_repo,
            branch,
            indexed_commit,
            &normalized_path,
            &blob_sha,
            contents.len() as u64,
        );
        let chunks = build_repo_chunks(&file_seed, &text);
        pending_files.push((file_seed, chunks));
    }

    let mut changed_files = 0usize;
    for (file_seed, chunks) in pending_files {
        save_repo_file_version(database, &file_seed, &chunks, gemini_key).await?;
        changed_files += 1;
    }

    Ok(changed_files)
}

async fn save_repo_file_version(
    database: &AppDatabase,
    file_seed: &RepoFileSeed,
    chunks: &[RepoChunkSeed],
    gemini_key: &str,
) -> Result<(), String> {
    upsert_repo_file(database, file_seed)?;
    replace_repo_chunks(database, file_seed, chunks)?;
    if !chunks.is_empty() {
        let texts = chunks
            .iter()
            .map(|chunk| chunk.text.clone())
            .collect::<Vec<_>>();
        let embeddings = generate_embeddings_batched(
            gemini_key,
            &texts,
            EmbeddingTaskType::RetrievalDocument,
            REPO_SYNC_EMBEDDING_CONCURRENCY,
        )
        .await
        .map_err(|error| error.to_string())?;
        for (chunk, embedding) in chunks.iter().zip(embeddings.into_iter()) {
            save_ready_embedding(database, &chunk.id, &embedding)?;
        }
    }
    mark_repo_file_ready(database, &file_seed.id)?;
    Ok(())
}

async fn search_live_branch(
    runtime: &RepoSearchRuntime,
    repo_context: &RepoContext,
    head: &BranchHead,
    queries: &[String],
    query_embeddings: &HashMap<String, Vec<f32>>,
    github_pat: &str,
) -> Result<Vec<ScoredCandidate>, String> {
    let mut candidate_paths = Vec::new();
    for query in queries {
        match runtime.cached_code_search(
            &repo_context.owner_repo,
            &repo_context.branch,
            &head.commit_sha,
            query,
            github_pat,
        )
        .await
        {
            Ok(hits) => {
                for hit in hits {
                    candidate_paths.push(hit);
                }
            }
            Err(_) => {}
        }
    }
    if candidate_paths.is_empty() {
        let live_tree = github::list_tree_recursive(
            &repo_context.owner_repo,
            &head.tree_sha,
            github_pat,
        )
        .await
        .map_err(|error| error.to_string())?;
        candidate_paths = live_tree
            .entries
            .into_iter()
            .filter(|entry| entry.kind == "blob")
            .filter(|entry| is_indexable_path(&entry.path, entry.size))
            .filter(|entry| {
                let lowered_path = entry.path.to_lowercase();
                queries.iter().any(|query| {
                    build_query_terms(query)
                        .into_iter()
                        .any(|term| lowered_path.contains(&term))
                })
            })
            .map(|entry| CodeSearchHit {
                path: entry.path,
                sha: entry.sha,
            })
            .collect();
    }

    let unique_hits = dedupe_live_hits(candidate_paths, REPO_LIVE_PATH_LIMIT);
    let mut scored = Vec::new();

    for hit in unique_hits.into_iter().take(REPO_LIVE_FILE_LIMIT) {
        let bytes = runtime.cached_file_bytes(
            &repo_context.owner_repo,
            &hit.path,
            &head.commit_sha,
            github_pat,
        )
        .await
        .map_err(|error| error.to_string())?;
        let Some(text) = decode_indexable_text(&bytes) else {
            continue;
        };
        let temp_file = build_repo_file_seed(
            &repo_context.owner_repo,
            &repo_context.branch,
            &head.commit_sha,
            &hit.path,
            &hit.sha,
            bytes.len() as u64,
        );
        let chunks = build_repo_chunks(&temp_file, &text);
        scored.extend(score_ephemeral_chunks(
            &repo_context.owner_repo,
            &repo_context.branch,
            &head.commit_sha,
            queries,
            query_embeddings,
            &chunks,
            "live",
        )?);
    }

    Ok(scored)
}

fn search_local_snapshot(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
    indexed_commit: &str,
    queries: &[String],
    query_embeddings: &HashMap<String, Vec<f32>>,
) -> Result<Vec<ScoredCandidate>, String> {
    let mut by_chunk = HashMap::<String, ScoredCandidate>::new();
    for query in queries {
        let lexical = load_local_candidates(
            database,
            owner_repo,
            branch,
            indexed_commit,
            query,
            REPO_FTS_CANDIDATE_LIMIT,
        )?;
        let reranked = rerank_local_candidates(
            owner_repo,
            branch,
            indexed_commit,
            query,
            query_embeddings.get(query),
            lexical,
            "snapshot",
        );
        for candidate in reranked {
            by_chunk
                .entry(candidate.citation.label.clone())
                .and_modify(|existing| {
                    if candidate.score > existing.score {
                        *existing = candidate.clone();
                    }
                })
                .or_insert(candidate);
        }
    }

    let mut citations = by_chunk.into_values().collect::<Vec<_>>();
    citations.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.citation.path.cmp(&right.citation.path))
    });
    Ok(citations)
}

fn rerank_local_candidates(
    owner_repo: &str,
    branch: &str,
    indexed_commit: &str,
    query: &str,
    query_embedding: Option<&Vec<f32>>,
    lexical: Vec<LocalCandidate>,
    source: &str,
) -> Vec<ScoredCandidate> {
    let prompt_terms = build_query_terms(query);
    let query_phrase = normalize_query_key(query);
    let mut scored = lexical
        .into_iter()
        .take(REPO_RERANK_LIMIT)
        .filter_map(|candidate| {
            let semantic = query_embedding
                .and_then(|vector| candidate.vector.as_ref().map(|candidate_vec| cosine_similarity(vector, candidate_vec)))
                .unwrap_or(0.0);
            let signals = query_match_signals(
                &query_phrase,
                &prompt_terms,
                &candidate.path,
                candidate.symbol_name.as_deref(),
                &candidate.text,
            );
            let exact_phrase_bonus = if signals.exact_phrase { 0.18 } else { 0.0 };
            let score = (candidate.lexical_score * 0.52)
                + (semantic.max(0.0) * 0.86)
                + (signals.coverage * 0.34)
                + (signals.path_coverage * 0.18)
                + (signals.symbol_coverage * 0.14)
                + exact_phrase_bonus;
            let strong_match = semantic >= REPO_MIN_SEMANTIC_SIMILARITY
                || is_strong_lexical_match(candidate.lexical_score, &signals, prompt_terms.len());
            if !strong_match || score < REPO_MIN_LOCAL_SCORE {
                return None;
            }

            let path = candidate.path.clone();
            Some(ScoredCandidate {
                citation: RepoCitation {
                    label: String::new(),
                    repo: owner_repo.to_string(),
                    branch: branch.to_string(),
                    commit: indexed_commit.to_string(),
                    path: path.clone(),
                    start_line: candidate.start_line,
                    end_line: candidate.end_line,
                    symbol_name: candidate.symbol_name,
                    source: source.to_string(),
                    score,
                    snippet: compact_snippet(&candidate.text, 420),
                    url: github_blob_url(owner_repo, indexed_commit, &path, candidate.start_line),
                },
                score,
            })
        })
        .collect::<Vec<_>>();
    scored.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
    });
    scored
}

fn score_ephemeral_chunks(
    owner_repo: &str,
    branch: &str,
    indexed_commit: &str,
    queries: &[String],
    query_embeddings: &HashMap<String, Vec<f32>>,
    chunks: &[RepoChunkSeed],
    source: &str,
) -> Result<Vec<ScoredCandidate>, String> {
    let mut scored = Vec::new();
    for query in queries {
        let prompt_terms = build_query_terms(query);
        let query_phrase = normalize_query_key(query);
        let _query_embedding = query_embeddings.get(query);
        for chunk in chunks {
            let signals = query_match_signals(
                &query_phrase,
                &prompt_terms,
                &chunk.path,
                chunk.symbol_name.as_deref(),
                &chunk.text,
            );
            if !is_strong_lexical_match(REPO_MIN_LEXICAL_SCORE, &signals, prompt_terms.len()) {
                continue;
            }
            let exact_phrase_bonus = if signals.exact_phrase { 0.18 } else { 0.0 };
            let score = (signals.coverage * 0.56)
                + (signals.path_coverage * 0.24)
                + (signals.symbol_coverage * 0.16)
                + exact_phrase_bonus;
            if score < REPO_MIN_LIVE_SCORE {
                continue;
            }
            scored.push(ScoredCandidate {
                citation: RepoCitation {
                    label: String::new(),
                    repo: owner_repo.to_string(),
                    branch: branch.to_string(),
                    commit: indexed_commit.to_string(),
                    path: chunk.path.clone(),
                    start_line: chunk.start_line,
                    end_line: chunk.end_line,
                    symbol_name: chunk.symbol_name.clone(),
                    source: source.to_string(),
                    score,
                    snippet: compact_snippet(&chunk.text, 420),
                    url: github_blob_url(owner_repo, indexed_commit, &chunk.path, chunk.start_line),
                },
                score,
            });
        }
    }
    scored.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
    });
    Ok(scored)
}

fn format_repo_prompt_context(
    status: &RepoSearchStatus,
    citations: &[ScoredCandidate],
) -> String {
    let mode = status.mode.as_deref().unwrap_or("snapshot");
    let freshness = status.freshness.as_deref().unwrap_or("unknown");
    let commit = status
        .resolved_commit
        .as_deref()
        .or(status.snapshot_commit.as_deref())
        .map(short_commit)
        .unwrap_or_else(|| "unknown".to_string());
    let header = format!(
        "Repo evidence status: mode={mode}; freshness={freshness}; commit={commit}. Treat code as implementation evidence, not proof of team intent or architecture rationale."
    );
    let body = citations
        .iter()
        .enumerate()
        .map(|(index, candidate)| {
            let label = format!("[C{}]", index + 1);
            format!(
                "{label} {}@{} {}#L{}-L{}{} [{} score {:.2}]\n{}",
                candidate.citation.repo,
                short_commit(&candidate.citation.commit),
                candidate.citation.path,
                candidate.citation.start_line,
                candidate.citation.end_line,
                candidate
                    .citation
                    .symbol_name
                    .as_deref()
                    .map(|symbol| format!(" ({symbol})"))
                    .unwrap_or_default(),
                candidate.citation.source,
                candidate.score,
                candidate.citation.snippet
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    format!("{header}\n\n{body}")
}

fn dedupe_and_trim_citations(
    citations: Vec<ScoredCandidate>,
    limit: usize,
) -> Vec<ScoredCandidate> {
    let mut by_key = HashMap::<(String, usize, usize, String), ScoredCandidate>::new();
    for candidate in citations {
        let key = (
            candidate.citation.path.clone(),
            candidate.citation.start_line,
            candidate.citation.end_line,
            candidate.citation.commit.clone(),
        );
        by_key
            .entry(key)
            .and_modify(|existing| {
                if candidate.score > existing.score {
                    *existing = candidate.clone();
                }
            })
            .or_insert(candidate);
    }

    let mut values = by_key.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.citation.path.cmp(&right.citation.path))
    });

    let mut selected = Vec::new();
    let mut selected_keys = HashSet::new();
    let mut path_counts = HashMap::<String, usize>::new();

    for pass in 0..2 {
        for candidate in &values {
            if selected.len() >= limit {
                break;
            }
            let key = (
                candidate.citation.path.clone(),
                candidate.citation.start_line,
                candidate.citation.end_line,
                candidate.citation.commit.clone(),
            );
            if selected_keys.contains(&key) {
                continue;
            }
            let path_count = *path_counts.get(&candidate.citation.path).unwrap_or(&0);
            if (pass == 0 && path_count > 0) || path_count >= 2 {
                continue;
            }
            selected_keys.insert(key);
            *path_counts.entry(candidate.citation.path.clone()).or_insert(0) += 1;
            selected.push(candidate.clone());
        }
        if selected.len() >= limit {
            break;
        }
    }

    selected
        .into_iter()
        .enumerate()
        .map(|(index, mut candidate)| {
            candidate.citation.label = format!("[C{}]", index + 1);
            candidate
        })
        .collect()
}

fn dedupe_live_hits(hits: Vec<CodeSearchHit>, limit: usize) -> Vec<CodeSearchHit> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for hit in hits {
        if seen.insert(hit.path.clone()) {
            deduped.push(hit);
        }
        if deduped.len() >= limit {
            break;
        }
    }
    deduped
}

fn load_local_candidates(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
    indexed_commit: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<LocalCandidate>, String> {
    let fts_query = build_fts_query(query);
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }

    let connection = database.connect().map_err(|error| error.to_string())?;
    let sql = "
        SELECT
            rc.id,
            rc.path,
            rc.symbol_name,
            rc.chunk_kind,
            rc.start_line,
            rc.end_line,
            rc.text,
            rc.indexed_commit,
            COALESCE(se.vector_blob, ''),
            bm25(repo_chunks_fts) AS lexical_rank
        FROM repo_chunks_fts
        JOIN repo_chunks rc ON rc.id = repo_chunks_fts.chunk_id
        LEFT JOIN repo_embeddings se
          ON se.chunk_id = rc.id
         AND se.status = 'ready'
        WHERE repo_chunks_fts.owner_repo = ?1
          AND repo_chunks_fts.branch = ?2
          AND repo_chunks_fts.indexed_commit = ?3
          AND repo_chunks_fts MATCH ?4
        ORDER BY lexical_rank ASC
        LIMIT ?5
    ";
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![owner_repo, branch, indexed_commit, fts_query, limit as i64],
            |row| {
                let vector_blob: Vec<u8> = row.get(8)?;
                let vector = if vector_blob.is_empty() {
                    None
                } else {
                    serde_json::from_slice::<Vec<f32>>(&vector_blob).ok()
                };
                let lexical_rank: f64 = row.get(9)?;
                let lexical_score = 1.0_f32 / (1.0 + lexical_rank.abs() as f32);
                Ok(LocalCandidate {
                    path: row.get(1)?,
                    symbol_name: row.get(2)?,
                    start_line: row.get::<_, i64>(4)?.max(1) as usize,
                    end_line: row.get::<_, i64>(5)?.max(1) as usize,
                    text: row.get(6)?,
                    lexical_score,
                    vector,
                })
            },
        )
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn enqueue_repo_sync(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            INSERT INTO repo_sync_jobs (
                owner_repo,
                branch,
                status,
                attempts,
                last_error,
                next_run_at,
                queued_at,
                updated_at
            ) VALUES (?1, ?2, 'queued', 0, NULL, NULL, ?3, ?3)
            ON CONFLICT(owner_repo, branch) DO UPDATE SET
                status = 'queued',
                attempts = 0,
                last_error = NULL,
                next_run_at = NULL,
                queued_at = excluded.queued_at,
                updated_at = excluded.updated_at
            ",
            params![owner_repo, branch, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn take_next_repo_job(database: &AppDatabase) -> Result<Option<RepoSyncJob>, String> {
    let now = Utc::now().to_rfc3339();
    let connection = database.connect().map_err(|error| error.to_string())?;
    let job = connection
        .query_row(
            "
            SELECT owner_repo, branch, attempts
            FROM repo_sync_jobs
            WHERE status IN ('queued', 'failed')
              AND (next_run_at IS NULL OR next_run_at <= ?1)
            ORDER BY updated_at ASC
            LIMIT 1
            ",
            params![now],
            |row| {
                Ok(RepoSyncJob {
                    owner_repo: row.get(0)?,
                    branch: row.get(1)?,
                    attempts: row.get::<_, i64>(2)?.max(0) as u32,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if let Some(job) = &job {
        connection
            .execute(
                "
                UPDATE repo_sync_jobs
                SET status = 'running',
                    updated_at = ?3
                WHERE owner_repo = ?1
                  AND branch = ?2
                ",
                params![job.owner_repo, job.branch, now],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(job)
}

fn complete_repo_job(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            UPDATE repo_sync_jobs
            SET status = 'completed',
                attempts = 0,
                last_error = NULL,
                next_run_at = NULL,
                updated_at = ?3
            WHERE owner_repo = ?1
              AND branch = ?2
            ",
            params![owner_repo, branch, now],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn fail_repo_job(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
    attempts: u32,
    error: &str,
) -> Result<(), String> {
    let now = Utc::now();
    let capped_attempts = attempts.min(REPO_JOB_MAX_ATTEMPTS);
    let backoff_multiplier = 1_i64 << capped_attempts.saturating_sub(1).min(4);
    let next_run_at =
        (now + ChronoDuration::seconds(REPO_JOB_BASE_BACKOFF_SECS * backoff_multiplier))
            .to_rfc3339();
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            UPDATE repo_sync_jobs
            SET status = 'failed',
                attempts = ?3,
                last_error = ?4,
                next_run_at = ?5,
                updated_at = ?6
            WHERE owner_repo = ?1
              AND branch = ?2
            ",
            params![
                owner_repo,
                branch,
                capped_attempts as i64,
                error.chars().take(300).collect::<String>(),
                next_run_at,
                now.to_rfc3339(),
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn start_repo_run(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
    target_commit: &str,
    previous_commit: Option<&str>,
    sync_source: &str,
) -> Result<RepoRunSeed, String> {
    let id = format!("repo_run_{}", hex::encode(Sha256::digest(format!("{owner_repo}:{branch}:{target_commit}:{}", Utc::now().timestamp_nanos_opt().unwrap_or_default()).as_bytes())));
    let started_at = Utc::now().to_rfc3339();
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            INSERT INTO repo_sync_runs (
                id,
                owner_repo,
                branch,
                status,
                sync_source,
                target_commit,
                previous_commit,
                changed_file_count,
                indexed_file_count,
                indexed_chunk_count,
                started_at
            ) VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?6, 0, 0, 0, ?7)
            ",
            params![id, owner_repo, branch, sync_source, target_commit, previous_commit, started_at],
        )
        .map_err(|error| error.to_string())?;
    Ok(RepoRunSeed {
        id,
    })
}

fn complete_repo_run(
    database: &AppDatabase,
    run_id: &str,
    changed_file_count: usize,
    indexed_file_count: usize,
    indexed_chunk_count: usize,
    sync_source: &str,
) -> Result<(), String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            UPDATE repo_sync_runs
            SET status = 'completed',
                sync_source = ?2,
                changed_file_count = ?3,
                indexed_file_count = ?4,
                indexed_chunk_count = ?5,
                completed_at = ?6,
                last_error = NULL
            WHERE id = ?1
            ",
            params![
                run_id,
                sync_source,
                changed_file_count as i64,
                indexed_file_count as i64,
                indexed_chunk_count as i64,
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn latest_repo_snapshot(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
) -> Result<Option<RepoSnapshot>, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .query_row(
            "
            SELECT target_commit, completed_at
            FROM repo_sync_runs
            WHERE owner_repo = ?1
              AND branch = ?2
              AND status = 'completed'
            ORDER BY completed_at DESC
            LIMIT 1
            ",
            params![owner_repo, branch],
            |row| {
                Ok(RepoSnapshot {
                    commit: row.get(0)?,
                    synced_at: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn configured_repo_status(database: &AppDatabase) -> Result<RepoSyncStatus, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    let settings = connection
        .prepare("SELECT key, value FROM settings WHERE key IN ('github_repo', 'github_branch', 'repo_live_search_enabled')")
        .and_then(|mut statement| {
            let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
            rows.collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| error.to_string())?;
    let github_repo = settings
        .iter()
        .find(|(key, _)| key == "github_repo")
        .map(|(_, value)| value.clone());
    let branch = settings
        .iter()
        .find(|(key, _)| key == "github_branch")
        .map(|(_, value)| value.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "main".to_string());
    let live_search_enabled = settings
        .iter()
        .find(|(key, _)| key == "repo_live_search_enabled")
        .map(|(_, value)| value == "true")
        .unwrap_or(true);

    let Some(owner_repo) = github_repo.filter(|value| !value.trim().is_empty()) else {
        return Ok(RepoSyncStatus {
            owner_repo: None,
            branch,
            live_search_enabled,
            status: "idle".to_string(),
            last_error: Some("No GitHub repo is configured.".to_string()),
            ..RepoSyncStatus::default()
        });
    };

    let job = connection
        .query_row(
            "
            SELECT status, last_error
            FROM repo_sync_jobs
            WHERE owner_repo = ?1
              AND branch = ?2
            ",
            params![owner_repo, branch],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let run = connection
        .query_row(
            "
            SELECT target_commit, completed_at, changed_file_count, indexed_file_count, indexed_chunk_count, last_error, sync_source
            FROM repo_sync_runs
            WHERE owner_repo = ?1
              AND branch = ?2
              AND status IN ('completed', 'failed')
            ORDER BY COALESCE(completed_at, started_at) DESC
            LIMIT 1
            ",
            params![owner_repo, branch],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let (status, current_error) = job.unwrap_or_else(|| ("idle".to_string(), None));
    let (last_synced_commit, last_synced_at, changed_file_count, indexed_file_count, indexed_chunk_count, run_error, sync_source) =
        run.unwrap_or((None, None, 0, 0, 0, None, None));

    Ok(RepoSyncStatus {
        owner_repo: Some(owner_repo),
        branch,
        live_search_enabled,
        status,
        last_synced_commit: last_synced_commit.clone(),
        last_synced_at,
        current_commit: last_synced_commit,
        changed_file_count: changed_file_count.max(0) as usize,
        indexed_file_count: indexed_file_count.max(0) as usize,
        indexed_chunk_count: indexed_chunk_count.max(0) as usize,
        last_error: current_error.or(run_error),
        sync_source,
    })
}

fn repo_counts(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
    indexed_commit: &str,
) -> Result<(usize, usize), String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    let file_count = connection
        .query_row(
            "
            SELECT COUNT(*)
            FROM repo_files
            WHERE owner_repo = ?1
              AND branch = ?2
              AND indexed_commit = ?3
              AND status = 'ready'
            ",
            params![owner_repo, branch, indexed_commit],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    let chunk_count = connection
        .query_row(
            "
            SELECT COUNT(*)
            FROM repo_chunks
            WHERE owner_repo = ?1
              AND branch = ?2
              AND indexed_commit = ?3
            ",
            params![owner_repo, branch, indexed_commit],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;

    Ok((file_count.max(0) as usize, chunk_count.max(0) as usize))
}

fn load_file_versions(
    database: &AppDatabase,
    owner_repo: &str,
    branch: &str,
    indexed_commit: &str,
) -> Result<HashMap<String, RepoFileSeed>, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT id, owner_repo, branch, indexed_commit, path, blob_sha, language, size_bytes
            FROM repo_files
            WHERE owner_repo = ?1
              AND branch = ?2
              AND indexed_commit = ?3
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![owner_repo, branch, indexed_commit], |row| {
            Ok(RepoFileSeed {
                id: row.get(0)?,
                owner_repo: row.get(1)?,
                branch: row.get(2)?,
                indexed_commit: row.get(3)?,
                path: row.get(4)?,
                blob_sha: row.get(5)?,
                language: row.get(6)?,
                size_bytes: row.get::<_, i64>(7)?.max(0) as u64,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut map = HashMap::new();
    for row in rows {
        let file = row.map_err(|error| error.to_string())?;
        map.insert(file.path.clone(), file);
    }
    Ok(map)
}

fn clone_file_version(
    database: &AppDatabase,
    source_file: &RepoFileSeed,
    new_commit: &str,
) -> Result<(), String> {
    let chunks = load_chunk_versions(database, &source_file.id)?;
    let new_file = RepoFileSeed {
        id: repo_file_id(&source_file.owner_repo, &source_file.branch, new_commit, &source_file.path),
        owner_repo: source_file.owner_repo.clone(),
        branch: source_file.branch.clone(),
        indexed_commit: new_commit.to_string(),
        path: source_file.path.clone(),
        blob_sha: source_file.blob_sha.clone(),
        language: source_file.language.clone(),
        size_bytes: source_file.size_bytes,
    };
    upsert_repo_file(database, &new_file)?;
    replace_repo_chunks(
        database,
        &new_file,
        &chunks
            .iter()
            .enumerate()
            .map(|(index, chunk)| RepoChunkSeed {
                id: repo_chunk_id(
                    &new_file.id,
                    &chunk.chunk_kind,
                    index as i64,
                    &chunk.text_hash,
                    chunk.start_line,
                    chunk.end_line,
                ),
                file_id: new_file.id.clone(),
                owner_repo: new_file.owner_repo.clone(),
                branch: new_file.branch.clone(),
                indexed_commit: new_file.indexed_commit.clone(),
                path: source_file.path.clone(),
                chunk_kind: chunk.chunk_kind.clone(),
                symbol_name: chunk.symbol_name.clone(),
                chunk_index: index as i64,
                start_line: chunk.start_line,
                end_line: chunk.end_line,
                text: chunk.text.clone(),
                text_hash: chunk.text_hash.clone(),
                token_estimate: chunk.token_estimate,
            })
            .collect::<Vec<_>>(),
    )?;

    for (index, chunk) in chunks.into_iter().enumerate() {
        let new_chunk_id = repo_chunk_id(
            &new_file.id,
            &chunk.chunk_kind,
            index as i64,
            &chunk.text_hash,
            chunk.start_line,
            chunk.end_line,
        );
        if let Some(vector) = chunk.vector {
            save_ready_embedding(database, &new_chunk_id, &vector)?;
        }
    }

    mark_repo_file_ready(database, &new_file.id)?;
    Ok(())
}

fn load_chunk_versions(
    database: &AppDatabase,
    file_id: &str,
) -> Result<Vec<RepoChunkVersion>, String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "
            SELECT
                rc.path,
                rc.symbol_name,
                rc.chunk_kind,
                rc.chunk_index,
                rc.start_line,
                rc.end_line,
                rc.text,
                rc.text_hash,
                rc.token_estimate,
                re.vector_blob
            FROM repo_chunks rc
            LEFT JOIN repo_embeddings re ON re.chunk_id = rc.id AND re.status = 'ready'
            WHERE rc.file_id = ?1
            ORDER BY rc.chunk_index ASC
            ",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![file_id], |row| {
            let vector_blob: Option<Vec<u8>> = row.get(9)?;
            let vector = vector_blob
                .as_deref()
                .and_then(|bytes| serde_json::from_slice::<Vec<f32>>(bytes).ok());
            Ok(RepoChunkVersion {
                symbol_name: row.get(1)?,
                chunk_kind: row.get(2)?,
                start_line: row.get::<_, i64>(4)?.max(1) as usize,
                end_line: row.get::<_, i64>(5)?.max(1) as usize,
                text: row.get(6)?,
                text_hash: row.get(7)?,
                token_estimate: row.get(8)?,
                vector,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn upsert_repo_file(database: &AppDatabase, file_seed: &RepoFileSeed) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            INSERT INTO repo_files (
                id,
                owner_repo,
                branch,
                indexed_commit,
                path,
                blob_sha,
                language,
                size_bytes,
                status,
                last_error,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', NULL, ?9, ?9)
            ON CONFLICT(id) DO UPDATE SET
                blob_sha = excluded.blob_sha,
                language = excluded.language,
                size_bytes = excluded.size_bytes,
                status = 'pending',
                last_error = NULL,
                updated_at = excluded.updated_at
            ",
            params![
                file_seed.id,
                file_seed.owner_repo,
                file_seed.branch,
                file_seed.indexed_commit,
                file_seed.path,
                file_seed.blob_sha,
                file_seed.language,
                file_seed.size_bytes as i64,
                now,
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn replace_repo_chunks(
    database: &AppDatabase,
    file_seed: &RepoFileSeed,
    chunks: &[RepoChunkSeed],
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let mut connection = database.connect().map_err(|error| error.to_string())?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM repo_chunks_fts WHERE chunk_id IN (SELECT id FROM repo_chunks WHERE file_id = ?1)", params![file_seed.id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM repo_embeddings WHERE chunk_id IN (SELECT id FROM repo_chunks WHERE file_id = ?1)", params![file_seed.id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM repo_chunks WHERE file_id = ?1", params![file_seed.id])
        .map_err(|error| error.to_string())?;

    for chunk in chunks {
        transaction
            .execute(
                "
                INSERT INTO repo_chunks (
                    id,
                    file_id,
                    owner_repo,
                    branch,
                    indexed_commit,
                    path,
                    chunk_kind,
                    symbol_name,
                    chunk_index,
                    start_line,
                    end_line,
                    text,
                    text_hash,
                    token_estimate,
                    created_at,
                    updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)
                ",
                params![
                    chunk.id,
                    chunk.file_id,
                    chunk.owner_repo,
                    chunk.branch,
                    chunk.indexed_commit,
                    chunk.path,
                    chunk.chunk_kind,
                    chunk.symbol_name,
                    chunk.chunk_index,
                    chunk.start_line as i64,
                    chunk.end_line as i64,
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
                INSERT INTO repo_chunks_fts (
                    chunk_id,
                    owner_repo,
                    branch,
                    indexed_commit,
                    path,
                    symbol_name,
                    text
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
                params![
                    chunk.id,
                    chunk.owner_repo,
                    chunk.branch,
                    chunk.indexed_commit,
                    chunk.path,
                    chunk.symbol_name,
                    chunk.text,
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn save_ready_embedding(
    database: &AppDatabase,
    chunk_id: &str,
    vector: &[f32],
) -> Result<(), String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    let vector_blob = serde_json::to_vec(vector).map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            INSERT INTO repo_embeddings (
                chunk_id,
                provider,
                model,
                dimensions,
                vector_blob,
                embedding_version,
                status,
                embedded_at,
                last_error
            ) VALUES (?1, 'Gemini', 'gemini-embedding-001', ?2, ?3, 'gemini-embedding-001-v1', 'ready', ?4, NULL)
            ON CONFLICT(chunk_id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                dimensions = excluded.dimensions,
                vector_blob = excluded.vector_blob,
                embedding_version = excluded.embedding_version,
                status = 'ready',
                embedded_at = excluded.embedded_at,
                last_error = NULL
            ",
            params![chunk_id, vector.len() as i64, vector_blob, Utc::now().to_rfc3339()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn mark_repo_file_ready(database: &AppDatabase, file_id: &str) -> Result<(), String> {
    let connection = database.connect().map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            UPDATE repo_files
            SET status = 'ready',
                last_error = NULL,
                updated_at = ?2
            WHERE id = ?1
            ",
            params![file_id, Utc::now().to_rfc3339()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn build_repo_file_seed(
    owner_repo: &str,
    branch: &str,
    indexed_commit: &str,
    path: &str,
    blob_sha: &str,
    size_bytes: u64,
) -> RepoFileSeed {
    RepoFileSeed {
        id: repo_file_id(owner_repo, branch, indexed_commit, path),
        owner_repo: owner_repo.to_string(),
        branch: branch.to_string(),
        indexed_commit: indexed_commit.to_string(),
        path: path.to_string(),
        blob_sha: blob_sha.to_string(),
        language: detect_language(path).to_string(),
        size_bytes,
    }
}

fn build_repo_chunks(file_seed: &RepoFileSeed, text: &str) -> Vec<RepoChunkSeed> {
    let mut chunks = symbol_aware_chunks(file_seed, text);
    if chunks.is_empty() {
        chunks = window_chunks(file_seed, text);
    }
    chunks
}

fn symbol_aware_chunks(file_seed: &RepoFileSeed, text: &str) -> Vec<RepoChunkSeed> {
    let language = file_seed.language.as_str();
    let supported = matches!(
        language,
        "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "go" | "java" | "md"
    );
    if !supported {
        return Vec::new();
    }

    let lines = text.lines().map(|line| line.to_string()).collect::<Vec<_>>();
    if lines.is_empty() {
        return Vec::new();
    }

    let starts = symbol_starts(language, &lines);
    if starts.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    for (index, (start_line, symbol_name)) in starts.iter().enumerate() {
        let next_start = starts
            .get(index + 1)
            .map(|(line, _)| *line)
            .unwrap_or(lines.len() + 1);
        let end_line = next_start.saturating_sub(1).min(start_line + REPO_WINDOW_MAX_LINES - 1);
        let snippet = lines
            .iter()
            .skip(start_line.saturating_sub(1))
            .take(end_line.saturating_sub(*start_line).saturating_add(1))
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        let trimmed = snippet.trim();
        if trimmed.is_empty() {
            continue;
        }
        let text_hash = hash_text(trimmed);
        chunks.push(RepoChunkSeed {
            id: repo_chunk_id(&file_seed.id, "symbol", chunks.len() as i64, &text_hash, *start_line, end_line),
            file_id: file_seed.id.clone(),
            owner_repo: file_seed.owner_repo.clone(),
            branch: file_seed.branch.clone(),
            indexed_commit: file_seed.indexed_commit.clone(),
            path: file_seed.path.clone(),
            chunk_kind: "symbol".to_string(),
            symbol_name: Some(symbol_name.clone()),
            chunk_index: chunks.len() as i64,
            start_line: *start_line,
            end_line,
            text: trimmed.to_string(),
            text_hash,
            token_estimate: estimate_tokens(trimmed),
        });
    }
    chunks
}

fn symbol_starts(language: &str, lines: &[String]) -> Vec<(usize, String)> {
    let pattern = match language {
        "ts" | "tsx" | "js" | "jsx" => {
            Regex::new(r"^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type)\s+([A-Za-z0-9_]+)|^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?(?:\(|<)")
                .expect("ts/js regex should compile")
        }
        "rs" => Regex::new(r"^\s*(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z0-9_]+)")
            .expect("rust regex should compile"),
        "py" => Regex::new(r"^\s*(?:def|class)\s+([A-Za-z0-9_]+)")
            .expect("python regex should compile"),
        "go" => Regex::new(r"^\s*(?:func|type)\s+(?:\([^\)]*\)\s*)?([A-Za-z0-9_]+)")
            .expect("go regex should compile"),
        "java" => Regex::new(r"^\s*(?:public|protected|private|static|final|\s)+\s*(?:class|interface|enum|void|[A-Za-z0-9_<>\[\]]+)\s+([A-Za-z0-9_]+)")
            .expect("java regex should compile"),
        "md" => Regex::new(r"^\s*#{1,6}\s+(.+)$").expect("markdown regex should compile"),
        _ => return Vec::new(),
    };

    let mut starts = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if let Some(captures) = pattern.captures(line) {
            let symbol = captures
                .iter()
                .skip(1)
                .flatten()
                .find_map(|capture| {
                    let value = capture.as_str().trim();
                    if value.is_empty() {
                        None
                    } else {
                        Some(value.to_string())
                    }
                });
            if let Some(symbol_name) = symbol {
                starts.push((index + 1, symbol_name));
            }
        }
    }
    starts
}

fn window_chunks(file_seed: &RepoFileSeed, text: &str) -> Vec<RepoChunkSeed> {
    let lines = text.lines().map(|line| line.to_string()).collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut start = 0usize;

    while start < lines.len() {
        let end = (start + REPO_WINDOW_MAX_LINES).min(lines.len());
        let snippet = lines[start..end].join("\n");
        let trimmed = snippet.trim();
        if !trimmed.is_empty() {
            let text_hash = hash_text(trimmed);
            chunks.push(RepoChunkSeed {
                id: repo_chunk_id(&file_seed.id, "window", chunks.len() as i64, &text_hash, start + 1, end),
                file_id: file_seed.id.clone(),
                owner_repo: file_seed.owner_repo.clone(),
                branch: file_seed.branch.clone(),
                indexed_commit: file_seed.indexed_commit.clone(),
                path: file_seed.path.clone(),
                chunk_kind: "window".to_string(),
                symbol_name: None,
                chunk_index: chunks.len() as i64,
                start_line: start + 1,
                end_line: end,
                text: trimmed.to_string(),
                text_hash,
                token_estimate: estimate_tokens(trimmed),
            });
        }

        if end >= lines.len() {
            break;
        }
        start = end.saturating_sub(REPO_WINDOW_OVERLAP_LINES);
    }

    chunks
}

fn is_indexable_path(path: &str, size: Option<u64>) -> bool {
    if size.unwrap_or_default() > REPO_MAX_FILE_BYTES {
        return false;
    }

    let lowered = path.to_lowercase();
    if lowered.ends_with(".lock")
        || lowered.ends_with(".png")
        || lowered.ends_with(".jpg")
        || lowered.ends_with(".jpeg")
        || lowered.ends_with(".gif")
        || lowered.ends_with(".svg")
        || lowered.ends_with(".ico")
        || lowered.ends_with(".pdf")
        || lowered.ends_with(".zip")
        || lowered.ends_with(".gz")
        || lowered.ends_with(".jar")
        || lowered.ends_with(".map")
        || lowered.ends_with(".min.js")
        || lowered.ends_with(".min.css")
    {
        return false;
    }

    if path
        .split('/')
        .any(|segment| matches!(segment, "node_modules" | "vendor" | "dist" | "build" | "target" | ".git" | ".next" | "coverage" | "out"))
    {
        return false;
    }

    detect_language(path) != "txt" || lowered.ends_with(".md")
}

fn detect_language(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default().to_lowercase().as_str() {
        "ts" => "ts",
        "tsx" => "tsx",
        "js" => "js",
        "jsx" => "jsx",
        "rs" => "rs",
        "py" => "py",
        "go" => "go",
        "java" => "java",
        "md" => "md",
        "json" => "json",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "html" => "html",
        "css" => "css",
        _ => "txt",
    }
}

fn decode_indexable_text(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?.to_string();
    if text.contains('\u{0000}') || is_probably_minified(&text) {
        None
    } else {
        Some(text)
    }
}

fn is_probably_minified(text: &str) -> bool {
    let lines = text.lines().take(20).collect::<Vec<_>>();
    if lines.is_empty() {
        return false;
    }
    let total_len = lines.iter().map(|line| line.len()).sum::<usize>();
    let average = total_len / lines.len().max(1);
    average > 240
}

fn strip_tarball_prefix(path: &str) -> String {
    match path.split_once('/') {
        Some((_, rest)) => rest.to_string(),
        None => path.to_string(),
    }
}

fn build_fts_query(query: &str) -> String {
    build_query_terms(query)
        .into_iter()
        .take(8)
        .map(|term| format!("{term}*"))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn build_query_terms(input: &str) -> Vec<String> {
    let stop_words = [
        "the", "and", "that", "with", "from", "about", "what", "when", "where", "does",
        "have", "will", "this", "they", "them", "into", "for", "you", "your", "were",
        "could", "should", "would", "then", "than", "there", "their", "it's", "its", "here",
        "using", "why", "are", "our", "how",
    ]
    .into_iter()
    .collect::<HashSet<_>>();

    let mut seen = HashSet::new();
    input
        .split(|character: char| !character.is_alphanumeric())
        .flat_map(split_identifier_terms)
        .filter_map(|term| {
            if term.len() < 3 || stop_words.contains(term.as_str()) || !seen.insert(term.clone()) {
                None
            } else {
                Some(term)
            }
        })
        .collect::<Vec<_>>()
}

fn dedupe_queries(queries: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for query in queries {
        let normalized = normalize_query_key(&query);
        if normalized.is_empty() || !seen.insert(normalized) {
            continue;
        }
        deduped.push(query.trim().to_string());
        if deduped.len() >= 4 {
            break;
        }
    }
    deduped
}

fn normalize_query_key(query: &str) -> String {
    query
        .split(|character: char| !character.is_alphanumeric())
        .flat_map(split_identifier_terms)
        .collect::<Vec<_>>()
        .join(" ")
}

fn split_identifier_terms(term: &str) -> Vec<String> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut segments = Vec::new();
    let mut current = String::new();
    let chars = trimmed.chars().collect::<Vec<_>>();
    for (index, character) in chars.iter().enumerate() {
        let Some(next) = chars.get(index + 1).copied() else {
            current.push(character.to_ascii_lowercase());
            continue;
        };
        let should_split = (character.is_ascii_lowercase() && next.is_ascii_uppercase())
            || (character.is_ascii_alphabetic() && next.is_ascii_digit())
            || (character.is_ascii_digit() && next.is_ascii_alphabetic())
            || (character.is_ascii_uppercase()
                && next.is_ascii_uppercase()
                && chars
                    .get(index + 2)
                    .copied()
                    .map(|following| following.is_ascii_lowercase())
                    .unwrap_or(false));
        current.push(character.to_ascii_lowercase());
        if should_split {
            if !current.trim().is_empty() {
                segments.push(current.clone());
            }
            current.clear();
        }
    }

    if !current.trim().is_empty() {
        segments.push(current);
    }

    let normalized = trimmed.to_lowercase();
    if segments.len() > 1 && normalized.len() >= 3 {
        segments.insert(0, normalized);
    } else if segments.is_empty() && normalized.len() >= 3 {
        segments.push(normalized);
    }

    segments
        .into_iter()
        .filter(|segment| !segment.trim().is_empty())
        .collect()
}

fn count_matching_terms(text: &str, prompt_terms: &[String]) -> usize {
    if prompt_terms.is_empty() {
        return 0;
    }
    let normalized = text.to_lowercase();
    prompt_terms
        .iter()
        .filter(|term| normalized.contains(term.as_str()))
        .count()
}

fn query_match_signals(
    query_phrase: &str,
    prompt_terms: &[String],
    path: &str,
    symbol: Option<&str>,
    text: &str,
) -> QueryMatchSignals {
    if prompt_terms.is_empty() {
        return QueryMatchSignals::default();
    }

    let normalized_path = path.to_lowercase();
    let normalized_symbol = symbol.unwrap_or_default().to_lowercase();
    let normalized_text = text.to_lowercase();
    let matched_terms = prompt_terms
        .iter()
        .filter(|term| {
            normalized_path.contains(term.as_str())
                || normalized_symbol.contains(term.as_str())
                || normalized_text.contains(term.as_str())
        })
        .count();
    let path_matches = count_matching_terms(path, prompt_terms);
    let symbol_matches = count_matching_terms(symbol.unwrap_or_default(), prompt_terms);
    let exact_phrase = !query_phrase.is_empty()
        && query_phrase.split_whitespace().count() > 1
        && (normalized_text.contains(query_phrase)
            || normalized_symbol.contains(query_phrase)
            || normalized_path.contains(query_phrase));

    QueryMatchSignals {
        matched_terms,
        coverage: matched_terms as f32 / prompt_terms.len().max(1) as f32,
        path_coverage: path_matches as f32 / prompt_terms.len().max(1) as f32,
        symbol_coverage: symbol_matches as f32 / prompt_terms.len().max(1) as f32,
        exact_phrase,
    }
}

fn is_strong_lexical_match(
    lexical_score: f32,
    signals: &QueryMatchSignals,
    prompt_term_count: usize,
) -> bool {
    let min_term_matches = if prompt_term_count <= 1 { 1 } else { 2 };
    signals.exact_phrase
        || signals.matched_terms >= min_term_matches
        || ((signals.path_coverage > 0.0 || signals.symbol_coverage > 0.0)
            && signals.coverage >= REPO_MIN_MATCH_COVERAGE)
        || (lexical_score >= REPO_MIN_LEXICAL_SCORE && signals.coverage >= REPO_MIN_MATCH_COVERAGE)
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

fn estimate_tokens(text: &str) -> i64 {
    text.split_whitespace().count() as i64
}

fn compact_snippet(input: &str, max_chars: usize) -> String {
    let normalized = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.len() <= max_chars {
        normalized
    } else {
        format!("{}...", &normalized[..max_chars.saturating_sub(3)])
    }
}

fn load_secret(secret_store: &dyn AppSecretStore, key: &str) -> Result<Option<String>, String> {
    secret_store
        .read_secret(key)
        .map_err(|error| error.to_string())
        .map(|value| value.filter(|secret| !secret.trim().is_empty()))
}

fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

fn repo_file_id(owner_repo: &str, branch: &str, indexed_commit: &str, path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(owner_repo.as_bytes());
    hasher.update(b":");
    hasher.update(branch.as_bytes());
    hasher.update(b":");
    hasher.update(indexed_commit.as_bytes());
    hasher.update(b":");
    hasher.update(path.as_bytes());
    format!("repo_file_{}", hex::encode(hasher.finalize()))
}

fn repo_chunk_id(
    file_id: &str,
    chunk_kind: &str,
    chunk_index: i64,
    text_hash: &str,
    start_line: usize,
    end_line: usize,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(file_id.as_bytes());
    hasher.update(b":");
    hasher.update(chunk_kind.as_bytes());
    hasher.update(b":");
    hasher.update(chunk_index.to_string().as_bytes());
    hasher.update(b":");
    hasher.update(text_hash.as_bytes());
    hasher.update(b":");
    hasher.update(start_line.to_string().as_bytes());
    hasher.update(b":");
    hasher.update(end_line.to_string().as_bytes());
    format!("repo_chunk_{}", hex::encode(hasher.finalize()))
}

fn github_blob_url(owner_repo: &str, commit: &str, path: &str, start_line: usize) -> String {
    format!("https://github.com/{owner_repo}/blob/{commit}/{path}#L{start_line}")
}

fn short_commit(commit: &str) -> String {
    commit.chars().take(7).collect()
}

pub fn parse_owner_repo(owner_repo: &str) -> Option<(String, String)> {
    let (owner, repo_name) = owner_repo.trim().split_once('/')?;
    let owner = owner.trim();
    let repo_name = repo_name.trim();
    if owner.is_empty() || repo_name.is_empty() {
        None
    } else {
        Some((owner.to_string(), repo_name.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_query_terms, build_repo_chunks, build_fts_query, build_repo_file_seed,
        dedupe_and_trim_citations, dedupe_queries, is_indexable_path, parse_owner_repo,
        RepoCitation, ScoredCandidate,
    };

    #[test]
    fn parses_owner_repo() {
        assert_eq!(
            parse_owner_repo("acme/widgets"),
            Some(("acme".to_string(), "widgets".to_string()))
        );
        assert!(parse_owner_repo("invalid").is_none());
    }

    #[test]
    fn filters_repo_paths() {
        assert!(is_indexable_path("src/lib.rs", Some(1024)));
        assert!(!is_indexable_path("node_modules/react/index.js", Some(1024)));
        assert!(!is_indexable_path("dist/app.min.js", Some(1024)));
        assert!(!is_indexable_path("src/big.ts", Some(1024 * 1024)));
    }

    #[test]
    fn symbol_aware_chunking_prefers_named_blocks() {
        let file = build_repo_file_seed("acme/widgets", "main", "abc1234", "src/app.ts", "blob", 100);
        let chunks = build_repo_chunks(
            &file,
            "export function useThing() {\n  return true;\n}\n\nexport class Widget {}\n",
        );
        assert!(!chunks.is_empty());
        assert!(chunks.iter().any(|chunk| chunk.symbol_name.as_deref() == Some("useThing")));
    }

    #[test]
    fn builds_safe_fts_query() {
        let query = build_fts_query("Why are we using event sourcing here?");
        assert!(query.contains("event*"));
        assert!(query.contains("sourcing*"));
    }

    #[test]
    fn dedupes_queries() {
        let queries = dedupe_queries(vec![
            "Event sourcing".to_string(),
            "event sourcing".to_string(),
            "architecture doc".to_string(),
        ]);
        assert_eq!(queries.len(), 2);
    }

    #[test]
    fn query_terms_drop_stop_words() {
        let terms = build_query_terms("Why are we using event sourcing here?");
        assert!(terms.contains(&"event".to_string()));
        assert!(terms.contains(&"sourcing".to_string()));
        assert!(!terms.contains(&"why".to_string()));
    }

    #[test]
    fn query_terms_split_code_identifiers() {
        let terms = build_query_terms("Trace EventStoreWriter failures");
        assert!(terms.contains(&"eventstorewriter".to_string()));
        assert!(terms.contains(&"event".to_string()));
        assert!(terms.contains(&"store".to_string()));
        assert!(terms.contains(&"writer".to_string()));
    }

    #[test]
    fn final_citations_prefer_diverse_paths() {
        let mut citations = vec![
            ScoredCandidate {
                citation: RepoCitation {
                    label: String::new(),
                    repo: "acme/widgets".to_string(),
                    branch: "main".to_string(),
                    commit: "abc1234".to_string(),
                    path: "src/events.rs".to_string(),
                    start_line: 10,
                    end_line: 22,
                    symbol_name: Some("load_stream".to_string()),
                    source: "snapshot".to_string(),
                    score: 0.96,
                    snippet: "fn load_stream() {}".to_string(),
                    url: "https://example.com/1".to_string(),
                },
                score: 0.96,
            },
            ScoredCandidate {
                citation: RepoCitation {
                    label: String::new(),
                    repo: "acme/widgets".to_string(),
                    branch: "main".to_string(),
                    commit: "abc1234".to_string(),
                    path: "src/events.rs".to_string(),
                    start_line: 40,
                    end_line: 55,
                    symbol_name: Some("append_event".to_string()),
                    source: "snapshot".to_string(),
                    score: 0.95,
                    snippet: "fn append_event() {}".to_string(),
                    url: "https://example.com/2".to_string(),
                },
                score: 0.95,
            },
            ScoredCandidate {
                citation: RepoCitation {
                    label: String::new(),
                    repo: "acme/widgets".to_string(),
                    branch: "main".to_string(),
                    commit: "abc1234".to_string(),
                    path: "src/handlers.rs".to_string(),
                    start_line: 8,
                    end_line: 18,
                    symbol_name: Some("handle_command".to_string()),
                    source: "snapshot".to_string(),
                    score: 0.84,
                    snippet: "fn handle_command() {}".to_string(),
                    url: "https://example.com/3".to_string(),
                },
                score: 0.84,
            },
        ];
        citations.reverse();

        let trimmed = dedupe_and_trim_citations(citations, 2);

        assert_eq!(trimmed.len(), 2);
        assert_ne!(trimmed[0].citation.path, trimmed[1].citation.path);
        assert_eq!(trimmed[0].citation.label, "[C1]");
        assert_eq!(trimmed[1].citation.label, "[C2]");
    }
}
