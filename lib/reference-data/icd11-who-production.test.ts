/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';
import { WHO_LOCAL_BINDING_ID, type WhoLocalReceipt } from './icd11-who-local-contract.ts';

// Bootstrap only this marked synthetic database, before importing db-server:
// an existing empty DB prevents its legacy source-database copy path.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-who-local-audit-test-'));
fs.writeFileSync(path.join(dataDir, 'SYNTHETIC_ONLY'), 'WHO local sidecar: synthetic audit receipts only.\n');
process.env.MEDIFLOW_DATA_DIR = dataDir;
const databasePath = path.join(dataDir, 'medical.db');
const bootstrap = new Database(databasePath);
try {
    for (const file of fs.readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) {
        bootstrap.exec(fs.readFileSync(path.join('drizzle', file), 'utf8').replace(/^-->\s+statement-breakpoint\s*$/gmu, ''));
    }
} finally { bootstrap.close(); }
const { writeWhoLocalReceiptAudit, writeWhoCodeCheckAudit } = await import('./icd11-who-production.ts');
const { listAuditEvents } = await import('../security/audit.ts');
const { dbServer } = await import('../db-server.ts');
after(() => { dbServer.$client.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function receipt(source: 'live' | 'cache', resultCount: number): WhoLocalReceipt {
    return {
        schemaVersion: 'mediflow.reference-data.icd11-search-receipt.v2',
        operation: 'mediflow.reference_data.icd11.search.v2',
        releaseId: '2026-01', language: 'en', deployment: 'local', bindingId: WHO_LOCAL_BINDING_ID,
        imageDigest: `sha256:${'0123456789abcdef'.repeat(4)}`,
        datasetSnapshotId: `sha256:${'fedcba9876543210'.repeat(4)}`,
        source, resultCount, latencyMs: 42,
        fetchedAt: '2026-09-06T01:00:00.001Z', expiresAt: '2026-09-07T01:00:00.001Z',
        completedAt: source === 'live' ? '2026-09-06T01:00:00.043Z' : '2026-09-06T02:00:00.123Z',
    };
}

for (const [source, count] of [['live', 25], ['cache', 0]] as const) {
    test(`production audit persists complete redacted ${source} provenance through sanitizer and SQLite reread`, async () => {
        const input = receipt(source, count);
        const eventId = await writeWhoLocalReceiptAudit(input);
        const audit = (await listAuditEvents({ eventType: 'reference_data.icd11.search' })).find(row => row.eventId === eventId);
        assert.ok(audit);
        assert.equal(audit.subjectRef, null);
        assert.equal(audit.actorRef, 'icd11-who-owner');
        assert.equal(audit.outcome, 'success');
        const metadata = audit.redactedMetadata!;
        assert.deepEqual(Object.keys(metadata).sort(), ['counts', 'flags']);
        assert.equal(metadata.counts, count);
        const flags = Object.fromEntries(metadata.flags!.map(flag => {
            assert.ok(flag.length <= 80);
            const separator = flag.indexOf(':');
            return [flag.slice(0, separator), flag.slice(separator + 1)];
        }));
        assert.deepEqual(flags, {
            schema: input.schemaVersion, operation: input.operation, deployment: input.deployment,
            source, release: input.releaseId, language: input.language, binding: input.bindingId,
            image: input.imageDigest, dataset: input.datasetSnapshotId, latencyMs: String(input.latencyMs),
            fetchedAt: input.fetchedAt, expiresAt: input.expiresAt, completedAt: input.completedAt,
        });
        const sqlite = new Database(databasePath, { readonly: true });
        try {
            const stored = sqlite.prepare('SELECT redacted_metadata AS metadata FROM audit_events WHERE event_id = ?')
                .get(eventId) as { metadata: string };
            assert.deepEqual(JSON.parse(stored.metadata), metadata);
        } finally { sqlite.close(); }
    });
}

test('production audit rejects extra data and invalid provenance before writing', async () => {
    const baseline = await listAuditEvents({ eventType: 'reference_data.icd11.search' });
    const valid = receipt('live', 1);
    const invalid = [
        { ...valid, query: 'synthetic forbidden query' },
        { ...valid, code: 'TEST-A' }, { ...valid, description: 'Synthetic forbidden title' },
        { ...valid, canonicalUri: 'synthetic forbidden URI' },
        { ...valid, bindingId: 'synthetic invalid binding' },
        { ...valid, imageDigest: 'synthetic invalid image' },
        { ...valid, datasetSnapshotId: 'synthetic invalid dataset' },
        { ...valid, completedAt: 'synthetic invalid time' },
        { ...valid, latencyMs: -1 }, { ...valid, resultCount: -1 },
        { ...valid, resultCount: 26 }, { ...valid, resultCount: 1.5 },
    ];
    for (const input of invalid) {
        await assert.rejects(writeWhoLocalReceiptAudit(input as WhoLocalReceipt), /^Error: Invalid WHO local audit receipt$/u);
    }
    assert.deepEqual(await listAuditEvents({ eventType: 'reference_data.icd11.search' }), baseline);
});

test('code-check audit persists only provenance and outcome, never code or title', async () => {
    const input = {
        schemaVersion: 'mediflow.reference-data.icd11-code-check-receipt.v1' as const,
        operation: 'mediflow.reference_data.icd11.code_check.v1' as const,
        releaseId: '2026-01' as const, language: 'en' as const, bindingId: WHO_LOCAL_BINDING_ID,
        imageDigest: `sha256:${'a'.repeat(64)}`, datasetSnapshotId: `sha256:${'b'.repeat(64)}`,
        source: 'live' as const, found: true, checkedAt: '2026-09-07T12:00:00.000Z', latencyMs: 24,
    };
    const id = await writeWhoCodeCheckAudit(input);
    const events = await listAuditEvents({ eventType: 'reference_data.icd11.code_check' });
    const saved = events.find(event => event.eventId === id);
    assert.ok(saved);
    assert.equal(saved.redactedMetadata?.counts, 1);
    assert.ok(saved.redactedMetadata?.flags?.includes(`image:${input.imageDigest}`));
    assert.ok(saved.redactedMetadata?.flags?.includes(`dataset:${input.datasetSnapshotId}`));
    assert.equal(saved.subjectRef, null);
    await assert.rejects(writeWhoCodeCheckAudit({ ...input, code: 'AA00' } as typeof input));
    assert.deepEqual(await listAuditEvents({ eventType: 'reference_data.icd11.code_check' }), events);
});

const { zipSync, unzipSync, strToU8 } = await import('fflate');
const { parseWhoTabulation, WHO_CATALOG_MAX_BYTES, WHO_TABULATION_MAX_BYTES, WhoCatalogError } = await import('./icd11-embedded-parser');
const { createWhoCatalogStore } = await import('./icd11-embedded-store');
const { createWhoCatalogRuntime } = await import('./icd11-catalog-runtime');
const { createIcd11WhoLocalRuntime } = await import('./icd11-who-local-runtime');
const { createIcd11WhoHttpRoute } = await import('./icd11-who-http-route');
const { createWhoCodeCheckRoute } = await import('./icd11-who-code-check-http');
const { createWhoCatalogHttpRoute } = await import('./icd11-embedded-http');
const { downloadWhoCatalog } = await import('./icd11-embedded-download');
const { createICDReferenceDataClient } = await import('../icd-service');
const { parseWhoCodeCheckResult } = await import('./icd11-who-code-check-contract');
const { diagnosisSchema } = await import('../schemas');
const fixtureText = fs.readFileSync('lib/reference-data/fixtures/icd11-simple-tabulation.synthetic.tsv', 'utf8');
const fixtureBytes = Buffer.from(fixtureText);
const zippedFixture = () => zipSync({ 'SimpleTabulation-ICD-11-MMS-en.txt': strToU8(fixtureText) });
const noop = () => undefined;
function activeCatalog(filename = ':memory:') {
    const store = createWhoCatalogStore(filename);
    const preview = store.stage(zippedFixture(), 0, noop, 'synthetic-test');
    store.activate(preview.previewId, 0, noop, 'synthetic-test');
    return store;
}

test('embedded parser verifies tabulation headers, original hash, categories and unmodified WHO identities', () => {
    const parsed = parseWhoTabulation(fixtureBytes);
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.manifest.rows, 3);
    assert.equal(parsed.manifest.withoutCode, 1);
    assert.equal(parsed.entries[1].residual, true);
    assert.equal(parsed.entries[0].leaf, true);
    assert.equal(parsed.entries[0].chapter, '01');
    assert.match(parsed.entries[0].uri, /mms\/1000000001$/u);
    assert.deepEqual(parseWhoTabulation(zippedFixture()).entries, parsed.entries);
    assert.deepEqual(parseWhoTabulation(fixtureBytes, parsed.manifest), parsed);
    assert.throws(() => parseWhoTabulation(fixtureBytes, { ...parsed.manifest, categories: 3 }), /Manifest/u);
    assert.throws(() => parseWhoTabulation(fixtureBytes, { ...parsed.manifest, license: 'MIT' }), /Manifest/u);
});

test('embedded parser fails closed on malformed headers, duplicate codes and URIs, bad flags and truncation', () => {
    const lines = fixtureText.trimEnd().split('\n');
    const inputs = [
        fixtureText.replace('Foundation URI', 'Unknown'), fixtureText.replace('Version: 2026-01', 'Version: 2025-01'),
        fixtureText.replace('Grouping5', 'Grouping4'), fixtureText.replace('AA01', 'AA00'),
        fixtureText.replace(/mms\/1000000002/u, 'mms/1000000001'), fixtureText.slice(0, -1),
        `${lines[0]}\n${lines[1]}\n${lines[2].split('\t').slice(0, -1).join('\t')}\n`,
        fixtureText.replace('\ttrue\t', '\tmaybe\t'), fixtureText.replace('Synthetic amber condition', '<script>'),
        fixtureText.replace('/2026-01/mms/1000000001', '/2025-01/mms/1000000001'),
    ];
    for (const input of inputs) assert.throws(() => parseWhoTabulation(Buffer.from(input)), WhoCatalogError);
    assert.throws(() => parseWhoTabulation(Buffer.from([0xff, 0x0a])), /UTF-8/u);
    assert.throws(() => parseWhoTabulation(Buffer.alloc(WHO_CATALOG_MAX_BYTES + 1)), /Dimensione/u);
    assert.throws(() => parseWhoTabulation(zipSync({ 'large.txt': new Uint8Array(WHO_TABULATION_MAX_BYTES + 1) })), /limiti/u);
    assert.throws(() => parseWhoTabulation(zipSync({ 'SimpleTabulation-ICD-11-MMS-en.txt': fixtureBytes, 'SimpleTabulation-ICD-11-MMS-fr.txt': fixtureBytes })), /un solo/u);
    assert.throws(() => parseWhoTabulation(zipSync({ 'table.xlsx': strToU8('synthetic') })), /XLSX non supportato/u);
    assert.throws(() => parseWhoTabulation(zippedFixture().slice(0, -4)), /ZIP/u);
    const corrupt = zipSync({ 'SimpleTabulation-ICD-11-MMS-en.txt': [fixtureBytes, { level: 0 }] });
    corrupt[80] ^= 1;
    assert.throws(() => parseWhoTabulation(corrupt), /ZIP/u);
});

const officialLayoutFixture = fs.readFileSync('lib/reference-data/fixtures/icd11-official-layout.synthetic.zip');
test('official export layout handles BOM, quoted multiline notes, bare LF notes and header-only version metadata', () => {
    const parsed = parseWhoTabulation(officialLayoutFixture);
    assert.equal(parsed.manifest.rows, 5);
    assert.equal(parsed.manifest.categories, 3);
    assert.equal(parsed.manifest.blocks, 1);
    assert.equal(parsed.manifest.chapters, 1);
    assert.equal(parsed.manifest.versionDate, '2026-01-17T05:30:00.000Z');
    assert.deepEqual(parsed.manifest.ignoredFiles, ['SimpleTabulation-ICD-11-MMS-en.xlsx', 'readme.txt']);
    assert.equal(parsed.entries[0].title, 'Synthetic amber condition');
    assert.equal(parsed.entries[0].originalUri, 'http:' + '//id.who.int/icd/release/11/mms/1000000001');
    assert.equal(parsed.entries[0].uri, 'http:' + '//id.who.int/icd/release/11/2026-01/mms/1000000001');
    assert.equal(parsed.entries[1].residual, true);
    assert.equal(parsed.entries[2].title, 'Synthetic threshold <80% and > 20 units');
    const files = unzipSync(officialLayoutFixture);
    const filename = 'SimpleTabulation-ICD-11-MMS-en.txt';
    const text = new TextDecoder().decode(files[filename]);
    for (const bad of [text.replace('2026 Jan 17', '2025 Jan 17'), text.replace('2026 Jan 17', '2026 Jan 32'),
        text.replace('Synthetic amber condition', 'Synthetic "bad" condition'), text.slice(0, -2),
        text.replace('Synthetic amber condition', 'Synthetic <script>condition</script>'),
        text.replace('Synthetic amber condition', 'Synthetic \u202econdition'),
        text.replace('Synthetic amber condition', 'Synthetic\ncondition'),
        text.replace('\tcategory\t', '\tunknown\t')]) {
        assert.throws(() => parseWhoTabulation(zipSync({ ...files, [filename]: strToU8(bad) })), WhoCatalogError);
    }
    assert.throws(() => parseWhoTabulation(zipSync({ 'readme.txt': fixtureBytes })), /un solo/u);
    assert.throws(() => parseWhoTabulation(zipSync({ 'SimpleTabulation-ICD-11-MMS-fr.txt': fixtureBytes })), /Lingua/u);
});

test('official bundled catalog bootstraps an empty dedicated database, survives restart and searches with FTS5',
    { skip: !fs.existsSync('assets/reference-data/icd11/catalog.zip') }, async context => {
        const root = path.resolve('assets/reference-data/icd11');
        const original = fs.readFileSync(path.join(root, 'catalog.zip'));
        const expected: unknown = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
        const parseStart = performance.now();
        const parsed = parseWhoTabulation(original, expected);
        const parseMs = performance.now() - parseStart;
        assert.equal(parsed.manifest.sha256, 'f1356588f40953a83e3af2b662deab47c5e269f944d1ea4ed0cfeb2007c7cd39');
        assert.equal(parsed.manifest.categories, 35664);
        assert.equal(parsed.manifest.blocks, 1360);
        assert.equal(parsed.manifest.chapters, 28);
        assert.equal(parsed.manifest.rows, 37052);
        const directory = fs.mkdtempSync(path.join(dataDir, 'official-public-catalog-'));
        const filename = path.join(directory, 'icd11-catalog.sqlite');
        const { bootstrapWhoCatalogBundle } = await import('./icd11-embedded-production');
        let store = createWhoCatalogStore(filename);
        try {
            assert.equal(store.status().state, 'absent');
            assert.equal(bootstrapWhoCatalogBundle(store, root, false), 'verified');
            assert.equal(store.status().state, 'absent');
            const importStart = performance.now();
            assert.equal(bootstrapWhoCatalogBundle(store, root, true), 'verified');
            const importMs = performance.now() - importStart;
            assert.equal(store.status().state, 'ready');
            assert.equal(store.status().revision, 1);
            assert.equal(store.status().searchEngine, 'fts5');
            for (const [code, title] of [['1A00', 'Cholera'], ['BA00', 'Essential hypertension'],
                ['5A11', 'Type 2 diabetes mellitus'], ['CA40', 'Pneumonia']]) {
                assert.equal(store.findCode(code)?.title, title);
                assert.match(store.findCode(code)!.uri, /^http:\/\/id\.who\.int\/icd\/release\/11\/2026-01\/mms\//u);
            }
            assert.ok(store.search('hypertension').entries.some(entry => entry.code === 'BA00'));
            assert.ok(store.search('diabetes').entries.some(entry => entry.code === '5A11'));
            const runtime = syntheticRuntime(store);
            const response = await runtime.search('GOLD 2');
            const { parseWhoEmbeddedSearchResponse } = await import('./icd11-embedded-contract');
            assert.ok(parseWhoEmbeddedSearchResponse({ schemaVersion: 'mediflow.reference-data.icd11-search-response.v3', ...response }));
            assert.ok(response.entries.some(entry => entry.code === 'XS7U' && entry.description.includes('<80%')));
            assert.ok(parseWhoCodeCheckResult(await runtime.checkCode('XS7U'), 'XS7U'));
            const times = Array.from({ length: 25 }, () => {
                const start = performance.now(); store.search('hypertension'); return performance.now() - start;
            }).sort((a, b) => a - b);
            store.close();
            const dbBytes = fs.statSync(filename).size;
            store = createWhoCatalogStore(filename);
            assert.equal(store.status().state, 'ready');
            assert.equal(store.findCode('BA00')?.title, 'Essential hypertension');
            assert.equal(bootstrapWhoCatalogBundle(store, root, true), 'verified');
            assert.equal(store.status().revision, 1);
            context.diagnostic(JSON.stringify({ parseMs, bootstrapMs: importMs, dbBytes,
                searchMedianMs: times[12], searchMaxMs: times.at(-1), query: 'hypertension', samples: times.length }));
        } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
    });

test('catalog stage and activation are separate, CAS guarded, atomic with audit, and preserve a rollback across restart', () => {
    const filename = path.join(dataDir, 'synthetic-reference.sqlite');
    let store = createWhoCatalogStore(filename);
    assert.equal(store.status().state, 'absent');
    const first = store.stage(zippedFixture(), 0, noop, 'synthetic');
    assert.equal(store.status().state, 'absent');
    store.activate(first.previewId, 0, noop, 'synthetic');
    assert.equal(store.status().state, 'ready');
    assert.equal(store.status().searchEngine, 'fts5');
    const secondBytes = zipSync({ 'SimpleTabulation-ICD-11-MMS-en.txt': strToU8(fixtureText.replace('Synthetic amber condition', 'Synthetic blue condition')) });
    const second = store.stage(secondBytes, 1, noop, 'synthetic');
    assert.throws(() => store.activate(second.previewId, 0, noop, 'synthetic'), /cambiato/u);
    let checks = 0;
    assert.throws(() => store.activate(second.previewId, 1, () => { if (++checks === 2) throw new Error('synthetic revoked'); }, 'synthetic'), /revoked/u);
    assert.equal(store.search('amber').entries.length, 2);
    const raw = new Database(filename);
    raw.exec("CREATE TRIGGER deny_catalog_audit BEFORE INSERT ON icd_catalog_audit WHEN new.operation='activate' BEGIN SELECT RAISE(ABORT,'synthetic audit unavailable'); END");
    assert.throws(() => store.activate(second.previewId, 1, noop, 'synthetic'), /audit unavailable/u);
    assert.equal(store.status().revision, 1);
    assert.equal(store.search('blue').entries.length, 0);
    raw.exec('DROP TRIGGER deny_catalog_audit');
    store.activate(second.previewId, 1, noop, 'synthetic');
    assert.equal(store.search('blue').entries[0].code, 'AA00');
    store.close(); store = createWhoCatalogStore(filename);
    assert.equal(store.status().state, 'ready');
    store.rollback(2, noop, 'synthetic');
    assert.equal(store.search('blue').entries.length, 0);
    assert.equal(store.search('AA00').entries[0].title, 'Synthetic amber condition');
    assert.throws(() => store.stage(Buffer.from('bad'), 3, noop, 'synthetic'));
    assert.equal(store.status().revision, 3);
    const audit = raw.prepare('SELECT operation,revision FROM icd_catalog_audit ORDER BY rowid').all();
    assert.deepEqual(audit, [{ operation: 'preview', revision: 0 }, { operation: 'activate', revision: 1 },
        { operation: 'preview', revision: 1 }, { operation: 'activate', revision: 2 }, { operation: 'rollback', revision: 3 }]);
    store.close();
    raw.prepare('UPDATE icd_catalog_entries SET title=? WHERE code=?').run('Corrupted projection', 'AA00');
    raw.close();
    store = createWhoCatalogStore(filename);
    assert.equal(store.status().state, 'unverified');
    assert.throws(() => store.search('amber'), /non verificato/u);
    store.close();
});

test('catalog search uses exact codes, full text literal tokens, and bounded results without interpreting MATCH syntax', () => {
    const store = activeCatalog();
    try {
        assert.equal(store.search('aa00').entries[0].code, 'AA00');
        assert.equal(store.search('amber').entries.length, 2);
        assert.equal(store.search('amber unspecified').entries[0].code, 'AA01');
        for (const text of ['"amber"', 'amber OR missing', 'NEAR(amber,missing)', 'amber*', '---', '"', 'amber:missing', "'; DROP TABLE icd_catalog_entries; --"]) {
            assert.ok(store.search(text).entries.length <= 2);
        }
        assert.equal(store.search('amber OR missing').entries.length, 0);
        assert.equal(store.search('AA00').entries.length, 1);
        assert.throws(() => store.search('x'.repeat(161)), /non valida/u);
        assert.throws(() => store.search('amber\0'), /non valida/u);
        const rows = fixtureText.trimEnd().split('\n');
        const categories = Array.from({ length: 30 }, (_, index) => rows[2].replace('AA00', `AB${String(index).padStart(2, '0')}`)
            .replaceAll('1000000001', String(1100000000 + index)));
        const replacement = store.stage(Buffer.from([rows[0], rows[1], ...categories].join('\n') + '\n'), 1, noop, 'synthetic');
        store.activate(replacement.previewId, 1, noop, 'synthetic');
        assert.equal(store.search('amber').entries.length, 25);
        assert.equal(store.search('amber').partial, true);
    } finally { store.close(); }
});

function syntheticRuntime(store: ReturnType<typeof createWhoCatalogStore>, audit = async () => undefined) {
    return createWhoCatalogRuntime({ store, enabled: () => true,
        sidecar: createIcd11WhoLocalRuntime({ readEnvironment: () => undefined, now: Date.now,
            transport: async () => { throw new Error('Docker must never be contacted'); }, audit: noop }),
        auditSearch: audit, auditCodeCheck: audit });
}

test('authenticated existing routes return embedded Search 200 and code-check with Docker absent, preserving encrypted diagnosis reference contract', async () => {
    const store = activeCatalog(), runtime = syntheticRuntime(store);
    try {
        const get = createIcd11WhoHttpRoute({ authorize: async () => true, getRuntime: () => runtime });
        const client = createICDReferenceDataClient(async input => get(new Request(new URL(String(input), 'http://localhost'))));
        assert.equal((await client.readiness()).status, 'available');
        const results = await client.search('amber');
        assert.equal(results.length, 2);
        assert.equal(client.lastReceipt()?.source, 'embedded');
        assert.ok(diagnosisSchema.safeParse({ ...results[0], date: new Date() }).success);
        const check = createWhoCodeCheckRoute({ authorize: async () => true, getRuntime: () => runtime });
        const response = await check(new Request('http://localhost/api/icd/code-check?code=AA00&release=2026-01'));
        assert.equal(response.status, 200);
        const parsed = parseWhoCodeCheckResult(await response.json(), 'AA00');
        assert.equal(parsed?.status, 'found');
        assert.equal(parsed?.receipt.source, 'embedded');
        assert.equal(parsed?.entry?.stemTitle, results[0].description);
        assert.equal((await runtime.checkCode('ZZ99')).status, 'not_found');
        await assert.rejects(runtime.checkCode('AA00&AA01'));
        assert.equal((await createIcd11WhoHttpRoute({ authorize: async () => false, getRuntime: () => runtime })(new Request('http://localhost/api/icd/proxy?q=amber'))).status, 401);
        const unavailableAudit = syntheticRuntime(store, async () => { throw new Error('audit unavailable'); });
        await assert.rejects(unavailableAudit.search('amber'), /audit_unavailable/u);
        await assert.rejects(unavailableAudit.checkCode('AA00'), /audit_unavailable/u);
        const auditEvent = await (await import('./icd11-who-production')).writeWhoEmbeddedSearchAudit((await runtime.search('amber')).receipt as import('./icd11-embedded-contract').WhoEmbeddedReceipt);
        assert.equal((await listAuditEvents({ eventType: 'reference_data.icd11.search' })).find(row => row.eventId === auditEvent)?.redactedMetadata?.counts, 2);
    } finally { store.close(); }
});

test('WHO fixed download rejects redirect, HTTP errors, wrong format, truncation, byte limits, timeout and abort without activating a catalog', async () => {
    const payload = zippedFixture(), headers = { 'Content-Type': 'application/zip' };
    const signal = new AbortController().signal;
    const good: typeof fetch = async (input, init) => {
        assert.equal(input, 'https:' + '//icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip');
        assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit');
        assert.equal(init?.body, undefined); assert.equal(new Headers(init?.headers).has('Authorization'), false);
        return new Response(payload, { headers });
    };
    assert.equal(await downloadWhoCatalog(signal, bytes => parseWhoTabulation(bytes).entries.length, good), 2);
    for (const response of [new Response(null, { status: 302, headers: { Location: 'https:' + '//other.invalid' } }),
        new Response(null, { status: 503 }), new Response('html', { headers: { 'Content-Type': 'text/html' } }),
        new Response(payload, { headers: { ...headers, 'Content-Length': String(WHO_CATALOG_MAX_BYTES + 1) } }),
        new Response(payload, { headers: { ...headers, 'Content-Length': String(payload.length + 1) } }),
        new Response(payload.slice(0, -3), { headers })]) {
        await assert.rejects(downloadWhoCatalog(signal, parseWhoTabulation, async () => response));
    }
    await assert.rejects(downloadWhoCatalog(signal, noop, async () => new Promise(() => undefined), 10), /scaduto/u);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(downloadWhoCatalog(controller.signal, noop, good));
    assert.equal(await downloadWhoCatalog(signal, bytes => bytes.length, good), payload.length);
});

test('catalog update HTTP requires confirmation, local authority, exact body and second CAS activation; download failure preserves previous catalog', async () => {
    const filename = path.join(dataDir, 'synthetic-http-reference.sqlite');
    const store = activeCatalog(filename); let enabled = true, allowed = true, failDownload = false;
    const controller = new AbortController();
    const route = createWhoCatalogHttpRoute({ store: () => store, status: () => store.status(), enabled: () => enabled,
        acquire: async () => allowed ? { actor: 'synthetic', signal: controller.signal, assertCurrent: noop, dispose: noop } : null,
        transport: async () => failDownload ? new Response(null, { status: 503 }) : new Response(zippedFixture(), { headers: { 'Content-Type': 'application/zip' } }) });
    const request = (body: unknown) => new Request('http://localhost/api/icd/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try {
        allowed = false; assert.equal((await route(request({ action: 'preview', confirmed: true }))).status, 401); allowed = true;
        assert.equal((await route(request({ action: 'preview', confirmed: false }))).status, 400);
        assert.equal((await route(request({ action: 'preview', confirmed: true, url: 'caller' }))).status, 400);
        const previewResponse = await route(request({ action: 'preview', confirmed: true }));
        assert.equal(previewResponse.status, 200);
        const preview = await previewResponse.json();
        assert.equal(store.status().revision, 1);
        assert.equal((await route(request({ action: 'activate', confirmed: true, ...preview, manifest: undefined, sourceUrl: 'caller' }))).status, 400);
        assert.equal((await route(request({ action: 'activate', confirmed: true, previewId: preview.previewId, expectedRevision: 1 }))).status, 200);
        assert.equal(store.status().revision, 2);
        assert.equal((await route(request({ action: 'activate', confirmed: true, previewId: preview.previewId, expectedRevision: 1 }))).status, 409);
        failDownload = true;
        assert.equal((await route(request({ action: 'preview', confirmed: true }))).status, 502);
        assert.equal(store.status().revision, 2);
        const persisted = new Database(filename, { readonly: true });
        try { assert.deepEqual(persisted.prepare("SELECT sha256,categories FROM icd_catalog_audit WHERE operation='acquisition_failed'").all(), [{ sha256: null, categories: 0 }]); } finally { persisted.close(); }
        enabled = false; assert.equal((await route(request({ action: 'preview', confirmed: true }))).status, 503);
        enabled = true; controller.abort();
        assert.equal((await route(request({ action: 'preview', confirmed: true }))).status, 401);
    } finally { store.close(); }
});

test('embedded bundle bootstrap verifies original bytes and manifest, never imports invalid assets or replaces an active catalog', async () => {
    const { bootstrapWhoCatalogBundle } = await import('./icd11-embedded-production');
    const root = fs.mkdtempSync(path.join(dataDir, 'synthetic-bundle-'));
    const store = createWhoCatalogStore(':memory:');
    try {
        assert.equal(bootstrapWhoCatalogBundle(store, root, true), 'absent');
        const bytes = zippedFixture(), manifest = parseWhoTabulation(bytes).manifest;
        fs.writeFileSync(path.join(root, 'catalog.zip'), bytes);
        assert.equal(bootstrapWhoCatalogBundle(store, root, true), 'unverified');
        assert.equal(store.status().state, 'absent');
        fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ ...manifest, sha256: '0'.repeat(64) }));
        assert.equal(bootstrapWhoCatalogBundle(store, root, true), 'unverified');
        fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
        assert.equal(bootstrapWhoCatalogBundle(store, root, false), 'verified');
        assert.equal(store.status().state, 'absent');
        assert.equal(bootstrapWhoCatalogBundle(store, root, true), 'verified');
        assert.equal(store.status().state, 'ready');
        assert.equal(store.status().revision, 1);
        assert.equal(bootstrapWhoCatalogBundle(store, root, true), 'verified');
        assert.equal(store.status().revision, 1);
        fs.writeFileSync(path.join(root, 'catalog.zip'), bytes.slice(0, -5));
        assert.equal(bootstrapWhoCatalogBundle(store, root, true), 'unverified');
        assert.equal(store.search('amber').entries.length, 2);
    } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('embedded kill switch and revocation during audit deny results; empty results never contact a sidecar', async () => {
    const store = activeCatalog(); let enabled = true, transports = 0;
    const sidecar = createIcd11WhoLocalRuntime({ readEnvironment: () => undefined, now: Date.now, audit: noop,
        transport: async () => { transports++; throw new Error('no sidecar'); } });
    const runtime = createWhoCatalogRuntime({ store, sidecar, enabled: () => enabled,
        auditSearch: async () => { enabled = false; }, auditCodeCheck: async () => undefined });
    try {
        await assert.rejects(runtime.search('amber'));
        assert.equal(runtime.readiness().status, 'disabled');
        await assert.rejects(runtime.checkCode('AA00'));
        assert.equal(transports, 0);
        enabled = true;
        const noFallback = syntheticRuntime(store);
        assert.deepEqual((await noFallback.search('unfindable')).entries, []);
        const controller = new AbortController(); controller.abort();
        await assert.rejects(noFallback.search('amber', controller.signal));
    } finally { store.close(); }
});
