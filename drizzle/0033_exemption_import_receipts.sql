/* @Codex */
CREATE TABLE IF NOT EXISTS exemption_import_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    operation_key TEXT NOT NULL UNIQUE,
    receipt_json TEXT NOT NULL
);
