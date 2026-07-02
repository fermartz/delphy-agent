//! Atomic multi-statement DB writes that must not half-apply.
//!
//! `tauri-plugin-sql` runs every `execute()` on a pooled connection, so a
//! JS-side `BEGIN`/`COMMIT` spans multiple connections and is not a real
//! transaction (BACKLOG #15). For the one case where atomicity matters —
//! replacing a session's whole message log after compaction — we reuse the
//! plugin's own sqlite pool here and run the rewrite inside a single sqlx
//! transaction (one connection held across DELETE + N INSERTs).

use serde::Deserialize;
use sqlx::{Pool, Sqlite};
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_KEY: &str = "sqlite:delphy.db";

#[derive(Debug, Deserialize)]
pub struct MessageInsert {
    pub id: String,
    pub seq: i64,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

/// Atomically replace every `messages` row for `session_id`. Factored out of
/// the command so it can be tested against a real in-memory sqlite pool. On any
/// error the transaction is dropped (rolled back), so the DELETE never applies
/// without the full set of INSERTs.
async fn replace_messages_tx(
    pool: &Pool<Sqlite>,
    session_id: &str,
    messages: &[MessageInsert],
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM messages WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
    for m in messages {
        sqlx::query(
            "INSERT INTO messages (id, session_id, seq, role, content, created_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&m.id)
        .bind(session_id)
        .bind(m.seq)
        .bind(&m.role)
        .bind(&m.content)
        .bind(m.created_at)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

#[tauri::command]
pub async fn replace_session_messages(
    db_instances: tauri::State<'_, DbInstances>,
    session_id: String,
    messages: Vec<MessageInsert>,
) -> Result<(), String> {
    // Clone the pool handle (Arc-backed, cheap) and drop the read guard before
    // the transaction so we don't hold the DbInstances lock across the await.
    let pool = {
        let instances = db_instances.0.read().await;
        let Some(db) = instances.get(DB_KEY) else {
            return Err(format!("database {DB_KEY} is not loaded"));
        };
        let DbPool::Sqlite(pool) = db; // sqlite is the only compiled variant
        pool.clone()
    };
    replace_messages_tx(&pool, &session_id, &messages)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn setup() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, \
             seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, \
             created_at INTEGER NOT NULL, UNIQUE(session_id, seq))",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn msg(id: &str, seq: i64) -> MessageInsert {
        MessageInsert {
            id: id.into(),
            seq,
            role: "user".into(),
            content: "x".into(),
            created_at: 0,
        }
    }

    async fn count(pool: &Pool<Sqlite>, session: &str) -> i64 {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM messages WHERE session_id = ?")
            .bind(session)
            .fetch_one(pool)
            .await
            .unwrap();
        row.0
    }

    #[tokio::test]
    async fn replaces_all_messages_for_a_session() {
        let pool = setup().await;
        replace_messages_tx(&pool, "s1", &[msg("a", 0), msg("b", 1)])
            .await
            .unwrap();
        assert_eq!(count(&pool, "s1").await, 2);
        replace_messages_tx(&pool, "s1", &[msg("c", 0)]).await.unwrap();
        assert_eq!(count(&pool, "s1").await, 1);
    }

    #[tokio::test]
    async fn rolls_back_and_preserves_old_history_on_insert_failure() {
        let pool = setup().await;
        replace_messages_tx(&pool, "s1", &[msg("orig-a", 0), msg("orig-b", 1)])
            .await
            .unwrap();
        // Two inserts with the same (session_id, seq) violate UNIQUE on the 2nd,
        // AFTER the DELETE — a real transaction must roll the DELETE back.
        let result = replace_messages_tx(&pool, "s1", &[msg("new-a", 0), msg("new-b", 0)]).await;
        assert!(result.is_err());
        // Original history intact (DELETE rolled back, not half-applied).
        assert_eq!(count(&pool, "s1").await, 2);
        let ids: Vec<(String,)> =
            sqlx::query_as("SELECT id FROM messages WHERE session_id = ? ORDER BY seq")
                .bind("s1")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            ids.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(),
            vec!["orig-a", "orig-b"]
        );
    }

    #[tokio::test]
    async fn touches_only_the_target_session() {
        let pool = setup().await;
        replace_messages_tx(&pool, "s1", &[msg("a", 0)]).await.unwrap();
        replace_messages_tx(&pool, "s2", &[msg("b", 0)]).await.unwrap();
        replace_messages_tx(&pool, "s1", &[]).await.unwrap(); // clear s1
        assert_eq!(count(&pool, "s1").await, 0);
        assert_eq!(count(&pool, "s2").await, 1); // s2 untouched
    }
}
