use rusqlite::Connection;

use super::DatabaseError;

fn column_exists(connection: &Connection, table: &str, column: &str) -> Result<bool, DatabaseError> {
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
          output_language       TEXT NOT NULL DEFAULT 'en',
          audio_language        TEXT NOT NULL DEFAULT 'auto',
          active_prompt_id      TEXT,
          rolling_summary       TEXT,
          final_summary         TEXT,
          decisions_md          TEXT,
          action_items_md       TEXT,
          follow_up_email_md    TEXT,
          notes_md              TEXT,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transcript_segments (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          sequence_no           INTEGER NOT NULL,
          speaker_label         TEXT,
          speaker_confidence    REAL,
          start_ms              INTEGER,
          end_ms                INTEGER,
          source                TEXT NOT NULL DEFAULT 'manual',
          text                  TEXT NOT NULL,
          is_final              INTEGER NOT NULL DEFAULT 0,
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_session_sequence
          ON transcript_segments(session_id, sequence_no);

        CREATE TABLE IF NOT EXISTS chat_messages (
          id                    TEXT PRIMARY KEY,
          session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role                  TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          content               TEXT NOT NULL,
          context_snapshot      TEXT,
          attachments_json      TEXT,
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
          created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_tickets_idempotency
          ON generated_tickets(idempotency_key);

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
          ('auto_push_linear', 'true'),
          ('overlay_shortcut', 'CmdOrCtrl+Shift+K');
        ",
    )?;

    add_column_if_missing(
        connection,
        "transcript_segments",
        "source",
        "TEXT NOT NULL DEFAULT 'manual'",
    )?;
    add_column_if_missing(connection, "chat_messages", "context_snapshot", "TEXT")?;
    add_column_if_missing(connection, "chat_messages", "attachments_json", "TEXT")?;
    add_column_if_missing(connection, "generated_tickets", "source_line", "TEXT")?;

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
}
