/* @Codex */

CREATE TABLE IF NOT EXISTS prosthetics_catalog_entries (
    id TEXT PRIMARY KEY NOT NULL,
    code_system TEXT NOT NULL, code TEXT NOT NULL, description TEXT NOT NULL,
    version TEXT NOT NULL, source TEXT NOT NULL, scope TEXT NOT NULL,
    start_date TEXT, end_date TEXT,
    source_sha256 TEXT NOT NULL, operation_key TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prosthetics_catalog_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    operation_key TEXT NOT NULL UNIQUE, receipt_json TEXT NOT NULL
);
