import type Database from 'better-sqlite3';

export function ensureAgentRegistrationSchema(database: Database.Database): void {
    database.exec(`CREATE TABLE IF NOT EXISTS agent_registrations (
        id TEXT PRIMARY KEY NOT NULL REFERENCES agent_pairing_requests(id) ON DELETE CASCADE,
        template_ref TEXT NOT NULL REFERENCES agent_mandates(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE CHECK (length(token_hash)=64),
        current_mandate_ref TEXT REFERENCES agent_mandates(id) ON DELETE SET NULL,
        revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS agent_unlock_grants (
        mandate_ref TEXT PRIMARY KEY NOT NULL REFERENCES agent_mandates(id) ON DELETE CASCADE,
        agent_ref TEXT NOT NULL REFERENCES agent_registrations(id) ON DELETE CASCADE,
        unlock_ref TEXT NOT NULL,
        token_hash TEXT UNIQUE CHECK (length(token_hash)=64),
        UNIQUE(agent_ref, unlock_ref)
    )`);
}
