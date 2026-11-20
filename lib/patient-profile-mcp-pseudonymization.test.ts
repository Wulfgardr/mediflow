import { syntheticLoopbackRequest } from './security/loopback-ingress-test-fixture';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto, { randomBytes } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { eq } from 'drizzle-orm';
import { installNetworkPatientCookieFixture, syntheticNetworkPatientAuthority } from './network-patient-authority-test-fixture';
import { issueSyntheticWebSessionContext } from './security/web-auth-lifecycle-owner-test-fixture';
import { clearAllSessions } from './security/server-session';
import { currentArchiveGeneration } from './security/archive-session-generation';
import { ambulatories, patients, patientsToAmbulatories, settings, users } from './schema';
import { PROFILE_FIELD_NAMES, PROFILE_QUERY_MAX_RESULT_BYTES, isProfileResult, type ProfileFields, type ProfileQuery,
    type ProfileResult } from '../packages/patient-profile-contracts/src/query';
import { createAipOperationRpcChildEnvironmentV1, createAipOperationRpcHostV1 } from '../packages/aip/src/operation-rpc.ts';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-profile-pseudonyms-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const cookieState: { cookies: Map<string, string>; headers: Headers; onCookies?: () => Promise<void> | void } = { cookies: new Map(), headers: syntheticLoopbackRequest('http://127.0.0.1').headers };
const cleanup = installNetworkPatientCookieFixture(dataDir, cookieState);
const web = load('../app/api/patients/[id]/profile-query/route.ts') as typeof import('../app/api/patients/[id]/profile-query/route');
const { acquirePatientProfileQueryHostPort, headlessProfileRelease } = load('./security/patient-profile-query-host-port.ts') as typeof import('./security/patient-profile-query-host-port');
const { createPatientProfileQueryWebDispatcher } = load('./security/patient-profile-query-web-dispatcher.ts') as typeof import('./security/patient-profile-query-web-dispatcher');
const { createPatientProfileQuerySupervisorPortV1 } = load('./security/patient-profile-query-supervisor-port.ts') as typeof import('./security/patient-profile-query-supervisor-port');
const { createProfilePseudonymizer } = load('./patient-profile-pseudonymization.ts') as typeof import('./patient-profile-pseudonymization');
const { PLACEHOLDER_PATTERN } = load('./ai-redaction-session.ts') as typeof import('./ai-redaction-session');

const patientA = 'pseudonym-synthetic-a', patientB = 'pseudonym-synthetic-b';
const SENTINEL = Object.freeze({
    firstName: 'Zefirina', lastName: 'Quarantotti', taxCode: 'QRNZFR48C42F205X', birthDate: new Date('1948-03-02T00:00:00.000Z'),
    address: 'Via Sentinella 77, 20100 Milano', phone: '+39 347 5550199', caregiver: 'Ottavio Brambillasca',
    diagnoses: 'Ipertensione arteriosa. Quarantotti Zefirina riferisce cefalea dal 14/09/2026.',
    exemptions: '031 per Zefirina Quarantotti, CF QRNZFR48C42F205X',
    notes: 'Paziente Zefirina Quarantotti, nata il 02/03/1948, vive in Via Sentinella 77, 20100 Milano, tel +39 347 5550199.\n'
        + 'Caregiver Ottavio Brambillasca. Visita del 12/10/2026, controllo il 12/01/2027.',
    statusReason: 'Seguita a domicilio da Ottavio Brambillasca', archiveReason: 'Nessuna', archiveNote: 'Nata il 1948-03-02',
});
const IDENTITY = /zefirina|quarantotti|QRNZFR48C42F205X|1948|02\/03|sentinella|5550199|ottavio|brambillasca/iu;
const ROLES: Readonly<Record<string, string>> = { firstName: 'PAZ', lastName: 'PAZ', taxCode: 'CF', birthDate: 'NAS',
    address: 'IND', phone: 'TEL', caregiver: 'PER' };
const placeholder = (role: string) => new RegExp(`^\\[\\[MF_${role}[1-9][0-9]*_[a-z2-7]{8}\\]\\]$`, 'u');
const nonces = (value: unknown) => new Set([...JSON.stringify(value).matchAll(/\[\[MF_[A-Z]+(?:[1-9][0-9]*|[+-][0-9]+)_([a-z2-7]{8})\]\]/gu)].map(match => match[1]));
let webSession: ReturnType<typeof issueSyntheticWebSessionContext>;

function reset(overrides: Partial<typeof patients.$inferInsert> = {}) {
    clearAllSessions();
    dbServer.delete(patientsToAmbulatories).run(); dbServer.delete(patients).run();
    dbServer.delete(ambulatories).run(); dbServer.delete(users).run(); dbServer.delete(settings).run();
    dbServer.insert(ambulatories).values([{ id: 'scope-a', name: 'Synthetic A', type: 'live', isDefault: true }]).run();
    for (const id of [patientA, patientB]) {
        dbServer.insert(patients).values({ id, ...SENTINEL, createdAt: new Date(0), updatedAt: new Date(0), ambulatoryId: 'scope-a',
            version: 4, isArchived: false, isAdi: true, ...overrides }).run();
        dbServer.insert(patientsToAmbulatories).values({ patientId: id, ambulatoryId: 'scope-a' }).run();
    }
    const authority = syntheticNetworkPatientAuthority(dbServer, 'scope-a');
    webSession = issueSyntheticWebSessionContext({ id: authority.session.userId, username: authority.session.username, role: authority.session.role }, Math.random().toString());
    cookieState.cookies.clear(); cookieState.cookies.set('mediflow_session', webSession.session.id);
    cookieState.cookies.set('mediflow_auth_control', webSession.controlId); cookieState.cookies.set('ambulatory_id', 'scope-a');
    return authority;
}
function httpRequest(body: unknown, headers = new Headers()) {
    headers.set('content-type', 'application/json'); headers.set('origin', 'http://127.0.0.1'); headers.set('sec-fetch-site', 'same-origin');
    headers.set('x-mediflow-archive-generation', currentArchiveGeneration()); headers.set('x-mediflow-expected-ambulatory-id', 'scope-a');
    return syntheticLoopbackRequest(`http://127.0.0.1/api/patients/${patientA}/profile-query`, { method: 'POST', headers, body: JSON.stringify(body) });
}
async function select(id = patientA, epoch = 0) {
    const response = await web.POST(httpRequest(open(epoch)), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as ProfileResult;
}
const open = (epoch: number, projection: 'profile' | 'notes' = 'profile'): ProfileQuery => ({ kind: 'open', contractVersion: 1, projection, expectedSelectionEpoch: epoch });
const reread = (result: ProfileResult, projection = result.projection): ProfileQuery => ({ kind: 'read', contractVersion: 1,
    handle: result.handle, expectedRevision: result.currentness.revision, projection });

function ipcChain(port: Awaited<ReturnType<typeof acquirePatientProfileQueryHostPort>>) {
    const webFrames: string[] = [];
    const dispatcher = createPatientProfileQueryWebDispatcher({ readPort: () => port,
        send: frame => { webFrames.push(frame); supervisor.acceptWebFrame(frame); },
        onProtocolFailure: () => { throw new Error('synthetic IPC chain must stay canonical'); } });
    const supervisor = createPatientProfileQuerySupervisorPortV1({ randomBytes,
        sendWeb: (frame, complete) => { complete(null); void dispatcher.accept(frame); },
        schedule: (delay, callback) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
        onTerminal: () => undefined });
    return { supervisor, webFrames };
}

function startMcp(executeProfileQuery: (input: unknown, signal: AbortSignal) => Promise<unknown>) {
    const server = fileURLToPath(new URL('../scripts/intelligent-host-mcp-stdio.mjs', import.meta.url));
    const loader = new URL('../scripts/register-strip-types-loader.mjs', import.meta.url).href;
    const child = spawn(process.execPath, ['--experimental-strip-types', '--import', loader, server], {
        env: { ...createAipOperationRpcChildEnvironmentV1(`aipb_${'4'.repeat(32)}`) } as unknown as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    const host = createAipOperationRpcHostV1({ operations: [{ operationId: 'patient-profile.read.v1', capabilityId: 'patient-profile.read.v1',
        serviceRef: 'PatientProfileQueryHostPortV1', maximumStage: 'read_only', timeoutMs: 5_000, execute: executeProfileQuery }] });
    host.attach({ subscribe: (listener: (frame: unknown) => void) => { child.on('message', listener); return () => child.off('message', listener); },
        publish: (frame: unknown) => { child.send(frame as string); } });
    const { stdin, stdout: output, stderr: errors } = child;
    assert.ok(stdin && output && errors);
    let stdout = '', stderr = '', nextId = 1;
    const pending = new Map<number, (message: Record<string, unknown>) => void>();
    output.setEncoding('utf8'); errors.setEncoding('utf8');
    errors.on('data', chunk => { stderr += chunk; });
    let buffered = '';
    output.on('data', (chunk: string) => {
        stdout += chunk; buffered += chunk;
        for (let newline = buffered.indexOf('\n'); newline >= 0; newline = buffered.indexOf('\n')) {
            const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
            if (!line) continue;
            const message = JSON.parse(line) as Record<string, unknown>;
            const resolve = pending.get(message.id as number);
            if (resolve) { pending.delete(message.id as number); resolve(message); }
        }
    });
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: 'mediflow-profile-pseudonym-test', version: '1.0.0' } };
    const call = (args: ProfileQuery) => new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => reject(new Error(`MCP call ${id} timed out: ${stderr}`)), 15_000);
        pending.set(id, message => { clearTimeout(timer); resolve(message); });
        stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call',
            params: { name: 'patient-profile.read.v1', arguments: args, _meta: meta } })}\n`);
    });
    const stop = async () => { if (child.exitCode === null) { stdin.end(); await new Promise(resolve => child.once('exit', resolve)); } };
    return { call, stop, stdout: () => stdout, stderr: () => stderr, child };
}

test.after(() => { clearAllSessions(); cleanup(); dbServer.$client.close(); rmSync(dataDir, { recursive: true, force: true }); });

test('M1: the MCP stdio transport serves both projections without any identity value of the patient', async t => {
    reset(); const selected = await select();
    const port = await acquirePatientProfileQueryHostPort('profile', Date.now() + 60_000, headlessProfileRelease({})); assert.ok(port);
    const { supervisor } = ipcChain(port);
    const mcp = startMcp((input, signal) => supervisor.executeProfileQuery(input as ProfileQuery, signal));
    t.after(async () => { port.dispose(); await mcp.stop(); });
    const first = await mcp.call(open(selected.currentness.selectionEpoch));
    const result = (first.result as { structuredContent: ProfileResult; isError?: boolean });
    assert.notEqual(result.isError, true, JSON.stringify(first));
    const profile = result.structuredContent;
    assert.equal(isProfileResult(profile), true);
    assert.deepEqual(Object.keys(profile.profile), [...PROFILE_FIELD_NAMES]);
    const fields = profile.profile as ProfileFields;
    for (const [field, role] of Object.entries(ROLES)) assert.match(String(fields[field as keyof ProfileFields]), placeholder(role), field);
    assert.equal(fields.isAdi, true); assert.equal(fields.isArchived, false);
    assert.ok(fields.notes?.includes(fields.firstName) && fields.notes.includes(fields.lastName) && fields.notes.includes(fields.caregiver!)
        && fields.notes.includes(fields.address!) && fields.notes.includes(fields.phone!), fields.notes ?? '');
    assert.ok(fields.exemptions?.includes(fields.taxCode), fields.exemptions ?? '');
    assert.match(fields.notes ?? '', /\[\[MF_NAS[1-9][0-9]*_[a-z2-7]{8}\]\]/u);
    assert.match(fields.notes ?? '', /\[\[MF_GG[+-][0-9]+_[a-z2-7]{8}\]\]/u);
    const notes = await mcp.call(reread(profile, 'notes'));
    assert.deepEqual((notes.result as { structuredContent: ProfileResult }).structuredContent.profile, { notes: fields.notes });
    assert.equal(IDENTITY.test(mcp.stdout()), false, mcp.stdout().match(IDENTITY)?.[0]);
    assert.equal(mcp.stderr(), '');
});

function residualText(released: string): string {
    const nonces = new Set([...released.matchAll(PLACEHOLDER_PATTERN)].map(match => match[4]));
    assert.ok(nonces.size <= 1, `placeholders of different sessions in one release: ${[...nonces].join(', ')}`);
    return released.replace(PLACEHOLDER_PATTERN, '\u0000');
}
const leakedPieces = (released: string, pieces: readonly string[]) => { const residual = residualText(released); return pieces.filter(piece => residual.includes(piece)); };

function withSessionSeed<T>(seed: Buffer, run: () => T): T {
    const original = crypto.randomBytes;
    let pending = true;
    crypto.randomBytes = ((size: number, ...rest: []) => {
        if (pending && size === seed.length) { pending = false; return Buffer.from(seed); }
        return original(size, ...rest);
    }) as typeof crypto.randomBytes;
    syncBuiltinESMExports();
    try { return run(); } finally { crypto.randomBytes = original; syncBuiltinESMExports(); }
}

test('M1 oracle: identity pieces count only outside complete placeholders of the release session', () => {
    const token = (role: string, nonce: string) => `[[MF_${role}_${nonce}]]`;
    assert.deepEqual(leakedPieces(`{"notes":"pz ${token('TEL2', '6sr555d2')} fine"}`, ['555']), []);
    assert.deepEqual(leakedPieces(`{"notes":"pz 555 ${token('TEL2', '6sr555d2')} fine"}`, ['555']), ['555']);
    assert.deepEqual(leakedPieces(`{"notes":"pz [[MF_TEL2_6sr555d2 fine"}`, ['555']), ['555']);
    assert.deepEqual(leakedPieces(`{"notes":"pz [[MF_TEL2_6sr555d9]] fine"}`, ['555']), ['555']);
    assert.deepEqual(leakedPieces(`{"notes":"55${token('TEL1', 'abcdefgh')}5"}`, ['555']), []);
    assert.throws(() => leakedPieces(`${token('TEL1', '6sr555d2')} ${token('TEL2', 'abc555de')}`, ['555']), /different sessions/u);
});

test('M1 oracle: the Web Core failure of #1074 was a session nonce containing 555, and the dictated number never left as text', () => {
    const seed = Buffer.alloc(16);
    seed.writeUInt32BE(4163, 12);
    const source = { firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SNTDAA48C42F205X', birthDate: '1948-03-02T00:00:00.000Z',
        address: 'Via Sintetica 12, Milano', phone: '02 1234 5678', caregiver: 'Carlo Bianchi', diagnoses: null, exemptions: null,
        notes: `${'pz stabile '.repeat(1_200).slice(0, 11_001)} figlio 347 555 0199 fine nota.`, isAdi: null, isArchived: null,
        statusReason: null, archiveReason: null, archiveNote: null } as ProfileFields;
    const released = withSessionSeed(seed, () => {
        const pseudonymizer = createProfilePseudonymizer();
        try { return JSON.stringify(pseudonymizer.project(source, 'profile')); } finally { pseudonymizer.close(); }
    });
    const nonces = [...released.matchAll(PLACEHOLDER_PATTERN)].map(match => match[4]);
    assert.deepEqual([...new Set(nonces)], ['6sr555d2']);
    assert.ok(released.includes('555'));
    assert.ok([...released.matchAll(PLACEHOLDER_PATTERN)].some(match => match[1] === 'TEL' && match[2] === '2'));
    assert.deepEqual(leakedPieces(released, ['347', '555', '0199']), []);
});

test('M1: a free text longer than one preparation releases no identity piece wherever the cut falls', () => {
    const source = { firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SNTDAA48C42F205X', birthDate: '1948-03-02T00:00:00.000Z',
        address: 'Via Sintetica 12, Milano', phone: '02 1234 5678', caregiver: 'Carlo Bianchi', diagnoses: null, exemptions: null,
        notes: null, isAdi: null, isArchived: null, statusReason: null, archiveReason: null, archiveNote: null } as ProfileFields;
    const values = [
        { value: source.phone!, pieces: ['1234', '5678'] },
        { value: source.address!, pieces: ['Sintetica', 'Milano'] },
        { value: source.caregiver!, pieces: ['Carlo', 'Bianchi'] },
        { value: 'figlio 347 555 0199', pieces: ['555', '0199'] },
        { value: 'indirizzo: Via Lontana 9, Pavia', pieces: ['Lontana', 'Pavia'] },
        { value: 'telefono della figlia tre quattro sette cinque cinque cinque zero uno nove nove', pieces: ['quattro', 'cinque', 'nove'] },
    ];
    const positions = [...Array.from({ length: 121 }, (_, index) => 10_900 + index), ...Array.from({ length: 51 }, (_, index) => 11_960 + index)];
    const leaks: string[] = [];
    for (const { value, pieces } of values) {
        for (const position of positions) {
            const notes = `${'pz stabile '.repeat(1_200).slice(0, position - 1)} ${value} fine nota.`;
            for (const projection of ['profile', 'notes'] as const) {
                const pseudonymizer = createProfilePseudonymizer();
                try {
                    const released = JSON.stringify(pseudonymizer.project({ ...source, notes }, projection));
                    const leaked = leakedPieces(released, pieces);
                    if (leaked.length) leaks.push(`${projection} ${position} ${leaked.join('+')} of «${value}»`);
                } finally { pseudonymizer.close(); }
            }
        }
    }
    assert.deepEqual(leaks.slice(0, 12), [], `${leaks.length} leaks`);
    const unbroken = createProfilePseudonymizer();
    try {
        assert.throws(() => unbroken.project({ ...source, notes: `indirizzo: ${'Via Lontana '.repeat(1_100)}` }, 'notes'), { code: 'query_unavailable' });
    } finally { unbroken.close(); }
});

test('M1: an identity value too long for the redactor refuses the read instead of passing through the free text', () => {
    const base = { ...SENTINEL, birthDate: SENTINEL.birthDate.toISOString(), isAdi: null, isArchived: null } as ProfileFields;
    const caregiver = 'Ottavio Brambillasca, figlio, ' + 'reperibile la sera presso la sentinella sintetica, '.repeat(6);
    assert.ok(caregiver.trim().length > 256);
    for (const field of ['caregiver', 'address'] as const) {
        const source = { ...base, [field]: caregiver, notes: 'Riferimento: ' + caregiver };
        for (const projection of ['profile', 'notes'] as const) {
            const pseudonymizer = createProfilePseudonymizer();
            try { assert.throws(() => pseudonymizer.project(source, projection), { code: 'query_unavailable' }); }
            finally { pseudonymizer.close(); }
        }
    }
    const fitting = createProfilePseudonymizer();
    try { assert.match(String((fitting.project({ ...base, caregiver: caregiver.slice(0, 250), notes: caregiver.slice(0, 250) }, 'notes') as { notes: string }).notes), placeholder('PER')); }
    finally { fitting.close(); }
});

test('M2: the substitution happens in the Web owner, so the IPC frame toward the Supervisor carries no identity value', async () => {
    reset(); const selected = await select();
    const port = await acquirePatientProfileQueryHostPort('profile', Date.now() + 60_000, 'pseudonymized'); assert.ok(port);
    try {
        const { supervisor, webFrames } = ipcChain(port);
        const opened = await supervisor.executeProfileQuery(open(selected.currentness.selectionEpoch));
        await supervisor.executeProfileQuery(reread(opened, 'notes'));
        assert.equal(webFrames.length, 2);
        for (const frame of webFrames) {
            assert.equal(JSON.parse(frame).outcome, 'completed');
            assert.equal(IDENTITY.test(frame), false, frame.match(IDENTITY)?.[0]);
        }
    } finally { port.dispose(); }
});

test('M3: Mini keeps the identified profile and only the Supervisor-chosen environment selects it', async () => {
    assert.equal(headlessProfileRelease({ MEDIFLOW_HEADLESS_AGENT_KIND: 'mini' }), 'identified');
    for (const environment of [{}, { MEDIFLOW_HEADLESS_AGENT_KIND: 'mcp' }, { MEDIFLOW_HEADLESS_AGENT_KIND: 'MINI' }, { MEDIFLOW_HEADLESS_AGENT_KIND: '' }]) {
        assert.equal(headlessProfileRelease(environment), 'pseudonymized', JSON.stringify(environment));
    }
    reset(); const selected = await select();
    const port = await acquirePatientProfileQueryHostPort('profile', Date.now() + 60_000, 'identified'); assert.ok(port);
    try {
        const result = await port.executeProfileQuery(open(selected.currentness.selectionEpoch));
        assert.equal(result.profile.notes, SENTINEL.notes);
        assert.equal((result.profile as ProfileFields).taxCode, SENTINEL.taxCode);
    } finally { port.dispose(); }
    const response = await web.POST(httpRequest(reread(selected)), { params: Promise.resolve({ id: patientA }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).profile.firstName, SENTINEL.firstName);
    assert.equal((await acquirePatientProfileQueryHostPort('profile', Date.now() + 60_000, 'mcp' as never)), null);
});

test('M4: one value keeps one placeholder for the whole handle and no correspondence survives retirement', async t => {
    reset(); let selected = await select();
    const port = await acquirePatientProfileQueryHostPort('profile', Date.now() + 60_000, 'pseudonymized'); assert.ok(port);
    const first = await port.executeProfileQuery(open(selected.currentness.selectionEpoch));
    assert.equal(nonces(first).size, 1); assert.match(String((first.profile as ProfileFields).firstName), placeholder('PAZ'));
    const again = await port.executeProfileQuery(reread(first));
    assert.deepEqual(again.profile, first.profile);
    assert.deepEqual((await port.executeProfileQuery(reread(first, 'notes'))).profile, { notes: first.profile.notes });
    const other = await port.executeProfileQuery(open(selected.currentness.selectionEpoch));
    assert.notEqual(other.handle, first.handle);
    assert.equal([...nonces(first)].some(nonce => nonces(other).has(nonce)), false, 'another handle is another correspondence');
    selected = await select(patientB, selected.currentness.selectionEpoch);
    await assert.rejects(port.executeProfileQuery(reread(first)), { code: 'handle_unavailable' });
    port.dispose();
    const replacement = await acquirePatientProfileQueryHostPort('profile', Date.now() + 60_000, 'pseudonymized'); assert.ok(replacement);
    const fresh = await replacement.executeProfileQuery(open(selected.currentness.selectionEpoch));
    assert.equal(nonces(fresh).size, 1);
    assert.equal([...nonces(first)].some(nonce => nonces(fresh).has(nonce)), false);
    const clock = t.mock.method(Date, 'now', () => fresh.currentness.expiresAt + 1);
    await assert.rejects(replacement.executeProfileQuery(reread(fresh)), { code: 'handle_expired' });
    clock.mock.restore(); replacement.dispose();
    await assert.rejects(replacement.executeProfileQuery(reread(fresh)), { code: 'handle_unavailable' });
});

test('M4: a closed correspondence refuses every later projection', () => {
    const pseudonymizer = createProfilePseudonymizer();
    const source = { ...SENTINEL, birthDate: SENTINEL.birthDate.toISOString(), isAdi: null, isArchived: null } as ProfileFields;
    assert.match(String((pseudonymizer.project(source, 'profile') as ProfileFields).firstName), placeholder('PAZ'));
    pseudonymizer.close();
    assert.throws(() => pseudonymizer.project(source, 'profile'), { code: 'query_unavailable' });
});

test('M6: the 32 KiB budget and output_too_large apply to the pseudonymized bytes without truncation', async () => {
    const filler = (length: number) => `Zefirina ${'x'.repeat(length)}`;
    reset({ notes: filler(1_000) }); const selected = await select();
    const measure = async (length: number) => {
        dbServer.update(patients).set({ notes: filler(length) }).where(eq(patients.id, patientA)).run();
        const port = await acquirePatientProfileQueryHostPort('notes', Date.now() + 60_000, 'pseudonymized'); assert.ok(port);
        try { return await port.executeProfileQuery(open(selected.currentness.selectionEpoch, 'notes')); } finally { port.dispose(); }
    };
    const probe = await measure(1_000);
    const exact = 1_000 + PROFILE_QUERY_MAX_RESULT_BYTES - new TextEncoder().encode(JSON.stringify(probe)).byteLength;
    const atLimit = await measure(exact);
    assert.equal(new TextEncoder().encode(JSON.stringify(atLimit)).byteLength, PROFILE_QUERY_MAX_RESULT_BYTES);
    assert.match(atLimit.profile.notes ?? '', /^\[\[MF_PAZ1_[a-z2-7]{8}\]\] x+$/u);
    await assert.rejects(measure(exact + 1), { code: 'output_too_large' });
});

test('M7: pseudonymizing one read of a profile near the budget adds little time', async t => {
    const dense = Array.from({ length: 220 }, (_, index) => `${index}. Zefirina Quarantotti, CF QRNZFR48C42F205X, controllo del `
        + `1${index % 9}/10/2026 con Ottavio Brambillasca, tel +39 347 5550199. `).join('\n');
    const ordinary = 'Paziente in trattamento per ipertensione arteriosa, controllo pressorio settimanale e dieta iposodica. '.repeat(290)
        + 'Riferisce Zefirina Quarantotti di stare meglio dal 12/10/2026.';
    for (const [label, notes] of [['ordinary', ordinary], ['dense', dense]] as const) {
        const source = { ...SENTINEL, birthDate: SENTINEL.birthDate.toISOString(), notes, diagnoses: 'Ipertensione arteriosa, dislipidemia.',
            isAdi: true, isArchived: false } as ProfileFields;
        const samples: number[] = [];
        for (let run = 0; run < 41; run++) {
            const pseudonymizer = createProfilePseudonymizer();
            const started = process.hrtime.bigint();
            const released = pseudonymizer.project(source, 'profile') as ProfileFields;
            samples.push(Number(process.hrtime.bigint() - started) / 1e6);
            pseudonymizer.close();
            assert.equal(IDENTITY.test(JSON.stringify(released)), false);
        }
        const sorted = samples.slice(1).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)]!, maximum = sorted[sorted.length - 1]!;
        t.diagnostic(`${label}: source ${new TextEncoder().encode(JSON.stringify(source)).byteLength} bytes, median ${median.toFixed(3)} ms, max ${maximum.toFixed(3)} ms`);
        assert.ok(median < 50, `${label} median ${median} ms`);
    }
});
