-- Multi-provider foundation (BACKLOG #12.A): track committed provider per
-- session row so resume requires both provider and model to match.
-- SQLite ALTER TABLE ADD COLUMN does not accept non-constant defaults, so we
-- add the column nullable then UPDATE existing rows to backfill 'anthropic'
-- (the only provider that shipped before this migration).

ALTER TABLE sessions ADD COLUMN main_provider TEXT;

UPDATE sessions SET main_provider = 'anthropic' WHERE main_provider IS NULL;
