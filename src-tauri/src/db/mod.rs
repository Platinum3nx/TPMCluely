pub mod migrations;

use std::path::PathBuf;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use thiserror::Error;
use uuid::Uuid;

use migrations::run_migrations;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub struct AppDatabase {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SessionRow {
    pub id: String,
    pub title: String,
    pub status: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub capture_mode: String,
    pub capture_target_kind: Option<String>,
    pub capture_target_label: Option<String>,
    pub updated_at: String,
    pub rolling_summary: Option<String>,
    pub final_summary: Option<String>,
    pub decisions_md: Option<String>,
    pub action_items_md: Option<String>,
    pub follow_up_email_md: Option<String>,
    pub notes_md: Option<String>,
    pub ticket_generation_state: String,
    pub ticket_generation_error: Option<String>,
    pub ticket_generated_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TranscriptRow {
    pub id: String,
    pub session_id: String,
    pub sequence_no: i64,
    pub speaker_label: Option<String>,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    pub text: String,
    pub is_final: bool,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct MessageRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub context_snapshot: Option<String>,
    pub attachments_json: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct GeneratedTicketRow {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub description: String,
    pub acceptance_criteria: String,
    pub ticket_type: String,
    pub idempotency_key: String,
    pub source_line: Option<String>,
    pub linear_issue_id: Option<String>,
    pub linear_issue_key: Option<String>,
    pub linear_issue_url: Option<String>,
    pub pushed_at: Option<String>,
    pub linear_push_state: String,
    pub linear_last_error: Option<String>,
    pub linear_last_attempt_at: Option<String>,
    pub linear_deduped: bool,
    pub review_state: String,
    pub approved_at: Option<String>,
    pub rejected_at: Option<String>,
    pub rejection_reason: Option<String>,
    pub reviewed_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct GeneratedTicketInputRow {
    pub idempotency_key: String,
    pub title: String,
    pub description: String,
    pub acceptance_criteria: String,
    pub ticket_type: String,
    pub source_line: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PromptRow {
    pub id: String,
    pub name: String,
    pub content: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct KnowledgeFileRow {
    pub id: String,
    pub name: String,
    pub storage_path: String,
    pub mime_type: String,
    pub sha256: String,
    pub extracted_text_path: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct SearchResultRow {
    pub session_id: String,
    pub title: String,
    pub status: String,
    pub updated_at: String,
    pub snippet: String,
    pub matched_field: String,
    pub transcript_sequence_no: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct SessionPromptContext {
    pub output_language: String,
    pub audio_language: String,
    pub active_prompt_id: Option<String>,
    pub prompt_snapshot: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct SessionDerivedUpdate {
    pub rolling_summary: Option<String>,
    pub final_summary: Option<String>,
    pub decisions_md: Option<String>,
    pub action_items_md: Option<String>,
    pub follow_up_email_md: Option<String>,
    pub notes_md: Option<String>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn touch_session(connection: &Connection, session_id: &str) -> Result<(), rusqlite::Error> {
    connection.execute(
        "UPDATE sessions SET updated_at = ?2 WHERE id = ?1",
        params![session_id, now_iso()],
    )?;
    Ok(())
}

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        capture_mode: row.get(5)?,
        capture_target_kind: row.get(6)?,
        capture_target_label: row.get(7)?,
        updated_at: row.get(8)?,
        rolling_summary: row.get(9)?,
        final_summary: row.get(10)?,
        decisions_md: row.get(11)?,
        action_items_md: row.get(12)?,
        follow_up_email_md: row.get(13)?,
        notes_md: row.get(14)?,
        ticket_generation_state: row.get(15)?,
        ticket_generation_error: row.get(16)?,
        ticket_generated_at: row.get(17)?,
    })
}

fn map_prompt_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromptRow> {
    Ok(PromptRow {
        id: row.get(0)?,
        name: row.get(1)?,
        content: row.get(2)?,
        is_default: row.get::<_, i64>(3)? == 1,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn refresh_session_search(
    connection: &Connection,
    session_id: &str,
) -> Result<(), rusqlite::Error> {
    let session_doc = connection
        .query_row(
            "
            SELECT
                title,
                COALESCE(rolling_summary, ''),
                COALESCE(final_summary, ''),
                COALESCE(decisions_md, ''),
                COALESCE(action_items_md, ''),
                COALESCE(notes_md, ''),
                COALESCE((
                    SELECT group_concat(text, char(10))
                    FROM (
                        SELECT text
                        FROM transcript_segments
                        WHERE session_id = sessions.id
                        ORDER BY sequence_no ASC
                    )
                ), '')
            FROM sessions
            WHERE id = ?1
            ",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?;

    connection.execute(
        "DELETE FROM session_search WHERE session_id = ?1",
        params![session_id],
    )?;

    if let Some((
        title,
        rolling_summary,
        final_summary,
        decisions_md,
        action_items_md,
        notes_md,
        transcript_text,
    )) = session_doc
    {
        connection.execute(
            "
            INSERT INTO session_search (
                session_id,
                title,
                rolling_summary,
                final_summary,
                decisions_md,
                action_items_md,
                notes_md,
                transcript_text
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ",
            params![
                session_id,
                title,
                rolling_summary,
                final_summary,
                decisions_md,
                action_items_md,
                notes_md,
                transcript_text
            ],
        )?;
    }

    Ok(())
}

fn load_setting_value(
    connection: &Connection,
    key: &str,
    fallback: &str,
) -> Result<String, rusqlite::Error> {
    connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map(|value| value.unwrap_or_else(|| fallback.to_string()))
}

fn build_search_query(query: &str) -> Option<String> {
    let tokens = query
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|token| token.len() >= 2)
        .map(|token| format!("\"{}\"*", token.to_lowercase()))
        .collect::<Vec<_>>();

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" OR "))
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

impl AppDatabase {
    pub fn open(path: PathBuf) -> Result<Self, DatabaseError> {
        let connection = Connection::open(&path)?;
        Self::initialize(connection).map(|_| Self { path })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, DatabaseError> {
        let unique_suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("cluely-desktop-test-{unique_suffix}.db"));
        Self::open(path)
    }

    fn initialize(connection: Connection) -> Result<(), DatabaseError> {
        connection.pragma_update(None, "journal_mode", "WAL")?;
        run_migrations(&connection)?;
        Ok(())
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    pub fn healthcheck(&self) -> Result<(), DatabaseError> {
        self.with_connection(|connection| {
            connection.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))?;
            Ok(())
        })
    }

    fn connect(&self) -> Result<Connection, DatabaseError> {
        let connection = Connection::open(&self.path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        Ok(connection)
    }

    fn with_connection<T, F>(&self, action: F) -> Result<T, DatabaseError>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        let connection = self.connect()?;
        action(&connection).map_err(Into::into)
    }

    pub fn list_settings(&self) -> Result<Vec<(String, String)>, DatabaseError> {
        let connection = self.connect()?;
        let mut statement =
            connection.prepare("SELECT key, value FROM settings ORDER BY key ASC")?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;

        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn save_setting(&self, key: &str, value: &str) -> Result<(), DatabaseError> {
        let connection = self.connect()?;
        connection.execute(
            "
            INSERT INTO settings (key, value)
            VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![key, value],
        )?;

        Ok(())
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionRow>, DatabaseError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "
                SELECT
                    id,
                    title,
                    status,
                    started_at,
                    ended_at,
                    capture_mode,
                    capture_target_kind,
                    capture_target_label,
                    updated_at,
                    rolling_summary,
                    final_summary,
                    decisions_md,
                    action_items_md,
                    follow_up_email_md,
                    notes_md,
                    ticket_generation_state,
                    ticket_generation_error,
                    ticket_generated_at
                FROM sessions
                ORDER BY updated_at DESC
                ",
            )?;

            let rows = statement.query_map([], map_session_row)?;

            rows.collect::<Result<Vec<_>, _>>()
        })
    }

    pub fn get_session(&self, session_id: &str) -> Result<Option<SessionRow>, DatabaseError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "
                SELECT
                    id,
                    title,
                    status,
                    started_at,
                    ended_at,
                    capture_mode,
                    capture_target_kind,
                    capture_target_label,
                    updated_at,
                    rolling_summary,
                    final_summary,
                    decisions_md,
                    action_items_md,
                    follow_up_email_md,
                    notes_md,
                    ticket_generation_state,
                    ticket_generation_error,
                    ticket_generated_at
                    FROM sessions
                    WHERE id = ?1
                    ",
                    params![session_id],
                    map_session_row,
                )
                .optional()
        })
    }

    pub fn create_session(&self, title: &str) -> Result<SessionRow, DatabaseError> {
        let session_id = Uuid::new_v4().to_string();
        let now = now_iso();

        self.with_connection(|connection| {
            let output_language = load_setting_value(connection, "output_language", "en")?;
            let audio_language = load_setting_value(connection, "audio_language", "auto")?;
            let active_prompt_id = connection
                .query_row(
                    "SELECT value FROM settings WHERE key = 'active_prompt_id'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let prompt_snapshot = match active_prompt_id.as_deref() {
                Some(prompt_id) if !prompt_id.trim().is_empty() => connection
                    .query_row(
                        "SELECT content FROM system_prompts WHERE id = ?1",
                        params![prompt_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?,
                _ => None,
            };

            connection.execute(
                "
                INSERT INTO sessions (
                    id,
                    title,
                    status,
                    started_at,
                    capture_mode,
                    output_language,
                    audio_language,
                    active_prompt_id,
                    session_prompt_snapshot,
                    updated_at
                ) VALUES (?1, ?2, 'active', ?3, 'manual', ?4, ?5, ?6, ?7, ?3)
                ",
                params![
                    session_id,
                    title,
                    now,
                    output_language,
                    audio_language,
                    active_prompt_id,
                    prompt_snapshot
                ],
            )?;
            refresh_session_search(connection, &session_id)?;

            connection.query_row(
                "
                    SELECT
                        id,
                        title,
                        status,
                        started_at,
                        ended_at,
                        capture_mode,
                        capture_target_kind,
                        capture_target_label,
                        updated_at,
                        rolling_summary,
                        final_summary,
                        decisions_md,
                        action_items_md,
                        follow_up_email_md,
                        notes_md,
                        ticket_generation_state,
                        ticket_generation_error,
                        ticket_generated_at
                    FROM sessions
                    WHERE id = ?1
                    ",
                params![session_id],
                map_session_row,
            )
        })
    }

    pub fn get_session_prompt_context(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionPromptContext>, DatabaseError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "
                    SELECT output_language, audio_language, active_prompt_id, session_prompt_snapshot
                    FROM sessions
                    WHERE id = ?1
                    ",
                    params![session_id],
                    |row| {
                        Ok(SessionPromptContext {
                            output_language: row.get(0)?,
                            audio_language: row.get(1)?,
                            active_prompt_id: row.get(2)?,
                            prompt_snapshot: row.get(3)?,
                        })
                    },
                )
                .optional()
        })
    }

    pub fn update_session_status(
        &self,
        session_id: &str,
        status: &str,
        ended_at: Option<&str>,
    ) -> Result<(), DatabaseError> {
        let now = now_iso();
        self.with_connection(|connection| {
            connection.execute(
                "
                UPDATE sessions
                SET status = ?2,
                    ended_at = COALESCE(?3, ended_at),
                    updated_at = ?4
                WHERE id = ?1
                ",
                params![session_id, status, ended_at, now],
            )?;
            refresh_session_search(connection, session_id)?;

            Ok(())
        })
    }

    pub fn update_session_capture_metadata(
        &self,
        session_id: &str,
        capture_mode: &str,
        capture_target_kind: Option<&str>,
        capture_target_label: Option<&str>,
    ) -> Result<(), DatabaseError> {
        let now = now_iso();
        self.with_connection(|connection| {
            connection.execute(
                "
                UPDATE sessions
                SET capture_mode = ?2,
                    capture_target_kind = ?3,
                    capture_target_label = ?4,
                    updated_at = ?5
                WHERE id = ?1
                ",
                params![
                    session_id,
                    capture_mode,
                    capture_target_kind,
                    capture_target_label,
                    now
                ],
            )?;
            refresh_session_search(connection, session_id)?;
            Ok(())
        })
    }

    pub fn update_session_derived(
        &self,
        session_id: &str,
        derived: &SessionDerivedUpdate,
    ) -> Result<(), DatabaseError> {
        let now = now_iso();
        self.with_connection(|connection| {
            connection.execute(
                "
                UPDATE sessions
                SET rolling_summary = ?2,
                    final_summary = ?3,
                    decisions_md = ?4,
                    action_items_md = ?5,
                    follow_up_email_md = ?6,
                    notes_md = ?7,
                    updated_at = ?8
                WHERE id = ?1
                ",
                params![
                    session_id,
                    derived.rolling_summary,
                    derived.final_summary,
                    derived.decisions_md,
                    derived.action_items_md,
                    derived.follow_up_email_md,
                    derived.notes_md,
                    now
                ],
            )?;
            refresh_session_search(connection, session_id)?;

            Ok(())
        })
    }

    pub fn update_session_ticket_generation(
        &self,
        session_id: &str,
        state: &str,
        error: Option<&str>,
        generated_at: Option<&str>,
    ) -> Result<(), DatabaseError> {
        let now = now_iso();
        self.with_connection(|connection| {
            connection.execute(
                "
                UPDATE sessions
                SET ticket_generation_state = ?2,
                    ticket_generation_error = ?3,
                    ticket_generated_at = ?4,
                    updated_at = ?5
                WHERE id = ?1
                ",
                params![session_id, state, error, generated_at, now],
            )?;
            refresh_session_search(connection, session_id)?;
            Ok(())
        })
    }

    pub fn list_transcript_segments(
        &self,
        session_id: &str,
    ) -> Result<Vec<TranscriptRow>, DatabaseError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "
                SELECT id, session_id, sequence_no, speaker_label, start_ms, end_ms, text, is_final, source, created_at
                FROM transcript_segments
                WHERE session_id = ?1
                ORDER BY sequence_no ASC
                ",
            )?;

            let rows = statement.query_map(params![session_id], |row| {
                Ok(TranscriptRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    sequence_no: row.get(2)?,
                    speaker_label: row.get(3)?,
                    start_ms: row.get(4)?,
                    end_ms: row.get(5)?,
                    text: row.get(6)?,
                    is_final: row.get::<_, i64>(7)? == 1,
                    source: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })?;

            rows.collect::<Result<Vec<_>, _>>()
        })
    }

    pub fn append_transcript_segment(
        &self,
        session_id: &str,
        speaker_label: Option<&str>,
        text: &str,
        is_final: bool,
        source: &str,
    ) -> Result<TranscriptRow, DatabaseError> {
        self.append_transcript_segment_with_metadata(
            session_id,
            speaker_label,
            text,
            is_final,
            source,
            None,
            None,
            None,
        )
        .map(|segment| segment.expect("manual transcript inserts should never dedupe"))
    }

    pub fn append_transcript_segment_with_metadata(
        &self,
        session_id: &str,
        speaker_label: Option<&str>,
        text: &str,
        is_final: bool,
        source: &str,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
        dedupe_key: Option<&str>,
    ) -> Result<Option<TranscriptRow>, DatabaseError> {
        let segment_id = Uuid::new_v4().to_string();
        let now = now_iso();

        self.with_connection(|connection| {
            let next_sequence = connection.query_row(
                "SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM transcript_segments WHERE session_id = ?1",
                params![session_id],
                |row| row.get::<_, i64>(0),
            )?;

            let insert_result = connection.execute(
                "
                INSERT INTO transcript_segments (
                    id,
                    session_id,
                    sequence_no,
                    speaker_label,
                    start_ms,
                    end_ms,
                    text,
                    is_final,
                    source,
                    dedupe_key,
                    created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ",
                params![
                    segment_id,
                    session_id,
                    next_sequence,
                    speaker_label,
                    start_ms,
                    end_ms,
                    text,
                    if is_final { 1 } else { 0 },
                    source,
                    dedupe_key,
                    now
                ],
            );

            match insert_result {
                Ok(_) => {}
                Err(rusqlite::Error::SqliteFailure(error, _))
                    if error.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    return Ok(None);
                }
                Err(error) => return Err(error),
            }

            touch_session(connection, session_id)?;
            refresh_session_search(connection, session_id)?;

            Ok(Some(TranscriptRow {
                id: segment_id,
                session_id: session_id.to_string(),
                sequence_no: next_sequence,
                speaker_label: speaker_label.map(str::to_string),
                start_ms,
                end_ms,
                text: text.to_string(),
                is_final,
                source: source.to_string(),
                created_at: now,
            }))
        })
    }

    pub fn list_generated_tickets(
        &self,
        session_id: &str,
    ) -> Result<Vec<GeneratedTicketRow>, DatabaseError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "
                SELECT
                    id,
                    session_id,
                    title,
                    description,
                    acceptance_criteria,
                    type,
                    idempotency_key,
                    source_line,
                    linear_issue_id,
                    linear_issue_key,
                    linear_issue_url,
                    pushed_at,
                    linear_push_state,
                    linear_last_error,
                    linear_last_attempt_at,
                    linear_deduped,
                    review_state,
                    approved_at,
                    rejected_at,
                    rejection_reason,
                    reviewed_at,
                    created_at
                FROM generated_tickets
                WHERE session_id = ?1
                ORDER BY created_at ASC
                ",
            )?;

            let rows = statement.query_map(params![session_id], |row| {
                Ok(GeneratedTicketRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    title: row.get(2)?,
                    description: row.get(3)?,
                    acceptance_criteria: row.get(4)?,
                    ticket_type: row.get(5)?,
                    idempotency_key: row.get(6)?,
                    source_line: row.get(7)?,
                    linear_issue_id: row.get(8)?,
                    linear_issue_key: row.get(9)?,
                    linear_issue_url: row.get(10)?,
                    pushed_at: row.get(11)?,
                    linear_push_state: row.get(12)?,
                    linear_last_error: row.get(13)?,
                    linear_last_attempt_at: row.get(14)?,
                    linear_deduped: row.get::<_, i64>(15)? == 1,
                    review_state: row.get(16)?,
                    approved_at: row.get(17)?,
                    rejected_at: row.get(18)?,
                    rejection_reason: row.get(19)?,
                    reviewed_at: row.get(20)?,
                    created_at: row.get(21)?,
                })
            })?;

            rows.collect::<Result<Vec<_>, _>>()
        })
    }

    pub fn get_generated_ticket(
        &self,
        session_id: &str,
        idempotency_key: &str,
    ) -> Result<Option<GeneratedTicketRow>, DatabaseError> {
        self.with_connection(|connection| {
            connection
                .query_row(
                    "
                    SELECT
                        id,
                        session_id,
                        title,
                        description,
                        acceptance_criteria,
                        type,
                        idempotency_key,
                        source_line,
                        linear_issue_id,
                        linear_issue_key,
                        linear_issue_url,
                        pushed_at,
                        linear_push_state,
                        linear_last_error,
                        linear_last_attempt_at,
                        linear_deduped,
                        review_state,
                        approved_at,
                        rejected_at,
                        rejection_reason,
                        reviewed_at,
                        created_at
                    FROM generated_tickets
                    WHERE session_id = ?1 AND idempotency_key = ?2
                    ",
                    params![session_id, idempotency_key],
                    |row| {
                        Ok(GeneratedTicketRow {
                            id: row.get(0)?,
                            session_id: row.get(1)?,
                            title: row.get(2)?,
                            description: row.get(3)?,
                            acceptance_criteria: row.get(4)?,
                            ticket_type: row.get(5)?,
                            idempotency_key: row.get(6)?,
                            source_line: row.get(7)?,
                            linear_issue_id: row.get(8)?,
                            linear_issue_key: row.get(9)?,
                            linear_issue_url: row.get(10)?,
                            pushed_at: row.get(11)?,
                            linear_push_state: row.get(12)?,
                            linear_last_error: row.get(13)?,
                            linear_last_attempt_at: row.get(14)?,
                            linear_deduped: row.get::<_, i64>(15)? == 1,
                            review_state: row.get(16)?,
                            approved_at: row.get(17)?,
                            rejected_at: row.get(18)?,
                            rejection_reason: row.get(19)?,
                            reviewed_at: row.get(20)?,
                            created_at: row.get(21)?,
                        })
                    },
                )
                .optional()
        })
    }

    pub fn replace_generated_tickets(
        &self,
        session_id: &str,
        tickets: &[GeneratedTicketInputRow],
    ) -> Result<(), DatabaseError> {
        let existing = self.list_generated_tickets(session_id)?;
        self.with_connection(|connection| {
            connection.execute(
                "DELETE FROM generated_tickets WHERE session_id = ?1",
                params![session_id],
            )?;

            for ticket in tickets {
                let previous = existing
                    .iter()
                    .find(|entry| entry.idempotency_key == ticket.idempotency_key);

                connection.execute(
                    "
                    INSERT INTO generated_tickets (
                        id,
                        session_id,
                        title,
                        description,
                        acceptance_criteria,
                        type,
                        idempotency_key,
                        source_line,
                        linear_issue_id,
                        linear_issue_key,
                        linear_issue_url,
                        pushed_at,
                        linear_push_state,
                        linear_last_error,
                        linear_last_attempt_at,
                        linear_deduped,
                        review_state,
                        approved_at,
                        rejected_at,
                        rejection_reason,
                        reviewed_at,
                        created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
                    ",
                    params![
                        previous
                            .map(|entry| entry.id.clone())
                            .unwrap_or_else(|| Uuid::new_v4().to_string()),
                        session_id,
                        ticket.title,
                        ticket.description,
                        ticket.acceptance_criteria,
                        ticket.ticket_type,
                        ticket.idempotency_key,
                        ticket.source_line,
                        previous.and_then(|entry| entry.linear_issue_id.clone()),
                        previous.and_then(|entry| entry.linear_issue_key.clone()),
                        previous.and_then(|entry| entry.linear_issue_url.clone()),
                        previous.and_then(|entry| entry.pushed_at.clone()),
                        previous
                            .map(|entry| entry.linear_push_state.clone())
                            .unwrap_or_else(|| "pending".to_string()),
                        previous.and_then(|entry| entry.linear_last_error.clone()),
                        previous.and_then(|entry| entry.linear_last_attempt_at.clone()),
                        if previous.map(|entry| entry.linear_deduped).unwrap_or(false) {
                            1
                        } else {
                            0
                        },
                        previous
                            .map(|entry| entry.review_state.clone())
                            .unwrap_or_else(|| "draft".to_string()),
                        previous.and_then(|entry| entry.approved_at.clone()),
                        previous.and_then(|entry| entry.rejected_at.clone()),
                        previous.and_then(|entry| entry.rejection_reason.clone()),
                        previous.and_then(|entry| entry.reviewed_at.clone()),
                        previous
                            .map(|entry| entry.created_at.clone())
                            .unwrap_or_else(now_iso),
                    ],
                )?;
            }

            touch_session(connection, session_id)?;

            Ok(())
        })
    }

    pub fn mark_generated_ticket_pushed(
        &self,
        session_id: &str,
        idempotency_key: &str,
        linear_issue_id: &str,
        linear_issue_key: &str,
        linear_issue_url: &str,
        pushed_at: &str,
        linear_deduped: bool,
    ) -> Result<(), DatabaseError> {
        self.with_connection(|connection| {
            connection.execute(
                "
                UPDATE generated_tickets
                SET linear_issue_id = ?3,
                    linear_issue_key = ?4,
                    linear_issue_url = ?5,
                    pushed_at = ?6,
                    linear_push_state = 'pushed',
                    linear_last_error = NULL,
                    linear_last_attempt_at = ?6,
                    linear_deduped = ?7,
                    review_state = 'pushed',
                    approved_at = COALESCE(approved_at, ?6),
                    reviewed_at = COALESCE(reviewed_at, ?6)
                WHERE session_id = ?1 AND idempotency_key = ?2
                ",
                params![
                    session_id,
                    idempotency_key,
                    linear_issue_id,
                    linear_issue_key,
                    linear_issue_url,
                    pushed_at,
                    if linear_deduped { 1 } else { 0 }
                ],
            )?;
            touch_session(connection, session_id)?;

            Ok(())
        })
    }

    pub fn mark_generated_ticket_push_failed(
        &self,
        session_id: &str,
        idempotency_key: &str,
        error: &str,
        attempted_at: &str,
    ) -> Result<(), DatabaseError> {
        self.with_connection(|connection| {
            connection.execute(
                "
                UPDATE generated_tickets
                SET linear_push_state = 'failed',
                    linear_last_error = ?3,
                    linear_last_attempt_at = ?4,
                    review_state = 'push_failed',
                    reviewed_at = COALESCE(reviewed_at, ?4)
                WHERE session_id = ?1 AND idempotency_key = ?2
                ",
                params![session_id, idempotency_key, error, attempted_at],
            )?;
            touch_session(connection, session_id)?;
            Ok(())
        })
    }

    pub fn update_generated_ticket_draft(
        &self,
        session_id: &str,
        idempotency_key: &str,
        title: &str,
        description: &str,
        acceptance_criteria: &str,
        ticket_type: &str,
    ) -> Result<(), DatabaseError> {
        let now = now_iso();
        self.with_connection(|connection| {
            let updated = connection.execute(
                "
                UPDATE generated_tickets
                SET title = ?3,
                    description = ?4,
                    acceptance_criteria = ?5,
                    type = ?6,
                    review_state = 'draft',
                    approved_at = NULL,
                    rejected_at = NULL,
                    rejection_reason = NULL,
                    reviewed_at = ?7,
                    linear_push_state = CASE
                        WHEN linear_push_state = 'pushed' THEN linear_push_state
                        ELSE 'pending'
                    END,
                    linear_last_error = CASE
                        WHEN linear_push_state = 'pushed' THEN linear_last_error
                        ELSE NULL
                    END,
                    linear_last_attempt_at = CASE
                        WHEN linear_push_state = 'pushed' THEN linear_last_attempt_at
                        ELSE NULL
                    END
                WHERE session_id = ?1
                  AND idempotency_key = ?2
                  AND linear_push_state != 'pushed'
                ",
                params![
                    session_id,
                    idempotency_key,
                    title,
                    description,
                    acceptance_criteria,
                    ticket_type,
                    now,
                ],
            )?;

            if updated > 0 {
                touch_session(connection, session_id)?;
            }

            Ok(())
        })
    }

    pub fn set_generated_ticket_review_state(
        &self,
        session_id: &str,
        idempotency_key: &str,
        review_state: &str,
        rejection_reason: Option<&str>,
    ) -> Result<(), DatabaseError> {
        let now = now_iso();
        self.with_connection(|connection| {
            let updated = match review_state {
                "approved" => connection.execute(
                    "
                    UPDATE generated_tickets
                    SET review_state = 'approved',
                        approved_at = ?3,
                        rejected_at = NULL,
                        rejection_reason = NULL,
                        reviewed_at = ?3
                    WHERE session_id = ?1
                      AND idempotency_key = ?2
                      AND linear_push_state != 'pushed'
                    ",
                    params![session_id, idempotency_key, &now],
                )?,
                "rejected" => connection.execute(
                    "
                    UPDATE generated_tickets
                    SET review_state = 'rejected',
                        approved_at = NULL,
                        rejected_at = ?3,
                        rejection_reason = ?4,
                        reviewed_at = ?3
                    WHERE session_id = ?1
                      AND idempotency_key = ?2
                      AND linear_push_state != 'pushed'
                    ",
                    params![session_id, idempotency_key, &now, rejection_reason],
                )?,
                _ => connection.execute(
                    "
                    UPDATE generated_tickets
                    SET review_state = 'draft',
                        approved_at = NULL,
                        rejected_at = NULL,
                        rejection_reason = NULL,
                        reviewed_at = NULL
                    WHERE session_id = ?1
                      AND idempotency_key = ?2
                      AND linear_push_state != 'pushed'
                    ",
                    params![session_id, idempotency_key],
                )?,
            };

            if updated > 0 {
                touch_session(connection, session_id)?;
            }

            Ok(())
        })
    }

    pub fn list_messages(&self, session_id: &str) -> Result<Vec<MessageRow>, DatabaseError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "
                SELECT id, session_id, role, content, context_snapshot, attachments_json, metadata_json, created_at
                FROM chat_messages
                WHERE session_id = ?1
                ORDER BY created_at ASC
                ",
            )?;

            let rows = statement.query_map(params![session_id], |row| {
                Ok(MessageRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    context_snapshot: row.get(4)?,
                    attachments_json: row.get(5)?,
                    metadata_json: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })?;

            rows.collect::<Result<Vec<_>, _>>()
        })
    }

    pub fn append_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
    ) -> Result<MessageRow, DatabaseError> {
        self.append_message_with_metadata(session_id, role, content, None, None, None, None)
    }

    pub fn append_message_with_metadata(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        context_snapshot: Option<&str>,
        attachments_json: Option<&str>,
        metadata_json: Option<&str>,
        message_id: Option<&str>,
    ) -> Result<MessageRow, DatabaseError> {
        let message_id = message_id
            .map(str::to_string)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = now_iso();

        self.with_connection(|connection| {
            connection.execute(
                "
                INSERT INTO chat_messages (
                    id,
                    session_id,
                    role,
                    content,
                    context_snapshot,
                    attachments_json,
                    metadata_json,
                    created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
                params![
                    message_id,
                    session_id,
                    role,
                    content,
                    context_snapshot,
                    attachments_json,
                    metadata_json,
                    now
                ],
            )?;

            touch_session(connection, session_id)?;
            refresh_session_search(connection, session_id)?;

            Ok(MessageRow {
                id: message_id,
                session_id: session_id.to_string(),
                role: role.to_string(),
                content: content.to_string(),
                context_snapshot: context_snapshot.map(str::to_string),
                attachments_json: attachments_json.map(str::to_string),
                metadata_json: metadata_json.map(str::to_string),
                created_at: now,
            })
        })
    }

    pub fn insert_session_artifact(
        &self,
        session_id: &str,
        kind: &str,
        storage_path: Option<&str>,
        mime_type: Option<&str>,
        sha256: Option<&str>,
        metadata_json: Option<&str>,
    ) -> Result<String, DatabaseError> {
        let artifact_id = Uuid::new_v4().to_string();

        self.with_connection(|connection| {
            connection.execute(
                "
                INSERT INTO session_artifacts (
                    id,
                    session_id,
                    kind,
                    storage_path,
                    mime_type,
                    sha256,
                    metadata_json
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ",
                params![
                    artifact_id,
                    session_id,
                    kind,
                    storage_path,
                    mime_type,
                    sha256,
                    metadata_json
                ],
            )?;

            Ok(artifact_id)
        })
    }

    pub fn list_prompts(&self) -> Result<Vec<PromptRow>, DatabaseError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "
                SELECT id, name, content, is_default, created_at, updated_at
                FROM system_prompts
                ORDER BY is_default DESC, updated_at DESC, name ASC
                ",
            )?;
            let rows = statement.query_map([], map_prompt_row)?;

            rows.collect::<Result<Vec<_>, _>>()
        })
    }

    pub fn save_prompt(
        &self,
        prompt_id: Option<&str>,
        name: &str,
        content: &str,
        is_default: bool,
    ) -> Result<PromptRow, DatabaseError> {
        let prompt_id = prompt_id
            .map(str::to_string)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = now_iso();

        self.with_connection(|connection| {
            if is_default {
                connection.execute("UPDATE system_prompts SET is_default = 0", [])?;
            }

            connection.execute(
                "
                INSERT INTO system_prompts (id, name, content, is_default, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    content = excluded.content,
                    is_default = excluded.is_default,
                    updated_at = excluded.updated_at
                ",
                params![
                    prompt_id,
                    name,
                    content,
                    if is_default { 1 } else { 0 },
                    now
                ],
            )?;

            connection.query_row(
                "
                SELECT id, name, content, is_default, created_at, updated_at
                FROM system_prompts
                WHERE id = ?1
                ",
                params![prompt_id],
                map_prompt_row,
            )
        })
    }

    pub fn delete_prompt(&self, prompt_id: &str) -> Result<(), DatabaseError> {
        self.with_connection(|connection| {
            connection.execute(
                "DELETE FROM system_prompts WHERE id = ?1",
                params![prompt_id],
            )?;

            let active_prompt_id = connection
                .query_row(
                    "SELECT value FROM settings WHERE key = 'active_prompt_id'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if active_prompt_id.as_deref() == Some(prompt_id) {
                connection.execute("DELETE FROM settings WHERE key = 'active_prompt_id'", [])?;
            }

            Ok(())
        })
    }

    pub fn list_knowledge_files(&self) -> Result<Vec<KnowledgeFileRow>, DatabaseError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "
                SELECT id, name, storage_path, mime_type, sha256, extracted_text_path, created_at
                FROM knowledge_files
                ORDER BY created_at DESC, name ASC
                ",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(KnowledgeFileRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    storage_path: row.get(2)?,
                    mime_type: row.get(3)?,
                    sha256: row.get(4)?,
                    extracted_text_path: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })?;

            rows.collect::<Result<Vec<_>, _>>()
        })
    }

    pub fn insert_knowledge_file(
        &self,
        name: &str,
        storage_path: &str,
        mime_type: &str,
        sha256: &str,
        extracted_text_path: Option<&str>,
    ) -> Result<KnowledgeFileRow, DatabaseError> {
        let file_id = Uuid::new_v4().to_string();

        self.with_connection(|connection| {
            connection.execute(
                "
                INSERT INTO knowledge_files (
                    id,
                    name,
                    storage_path,
                    mime_type,
                    sha256,
                    extracted_text_path
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ",
                params![
                    file_id,
                    name,
                    storage_path,
                    mime_type,
                    sha256,
                    extracted_text_path
                ],
            )?;

            connection.query_row(
                "
                SELECT id, name, storage_path, mime_type, sha256, extracted_text_path, created_at
                FROM knowledge_files
                WHERE id = ?1
                ",
                params![file_id],
                |row| {
                    Ok(KnowledgeFileRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        storage_path: row.get(2)?,
                        mime_type: row.get(3)?,
                        sha256: row.get(4)?,
                        extracted_text_path: row.get(5)?,
                        created_at: row.get(6)?,
                    })
                },
            )
        })
    }

    pub fn delete_knowledge_file(&self, knowledge_file_id: &str) -> Result<(), DatabaseError> {
        self.with_connection(|connection| {
            connection.execute(
                "DELETE FROM knowledge_files WHERE id = ?1",
                params![knowledge_file_id],
            )?;
            Ok(())
        })
    }

    pub fn search_sessions(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SearchResultRow>, DatabaseError> {
        let Some(match_query) = build_search_query(query) else {
            return Ok(Vec::new());
        };
        let like_pattern = format!("%{}%", query.trim().to_lowercase());
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "
                SELECT
                    s.id,
                    s.title,
                    s.status,
                    s.updated_at,
                    CASE
                        WHEN lower(COALESCE(s.final_summary, '')) LIKE ?2 THEN COALESCE(s.final_summary, '')
                        WHEN lower(COALESCE(s.decisions_md, '')) LIKE ?2 THEN COALESCE(s.decisions_md, '')
                        WHEN lower(COALESCE(s.action_items_md, '')) LIKE ?2 THEN COALESCE(s.action_items_md, '')
                        WHEN lower(COALESCE(s.notes_md, '')) LIKE ?2 THEN COALESCE(s.notes_md, '')
                        ELSE COALESCE((
                            SELECT text
                            FROM transcript_segments
                            WHERE session_id = s.id AND lower(text) LIKE ?2
                            ORDER BY sequence_no ASC
                            LIMIT 1
                        ), COALESCE(s.rolling_summary, ''))
                    END,
                    CASE
                        WHEN lower(COALESCE(s.final_summary, '')) LIKE ?2 THEN 'final_summary'
                        WHEN lower(COALESCE(s.decisions_md, '')) LIKE ?2 THEN 'decisions'
                        WHEN lower(COALESCE(s.action_items_md, '')) LIKE ?2 THEN 'action_items'
                        WHEN lower(COALESCE(s.notes_md, '')) LIKE ?2 THEN 'notes'
                        ELSE 'transcript'
                    END,
                    (
                        SELECT sequence_no
                        FROM transcript_segments
                        WHERE session_id = s.id AND lower(text) LIKE ?2
                        ORDER BY sequence_no ASC
                        LIMIT 1
                    ) AS transcript_sequence_no
                FROM session_search ss
                JOIN sessions s ON s.id = ss.session_id
                WHERE session_search MATCH ?1
                ORDER BY bm25(session_search), s.updated_at DESC
                LIMIT ?3
                ",
            )?;

            let rows = statement.query_map(params![match_query, like_pattern, limit as i64], |row| {
                Ok(SearchResultRow {
                    session_id: row.get(0)?,
                    title: row.get(1)?,
                    status: row.get(2)?,
                    updated_at: row.get(3)?,
                    snippet: compact_snippet(&row.get::<_, String>(4)?, 220),
                    matched_field: row.get(5)?,
                    transcript_sequence_no: row.get(6)?,
                })
            })?;

            rows.collect::<Result<Vec<_>, _>>()
        })
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::ErrorCode;

    use super::{AppDatabase, GeneratedTicketInputRow};

    #[test]
    fn seeds_default_settings() {
        let database = AppDatabase::open_in_memory().expect("database should initialize");
        let settings = database.list_settings().expect("settings should load");
        assert!(settings
            .iter()
            .any(|(key, value)| key == "theme" && value == "system"));
        assert!(settings
            .iter()
            .any(|(key, value)| key == "ticket_generation_enabled" && value == "true"));
    }

    #[test]
    fn dedupe_key_prevents_duplicate_capture_segments() {
        let database = AppDatabase::open_in_memory().expect("database should initialize");
        let session = database
            .create_session("Audio session")
            .expect("session should exist");

        let first = database
            .append_transcript_segment_with_metadata(
                &session.id,
                Some("Meeting"),
                "hello world",
                true,
                "capture",
                Some(10),
                Some(20),
                Some("same-key"),
            )
            .expect("first insert should work");
        let second = database
            .append_transcript_segment_with_metadata(
                &session.id,
                Some("Meeting"),
                "hello world",
                true,
                "capture",
                Some(10),
                Some(20),
                Some("same-key"),
            )
            .expect("duplicate insert should not error");

        assert!(first.is_some());
        assert!(second.is_none());
    }

    #[test]
    fn generated_ticket_idempotency_is_scoped_per_session() {
        let database = AppDatabase::open_in_memory().expect("database should initialize");
        let first_session = database
            .create_session("Session A")
            .expect("first session should exist");
        let second_session = database
            .create_session("Session B")
            .expect("second session should exist");

        database
            .replace_generated_tickets(
                &first_session.id,
                &[super::GeneratedTicketInputRow {
                    idempotency_key: "same-key".to_string(),
                    title: "First".to_string(),
                    description: "Description".to_string(),
                    acceptance_criteria: "[\"one\"]".to_string(),
                    ticket_type: "Task".to_string(),
                    source_line: None,
                }],
            )
            .expect("first session ticket should save");
        database
            .replace_generated_tickets(
                &second_session.id,
                &[super::GeneratedTicketInputRow {
                    idempotency_key: "same-key".to_string(),
                    title: "Second".to_string(),
                    description: "Description".to_string(),
                    acceptance_criteria: "[\"one\"]".to_string(),
                    ticket_type: "Task".to_string(),
                    source_line: None,
                }],
            )
            .expect("second session ticket should save");

        let connection = database.connect().expect("database connection should open");
        let duplicate = connection.execute(
            "
            INSERT INTO generated_tickets (
                id,
                session_id,
                title,
                description,
                acceptance_criteria,
                type,
                idempotency_key
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ",
            rusqlite::params![
                "duplicate",
                first_session.id,
                "Duplicate",
                "Description",
                "[\"one\"]",
                "Task",
                "same-key"
            ],
        );

        match duplicate {
            Err(rusqlite::Error::SqliteFailure(error, _)) => {
                assert_eq!(error.code, ErrorCode::ConstraintViolation);
            }
            other => panic!("expected duplicate constraint violation, got {other:?}"),
        }
    }

    #[test]
    fn generated_ticket_review_state_updates_reset_unpushed_drafts_only() {
        let database = AppDatabase::open_in_memory().expect("database should initialize");
        let session = database
            .create_session("Review flow")
            .expect("session should exist");

        database
            .replace_generated_tickets(
                &session.id,
                &[GeneratedTicketInputRow {
                    idempotency_key: "ticket-1".to_string(),
                    title: "Investigate flaky auth retry".to_string(),
                    description: "Track the auth retry issue".to_string(),
                    acceptance_criteria: "[\"Retries stay bounded\"]".to_string(),
                    ticket_type: "Task".to_string(),
                    source_line: Some("[S4]".to_string()),
                }],
            )
            .expect("ticket should save");

        database
            .set_generated_ticket_review_state(&session.id, "ticket-1", "approved", None)
            .expect("approval should save");
        let approved = database
            .get_generated_ticket(&session.id, "ticket-1")
            .expect("ticket should load")
            .expect("ticket should exist");
        assert_eq!(approved.review_state, "approved");
        assert!(approved.approved_at.is_some());
        assert!(approved.reviewed_at.is_some());

        database
            .set_generated_ticket_review_state(
                &session.id,
                "ticket-1",
                "rejected",
                Some("Covered by another issue"),
            )
            .expect("rejection should save");
        let rejected = database
            .get_generated_ticket(&session.id, "ticket-1")
            .expect("ticket should load")
            .expect("ticket should exist");
        assert_eq!(rejected.review_state, "rejected");
        assert_eq!(
            rejected.rejection_reason.as_deref(),
            Some("Covered by another issue")
        );
        assert!(rejected.rejected_at.is_some());

        database
            .update_generated_ticket_draft(
                &session.id,
                "ticket-1",
                "Investigate auth retry regression",
                "Capture the latest regression details",
                "[\"Regression is reproducible\"]",
                "Bug",
            )
            .expect("draft update should save");
        let draft = database
            .get_generated_ticket(&session.id, "ticket-1")
            .expect("ticket should load")
            .expect("ticket should exist");
        assert_eq!(draft.review_state, "draft");
        assert_eq!(draft.title, "Investigate auth retry regression");
        assert_eq!(draft.ticket_type, "Bug");
        assert_eq!(draft.linear_push_state, "pending");

        database
            .mark_generated_ticket_pushed(
                &session.id,
                "ticket-1",
                "issue-1",
                "ENG-42",
                "https://linear.app/eng/issue/ENG-42",
                "2026-03-13T15:10:00Z",
                false,
            )
            .expect("push mark should save");
        database
            .update_generated_ticket_draft(
                &session.id,
                "ticket-1",
                "Should not overwrite pushed ticket",
                "Still immutable",
                "[\"Ignored\"]",
                "Task",
            )
            .expect("pushed ticket update should no-op");
        database
            .set_generated_ticket_review_state(&session.id, "ticket-1", "draft", None)
            .expect("pushed ticket review reset should no-op");

        let pushed = database
            .get_generated_ticket(&session.id, "ticket-1")
            .expect("ticket should load")
            .expect("ticket should exist");
        assert_eq!(pushed.linear_push_state, "pushed");
        assert_eq!(pushed.review_state, "pushed");
        assert_eq!(pushed.title, "Investigate auth retry regression");
        assert_eq!(pushed.linear_issue_key.as_deref(), Some("ENG-42"));
    }

    #[test]
    fn message_metadata_round_trips_through_storage() {
        let database = AppDatabase::open_in_memory().expect("database should initialize");
        let session = database
            .create_session("Assistant session")
            .expect("session should exist");

        let metadata_json = "{\"responseMode\":\"gemini\",\"providerName\":\"Gemini\",\"latencyMs\":1200,\"usedScreenContext\":true,\"citations\":[\"[S4]\",\"[Screen]\"]}";
        let attachments_json = "[{\"kind\":\"screenshot\",\"mimeType\":\"image/jpeg\",\"capturedAt\":\"2026-03-13T15:00:00Z\",\"width\":1440,\"height\":900,\"sourceLabel\":\"Architecture doc\",\"persisted\":false}]";

        database
            .append_message_with_metadata(
                &session.id,
                "assistant",
                "Grounded answer [S4] [Screen]",
                Some("Shared screen context"),
                Some(attachments_json),
                Some(metadata_json),
                None,
            )
            .expect("message should save");

        let messages = database
            .list_messages(&session.id)
            .expect("messages should load");
        let message = messages.last().expect("message should exist");
        assert_eq!(message.role, "assistant");
        assert_eq!(message.metadata_json.as_deref(), Some(metadata_json));
        assert_eq!(message.attachments_json.as_deref(), Some(attachments_json));
    }
}
