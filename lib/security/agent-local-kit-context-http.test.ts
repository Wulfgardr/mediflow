import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import test from 'node:test';
import { createAgentLocalKitHttp } from './agent-local-kit-http';
import { createAgentLocalKitContextHttp } from './agent-local-kit-context-http';
import { createAgentLocalKitStore } from '../agent-local-kit-store';
import { installLoopbackIngress } from './loopback-ingress.mjs';
import { AGENT_OPERATIONS } from '../agent-mandate-contract';
import { buildAgentPatientContextPayload, sendPatientContextToLocalKit } from '../agent-local-kit-context-client';
import { observeArchiveGeneration } from './client-auth-api';
import type { Patient } from '../db';
import { LOCAL_KIT_CONTEXT_DIR_NAME } from './agent-local-kit-files';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-agent-local-kit-ctx-http-'));
const kitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-fake-ctx-kit-'));
const kitDir = path.join(kitRoot, 'mf-ambulatorio-kit');
const credsDir = path.join(kitDir, '.agente');
fs.mkdirSync(kitDir, { mode: 0o700 });
fs.writeFileSync(
    path.join(kitDir, 'deposito.json'),
    JSON.stringify({
        origine: 'http://127.0.0.1:3000',
        mediflow: '/synthetic/mediflow/corrente',
        node: '/synthetic/node',
        credenziali: credsDir,
        agente: null,
    }, null, 2) + '\n',
    { mode: 0o600 },
);

process.env.MEDIFLOW_DATA_DIR = directory;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { openDbServer, dbServer } = await import('../db-server.ts');
const database = openDbServer();
const { verifyHostCredentials } = await import('./host-credential-verification.ts');
const { issueSyntheticWebSessionContext, retireSyntheticWebSession } = await import('./web-auth-lifecycle-owner-test-fixture.ts');
const { readSqliteArchiveGeneration } = await import('../archive-generation.ts');

const actor = 'synthetic-local-kit-ctx-doctor';
const username = ['synthetic', 'local', 'kit', 'ctx', 'account'].join('-');
const pin = ['2', '4', '6', '8'].join('');
database.prepare('INSERT INTO users(id,username,role,password_hash,encrypted_master_key,salt) VALUES (?,?,?,?,?,?)')
    .run(actor, username, 'admin', await bcrypt.hash(pin, 4), 'synthetic-wrapped-master', 'synthetic-salt');
const context = issueSyntheticWebSessionContext({ id: actor, username, role: 'admin' }, 'agent-local-kit-ctx-http');
let current = context.session as typeof context.session | null;
let failAuditOnce = false;

function wrappedStore() {
    const base = createAgentLocalKitStore(database);
    return {
        ...base,
        recordContextAudit(
            eventType: 'agent.context.exported' | 'agent.context.cleared',
            actorRef: string,
            subjectRef: string,
            generation: string,
        ) {
            if (failAuditOnce) {
                failAuditOnce = false;
                throw new Error('synthetic audit failure');
            }
            return base.recordContextAudit(eventType, actorRef, subjectRef, generation);
        },
    };
}

const kitHandlers = createAgentLocalKitHttp({
    session: async () => current,
    async verifyPin(candidateUser, candidatePin) {
        const result = await verifyHostCredentials({ username: candidateUser, pin: candidatePin });
        return result.kind === 'verified' ? result.account.id : null;
    },
    store: () => createAgentLocalKitStore(database),
});

const contextHandlers = createAgentLocalKitContextHttp({
    session: async () => current,
    store: wrappedStore,
});

installLoopbackIngress();
const server = createServer(async (incoming, outgoing) => {
    try {
        const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
        const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
        const request = new Request(url, {
            method: incoming.method,
            headers: incoming.headers as Record<string, string>,
            ...(hasBody ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
        } as RequestInit);
        const table = url.pathname.startsWith('/context') ? contextHandlers : kitHandlers;
        const handler = table[incoming.method as keyof typeof table];
        const response = handler ? await handler(request) : new Response(null, { status: 405 });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
        outgoing.writeHead(500);
        outgoing.end();
    }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;

function mutationHeaders(extra: Record<string, string> = {}) {
    return {
        'Content-Type': 'application/json',
        Origin: origin,
        'Sec-Fetch-Site': 'same-origin',
        'x-mediflow-archive-generation': readSqliteArchiveGeneration(database),
        ...extra,
    };
}

const contextDir = path.join(kitDir, LOCAL_KIT_CONTEXT_DIR_NAME);
const referenceFile = path.join(kitDir, 'riferimento-pazienti.json');
const plainSha256 = (taxCode: string) => createHash('sha256').update(taxCode).digest('hex');
const kitSecret = () => JSON.parse(fs.readFileSync(referenceFile, 'utf8')).segreto as string;
const kitReference = (taxCode: string, secret = kitSecret()) =>
    createHmac('sha256', Buffer.from(secret, 'hex')).update(taxCode).digest('hex');
const contextFiles = () => (fs.existsSync(contextDir) ? fs.readdirSync(contextDir).filter(name => name.endsWith('.json')) : []);

function sampleContextPayload(taxCode = 'RSSMRA80A01H501U') {
    return {
        patient: { taxCodeLast4: taxCode.slice(-4) },
        diagnoses: [{ description: 'Ipertensione arteriosa', code: 'BA00', system: 'ICD-11' }],
        therapies: [{ drugName: 'Ramipril 5 mg', dosage: '1 cp al mattino', status: 'active' }],
        exemptions: [{ code: '031' }],
        allergies: [],
        observations: [{ display: 'Peso corporeo', value: '75', unit: 'kg', code: '29463-7' }],
        recentNotes: [{ date: '2026-10-01', text: 'Quadro stabile.' }],
        openCheckups: [],
    };
}

function syntheticIdentity(taxCode: string) {
    return {
        firstName: 'NomeSintetico', lastName: 'CognomeSintetico', taxCode,
        birthDate: '1980-01-01T00:00:00.000Z', address: 'Via Sintetica 1', phone: '0000000000', caregiver: null,
    };
}

function contextRequest(taxCode = 'RSSMRA80A01H501U') {
    return { context: sampleContextPayload(taxCode), identity: syntheticIdentity(taxCode) };
}

async function postContext(request: unknown) {
    return fetch(`${origin}/context`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify(request) });
}

async function disconnectKit() {
    const response = await fetch(`${origin}/kit`, {
        method: 'DELETE',
        headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json',
            'x-mediflow-archive-generation': readSqliteArchiveGeneration(database) },
    });
    assert.equal(response.status, 200);
}

async function connectKit() {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const response = await fetch(`${origin}/kit`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({
            pin,
            kitPath: kitDir,
            mandate: {
                id: randomUUID(),
                durationMs: 86400000,
                operations: [...AGENT_OPERATIONS],
                provider: 'openai',
                allowsClinicalEgress: true,
                publicKey: Buffer.from(raw).toString('base64'),
                wrappedPrivateKey: 'ENC:' + 'A'.repeat(16) + ':' + 'A'.repeat(64),
            },
        }),
    });
    assert.equal(response.status, 201);
}

test.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    retireSyntheticWebSession(context.session);
    dbServer.$client.close();
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(kitRoot, { recursive: true, force: true });
});

test('blocks unauthenticated, cross-origin, bearer, and disconnected exports without writing files', async () => {
    const request = contextRequest();

    current = null;
    try {
        assert.equal((await fetch(`${origin}/context`)).status, 401);
        assert.equal((await fetch(`${origin}/context`, { method: 'POST', headers: mutationHeaders(), body: JSON.stringify(request) })).status, 403);
    } finally {
        current = context.session;
    }

    assert.equal((await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders({ Authorization: 'Bearer mfa_should_never_be_accepted' }),
        body: JSON.stringify(request),
    })).status, 403);

    assert.equal((await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders({ 'x-mediflow-archive-generation': 'stale-generation' }),
        body: JSON.stringify(request),
    })).status, 403);

    const disconnectedRes = await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify(request),
    });
    assert.equal(disconnectedRes.status, 403);
    assert.equal((await disconnectedRes.json()).code, 'LOCAL_KIT_INACTIVE');
    assert.equal(fs.existsSync(path.join(kitDir, LOCAL_KIT_CONTEXT_DIR_NAME)), false);
});

test('exports audited patient context when kit is active, rolls back file on audit failure, hides cfHash on GET, and clears on DELETE', async () => {
    await connectKit();
    const request = contextRequest();
    const reference = kitReference('RSSMRA80A01H501U');

    failAuditOnce = true;
    const failedAuditRes = await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify(request),
    });
    assert.equal(failedAuditRes.status, 503);
    assert.deepEqual(contextFiles(), []);

    const exportRes = await fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify(request),
    });
    assert.equal(exportRes.status, 201);
    const exportedText = await exportRes.text();
    assert.equal(exportedText.includes(reference), false);
    const exported = JSON.parse(exportedText);
    assert.equal(exported.status, 'exported');
    assert.equal(exported.taxCodeLast4, '501U');

    const contextFile = path.join(contextDir, `${reference}.json`);
    assert.equal(fs.existsSync(contextFile), true);
    const onDisk = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    assert.equal(onDisk.schema, 'mediflow.agent_patient_context.v2');
    assert.equal(onDisk.patient.cfHash, reference);
    assert.equal(onDisk.diagnoses[0].code, 'BA00');

    const listRes = await fetch(`${origin}/context`);
    assert.equal(listRes.status, 200);
    const listText = await listRes.text();
    assert.equal(listText.includes(reference), false);
    assert.equal(listText.includes('Ipertensione'), false);
    const listed = JSON.parse(listText);
    assert.equal(listed.count, 1);
    assert.equal(listed.items[0].taxCodeLast4, '501U');

    const deleteRes = await fetch(`${origin}/context`, {
        method: 'DELETE',
        headers: {
            Origin: origin,
            'Sec-Fetch-Site': 'same-origin',
            'x-mediflow-archive-generation': readSqliteArchiveGeneration(database),
        },
    });
    assert.equal(deleteRes.status, 200);
    assert.equal((await deleteRes.json()).removed, 1);
    assert.equal(fs.existsSync(contextFile), false);

    const audits = database.prepare('SELECT event_type, subject_ref FROM audit_events WHERE actor_ref=? ORDER BY rowid').all(actor) as Array<{ event_type: string; subject_ref: string }>;
    assert.ok(audits.some(row => row.event_type === 'agent.context.exported' && row.subject_ref === reference));
    assert.ok(audits.some(row => row.event_type === 'agent.context.cleared' && row.subject_ref === 'all'));
});

test('revalidates kit authorization after awaiting POST body if disconnected mid-flight', async () => {
    const request = contextRequest('VRDLGI75B12F205X');
    const encoded = new TextEncoder().encode(JSON.stringify(request));
    const mid = Math.floor(encoded.length / 2);
    let releaseSecondHalf!: () => void;
    const secondHalfReady = new Promise<void>(resolve => { releaseSecondHalf = resolve; });
    let firstChunkSent!: () => void;
    const firstChunkObserved = new Promise<void>(resolve => { firstChunkSent = resolve; });

    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            controller.enqueue(encoded.subarray(0, mid));
            firstChunkSent();
            await secondHalfReady;
            controller.enqueue(encoded.subarray(mid));
            controller.close();
        },
    });

    const responsePromise = fetch(`${origin}/context`, {
        method: 'POST',
        headers: mutationHeaders(),
        body,
        duplex: 'half',
    } as RequestInit);
    await firstChunkObserved;
    await new Promise(resolve => setTimeout(resolve, 20));
    createAgentLocalKitStore(database).disconnect(actor, readSqliteArchiveGeneration(database));
    releaseSecondHalf();

    const response = await responsePromise;
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'LOCAL_KIT_INACTIVE');
    assert.deepEqual(contextFiles(), []);
});

const KIT_PATIENT_TAX_CODE = 'SNTRMN80A41F205X';
const kitPatient: Patient = {
    id: 'pat-kit-identity',
    firstName: 'Ermenegilda',
    lastName: 'Sinteticoni',
    taxCode: KIT_PATIENT_TAX_CODE,
    birthDate: new Date('1980-01-01T00:00:00Z'),
    address: 'Via dei Tigli Sintetici 12',
    phone: '3471234567',
    caregiver: 'Gualtiero Provasintetica',
    createdAt: new Date('2026-11-01T09:00:00Z'),
    updatedAt: new Date('2026-11-01T09:00:00Z'),
    diagnoses: [{ description: 'Ipertensione, segnalata da Ermenegilda Sinteticoni', code: 'BA00', system: 'ICD-11', date: new Date('2026-01-10T00:00:00Z') }],
    allergies: [{ substance: 'FANS', reaction: 'riferita al telefono 347 123 4567' }],
};

const identityValues = [kitPatient.firstName, kitPatient.lastName, KIT_PATIENT_TAX_CODE, kitPatient.address, kitPatient.phone, kitPatient.caregiver!];
const compact = (value: string) => value.toLowerCase().replace(/[\s,.\-+/]/gu, '');

async function exportThroughClient(patient: Patient) {
    const now = new Date('2026-11-01T09:00:00Z');
    const entries = [
        { id: 'k1', patientId: patient.id, date: now, type: 'visit' as const, title: 'Visita con ERMENEGILDA SINTETICONI',
            content: '<p>ermenegilda  sinteticoni, nata il 01/01/1980, CF snt rmn 80a41 f205x, '
                + 'accompagnata da gualtiero provasintetica e dalla vicina TerzaPersonaSintetica. Recapito +39 347-1234567, '
                + 'abita in via dei tigli sintetici, 12. Ricovero dal 12/10/2026, ramipril sospeso.</p>',
            createdAt: now, updatedAt: now },
        { id: 'k2', patientId: patient.id, date: now, type: 'note' as const, title: 'Telefonata',
            content: 'Sinteticoni Ermenegilda richiama al 3471234567. Ritira i farmaci gualtiero  provasintetica, consegna in via dei tigli  sintetici 12.', createdAt: now, updatedAt: now },
    ];
    const payload = await buildAgentPatientContextPayload({
        patient,
        entries,
        therapies: [{ id: 'kt1', patientId: patient.id, drugName: 'Ramipril 5 mg', dosage: '1 cp, lo prepara Gualtiero Provasintetica', status: 'active', startDate: now, createdAt: now }],
        observations: [{ id: 'ko1', patientId: patient.id, codeSystem: 'LOINC', code: '29463-7', display: 'Peso misurato a Ermenegilda', unitSystem: 'UCUM', unitCode: 'kg', value: 70, observedAt: now, createdAt: now }],
        checkups: [{ id: 'kc1', patientId: patient.id, date: now, title: 'Chiamare Sinteticoni al 347 1234567', status: 'pending', createdAt: now }],
        exemptionCodes: ['031'],
    });
    assert.ok(payload);
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        assert.equal(input, '/api/agent-mandates/local-kit/context');
        const headers = new Headers(init?.headers);
        headers.set('Origin', origin);
        headers.set('Sec-Fetch-Site', 'same-origin');
        return realFetch(`${origin}/context`, { ...init, headers });
    }) as typeof fetch;
    try {
        return { payload, result: await sendPatientContextToLocalKit(payload, patient) };
    } finally {
        globalThis.fetch = realFetch;
    }
}

test('Invia a Codex: identity written in notes and free-text fields never reaches the kit file', async () => {
    await connectKit();
    observeArchiveGeneration(readSqliteArchiveGeneration(database));
    const { result } = await exportThroughClient(kitPatient);
    assert.equal(result.ok, true);

    const [written] = contextFiles();
    const contextFile = path.join(contextDir, written);
    const bytes = fs.readFileSync(contextFile, 'utf8');
    const leaked = identityValues.filter(value => bytes.toLowerCase().includes(value.toLowerCase()) || compact(bytes).includes(compact(value)));
    assert.deepEqual(leaked, []);
    assert.equal(/01\/01\/1980/u.test(bytes), false);

    const onDisk = JSON.parse(bytes);
    assert.equal(onDisk.schema, 'mediflow.agent_patient_context.v2');
    assert.deepEqual(Object.keys(onDisk).sort(), ['allergies', 'diagnoses', 'exemptions', 'expiresAt', 'exportedAt', 'observations', 'openCheckups', 'patient', 'recentNotes', 'schema', 'therapies']);
    assert.equal(onDisk.patient.cfHash, kitReference(KIT_PATIENT_TAX_CODE));
    assert.equal(onDisk.patient.taxCodeLast4, '205X');
    assert.match(onDisk.recentNotes[0].text, /\[\[MF_PAZ[0-9]+_[a-z2-7]{8}\]\]/u);
    assert.match(onDisk.recentNotes[0].text, /Ricovero dal 12\/10\/2026, ramipril sospeso\./u);
    assert.equal(onDisk.diagnoses[0].code, 'BA00');
    assert.equal(onDisk.observations[0].code, '29463-7');
    assert.deepEqual(onDisk.exemptions, [{ code: '031' }]);
    assert.equal(bytes.includes('TerzaPersonaSintetica'), true, 'ADR 0197: a third party outside the registry is a declared limit');
    fs.rmSync(contextFile);
});

test('Invia a Codex: a context whose identity does not match it, or that brings its own reference, is refused and nothing is written', async () => {
    await connectKit();
    const request = contextRequest('VRDLGI75B12F205X');
    const mismatched = { ...request, identity: { ...request.identity, taxCode: 'RSSMRA80A01H501U' } };
    assert.equal((await postContext(mismatched)).status, 400);
    assert.equal((await postContext(request.context)).status, 400);
    const ownReference = { ...request, context: { ...request.context, patient: { ...request.context.patient, cfHash: plainSha256('VRDLGI75B12F205X') } } };
    assert.equal((await postContext(ownReference)).status, 400);
    const withBirthYear = { ...request, context: { ...request.context, patient: { ...request.context.patient, birthYear: 1975 } } };
    assert.equal((await postContext(withBirthYear)).status, 400);
    assert.deepEqual(contextFiles(), []);
});

test('Invia a Codex: the kit file, its name and the audit carry the keyed reference, never the plain SHA-256 of the tax code', async () => {
    await connectKit();
    observeArchiveGeneration(readSqliteArchiveGeneration(database));
    const secret = kitSecret();
    assert.match(secret, /^[a-f0-9]{64}$/u);
    assert.equal(fs.statSync(referenceFile).mode & 0o777, 0o600);
    const sha = plainSha256(KIT_PATIENT_TAX_CODE);
    const reference = kitReference(KIT_PATIENT_TAX_CODE, secret);
    assert.notEqual(reference, sha);

    assert.equal((await exportThroughClient(kitPatient)).result.ok, true);
    assert.deepEqual(contextFiles(), [`${reference}.json`]);
    const bytes = fs.readFileSync(path.join(contextDir, `${reference}.json`), 'utf8');
    assert.equal(bytes.includes(sha), false);
    assert.deepEqual(Object.keys(JSON.parse(bytes).patient).sort(), ['cfHash', 'taxCodeLast4']);

    assert.equal((await exportThroughClient({ ...kitPatient, taxCode: ` ${KIT_PATIENT_TAX_CODE.toLowerCase()} ` })).result.ok, true);
    assert.deepEqual(contextFiles(), [`${reference}.json`]);

    const exported = database.prepare("SELECT subject_ref FROM audit_events WHERE event_type='agent.context.exported'").all() as Array<{ subject_ref: string }>;
    assert.ok(exported.some(row => row.subject_ref === reference));
    const everyAuditRow = JSON.stringify(database.prepare('SELECT * FROM audit_events').all());
    assert.equal(everyAuditRow.includes(sha), false);
});

const storedSecret = () => (database.prepare('SELECT value FROM settings WHERE key=?').get('agent.localKitPatientReferenceKey') as { value: string } | undefined)?.value;
const exportedAudits = () => (database.prepare("SELECT count(*) AS n FROM audit_events WHERE event_type='agent.context.exported'").get() as { n: number }).n;

async function connectedKitWithoutSecret() {
    await connectKit();
    observeArchiveGeneration(readSqliteArchiveGeneration(database));
    const agentRef = createAgentLocalKitStore(database).status(actor).agentRef;
    database.prepare('DELETE FROM settings WHERE key=?').run('agent.localKitPatientReferenceKey');
    fs.rmSync(referenceFile, { force: true });
    return agentRef;
}

test('Invia a Codex: a kit connected before the secret existed gets it on the first export, without reconnecting', async () => {
    const agentRef = await connectedKitWithoutSecret();
    const { result } = await exportThroughClient(kitPatient);
    assert.equal(result.ok, true);
    const secret = storedSecret() ?? '';
    assert.match(secret, /^[a-f0-9]{64}$/u);
    assert.equal(kitSecret(), secret);
    assert.equal(fs.statSync(referenceFile).mode & 0o777, 0o600);
    assert.deepEqual(contextFiles(), [`${kitReference(KIT_PATIENT_TAX_CODE, secret)}.json`]);
    assert.equal(fs.existsSync(path.join(contextDir, `${plainSha256(KIT_PATIENT_TAX_CODE)}.json`)), false);
    assert.equal(createAgentLocalKitStore(database).status(actor).agentRef, agentRef);
    assert.equal((await exportThroughClient(kitPatient)).result.ok, true);
    assert.equal(storedSecret(), secret);
    fs.rmSync(path.join(contextDir, `${kitReference(KIT_PATIENT_TAX_CODE, secret)}.json`));
});

test('Invia a Codex: two concurrent first exports create one secret', async () => {
    await connectedKitWithoutSecret();
    const responses = await Promise.all([postContext(contextRequest('RSSMRA80A01H501U')), postContext(contextRequest('VRDLGI75B12F205X'))]);
    assert.deepEqual(responses.map(response => response.status), [201, 201]);
    const secret = storedSecret() ?? '';
    assert.equal(kitSecret(), secret);
    assert.deepEqual(contextFiles().sort(), [kitReference('RSSMRA80A01H501U', secret), kitReference('VRDLGI75B12F205X', secret)].map(name => `${name}.json`).sort());
    fs.rmSync(contextDir, { recursive: true, force: true });
});

test('Invia a Codex: if the secret cannot be written in the kit, no secret is kept and no context is written', async () => {
    await connectedKitWithoutSecret();
    fs.mkdirSync(referenceFile, { mode: 0o700 });
    try {
        const auditsBefore = exportedAudits();
        const { result } = await exportThroughClient(kitPatient);
        assert.deepEqual(result, { ok: false, code: 'LOCAL_KIT_RECONNECT' });
        assert.equal(storedSecret(), undefined);
        assert.deepEqual(contextFiles(), []);
        assert.equal(exportedAudits(), auditsBefore);
    } finally {
        fs.rmSync(referenceFile, { recursive: true, force: true });
    }
    assert.equal((await exportThroughClient(kitPatient)).result.ok, true);
    const secret = storedSecret() ?? '';
    assert.equal(kitSecret(), secret);
    assert.deepEqual(contextFiles(), [`${kitReference(KIT_PATIENT_TAX_CODE, secret)}.json`]);
    fs.rmSync(path.join(contextDir, `${kitReference(KIT_PATIENT_TAX_CODE, secret)}.json`));
});

test('Invia a Codex: disconnecting and reconnecting the kit changes the secret and empties the contexts', async () => {
    await connectKit();
    observeArchiveGeneration(readSqliteArchiveGeneration(database));
    const before = kitSecret();
    assert.equal((await exportThroughClient(kitPatient)).result.ok, true);
    assert.deepEqual(contextFiles(), [`${kitReference(KIT_PATIENT_TAX_CODE, before)}.json`]);

    await disconnectKit();
    assert.equal(fs.existsSync(referenceFile), false);
    assert.deepEqual(contextFiles(), []);
    assert.equal(storedSecret(), undefined);

    await connectKit();
    observeArchiveGeneration(readSqliteArchiveGeneration(database));
    const after = kitSecret();
    assert.notEqual(after, before);
    assert.equal((await exportThroughClient(kitPatient)).result.ok, true);
    assert.notEqual(kitReference(KIT_PATIENT_TAX_CODE, after), kitReference(KIT_PATIENT_TAX_CODE, before));
    assert.deepEqual(contextFiles(), [`${kitReference(KIT_PATIENT_TAX_CODE, after)}.json`]);

    await connectKit();
    assert.notEqual(kitSecret(), after);
    assert.deepEqual(contextFiles(), []);
});
