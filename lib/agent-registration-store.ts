import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { readSqliteArchiveGeneration } from './archive-generation';
import { MANDATE_MAX_DURATION_MS, type AgentMandate, type AgentOperation } from './agent-mandate-contract';
import { AgentMandateDenied, createAgentMandateStore } from './agent-mandate-store';
import type { AgentPairingRequest, AgentPrincipal } from './agent-pairing-store';

export type AgentRegistration = {
    id: string;
    name: string;
    lastRenewalAt: number | null;
    revokedAt: number | null;
};

export const AGENT_REGISTRATION_TOKEN = /^mfr_[A-Za-z0-9_-]{43}$/u;
const digest = (domain: string, ...parts: string[]) => createHash('sha256').update(JSON.stringify([domain, ...parts]));
const storedToken = (token: string) => digest('mediflow.agent.registration.hash.v1', token).digest('hex');
const grantToken = (token: string, mandateRef: string) => 'mfa_' + digest('mediflow.agent.unlock.bearer.v1', token, mandateRef).digest('base64url');

const registrations = `FROM agent_registrations AS registration
    JOIN agent_pairing_requests AS pairing ON pairing.id=registration.id
    JOIN agent_mandates AS template ON template.id=registration.template_ref`;
const grants = `FROM agent_unlock_grants AS grant
    JOIN agent_registrations AS registration ON registration.id=grant.agent_ref
    JOIN agent_pairing_requests AS pairing ON pairing.id=registration.id`;
const grantProjection = `grant.agent_ref AS agentRef, grant.mandate_ref AS mandateRef, grant.unlock_ref AS unlockRef,
    pairing.name, pairing.operations`;
type Grant = { agentRef: string; mandateRef: string; unlockRef: string; name: string; operations: string };

export function createAgentRegistrationStore(database: Database.Database, now = Date.now) {
    const mandates = createAgentMandateStore(database, now);
    const generation = () => readSqliteArchiveGeneration(database);

    function actorUnlocked(actorRef: string): boolean {
        return Boolean(database.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND (locked_until IS NULL OR locked_until<=?)")
            .get(actorRef, Math.floor(now() / 1000)));
    }

    function written(result: Database.RunResult): void {
        if (result.changes !== 1) throw new AgentMandateDenied();
    }

    function audit(event: string, mandate: AgentMandate, agentRef: string, time: number): void {
        written(database.prepare(`INSERT INTO audit_events(event_id,schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,
            subject_type,subject_ref,source_surface,proposer_ref,mandate_ref,model_provider,created_at)
            VALUES (?,1,?,?,'success','user',?,'agent_operation',?,'web',?,?,?,?)`)
            .run(randomUUID(), event, time, mandate.actorRef, agentRef, agentRef, mandate.id, mandate.provider, Math.floor(time / 1000)));
    }

    function activePrincipal(grant: Grant, isUnlockActive: (ref: string, actorRef: string) => boolean): AgentPrincipal | null {
        const operations = JSON.parse(grant.operations) as AgentOperation[];
        const mandate = mandates.admit(grant.mandateRef, operations[0]!);
        if (!operations.every(operation => mandate.operations.includes(operation))
            || !actorUnlocked(mandate.actorRef) || !isUnlockActive(grant.unlockRef, mandate.actorRef)) return null;
        return { agentRef: grant.agentRef, mandateRef: mandate.id, actorRef: mandate.actorRef, name: grant.name, operations,
            expiresAt: mandate.expiresAt, modelProvider: mandate.provider, allowsClinicalEgress: mandate.allowsClinicalEgress,
            publicKey: mandate.publicKey, archiveGeneration: mandate.archiveGeneration };
    }

    return {
        register(request: AgentPairingRequest, template: AgentMandate): void {
            if (!database.inTransaction || !actorUnlocked(template.actorRef)) throw new AgentMandateDenied();
            written(database.prepare('INSERT INTO agent_registrations(id,template_ref) VALUES (?,?)').run(request.id, template.id));
            audit('agent.client.registered', template, request.id, now());
        },
        registrationCredential(id: string, claim: string): { token: string } | null {
            if (!database.inTransaction) throw new AgentMandateDenied();
            const row = database.prepare(`SELECT registration.revoked_at AS revokedAt, template.archive_generation AS archiveGeneration
                ${registrations} WHERE registration.id=?`).get(id) as { revokedAt: number | null; archiveGeneration: string } | undefined;
            if (!row) return null;
            if (row.revokedAt !== null || row.archiveGeneration !== generation()) throw new AgentMandateDenied();
            const token = 'mfr_' + digest('mediflow.agent.registration.v1', id, claim).digest('base64url');
            if (database.prepare(`UPDATE agent_registrations SET token_hash=? WHERE id=? AND (token_hash IS NULL OR token_hash=?)`)
                .run(storedToken(token), id, storedToken(token)).changes !== 1) throw new AgentMandateDenied();
            return { token };
        },
        hasActiveRegistration(actorRef: string, archiveGeneration: string): boolean {
            return Boolean(database.prepare(`SELECT 1 ${registrations}
                WHERE template.actor_ref=? AND template.archive_generation=? AND registration.revoked_at IS NULL LIMIT 1`)
                .get(actorRef, archiveGeneration));
        },
        list(actorRef: string): AgentRegistration[] {
            return database.prepare(`SELECT registration.id,pairing.name,registration.revoked_at AS revokedAt,current.created_at AS lastRenewalAt
                ${registrations} LEFT JOIN agent_mandates AS current ON current.id=registration.current_mandate_ref
                WHERE template.actor_ref=? AND template.archive_generation=? ORDER BY pairing.name, registration.id`)
                .all(actorRef, generation()) as AgentRegistration[];
        },
        revoke(id: string, actorRef: string, expectedGeneration: string): void {
            database.transaction(() => {
                const row = database.prepare(`SELECT registration.template_ref AS templateRef, registration.current_mandate_ref AS currentRef,
                    registration.revoked_at AS revokedAt ${registrations}
                    WHERE registration.id=? AND template.actor_ref=? AND template.archive_generation=?`)
                    .get(id, actorRef, expectedGeneration) as { templateRef: string; currentRef: string | null; revokedAt: number | null } | undefined;
                if (!row || expectedGeneration !== generation()) throw new AgentMandateDenied();
                if (row.revokedAt !== null) return;
                const time = now();
                written(database.prepare('UPDATE agent_registrations SET revoked_at=? WHERE id=?').run(time, id));
                audit('agent.client.revoked', mandates.read(row.currentRef ?? row.templateRef)!, id, time);
            }).immediate();
        },
        renew(actorRef: string, expectedGeneration: string, unlockRef: string): void {
            database.transaction(() => {
                if (generation() !== expectedGeneration || !actorUnlocked(actorRef)) throw new AgentMandateDenied();
                const rows = database.prepare(`SELECT registration.id, registration.template_ref AS templateRef, pairing.operations
                    ${registrations} WHERE template.actor_ref=? AND template.archive_generation=? AND registration.revoked_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM agent_unlock_grants WHERE agent_ref=registration.id AND unlock_ref=?)`)
                    .all(actorRef, expectedGeneration, unlockRef) as { id: string; templateRef: string; operations: string }[];
                for (const row of rows) {
                    const { provider, allowsClinicalEgress, publicKey, wrappedPrivateKey } = mandates.read(row.templateRef)!;
                    const mandate = mandates.create({ id: randomUUID(), durationMs: MANDATE_MAX_DURATION_MS, operations: JSON.parse(row.operations),
                        provider, allowsClinicalEgress, publicKey, wrappedPrivateKey }, actorRef, expectedGeneration);
                    written(database.prepare('INSERT INTO agent_unlock_grants(mandate_ref,agent_ref,unlock_ref) VALUES (?,?,?)')
                        .run(mandate.id, row.id, unlockRef));
                    written(database.prepare('UPDATE agent_registrations SET current_mandate_ref=? WHERE id=?').run(mandate.id, row.id));
                    audit('agent.mandate.renewed', mandate, row.id, mandate.createdAt);
                }
            }).immediate();
        },
        retrieve(token: string, isUnlockActive: (ref: string, actorRef: string) => boolean) {
            if (!AGENT_REGISTRATION_TOKEN.test(token)) throw new AgentMandateDenied();
            return database.transaction(() => {
                const grant = database.prepare(`SELECT ${grantProjection} ${grants}
                    WHERE registration.token_hash=? AND registration.revoked_at IS NULL AND registration.current_mandate_ref=grant.mandate_ref`)
                    .get(storedToken(token)) as Grant | undefined;
                const principal = grant && activePrincipal(grant, isUnlockActive);
                if (!principal) throw new AgentMandateDenied();
                const bearer = grantToken(token, principal.mandateRef);
                written(database.prepare('UPDATE agent_unlock_grants SET token_hash=? WHERE mandate_ref=?').run(storedToken(bearer), principal.mandateRef));
                return { agentRef: principal.agentRef, mandateRef: principal.mandateRef, issuedAt: mandates.read(principal.mandateRef)!.createdAt, expiresAt: principal.expiresAt, token: bearer };
            }).immediate();
        },
        principal(token: string, isUnlockActive: (ref: string, actorRef: string) => boolean): AgentPrincipal | null {
            if (!database.inTransaction) return null;
            const grant = database.prepare(`SELECT ${grantProjection} ${grants}
                WHERE grant.token_hash=? AND registration.revoked_at IS NULL AND registration.current_mandate_ref=grant.mandate_ref`)
                .get(storedToken(token)) as Grant | undefined;
            try { return grant ? activePrincipal(grant, isUnlockActive) : null; }
            catch (error) { if (error instanceof AgentMandateDenied) return null; throw error; }
        },
        operationsForCassette(agentRef: string, mandateRef: string): string | undefined {
            if (!database.inTransaction) return undefined;
            const grant = database.prepare(`SELECT pairing.operations ${grants}
                WHERE grant.agent_ref=? AND grant.mandate_ref=? AND registration.revoked_at IS NULL`)
                .get(agentRef, mandateRef) as { operations: string } | undefined;
            return grant?.operations;
        },
        listOneOffMandates(actorRef: string): AgentMandate[] {
            const renewed = new Set(database.prepare('SELECT mandate_ref FROM agent_unlock_grants').pluck().all());
            return mandates.list(actorRef).filter(mandate => !renewed.has(mandate.id));
        },
    };
}
