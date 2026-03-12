pub mod migrations;

use std::path::PathBuf;

use rusqlite::{params, Connection};
use thiserror::Error;

use migrations::run_migrations;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub struct AppDatabase {
    path: PathBuf,
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
