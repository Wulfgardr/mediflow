/* @Codex */
import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotCanonicalApplicationCatalog } from './application-catalog-contract';

function safeRow(sourceRow: number) {
    return {
        sourceRow,
        capabilityId: `synthetic.catalog.capability-${sourceRow}`,
        capabilityVersion: '1.0.0',
        rowRevision: 1,
        lifecycle: 'unresolved',
        implementation: 'unavailable',
        input: { kind: 'none' },
        output: { kind: 'none' },
        mode: 'unresolved',
        maxStage: 'none',
        dataContext: { kind: 'unresolved', freshness: 'unresolved', retention: 'unresolved' },
        authority: { read: 'denied', preview: 'denied', proposal: 'denied', reviewDecision: 'not_applicable', apply: 'denied' },
        idempotency: { policy: 'unresolved', scope: 'unresolved', replay: 'unresolved' },
        conflict: { revisionKind: 'unresolved', expectedRevision: 'unresolved', staleDisposition: 'unresolved' },
        fabricDependency: { broker: 'unresolved', providers: [], selection: 'unresolved', readiness: 'unresolved', receipt: 'unresolved', provenance: 'unresolved', fallback: 'forbidden' },
        execution: { kind: 'unresolved', cancel: 'unresolved', revoke: 'unresolved', rateLimit: { kind: 'deny' } },
        venues: ['local_process'],
        egress: 'none',
        offline: 'unresolved',
        headlessDisposition: 'unavailable',
        evidence: [],
        uiSurfaces: ['none'],
    };
}

function safeCatalog() {
    return {
        schema: 'mediflow.canonical-application-catalog.v1',
        catalogRevision: 1,
        applyPolicy: 'none',
        entries: Array.from({ length: 66 }, (_, index) => safeRow(index + 1)),
    };
}

test('snapshots only the closed 66-row no-apply catalog at the public seam', () => {
    const catalog = snapshotCanonicalApplicationCatalog(safeCatalog());

    assert.equal(catalog.applyPolicy, 'none');
    assert.equal(catalog.entries.length, 66);
    assert.deepEqual(catalog.entries.map((entry) => entry.sourceRow), Array.from({ length: 66 }, (_, index) => index + 1));
    assert.equal(Object.isFrozen(catalog), true);
    assert.equal(Object.isFrozen(catalog.entries), true);
    assert.equal(Object.isFrozen(catalog.entries[0].authority), true);
});

test('keeps the snapshot independent from the caller-owned fixture', () => {
    const input = safeCatalog();
    const catalog = snapshotCanonicalApplicationCatalog(input);
    input.entries[0].authority.read = 'authenticated_session';
    assert.equal((catalog.entries[0].authority as Record<string, unknown>).read, 'denied');
});

test('rejects catalog drift, apply, and unevidenced authority at the public seam', () => {
    const cases: Array<[string, (catalog: ReturnType<typeof safeCatalog>) => void]> = [
        ['wrong row count', (catalog) => { catalog.entries.pop(); }],
        ['out-of-order source row', (catalog) => { catalog.entries[1].sourceRow = 9; }],
        ['duplicate capability id', (catalog) => { catalog.entries[1].capabilityId = catalog.entries[0].capabilityId; }],
        ['apply policy', (catalog) => { catalog.applyPolicy = 'single_r2_admin' as never; }],
        ['apply stage', (catalog) => { catalog.entries[0].maxStage = 'apply'; }],
        ['loopback egress', (catalog) => { catalog.entries[0].egress = 'loopback_local'; }],
        ['unknown field', (catalog) => { (catalog.entries[0] as Record<string, unknown>).extra = true; }],
        ['unevidenced authority', (catalog) => { catalog.entries[0].authority.read = 'authenticated_session'; }],
    ];

    for (const [label, mutate] of cases) {
        const catalog = safeCatalog();
        mutate(catalog);
        assert.throws(() => snapshotCanonicalApplicationCatalog(catalog), /Canonical application catalog rejected/, label);
    }
});

test('rejects a permissive field when its direct evidence conflicts', () => {
    const input = safeCatalog();
    input.entries[0].lifecycle = 'active';
    (input.entries[0] as Record<string, unknown>).evidence = [
        { kind: 'accepted_adr', ref: 'synthetic:supports-lifecycle', supports: ['/lifecycle'], polarity: 'supports' },
        { kind: 'accepted_adr', ref: 'synthetic:contradicts-lifecycle', supports: ['/lifecycle'], polarity: 'contradicts' },
    ];

    assert.throws(() => snapshotCanonicalApplicationCatalog(input), /Canonical application catalog rejected/);
});

test('admits an operational row only when every permissive value has direct evidence', () => {
    const input = safeCatalog();
    const row = input.entries[0];
    const operational = row as Record<string, unknown>;
    row.lifecycle = 'active';
    row.implementation = 'available';
    operational.input = { kind: 'json_schema', schemaId: 'synthetic.catalog.input.v1' };
    operational.output = { kind: 'json_schema', schemaId: 'synthetic.catalog.output.v1' };
    row.mode = 'deterministic';
    row.maxStage = 'read';
    row.dataContext = { kind: 'none', freshness: 'none', retention: 'none' };
    row.authority.read = 'authenticated_session';
    row.execution = { kind: 'sync', cancel: 'not_applicable', revoke: 'not_applicable', rateLimit: { kind: 'deny' } };
    row.offline = 'not_applicable';
    row.headlessDisposition = 'available';
    row.uiSurfaces = ['headless_api'];
    operational.evidence = ['/lifecycle', '/implementation', '/input', '/output', '/mode', '/maxStage', '/dataContext/kind', '/dataContext/freshness', '/dataContext/retention', '/authority/read', '/execution/kind', '/execution/cancel', '/execution/revoke', '/offline', '/headlessDisposition', '/uiSurfaces'].map((supports) => ({ kind: 'synthetic_runtime', ref: `synthetic:${supports}`, supports: [supports], polarity: 'supports' }));

    assert.equal(snapshotCanonicalApplicationCatalog(input).entries[0].headlessDisposition, 'available');
});
