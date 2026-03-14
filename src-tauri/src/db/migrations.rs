use rusqlite::Connection;

use super::DatabaseError;

fn normalize_legacy_speaker_id(label: &str) -> String {
    let mut token = String::new();
    let mut last_was_separator = false;

    for character in label.trim().chars().flat_map(|value| value.to_lowercase()) {
        if character.is_ascii_alphanumeric() {
            token.push(character);
            last_was_separator = false;
        } else if !token.is_empty() && !last_was_separator {
            token.push('-');
            last_was_separator = true;
        }
    }

    let normalized = token.trim_matches('-');
    if normalized.is_empty() {
        "speaker".to_string()
    } else {
        normalized.to_string()
    }
}

fn backfill_session_speakers(connection: &Connection) -> Result<(), DatabaseError> {
    connection.execute(
        "
        UPDATE transcript_segments
        SET speaker_label = NULL,
            speaker_id = NULL,
            speaker_confidence = NULL
        WHERE lower(trim(COALESCE(speaker_label, ''))) = 'meeting'
        ",
        [],
    )?;

    let mut statement = connection.prepare(
        "
        SELECT DISTINCT session_id, speaker_label
        FROM transcript_segments
        WHERE speaker_label IS NOT NULL
          AND trim(speaker_label) != ''
          AND lower(trim(speaker_label)) != 'meeting'
        ORDER BY session_id ASC, speaker_label ASC
        ",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows {
        let (session_id, speaker_label) = row?;
        let display_label = speaker_label.trim();
        let speaker_id = format!("legacy:{}", normalize_legacy_speaker_id(display_label));

        connection.execute(
            "
            INSERT OR IGNORE INTO session_speakers (
                session_id,
                speaker_id,
                provider_label,
                display_label,
                source,
                created_at,
                updated_at
            ) VALUES (?1, ?2, ?3, ?4, 'manual', datetime('now'), datetime('now'))
            ",
            rusqlite::params![session_id, speaker_id, display_label, display_label],
        )?;
        connection.execute(
            "
            UPDATE transcript_segments
            SET speaker_id = COALESCE(speaker_id, ?3),
                speaker_label = ?4
            WHERE session_id = ?1
              AND speaker_label IS NOT NULL
              AND lower(trim(speaker_label)) = lower(trim(?2))
            ",
            rusqlite::params![session_id, speaker_label, speaker_id, display_label],
        )?;
    }

    Ok(())
}

fn column_exists(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, DatabaseError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;

    for row in rows {
        if row? == column {
            return Ok(true);
        }
    }

    Ok(false)
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), DatabaseError> {
    if !column_exists(connection, table, column)? {
        connection.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition};"
        ))?;
    }

    Ok(())
}

pub fn run_migrations(connection: &Connection) -> Result<(), DatabaseError> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS sessions (
          id                    TEXT PRIMARY KEY,
          title                 TEXT NOT NULL,
          status                TEXT NOT NULL CHECK (
            status IN (
              'idle',
              'preparing',
              'active',
              'paused',
              'finishing',
              'completed',
              'permission_blocked',
              'capture_error',
              'provider_degraded',
              'finalization_failed'
            )
          ),
          started_at            TEXT,
          ended_at              TEXT,
          source                TEXT NOT NULL DEFAULT 'manual',
          capture_mode          TEXT NOT NULL DEFAULT 'manual',
          capture_target_kind   TEXT,
          capture_target_label  TEXT,
          output_language       TEXT NOT NULL DEFAULT 'en',
          audio_language        TEXT NOT NULL DEFAULT 'auto',
          active_prompt_id      TEXT,
          session_prompt_snapshot TEXT,
          rolling_summary       TEXT,
          final_summary         TEXT,
          decisions_md          TEXT,
          action_items_md       TEXT,
          follow_up_email_md    TEXT,
          notes_md              TEXT,
          ticket_generation_state TEXT NOT NULL DEFAULT 'not_started' CHECK (
            ticket_generation_state IN ('not_started', 'succeeded', 'failed')
          ),
          ticket_generation_error TEXT,
          ticket_generated_at   TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transcript_segments (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          sequence_no           INTEGER NOT NULL,
          speaker_id            TEXT,
          speaker_label         TEXT,
          speaker_confidence    REAL,
          start_ms              INTEGER,
          end_ms                INTEGER,
          source                TEXT NOT NULL DEFAULT 'manual',
          dedupe_key            TEXT,
          text                  TEXT NOT NULL,
          is_final              INTEGER NOT NULL DEFAULT 0,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_session_sequence
          ON transcript_segments(session_id, sequence_no);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_session_dedupe
          ON transcript_segments(session_id, dedupe_key)
          WHERE dedupe_key IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_transcript_session_speaker
          ON transcript_segments(session_id, speaker_id)
          WHERE speaker_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS session_speakers (
          session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          speaker_id            TEXT NOT NULL,
          provider_label        TEXT,
          display_label         TEXT NOT NULL,
          source                TEXT NOT NULL CHECK (source IN ('provider', 'manual')),
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (session_id, speaker_id)
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role                  TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content               TEXT NOT NULL,
          context_snapshot      TEXT,
          attachments_json      TEXT,
          metadata_json         TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS session_artifacts (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          kind                  TEXT NOT NULL CHECK (
            kind IN ('screenshot', 'attachment', 'export', 'brief', 'note', 'ticket_batch')
          ),
          storage_path          TEXT,
          mime_type             TEXT,
          sha256                TEXT,
          metadata_json         TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS system_prompts (
          id                    TEXT PRIMARY KEY,
          name                  TEXT NOT NULL,
          content               TEXT NOT NULL,
          is_default            INTEGER NOT NULL DEFAULT 0,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS knowledge_files (
          id                    TEXT PRIMARY KEY,
          name                  TEXT NOT NULL,
          storage_path          TEXT NOT NULL,
          mime_type             TEXT NOT NULL,
          sha256                TEXT NOT NULL,
          extracted_text_path   TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS generated_tickets (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          title                 TEXT NOT NULL,
          description           TEXT NOT NULL,
          acceptance_criteria   TEXT NOT NULL,
          type                  TEXT NOT NULL CHECK (type IN ('Bug', 'Feature', 'Task')),
          idempotency_key       TEXT NOT NULL,
          source_line           TEXT,
          linear_issue_id       TEXT,
          linear_issue_key      TEXT,
          linear_issue_url      TEXT,
          pushed_at             TEXT,
          linear_push_state     TEXT NOT NULL DEFAULT 'pending' CHECK (linear_push_state IN ('pending', 'pushed', 'failed')),
          linear_last_error     TEXT,
          linear_last_attempt_at TEXT,
          linear_deduped        INTEGER NOT NULL DEFAULT 0,
          review_state          TEXT NOT NULL DEFAULT 'draft' CHECK (review_state IN ('draft', 'approved', 'rejected', 'pushed', 'push_failed')),
          approved_at           TEXT,
          rejected_at           TEXT,
          rejection_reason      TEXT,
          reviewed_at           TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_tickets_session_idempotency
          ON generated_tickets(session_id, idempotency_key);

        CREATE TABLE IF NOT EXISTS settings (
          key                   TEXT PRIMARY KEY,
          value                 TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
          session_id UNINDEXED,
          title,
          rolling_summary,
          final_summary,
          decisions_md,
          action_items_md,
          notes_md,
          transcript_text
        );

        CREATE TABLE IF NOT EXISTS search_chunks (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          knowledge_file_id     TEXT REFERENCES knowledge_files(id) ON DELETE CASCADE,
          source_kind           TEXT NOT NULL,
          chunk_index           INTEGER NOT NULL,
          sequence_start        INTEGER,
          sequence_end          INTEGER,
          text                  TEXT NOT NULL,
          text_hash             TEXT NOT NULL,
          token_estimate        INTEGER NOT NULL DEFAULT 0,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_search_chunks_session_source_chunk
          ON search_chunks(session_id, source_kind, chunk_index);

        CREATE TABLE IF NOT EXISTS search_embeddings (
          chunk_id              TEXT PRIMARY KEY,
          provider              TEXT NOT NULL,
          model                 TEXT NOT NULL,
          dimensions            INTEGER,
          vector_blob           BLOB,
          embedding_version     TEXT NOT NULL,
          status                TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
          embedded_at           TEXT,
          last_error            TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_search_embeddings_status
          ON search_embeddings(status);

        CREATE TABLE IF NOT EXISTS search_index_jobs (
          session_id            TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
          status                TEXT NOT NULL CHECK (status IN ('queued', 'running', 'failed', 'completed')),
          attempts              INTEGER NOT NULL DEFAULT 0,
          last_error            TEXT,
          next_run_at           TEXT,
          queued_at             TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_search_index_jobs_status_next_run
          ON search_index_jobs(status, next_run_at, updated_at);

        CREATE TABLE IF NOT EXISTS repo_chunks (
          id                    TEXT PRIMARY KEY,
          repo_name             TEXT NOT NULL,
          file_path             TEXT NOT NULL,
          chunk_index           INTEGER NOT NULL,
          text                  TEXT NOT NULL,
          embedding_blob        BLOB,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_chunks_repo_file_chunk
          ON repo_chunks(repo_name, file_path, chunk_index);

        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('theme', 'system'),
          ('session_widget_enabled', 'true'),
          ('always_on_top', 'true'),
          ('dock_icon', 'true'),
          ('launch_at_login', 'false'),
          ('output_language', 'en'),
          ('audio_language', 'auto'),
          ('live_summary_enabled', 'true'),
          ('screenshot_mode', 'selection'),
          ('screenshot_processing', 'manual'),
          ('screen_context_enabled', 'true'),
          ('persist_screen_artifacts', 'false'),
          ('ticket_generation_enabled', 'true'),
          ('auto_generate_tickets', 'true'),
          ('auto_push_linear', 'false'),
          ('ticket_push_mode', 'review_before_push'),
          ('preferred_microphone_device_id', ''),
          ('overlay_shortcut', 'CmdOrCtrl+Shift+K');
        ",
    )?;

    add_column_if_missing(
        connection,
        "transcript_segments",
        "speaker_id",
        "TEXT",
    )?;
    add_column_if_missing(
        connection,
        "transcript_segments",
        "speaker_confidence",
        "REAL",
    )?;
    add_column_if_missing(
        connection,
        "transcript_segments",
        "source",
        "TEXT NOT NULL DEFAULT 'manual'",
    )?;
    add_column_if_missing(
        connection,
        "sessions",
        "capture_mode",
        "TEXT NOT NULL DEFAULT 'manual'",
    )?;
    add_column_if_missing(connection, "sessions", "capture_target_kind", "TEXT")?;
    add_column_if_missing(connection, "sessions", "capture_target_label", "TEXT")?;
    add_column_if_missing(connection, "sessions", "session_prompt_snapshot", "TEXT")?;
    add_column_if_missing(connection, "transcript_segments", "dedupe_key", "TEXT")?;
    add_column_if_missing(connection, "chat_messages", "context_snapshot", "TEXT")?;
    add_column_if_missing(connection, "chat_messages", "attachments_json", "TEXT")?;
    add_column_if_missing(connection, "chat_messages", "metadata_json", "TEXT")?;
    add_column_if_missing(connection, "generated_tickets", "source_line", "TEXT")?;
    add_column_if_missing(
        connection,
        "sessions",
        "ticket_generation_state",
        "TEXT NOT NULL DEFAULT 'not_started'",
    )?;
    add_column_if_missing(connection, "sessions", "ticket_generation_error", "TEXT")?;
    add_column_if_missing(connection, "sessions", "ticket_generated_at", "TEXT")?;
    add_column_if_missing(
        connection,
        "generated_tickets",
        "linear_push_state",
        "TEXT NOT NULL DEFAULT 'pending'",
    )?;
    add_column_if_missing(connection, "generated_tickets", "linear_last_error", "TEXT")?;
    add_column_if_missing(
        connection,
        "generated_tickets",
        "linear_last_attempt_at",
        "TEXT",
    )?;
    add_column_if_missing(
        connection,
        "generated_tickets",
        "linear_deduped",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        connection,
        "generated_tickets",
        "review_state",
        "TEXT NOT NULL DEFAULT 'draft'",
    )?;
    add_column_if_missing(connection, "generated_tickets", "approved_at", "TEXT")?;
    add_column_if_missing(connection, "generated_tickets", "rejected_at", "TEXT")?;
    add_column_if_missing(connection, "generated_tickets", "rejection_reason", "TEXT")?;
    add_column_if_missing(connection, "generated_tickets", "reviewed_at", "TEXT")?;
    add_column_if_missing(connection, "settings", "value", "TEXT NOT NULL DEFAULT ''")?;
    connection.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('ticket_push_mode', 'review_before_push')",
        [],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('preferred_microphone_device_id', '')",
        [],
    )?;
    connection.execute_batch(
        "
        CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_session_dedupe
          ON transcript_segments(session_id, dedupe_key)
          WHERE dedupe_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_transcript_session_speaker
          ON transcript_segments(session_id, speaker_id)
          WHERE speaker_id IS NOT NULL;
        DROP INDEX IF EXISTS idx_generated_tickets_idempotency;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_tickets_session_idempotency
          ON generated_tickets(session_id, idempotency_key);
        ",
    )?;
    backfill_session_speakers(connection)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::run_migrations;

    #[test]
    fn creates_fts_table_and_settings() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        run_migrations(&connection).expect("migrations should succeed");

        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'session_search'",
                [],
                |row| row.get(0),
            )
            .expect("session_search table query should work");

        let settings_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))
            .expect("settings count query should work");

        assert_eq!(count, 1);
        assert!(settings_count >= 10);
    }

    #[test]
    fn creates_semantic_search_tables() {
        let connection = Connection::open_in_memory().expect("in-memory database should open");
        run_migrations(&connection).expect("migrations should succeed");

        for table in ["search_chunks", "search_embeddings", "search_index_jobs"] {
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("semantic search table query should work");
            assert_eq!(count, 1, "{table} should exist after migration");
        }
    }
}
