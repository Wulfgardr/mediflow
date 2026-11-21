import { syntheticTaxCode } from './patient-identity.test-support.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { sealPatientDocumentFile, openPatientDocumentFile } from './security/attachment-file-envelope';
import { installNetworkPatientCookieFixture } from './network-patient-authority-test-fixture';

const data = mkdtempSync(join(tmpdir(), 'mediflow-web-patient-document-'));
process.env.MEDIFLOW_DATA_DIR = data;
const load = createRequire(import.meta.url), cookies = { cookies: new Map<string, string>() };
const cleanupCookies = installNetworkPatientCookieFixture(data, cookies);
const { dbServer, openDbServer } = load('./db-server.ts') as typeof import('./db-server');
openDbServer();
const { ambulatories, users } = load('./schema.ts') as typeof import('./schema');
const { currentArchiveGeneration } = load('./security/archive-session-generation.ts') as typeof import('./security/archive-session-generation');
const { issueSyntheticWebSession, retireSyntheticWebSession } = load('./security/web-auth-lifecycle-owner-test-fixture.ts') as typeof import('./security/web-auth-lifecycle-owner-test-fixture');

const state = { session: null as unknown };
const symbol = `synthetic-web-patient-document-${randomUUID()}`;
(globalThis as unknown as Record<symbol, typeof state>)[Symbol.for(symbol)] = state;
const auth = join(data, 'web-auth.cjs');
writeFileSync(auth, `exports.requireSession=async()=>globalThis[Symbol.for(${JSON.stringify(symbol)})].session;`);
const { registerHooks } = load('node:module') as { registerHooks: (hooks: { resolve: (specifier: string, context: unknown,
    next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister(): void } };
const hooks = registerHooks({ resolve(specifier, context, next) {
    return specifier === '@/lib/security/server-auth' ? { url: pathToFileURL(auth).href, shortCircuit: true } : next(specifier, context);
} });
const { POST } = load('../app/api/patients/document-create/route.ts') as typeof import('../app/api/patients/document-create/route');

const master = randomBytes(32), pin = ['1', '3', '5', '7'].join(''), wrongPin = ['0', '0', '0', '0'].join(''), generation = currentArchiveGeneration();
function seal(value: string) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', master, iv);
    const sealed = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]);
    return `ENC:${iv.toString('base64')}:${sealed.toString('base64')}`;
}
const masterKey = () => crypto.subtle.importKey('raw', master, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function documentSource(text = 'Nome: Lucia\nCognome: Inventata\nDocumento inventato per la prova') {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText(text, { font, size: 12, x: 40, y: 700 });
    const bytes = Buffer.from(await pdf.save());
    return { bytes, source: { name: seal('referto-inventato.pdf'), path: seal('referto-inventato.pdf'),
        original: bytes.toString('base64'), ...await sealPatientDocumentFile(new Uint8Array(bytes), await masterKey()) } };
}
function operator(suffix: string, operatorPin = pin) {
    const id = `synthetic-web-document-${suffix}-${randomUUID()}`;
    dbServer.insert(users).values({ id, username: id, role: 'admin', passwordHash: bcrypt.hashSync(operatorPin, 4),
        salt: 'synthetic', encryptedMasterKey: 'synthetic' }).run();
    return issueSyntheticWebSession({ id, username: id, role: 'admin' }, suffix + randomUUID());
}
const scope = randomUUID();
dbServer.insert(ambulatories).values({ id: scope, name: 'Ambulatorio inventato', isDefault: true }).run();
cookies.cookies.set('ambulatory_id', scope);

async function call(body: unknown) {
    const response = await POST(new Request('http://127.0.0.1/api/patients/document-create', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mediflow-archive-generation': generation }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() as Record<string, unknown> };
}
const review = (lastName = `Inventata-${randomUUID()}`, duplicate: 'none' | 'create-separate' = 'none') => ({
    firstName: { action: 'correct', value: 'Lucia' }, lastName: { action: 'correct', value: lastName },
    taxCode: { action: 'correct', value: syntheticTaxCode(randomUUID()) }, birthDate: { action: 'correct', value: '1980-02-03' }, duplicate });
function effects() {
    return ['patients', 'patients_to_ambulatories', 'attachments'].map(table =>
        (dbServer.$client.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n);
}
async function staged() {
    const { bytes, source } = await documentSource();
    const view = await call({ operation: 'stage', source });
    assert.equal(view.status, 200, JSON.stringify(view.body));
    return { bytes, view: view.body as { commandId: string; viewId: string; text: string; identity: string; quality: string; candidates: object } };
}

test('Web session creates a patient from a document only after review and PIN, with the sealed source attached', async () => {
    state.session = operator('happy');
    const before = effects(), { bytes, view } = await staged();
    assert.match(view.text, /Lucia/u);
    assert.equal(view.identity, 'ambiguous'); assert.equal(view.quality, 'uncertain'); assert.deepEqual(view.candidates, {});
    assert.deepEqual(effects(), before, 'stage writes no patient');
    const preview = await call({ operation: 'preview', commandId: view.commandId, viewId: view.viewId, review: review() });
    assert.deepEqual(preview, { status: 200, body: { commandId: view.commandId, status: 'preview' } });
    assert.deepEqual(effects(), before, 'preview writes no patient');
    const applied = await call({ operation: 'execute', commandId: view.commandId, pin });
    assert.equal(applied.status, 200); assert.equal(applied.body.outcome, 'applied');
    assert.equal(applied.body.attachmentReadback, 'client-verification-required');
    assert.deepEqual(effects(), before.map(n => n + 1));
    const row = dbServer.$client.prepare('SELECT a.data, a.patient_id, p.first_name FROM attachments a JOIN patients p ON p.id = a.patient_id WHERE a.id = ?')
        .get(applied.body.attachmentId) as { data: string; patient_id: string; first_name: string };
    assert.equal(row.patient_id, applied.body.patientId);
    assert.equal(await openPatientDocumentFile(row.data, await masterKey()), `data:application/pdf;base64,${bytes.toString('base64')}`);
    const audit = dbServer.$client.prepare('SELECT source_surface FROM audit_events WHERE event_id = ?').get(view.commandId) as { source_surface: string };
    assert.equal(audit.source_surface, 'web');
    // A lost response is recovered by reading the receipt: same references, no second creation.
    assert.deepEqual(await call({ operation: 'receipt', commandId: view.commandId }), applied);
    assert.equal((await call({ operation: 'execute', commandId: view.commandId, pin })).status, 403);
    assert.deepEqual(effects(), before.map(n => n + 1));
});

test('without confirmation nothing is created: cancel retires, wrong PIN retires, lock voids the work', async () => {
    state.session = operator('negative');
    const before = effects();
    const cancelled = await staged();
    assert.deepEqual(await call({ operation: 'revoke', commandId: cancelled.view.commandId }), { status: 200, body: { outcome: 'retired' } });
    assert.equal((await call({ operation: 'preview', commandId: cancelled.view.commandId, viewId: cancelled.view.viewId, review: review() })).status, 403);

    const wrong = await staged();
    await call({ operation: 'preview', commandId: wrong.view.commandId, viewId: wrong.view.viewId, review: review() });
    assert.equal((await call({ operation: 'execute', commandId: wrong.view.commandId, pin: wrongPin })).status, 403);
    assert.deepEqual((await call({ operation: 'receipt', commandId: wrong.view.commandId })).body, { outcome: 'retired' });
    assert.deepEqual(effects(), before);
});

test('route boundary rejects over-long passphrases with 400 without counting attempts and accepts short alphanumeric PINs', async () => {
    const active = operator('route-pin-boundary');
    state.session = active;
    const attempts = () => (dbServer.$client.prepare('SELECT failed_login_attempts n FROM users WHERE id = ?').get(active.userId) as { n: number }).n;
    const commandId = randomUUID();
    const alphanumericPin = ['AbC', '!09'].join('');
    assert.equal(attempts(), 0);
    for (const candidate of ['cavallo batteria graffetta corretta', 'demo086086', '123456789']) {
        assert.equal((await call({ operation: 'execute', commandId, pin: candidate })).status, 400, candidate);
        assert.equal(attempts(), 0, candidate);
    }
    const alphanumeric = await call({ operation: 'execute', commandId, pin: alphanumericPin });
    assert.notEqual(alphanumeric.status, 400);
    assert.equal(alphanumeric.status, 403);
    assert.equal(attempts(), 0);
});

test('a passphrase or over-long PIN is rejected at the route boundary with 400 before verification and does not consume a lockout attempt', async () => {
    const active = operator('overlong-pin');
    state.session = active;
    const before = effects();
    const { view } = await staged();
    assert.equal((await call({ operation: 'preview', commandId: view.commandId, viewId: view.viewId, review: review() })).status, 200);
    const attempts = () => (dbServer.$client.prepare('SELECT failed_login_attempts n FROM users WHERE id = ?').get(active.userId) as { n: number }).n;
    assert.equal(attempts(), 0);
    for (const candidate of ['cavallo batteria graffetta corretta', 'demo086086', '123456789']) {
        assert.equal((await call({ operation: 'execute', commandId: view.commandId, pin: candidate })).status, 400, candidate);
        assert.equal(attempts(), 0, candidate);
    }
    const applied = await call({ operation: 'execute', commandId: view.commandId, pin });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.outcome, 'applied');
    assert.equal(attempts(), 0);
    assert.deepEqual(effects(), before.map(n => n + 1));
});

test('a short alphanumeric PIN is accepted by document-create and does not fail with 400', async () => {
    const alphanumericPin = ['AbC', '!09'].join('');
    state.session = operator('alphanumeric-pin', alphanumericPin);
    const before = effects();
    const { view } = await staged();
    assert.equal((await call({ operation: 'preview', commandId: view.commandId, viewId: view.viewId, review: review() })).status, 200);
    const applied = await call({ operation: 'execute', commandId: view.commandId, pin: alphanumericPin });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.outcome, 'applied');
    assert.deepEqual(effects(), before.map(n => n + 1));

    state.session = operator('alphanumeric-mismatch');
    const other = await staged();
    assert.equal((await call({ operation: 'preview', commandId: other.view.commandId, viewId: other.view.viewId, review: review() })).status, 200);
    const mismatch = await call({ operation: 'execute', commandId: other.view.commandId, pin: alphanumericPin });
    assert.equal(mismatch.status, 403);
});

test('moved ambulatory and lock void staged work without creating patients', async () => {
    state.session = operator('negative-scope');
    const before = effects();

    const moved = await staged(), other = randomUUID();
    dbServer.insert(ambulatories).values({ id: other, name: 'Altro ambulatorio inventato' }).run();
    cookies.cookies.set('ambulatory_id', other);
    assert.equal((await call({ operation: 'preview', commandId: moved.view.commandId, viewId: moved.view.viewId, review: review() })).status, 403);
    cookies.cookies.set('ambulatory_id', scope);
    assert.equal((await call({ operation: 'preview', commandId: moved.view.commandId, viewId: moved.view.viewId, review: review() })).status, 403,
        'returning to the first ambulatory does not revive retired work');

    const locked = await staged(), lockedSession = state.session as Parameters<typeof retireSyntheticWebSession>[0];
    retireSyntheticWebSession(lockedSession);
    assert.equal((await call({ operation: 'stage', source: (await documentSource()).source })).status, 403, 'a locked session cannot stage');
    assert.equal((await call({ operation: 'preview', commandId: locked.view.commandId, viewId: locked.view.viewId, review: review() })).status, 403);
    state.session = operator('negative-after-lock');
    assert.equal((await call({ operation: 'preview', commandId: locked.view.commandId, viewId: locked.view.viewId, review: review() })).status, 403);
    assert.equal((await call({ operation: 'execute', commandId: locked.view.commandId, pin })).status, 403);
    assert.deepEqual((await call({ operation: 'revoke', commandId: locked.view.commandId })).body, { outcome: 'unknown' });
    assert.deepEqual(effects(), before);
});

test('duplicate identity requires the explicit separate choice and never merges', async () => {
    state.session = operator('duplicate');
    const lastName = `Doppia-${randomUUID()}`;
    const first = await staged();
    await call({ operation: 'preview', commandId: first.view.commandId, viewId: first.view.viewId, review: review(lastName) });
    assert.equal((await call({ operation: 'execute', commandId: first.view.commandId, pin })).body.outcome, 'applied');
    const before = effects(), second = await staged();
    assert.deepEqual(await call({ operation: 'preview', commandId: second.view.commandId, viewId: second.view.viewId, review: review(lastName) }),
        { status: 409, body: { status: 'duplicate-review-required' } });
    await call({ operation: 'preview', commandId: second.view.commandId, viewId: second.view.viewId, review: review(lastName, 'create-separate') });
    assert.equal((await call({ operation: 'execute', commandId: second.view.commandId, pin })).body.outcome, 'applied');
    assert.deepEqual(effects(), before.map(n => n + 1));
});

test('Web requires a declared absence and one valid birth representation, and empty identifiers do not collide', async () => {
    state.session = operator('no-identifier');
    const common = (lastName: string) => ({ firstName: { action: 'correct', value: 'Lucia' },
        lastName: { action: 'correct', value: lastName }, duplicate: 'none' });
    const before = effects();
    const { view } = await staged();
    const preview = (review: unknown) => call({ operation: 'preview', commandId: view.commandId, viewId: view.viewId, review });
    const birthDate = { action: 'correct', value: '1980-02-03' };
    const names = common('Esatta');
    for (const invalid of [
        { ...names, birthDate },
        { ...names, identifierType: 'cf', birthDate },
        { ...names, identifierType: 'none' },
        { ...names, identifierType: 'none', birthDate, taxCode: { action: 'correct', value: syntheticTaxCode() } },
        { ...names, identifierType: 'none', birthYear: '1980' },
        { ...names, identifierType: 'none', birthYear: 1850.5 },
        { ...names, identifierType: 'none', birthYear: 9999 },
        { ...names, identifierType: 'none', birthYear: 1980, birthDate },
        { ...names, identifierType: 'none', birthDate: { ...birthDate, value: '1980-02-31' } },
        { ...names, identifierType: 'none', birthDate: { ...birthDate, action: 'approve' } },
        { ...names, firstName: undefined, identifierType: 'none', birthDate },
    ]) assert.equal((await preview(invalid)).status, 403, JSON.stringify(invalid));
    assert.deepEqual(effects(), before);

    assert.equal((await preview({ ...names, identifierType: 'none', birthDate })).status, 200);
    assert.deepEqual(effects(), before);
    const first = await call({ operation: 'execute', commandId: view.commandId, pin });
    assert.equal(first.body.outcome, 'applied');
    const second = await staged();
    assert.equal((await call({ operation: 'preview', commandId: second.view.commandId, viewId: second.view.viewId,
        review: { ...common('Stimata'), identifierType: 'none', birthYear: 1974 } })).status, 200);
    const applied = await call({ operation: 'execute', commandId: second.view.commandId, pin });
    assert.equal(applied.body.outcome, 'applied');
    assert.deepEqual(effects(), before.map(n => n + 2));
    const row = dbServer.$client.prepare('SELECT tax_code, identifier_type, birth_date, birth_date_precision, birth_year FROM patients WHERE id = ?');
    assert.deepEqual(row.get(first.body.patientId), { tax_code: '', identifier_type: 'none', birth_date: Date.parse(birthDate.value) / 1000, birth_date_precision: 'exact', birth_year: null });
    assert.deepEqual(row.get(applied.body.patientId), { tax_code: '', identifier_type: 'none', birth_date: null, birth_date_precision: 'estimated', birth_year: 1974 });

    const wrong = await staged();
    assert.equal((await call({ operation: 'preview', commandId: wrong.view.commandId, viewId: wrong.view.viewId,
        review: { ...common('Ritirata'), identifierType: 'none', birthYear: 1975 } })).status, 200);
    assert.equal((await call({ operation: 'execute', commandId: wrong.view.commandId, pin: wrongPin })).status, 403);
    assert.deepEqual((await call({ operation: 'receipt', commandId: wrong.view.commandId })).body, { outcome: 'retired' });
    assert.deepEqual(effects(), before.map(n => n + 2));
});

test('Web preserves legacy CF payloads and validates CF when the type is declared', async () => {
    state.session = operator('legacy-identifier');
    const { view } = await staged();
    const legacy = { ...review('Storica'), taxCode: { action: 'correct', value: 'LEGACY-INVENTATO' } };
    const preview = (review: unknown) => call({ operation: 'preview', commandId: view.commandId, viewId: view.viewId, review });
    assert.equal((await preview({ ...legacy, identifierType: 'cf' })).status, 403);
    assert.equal((await preview(legacy)).status, 200);
    const applied = await call({ operation: 'execute', commandId: view.commandId, pin });
    assert.equal(applied.body.outcome, 'applied');
    assert.deepEqual(dbServer.$client.prepare('SELECT tax_code, identifier_type FROM patients WHERE id = ?').get(applied.body.patientId),
        { tax_code: legacy.taxCode.value, identifier_type: 'cf' });
});

test('a second document while the session still holds one is refused as work in progress, not as a lock', async () => {
    state.session = operator('in-progress');
    const first = await staged();
    assert.deepEqual(await call({ operation: 'stage', source: (await documentSource()).source }), { status: 409, body: { status: 'in-progress' } });
    assert.deepEqual((await call({ operation: 'revoke', commandId: first.view.commandId })).body, { outcome: 'retired' });
    const second = await staged();
    assert.deepEqual((await call({ operation: 'revoke', commandId: second.view.commandId })).body, { outcome: 'retired' });
});

test('the route admits only an authenticated local Web admin with the current archive', async () => {
    const { source } = await documentSource();
    state.session = null;
    assert.equal((await call({ operation: 'stage', source })).status, 401);
    state.session = operator('archive');
    const stale = await POST(new Request('http://127.0.0.1/api/patients/document-create', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mediflow-archive-generation': randomUUID() }, body: JSON.stringify({ operation: 'stage', source }) }));
    assert.equal(stale.status, 409);
    const id = `synthetic-web-document-user-${randomUUID()}`;
    dbServer.insert(users).values({ id, username: id, role: 'user', passwordHash: 'synthetic', salt: 'synthetic', encryptedMasterKey: 'synthetic' }).run();
    state.session = issueSyntheticWebSession({ id, username: id, role: 'user' }, randomUUID());
    assert.equal((await call({ operation: 'stage', source })).status, 403);
    dbServer.update(users).set({ role: 'admin' }).where(eq(users.id, id)).run();
});

test.after(() => {
    hooks.deregister(); cleanupCookies();
    delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for(symbol)];
    dbServer.$client.close();
});
