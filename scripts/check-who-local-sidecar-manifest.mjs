/* @Codex */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readReleaseTarget } from './who-local-platform.mjs';

const digest = value => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
const iso = value => {
    try { return typeof value === 'string' && new Date(value).toISOString() === value; }
    catch { return false; }
};
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Checks a recorded manifest, never the registry, license acceptance, Docker or the dataset itself. */
export function validateWhoLocalManifest(manifest, stage = 'activate') {
    const errors = [];
    if (!['provision', 'activate'].includes(stage)) return ['stage_invalid'];
    if (!exact(manifest, ['schemaVersion', 'image', 'dataset', 'license', 'listener', 'options', 'mounts', 'automaticStart', 'automaticUpdate'])
        || !['mediflow.who-local-sidecar.manifest.v1', 'mediflow.who-local-sidecar.manifest.v2'].includes(manifest.schemaVersion)) return ['manifest_invalid'];
    const { image, dataset, license, listener, options } = manifest;
    const proposed = manifest.schemaVersion === 'mediflow.who-local-sidecar.manifest.v2';
    if (!exact(image, ['repository', 'version', 'platform', 'digest', 'registry', 'registryVerifiedAt', 'registryEvidenceSha256'])
        || image.repository !== 'whoicd/icd-api' || image.version !== '2.6.0'
        || !(proposed ? ['linux/arm64', 'linux/amd64'].includes(image.platform) : image.platform === 'linux/arm64') || image.registry !== 'registry-1.docker.io') errors.push('image_binding_invalid');
    if (!digest(image?.digest) || !iso(image?.registryVerifiedAt) || !digest(image?.registryEvidenceSha256)) errors.push('primary_registry_lock_required');
    // V1's recorded-manifest contract is unchanged. V2 additionally requires supplied byte evidence.
    if (proposed) {
        try {
            const target = readReleaseTarget(image?.platform);
            if (target.evidenceState !== 'verified_metadata') errors.push('image_evidence_missing');
            else if (image.digest !== target.imageDigest || image.registryEvidenceSha256 !== target.registryEvidenceSha256
                || image.registryVerifiedAt !== target.registryVerifiedAt) errors.push('image_evidence_binding_invalid');
        } catch { errors.push('image_evidence_binding_invalid'); }
    }
    if (!exact(license, ['url', 'acceptedAt', 'acceptanceRecordRef'])
        || license.url !== 'https://icd.who.int/en/docs/icd11-license.pdf') errors.push('license_binding_invalid');
    if (!iso(license?.acceptedAt) || typeof license?.acceptanceRecordRef !== 'string'
        || !/^[a-zA-Z0-9_.-]{8,128}$/u.test(license.acceptanceRecordRef)) errors.push('operator_license_acceptance_required');
    if (!exact(listener, ['host', 'hostPort', 'containerPort']) || listener.host !== '127.0.0.1'
        || listener.hostPort !== 8382 || listener.containerPort !== 80) errors.push('listener_binding_invalid');
    if (!exact(options, ['saveAnalytics', 'enableDoris', 'fhirSupport'])
        || Object.values(options).some(value => value !== false)) errors.push('optional_egress_or_capability_forbidden');
    if (!Array.isArray(manifest.mounts) || manifest.mounts.length !== 0
        || manifest.automaticStart !== false || manifest.automaticUpdate !== false) errors.push('lifecycle_or_mounts_invalid');
    if (!exact(dataset, ['include', 'snapshotId', 'snapshotInventorySha256', 'offlineRestartVerified', 'restoreVerified'])
        || dataset.include !== '2026-01_en' || typeof dataset.offlineRestartVerified !== 'boolean'
        || typeof dataset.restoreVerified !== 'boolean') errors.push('dataset_binding_invalid');
    if (stage === 'activate' && (!digest(dataset?.snapshotId) || !digest(dataset?.snapshotInventorySha256)
        || dataset?.offlineRestartVerified !== true || dataset?.restoreVerified !== true)) errors.push('dataset_inventory_and_offline_proof_required');
    return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const stageIndex = args.indexOf('--stage');
    const stage = stageIndex < 0 ? 'activate' : args[stageIndex + 1];
    const manifestIndex = args.indexOf('--manifest');
    const manifestPath = manifestIndex < 0 ? new URL('../docs/who-local-sidecar.manifest.json', import.meta.url) : args[manifestIndex + 1];
    let errors;
    try {
        const seen = new Set();
        for (let i = 0; i < args.length; i += 2) {
            if (!['--stage', '--manifest'].includes(args[i]) || seen.has(args[i])
                || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('arguments');
            seen.add(args[i]);
        }
        errors = validateWhoLocalManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), stage);
    } catch { errors = ['manifest_unreadable_or_arguments_invalid']; }
    console.log(JSON.stringify({ stage, recordedPrerequisitesComplete: errors.length === 0, errors,
        execution: 'none', claim: 'recorded manifest only; no registry, license, dataset or live verification' }));
    process.exitCode = errors.length ? 1 : 0;
}
