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
    pub updated_at: String,
    pub rolling_summary: Option<String>,
    pub final_summary: Option<String>,
    pub decisions_md: Option<String>,
    pub action_items_md: Option<String>,
    pub follow_up_email_md: Option<String>,
    pub notes_md: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TranscriptRow {
    pub id: String,
    pub session_id: String,
    pub sequence_no: i64,
    pub speaker_label: Option<String>,
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

fn map_session_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        updated_at: row.get(5)?,
        rolling_summary: row.get(6)?,
        final_summary: row.get(7)?,
        decisions_md: row.get(8)?,
        action_items_md: row.get(9)?,
        follow_up_email_md: row.get(10)?,
        notes_md: row.get(11)?,
    })
}

fn refresh_session_search(connection: &Connection, session_id: &str) -> Result<(), rusqlite::Error> {
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

    if let Some((title, rolling_summary, final_summary, decisions_md, action_items_md, notes_md, transcript_text)) =
        session_doc
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
                    updated_at,
                    rolling_summary,
                    final_summary,
                    decisions_md,
                    action_items_md,
                    follow_up_email_md,
                    notes_md
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
                        updated_at,
                        rolling_summary,
                        final_summary,
                        decisions_md,
                        action_items_md,
                        follow_up_email_md,
                        notes_md
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
            connection.execute(
                "
                INSERT INTO sessions (
                    id,
                    title,
                    status,
                    started_at,
                    updated_at
                ) VALUES (?1, ?2, 'active', ?3, ?3)
                ",
                params![session_id, title, now],
            )?;
            refresh_session_search(connection, &session_id)?;

            connection
                .query_row(
                    "
                    SELECT
                        id,
                        title,
                        status,
                        started_at,
                        ended_at,
                        updated_at,
                        rolling_summary,
                        final_summary,
                        decisions_md,
                        action_items_md,
                        follow_up_email_md,
                        notes_md
                    FROM sessions
                    WHERE id = ?1
                    ",
                    params![session_id],
                    map_session_row,
                )
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

    pub fn list_transcript_segments(&self, session_id: &str) -> Result<Vec<TranscriptRow>, DatabaseError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "
                SELECT id, session_id, sequence_no, speaker_label, text, is_final, source, created_at
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
                    text: row.get(4)?,
                    is_final: row.get::<_, i64>(5)? == 1,
                    source: row.get(6)?,
                    created_at: row.get(7)?,
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
        let segment_id = Uuid::new_v4().to_string();
        let now = now_iso();

        self.with_connection(|connection| {
            let next_sequence = connection.query_row(
                "SELECT COALESCE(MAX(sequence_no), 0) + 1 FROM transcript_segments WHERE session_id = ?1",
                params![session_id],
                |row| row.get::<_, i64>(0),
            )?;

            connection.execute(
                "
                INSERT INTO transcript_segments (
                    id,
                    session_id,
                    sequence_no,
                    speaker_label,
                    text,
                    is_final,
                    source,
                    created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                ",
                params![
                    segment_id,
                    session_id,
                    next_sequence,
                    speaker_label,
                    text,
                    if is_final { 1 } else { 0 },
                    source,
                    now
                ],
            )?;

            connection.execute(
                "UPDATE sessions SET updated_at = ?2 WHERE id = ?1",
                params![session_id, now_iso()],
            )?;
            refresh_session_search(connection, session_id)?;

            Ok(TranscriptRow {
                id: segment_id,
                session_id: session_id.to_string(),
                sequence_no: next_sequence,
                speaker_label: speaker_label.map(str::to_string),
                text: text.to_string(),
                is_final,
                source: source.to_string(),
                created_at: now,
            })
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
                    created_at: row.get(12)?,
                })
            })?;

            rows.collect::<Result<Vec<_>, _>>()
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
                        created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
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
                            .map(|entry| entry.created_at.clone())
                            .unwrap_or_else(now_iso),
                    ],
                )?;
            }

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
    ) -> Result<(), DatabaseError> {
        self.with_connection(|connection| {
            connection.execute(
                "
                UPDATE generated_tickets
                SET linear_issue_id = ?3,
                    linear_issue_key = ?4,
                    linear_issue_url = ?5,
                    pushed_at = ?6
                WHERE session_id = ?1 AND idempotency_key = ?2
                ",
                params![
                    session_id,
                    idempotency_key,
                    linear_issue_id,
                    linear_issue_key,
                    linear_issue_url,
                    pushed_at
                ],
            )?;

            Ok(())
        })
    }

    pub fn list_messages(&self, session_id: &str) -> Result<Vec<MessageRow>, DatabaseError> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "
                SELECT id, session_id, role, content, created_at
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
                    created_at: row.get(4)?,
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
        let message_id = Uuid::new_v4().to_string();
        let now = now_iso();

        self.with_connection(|connection| {
            connection.execute(
                "
                INSERT INTO chat_messages (
                    id,
                    session_id,
                    role,
                    content,
                    created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![message_id, session_id, role, content, now],
            )?;

            connection.execute(
                "UPDATE sessions SET updated_at = ?2 WHERE id = ?1",
                params![session_id, now_iso()],
            )?;
            refresh_session_search(connection, session_id)?;

            Ok(MessageRow {
                id: message_id,
                session_id: session_id.to_string(),
                role: role.to_string(),
                content: content.to_string(),
                created_at: now,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::AppDatabase;

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
}
