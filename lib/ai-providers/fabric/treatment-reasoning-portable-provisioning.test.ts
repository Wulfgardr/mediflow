/* @Codex: synthetic-only; no network, installer, model download or clinical DB. */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ATHENA_R1_QWEN3_8B_MODEL_ID } from '../../athena-model-identity.ts';
import { createPortableProvisioning, parsePortableRelease, PortableProvisioningError, isVerifiedPortableArtifact } from './treatment-reasoning-portable-provisioning.ts';
const code = (expected: string) => (error: unknown) => error instanceof PortableProvisioningError && error.code === expected;

// All payloads and version/revision strings below are SYNTHETIC. They are not
// model weights, runtime distributions, licenses or evidence of real inference.
function fixture(t: TestContext) {
    const base = process.env.MEDIFLOW_DATA_DIR;
    assert.ok(base, 'Set an explicit run-owned synthetic MEDIFLOW_DATA_DIR');
    fs.mkdirSync(base, { recursive: true });
    const dataDir = fs.mkdtempSync(path.join(base, 'portable unit-'));
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
    const root = path.join(dataDir, 'treatment-reasoning-portable');
    const incoming = path.join(root, 'incoming');
    const payloads: Record<string, string | Buffer> = {
        'model/config.json': JSON.stringify({ model_type: 'qwen3' }),
        'model/tokenizer.json': '{}', 'model/tokenizer_config.json': '{}',
        'model/model.safetensors': 'SYNTHETIC-NOT-WEIGHTS', 'model/LICENSE': 'SYNTHETIC LICENSE FIXTURE ONLY',
        'runtime/python': 'SYNTHETIC-NOT-EXECUTABLE', 'runtime/LICENSE': 'SYNTHETIC LICENSE FIXTURE ONLY',
        'worker/treatment-reasoning-portable-worker.py': fs.readFileSync(new URL('../../../scripts/treatment-reasoning-portable-worker.py', import.meta.url)),
    };
    const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
    const manifest = { schemaVersion: 'mediflow.treatment-portable-release.v1', provider: 'athena_transformers', model: ATHENA_R1_QWEN3_8B_MODEL_ID,
        modelRevision: 'a'.repeat(40), format: 'safetensors', platform: 'linux-x64', sourceRef: 'synthetic:source-only', approvalRef: 'synthetic:not-approved-for-use',
        runtime: { python: 'runtime/python', pythonVersion: '0.0.0', transformersVersion: '0.0.0', torchVersion: '0.0.0', sourceRef: 'synthetic:runtime-not-real' },
        licenses: { model: 'model/LICENSE', runtime: ['runtime/LICENSE'] }, limits: { memoryBytes: 8 * 1024 ** 3, threads: 1 },
        files: Object.entries(payloads).map(([name, bytes]) => ({ path: name, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) })),
    };
    for (const [name, bytes] of Object.entries(payloads)) { const f = path.join(incoming, 'artifacts', name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes); }
    const rewrite = () => { const bytes = JSON.stringify(manifest); fs.writeFileSync(path.join(incoming, 'release.json'), bytes); return sha(bytes); };
    const digest = rewrite();
    const service = createPortableProvisioning({ dataDir, platform: 'linux', arch: 'x64',
        hardware: () => ({ platform: 'linux', nodeArchitecture: 'x64', machineArchitecture: 'x86_64',
            totalMemoryBytes: 64 * 1024 ** 3, availableMemoryBytes: 60 * 1024 ** 3, logicalCpus: 8 }) });
    const admit = async () => { await service.importOffline({ consentDigest: digest }); await service.activate({ consentDigest: digest }); };
    return { dataDir, root, incoming, manifest, digest, rewrite, service, admit };
}

test('missing artifacts produce NEEDS_CONTEXT without creating a directory', t => {
    const f = fixture(t); fs.rmSync(f.root, { recursive: true });
    assert.equal(f.service.status().state, 'NEEDS_CONTEXT'); assert.equal(fs.existsSync(f.root), false);
});
test('only Windows/Linux supported architecture combinations are admitted as candidates', t => {
    const f = fixture(t);
    for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'ia32'], ['win32', 'ia32'], ['freebsd', 'x64']]) {
        assert.equal(createPortableProvisioning({ dataDir: f.dataDir, platform, arch }).status().state, 'platform_unsupported');
    }
    assert.equal(createPortableProvisioning({ dataDir: f.dataDir, platform: 'win32', arch: 'x64' }).status().state, 'platform_unsupported'); // exact manifest platform mismatch
});
test('offline import requires digest-bound consent and does not select or activate', async t => {
    const f = fixture(t); assert.equal(f.service.status().state, 'model_not_provisioned');
    await assert.rejects(f.service.importOffline({}), code('consent_required'));
    await assert.rejects(f.service.importOffline({ consentDigest: '0'.repeat(64) }), code('consent_required'));
    const imported = await f.service.importOffline({ consentDigest: f.digest });
    assert.equal(imported.state, 'needs_activation'); assert.equal(imported.selected, false);
    assert.equal(fs.existsSync(path.join(f.root, 'selected.json')), false);
    await assert.rejects(f.service.verifySelected(), code('needs_activation'));
    assert.equal(imported.writesPerformed, 0); assert.equal(imported.applyPolicy, 'none');
    await assert.rejects(f.service.activate({}), code('consent_required'));
    await f.service.activate({ consentDigest: f.digest });
    const artifact = await f.service.verifySelected(); assert.ok(isVerifiedPortableArtifact(artifact));
    assert.equal(artifact.artifactDigest, f.digest); assert.equal(artifact.release.model, ATHENA_R1_QWEN3_8B_MODEL_ID);
    assert.equal(f.service.status().revision, 2); assert.equal(f.service.status().state, 'admitted');
    assert.equal(isVerifiedPortableArtifact({ ...artifact }), false);
});
test('revocation persists and is terminal for the same release', async t => {
    const f = fixture(t); await f.admit(); const revoked = f.service.revoke({ consentDigest: f.digest });
    assert.equal(revoked.state, 'revoked'); assert.equal(revoked.revision, 3);
    await assert.rejects(f.service.verifySelected(), code('revoked'));
    await assert.rejects(f.service.activate({ consentDigest: f.digest }), code('revoked'));
    await assert.rejects(f.service.importOffline({ consentDigest: f.digest }), code('revoked'));
});
test('tamper and undeclared artifact files cannot pass staging; old admitted version survives', async t => {
    const f = fixture(t); await f.admit();
    f.manifest.modelRevision = 'b'.repeat(40); const newDigest = f.rewrite();
    fs.writeFileSync(path.join(f.incoming, 'artifacts/model/model.safetensors'), 'TAMPERED');
    await assert.rejects(f.service.importOffline({ consentDigest: newDigest }), code('artifact_tampered'));
    assert.equal(f.service.status().releaseDigest, f.digest); assert.equal(f.service.status().state, 'admitted');
    assert.equal(fs.existsSync(path.join(f.root, '.stage')), false);
    await f.service.verifySelected();
    fs.writeFileSync(path.join(f.root, 'objects', f.digest, 'artifacts/model/undeclared.txt'), 'NO');
    await assert.rejects(f.service.verifySelected(), code('artifact_tampered'));
});
test('worker digest is bound to the delivered source, not just caller manifest', async t => {
    const f = fixture(t); const entry = f.manifest.files.find(x => x.path.startsWith('worker/'))!;
    const payload = 'UNAPPROVED WORKER'; fs.writeFileSync(path.join(f.incoming, 'artifacts', entry.path), payload);
    entry.bytes = Buffer.byteLength(payload); entry.sha256 = createHash('sha256').update(payload).digest('hex');
    await assert.rejects(f.service.importOffline({ consentDigest: f.rewrite() }), code('artifact_tampered'));
});
test('license, checksum, identity, format and path metadata fail closed', t => {
    const f = fixture(t); const check = (edit: (m: typeof f.manifest) => void, expected = 'manifest_invalid') => {
        const m = structuredClone(f.manifest); edit(m); assert.throws(() => parsePortableRelease(Buffer.from(JSON.stringify(m))), code(expected));
    };
    check(m => { m.licenses.model = 'model/MISSING'; }, 'license_missing');
    check(m => { m.licenses.runtime = []; }, 'license_missing');
    check(m => { m.files[0].sha256 = 'not-a-hash'; });
    check(m => { m.provider = 'athena_mlx'; }); check(m => { m.format = 'gguf'; });
    check(m => { m.runtime.python = 'http://127.0.0.1/python'; });
    check(m => { m.files[0].path = 'model/../runtime/python'; });
    check(m => { m.files[0].path = 'model/CON.txt'; });
    check(m => { m.files.push({ ...m.files[0], path: m.files[0].path.toUpperCase() }); });
    check(m => { m.limits.threads = 5; }); check(m => { m.limits.memoryBytes = 1024; });
});
test('cancellation before and during import leaves no selectable partial object', async t => {
    const f = fixture(t); const controller = new AbortController(); controller.abort();
    await assert.rejects(f.service.importOffline({ consentDigest: f.digest, signal: controller.signal }), code('cancelled'));
    const next = new AbortController(); const task = f.service.importOffline({ consentDigest: f.digest, signal: next.signal }); next.abort();
    await assert.rejects(task, code('cancelled'));
    assert.equal(fs.existsSync(path.join(f.root, '.stage')), false); assert.equal(fs.existsSync(path.join(f.root, 'selected.json')), false);
    assert.equal(fs.existsSync(path.join(f.root, 'operation.lock')), false);
});
test('interrupted staging is not auto-promoted or erased without explicit recovery', async t => {
    const f = fixture(t); fs.mkdirSync(path.join(f.root, '.stage'));
    fs.writeFileSync(path.join(f.root, '.stage/partial'), 'SYNTHETIC PARTIAL');
    await assert.rejects(f.service.importOffline({ consentDigest: f.digest }), code('interrupted'));
    assert.equal(fs.existsSync(path.join(f.root, '.stage/partial')), true);
    assert.throws(() => f.service.recover({ confirmed: false }), code('consent_required'));
    f.service.recover({ confirmed: true }); assert.equal(fs.existsSync(path.join(f.root, '.stage')), false);
    await f.service.importOffline({ consentDigest: f.digest }); assert.equal(f.service.status().state, 'needs_activation');
});
test('live lock is not removed by recovery or concurrent import', async t => {
    const f = fixture(t); fs.writeFileSync(path.join(f.root, 'operation.lock'), JSON.stringify({ pid: process.pid }));
    await assert.rejects(f.service.importOffline({ consentDigest: f.digest }), code('busy'));
    assert.throws(() => f.service.recover({ confirmed: true }), code('busy'));
    assert.equal(fs.existsSync(path.join(f.root, 'operation.lock')), true);
});
test('symlink/hardlink weights are rejected before copying', async t => {
    const f = fixture(t); const weight = path.join(f.incoming, 'artifacts/model/model.safetensors');
    fs.linkSync(weight, path.join(f.incoming, 'linked-weight'));
    await assert.rejects(f.service.importOffline({ consentDigest: f.digest }), code('artifact_tampered'));
});

import { assessPortableHardware, portableMachineArchitecture, PORTABLE_MODEL_EVIDENCE,
    PORTABLE_PUBLISHED_WEIGHT_BYTES, verifyPortablePublishedMetadata } from './treatment-reasoning-portable-provisioning.ts';
test('published BF16 policy distinguishes parent-observed native ARM64 VMs from emulated Node; both RAM gates fail', () => {
    const gib = 1024 ** 3;
    for (const [platform, nodeArchitecture, machineArchitecture, ram] of [
        ['linux', 'arm64', 'aarch64', 12], ['win32', 'x64', 'ARM64', 18],
    ] as const) {
        const report = assessPortableHardware({ platform, nodeArchitecture, machineArchitecture, totalMemoryBytes: ram * gib,
            availableMemoryBytes: ram * gib, logicalCpus: 8 });
        assert.equal(report.targetPlatform, `${platform}-arm64`); assert.equal(report.nodeArchitecture, nodeArchitecture);
        assert.equal(report.weightBytes, 16_381_516_864); assert.equal(report.kvCacheBudgetBytes, 1_443_889_152);
        assert.equal(report.minimumProcessMemoryBytes, 36 * gib); assert.equal(report.minimumHostMemoryBytes, 40 * gib);
        assert.equal(report.threads, 4); assert.equal(report.qualification, 'not_observed');
        assert.deepEqual(report.blockers, ['physical_memory_below_bf16_policy']);
    }
    assert.equal(portableMachineArchitecture('AMD64'), 'x64'); assert.equal(portableMachineArchitecture('i386'), null);
    assert.equal(PORTABLE_PUBLISHED_WEIGHT_BYTES, 16_381_516_864);
});
test('hardware gate rejects runtime/native mismatch, undersized process budget, unavailable RAM and excessive threads', () => {
    const observed = { platform: 'win32', nodeArchitecture: 'x64', machineArchitecture: 'ARM64', totalMemoryBytes: 64 * 1024 ** 3,
        availableMemoryBytes: 1 * 1024 ** 3, logicalCpus: 2 };
    const report = assessPortableHardware(observed, { platform: 'win32-x64', files: PORTABLE_MODEL_EVIDENCE.files,
        limits: { memoryBytes: 8 * 1024 ** 3, threads: 4 } }, true);
    for (const code of ['native_platform_or_runtime_architecture_unverified', 'process_memory_budget_below_bf16_policy',
        'available_memory_below_process_budget', 'configured_threads_exceed_available_cpus']) assert.ok(report.blockers.includes(code));
    assert.ok(assessPortableHardware({ ...observed, logicalCpus: 0 }).blockers.includes('hardware_observation_invalid'));
});
test('metadata comparison pins immutable revision and the four published shards; never claims actual weights acquired', t => {
    const f = fixture(t);
    const release = parsePortableRelease(Buffer.from(JSON.stringify({ ...f.manifest, modelRevision: PORTABLE_MODEL_EVIDENCE.revision,
        files: [...f.manifest.files.filter(file => !PORTABLE_MODEL_EVIDENCE.files.some(expected => expected.path === file.path)
            && !file.path.endsWith('.safetensors')), ...PORTABLE_MODEL_EVIDENCE.files] })));
    assert.doesNotThrow(() => verifyPortablePublishedMetadata(release));
    assert.equal(PORTABLE_MODEL_EVIDENCE.acquired, false); assert.equal(PORTABLE_MODEL_EVIDENCE.runtimeQualified, false);
    assert.throws(() => verifyPortablePublishedMetadata({ ...release, modelRevision: 'b'.repeat(40) }), code('manifest_invalid'));
    assert.throws(() => verifyPortablePublishedMetadata({ ...release, files: release.files.filter(file => !file.path.includes('00004-of')) }), code('artifact_tampered'));
});
test('inventory needs explicit confirmation and complete official bytes; failure never overwrites a draft or selects artifacts', async t => {
    const f = fixture(t); const before = fs.readFileSync(path.join(f.incoming, 'release.json'));
    await assert.rejects(f.service.inventoryOffline({ confirmed: false }), code('consent_required'));
    await assert.rejects(f.service.inventoryOffline({ confirmed: true }), code('NEEDS_CONTEXT'));
    const input = Object.fromEntries(Object.entries(f.manifest).filter(([key]) => key !== 'files'));
    fs.writeFileSync(path.join(f.incoming, 'release-input.json'), JSON.stringify({ ...input, modelRevision: PORTABLE_MODEL_EVIDENCE.revision }));
    await assert.rejects(f.service.inventoryOffline({ confirmed: true }), code('artifact_tampered'));
    assert.deepEqual(fs.readFileSync(path.join(f.incoming, 'release.json')), before);
    assert.equal(fs.existsSync(path.join(f.root, 'selected.json')), false); assert.equal(fs.existsSync(path.join(f.root, 'operation.lock')), false);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.service.inventoryOffline({ confirmed: true, signal: controller.signal }), code('cancelled'));
});
test('physical-memory gate blocks activation of even synthetic fixtures; no admission is emitted', async t => {
    const f = fixture(t); await f.service.importOffline({ consentDigest: f.digest });
    const low = createPortableProvisioning({ dataDir: f.dataDir, platform: 'linux', arch: 'x64', hardware: () => ({
        platform: 'linux', nodeArchitecture: 'x64', machineArchitecture: 'x86_64', totalMemoryBytes: 2 * 1024 ** 3,
        availableMemoryBytes: 1 * 1024 ** 3, logicalCpus: 8 }) });
    assert.ok(low.status().prerequisites.includes('physical_memory_below_bf16_policy'));
    await assert.rejects(low.activate({ consentDigest: f.digest }), code('unavailable'));
    assert.equal(fs.existsSync(path.join(f.root, 'selected.json')), false);
});

/* @Codex: application-root regressions use only owned synthetic directories. */
function launcherFixture(t: TestContext) {
    const f = fixture(t);
    const applicationRoot = path.join(f.dataDir, 'launcher with spaces');
    const worker = path.join(applicationRoot, 'scripts/treatment-reasoning-portable-worker.py');
    fs.mkdirSync(path.dirname(worker), { recursive: true });
    fs.copyFileSync(path.join(f.incoming, 'artifacts/worker/treatment-reasoning-portable-worker.py'), worker);
    const options = { dataDir: f.dataDir, platform: 'linux', arch: 'x64', hardware: () => ({
        platform: 'linux', nodeArchitecture: 'x64', machineArchitecture: 'x86_64',
        totalMemoryBytes: 64 * 1024 ** 3, availableMemoryBytes: 60 * 1024 ** 3, logicalCpus: 8,
    }) };
    return { ...f, applicationRoot, worker, options };
}

test('host root is lazy for status but mandatory for consent-bound offline worker verification', async t => {
    const f = launcherFixture(t); fs.rmSync(f.applicationRoot, { recursive: true });
    const service = createPortableProvisioning({ ...f.options, applicationRoot: f.applicationRoot });
    assert.equal(service.status().state, 'model_not_provisioned');
    assert.equal(service.hardware().qualification, 'not_observed');
    assert.equal(fs.existsSync(f.applicationRoot), false);
    await assert.rejects(service.importOffline({}), code('consent_required'));
    await assert.rejects(service.importOffline({ consentDigest: f.digest }), code('model_not_provisioned'));
    assert.equal(fs.existsSync(f.applicationRoot), false);
    assert.equal(fs.existsSync(path.join(f.root, 'selected.json')), false);
    assert.equal(fs.existsSync(path.join(f.root, '.stage')), false);
});

test('explicit host root, not the library source, binds worker integrity at import and activation', async t => {
    const f = launcherFixture(t);
    const service = createPortableProvisioning({ ...f.options, applicationRoot: f.applicationRoot });
    fs.appendFileSync(f.worker, '\n# SYNTHETIC HOST TAMPER\n');
    await assert.rejects(service.importOffline({ consentDigest: f.digest }), code('artifact_tampered'));
    fs.copyFileSync(path.join(f.incoming, 'artifacts/worker/treatment-reasoning-portable-worker.py'), f.worker);
    assert.equal((await service.importOffline({ consentDigest: f.digest })).state, 'needs_activation');
    fs.appendFileSync(f.worker, '\n# SYNTHETIC POST-IMPORT TAMPER\n');
    await assert.rejects(service.activate({ consentDigest: f.digest }), code('artifact_tampered'));
    assert.equal(service.status().state, 'needs_activation');
    assert.equal(fs.existsSync(path.join(f.root, 'selected.json')), false);
});

test('default host cwd is captured once; later chdir cannot rebind the worker', async t => {
    const f = launcherFixture(t); const previous = process.cwd();
    try {
        process.chdir(f.applicationRoot);
        const service = createPortableProvisioning(f.options);
        process.chdir(previous);
        fs.appendFileSync(f.worker, '\n# SYNTHETIC CAPTURED-ROOT TAMPER\n');
        await assert.rejects(service.importOffline({ consentDigest: f.digest }), code('artifact_tampered'));
        fs.copyFileSync(path.join(f.incoming, 'artifacts/worker/treatment-reasoning-portable-worker.py'), f.worker);
        assert.equal((await service.importOffline({ consentDigest: f.digest })).state, 'needs_activation');
    } finally { process.chdir(previous); }
});

test('host-root aliases and traversal remain rejected at artifact verification, never canonicalized into authority', async t => {
    const f = launcherFixture(t);
    const alias = path.join(f.dataDir, 'launcher-alias');
    fs.symlinkSync(f.applicationRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    for (const [applicationRoot, expected] of [[alias, 'artifact_tampered'],
        [`${f.applicationRoot}${path.sep}..${path.sep}${path.basename(f.applicationRoot)}`, 'unavailable']]) {
        const service = createPortableProvisioning({ ...f.options, applicationRoot });
        assert.equal(service.status().state, 'model_not_provisioned');
        await assert.rejects(service.importOffline({ consentDigest: f.digest }), code(expected));
        assert.equal(fs.existsSync(path.join(f.root, 'selected.json')), false);
    }
});
