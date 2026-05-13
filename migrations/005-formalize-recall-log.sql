-- migration 005: formalize recall_log schema (2026-05-13)
--
-- Context:
--   recall_log table + final_hit_count column were originally added via bare
--   ALTER TABLE in initMemory() startup path (commits 3206eff + 2026-05-06 column
--   addition). The table+column were never reflected in schema.sql or migrations/,
--   resulting in a schema drift problem: fresh installs (or anyone reading
--   schema.sql as source of truth) would miss the table entirely.
--
--   This migration formalizes the table definition so:
--     1. schema.sql + migrations/ are the single source of truth
--     2. The startup `db.exec(CREATE TABLE IF NOT EXISTS recall_log ...)` in
--        initMemory() still works idempotently (no-ops when this migration
--        already created the table)
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS recall_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,                       -- call timestamp (ms since epoch)
  source TEXT NOT NULL DEFAULT 'unknown',    -- mcp / cli / prompt-recall-hook / tool-recall-hook / context-builder / unknown
  session_id TEXT,                           -- CC session id (hook path has it; mcp/cli generally NULL)
  query TEXT,                                -- query string (truncated to 200 chars)
  hit_ids TEXT,                              -- JSON array of rowid
  hit_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,                       -- recall duration (ms)
  filter_level TEXT,                         -- meta_knowledge / etc. (CSV when multiple)
  filter_min_importance INTEGER,
  query_path TEXT NOT NULL DEFAULT 'sync',   -- sync | hybrid | strict
  final_hit_count INTEGER                    -- post-filter真注入数 (written by hook via --update-recall-log)
);

CREATE INDEX IF NOT EXISTS idx_recall_log_ts ON recall_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_recall_log_source ON recall_log(source, ts DESC);
CREATE INDEX IF NOT EXISTS idx_recall_log_session
  ON recall_log(session_id, ts DESC)
  WHERE session_id IS NOT NULL;
