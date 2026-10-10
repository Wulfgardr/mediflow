CREATE TABLE IF NOT EXISTS patient_retired_ids (
    id TEXT PRIMARY KEY NOT NULL,
    retired_at INTEGER NOT NULL DEFAULT (unixepoch())
);
