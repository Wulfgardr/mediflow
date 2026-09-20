/* @Codex — synthetic evidence diagnostics, never an installed-model admission. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceHash, evaluateRedactionRuntimeEvidence, parseRedactionRuntimeIdentity, redactionIdentityDigest } from './ai-redaction-evidence';
import { REDACTION_RUNTIME_ADAPTER, REDACTION_RUNTIME_SCHEMA, REDACTION_RUNTIME_MODEL, REDACTION_RUNTIME_REVISION, REDACTION_WORKER_SHA256, REDACTION_RUNTIME_PACKAGES, REDACTION_RUNTIME_FILES } from './redaction-runtime-identity';

function fixture() {
    const generatedAt = '2026-09-12T00:00:00.000Z';
    const identity = { schema: String(REDACTION_RUNTIME_SCHEMA), adapter: String(REDACTION_RUNTIME_ADAPTER), model: String(REDACTION_RUNTIME_MODEL),
        revision: String(REDACTION_RUNTIME_REVISION), workerSha256: REDACTION_WORKER_SHA256, pythonSha256: 'a'.repeat(64),
        packages: { ...REDACTION_RUNTIME_PACKAGES } as Record<string, string>, files: { ...REDACTION_RUNTIME_FILES } as Record<string, string> };
    const corpus = [{ id: 'synthetic-critical-1', inputText: 'Email: fixture@example.invalid', gold: { redactedText: 'Email: {{EMAIL_1}}',
        entities: [{ type: 'email', text: 'fixture@example.invalid', critical: true }], forbiddenTokens: ['fixture@example.invalid'] } }];
    const benchmark = { generatedAt, schemaVersion: 'mediflow.redaction.v1', corpusPath: '/synthetic/corpus.json', corpusSize: 1,
        adapter: String(REDACTION_RUNTIME_ADAPTER), metrics: { contractValidRate: 1, entityRecall: 1, criticalRecall: 1, forbiddenLeakRate: 0,
            offsetIntegrityRate: 1, avgLatencyMs: 1, p95LatencyMs: 1, recallByType: { email: { goldCount: 1, matchedCount: 1, recall: 1,
                criticalGoldCount: 1, criticalMatchedCount: 1, criticalRecall: 1 } } },
        cases: [{ id: corpus[0].id, latencyMs: 1, contractValid: true, entityRecall: 1, criticalRecall: 1, forbiddenLeakCount: 0,
            leakedForbiddenTokens: [], missingEntities: [], offsetIntegrityRate: 1 }] };
    const corpusSha256 = evidenceHash(JSON.stringify(corpus));
    const validation = { schemaVersion: 'mediflow.redaction-runtime-validation.v1', generatedAt, corpusPath: '/synthetic/corpus.json',
        adapterModule: String(REDACTION_RUNTIME_ADAPTER), shadowReady: true, failures: [], benchmark,
        runtimeBinding: { identity, corpusSha256, benchmarkSha256: evidenceHash(JSON.stringify(benchmark)) } };
    const validationSha256 = evidenceHash(JSON.stringify(validation));
    const rollout = { generatedAt, lane: 'redaction', status: 'shadow-ready', currentState: 'shadow-ready', selectedModel: String(REDACTION_RUNTIME_MODEL),
        blockers: [], evidence: { fallbackWritten: true, licenseClear: true, owner: 'synthetic-review-owner', maxAgeDays: 30, reportGeneratedAt: generatedAt },
        runtimeBinding: { validationSha256, identityDigest: redactionIdentityDigest(parseRedactionRuntimeIdentity(identity)!) } };
    return { validation, validationSha256, corpus, corpusSha256, rollout, observed: identity, now: Date.parse(generatedAt) + 1000 };
}
test('complete synthetic evidence is structurally valid, not a runtime authority', () => {
    const result = evaluateRedactionRuntimeEvidence(fixture());
    assert.equal(result.status, 'valid'); assert.deepEqual(result.reasons, []);
    assert.deepEqual(Object.keys(result).sort(), ['expiresAt','identityDigest','reasons','status']);
});
test('bare historical shadowReady without model, corpus, metrics and runner is denied', () => {
    const value = fixture();
    value.validation = { generatedAt: value.validation.generatedAt, shadowReady: true } as typeof value.validation;
    value.rollout.selectedModel = null as unknown as typeof value.rollout.selectedModel;
    assert.equal(evaluateRedactionRuntimeEvidence(value).status, 'denied');
});
const mutations: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ['unknown schema', f => { f.validation.schemaVersion = 'unknown'; }],
    ['gold adapter', f => { f.validation.adapterModule = 'gold'; }],
    ['benchmark oracle', f => { f.validation.benchmark.adapter = 'oracle'; }],
    ['corpus replacement', f => { f.corpusSha256 = 'b'.repeat(64); }],
    ['report replacement', f => { f.validationSha256 = 'b'.repeat(64); }],
    ['benchmark replacement', f => { f.validation.runtimeBinding.benchmarkSha256 = 'c'.repeat(64); }],
    ['readiness identity replacement', f => { f.rollout.runtimeBinding.identityDigest = 'd'.repeat(64); }],
    ['observed Python mismatch', f => { f.observed = { ...f.observed, pythonSha256: 'e'.repeat(64) }; }],
    ['observed worker mismatch', f => { f.observed = { ...f.observed, workerSha256: 'e'.repeat(64) }; }],
    ['observed model mismatch', f => { f.observed = { ...f.observed, model: 'openmed' }; }],
    ['observed revision mismatch', f => { f.observed = { ...f.observed, revision: '0'.repeat(40) }; }],
    ['package mismatch', f => { f.observed = { ...f.observed, packages: { ...f.observed.packages, torch: '0.0.0' } }; }],
    ['weights mismatch', f => { f.observed = { ...f.observed, files: { ...f.observed.files, 'model.safetensors': '0'.repeat(64) } }; }],
    ['lane mismatch', f => { f.rollout.lane = 'smart_import'; }],
    ['hold', f => { f.rollout.currentState = 'hold'; }],
    ['benchmark-only', f => { f.rollout.currentState = 'benchmark-only'; }],
    ['selected model unbound', f => { f.rollout.selectedModel = 'deliberately-unbound'; }],
    ['rollout denial', f => { f.rollout.status = 'hold'; }],
    ['blocker', f => { (f.rollout.blockers as unknown[]).push({id:'hold'}); }],
    ['no existing owner', f => { f.rollout.evidence.owner = ''; }],
    ['no license decision', f => { f.rollout.evidence.licenseClear = false; }],
    ['no written fallback decision', f => { f.rollout.evidence.fallbackWritten = false; }],
    ['no age limit', f => { f.rollout.evidence.maxAgeDays = NaN; }],
    ['expired at exact boundary', f => { f.now += 30 * 86400000; }],
    ['future evaluation', f => { f.rollout.generatedAt = '2027-01-01T00:00:00.000Z'; }],
    ['timestamp provenance mismatch', f => { f.rollout.evidence.reportGeneratedAt = '2026-09-11T00:00:00.000Z'; }],
    ['shadow flag false', f => { f.validation.shadowReady = false; }],
    ['failed validation', f => { (f.validation.failures as unknown[]).push({id:'failure'}); }],
    ['case removed', f => { f.validation.benchmark.cases = []; }],
    ['case wrong identity', f => { f.validation.benchmark.cases[0].id = 'another'; }],
    ['invalid output contract', f => { f.validation.benchmark.cases[0].contractValid = false; }],
    ['critical miss', f => { f.validation.benchmark.cases[0].criticalRecall = 0; }],
    ['leak', f => { f.validation.benchmark.cases[0].forbiddenLeakCount = 1; }],
    ['bad offsets', f => { f.validation.benchmark.cases[0].offsetIntegrityRate = 0; }],
    ['metrics alone counterfeit', f => { f.validation.benchmark.metrics.recallByType.email.criticalMatchedCount = 0; }],
    ['per-type counts do not match corpus', f => { f.validation.benchmark.metrics.recallByType.email.criticalGoldCount = 10; }],
    ['no critical observations', f => { f.corpus[0].gold.entities[0].critical = false; }],
];
for (const [label, mutate] of mutations) test(`evidence denies ${label}`, () => {
    const f = fixture(); mutate(f);
    // Refresh report hashing: substantive mutations must be denied independently
    // of a stale digest. Intentional hash-mismatch tests retain their bad hashes.
    if (!['corpus replacement','report replacement','benchmark replacement'].includes(label)) {
        f.validation.runtimeBinding.benchmarkSha256 = evidenceHash(JSON.stringify(f.validation.benchmark));
        f.validationSha256 = evidenceHash(JSON.stringify(f.validation));
        f.rollout.runtimeBinding.validationSha256 = f.validationSha256;
    }
    assert.equal(evaluateRedactionRuntimeEvidence(f).status, 'denied', label);
});
test('identity parser rejects copied shape with extra fields, proxy and getter without invoking it', () => {
    const f = fixture(); let hits = 0;
    assert.equal(parseRedactionRuntimeIdentity({...f.observed, approved: true}), null);
    assert.equal(parseRedactionRuntimeIdentity(new Proxy(f.observed, {})), null);
    const getter = {...f.observed}; Object.defineProperty(getter, 'model', {enumerable:true, get() {hits++;return REDACTION_RUNTIME_MODEL;}});
    assert.equal(parseRedactionRuntimeIdentity(getter), null); assert.equal(hits,0);
});
test('all corpus critical types must be counted, not just favorable aggregate', () => {
    const f = fixture(); f.corpus[0].gold.entities.push({ type:'tax_id', text:'synthetic-tax-id', critical:true });
    f.corpusSha256=evidenceHash(JSON.stringify(f.corpus)); f.validation.runtimeBinding.corpusSha256=f.corpusSha256;
    f.validationSha256=evidenceHash(JSON.stringify(f.validation)); f.rollout.runtimeBinding.validationSha256=f.validationSha256;
    assert.equal(evaluateRedactionRuntimeEvidence(f).status,'denied');
});
