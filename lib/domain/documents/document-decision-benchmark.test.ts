/* @Codex */
import test from 'node:test';
import assert from 'node:assert/strict';
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
