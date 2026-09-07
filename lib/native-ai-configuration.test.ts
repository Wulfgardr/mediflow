/* @Codex */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readNativeConfigurationGrant, NativeConfigurationGrantError } from './native-ai-configuration-grants.ts';
import { createNativeConfigurationHttp } from './native-ai-configuration-http.ts';
import { createFunctionModelPreferencesService, FUNCTION_SWITCH_KEYS, FunctionModelError } from './ai-providers/fabric/function-model-preferences.ts';
import { createNativeServerSession, peekSession, registerServerSessionResource, deleteSession } from './security/server-session.ts';

const principal = { userId: 'synthetic-admin', clientId: 'synthetic-mac', role: 'admin' };
const grantValue = (expiresAt = Date.now() + 60_000) => ({ schemaVersion: 'mediflow.native-ai-grants.v1', grants: [
    { grantId: 'synthetic-grant', userId: principal.userId, clientId: principal.clientId, capability: 'native.ai.configure', expiresAt },
] });
function grantFixture() {
    const dir = mkdtempSync(join(tmpdir(), 'mediflow-native-grant-'));
    const file = join(dir, 'grant.json');
    const write = (value = grantValue()) => writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    write(); return { dir, file, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
test('explicit private grant: exact operator/device/admin, expiry, permissions, schema and duplicates', () => {
    const f = grantFixture();
    try {
        assert.equal(readNativeConfigurationGrant(f.file, principal).length, 64);
        for (const path of [undefined, 'relative', join(f.dir, 'missing')]) assert.throws(() => readNativeConfigurationGrant(path, principal));
        for (const p of [{ ...principal, role: 'user' }, { ...principal, userId: 'other' }, { ...principal, clientId: 'other' }]) assert.throws(() => readNativeConfigurationGrant(f.file, p));
        chmodSync(f.file, 0o644); assert.throws(() => readNativeConfigurationGrant(f.file, principal)); chmodSync(f.file, 0o600);
        const link = join(f.dir, 'link'); symlinkSync(f.file, link); assert.throws(() => readNativeConfigurationGrant(link, principal));
        f.write(grantValue(Date.now() - 1)); assert.throws(() => readNativeConfigurationGrant(f.file, principal));
        f.write(grantValue(Date.now() + 86_500_000)); assert.throws(() => readNativeConfigurationGrant(f.file, principal));
        const duplicate = grantValue(); duplicate.grants.push({ ...duplicate.grants[0], grantId: 'duplicate' });
        f.write(duplicate); assert.throws(() => readNativeConfigurationGrant(f.file, principal));
        writeFileSync(f.file, 'x'.repeat(16_385)); assert.throws(() => readNativeConfigurationGrant(f.file, principal));
    } finally { f.cleanup(); }
});
function fixture() {
    const f = grantFixture();
    const session = createNativeServerSession({ id: principal.userId, username: 'synthetic', role: 'admin' },
        { clientId: principal.clientId, clientPlatform: 'macos' });
    let settings: Record<string, string> = { aiProvider: 'ollama', aiModel: 'synthetic:1', ...Object.fromEntries(Object.values(FUNCTION_SWITCH_KEYS).map(k => [k, 'enabled'])) };
    let writes = 0; let auth = true; let channel: string = 'native'; let duringAuthentication: (() => void) | undefined;
    const sources = () => ({ settings, ollamaLifecycle: { status: 'available', record: { lifecycle: { status: 'available_unqualified', provider: 'ollama', credentialClass: 'local_model' } } }, athenaLifecycle: null, athenaIdentity: 'synthetic', athenaAvailable: false });
    const service = createFunctionModelPreferencesService({ readSources: sources, immediate: op => op(), writeSettings(v) { if (Object.keys(v).length) writes++; settings = { ...settings, ...v }; } });
    const http = createNativeConfigurationHttp({ service, async authenticate() {
        duringAuthentication?.();
        if (!auth || channel !== 'native' || peekSession(session.id) !== session) return null;
        const grant = readNativeConfigurationGrant(f.file, principal);
        return { identity: session.id + grant, register: dispose => registerServerSessionResource(session.id, dispose),
            runCurrent(op) {
                if (peekSession(session.id) !== session) throw new FunctionModelError('session_stale');
                if (readNativeConfigurationGrant(f.file, principal) !== grant) throw new NativeConfigurationGrantError();
                return op();
            } };
    } });
    const command = () => ({ schemaVersion: 'mediflow.function-preferences-command.v1', commandId: randomUUID(), expectedRevision: service.read().revision,
        expectedCatalogRevision: service.read().catalogRevision, action: 'preset', presetId: 'all_off' });
    const request = (body: unknown) => new Request('https://synthetic.invalid/api/v1/network/ai/functions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { f, session, service, http, command, request, writes: () => writes, settings: () => settings,
        noAuth: () => { auth = false; }, web: () => { channel = 'web'; }, onAuth: (fn: () => void) => { duringAuthentication = fn; },
        cleanup: () => { deleteSession(session.id); f.cleanup(); } };
}
test('preview performs zero writes; apply rereads and exact replay performs no second write', async () => {
    const f = fixture(); try {
        const command = f.command();
        const preview = await f.http.PREVIEW(f.request(command)); assert.equal(preview.status, 200);
        assert.equal((await preview.json()).writesPerformed, 0); assert.equal(f.writes(), 0);
        const applied = await f.http.POST(f.request(command)); assert.equal(applied.status, 200);
        const view = await applied.json(); assert.ok(view.functions.every((v: { enabled: boolean }) => !v.enabled)); assert.equal(f.writes(), 1);
        assert.equal((await f.http.POST(f.request(command))).status, 200); assert.equal(f.writes(), 1);
        const read = await f.http.GET(new Request('https://synthetic.invalid/api/v1/network/ai/functions'));
        assert.equal((await read.json()).revision, view.revision); assert.equal(read.headers.get('Cache-Control'), 'no-store');
        assert.equal((await f.http.POST(f.request({ ...command, presetId: 'host_defaults' }))).status, 409);
    } finally { f.cleanup(); }
});
test('CAS and catalog reject stale commands, arbitrary providers/extra keys rejected', async () => {
    const f = fixture(); try {
        const command = f.command();
        for (const field of ['expectedRevision', 'expectedCatalogRevision']) assert.equal((await f.http.POST(f.request({ ...command, [field]: 'sha256_' + '0'.repeat(64) }))).status, 409);
        for (const extra of [{ provider: 'openai' }, { endpoint: 'https://synthetic.invalid' }]) assert.equal((await f.http.POST(f.request({ ...command, ...extra }))).status, 400);
        assert.equal(f.writes(), 0);
    } finally { f.cleanup(); }
});
test('missing native authority and Web session cannot read or write', async () => {
    const f = fixture(); try { f.web(); assert.equal((await f.http.POST(f.request(f.command()))).status, 401); f.noAuth();
        assert.equal((await f.http.GET(new Request('https://synthetic.invalid'))).status, 401); assert.equal(f.writes(), 0);
    } finally { f.cleanup(); }
});
for (const kind of ['lock', 'grant', 'pairing'] as const) test(`${kind} revocation during body denies writes`, async () => {
    const f = fixture(); try {
        let push: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({ start(c) { push = c; } });
        const request = new Request('https://synthetic.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
        const pending = f.http.POST(request);
        await new Promise(resolve => setTimeout(resolve, 10));
        if (kind === 'lock') deleteSession(f.session.id);
        if (kind === 'grant') f.f.write({ ...grantValue(), grants: [] });
        if (kind === 'pairing') f.noAuth();
        if (kind !== 'lock') { push!.enqueue(new TextEncoder().encode(JSON.stringify(f.command()))); push!.close(); }
        assert.equal((await pending).status, kind === 'grant' ? 403 : 401); assert.equal(f.writes(), 0);
    } finally { f.cleanup(); }
});
test('body deadline, oversize, duplicate keys, content type and query fail closed', async () => {
    const f = fixture(); try {
        const stream = new ReadableStream<Uint8Array>();
        const stalled = new Request('https://synthetic.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
        assert.equal((await f.http.POST(stalled)).status, 400);
        for (const body of ['x'.repeat(4097), '{"action":"set","action":"preset"}']) {
            const request = new Request('https://synthetic.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
            assert.equal((await f.http.POST(request)).status, 400);
        }
        assert.equal((await f.http.GET(new Request('https://synthetic.invalid?override=yes'))).status, 400);
        assert.equal(f.writes(), 0);
    } finally { f.cleanup(); }
});
test('set accepts only catalog option and host_defaults preserves switches', async () => {
    const f = fixture(); try {
        const view = f.service.read();
        const command = { ...f.command(), action: 'set', functionId: 'patient_insight', enabled: false,
            defaultModelOptionId: view.functions[0].options[0].modelOptionId } as Record<string, unknown>;
        delete command.presetId;
        assert.equal((await f.http.POST(f.request(command))).status, 200);
        assert.equal(f.service.read().functions[0].enabled, false);
        assert.equal((await f.http.POST(f.request({ ...f.command(), presetId: 'host_defaults' }))).status, 503,
            'unavailable enabled ATHENA cannot be admitted by a preset');
        const allOff = f.command(); assert.equal((await f.http.POST(f.request(allOff))).status, 200);
        assert.equal((await f.http.POST(f.request({ ...f.command(), presetId: 'host_defaults' }))).status, 200);
        assert.ok(f.service.read().functions.every(v => !v.enabled));
        assert.ok(f.service.read().functions.every(v => v.defaultSource === 'host_configuration'));
    } finally { f.cleanup(); }
});
