CREATE TABLE IF NOT EXISTS patient_duplicate_intents (
    id TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
