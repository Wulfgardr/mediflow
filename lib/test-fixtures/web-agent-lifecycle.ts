import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readSqliteArchiveGeneration } from '../archive-generation';
import { createAgentMandateStore } from '../agent-mandate-store';
import { createAgentPairingStore } from '../agent-pairing-store';
import { createAgentRegistrationStore } from '../agent-registration-store';

export function recordWebAgentLifecycle(db: Database.Database, actor: string): void {
    const generation = readSqliteArchiveGeneration(db);
    const now = () => 1900000000000;
    const mandate = createAgentMandateStore(db, now).create({
        id: randomUUID(), durationMs: 3600000, operations: ['visita.apri'],
        provider: 'local', allowsClinicalEgress: false, publicKey: 'B' + 'A'.repeat(86) + '=',
        wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64),
    }, actor, generation);
    const pairings = createAgentPairingStore(db, now);
    const registrations = createAgentRegistrationStore(db, now);
    const { request } = pairings.request('Synthetic backup agent', ['visita.apri']);
    pairings.approve(request.id, request.code, mandate.id, actor, generation, true);
    registrations.renew(actor, generation, 'synthetic-backup-unlock');
    registrations.revoke(request.id, actor, generation);
}
