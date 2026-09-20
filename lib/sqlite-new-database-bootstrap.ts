/* @Codex */
import type Database from 'better-sqlite3';

/* @Codex */
const NEW_DATABASE_BASE_SCHEMA = `
CREATE TABLE ambulatories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    parent_id TEXT,
    type TEXT DEFAULT 'live',
    description TEXT,
    is_default INTEGER DEFAULT false,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE patients (
    id TEXT PRIMARY KEY NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    tax_code TEXT NOT NULL,
    birth_date INTEGER,
    address TEXT,
    phone TEXT,
    caregiver TEXT,
    notes TEXT,
    ai_summary TEXT,
    document_insights TEXT,
    is_adi INTEGER DEFAULT false,
    is_archived INTEGER DEFAULT false,
    ambulatory_id TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (ambulatory_id) REFERENCES ambulatories(id) ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    ambulatory_name TEXT,
    role TEXT DEFAULT 'user',
    password_hash TEXT NOT NULL,
    encrypted_master_key TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX users_username_unique ON users (username);

CREATE TABLE patients_to_ambulatories (
    patient_id TEXT NOT NULL,
    ambulatory_id TEXT NOT NULL,
    assigned_at INTEGER DEFAULT (unixepoch()),
    PRIMARY KEY (patient_id, ambulatory_id),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE NO ACTION ON DELETE CASCADE,
    FOREIGN KEY (ambulatory_id) REFERENCES ambulatories(id) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE attachments (
    id TEXT PRIMARY KEY NOT NULL,
    patient_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    data TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE checkups (
    id TEXT PRIMARY KEY NOT NULL,
    patient_id TEXT NOT NULL,
    date INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE conversations (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch()),
    is_archived INTEGER DEFAULT false,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE drugs (
    aic TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    active_principle TEXT,
    company TEXT,
    packaging TEXT,
    class TEXT,
    price INTEGER,
    atc TEXT
);

CREATE TABLE entries (
    id TEXT PRIMARY KEY NOT NULL,
    patient_id TEXT NOT NULL,
    type TEXT NOT NULL,
    date INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    attachment_type TEXT,
    attachment_base64 TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE therapies (
    id TEXT PRIMARY KEY NOT NULL,
    patient_id TEXT NOT NULL,
    drug_name TEXT NOT NULL,
    dosage TEXT NOT NULL,
    status TEXT NOT NULL,
    start_date INTEGER NOT NULL,
    end_date INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON UPDATE NO ACTION ON DELETE NO ACTION
);
`;

/* @Codex */
export function bootstrapEmptySqliteDatabase(connection: Database.Database): boolean {
    // GLOB keeps the underscore literal; LIKE would also exclude sqliteX... tables.
    const existingTable = connection
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' LIMIT 1")
        .get();
    if (existingTable) return false;

    connection.exec(NEW_DATABASE_BASE_SCHEMA);
    return true;
}
