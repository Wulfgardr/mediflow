import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentPrincipal } from './agent-pairing-store';
import type { AgentOperation } from './agent-mandate-contract';
import { createAgentMandateStore } from './agent-mandate-store';
import { AGENT_ITEM_OPERATION, cassetteItems, validAgentCassetteItem, type AgentCassette } from './agent-cassette-contract';
import { isAgentId, validAgentEnvelope } from './agent-cassette-crypto';

export class AgentCassetteDenied extends Error {
    constructor(readonly status: 400 | 403 | 404 | 409) { super('AGENT_CASSETTE_DENIED'); }
}
const projection = `id,mandate_ref AS mandateRef,agent_ref AS agentRef,actor_ref AS actorRef,archive_generation AS archiveGeneration,
    public_key AS publicKey,wrapped_private_key AS wrappedPrivateKey,model_provider AS modelProvider,allows_clinical_egress AS allowsClinicalEgress,
    anchor_ciphertext AS anchorCiphertext,items_ciphertext AS itemsCiphertext,status,revision,deposited_at AS depositedAt,modified_at AS modifiedAt`;
export function readAgentCassettes(database: Database.Database): AgentCassette[] {
    return database.prepare(`SELECT ${projection} FROM agent_cassettes ORDER BY deposited_at,id`).all() as AgentCassette[];
}
export function createAgentCassetteStore(database: Database.Database, now = Date.now) {
    function admit(principal: AgentPrincipal, operation: AgentOperation) {
        if (!database.inTransaction) throw new AgentCassetteDenied(403);
        const mandate = createAgentMandateStore(database, now).admit(principal.mandateRef, operation);
        if (principal.actorRef !== mandate.actorRef || principal.archiveGeneration !== mandate.archiveGeneration || !principal.operations.includes(operation)) throw new AgentCassetteDenied(403);
        return mandate;
    }
    function read(id: string, principal: AgentPrincipal): AgentCassette {
        const value = database.prepare(`SELECT ${projection} FROM agent_cassettes WHERE id=?`).get(id) as AgentCassette | undefined;
        if (!value || value.agentRef !== principal.agentRef || value.mandateRef !== principal.mandateRef || value.archiveGeneration !== principal.archiveGeneration) throw new AgentCassetteDenied(404);
        return value;
    }
    function receipt(cassette: AgentCassette) {
        return { visitId: cassette.id, mandateRef: cassette.mandateRef, agentRef: cassette.agentRef, status: cassette.status,
            revision: cassette.revision, itemCount: cassetteItems(cassette).length, modelProvider: cassette.modelProvider, allowsClinicalEgress: Boolean(cassette.allowsClinicalEgress) };
    }
    function audit(principal: AgentPrincipal, event: string, id: string) {
        const time = now();
        const result = database.prepare(`INSERT INTO audit_events(event_id,schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,subject_type,subject_ref,source_surface,proposer_ref,mandate_ref,model_provider,created_at)
            VALUES (?,1,?,?,'success','user',?,'agent_operation',?,'agent',?,?,?,?)`).run(randomUUID(), event, time, principal.actorRef, id, principal.agentRef, principal.mandateRef, principal.modelProvider, Math.floor(time / 1000));
        if (result.changes !== 1) throw new AgentCassetteDenied(409);
    }
    return {
        open(principal: AgentPrincipal, id: string, anchor: unknown) {
            const mandate = admit(principal, 'visita.apri');
            if (!isAgentId(id) || !validAgentEnvelope(anchor) || JSON.stringify(anchor).length > 8192) throw new AgentCassetteDenied(400);
            if (database.prepare('SELECT 1 FROM agent_cassettes WHERE id=?').get(id)) {
                const existing = read(id, principal);
                if (existing.anchorCiphertext !== JSON.stringify(anchor)) throw new AgentCassetteDenied(409);
                return receipt(existing);
            }
            const time = now();
            const result = database.prepare(`INSERT INTO agent_cassettes(id,mandate_ref,agent_ref,actor_ref,archive_generation,public_key,wrapped_private_key,model_provider,allows_clinical_egress,anchor_ciphertext,items_ciphertext,status,revision,deposited_at,modified_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,'[]','open',1,?,?)`).run(id, mandate.id, principal.agentRef, principal.actorRef, principal.archiveGeneration,
                    mandate.publicKey, mandate.wrappedPrivateKey, mandate.provider, Number(mandate.allowsClinicalEgress), JSON.stringify(anchor), time, time);
            if (result.changes !== 1) throw new AgentCassetteDenied(409);
            audit(principal, 'agent.cassette.opened', id); return receipt(read(id, principal));
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
            const result = database.prepare("UPDATE agent_cassettes SET status='closed',revision=revision+1,modified_at=? WHERE id=? AND revision=? AND status='open'").run(now(), id, expectedRevision);
            if (result.changes !== 1) throw new AgentCassetteDenied(409);
            audit(principal, 'agent.cassette.closed', id); return receipt(read(id, principal));
        },
    };
}
