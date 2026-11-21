import type Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readSqliteArchiveGeneration, ArchiveReplacedError } from './archive-generation';
import { validMandateInput, type AgentMandateInput } from './agent-mandate-contract';
import { AgentMandateDenied, createAgentMandateStore } from './agent-mandate-store';
import { createAgentRegistrationStore } from './agent-registration-store';
import { defaultLocalKitPath } from './security/agent-local-kit-files';

export const LOCAL_KIT_PATH_SETTING_KEY = 'agent.localKitPath';
export const LOCAL_KIT_AGENT_SETTING_KEY = 'agent.localKitAgentRef';
export const LOCAL_KIT_AGENT_NAME = 'Codex · Ambulatorio';

export type AgentLocalKitStatus = {
    kitPath: string;
    connected: boolean;
    agentRef: string | null;
    expiresAt: number | null;
    lastRenewalAt: number | null;
};

export type AgentLocalKitConnection = {
    agentRef: string;
    mandateRef: string;
    expiresAt: number;
    bearerToken: string;
    registrationToken: string;
};

const hash = (domain: string, value: string) => createHash('sha256').update(JSON.stringify([domain, value])).digest('hex');

function readSetting(database: Database.Database, key: string): string | null {
    const row = database.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row && typeof row.value === 'string' && row.value.length > 0 ? row.value : null;
}

function writeSetting(database: Database.Database, key: string, value: string): void {
    database.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

function deleteSetting(database: Database.Database, key: string): void {
    database.prepare('DELETE FROM settings WHERE key=?').run(key);
}

function auditSettingUpdate(database: Database.Database, actorRef: string, key: string, time: number): void {
    database.prepare(`INSERT INTO audit_events(event_id,schema_version,event_type,occurred_at,outcome,actor_type,actor_ref,
        subject_type,subject_ref,source_surface,created_at)
        VALUES (?,1,'settings.updated',?,'success','user',?,'settings',?,'web',?)`)
        .run(randomUUID(), time, actorRef, key, Math.floor(time / 1000));
}

export function createAgentLocalKitStore(database: Database.Database, now = Date.now) {
    const mandates = createAgentMandateStore(database, now);
    const registrations = createAgentRegistrationStore(database, now);

    function actorUnlocked(actorRef: string): boolean {
        return Boolean(database.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND (locked_until IS NULL OR locked_until<=?)")
            .get(actorRef, Math.floor(now() / 1000)));
    }

    function revokeExistingAgent(agentRef: string, actorRef: string, generation: string): void {
        const row = database.prepare(`SELECT registration.template_ref AS templateRef, registration.current_mandate_ref AS currentRef,
            registration.revoked_at AS revokedAt
            FROM agent_registrations AS registration
            JOIN agent_mandates AS template ON template.id=registration.template_ref
            WHERE registration.id=? AND template.actor_ref=? AND template.archive_generation=?`)
            .get(agentRef, actorRef, generation) as { templateRef: string; currentRef: string | null; revokedAt: number | null } | undefined;
        if (!row) return;
        const time = now();
        if (row.revokedAt === null) {
            registrations.revoke(agentRef, actorRef, generation);
        }
        database.prepare('UPDATE agent_clients SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(time, agentRef);
        mandates.revoke(row.templateRef, actorRef, generation);
        if (row.currentRef && row.currentRef !== row.templateRef) {
            mandates.revoke(row.currentRef, actorRef, generation);
        }
    }

    return {
        readKitPath(): string {
            return readSetting(database, LOCAL_KIT_PATH_SETTING_KEY) ?? defaultLocalKitPath();
        },
        saveKitPath(kitPath: string, actorRef: string, generation: string): AgentLocalKitStatus {
            database.transaction(() => {
                if (readSqliteArchiveGeneration(database) !== generation) throw new ArchiveReplacedError();
                writeSetting(database, LOCAL_KIT_PATH_SETTING_KEY, kitPath);
                auditSettingUpdate(database, actorRef, LOCAL_KIT_PATH_SETTING_KEY, now());
            }).immediate();
            return this.status(actorRef);
        },
        status(actorRef: string): AgentLocalKitStatus {
            const kitPath = this.readKitPath();
            const agentRef = readSetting(database, LOCAL_KIT_AGENT_SETTING_KEY);
            if (!agentRef) {
                return { kitPath, connected: false, agentRef: null, expiresAt: null, lastRenewalAt: null };
            }
            const generation = readSqliteArchiveGeneration(database);
            const row = database.prepare(`SELECT registration.id,
                registration.revoked_at AS revokedAt,
                current.created_at AS lastRenewalAt,
                COALESCE(current.expires_at, template.expires_at) AS expiresAt,
                COALESCE(current.revoked_at, template.revoked_at) AS mandateRevokedAt
                FROM agent_registrations AS registration
                JOIN agent_mandates AS template ON template.id=registration.template_ref
                LEFT JOIN agent_mandates AS current ON current.id=registration.current_mandate_ref
                WHERE registration.id=? AND template.actor_ref=? AND template.archive_generation=?`)
                .get(agentRef, actorRef, generation) as {
                    id: string;
                    revokedAt: number | null;
                    lastRenewalAt: number | null;
                    expiresAt: number;
                    mandateRevokedAt: number | null;
                } | undefined;
            if (!row || row.revokedAt !== null) {
                return { kitPath, connected: false, agentRef: null, expiresAt: null, lastRenewalAt: null };
            }
            return {
                kitPath,
                connected: true,
                agentRef: row.id,
                expiresAt: row.mandateRevokedAt === null ? row.expiresAt : null,
                lastRenewalAt: row.lastRenewalAt,
            };
        },
        connect(input: AgentMandateInput, actorRef: string, generation: string): AgentLocalKitConnection {
            if (!validMandateInput(input) || input.provider !== 'openai' || !input.allowsClinicalEgress) {
                throw new AgentMandateDenied();
            }
            return database.transaction(() => {
                if (readSqliteArchiveGeneration(database) !== generation) throw new ArchiveReplacedError();
                if (!actorUnlocked(actorRef)) throw new AgentMandateDenied();
                const previousAgentRef = readSetting(database, LOCAL_KIT_AGENT_SETTING_KEY);
                if (previousAgentRef) {
                    revokeExistingAgent(previousAgentRef, actorRef, generation);
                }
                const mandate = mandates.create(input, actorRef, generation);
                const agentRef = randomUUID();
                const claim = randomBytes(32).toString('base64url');
                const code = randomBytes(5).toString('hex').slice(0, 8).toUpperCase();
                const createdAt = mandate.createdAt;
                const insertedRequest = database.prepare(`INSERT INTO agent_pairing_requests(id,code,name,operations,claim_hash,created_at,expires_at,status,mandate_ref)
                    VALUES (?,?,?,?,?,?,?,'approved',?)`)
                    .run(agentRef, code, LOCAL_KIT_AGENT_NAME, JSON.stringify(mandate.operations), hash('mediflow.agent.claim.v1', claim), createdAt, createdAt + 300000, mandate.id);
                if (insertedRequest.changes !== 1) throw new AgentMandateDenied();

                registrations.register({
                    id: agentRef,
                    code,
                    name: LOCAL_KIT_AGENT_NAME,
                    operations: mandate.operations,
                    createdAt,
                    expiresAt: createdAt + 300000,
                    status: 'approved',
                    mandateRef: mandate.id,
                }, mandate);
                const registrationCredential = registrations.registrationCredential(agentRef, claim);
                if (!registrationCredential) throw new AgentMandateDenied();

                const bearerToken = 'mfa_' + randomBytes(32).toString('base64url');
                const insertedClient = database.prepare('INSERT INTO agent_clients(id,mandate_ref,name,operations,token_hash,expires_at) VALUES (?,?,?,?,?,?)')
                    .run(agentRef, mandate.id, LOCAL_KIT_AGENT_NAME, JSON.stringify(mandate.operations), hash('mediflow.agent.bearer.v1', bearerToken), mandate.expiresAt);
                if (insertedClient.changes !== 1) throw new AgentMandateDenied();

                writeSetting(database, LOCAL_KIT_AGENT_SETTING_KEY, agentRef);
                return {
                    agentRef,
                    mandateRef: mandate.id,
                    expiresAt: mandate.expiresAt,
                    bearerToken,
                    registrationToken: registrationCredential.token,
                };
            }).immediate();
        },
        disconnect(actorRef: string, generation: string): { agentRef: string | null } {
            return database.transaction(() => {
                if (readSqliteArchiveGeneration(database) !== generation) throw new ArchiveReplacedError();
                const agentRef = readSetting(database, LOCAL_KIT_AGENT_SETTING_KEY);
                if (agentRef) {
                    revokeExistingAgent(agentRef, actorRef, generation);
                    deleteSetting(database, LOCAL_KIT_AGENT_SETTING_KEY);
                }
                return { agentRef };
            }).immediate();
        },
    };
}
