/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    DOCUMENT_DECISION_FAILURE_COUNTERS,
    runDocumentDecisionFailureCounterBenchmark,
} from './document-decision-benchmark';

test('document decision failure counter benchmark keeps every adversarial counter at zero', () => {
    const report = runDocumentDecisionFailureCounterBenchmark();

    assert.equal(report.schemaVersion, 'mediflow.document_decision_failure_counter.v1');
    assert.equal(report.totalFailureCount, 0);
    assert.deepEqual(
        Object.keys(report.counters).sort(),
        [...DOCUMENT_DECISION_FAILURE_COUNTERS].sort(),
    );
    for (const counter of DOCUMENT_DECISION_FAILURE_COUNTERS) {
        assert.equal(report.counters[counter], 0, counter);
    }
});

test('document decision benchmark CLI emits the production report and validates it', () => {
    const args = ['scripts/run-strip-types.mjs', 'scripts/benchmark-document-decision.ts'];
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 'mediflow.document_decision_failure_counter.v1');
    assert.equal(report.cases.length, 8);
    assert.equal(report.totalFailureCount, 0);

    const validation = spawnSync(process.execPath, [...args, '--validate'], { encoding: 'utf8' });
    assert.equal(validation.status, 0, validation.stderr);
});
