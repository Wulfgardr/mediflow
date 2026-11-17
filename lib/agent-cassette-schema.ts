import type Database from 'better-sqlite3';

export function ensureAgentCassetteSchema(database: Database.Database): void {
    database.exec(`CREATE TABLE IF NOT EXISTS agent_cassettes (
        id TEXT PRIMARY KEY NOT NULL,
        mandate_ref TEXT NOT NULL,
        agent_ref TEXT NOT NULL,
        actor_ref TEXT NOT NULL,
        archive_generation TEXT NOT NULL,
        public_key TEXT NOT NULL,
        wrapped_private_key TEXT NOT NULL CHECK (wrapped_private_key LIKE 'ENC:%'),
        model_provider TEXT NOT NULL CHECK (model_provider IN ('openai','anthropic','local')),
        allows_clinical_egress INTEGER NOT NULL CHECK (allows_clinical_egress IN (0,1)),
        anchor_ciphertext TEXT NOT NULL,
        items_ciphertext TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('open','closed')),
        revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 130),
        deposited_at INTEGER NOT NULL,
        modified_at INTEGER NOT NULL CHECK (modified_at>=deposited_at)
    )`);
}
