#!/usr/bin/env node

/* @Codex */
import { runDocumentDecisionFailureCounterBenchmark } from '../lib/domain/documents/document-decision-benchmark';

const report = runDocumentDecisionFailureCounterBenchmark();

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (process.argv.includes('--validate') && report.totalFailureCount !== 0) {
    process.exitCode = 1;
}
