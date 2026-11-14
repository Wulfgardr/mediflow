import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const directory = 'docs/quality/intelligence/2026-11-13-ollama/';
const read = (name: string) => JSON.parse(fs.readFileSync(new URL(name, root), 'utf8'));
const measurement = read(directory + 'measurements.json');
const register = JSON.parse(fs.readFileSync(process.env.MEDIFLOW_WUL840_REGISTER ?? new URL('docs/quality/intelligence/registro-0.9.1.json', root), 'utf8'));
const functions = ['patient_insight', 'smart_import', 'document_synthesis'];

function validate(value: typeof register) {
    assert.equal(value.contractSha256, createHash('sha256').update(fs.readFileSync(new URL(value.contract, root))).digest('hex'));
    for (const functionId of functions) {
        const cell = value.cells.find((c: { id: string }) => c.id === functionId + '/ollama');
        assert.ok(cell?.modelIdentity, functionId + ': observed model identity required');
        assert.deepEqual(cell.modelIdentity, measurement.modelIdentity);
        assert.ok(cell.proof, functionId + ': runtime evidence required');
        assert.equal(cell.proof.path, directory + 'measurements.json');
        assert.equal(cell.proof.sourceRevision, measurement.sourceRevision);
        assert.equal(cell.proof.status, functionId === 'document_synthesis' ? 'blocked_local_extraction' : 'partial_http_execution');
        assert.equal(cell.qualification, 'not_qualified');
        assert.ok(cell.blockedBy.length > 0);
        assert.deepEqual(cell.surfaces, { web: 'not_verified', gpui: 'not_verified', chat: 'not_verified', headless: 'not_verified' });
        const baseline = measurement.i2.find((r: { functionId: string; scenario: string }) => r.functionId === functionId && r.scenario === 'complete');
        assert.ok(baseline);
        const actual = value.localProfile.measuredBudgets.cells[functionId];
        const samples: number[] = baseline.memory.rssSamplesBytes;
        const available = baseline.outcome === 'available';
        assert.equal(actual.latencyMs, available ? Math.ceil(baseline.elapsedMs * 1.2) : null);
        assert.equal(actual.rssBytes, available && samples.length ? Math.ceil(Math.max(...samples) * 1.2) : null);
        assert.equal(actual.gpuMemoryIncluded, false);
        assert.equal(actual.scope, 'single_I2_baseline_not_C-L_qualification');
    }
    assert.equal(value.sourceRevision, measurement.sourceRevision);
    assert.equal(value.localProfile.target, 'Mac17,10 Apple M5 Max 48 GB');
    assert.equal(value.localProfile.memoryBytes, 48 * 1024 ** 3);
    assert.equal(value.localProfile.latencyBudgetMs, null);
    assert.equal(value.localProfile.memoryBudgetBytes, null);
    assert.equal(value.localProfile.budgetReason, 'DS_blocked_C-L_errors_gpu_memory_unmeasured');
    for (const cell of value.cells.filter((c: { provider: string }) => c.provider === 'chatgpt')) {
        assert.equal(cell.proof, null);
        assert.equal(cell.qualification, 'not_qualified');
    }
}

test('WUL-840 binds observed identities and recalculates provisional +20% budgets from numeric samples', () => {
    validate(register);
    assert.equal(measurement.candidateRevision, '8954e9c97b4ea2016c20c8433b43ee0f5231607a');
    assert.equal(measurement.sourceRevision, '3e8455fe40243a0c45e471529058442946afc451');
    assert.equal(measurement.qualification, false);
    assert.equal(measurement.modelIdentity.digest, '26025611beeb3fe9e4850b1fdae686bebba7cdfa7f13ddb04955f19872ee022a');
    assert.equal(measurement.admission.status, 'passed');
    assert.equal(measurement.admission.networkProbe, 'EPERM');
    assert.equal(measurement.admission.stages.length, 11);
    for (const stage of measurement.admission.stages) {
        assert.equal(stage.digestBefore, measurement.modelIdentity.digest);
        assert.equal(stage.digestAfter, measurement.modelIdentity.digest);
    }
    assert.equal(measurement.methodSha256, createHash('sha256').update(fs.readFileSync(new URL(directory + 'metodo-v2.md', root))).digest('hex'));
    for (const sample of [...measurement.i2, ...measurement.interventions, ...measurement.cl]) {
        assert.ok(Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0);
        const values: number[] = sample.memory.rssSamplesBytes;
        assert.ok(values.every(n => Number.isSafeInteger(n) && n > 0));
        assert.equal(sample.memory.peakRssBytes, values.length ? Math.max(...values) : null);
        assert.equal(sample.memory.gpuMemoryMeasured, false);
    }
});

test('WUL-840 retains failures in C-L ranks and refuses a qualified budget for failed or incomplete groups', () => {
    assert.equal(measurement.aggregates.length, 6);
    assert.deepEqual(measurement.fixtureCounts, { events: 100, therapies: 30, documents: 10 });
    for (const fixture of measurement.pdfFixtures) { assert.equal(fixture.pages, 10); assert.equal(fixture.bytes, 10 * 1024 ** 2); }
    for (const group of measurement.aggregates) {
        const samples = measurement.cl.filter((r: { scenario: string; mode: string; phase: string }) => r.scenario === group.scenario && r.mode === group.mode && r.phase === 'measured');
        const times = samples.map((r: { elapsedMs: number }) => r.elapsedMs).sort((a: number, b: number) => a - b);
        const n = times.length;
        assert.equal(n, 30);
        assert.equal(group.n, n);
        assert.equal(new Set(samples.map((r: { run: number }) => r.run)).size, n);
        const errors = samples.filter((r: { outcome: string }) => r.outcome !== 'available').length;
        assert.equal(group.errors, errors);
        assert.equal(group.timeouts, samples.filter((r: { timeout: boolean }) => r.timeout).length);
        assert.equal(group.p50Ms, times[Math.ceil(n * 0.5) - 1]);
        assert.equal(group.p95Ms, times[Math.ceil(n * 0.95) - 1]);
        assert.equal(group.maxMs, times[n - 1]);
        assert.equal(group.latencyBudgetMs, errors ? null : Math.ceil(group.p95Ms * 1.2));
        if (group.mode === 'cold') assert.ok(samples.every((r: { coldModelAbsent: boolean }) => r.coldModelAbsent));
    }
});

test('WUL-840 rejects alias drift, absent evidence, invented budgets and qualification of incomplete proof', () => {
    for (const mutate of [
        (r: typeof register) => { r.cells.find((c: { provider: string }) => c.provider === 'ollama').modelIdentity = null; },
        (r: typeof register) => { r.cells.find((c: { provider: string }) => c.provider === 'ollama').modelIdentity.digest = '0'.repeat(64); },
        (r: typeof register) => { r.cells.find((c: { provider: string }) => c.provider === 'ollama').proof = null; },
        (r: typeof register) => { r.cells.find((c: { provider: string }) => c.provider === 'ollama').qualification = 'qualified'; },
        (r: typeof register) => { r.localProfile.measuredBudgets.cells.patient_insight.latencyMs++; },
        (r: typeof register) => { r.localProfile.measuredBudgets.cells.smart_import.rssBytes = 0; },
        (r: typeof register) => { r.localProfile.measuredBudgets.cells.document_synthesis.latencyMs = 0; },
        (r: typeof register) => { r.localProfile.latencyBudgetMs = 0; },
    ]) {
        const changed = structuredClone(register); mutate(changed);
        assert.throws(() => validate(changed));
    }
});

test('WUL-840 distinguishes independent verification from provisional baseline and component-only budgets', () => {
    assert.equal(measurement.verification.length, 2);
    for (const row of measurement.verification) {
        const budget = register.localProfile.measuredBudgets.cells[row.functionId];
        assert.equal(row.withinLatencyBudget, row.outcome === 'available' && row.elapsedMs <= budget.latencyMs);
        assert.equal(row.withinRssBudget, row.outcome === 'available' && row.memory.peakRssBytes !== null && row.memory.peakRssBytes <= budget.rssBytes);
        assert.equal(row.latencyBudgetMs, budget.latencyMs);
        assert.equal(row.rssBudgetBytes, budget.rssBytes);
    }
    assert.equal(measurement.clDiagnosticWarmConditionNotEstablished.length, 62);
    for (const row of measurement.cl.filter((r: { scenario: string; mode: string }) => r.scenario.startsWith('pdf-') && r.mode === 'warm')) {
        assert.equal(row.warmModelDigest, measurement.modelIdentity.digest);
    }
    const component = read(directory + 'component.json');
    assert.equal(component.scope, 'gliner_and_redaction_session_component_only');
    assert.equal(component.hostSourceRevision, measurement.sourceRevision);
    assert.equal(component.daemonModelResidentBefore, false);
    assert.equal(component.characters, 10000);
    assert.ok(component.identity);
    assert.equal(component.identity.workerSha256, read(directory + 'admission.json').redaction.workerSha256);
    assert.equal(component.samples.filter((r: { phase: string }) => r.phase === 'warmup').length, 1);
    for (const mode of ['cold', 'warm']) {
        const samples = component.samples.filter((r: { mode: string; phase: string }) => r.mode === mode && r.phase === 'measured');
        const times = samples.map((r: { elapsedMs: number }) => r.elapsedMs).sort((a: number, b: number) => a - b);
        assert.equal(samples.length, 30);
        const errors = samples.filter((r: { outcome: string }) => r.outcome !== 'ok').length;
        const group = component.aggregates[mode];
        assert.equal(group.errors, errors);
        assert.equal(group.p50Ms, times[14]);
        assert.equal(group.p95Ms, times[28]);
        assert.equal(group.maxMs, times[29]);
        assert.equal(group.latencyBudgetMs, errors ? null : Math.ceil(times[28] * 1.2));
    }
    const values: number[] = component.memory.rssSamplesBytes;
    assert.ok(values.length > 0 && values.every(n => Number.isSafeInteger(n) && n > 0));
    assert.equal(component.memory.peakRssBytes, Math.max(...values));
    assert.equal(component.memory.budgetBytes, Math.ceil(Math.max(...values) * 1.2));
});
