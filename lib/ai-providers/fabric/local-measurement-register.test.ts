import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, root), 'utf8'));
const evidencePath = 'docs/quality/intelligence/2026-11-13-ollama/';
const admission = read(`${evidencePath}admission.json`);
const register = JSON.parse(fs.readFileSync(process.env.MEDIFLOW_WUL840_REGISTER ?? new URL('docs/quality/intelligence/registro-0.9.1.json', root), 'utf8'));

function verifyRegister(value: typeof register) {
    for (const id of ['patient_insight', 'smart_import', 'document_synthesis']) {
        const cell = value.cells.find((c: { id: string }) => c.id === `${id}/ollama`);
        assert.ok(cell?.modelIdentity, `${id}: observed model identity required`);
        assert.deepEqual(cell.modelIdentity, admission.modelIdentity);
        assert.ok(cell.proof, `${id}: admission evidence required`);
        assert.equal(cell.proof.path, `${evidencePath}admission.json`);
        assert.equal(cell.proof.sourceRevision, admission.sourceRevision);
        assert.equal(cell.proof.status, 'blocked_before_inference');
        assert.equal(cell.qualification, 'not_qualified');
        assert.ok(cell.blockedBy.includes('provider_version_unsupported'));
        assert.deepEqual(cell.surfaces, { web: 'not_verified', gpui: 'not_verified', chat: 'not_verified', headless: 'not_verified' });
    }
    assert.equal(value.localProfile.target, 'Mac17,10 Apple M5 Max 48 GB');
    assert.equal(value.localProfile.memoryBytes, admission.machine.memoryBytes);
    // A component sample or an admission denial cannot manufacture an E2E budget.
    assert.equal(value.localProfile.memoryBudgetBytes, null);
    assert.equal(value.localProfile.latencyBudgetMs, null);
    assert.equal(value.localProfile.budgetReason, 'provider_version_unsupported_no_end_to_end_baseline');
}

test('WUL-840 binds the three denied Ollama cells to current identity and evidence', () => {
    verifyRegister(register);
    assert.equal(admission.attestation.code, 'provider_version_unsupported');
    assert.equal(admission.attestation.versionMismatch.serverVersion, admission.modelIdentity.providerVersion);
    assert.equal(admission.inferenceAttempts, 0);
    assert.equal(admission.qualification, false);
    assert.equal(createHash('sha256').update(fs.readFileSync(new URL(`${evidencePath}metodo.md`, root))).digest('hex'), admission.methodSha256);
    for (const cell of admission.cells) {
        assert.equal(cell.latencyBudgetMs, null);
        assert.equal(cell.memoryBudgetBytes, null);
        for (const key of ['proposal', 'sources', 'errorCase', 'cancelDuringInference', 'revokeDuringInference']) assert.equal(cell[key], false);
    }
});

test('WUL-840 rejects missing identity, alias drift, qualification and fabricated budgets', () => {
    for (const mutate of [
        (r: typeof register) => { r.cells.find((c: { provider: string }) => c.provider === 'ollama').modelIdentity = null; },
        (r: typeof register) => { r.cells.find((c: { provider: string }) => c.provider === 'ollama').modelIdentity.digest = '0'.repeat(64); },
        (r: typeof register) => { r.cells.find((c: { provider: string }) => c.provider === 'ollama').proof = null; },
        (r: typeof register) => { r.cells.find((c: { provider: string }) => c.provider === 'ollama').qualification = 'qualified'; },
        (r: typeof register) => { r.localProfile.latencyBudgetMs = 0; },
    ]) {
        const changed = structuredClone(register); mutate(changed);
        assert.throws(() => verifyRegister(changed));
    }
});

test('WUL-840 recomputes component distributions and +20% budgets without dropping failures', () => {
    const measurement = read(`${evidencePath}component.json`);
    assert.equal(measurement.scope, 'gliner_and_redaction_session_component_only');
    assert.equal(measurement.characters, 10000);
    assert.equal(measurement.samples.filter((s: { phase: string }) => s.phase === 'warmup').length, 1);
    for (const mode of ['cold', 'warm']) {
        const samples = measurement.samples.filter((s: { mode: string; phase: string }) => s.mode === mode && s.phase === 'measured');
        assert.equal(samples.length, 30);
        assert.equal(new Set(samples.map((s: { run: number }) => s.run)).size, 30);
        const times = samples.map((s: { elapsedMs: number }) => s.elapsedMs).sort((a: number, b: number) => a - b);
        assert.ok(times.every((n: number) => Number.isFinite(n) && n >= 0));
        const aggregate = measurement.aggregates[mode];
        const errors = samples.filter((s: { outcome: string }) => s.outcome !== 'ok').length;
        assert.equal(aggregate.errors, errors);
        assert.equal(aggregate.p50Ms, times[14]);
        assert.equal(aggregate.p95Ms, times[28]);
        assert.equal(aggregate.maxMs, times[29]);
        assert.equal(aggregate.latencyBudgetMs, errors ? null : Math.ceil(times[28] * 1.2));
    }
    // Observed RSS includes idle production host and Ollama, not just Python.
    assert.ok(measurement.memory.samples > 0);
    assert.ok(measurement.memory.peakRssBytes > 0);
    assert.equal(measurement.memory.budgetBytes, Math.ceil(measurement.memory.peakRssBytes * 1.2));
    assert.deepEqual(register.localProfile.componentBudgets, {
        evidence: `${evidencePath}component.json`, scope: measurement.scope,
        coldLatencyMs: measurement.aggregates.cold.latencyBudgetMs,
        warmLatencyMs: measurement.aggregates.warm.latencyBudgetMs,
        memoryBytes: measurement.memory.budgetBytes,
    });
});
