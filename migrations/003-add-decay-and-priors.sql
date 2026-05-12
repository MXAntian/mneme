-- ============================================================
-- Migration 003: memory decay + paper trail
-- Three mechanisms adapted to the memory health layer only:
--   1. Power-law decay (decay_score, periodically updated by runDecayCycle)
--   2. Surfaced random recall (cold pool, helper in index.mjs)
--   3. Paper trail on supersede (prior_versions, written by storeMemory)
--
-- Design notes:
--   1. SQLite has no JSONB type -> prior_versions stored as TEXT (JSON.stringify array)
--   2. Reuses existing access_count / last_accessed columns -- no duplicate counters
--   3. surfaced_random pool condition: importance >= 8 AND 30d untouched AND decay >= 0.3
--   4. Decay tau = 24h (configurable via runDecayCycle({ tauHours }))
--   5. Requires migration 001 (superseded_by column) -- paper trail piggybacks on
--      the existing soft-link mechanism.
-- ============================================================

-- 1. decay_score -- power-law decay weight (periodically updated; multiplied into recall score)
ALTER TABLE memories ADD COLUMN decay_score REAL NOT NULL DEFAULT 1.0;

-- 2. prior_versions -- paper trail; on supersede, push old content/summary/ts into this array
ALTER TABLE memories ADD COLUMN prior_versions TEXT NOT NULL DEFAULT '[]';

-- 3. Index for surfaced_random cold pool (small subset; index accelerates RANDOM() sampling)
CREATE INDEX IF NOT EXISTS idx_mem_surface_pool
  ON memories(importance, last_accessed, decay_score)
  WHERE deleted_at IS NULL AND superseded_by IS NULL AND importance >= 8;

-- Verify:
--   PRAGMA table_info(memories);
--   SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mem_surface_pool';
