/* @Codex — strict diagnostics over evidence. A positive return is NOT an egress grant. */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { REDACTION_RUNTIME_ADAPTER, REDACTION_RUNTIME_FILES, REDACTION_RUNTIME_MODEL, REDACTION_RUNTIME_PACKAGES,
    REDACTION_RUNTIME_REVISION, REDACTION_RUNTIME_SCHEMA, REDACTION_WORKER_SHA256, type RedactionRuntimeIdentity } from './redaction-runtime-identity';

const SHA = /^[a-f0-9]{64}$/u;
const STATES = ['shadow-ready', 'shadow-active', 'active-with-fallback'];
export const evidenceHash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('evidence_invalid');
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') throw new Error('evidence_invalid');
        const d = Object.getOwnPropertyDescriptor(value, key);
        if (!d?.enumerable || !('value' in d)) throw new Error('evidence_invalid');
        result[key] = d.value;
    }
    return result;
}
function exact(value: unknown, expected: Readonly<Record<string, string>>): boolean {
    const got = object(value);
    return Object.keys(got).length === Object.keys(expected).length && Object.entries(expected).every(([k, v]) => got[k] === v);
}
export function parseRedactionRuntimeIdentity(value: unknown): RedactionRuntimeIdentity | null {
    try {
        const v = object(value);
        if (Object.keys(v).length !== 8 || v.schema !== REDACTION_RUNTIME_SCHEMA || v.adapter !== REDACTION_RUNTIME_ADAPTER
            || v.model !== REDACTION_RUNTIME_MODEL || v.revision !== REDACTION_RUNTIME_REVISION
            || v.workerSha256 !== REDACTION_WORKER_SHA256 || typeof v.pythonSha256 !== 'string' || !SHA.test(v.pythonSha256)
            || !exact(v.files, REDACTION_RUNTIME_FILES) || !exact(v.packages, REDACTION_RUNTIME_PACKAGES)) return null;
        return Object.freeze({ schema: REDACTION_RUNTIME_SCHEMA, adapter: REDACTION_RUNTIME_ADAPTER, model: REDACTION_RUNTIME_MODEL,
            revision: REDACTION_RUNTIME_REVISION, workerSha256: REDACTION_WORKER_SHA256, pythonSha256: v.pythonSha256,
            files: REDACTION_RUNTIME_FILES, packages: REDACTION_RUNTIME_PACKAGES });
    } catch { return null; }
}
export function redactionIdentityDigest(identity: RedactionRuntimeIdentity): string {
    const parsed = parseRedactionRuntimeIdentity(identity);
    if (!parsed) throw new Error('redaction_identity_invalid');
    return evidenceHash(JSON.stringify(parsed));
}
export type RedactionEvidenceEvaluation = Readonly<{ status: 'valid' | 'denied'; reasons: readonly string[]; identityDigest: string | null; expiresAt: number | null }>;
/** The host supplies files it just read and the observed worker identity. Raw
 * report booleans, an unbound selectedModel or a gold/oracle adapter never pass. */
export function evaluateRedactionRuntimeEvidence(input: Readonly<{
    validation: unknown; validationSha256: string; corpus: unknown; corpusSha256: string;
    rollout: unknown; observed: unknown; now: number;
}>): RedactionEvidenceEvaluation {
    const reasons: string[] = [];
    const deny = (reason: string) => { reasons.push(reason); };
    let identityDigest: string | null = null, expiresAt: number | null = null;
    try {
        const observed = parseRedactionRuntimeIdentity(input.observed);
        const report = object(input.validation), binding = object(report.runtimeBinding), rollout = object(input.rollout);
        const boundIdentity = parseRedactionRuntimeIdentity(binding.identity);
        if (!observed || !boundIdentity || redactionIdentityDigest(observed) !== redactionIdentityDigest(boundIdentity)) deny('runtime_identity');
        else identityDigest = redactionIdentityDigest(observed);
        if (!SHA.test(input.validationSha256) || !SHA.test(input.corpusSha256) || binding.corpusSha256 !== input.corpusSha256) deny('corpus_digest');
        const readyBinding = object(rollout.runtimeBinding);
        if (readyBinding.validationSha256 !== input.validationSha256 || readyBinding.identityDigest !== identityDigest) deny('readiness_binding');
        if (rollout.lane !== 'redaction' || rollout.status !== 'shadow-ready' || !STATES.includes(String(rollout.currentState))
            || rollout.selectedModel !== REDACTION_RUNTIME_MODEL || !Array.isArray(rollout.blockers) || rollout.blockers.length) deny('lane_state');
        const governance = object(rollout.evidence);
        if (governance.fallbackWritten !== true || governance.licenseClear !== true || typeof governance.owner !== 'string'
            || governance.owner.trim().length === 0 || governance.owner.length > 256) deny('existing_governance_prerequisites');
        const maxAge = governance.maxAgeDays;
        const generated = Date.parse(String(report.generatedAt));
        const evaluated = Date.parse(String(rollout.generatedAt));
        if (typeof maxAge !== 'number' || !Number.isFinite(maxAge) || maxAge <= 0
            || !Number.isFinite(input.now) || !Number.isFinite(generated) || !Number.isFinite(evaluated)
            || generated > evaluated || evaluated > input.now || governance.reportGeneratedAt !== report.generatedAt) deny('evidence_time');
        else { expiresAt = generated + maxAge * 86400000; if (input.now >= expiresAt) deny('evidence_expired'); }
        const benchmark = object(report.benchmark), metrics = object(benchmark.metrics);
        const corpusRoot = Array.isArray(input.corpus) ? {} : object(input.corpus);
        const corpus = Array.isArray(corpusRoot.cases) ? corpusRoot.cases : Array.isArray(corpusRoot.entries) ? corpusRoot.entries : null;
        // The benchmark corpus is a JSON array in the original tooling as well.
        const corpusCases = Array.isArray(input.corpus) ? input.corpus : corpus;
        if (!corpusCases || corpusCases.length === 0 || corpusCases.length > 2048 || !Array.isArray(benchmark.cases)
            || benchmark.cases.length !== corpusCases.length || benchmark.corpusSize !== corpusCases.length) throw new Error('corpus_cases');
        if (report.schemaVersion !== 'mediflow.redaction-runtime-validation.v1' || report.shadowReady !== true || !Array.isArray(report.failures) || report.failures.length !== 0
            || report.adapterModule !== REDACTION_RUNTIME_ADAPTER || benchmark.adapter !== REDACTION_RUNTIME_ADAPTER
            || benchmark.schemaVersion !== 'mediflow.redaction.v1' || binding.benchmarkSha256 !== evidenceHash(JSON.stringify(benchmark))) deny('validation_contract');
        if (metrics.contractValidRate !== 1 || metrics.offsetIntegrityRate !== 1 || metrics.criticalRecall !== 1 || metrics.forbiddenLeakRate !== 0) deny('required_metrics');
        const ids = new Set<string>(); let critical = 0;
        const expectedCritical: Record<string, number> = Object.create(null);
        for (let i = 0; i < corpusCases.length; i++) {
            const c = object(corpusCases[i]), test = object(benchmark.cases[i]), gold = object(c.gold);
            if (typeof c.id !== 'string' || !c.id || ids.has(c.id) || test.id !== c.id) deny('case_identity');
            ids.add(String(c.id));
            if (!Array.isArray(gold.entities) || !Array.isArray(gold.forbiddenTokens) || typeof c.inputText !== 'string') throw new Error('corpus_shape');
            for (const raw of gold.entities) {
                const e = object(raw);
                if (typeof e.type !== 'string' || !['person','date','phone','address','tax_id','email','organization','identifier','other'].includes(e.type) || typeof e.text !== 'string' || !e.text || (e.critical !== undefined && typeof e.critical !== 'boolean')) throw new Error('gold_shape');
                if (e.critical === true) { critical++; expectedCritical[e.type] = (expectedCritical[e.type] ?? 0) + 1; }
            }
            if (test.contractValid !== true || test.criticalRecall !== 1 || test.offsetIntegrityRate !== 1 || test.forbiddenLeakCount !== 0
                || !Array.isArray(test.leakedForbiddenTokens) || test.leakedForbiddenTokens.length !== 0 || !Array.isArray(test.missingEntities)
                || test.missingEntities.some(e => object(e).critical === true) || Object.hasOwn(test, 'error')) deny('case_failed');
        }
        if (!critical) deny('no_critical_observations');
        // Recompute the critical totals instead of accepting a standalone 1.0.
        const typesMetrics = object(metrics.recallByType);
        let criticalGold = 0, criticalMatched = 0;
        for (const [type, entry] of Object.entries(typesMetrics)) {
            const m = object(entry);
            if (!Number.isSafeInteger(m.criticalGoldCount) || !Number.isSafeInteger(m.criticalMatchedCount)
                || Number(m.criticalGoldCount) < 0 || m.criticalMatchedCount !== m.criticalGoldCount
                || m.criticalRecall !== 1 || m.criticalGoldCount !== (expectedCritical[type] ?? 0)) deny('critical_counts');
            criticalGold += Number(m.criticalGoldCount); criticalMatched += Number(m.criticalMatchedCount);
        }
        if (criticalGold !== critical || criticalMatched !== critical) deny('critical_totals');
    } catch { deny('evidence_shape'); }
    return Object.freeze({ status: reasons.length ? 'denied' : 'valid', reasons: Object.freeze([...new Set(reasons)]), identityDigest, expiresAt });
}
