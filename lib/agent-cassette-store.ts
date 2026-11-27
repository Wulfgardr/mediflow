import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { validAgentOperations, type AgentPrincipal } from './agent-pairing-store';
import type { AgentOperation } from './agent-mandate-contract';
import { createAgentMandateStore } from './agent-mandate-store';
import { createAgentRegistrationStore } from './agent-registration-store';
import { AGENT_ITEM_OPERATION, cassetteItems, validAgentCassetteItem, type AgentCassette } from './agent-cassette-contract';
import { isAgentId, validAgentEnvelope } from './agent-cassette-crypto';
import type { AgentCassetteIndexEntry, AgentCassetteIndexPage, AgentCassetteReviewBlock } from './agent-visit-application-contract';

export const AGENT_CASSETTE_COMPLETE = 'cassette_complete';
const correctionOpened = 'agent.cassette.correction.opened';
const superseded = 'agent.cassette.superseded';

export class AgentCassetteDenied extends Error {
    constructor(readonly status: 400 | 403 | 404 | 409) { super('AGENT_CASSETTE_DENIED'); }
}
const projection = `id,mandate_ref AS mandateRef,agent_ref AS agentRef,actor_ref AS actorRef,archive_generation AS archiveGeneration,
    public_key AS publicKey,wrapped_private_key AS wrappedPrivateKey,model_provider AS modelProvider,allows_clinical_egress AS allowsClinicalEgress,
    anchor_ciphertext AS anchorCiphertext,items_ciphertext AS itemsCiphertext,status,revision,deposited_at AS depositedAt,modified_at AS modifiedAt`;
function pendingCassetteVisibility() {
    return `NOT EXISTS (
        SELECT 1 FROM audit_events AS event
        WHERE event.actor_ref=cassette.actor_ref AND event.subject_ref=cassette.id
        AND event.subject_type='agent_operation' AND event.proposer_ref=cassette.agent_ref
        AND event.outcome='success' AND event.source_surface='agent'
        AND (event.event_type='${superseded}' OR (cassette.status='open' AND event.event_type='${correctionOpened}'))
    )`;
}

export function readAgentCassette(database: Database.Database, id: string, actorRef: string): AgentCassette | undefined {
    return database.prepare(`SELECT ${projection} FROM agent_cassettes AS cassette
        WHERE id=? AND actor_ref=? AND ${pendingCassetteVisibility()}`).get(id, actorRef) as AgentCassette | undefined;
}
export function agentCassetteReviewBlock(database: Database.Database, cassette: AgentCassette): AgentCassetteReviewBlock | undefined {
    if (cassette.status !== 'closed') return;
    const mandate = createAgentMandateStore(database).read(cassette.mandateRef);
    const closed = database.prepare(`SELECT occurred_at AS at FROM audit_events
        WHERE event_type='agent.cassette.closed' AND subject_type='agent_operation' AND subject_ref=?
        AND actor_ref=? AND proposer_ref=? AND mandate_ref=? AND model_provider=? AND outcome='success' AND source_surface='agent'`)
        .get(cassette.id, cassette.actorRef, cassette.agentRef, cassette.mandateRef, cassette.modelProvider) as { at: number } | undefined;
    if (!mandate || !closed || mandate.actorRef !== cassette.actorRef || mandate.archiveGeneration !== cassette.archiveGeneration
        || mandate.provider !== cassette.modelProvider || Number(mandate.allowsClinicalEgress) !== cassette.allowsClinicalEgress
        || mandate.publicKey !== cassette.publicKey || mandate.wrappedPrivateKey !== cassette.wrappedPrivateKey
        || cassette.depositedAt < mandate.createdAt || cassette.modifiedAt < cassette.depositedAt || closed.at < cassette.modifiedAt
        || cassette.modifiedAt >= mandate.expiresAt
        || (mandate.revokedAt !== null && cassette.modifiedAt > mandate.revokedAt)) return 'deposit_unverified';
    const legacy = database.prepare('SELECT revoked_at AS revokedAt,expires_at AS expiresAt,operations FROM agent_clients WHERE id=? AND mandate_ref=?')
        .get(cassette.agentRef, cassette.mandateRef) as { revokedAt: number | null; expiresAt: number; operations: string } | undefined;
    const client = legacy ?? createAgentRegistrationStore(database).registrationForCassette(cassette.agentRef, cassette.mandateRef);
    if (!client || (legacy && legacy.expiresAt <= cassette.modifiedAt)) return 'deposit_unverified';
    if (client.revokedAt !== null) return 'agent_revoked';
    const operations: unknown = JSON.parse(client.operations);
    const required = ['visita.apri', 'visita.chiudi', ...cassetteItems(cassette).map(item => AGENT_ITEM_OPERATION[item.kind])] as const;
    if (!validAgentOperations(operations) || !required.every(operation => operations.includes(operation) && mandate.operations.includes(operation))) {
        return 'deposit_unverified';
    }
}
export function readAgentCassetteIndex(database: Database.Database, actorRef: string, after: string | null): AgentCassetteIndexPage {
    const pageSize = 64;
    const rows = database.prepare(`SELECT cassette.id, cassette.archive_generation AS archiveGeneration, cassette.status,
        cassette.revision, cassette.deposited_at AS depositedAt
        FROM agent_cassettes AS cassette WHERE cassette.actor_ref=? AND ${pendingCassetteVisibility()}
        AND (? IS NULL OR (cassette.deposited_at, cassette.id) >
            (SELECT cursor.deposited_at, cursor.id FROM agent_cassettes AS cursor WHERE cursor.actor_ref=? AND cursor.id=?))
        AND NOT EXISTS (
            SELECT 1 FROM audit_events AS event
            WHERE event.actor_ref=cassette.actor_ref
            AND event.subject_type='agent_operation' AND event.subject_ref=cassette.id
            AND event.proposer_ref=cassette.agent_ref AND event.mandate_ref=cassette.mandate_ref
            AND event.outcome='success' AND event.source_surface='agent'
            AND (event.event_type='agent.visit.decided' OR (event.event_type='agent.visit.applied' AND EXISTS (SELECT 1 FROM json_each(
                CASE WHEN json_valid(event.redacted_metadata) THEN event.redacted_metadata ELSE '{}' END, '$.flags'
            ) WHERE value=?)))
        ) ORDER BY cassette.deposited_at, cassette.id LIMIT ?`).all(actorRef, after, actorRef, after, AGENT_CASSETTE_COMPLETE, pageSize + 1) as AgentCassetteIndexEntry[];
    const visits = rows.slice(0, pageSize);
    return { visits, next: rows.length > pageSize ? visits.at(-1)!.id : null };
}
export function createAgentCassetteStore(database: Database.Database, now = Date.now) {
    function admit(principal: AgentPrincipal, operation: AgentOperation) {
        if (!database.inTransaction) throw new AgentCassetteDenied(403);
        const mandate = createAgentMandateStore(database, now).admit(principal.mandateRef, operation);
        if (principal.actorRef !== mandate.actorRef || principal.archiveGeneration !== mandate.archiveGeneration || !principal.operations.includes(operation)) throw new AgentCassetteDenied(403);
        return mandate;
    }
    function read(id: string, principal: AgentPrincipal): AgentCassette {
        const value = database.prepare(`SELECT ${projection} FROM agent_cassettes WHERE id=? AND actor_ref=?`).get(id, principal.actorRef) as AgentCassette | undefined;
        if (!value || value.agentRef !== principal.agentRef || value.mandateRef !== principal.mandateRef || value.archiveGeneration !== principal.archiveGeneration) throw new AgentCassetteDenied(404);
        return value;
    }
    function receipt(cassette: AgentCassette) {
        return { visitId: cassette.id, mandateRef: cassette.mandateRef, agentRef: cassette.agentRef, status: cassette.status,
            revision: cassette.revision, itemCount: cassetteItems(cassette).length, modelProvider: cassette.modelProvider, allowsClinicalEgress: Boolean(cassette.allowsClinicalEgress) };
    }
    function predecessor(cassette: AgentCassette) {
        const event = database.prepare(`SELECT request_id AS previousId FROM audit_events
            WHERE event_type=? AND subject_type='agent_operation' AND subject_ref=? AND actor_ref=?
            AND proposer_ref=? AND outcome='success' AND source_surface='agent'`)
            .get(correctionOpened, cassette.id, cassette.actorRef, cassette.agentRef) as { previousId: string } | undefined;
        return event?.previousId;
    }
    function requirePendingPredecessor(principal: AgentPrincipal, id: string) {
        const previous = readAgentCassette(database, id, principal.actorRef);
        if (!previous || previous.agentRef !== principal.agentRef || previous.archiveGeneration !== principal.archiveGeneration) throw new AgentCassetteDenied(404);
        const applied = database.prepare(`SELECT 1 FROM audit_events
            WHERE event_type='agent.item.applied' AND request_id=? AND actor_ref=? AND proposer_ref=?
            AND outcome='success' AND source_surface='agent'`).get(id, principal.actorRef, principal.agentRef);
        if (previous.status !== 'closed' || applied) throw new AgentCassetteDenied(409);
    }
    function audit(principal: AgentPrincipal, event: string, id: string, relatedVisitId: string | null = null) {
        const time = now();
        const result = database.prepare(`INSERT INTO audit_events(event_id,schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,proposer_ref,mandate_ref,model_provider,created_at,request_id)
            VALUES (?,1,?,?,'success','user',?,'agent_operation',?,'agent',?,?,?,?,?)`).run(randomUUID(), event, time, principal.actorRef, id, principal.agentRef, principal.mandateRef, principal.modelProvider, Math.floor(time / 1000), relatedVisitId);
        if (result.changes !== 1) throw new AgentCassetteDenied(409);
    }
    return {
        open(principal: AgentPrincipal, id: string, anchor: unknown, replaces?: unknown) {
            const mandate = admit(principal, 'visita.apri');
            if (!isAgentId(id) || !validAgentEnvelope(anchor) || JSON.stringify(anchor).length > 8192) throw new AgentCassetteDenied(400);
            if (replaces !== undefined && (!isAgentId(replaces) || replaces === id)) throw new AgentCassetteDenied(400);
            if (database.prepare('SELECT 1 FROM agent_cassettes WHERE id=?').get(id)) {
                const existing = read(id, principal);
                if (existing.anchorCiphertext !== JSON.stringify(anchor) || predecessor(existing) !== replaces) throw new AgentCassetteDenied(409);
                return receipt(existing);
            }
            if (replaces !== undefined) {
                admit(principal, 'visita.chiudi');
                requirePendingPredecessor(principal, replaces);
            }
            const time = now();
            const result = database.prepare(`INSERT INTO agent_cassettes(id,mandate_ref,agent_ref,actor_ref,archive_generation,public_key,wrapped_private_key,model_provider,allows_clinical_egress,anchor_ciphertext,items_ciphertext,status,revision,deposited_at,modified_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,'[]','open',1,?,?)`).run(id, mandate.id, principal.agentRef, principal.actorRef, principal.archiveGeneration,
                    mandate.publicKey, mandate.wrappedPrivateKey, mandate.provider, Number(mandate.allowsClinicalEgress), JSON.stringify(anchor), time, time);
            if (result.changes !== 1) throw new AgentCassetteDenied(409);
            audit(principal, 'agent.cassette.opened', id);
            if (replaces !== undefined) audit(principal, correctionOpened, id, replaces);
            return receipt(read(id, principal));
        },
        add(principal: AgentPrincipal, id: string, expectedRevision: number, item: unknown) {
            if (!validAgentCassetteItem(item)) throw new AgentCassetteDenied(400);
            admit(principal, AGENT_ITEM_OPERATION[item.kind]);
            const current = read(id, principal), items = cassetteItems(current), existing = items.find(value => value.id === item.id);
            if (existing) {
                if (JSON.stringify(existing) !== JSON.stringify(item)) throw new AgentCassetteDenied(409);
                return receipt(current);
            }
            if (current.status !== 'open' || current.revision !== expectedRevision || !Number.isSafeInteger(expectedRevision)) throw new AgentCassetteDenied(409);
            const next = [...items, item]; cassetteItems({ itemsCiphertext: JSON.stringify(next) });
            const result = database.prepare("UPDATE agent_cassettes SET items_ciphertext=?,revision=revision+1,modified_at=? WHERE id=? AND revision=? AND status='open'")
                .run(JSON.stringify(next), now(), id, expectedRevision);
            if (result.changes !== 1) throw new AgentCassetteDenied(409);
            audit(principal, 'agent.item.deposited', id); return receipt(read(id, principal));
        },
        close(principal: AgentPrincipal, id: string, expectedRevision: number) {
            admit(principal, 'visita.chiudi'); const current = read(id, principal);
            if (!Number.isSafeInteger(expectedRevision)) throw new AgentCassetteDenied(400);
            if (current.status === 'closed' && current.revision === expectedRevision + 1) return receipt(current);
            if (current.status !== 'open' || current.revision !== expectedRevision || !cassetteItems(current).length) throw new AgentCassetteDenied(409);
            const replaces = predecessor(current);
            if (replaces) requirePendingPredecessor(principal, replaces);
            const result = database.prepare("UPDATE agent_cassettes SET status='closed',revision=revision+1,modified_at=? WHERE id=? AND revision=? AND status='open'").run(now(), id, expectedRevision);
            if (result.changes !== 1) throw new AgentCassetteDenied(409);
            audit(principal, 'agent.cassette.closed', id);
            if (replaces) audit(principal, superseded, replaces, id);
            return receipt(read(id, principal));
        },
    };
}
