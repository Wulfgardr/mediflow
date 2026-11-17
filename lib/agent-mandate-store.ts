import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readSqliteArchiveGeneration, ArchiveReplacedError } from './archive-generation';
import { validMandateInput, type AgentMandate, type AgentMandateInput, type AgentOperation } from './agent-mandate-contract';

export class AgentMandateDenied extends Error {
    constructor() { super('AGENT_MANDATE_DENIED'); }
}
const projection = `id, actor_ref AS actorRef, archive_generation AS archiveGeneration, operations, provider,
    allows_clinical_egress AS allowsClinicalEgress, public_key AS publicKey, wrapped_private_key AS wrappedPrivateKey,
    created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt`;
function decode(row: unknown): AgentMandate | null {
    if (!row) return null;
    const value = row as Omit<AgentMandate, 'operations' | 'allowsClinicalEgress'> & { operations: string; allowsClinicalEgress: number };
    return { ...value, operations: JSON.parse(value.operations), allowsClinicalEgress: value.allowsClinicalEgress === 1 };
}
function audit(transaction: Database.Database, actorRef: string, id: string, event: string, now: number): void {
    transaction.prepare(`INSERT INTO audit_events (event_id,schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,
        subject_type,subject_ref,source_surface,request_id,redacted_metadata,created_at)
        VALUES (?,1,?,?,'success','user',?,'agent_operation',?,'web',NULL,NULL,?)`)
        .run(randomUUID(), event, now, actorRef, id, Math.floor(now / 1000));
}
export function createAgentMandateStore(transaction: Database.Database, now = Date.now) {
    return {
        create(input: AgentMandateInput, actorRef: string, generation: string): AgentMandate {
            if (!validMandateInput(input)) throw new AgentMandateDenied();
            return transaction.transaction(() => {
                if (readSqliteArchiveGeneration(transaction) !== generation) throw new ArchiveReplacedError();
                const createdAt = now();
                transaction.prepare(`INSERT INTO agent_mandates (id,actor_ref,archive_generation,operations,provider,allows_clinical_egress,
                    public_key,wrapped_private_key,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
                    .run(input.id, actorRef, generation, JSON.stringify(input.operations), input.provider, Number(input.allowsClinicalEgress),
                        input.publicKey, input.wrappedPrivateKey, createdAt, createdAt + input.durationMs);
                audit(transaction, actorRef, input.id, 'agent.mandate.created', createdAt);
                return this.read(input.id)!;
            }).immediate();
        },
        read(id: string): AgentMandate | null {
            return decode(transaction.prepare(`SELECT ${projection} FROM agent_mandates WHERE id=?`).get(id));
        },
        list(actorRef: string): AgentMandate[] {
            const generation = readSqliteArchiveGeneration(transaction);
            return transaction.prepare(`SELECT ${projection} FROM agent_mandates WHERE actor_ref=? AND archive_generation=? ORDER BY created_at DESC`)
                .all(actorRef, generation).map(row => decode(row)!);
        },
        admit(id: string, operation: AgentOperation): AgentMandate {
            if (!transaction.inTransaction) throw new AgentMandateDenied();
            const mandate = this.read(id);
            if (!mandate || mandate.revokedAt !== null || mandate.expiresAt <= now() || mandate.createdAt > now()
                || mandate.archiveGeneration !== readSqliteArchiveGeneration(transaction) || !mandate.operations.includes(operation)
                || !transaction.prepare('SELECT 1 FROM users WHERE id=?').get(mandate.actorRef)) throw new AgentMandateDenied();
            return mandate;
        },
        revoke(id: string, actorRef: string, generation: string): void {
            transaction.transaction(() => {
                if (readSqliteArchiveGeneration(transaction) !== generation) throw new ArchiveReplacedError();
                const mandate = this.read(id);
                if (!mandate || mandate.actorRef !== actorRef || mandate.archiveGeneration !== generation) throw new AgentMandateDenied();
                if (mandate.revokedAt !== null) return;
                const timestamp = now();
                transaction.prepare('UPDATE agent_mandates SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(timestamp, id);
                audit(transaction, actorRef, id, 'agent.mandate.revoked', timestamp);
            }).immediate();
        },
        revokeAll(actorRef: string, generation: string): void {
            transaction.transaction(() => {
                for (const mandate of this.list(actorRef)) if (mandate.revokedAt === null) this.revoke(mandate.id, actorRef, generation);
            }).immediate();
        },
    };
}
