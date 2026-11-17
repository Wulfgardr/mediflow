import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AGENT_OPERATIONS, type AgentOperation } from './agent-mandate-contract';
import { AgentMandateDenied, createAgentMandateStore } from './agent-mandate-store';
import { readSqliteArchiveGeneration } from './archive-generation';

export type AgentPairingRequest = { id: string; code: string; name: string; operations: AgentOperation[]; createdAt: number; expiresAt: number;
    status: 'pending' | 'approved' | 'rejected'; mandateRef: string | null };
export type AgentPrincipal = { agentRef: string; mandateRef: string; actorRef: string; name: string; operations: AgentOperation[];
    expiresAt: number; modelProvider: 'openai' | 'anthropic' | 'local'; allowsClinicalEgress: boolean; publicKey: string; archiveGeneration: string };
const hash = (domain: string, value: string) => createHash('sha256').update(JSON.stringify([domain, value])).digest('hex');
const equalHash = (left: string, right: string) => /^[a-f0-9]{64}$/u.test(left) && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
const claimPattern = /^[A-Za-z0-9_-]{43}$/u;
const tokenPattern = /^mfa_[A-Za-z0-9_-]{43}$/u;
const tokenFor = (id: string, claim: string) => 'mfa_' + createHash('sha256').update(JSON.stringify(['mediflow.agent.token.v1', id, claim])).digest('base64url');
const requestProjection = `id,code,name,operations,created_at AS createdAt,expires_at AS expiresAt,status,mandate_ref AS mandateRef`;
function requestFrom(row: unknown): AgentPairingRequest | null {
    if (!row) return null;
    const value = row as Omit<AgentPairingRequest, 'operations'> & { operations: string };
    return { ...value, operations: JSON.parse(value.operations) };
}
export function validAgentOperations(value: unknown): value is AgentOperation[] {
    return Array.isArray(value) && value.length > 0 && value.length <= AGENT_OPERATIONS.length
        && new Set(value).size === value.length && value.every(operation => AGENT_OPERATIONS.includes(operation));
}
function audit(database: Database.Database, actor: string, ref: string, event: string, now: number): void {
    database.prepare(`INSERT INTO audit_events(event_id,schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,created_at)
        VALUES (?,1,?,?,'success','user',?,'agent_operation',?,'web',?)`).run(randomUUID(), event, now, actor, ref, Math.floor(now / 1000));
}
export function createAgentPairingStore(database: Database.Database, now = Date.now) {
    const mandates = createAgentMandateStore(database, now);
    return {
        request(name: unknown, operations: unknown) {
            if (typeof name !== 'string' || name.trim() !== name || !name.length || name.length > 80 || /[\x00-\x1f\x7f]/u.test(name)
                || !validAgentOperations(operations)) throw new AgentMandateDenied();
            const id = randomUUID(), claim = randomBytes(32).toString('base64url');
            const code = randomBytes(5).toString('hex').slice(0, 8).toUpperCase();
            const createdAt = now();
            const inserted = database.prepare(`INSERT INTO agent_pairing_requests(id,code,name,operations,claim_hash,created_at,expires_at,status)
                VALUES (?,?,?,?,?,?,?,'pending')`).run(id, code, name, JSON.stringify(operations), hash('mediflow.agent.claim.v1', claim), createdAt, createdAt + 300000);
            if (inserted.changes !== 1) throw new AgentMandateDenied();
            return { request: { id, code, name, operations, createdAt, expiresAt: createdAt + 300000, status: 'pending' as const, mandateRef: null }, claim };
        },
        pending() {
            return database.prepare(`SELECT ${requestProjection} FROM agent_pairing_requests WHERE status='pending' AND expires_at>? ORDER BY created_at`).all(now()).map(row => requestFrom(row)!);
        },
        approve(id: string, code: string, mandateRef: string, actorRef: string, generation: string) {
            return database.transaction(() => {
                const request = requestFrom(database.prepare(`SELECT ${requestProjection} FROM agent_pairing_requests WHERE id=?`).get(id));
                if (!request || request.status !== 'pending' || request.code !== code || request.expiresAt <= now()
                    || request.createdAt > now() || generation !== readSqliteArchiveGeneration(database)) throw new AgentMandateDenied();
                const mandate = mandates.admit(mandateRef, request.operations[0]!);
                if (mandate.actorRef !== actorRef || !request.operations.every(operation => mandate.operations.includes(operation))) throw new AgentMandateDenied();
                const approved = database.prepare("UPDATE agent_pairing_requests SET status='approved',mandate_ref=? WHERE id=? AND status='pending'").run(mandate.id, request.id);
                if (approved.changes !== 1) throw new AgentMandateDenied();
                audit(database, actorRef, request.id, 'agent.client.approved', now());
                return { requestId: request.id, agentRef: request.id, mandateRef: mandate.id, status: 'approved' as const, expiresAt: mandate.expiresAt };
            }).immediate();
        },
        poll(id: string, claim: string) {
            if (!claimPattern.test(claim)) throw new AgentMandateDenied();
            return database.transaction(() => {
                const row = database.prepare(`SELECT ${requestProjection},claim_hash AS claimHash FROM agent_pairing_requests WHERE id=?`).get(id) as { claimHash: string } | undefined;
                const request = requestFrom(row);
                if (!row || !request || !equalHash(row.claimHash, hash('mediflow.agent.claim.v1', claim))
                    || request.expiresAt <= now() || request.createdAt > now() || request.status === 'rejected') throw new AgentMandateDenied();
                if (request.status !== 'approved' || !request.mandateRef) return { receipt: { requestId: request.id, status: 'pending' as const }, credential: null };
                const mandate = mandates.admit(request.mandateRef, request.operations[0]!);
                const token = tokenFor(request.id, claim);
                const existing = database.prepare('SELECT token_hash AS tokenHash,revoked_at AS revokedAt FROM agent_clients WHERE id=?').get(request.id) as { tokenHash: string; revokedAt: number | null } | undefined;
                if (existing && (existing.revokedAt !== null || !equalHash(existing.tokenHash, hash('mediflow.agent.bearer.v1', token)))) throw new AgentMandateDenied();
                if (!existing) {
                    const issued = database.prepare('INSERT INTO agent_clients(id,mandate_ref,name,operations,token_hash,expires_at) VALUES (?,?,?,?,?,?)')
                    .run(request.id, mandate.id, request.name, JSON.stringify(request.operations), hash('mediflow.agent.bearer.v1', token), mandate.expiresAt);
                    if (issued.changes !== 1) throw new AgentMandateDenied();
                }
                return { receipt: { requestId: request.id, agentRef: request.id, mandateRef: mandate.id, status: 'approved' as const, expiresAt: mandate.expiresAt },
                    credential: { token, expiresAt: mandate.expiresAt } };
            }).immediate();
        },
        principal(token: string): AgentPrincipal | null {
            if (!tokenPattern.test(token) || !database.inTransaction) return null;
            const row = database.prepare('SELECT id,mandate_ref AS mandateRef,name,operations,expires_at AS expiresAt,revoked_at AS revokedAt FROM agent_clients WHERE token_hash=?')
                .get(hash('mediflow.agent.bearer.v1', token)) as { id: string; mandateRef: string; name: string; operations: string; expiresAt: number; revokedAt: number | null } | undefined;
            if (!row || row.revokedAt !== null || row.expiresAt <= now()) return null;
            try {
                const operations = JSON.parse(row.operations) as AgentOperation[];
                if (!validAgentOperations(operations)) return null;
                const mandate = mandates.admit(row.mandateRef, operations[0]!);
                if (row.expiresAt > mandate.expiresAt || !operations.every(operation => mandate.operations.includes(operation))) return null;
                return { agentRef: row.id, mandateRef: mandate.id, actorRef: mandate.actorRef, name: row.name, operations, expiresAt: row.expiresAt,
                    modelProvider: mandate.provider, allowsClinicalEgress: mandate.allowsClinicalEgress, publicKey: mandate.publicKey, archiveGeneration: mandate.archiveGeneration };
            } catch { return null; }
        },
    };
}
