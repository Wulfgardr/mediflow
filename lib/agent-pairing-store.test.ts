import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { initializeSqliteSchema } from './sqlite-schema';
import { createAgentPairingStore } from './agent-pairing-store';
import { createAgentMandateStore } from './agent-mandate-store';
import { readSqliteArchiveGeneration, rotateSqliteArchiveGeneration } from './archive-generation';

function fixture() {
    const database = new Database(':memory:'); database.pragma('foreign_keys=ON'); initializeSqliteSchema(database);
    const actor = 'synthetic-pairing-doctor';
    database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
        .run(actor, actor, 'admin', 'synthetic-hash', 'synthetic-wrapping', 'synthetic-salt');
    let time = 1900000000000;
    const generation = readSqliteArchiveGeneration(database);
    const mandates = createAgentMandateStore(database, () => time), pairings = createAgentPairingStore(database, () => time);
    const mandate = mandates.create({ id: randomUUID(), durationMs: 43200000, operations: ['visita.apri', 'visita.nota'],
        provider: 'openai', allowsClinicalEgress: true, publicKey: 'B' + 'A'.repeat(86) + '=', wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64) }, actor, generation);
    const requested = pairings.request('Synthetic Codex', ['visita.apri', 'visita.nota']);
    return { database, actor, generation, mandates, mandate, pairings, requested, advance: (delta: number) => { time += delta; },
        approve: () => pairings.approve(requested.request.id, requested.request.code, mandate.id, actor, generation),
        poll: () => pairings.poll(requested.request.id, requested.claim),
        principal: (token: string) => database.transaction(() => pairings.principal(token)).immediate() };
}

test('unapproved pairing never returns a token; approved polling survives retries and store recreation with hash-only persistence', () => {
    const f = fixture();
    try {
        assert.match(f.requested.request.code, /^[A-F0-9]{8}$/u);
        assert.equal(f.poll().credential, null);
        assert.equal(f.database.prepare('SELECT count(*) FROM agent_clients').pluck().get(), 0);
        const approval = f.approve(); assert.equal(approval.status, 'approved');
        const result = f.poll(); assert.ok(result.credential);
        const token = result.credential.token;
        assert.equal(result.credential.expiresAt, f.mandate.expiresAt);
        assert.equal(f.poll().credential?.token, token);
        const restarted = createAgentPairingStore(f.database, () => f.mandate.createdAt + 1);
        assert.equal(restarted.poll(f.requested.request.id, f.requested.claim).credential?.token, token);
        const principal = f.principal(token)!;
        assert.equal(principal.agentRef, f.requested.request.id); assert.equal(principal.actorRef, f.actor);
        assert.equal(principal.mandateRef, f.mandate.id); assert.equal(principal.publicKey, f.mandate.publicKey);
        assert.equal(f.pairings.principal(token), null);
        assert.equal(f.database.prepare('SELECT count(*) FROM agent_clients').pluck().get(), 1);
        assert.ok(!f.database.serialize().includes(Buffer.from(token)));
        assert.ok(!f.database.serialize().includes(Buffer.from(f.requested.claim)));
        for (const receipt of [f.requested.request, approval, result.receipt]) {
            assert.ok(!JSON.stringify(receipt).includes(token)); assert.ok(!JSON.stringify(receipt).includes(f.requested.claim));
            assert.equal(Object.hasOwn(receipt, 'token'), false);
        }
    } finally { f.database.close(); }
});

for (const failure of ['wrong-code', 'wrong-actor', 'foreign-mandate', 'wider-scope', 'expired-pairing', 'revoked-mandate', 'expired-mandate', 'archive'] as const) test(`approval ${failure} cannot mint a credential or success audit`, () => {
    const f = fixture();
    try {
        let id = f.requested.request.id, code = f.requested.request.code, actor = f.actor, mandate = f.mandate.id;
        if (failure === 'wrong-code') code = '00000000';
        if (failure === 'wrong-actor') actor = 'other';
        if (failure === 'foreign-mandate') mandate = randomUUID();
        if (failure === 'wider-scope') id = f.pairings.request('Synthetic scope', ['visita.proponi.terapia']).request.id;
        if (failure === 'wider-scope') code = f.pairings.pending().find(request => request.id === id)!.code;
        if (failure === 'expired-pairing') f.advance(300000);
        if (failure === 'expired-mandate') f.advance(43200000);
        if (failure === 'revoked-mandate') f.mandates.revoke(f.mandate.id, f.actor, f.generation);
        if (failure === 'archive') f.database.transaction(() => rotateSqliteArchiveGeneration(f.database)).immediate();
        assert.throws(() => f.pairings.approve(id, code, mandate, actor, f.generation), /AGENT_MANDATE_DENIED/);
        assert.equal(f.database.prepare('SELECT count(*) FROM agent_clients').pluck().get(), 0);
        assert.equal(f.database.prepare("SELECT count(*) FROM audit_events WHERE event_type='agent.client.approved'").pluck().get(), 0);
    } finally { f.database.close(); }
});

for (const failure of ['expired-mandate', 'revoked-mandate', 'revoked-agent', 'archive'] as const) test(`issued token is denied on the next transaction after ${failure}`, () => {
    const f = fixture();
    try {
        f.approve(); const token = f.poll().credential!.token; assert.ok(f.principal(token));
        if (failure === 'expired-mandate') f.advance(43200000);
        if (failure === 'revoked-mandate') f.mandates.revoke(f.mandate.id, f.actor, f.generation);
        if (failure === 'revoked-agent') f.database.prepare('UPDATE agent_clients SET revoked_at=?').run(f.mandate.createdAt + 1);
        if (failure === 'archive') f.database.transaction(() => rotateSqliteArchiveGeneration(f.database)).immediate();
        const before = performance.now(); assert.equal(f.principal(token), null); assert.ok(performance.now() - before < 1000);
        assert.throws(f.poll, /AGENT_MANDATE_DENIED/);
    } finally { f.database.close(); }
});

test('wrong claim cannot poll, and failed approval audit leaves the request pending', () => {
    const f = fixture();
    try {
        assert.throws(() => f.pairings.poll(f.requested.request.id, 'A'.repeat(43)), /AGENT_MANDATE_DENIED/);
        f.database.exec("CREATE TRIGGER synthetic_pair_approval_fault BEFORE INSERT ON audit_events WHEN NEW.event_type='agent.client.approved' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PAIR_APPROVAL_FAULT'); END");
        assert.throws(f.approve, /SYNTHETIC_PAIR_APPROVAL_FAULT/);
        assert.equal(f.pairings.pending().some(request => request.id === f.requested.request.id), true);
        assert.equal(f.poll().credential, null);
        assert.equal(f.database.prepare('SELECT count(*) FROM agent_clients').pluck().get(), 0);
    } finally { f.database.close(); }
});

for (const target of ['approval', 'credential'] as const) test(`ignored ${target} SQL cannot return a success receipt or a credential`, () => {
    const f = fixture();
    try {
        if (target === 'approval') f.database.exec("CREATE TRIGGER synthetic_ignored_approval BEFORE UPDATE ON agent_pairing_requests BEGIN SELECT RAISE(IGNORE); END");
        else { f.approve(); f.database.exec("CREATE TRIGGER synthetic_ignored_credential BEFORE INSERT ON agent_clients BEGIN SELECT RAISE(IGNORE); END"); }
        assert.throws(target === 'approval' ? f.approve : f.poll, /AGENT_MANDATE_DENIED/);
        assert.equal(f.database.prepare('SELECT count(*) FROM agent_clients').pluck().get(), 0);
        if (target === 'approval') assert.equal(f.database.prepare("SELECT count(*) FROM audit_events WHERE event_type='agent.client.approved'").pluck().get(), 0);
    } finally { f.database.close(); }
});
