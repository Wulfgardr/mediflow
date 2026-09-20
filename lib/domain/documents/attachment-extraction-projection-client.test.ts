/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { LOCKED_DATA_PLACEHOLDER } from '../../locked-field-guard.ts';
import { requestAnyDocDecryptedLocalExtractionPreview } from './anydoc-local-extraction-client.ts';
import { buildAnyDocLocalExtraction } from './anydoc-local-extraction-contract.ts';
import { ATTACHMENT_EXTRACTION_PROJECTION_SCHEMA as SCHEMA } from './attachment-extraction-projection-protocol.ts';
const ID = 'synthetic-attachment'; const TOKEN = 'a'.repeat(64);
const current = { sourceRef: 'b'.repeat(64), revision: 2, freshnessEpoch: 3 };
const bytes = Buffer.from('{\\rtf1\\ansi Synthetic text.}');
const digest = createHash('sha256').update(bytes).digest('hex');
// Match the real facade: host-only currentness fields are deliberately absent.
const source = () => ({ id: ID, data: `data:application/rtf;base64,${bytes.toString('base64')}` });
const grant = () => ({ schemaVersion: SCHEMA, grantId: TOKEN, expiresAt: Date.now() + 30_000, canonicalSource: current });
const result = () => ({ schemaVersion: SCHEMA, grantId: TOKEN,
    acquisition: { origin: 'authenticated_client_decryption', ciphertextEquality: 'not_attested', canonicalSource: current },
    extraction: buildAnyDocLocalExtraction({ attachmentId: ID, sourceSha256: digest, byteLength: bytes.length }, 'Synthetic text.') });
function transport(options: { grant?: unknown; result?: unknown } = {}) {
    const calls: { action: string; init: RequestInit }[] = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
        const action = init?.method === 'DELETE' ? 'cancel' : new Headers(init?.headers).get('X-MediFlow-Extraction-Action')!;
        calls.push({ action, init: { ...init } });
        if (action === 'cancel') return new Response(null, { status: 204 });
        if (action === 'acquire') return Response.json(options.grant ?? grant());
        assert.equal(action, 'project');
        assert.deepEqual(new Uint8Array(init!.body as ArrayBuffer), new Uint8Array(bytes));
        assert.equal(new Headers(init?.headers).get('X-MediFlow-Extraction-Grant'), TOKEN);
        return Response.json(options.result ?? result());
    };
    return { calls, fetch };
}

test('ordinary client acquires before fresh decryption, sends only binary content and validates descriptive provenance', async () => {
    const network = transport(); let reads = 0;
    const preview = await requestAnyDocDecryptedLocalExtractionPreview(ID, async () => {
        reads += 1; assert.deepEqual(network.calls.map(c => c.action), ['acquire']); return source();
    }, network.fetch);
    assert.equal(preview?.markdown, 'Synthetic text.'); assert.equal(reads, 1);
    assert.deepEqual(preview?.acquisition, { origin: 'authenticated_client_decryption', ciphertextEquality: 'not_attested', canonicalSource: current });
    assert.deepEqual(network.calls.map(c => c.action), ['acquire', 'project', 'cancel']);
    for (const { init } of network.calls) {
        assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error');
    }
    assert.ok(new Uint8Array(network.calls[1]!.init.body as ArrayBuffer).every(b => b === 0), 'client-owned binary memory is wiped');
});

for (const change of ['ciphertext', 'locked', 'deleted', 'wrong-id'] as const)
    test(`does not send a ${change} or stale client read as a projection`, async () => {
        const network = transport(); const value = source();
        if (change === 'ciphertext') value.data = 'ENC:synthetic:not-decrypted';
        if (change === 'locked') value.data = LOCKED_DATA_PLACEHOLDER;
        if (change === 'wrong-id') value.id = 'other';
        assert.equal(await requestAnyDocDecryptedLocalExtractionPreview(ID, async () => change === 'deleted' ? null : value, network.fetch), null);
        assert.deepEqual(network.calls.map(c => c.action), ['acquire', 'cancel']);
    });

for (const change of ['grant', 'byte-digest', 'canonical', 'claim-equality', 'extra'] as const)
    test(`rejects invalid ${change} response evidence`, async () => {
        const value = result();
        if (change === 'grant') value.grantId = 'c'.repeat(64);
        if (change === 'byte-digest' && value.extraction.status !== 'denied') value.extraction = buildAnyDocLocalExtraction({ attachmentId: ID, sourceSha256: 'c'.repeat(64), byteLength: bytes.length }, 'Synthetic text.');
        if (change === 'canonical') value.acquisition.canonicalSource = { ...current, revision: 99 };
        if (change === 'claim-equality') value.acquisition.ciphertextEquality = 'verified';
        if (change === 'extra') Object.assign(value, { provider: 'forbidden' });
        const network = transport({ result: value });
        assert.equal(await requestAnyDocDecryptedLocalExtractionPreview(ID, async () => source(), network.fetch), null);
    });

test('malformed and expired grants stop before decryption', async () => {
    for (const value of [{}, { ...grant(), expiresAt: 1 }, { ...grant(), provider: 'forbidden' }, { ...grant(), canonicalSource: { ...current, revision: 0 } }]) {
        const network = transport({ grant: value }); let read = false;
        assert.equal(await requestAnyDocDecryptedLocalExtractionPreview(ID, async () => { read = true; return source(); }, network.fetch), null);
        assert.equal(read, false); assert.equal(network.calls.some(c => c.action === 'project'), false);
    }
});

test('lock during decryption revokes the grant and cannot start projection', async () => {
    const network = transport(); const controller = new AbortController();
    const preview = await requestAnyDocDecryptedLocalExtractionPreview(ID, async () => { controller.abort(); return source(); }, network.fetch, controller.signal);
    assert.equal(preview, null); assert.deepEqual(network.calls.map(c => c.action), ['acquire', 'cancel']);
});

test('cancel while transport is pending suppresses a late success and permits an explicit fresh retry', async () => {
    const network = transport(); const controller = new AbortController(); const held = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const fetch: typeof globalThis.fetch = async (url, init) => {
        if (new Headers(init?.headers).get('X-MediFlow-Extraction-Action') === 'project') { started.resolve(); return held.promise; }
        return network.fetch(url, init);
    };
    const pending = requestAnyDocDecryptedLocalExtractionPreview(ID, async () => source(), fetch, controller.signal);
    await started.promise; controller.abort(); held.resolve(Response.json(result()));
    assert.equal(await pending, null);
    assert.equal((await requestAnyDocDecryptedLocalExtractionPreview(ID, async () => source(), network.fetch))?.status, 'available');
});

test('already locked client cannot acquire, read or project', async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    assert.equal(await requestAnyDocDecryptedLocalExtractionPreview(ID, async () => { calls += 1; return source(); }, async () => { calls += 1; return Response.json({}); }, controller.signal), null);
    assert.equal(calls, 0);
});

test('source beyond 25MiB is rejected locally, never sent or truncated', async () => {
    const network = transport(); const value = source(); value.data = 'A'.repeat(36 * 1024 * 1024);
    assert.equal(await requestAnyDocDecryptedLocalExtractionPreview(ID, async () => value, network.fetch), null);
    assert.equal(network.calls.some(c => c.action === 'project'), false);
});
