/* @Codex — named host composition. No caller settings, readiness callback or grant. */
import 'server-only';
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { getAiRolloutReadinessArtifactPaths } from '../ai-rollout-readiness-storage';
import { evaluateRedactionRuntimeEvidence, evidenceHash, redactionIdentityDigest } from '../ai-redaction-evidence';
import { REDACTION_RUNTIME_ADAPTER, REDACTION_RUNTIME_FILES, REDACTION_RUNTIME_MODEL, REDACTION_RUNTIME_PACKAGES,
    REDACTION_RUNTIME_REVISION, REDACTION_RUNTIME_SCHEMA, REDACTION_WORKER_SHA256, type RedactionRuntimeIdentity } from '../redaction-runtime-identity';
import { isAiLaneEnabledValue } from '../ai-lane-kill-switch';
import { FUNCTION_SWITCH_KEYS, type FunctionModelId } from '../ai-providers/fabric/function-model-preferences';
import { readOrdinaryCloudSettings, type OrdinaryCloudSettings } from '../chatgpt-product/ordinary-settings';
import type { OrdinaryRunnerConfiguration, PreparedOrdinaryRead } from './ordinary-preparation';

const fileDigests = new Map<string, { fingerprint: string; digest: string }>();
function fingerprint(s: ReturnType<typeof fstatSync>): string {
    return [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs].join(':');
}
/** Read from the opened file, verify unchanged, never trust stat-before-read alone. */
function file(name: string, maximum: number, keep = true): Readonly<{ text: string; sha256: string }> {
    const actual = realpathSync(name);
    const fd = openSync(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = fstatSync(fd);
        if (!before.isFile() || before.size <= 0 || before.size > maximum || before.mode & 0o022) throw new Error('artifact_invalid');
        const stamp = fingerprint(before), cached = keep ? undefined : fileDigests.get(actual);
        if (cached?.fingerprint === stamp) return { text: '', sha256: cached.digest };
        const hash = createHash('sha256'), chunks: Buffer[] = [], buffer = Buffer.alloc(Math.min(maximum, 1048576));
        let total = 0;
        for (;;) {
            const count = readSync(fd, buffer, 0, buffer.length, null); if (!count) break;
            total += count; if (total > maximum) throw new Error('artifact_invalid');
            hash.update(buffer.subarray(0, count)); if (keep) chunks.push(Buffer.from(buffer.subarray(0, count)));
        }
        if (fingerprint(fstatSync(fd)) !== stamp || total !== before.size || realpathSync(name) !== actual) throw new Error('artifact_changed');
        const digest = hash.digest('hex');
        if (!keep) { if (fileDigests.size >= 64) fileDigests.clear(); fileDigests.set(actual, { fingerprint: stamp, digest }); }
        return Object.freeze({ text: keep ? Buffer.concat(chunks).toString('utf8') : '', sha256: digest });
    } finally { closeSync(fd); }
}
function json(name: string) { const raw = file(name, 2 * 1024 * 1024); return { ...raw, value: JSON.parse(raw.text) }; }
export type OrdinaryGovernanceSnapshot = Readonly<{ settings: OrdinaryCloudSettings; configuration: OrdinaryRunnerConfiguration;
    identity: RedactionRuntimeIdentity; evidenceDigest: string; expiresAt: number }>;

/** Installation is an operator-owned local artifact, never an HTTP parameter.
 * File contents locate already installed assets; pins and worker observation
 * determine identity. This function neither installs nor promotes a model. */
export function readOrdinaryRedactionInstallation(): Readonly<{ configuration: OrdinaryRunnerConfiguration; identity: RedactionRuntimeIdentity; descriptorSha256: string }> {
    const readiness = getAiRolloutReadinessArtifactPaths('redaction');
    const descriptor = json(path.join(readiness.directory, 'runtime.json'));
    const c = descriptor.value;
    if (!c || Object.keys(c).length !== 4 || c.schema !== 'mediflow.redaction-installation.v1'
        || ['pythonExecutable', 'workerPath', 'modelDirectory'].some(k => typeof c[k] !== 'string' || !path.isAbsolute(c[k]) || c[k].includes('\0'))) throw new Error('redaction_installation_missing');
    // Keep the venv invocation path: resolving its symlink would discard its installed packages.
    // file() hashes the physical interpreter; the worker independently observes package versions.
    const configuration = Object.freeze({ pythonExecutable: c.pythonExecutable, workerPath: realpathSync(c.workerPath), modelDirectory: realpathSync(c.modelDirectory) });
    if (file(configuration.workerPath, 1048576).sha256 !== REDACTION_WORKER_SHA256) throw new Error('redaction_worker_mismatch');
    const pythonSha256 = file(configuration.pythonExecutable, 256 * 1024 * 1024, false).sha256;
    for (const [name, expected] of Object.entries(REDACTION_RUNTIME_FILES)) {
        const target = path.join(configuration.modelDirectory, name), resolved = realpathSync(target);
        if (!resolved.startsWith(configuration.modelDirectory + path.sep) || file(target, 4 * 1024 * 1024 * 1024, false).sha256 !== expected) throw new Error('redaction_model_mismatch');
    }
    return Object.freeze({ configuration, descriptorSha256: descriptor.sha256, identity: Object.freeze({
        schema: REDACTION_RUNTIME_SCHEMA, adapter: REDACTION_RUNTIME_ADAPTER, model: REDACTION_RUNTIME_MODEL,
        revision: REDACTION_RUNTIME_REVISION, workerSha256: REDACTION_WORKER_SHA256, pythonSha256,
        packages: REDACTION_RUNTIME_PACKAGES, files: REDACTION_RUNTIME_FILES,
    }) });
}
/** Positive preflight is technical evidence, never authority to send a payload. */
export async function readOrdinaryGovernance(functionId: FunctionModelId, prepared?: PreparedOrdinaryRead): Promise<OrdinaryGovernanceSnapshot> {
    if (!Object.hasOwn(FUNCTION_SWITCH_KEYS, functionId)) throw new Error('ordinary_function_invalid');
    const settings = await readOrdinaryCloudSettings();
    if (!settings.enabled || settings.retention !== 'chatgpt_service_terms_apply' || !isAiLaneEnabledValue(settings.lanes[functionId])) throw new Error('ordinary_egress_disabled');
    const installed = readOrdinaryRedactionInstallation();
    if (prepared && (!prepared.redactionIdentity || redactionIdentityDigest(prepared.redactionIdentity) !== redactionIdentityDigest(installed.identity))) throw new Error('redaction_observation_mismatch');
    const paths = getAiRolloutReadinessArtifactPaths('redaction');
    const rollout = json(paths.jsonPath);
    const reportPath = rollout.value?.reportPath;
    if (typeof reportPath !== 'string' || !path.isAbsolute(reportPath)) throw new Error('readiness_report_missing');
    const validation = json(reportPath), corpusPath = validation.value?.corpusPath;
    if (typeof corpusPath !== 'string' || !path.isAbsolute(corpusPath)) throw new Error('readiness_corpus_missing');
    const corpus = json(corpusPath);
    const evaluated = evaluateRedactionRuntimeEvidence({ validation: validation.value, validationSha256: validation.sha256,
        corpus: corpus.value, corpusSha256: corpus.sha256, rollout: rollout.value,
        observed: prepared?.redactionIdentity ?? installed.identity, now: Date.now() });
    if (evaluated.status !== 'valid' || !evaluated.expiresAt) throw new Error('redaction_evidence_denied');
    // Detect replacement during the synchronous evidence read. A later check is
    // performed at the content boundary again; no grant is cached in a DTO.
    if (json(paths.jsonPath).sha256 !== rollout.sha256 || json(reportPath).sha256 !== validation.sha256) throw new Error('readiness_changed');
    const current = await readOrdinaryCloudSettings();
    if (settings.revision !== current.revision || !current.enabled || current.lanes[functionId] !== settings.lanes[functionId]) throw new Error('ordinary_settings_changed');
    if (json(paths.jsonPath).sha256 !== rollout.sha256 || json(reportPath).sha256 !== validation.sha256
        || json(corpusPath).sha256 !== corpus.sha256 || readOrdinaryRedactionInstallation().descriptorSha256 !== installed.descriptorSha256
        || redactionIdentityDigest(readOrdinaryRedactionInstallation().identity) !== redactionIdentityDigest(installed.identity)
        || Date.now() >= evaluated.expiresAt) throw new Error('readiness_changed');
    return Object.freeze({ settings: current, configuration: installed.configuration, identity: installed.identity,
        evidenceDigest: evidenceHash(JSON.stringify([rollout.sha256, validation.sha256, corpus.sha256, installed.descriptorSha256])), expiresAt: evaluated.expiresAt });
}
