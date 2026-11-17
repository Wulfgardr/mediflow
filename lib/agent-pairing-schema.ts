import type Database from 'better-sqlite3';

export function ensureAgentPairingSchema(database: Database.Database): void {
    database.exec(`CREATE TABLE IF NOT EXISTS agent_pairing_requests (
        id TEXT PRIMARY KEY NOT NULL,
        code TEXT NOT NULL UNIQUE CHECK (length(code)=8),
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        operations TEXT NOT NULL,
        claim_hash TEXT NOT NULL CHECK (length(claim_hash)=64),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
        mandate_ref TEXT REFERENCES agent_mandates(id) ON DELETE CASCADE,
        CHECK (expires_at>created_at AND expires_at<=created_at+300000),
        CHECK ((status='approved' AND mandate_ref IS NOT NULL) OR (status!='approved' AND mandate_ref IS NULL))
    );
    CREATE TABLE IF NOT EXISTS agent_clients (
        id TEXT PRIMARY KEY NOT NULL REFERENCES agent_pairing_requests(id) ON DELETE CASCADE,
        mandate_ref TEXT NOT NULL REFERENCES agent_mandates(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        operations TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash)=64),
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
    )`);
}
