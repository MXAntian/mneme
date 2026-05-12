-- ============================================================
-- Migration 001: structured supersede field
-- Replaces ad-hoc "supersedes id:N" string conventions with a
-- structured column. Required prerequisite for migration 003's
-- prior_versions paper trail.
--
-- Reference: Mnemonic Sovereignty (arxiv 2604.16548) — closes the
-- "Forget" stage safety gap by making retraction explicit.
-- ============================================================

-- Add column: superseded_by points to memories.rowid (string form)
-- Nullable, no FK constraint (SQLite soft-link to avoid cascade complications)
ALTER TABLE memories ADD COLUMN superseded_by TEXT;

-- Index: only over "pending retirement" set (already superseded but not yet soft-deleted)
CREATE INDEX IF NOT EXISTS idx_mem_superseded_by
  ON memories(superseded_by)
  WHERE superseded_by IS NOT NULL AND deleted_at IS NULL;

-- Verify:
--   PRAGMA table_info(memories);  -- should see superseded_by at the end
--   SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mem_superseded_by';
