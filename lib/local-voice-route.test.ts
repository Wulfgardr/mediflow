import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { bindSyntheticArchiveSessions } from './security/web-auth-lifecycle-owner-test-fixture';
import { startFakeLocalVoice } from './local-voice/fake-service.test-support.ts';
import { createLocalVoiceBridge } from './local-voice/web-bridge';

const load = createRequire(import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'mediflow-local-voice-route-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
const caller: { session: Record<string, unknown> | null } = { session: null };
(globalThis as unknown as Record<symbol, typeof caller>)[Symbol.for(dataDir)] = caller;
const authPath = join(dataDir, 'auth.cjs');
writeFileSync(authPath, `const state=globalThis[Symbol.for(${JSON.stringify(dataDir)})];
exports.requireSession=async()=>state.session;
exports.unauthorizedResponse=()=>Response.json({error:'Unauthorized'},{status:401});`, { mode: 0o600 });
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: unknown, next: (specifier: string, context: unknown) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
const hooks = registerHooks({ resolve(specifier, context, next) {
    return specifier === '@/lib/security/server-auth' ? { url: pathToFileURL(authPath).href, shortCircuit: true } : next(specifier, context);
} });
const generation = bindSyntheticArchiveSessions('voice-web-a', 'voice-web-b');
const root = load('../app/api/local-voice/route.ts') as typeof import('../app/api/local-voice/route.ts');
const item = load('../app/api/local-voice/[id]/route.ts') as typeof import('../app/api/local-voice/[id]/route.ts');
const commands = load('../app/api/local-voice/[id]/commands/route.ts') as typeof import('../app/api/local-voice/[id]/commands/route.ts');
const audio = load('../app/api/local-voice/[id]/audio/route.ts') as typeof import('../app/api/local-voice/[id]/audio/route.ts');

const secret = crypto.randomBytes(32).toString('hex');
const lines = [
    { speaker: 'doctor' as const, text: 'Buongiorno, come va la pressione?' },
    { speaker: 'patient' as const, text: 'Bene, prendo il Ramipli ogni mattina.' },
];
const fake = await startFakeLocalVoice({ secret, lines, drugSuggestions: [{ original: 'Ramipli', replacement: 'Ramipril' }] });
process.env.MEDIFLOW_LOCAL_VOICE_URL = fake.url;
process.env.MEDIFLOW_LOCAL_VOICE_SECRET = secret;

after(async () => {
    hooks.deregister();
    await fake.close();
    rmSync(dataDir, { recursive: true, force: true });
});

const USER_A = { id: 'voice-web-a', userId: 'voice-user-a', role: 'clinician', authChannel: 'web' };
const USER_B = { id: 'voice-web-b', userId: 'voice-user-b', role: 'clinician', authChannel: 'web' };
const PATIENT_A = 'paziente:11111111-1111-4111-8111-111111111111';
const PATIENT_B = 'paziente:22222222-2222-4222-8222-222222222222';
const BASE = 'http://127.0.0.1:3000';

function page(path: string, init: { method?: string; body?: BodyInit; json?: unknown; headers?: Record<string, string> } = {}) {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = { host: '127.0.0.1:3000', 'sec-fetch-site': 'same-origin', ...(method === 'GET' ? {} : { origin: BASE, 'x-mediflow-archive-generation': generation }) };
    if (init.json !== undefined) headers['content-type'] = 'application/json';
    if (init.body !== undefined) headers['content-type'] = 'application/octet-stream';
    return new Request(`${BASE}${path}`, { method, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, headers: { ...headers, ...init.headers } });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const as = async <T>(session: Record<string, unknown> | null, run: () => Promise<T>) => { caller.session = session; try { return await run(); } finally { caller.session = null; } };
const block = (marker: number) => { const pcm = new Int16Array(800).fill(marker); return new Uint8Array(pcm.buffer); };
const sentToService = () => fake.state.requests.length;

function diskImage(dir: string): Map<string, string> {
    const files = new Map<string, string>();
    for (const name of readdirSync(dir, { recursive: true }) as string[]) {
        const path = join(dir, name);
        if (statSync(path).isFile()) files.set(name, crypto.createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
    return files;
}

test('refuses callers without a Web session, from another origin or channel, before reaching the service', async () => {
    const before = sentToService();
    assert.equal((await as(null, () => root.GET(page(`/api/local-voice?subject=${PATIENT_A}`)))).status, 401);
    assert.equal((await as(null, () => root.POST(page('/api/local-voice', { method: 'POST', json: { subject: PATIENT_A, mode: 'visit' } })))).status, 401);
    assert.equal((await as({ ...USER_A, authChannel: 'native' }, () => root.GET(page(`/api/local-voice?subject=${PATIENT_A}`)))).status, 403);
    const foreign = ['attacker', 'example'].join('.');
    const foreignOrigin = (() => { const url = new URL(BASE); url.hostname = foreign; return url.origin; })();
    const cases = [
        page('/api/local-voice', { method: 'POST', json: { subject: PATIENT_A, mode: 'visit' }, headers: { origin: foreignOrigin } }),
        page('/api/local-voice', { method: 'POST', json: { subject: PATIENT_A, mode: 'visit' }, headers: { 'sec-fetch-site': 'cross-site' } }),
        page(`/api/local-voice?subject=${PATIENT_A}`, { headers: { 'sec-fetch-site': 'same-site' } }),
        page(`/api/local-voice?subject=${PATIENT_A}`, { headers: { host: `${foreign}:3000` } }),
    ];
    for (const request of cases) assert.equal((await as(USER_A, () => request.method === 'GET' ? root.GET(request) : root.POST(request))).status, 403);
    const stale = page('/api/local-voice', { method: 'POST', json: { subject: PATIENT_A, mode: 'visit' }, headers: { 'x-mediflow-archive-generation': 'other' } });
    assert.equal((await as(USER_A, () => root.POST(stale))).status, 409);
    assert.equal(sentToService(), before);
});

test('a subject that is not an opaque patient or first-visit reference never reaches the service', async () => {
    const before = sentToService();
    for (const subject of ['paziente:Mario Rossi', 'altro:12345678', '', 'paziente:../../x']) {
        assert.equal((await as(USER_A, () => root.POST(page('/api/local-voice', { method: 'POST', json: { subject, mode: 'visit' } })))).status, 400);
    }
    assert.equal(sentToService(), before);
});

test('availability: service absent, model missing, ready', async () => {
    assert.deepEqual(await createLocalVoiceBridge({ endpoint: () => null, platform: 'linux' }).status('u', PATIENT_A), { status: 200, body: { availability: 'unsupported', session: null } });
    assert.deepEqual(await createLocalVoiceBridge({ endpoint: () => null, platform: 'darwin' }).status('u', PATIENT_A), { status: 200, body: { availability: 'off', session: null } });
    const silent = createLocalVoiceBridge({ endpoint: () => ({ url: 'http://127.0.0.1:9', secret }), platform: 'darwin' });
    assert.deepEqual((await silent.status('u', PATIENT_A)).body, { availability: 'off', session: null });
    const impostor = createLocalVoiceBridge({ endpoint: () => ({ url: fake.url, secret: crypto.randomBytes(32).toString('hex') }) });
    assert.deepEqual((await impostor.status('u', PATIENT_A)).body, { availability: 'off', session: null });

    fake.state.model = 'missing';
    const missing = await as(USER_A, () => root.GET(page(`/api/local-voice?subject=${PATIENT_A}`)));
    assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await missing.json(), { availability: 'model-missing', session: null });
    const refused = await as(USER_A, () => root.POST(page('/api/local-voice', { method: 'POST', json: { subject: PATIENT_A, mode: 'visit' } })));
    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), { error: 'model-missing' });
    fake.state.model = 'ready';
    assert.deepEqual(await (await as(USER_A, () => root.GET(page(`/api/local-voice?subject=${PATIENT_A}`)))).json(), { availability: 'ready', session: null });
});

test('a visit goes through in order, reaches only its user and its subject, and leaves nothing on disk', async () => {
    const disk = diskImage(dataDir);
    const created = await as(USER_A, () => root.POST(page('/api/local-voice', { method: 'POST', json: { subject: PATIENT_A, mode: 'visit', vocabulary: ['Ramipril', 7, 'Ramipril'] } })));
    assert.equal(created.status, 200);
    const session = await created.json() as { id: string; subject: string; state: string };
    assert.equal(session.subject, PATIENT_A);
    assert.equal(session.state, 'ready');
    assert.deepEqual((fake.state.session as unknown as { vocabulary: string[] }).vocabulary, ['Ramipril']);
    const started = await as(USER_A, () => item.GET(page(`/api/local-voice/${session.id}?subject=${PATIENT_A}`), params(session.id)));
    assert.equal((await started.json() as { state: string }).state, 'preparing');

    const send = (seq: number, marker: number, subject = PATIENT_A, user = USER_A) =>
        as(user, () => audio.POST(page(`/api/local-voice/${session.id}/audio?subject=${subject}&seq=${seq}`, { method: 'POST', body: block(marker) }), params(session.id)));
    assert.equal((await send(0, 100)).status, 202);
    const [early, second] = await Promise.all([send(2, 300), send(1, 200)]);
    assert.equal(second.status, 202);
    assert.equal(early.status, 409);
    assert.equal((await send(2, 300)).status, 202);
    const repeated = await send(1, 200);
    assert.equal(repeated.status, 202);
    assert.deepEqual(await repeated.json(), { sequence: 1, repeated: true });
    assert.deepEqual(fake.state.blocks.map((item) => new Int16Array(item.buffer, item.byteOffset, item.byteLength / 2)[0]), [100, 200, 300]);
    assert.equal((await send(3, 400, PATIENT_B)).status, 404);
    assert.equal((await send(3, 400, PATIENT_A, USER_B)).status, 404);
    assert.equal(fake.state.blocks.length, 3);

    const command = (name: string, subject = PATIENT_A, user = USER_A) =>
        as(user, () => commands.POST(page(`/api/local-voice/${session.id}/commands`, { method: 'POST', json: { subject, command: name } }), params(session.id)));
    assert.equal((await command('pause')).status, 200);
    assert.equal((await command('resume', PATIENT_B)).status, 404);
    assert.equal((await command('resume')).status, 200);
    assert.equal((await command('start')).status, 400);
    fake.state.stopFailures = 6;
    const notYet = await command('stop');
    assert.equal(notYet.status, 503);
    assert.deepEqual(await notYet.json(), { error: 'draining' });
    assert.equal(fake.state.session?.state, 'recording');
    assert.equal((await command('stop')).status, 200);

    const read = (subject: string, user = USER_A) => as(user, () => item.GET(page(`/api/local-voice/${session.id}?subject=${subject}`), params(session.id)));
    const review = await (await read(PATIENT_A)).json() as { review: { text: string; drugSuggestions: unknown[] } };
    assert.equal(review.review.text, 'Medico: Buongiorno, come va la pressione?\nPaziente: Bene, prendo il Ramipli ogni mattina.');
    assert.equal(review.review.drugSuggestions.length, 1);
    for (const [subject, user] of [[PATIENT_B, USER_A], [PATIENT_A, USER_B]] as const) {
        const refused = await read(subject, user);
        assert.equal(refused.status, 404);
        assert.doesNotMatch(await refused.text(), /Ramipli|Buongiorno/u);
    }

    const otherStatus = await (await as(USER_B, () => root.GET(page(`/api/local-voice?subject=${PATIENT_A}`)))).json();
    assert.deepEqual(otherStatus.session, { id: null, state: 'review', own: false, foreign: { kind: 'other-user' } });
    const elsewhere = await (await as(USER_A, () => root.GET(page(`/api/local-voice?subject=${PATIENT_B}`)))).json();
    assert.deepEqual(elsewhere.session.foreign, { kind: 'patient', subject: PATIENT_A, patientId: PATIENT_A.slice('paziente:'.length) });
    assert.equal((await as(USER_A, () => root.POST(page('/api/local-voice', { method: 'POST', json: { subject: PATIENT_B, mode: 'visit' } })))).status, 409);

    fake.state.subjectOverride = PATIENT_B;
    const swapped = await read(PATIENT_A);
    assert.equal(swapped.status, 409);
    assert.deepEqual(await swapped.json(), { error: 'subject-mismatch' });
    fake.state.subjectOverride = null;

    assert.equal((await as(USER_B, () => item.DELETE(page(`/api/local-voice/${session.id}?subject=${PATIENT_A}`, { method: 'DELETE' }), params(session.id)))).status, 404);
    assert.equal((await as(USER_A, () => item.DELETE(page(`/api/local-voice/${session.id}?subject=${PATIENT_A}`, { method: 'DELETE' }), params(session.id)))).status, 204);
    assert.equal(fake.state.session, null);
    assert.deepEqual(diskImage(dataDir), disk);
});

test('a service that answers for another subject at creation is told to forget it', async () => {
    const original = fake.state.subjectOverride;
    fake.state.subjectOverride = PATIENT_B;
    const response = await as(USER_A, () => root.POST(page('/api/local-voice', { method: 'POST', json: { subject: PATIENT_A, mode: 'visit' } })));
    fake.state.subjectOverride = original;
    assert.equal(response.status, 409);
    assert.equal(fake.state.session, null);
});
