#!/usr/bin/env node
/* @Codex — explicit local measurement / explicit existing-governance decision.
 * Never starts a cloud process, enables cloud settings, or grants clinical use. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runRedactionBenchmark } from './benchmark-redaction';
import { evaluateRolloutReadiness } from './benchmark-rollout-readiness';
import { readOrdinaryRedactionInstallation } from '../lib/chatgpt-execution/ordinary-governance';
import { createGlinerRedactionRunner, readGlinerRuntimeObservation } from '../lib/gliner-redaction-runner';
import { createRedactionSession } from '../lib/ai-redaction-session';
import { REDACTION_RUNTIME_ADAPTER } from '../lib/redaction-runtime-identity';
import { evaluateRedactionRuntimeEvidence, redactionIdentityDigest } from '../lib/ai-redaction-evidence';
import { getAiRolloutReadinessArtifactPaths } from '../lib/ai-rollout-readiness-storage';
const digest = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
function read(file: string) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || stat.mode & 0o022) throw new Error('evidence_file_invalid');
        const bytes = fs.readFileSync(fd); const after = fs.fstatSync(fd);
        if (stat.ino !== after.ino || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) throw new Error('evidence_changed');
        return { value: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) }; } finally { fs.closeSync(fd); }
}
function write(file: string, value: unknown) {
    const bytes = JSON.stringify(value, null, 2) + '\n'; fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const pending = `${file}.pending-${process.pid}`;
    const fd = fs.openSync(pending, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(pending, file); return digest(bytes);
}
/** Runs the exact local layer1+neural composition. The adapter never reads gold. */
export async function measureRuntimeRedaction(corpusPath: string, outputPath: string) {
    const corpus = read(corpusPath), installation = readOrdinaryRedactionInstallation();
    const runner = createGlinerRedactionRunner(installation.configuration);
    try {
        const benchmark = await runRedactionBenchmark({ corpusPath, adapterModule: null }, {
            name: REDACTION_RUNTIME_ADAPTER,
            async run(entry) {
                const session = createRedactionSession();
                try {
                    const entities = await runner.extract(entry.inputText);
                    const prepared = session.prepare({ text: entry.inputText, entities });
                    if (prepared.rehydrate(prepared.redactedText) !== entry.inputText) throw new Error('roundtrip_failed');
                    return { schemaVersion: 'mediflow.redaction.v1', redactedText: prepared.redactedText,
                        entities: prepared.spans.map(span => ({ type: span.type, text: entry.inputText.slice(span.start, span.end),
                            start: span.start, end: span.end, replacement: span.replacement, confidence: 1 })) };
                } finally { session.close(); }
            },
        });
        const identity = readGlinerRuntimeObservation(runner);
        if (!identity || redactionIdentityDigest(identity) !== redactionIdentityDigest(installation.identity)
            || read(corpusPath).sha256 !== corpus.sha256) throw new Error('runtime_evidence_changed');
        const failures = benchmark.cases.filter(c => !c.contractValid || c.criticalRecall !== 1 || c.offsetIntegrityRate !== 1 || c.forbiddenLeakCount !== 0)
            .map(c => ({ id: c.id, message: 'runtime_case_failed' }));
        const validation = { schemaVersion: 'mediflow.redaction-runtime-validation.v1', generatedAt: new Date().toISOString(), corpusPath,
            adapterModule: REDACTION_RUNTIME_ADAPTER, shadowReady: failures.length === 0, failures, benchmark,
            runtimeBinding: { identity, corpusSha256: corpus.sha256, benchmarkSha256: digest(JSON.stringify(benchmark)) } };
        const sha256 = write(outputPath, validation);
        return { sha256, shadowReady: validation.shadowReady, cases: benchmark.corpusSize };
    } finally { await runner.close(); }
}
/** Separate explicit command. A successful measurement alone never writes this record. */
export function recordRuntimeReadiness(validationPath: string, owner: string, licenseClear: boolean, fallbackWritten: boolean, currentState: string) {
    if (!owner.trim() || owner.length > 160 || !licenseClear || !fallbackWritten || currentState !== 'shadow-ready') throw new Error('explicit_governance_decision_required');
    const validation = read(validationPath), identity = readOrdinaryRedactionInstallation().identity;
    const corpus = read(path.resolve(validation.value.corpusPath));
    const diagnostic = evaluateRolloutReadiness({ lane: 'redaction', report: validation.value, reportPath: validationPath,
        model: identity.model, currentState: 'shadow-ready', fallbackWritten, owner, licenseClear, maxAgeDays: 30 });
    // The historical diagnostic has selectedModel:null; never interpret that as
    // a runtime grant. The complete host evaluator binds it to observed files.
    const candidate = { ...diagnostic, selectedModel: identity.model,
        runtimeBinding: { validationSha256: validation.sha256, identityDigest: redactionIdentityDigest(identity) } };
    const verdict = evaluateRedactionRuntimeEvidence({ validation: validation.value, validationSha256: validation.sha256,
        corpus: corpus.value, corpusSha256: corpus.sha256, rollout: candidate, observed: identity, now: Date.now() });
    if (verdict.status !== 'valid') throw new Error(`runtime_readiness_denied:${verdict.reasons.join(',')}`);
    if (read(validationPath).sha256 !== validation.sha256 || redactionIdentityDigest(readOrdinaryRedactionInstallation().identity) !== verdict.identityDigest) throw new Error('evidence_changed');
    return write(getAiRolloutReadinessArtifactPaths('redaction').jsonPath, candidate);
}
async function main() {
    const args = process.argv.slice(2), mode = args.shift();
    const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    if (mode === 'measure' && arg('--corpus') && arg('--out')) {
        console.log(JSON.stringify(await measureRuntimeRedaction(path.resolve(arg('--corpus')!), path.resolve(arg('--out')!))));
    } else if (mode === 'record' && arg('--validation') && arg('--owner')) {
        console.log(JSON.stringify({ sha256: recordRuntimeReadiness(path.resolve(arg('--validation')!), arg('--owner')!, args.includes('--license-clear'), args.includes('--fallback-written'), arg('--current-state') ?? '') }));
    } else throw new Error('usage: measure --corpus LOCAL_JSON --out LOCAL_JSON | record --validation LOCAL_JSON --owner OWNER --license-clear --fallback-written --current-state shadow-ready');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) void main().catch(() => { console.error('redaction_runtime_evidence_failed'); process.exitCode = 1; });
