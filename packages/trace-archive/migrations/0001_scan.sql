-- Trace discovery state is not an Event Ledger and cannot establish source coverage.
CREATE TABLE trace_scan (
  scope TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  cursor TEXT
);
CREATE TABLE trace_attempt (
  attempt_id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL,
  key_digest TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('verified', 'failed')),
  receipt TEXT
);
CREATE INDEX trace_attempt_scope_time ON trace_attempt(scope, attempted_at);
