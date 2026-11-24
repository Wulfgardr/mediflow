import type Database from 'better-sqlite3';

export function ensureAgentMandateSchema(sqlite: Database.Database): void {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS agent_mandates (
        id TEXT PRIMARY KEY NOT NULL,
        actor_ref TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        archive_generation TEXT NOT NULL,
        operations TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'local')),
        allows_clinical_egress INTEGER NOT NULL CHECK (allows_clinical_egress IN (0,1)),
        public_key TEXT NOT NULL,
        wrapped_private_key TEXT NOT NULL CHECK (wrapped_private_key GLOB 'ENC:*'),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + 86400000),
        revoked_at INTEGER,
        CHECK (provider != 'local' OR allows_clinical_egress = 0),
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
    )`);
}
