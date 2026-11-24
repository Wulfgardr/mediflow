import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { initializeSqliteSchema } from './sqlite-schema';
import { createAgentPairingStore } from './agent-pairing-store';
import { createAgentMandateStore } from './agent-mandate-store';
import { createAgentRegistrationStore } from './agent-registration-store';
import { MANDATE_MAX_DURATION_MS } from './agent-mandate-contract';
import { readSqliteArchiveGeneration, rotateSqliteArchiveGeneration } from './archive-generation';

function fixture() {
    const database = new Database(':memory:');
    database.pragma('foreign_keys=ON');
    initializeSqliteSchema(database);
    const actor = 'synthetic-doctor';
    database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
        .run(actor, actor, 'admin', 'synthetic', 'synthetic', 'synthetic');
    const generation = readSqliteArchiveGeneration(database);
    let time = 1900000000000;
    const now = () => time;
    const mandates = createAgentMandateStore(database, now);
    const template = mandates.create({ id: randomUUID(), durationMs: 3600000, operations: ['visita.apri', 'visita.nota', 'visita.chiudi'],
        provider: 'openai', allowsClinicalEgress: true, publicKey: 'B' + 'A'.repeat(86) + '=',
        wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) }, actor, generation);
    const pairings = createAgentPairingStore(database, now);
    const registrations = createAgentRegistrationStore(database, now);
    const pairing = pairings.request('Synthetic agent', ['visita.apri', 'visita.chiudi']);
    const id = pairing.request.id;
    return { database, actor, generation, template, mandates, registrations, id, now,
        advance: (ms: number) => { time += ms; },
        renew: (ref: string) => registrations.renew(actor, generation, ref),
        revoke: () => registrations.revoke(id, actor, generation),
        poll: () => pairings.poll(id, pairing.claim),
        register: () => {
            pairings.approve(id, pairing.request.code, template.id, actor, generation, true);
            const response = pairings.poll(id, pairing.claim);
            assert.ok('registrationCredential' in response && response.registrationCredential);
            assert.equal(response.credential, null);
            return response.registrationCredential.token;
        },
        retrieve: (token: string) => registrations.retrieve(token),
        principal: (token: string) => database.transaction(() => registrations.principal(token)).immediate(),
    };
}

test('only a registered agent retrieves current unlock authority, once per unlock, with original policy and provenance', () => {
    const f = fixture();
    try {
        assert.equal(f.poll().credential, null);
        f.renew('unlock-a');
        assert.equal(f.database.prepare('SELECT count(*) FROM agent_unlock_grants').pluck().get(), 0);
        const long = f.register();
        assert.throws(() => f.retrieve(long), /AGENT_MANDATE_DENIED/u);
        f.renew('unlock-a');
        const first = f.retrieve(long);
        f.renew('unlock-a');
        assert.deepEqual(f.retrieve(long), first);
        assert.equal(first.expiresAt - first.issuedAt, MANDATE_MAX_DURATION_MS);
        assert.notEqual(first.mandateRef, f.template.id);
        assert.equal(f.principal(long), null);
        assert.deepEqual(f.principal(first.token)?.operations, ['visita.apri', 'visita.chiudi']);
        assert.equal(f.principal(first.token)?.allowsClinicalEgress, true);
        assert.equal(f.mandates.read(first.mandateRef)?.wrappedPrivateKey, f.template.wrappedPrivateKey);
        const audit = f.database.prepare(`SELECT actor_ref,proposer_ref,mandate_ref,source_surface,model_provider
            FROM audit_events WHERE event_type='agent.mandate.renewed'`).all();
        assert.deepEqual(audit, [{ actor_ref: f.actor, proposer_ref: f.id, mandate_ref: first.mandateRef, source_surface: 'web', model_provider: 'openai' }]);
        assert.deepEqual(f.registrations.list(f.actor), [{ id: f.id, name: 'Synthetic agent', revokedAt: null, lastRenewalAt: f.now() }]);
        for (const secret of [long, first.token]) assert.equal(f.database.serialize().includes(Buffer.from(secret)), false);
    } finally { f.database.close(); }
});

for (const cause of ['lock', 'expiry', 'account-lockout', 'revocation', 'replacement', 'renewal'] as const) test(`deposit authority cannot be reused after ${cause}`, () => {
    const f = fixture();
    try {
        const long = f.register();
        f.renew('unlock-a');
        const first = f.retrieve(long);
        assert.ok(f.principal(first.token));
        if (cause === 'lock') f.mandates.revokeAll(f.actor, f.generation);
        if (cause === 'expiry') f.advance(MANDATE_MAX_DURATION_MS);
        if (cause === 'account-lockout') f.database.prepare('UPDATE users SET locked_until=?').run(f.now() / 1000 + 500);
        if (cause === 'replacement') f.database.transaction(() => rotateSqliteArchiveGeneration(f.database)).immediate();
        if (cause === 'revocation') f.revoke();
        if (cause === 'renewal') {
            f.renew('unlock-b');
            assert.notEqual(f.retrieve(long).mandateRef, first.mandateRef);
        } else {
            assert.throws(() => f.retrieve(long), /AGENT_MANDATE_DENIED/u);
        }
        assert.equal(f.principal(first.token), null);
        if (cause === 'revocation' || cause === 'replacement') {
            if (cause === 'revocation') f.renew('unlock-b');
            assert.throws(() => f.retrieve(long), /AGENT_MANDATE_DENIED/u);
        }
    } finally { f.database.close(); }
});

test('deposit authority outlives the Web session that confirmed it until the mandate expires', () => {
    const f = fixture();
    try {
        const long = f.register();
        f.renew('unlock-a');
        const first = f.retrieve(long);
        f.advance(MANDATE_MAX_DURATION_MS - 1);
        assert.equal(f.principal(first.token)?.mandateRef, first.mandateRef);
        assert.deepEqual(f.retrieve(long), first);
        f.advance(1);
        assert.equal(f.principal(first.token), null);
        assert.throws(() => f.retrieve(long), /AGENT_MANDATE_DENIED/u);
    } finally { f.database.close(); }
});

test('failure to audit the renewal rolls back the mandate and permits a retry', () => {
    const f = fixture();
    try {
        const long = f.register();
        f.database.exec(`CREATE TRIGGER synthetic_renewal_fault BEFORE INSERT ON audit_events
            WHEN NEW.event_type='agent.mandate.renewed' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_RENEWAL_FAULT'); END`);
        assert.throws(() => f.renew('unlock-a'), /SYNTHETIC_RENEWAL_FAULT/u);
        assert.equal(f.database.prepare('SELECT count(*) FROM agent_mandates').pluck().get(), 1);
        assert.throws(() => f.retrieve(long), /AGENT_MANDATE_DENIED/u);
        f.database.exec('DROP TRIGGER synthetic_renewal_fault');
        f.renew('unlock-a');
        assert.ok(f.principal(f.retrieve(long).token));
    } finally { f.database.close(); }
});
