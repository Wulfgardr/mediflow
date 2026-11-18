import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { initializeSqliteSchema } from '../sqlite-schema';
import { createAgentPairingStore } from '../agent-pairing-store';
import { createAgentMandateStore } from '../agent-mandate-store';
import { createAgentCassetteStore, readAgentCassette } from '../agent-cassette-store';
import { readSqliteArchiveGeneration } from '../archive-generation';
import { AGENT_OPERATIONS, type AgentOperation } from '../agent-mandate-contract';
import { agentBase64, type AgentCipherContext } from '../agent-cassette-crypto';
import { encryptData, generateMasterKey } from '../security/security';
import { sealAgentItemNode } from '../../packages/agent-client/src/cassette-crypto';

export async function agentCassetteFixture(operations: AgentOperation[] = [...AGENT_OPERATIONS]) {
    const database = new Database(':memory:'); database.pragma('foreign_keys=ON'); initializeSqliteSchema(database);
    const actorRef = 'synthetic-cassette-doctor';
    database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
        .run(actorRef, actorRef, 'admin', 'synthetic-hash', 'synthetic-wrapping', 'synthetic-salt');
    let time = 1900000000000;
    const generation = readSqliteArchiveGeneration(database), keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey)), masterKey = await generateMasterKey();
    const wrapped = await encryptData(agentBase64(raw), masterKey); raw.fill(0);
    const publicKey = agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
    const mandates = createAgentMandateStore(database, () => time), pairings = createAgentPairingStore(database, () => time), store = createAgentCassetteStore(database, () => time);
    const mandate = mandates.create({ id: randomUUID(), durationMs: 43200000, operations, provider: 'local', allowsClinicalEgress: false,
        publicKey, wrappedPrivateKey: `ENC:${wrapped.iv}:${wrapped.data}` }, actorRef, generation);
    const pair = pairings.request('Synthetic cassette client', operations); pairings.approve(pair.request.id, pair.request.code, mandate.id, actorRef, generation);
    const token = pairings.poll(pair.request.id, pair.claim).credential!.token;
    const principal = database.transaction(() => pairings.principal(token)!).immediate();
    const visitId = randomUUID(), itemId = randomUUID();
    const context: AgentCipherContext = { mandateRef: mandate.id, visitId, itemId, kind: 'note' };
    const sentinel = 'SYNTHETIC_CASSETTE_6742_PATIENT_TEXT';
    const bytes = new TextEncoder().encode(JSON.stringify({ text: sentinel }));
    const anchor = sealAgentItemNode(publicKey, { ...context, itemId: visitId, kind: 'anchor' }, new TextEncoder().encode(JSON.stringify({ fiscalCode: 'SYNTHETIC_CF_6742' })));
    const item = { id: itemId, kind: 'note' as const, envelope: sealAgentItemNode(publicKey, context, bytes), byteLength: bytes.length, documentHash: null };
    return { database, actorRef, generation, mandate, mandates, pairings, store, principal, token, visitId, anchor, item, sentinel, masterKey,
        rows: () => (database.prepare('SELECT id FROM agent_cassettes ORDER BY deposited_at,id').all() as { id: string }[])
            .map(({ id }) => readAgentCassette(database, id, actorRef)!),
        run: <T>(action: () => T) => database.transaction(action).immediate(), advance: (delta: number) => { time += delta; } };
}
