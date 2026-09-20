/* @Codex: synthetic transport only; no production imports or model calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferencesClient, parsePreferences, type FunctionModelPreferences, type FunctionModelCommand } from '../../lib/function-models/browser';
import { createModelPreviewClient } from '../../lib/function-models/preview-client';
export const rev = (digit = 'a') => `sha256_${digit.repeat(64)}`;
export const optionId = (digit = 'a') => `model_option_${digit.repeat(32)}`;
type SyntheticPreferences = Extract<FunctionModelPreferences, { schemaVersion: 'mediflow.function-preferences.v1' }>;
export function dto(): SyntheticPreferences { return { schemaVersion: 'mediflow.function-preferences.v1', revision: rev(), catalogRevision: rev('b'), check: 'configuration_only', apply: 'denied', presets: ['host_defaults', 'all_off'], functions: ['patient_insight','smart_import','document_synthesis','treatment_reasoning'].map(id => ({ id, enabled: true, defaultModelOptionId: optionId(), defaultSource: 'host_configuration', bindingState: 'current', options: [{ modelOptionId: optionId(), label: 'synthetic-local:small', provider: 'ollama', state: 'available_unqualified' }, { modelOptionId: optionId('b'), label: 'synthetic-local:large', provider: 'ollama', state: 'available_unqualified' }] })) } as SyntheticPreferences; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(fn => { resolve = fn; }); return { promise, resolve }; }
function fixture(id: 'patient_insight' | 'smart_import' | 'document_synthesis' | 'treatment_reasoning' = 'patient_insight') {
    let value: FunctionModelPreferences = dto(); const calls: { path: string; init?: RequestInit }[] = [];
    let response: Response | null = null;
    const client = createModelPreviewClient(id, (async (input, init) => { calls.push({ path: String(input), init }); return response ?? Response.json(String(input).includes('/settings/') ? value : { synthetic: true }); }) as typeof fetch);
    client.reset(true); return { client, calls, set: (next: FunctionModelPreferences) => { value = next; }, response: (next: Response) => { response = next; } };
}
test('catalog is lazy; strict DTO excludes remote options and execution claims', () => {
    const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(parsePreferences(dto()).functions.length, 4);
    const remote = dto(); (remote.functions[0].options[0] as { provider: string }).provider = 'chatgpt'; assert.throws(() => parsePreferences(remote));
    assert.throws(() => parsePreferences({ ...dto(), check: 'live' })); assert.throws(() => parsePreferences({ ...dto(), functions: [] }));
});
for (const id of ['patient_insight','smart_import','document_synthesis','treatment_reasoning'] as const) test(`${id}: override only on matching preview; joint catalog and ID; once only`, async () => {
    const { client, calls } = fixture(id); await client.read(); client.choose(optionId('b')); const token = await client.begin();
    await client.fetch(`/api/ai/${id.replaceAll('_','-')}/ingest`, { method: 'POST', headers: { 'x-mediflow-function-model': 'must-strip' }, body: '{}' });
    assert.equal(new Headers(calls.at(-1)!.init!.headers).has('x-mediflow-function-model'), false);
    await client.fetch(`/api/ai/${id.replaceAll('_','-')}/preview`, { method: 'POST', body: '{}' });
    assert.deepEqual(JSON.parse(new Headers(calls.at(-1)!.init!.headers).get('x-mediflow-function-model')!), { modelOptionId: optionId('b'), expectedCatalogRevision: rev('b') });
    assert.equal(client.isCurrent(token), true); assert.equal(client.getSnapshot().consumed, true);
    await assert.rejects(client.begin()); await assert.rejects(client.fetch(`/api/ai/${id.replaceAll('_','-')}/preview`, { method: 'POST' })); client.reset();
});
test('default emits no header; changing choice aborts in-flight work', async () => {
    const f = fixture(); const token = await f.client.begin(); await f.client.fetch('/api/ai/patient-insight/preview', { method: 'POST' });
    assert.equal(new Headers(f.calls.at(-1)!.init!.headers).has('x-mediflow-function-model'), false);
    const signal = f.calls.at(-1)!.init!.signal!; f.client.choose(optionId('b')); assert.equal(signal.aborted, true); assert.equal(f.client.isCurrent(token), false);
});
test('revision or catalog changes never fall back from stale override', async () => {
    for (const key of ['revision', 'catalogRevision'] as const) { const f = fixture(); await f.client.read(); f.client.choose(optionId('b'));
        f.set({ ...dto(), [key]: rev('c') }); await assert.rejects(f.client.begin()); assert.equal(f.client.getSnapshot().blocked, true); assert.match(f.client.getSnapshot().error!, /nessun modello alternativo/); assert.ok(f.calls.every(c => c.path.includes('/settings/'))); }
});
test('disabled, unavailable, empty and stale bindings fail before clinical requests', async () => {
    for (const kind of ['disabled','unavailable','empty','stale']) { const f = fixture(); const source = dto();
        const value: FunctionModelPreferences = { ...source, functions: source.functions.map((row, index) => index !== 0 ? row : kind === 'disabled' ? { ...row, enabled: false } : kind === 'unavailable' ? { ...row, options: row.options.map((option, optionIndex) => optionIndex !== 0 ? option : { ...option, state: 'unavailable' }) } : kind === 'empty' ? { ...row, options: [] } : { ...row, bindingState: 'stale' }) };
        f.set(value); await assert.rejects(f.client.begin()); assert.equal(f.calls.length, 1); }
});
test('context/session reset rejects late body even when transport ignores abort', async () => {
    const f = fixture(); await f.client.begin(); const response = Response.json({}); const body = deferred<unknown>(); response.json = () => body.promise; f.response(response);
    const result = await f.client.fetch('/api/ai/patient-insight/preview', { method: 'POST' }); const pending = result.json(); f.client.reset(false); body.resolve({ synthetic: true });
    await assert.rejects(pending); assert.equal(f.client.getSnapshot().choice, null); await assert.rejects(f.client.fetch('/api/ai/patient-insight/preview', { method: 'POST' }));
});
test('failed catalog reread clears override and requires explicit new choice', async () => {
    const f = fixture(); await f.client.read(); f.client.choose(optionId('b')); f.response(new Response('', { status: 503 })); await f.client.read();
    assert.equal(f.client.getSnapshot().choice, null); assert.equal(f.client.getSnapshot().blocked, true); await assert.rejects(f.client.begin());
});
test('server conflict blocks preview; no retry or alternative', async () => {
    const f = fixture(); await f.client.begin(); f.response(new Response('', { status: 409 })); await assert.rejects(f.client.fetch('/api/ai/patient-insight/preview', { method: 'POST' }));
    assert.equal(f.client.getSnapshot().blocked, true); assert.equal(f.calls.length, 2);
});
function preferencesFixture() {
    let current = dto(); let conflict = false; let rereadConflict = false; const calls: { path: string; command?: FunctionModelCommand }[] = [];
    const client = createPreferencesClient((async (input, init) => {
        const path = String(input); const command: FunctionModelCommand | undefined = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, command });
        if (command && conflict) return new Response('', { status: 409 });
        const proposed = { ...current, revision: rev('c') };
        if (path.endsWith('/preview')) return Response.json({ schemaVersion: 'mediflow.function-preferences-preview.v1', command, proposed, writesPerformed: 0 });
        if (command) { current = proposed; return Response.json(current); }
        return Response.json(rereadConflict && calls.some(c => c.command && !c.path.endsWith('/preview')) ? { ...current, revision: rev('d') } : current);
    }) as typeof fetch);
    return { client, calls, conflict: () => { conflict = true; }, rereadConflict: () => { rereadConflict = true; } };
}
test('preset preview does not apply; explicit apply uses identical UUID/CAS and rereads before success', async () => {
    const f = preferencesFixture(); await f.client.read(); await f.client.preview({ action: 'preset', presetId: 'all_off' });
    assert.equal(f.calls.length, 2); assert.equal(f.client.getSnapshot().saved, false); assert.ok(f.client.getSnapshot().proposed);
    await f.client.apply(); assert.equal(f.calls.length, 4); assert.deepEqual(f.calls[1].command, f.calls[2].command); assert.equal(f.calls[3].command, undefined); assert.equal(f.client.getSnapshot().saved, true);
});
test('set preview cancellation never writes', async () => { const f = preferencesFixture(); await f.client.read(); await f.client.preview({ action: 'set', functionId: 'smart_import', enabled: false, defaultModelOptionId: null }); f.client.cancel(); await f.client.apply(); assert.equal(f.calls.length, 2); assert.equal(f.client.getSnapshot().proposed, null); });
test('CAS409 clears proposal and requires read and a new decision', async () => {
    const f = preferencesFixture(); await f.client.read(); await f.client.preview({ action: 'preset', presetId: 'host_defaults' }); f.conflict(); await f.client.apply();
    assert.equal(f.client.getSnapshot().saved, false); assert.equal(f.client.getSnapshot().proposed, null); assert.equal(f.client.getSnapshot().dto, null); assert.match(f.client.getSnapshot().error!, /decidi di nuovo/);
    const count = f.calls.length; await f.client.apply(); assert.equal(f.calls.length, count);
});
test('reread disagreement cannot show green; lock suppresses a late settings body', async () => {
    const f = preferencesFixture(); await f.client.read(); await f.client.preview({ action: 'preset', presetId: 'all_off' }); f.rereadConflict(); await f.client.apply(); assert.equal(f.client.getSnapshot().saved, false);
    const late = deferred<unknown>(); const response = Response.json({}); response.json = () => late.promise; const client = createPreferencesClient(async () => response);
    const pending = client.read(); await Promise.resolve(); await Promise.resolve(); client.reset(); late.resolve(dto()); await pending; assert.equal(client.getSnapshot().dto, null);
});
test('preferences timeout aborts transport and cannot publish late success', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal: AbortSignal | null = null;
    const client = createPreferencesClient((async (_input, init) => { signal = init!.signal as AbortSignal; return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); }) as typeof fetch);
    const pending = client.read(); t.mock.timers.tick(15000); await pending;
    assert.equal((signal as AbortSignal | null)?.aborted, true); assert.equal(client.getSnapshot().saved, false); assert.equal(client.getSnapshot().dto, null); assert.ok(client.getSnapshot().error);
});
test('late catalog read after selection context reset cannot restore old override', async () => {
    const late = deferred<Response>(); const client = createModelPreviewClient('smart_import', async () => late.promise); client.reset(true);
    const pending = client.read(); client.reset(true); late.resolve(Response.json(dto())); await pending;
    assert.equal(client.getSnapshot().dto, null); assert.equal(client.getSnapshot().choice, null); assert.equal(client.getSnapshot().loading, false);
});
test('catalog timeout fails closed before selection or preview', async t => {
    const timeout = new AbortController();
    t.mock.method(AbortSignal, 'timeout', () => timeout.signal);
    const client = createModelPreviewClient('document_synthesis', (async (_input, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true }))) as typeof fetch);
    client.reset(true); const pending = client.begin(); timeout.abort(); await assert.rejects(pending);
    assert.equal(client.getSnapshot().blocked, true); assert.equal(client.getSnapshot().choice, null);
});
test('a successful reread after failure still requires a new explicit model decision', async () => {
    let healthy = true;
    const client = createModelPreviewClient('patient_insight', (async () => healthy ? Response.json(dto()) : new Response('', { status: 503 })) as typeof fetch);
    client.reset(true); await client.read(); client.choose(optionId('b')); healthy = false; await client.read();
    healthy = true; await client.read(); assert.equal(client.getSnapshot().blocked, true); assert.equal(client.getSnapshot().choice, null);
    await assert.rejects(client.begin()); client.choose(''); assert.equal(client.getSnapshot().blocked, false); await client.begin();
});
