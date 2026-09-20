/* @Codex: synthetic host/engine/ACL fixtures; no Docker, registry, PowerShell or WHO runtime. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appLaunchSpec, assertLocalStatePath, assertSameEngine, defaultWhoDirectory, dockerEnvironment,
    dockerPrerequisite, engineArchitecture, inspectLocalEngine, localDockerEndpoint, ownedLauncher,
    readReleaseTarget, requireReleaseEvidence, validWindowsAcl, windowsAcl, WINDOWS_ACL_SCRIPT, WHO_IMAGE_DESCRIPTORS } from './who-local-platform.mjs';
import { validateWhoLocalManifest } from './check-who-local-sidecar-manifest.mjs';
import { prepareManifest } from './who-local-onboarding.mjs';
import { createOwnedContainerArgs } from './who-local-qualification.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = relative => readFileSync(path.join(root, relative));
function engine(host, arch, overrides = {}) {
    const calls = [];
    const endpoint = overrides.endpoint ?? (host.platform === 'win32' ? 'npipe:////./pipe/dockerDesktopLinuxEngine' : 'unix:///synthetic/docker.sock');
    const run = args => {
        calls.push(args);
        if (args[0] === 'context') return endpoint;
        assert.deepEqual(args.slice(0, 3), ['--context', 'synthetic', 'info']);
        return JSON.stringify({ os: 'linux', arch, id: 'synthetic-engine-id-0001', ...overrides.info });
    };
    return { run, calls };
}
for (const platform of ['win32', 'linux', 'darwin']) for (const arch of ['x64', 'arm64']) for (const targetArch of ['amd64', 'arm64']) {
    test(`host ${platform}/${arch} selects Linux ${targetArch} independently of host CPU`, () => {
        const host = { platform, arch }, fixture = engine(host, targetArch);
        const binding = inspectLocalEngine('synthetic', fixture.run, host);
        assert.equal(binding.hostPlatform, platform); assert.equal(binding.hostArch, arch);
        assert.equal(binding.platform, `linux/${targetArch}`);
        const target = readReleaseTarget(binding.platform);
        assert.equal(target.imageDigest, WHO_IMAGE_DESCRIPTORS[binding.platform]);
        assert.equal(requireReleaseEvidence(target).evidenceState, 'verified_metadata');
        assert.deepEqual(target.missing, []);
        // Pure argument construction is not permission to pull: onboarding checks evidence first.
        const args = createOwnedContainerArgs({ schemaVersion: 'mediflow.who-installation.v2',
            installationId: '12345678-1234-1234-1234-123456789abc', engineBinding: binding, platform: binding.platform,
            image: `whoicd/icd-api@${target.imageDigest}` }, 'mediflow-who-local-synthetic', 'bridge', true);
        assert.equal(args[args.indexOf('--platform') + 1], binding.platform);
        assert.equal(args.at(-1), `whoicd/icd-api@${target.imageDigest}`);
        assert.ok(args.includes('SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt'));
        // F-WHO4 / proposed D10: only Mac is served by the owned Node listener.
        if (platform === 'darwin') assert.equal(args.includes('--publish'), false);
        else assert.ok(args.includes('127.0.0.1:8382:80'));
    });
}
test('engine aliases normalize only known Linux architectures and reject Windows engine or missing identity', () => {
    for (const [raw, normalized] of [['aarch64', 'arm64'], ['arm64', 'arm64'], ['x86_64', 'amd64'], ['amd64', 'amd64']]) assert.equal(engineArchitecture(raw), normalized);
    for (const raw of [null, undefined, 'x64', 'ARM64', 'armv7', 'unknown']) assert.throws(() => engineArchitecture(raw), { code: 'platform_mismatch' });
    for (const info of [{ os: 'windows' }, { id: '' }, { id: undefined }]) {
        const host = { platform: 'win32', arch: 'x64' }, fixture = engine(host, 'amd64', { info });
        assert.throws(() => inspectLocalEngine('synthetic', fixture.run, host));
    }
});
test('remote/malformed contexts are denied before an engine request; only exact local pipes are admitted', () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
        for (const endpoint of ['tcp://127.0.0.1:2375', 'ssh://synthetic', 'https://remote.invalid',
            'npipe:////synthetic/pipe/docker_engine', 'npipe:////localhost/pipe/docker_engine',
            'npipe:////./pipe/arbitrary', 'npipe:////./pipe/docker_engine?x', 'unix://remote/socket',
            'unix:////synthetic/socket', 'unix:///synthetic/../docker.sock', 'unix:///synthetic/%2e/socket',
            'unix:///synthetic/socket\n', 'unix:///synthetic/socket#x']) {
            const host = { platform, arch: 'arm64' }, fixture = engine(host, 'arm64', { endpoint });
            assert.throws(() => inspectLocalEngine('synthetic', fixture.run, host), { code: 'local_context_required' });
            assert.equal(fixture.calls.length, 1);
        }
    }
    assert.equal(localDockerEndpoint('npipe:////./pipe/docker_engine', 'win32'), true);
    assert.equal(localDockerEndpoint('npipe:////./pipe/dockerDesktopLinuxEngine', 'win32'), true);
    assert.equal(localDockerEndpoint('npipe:////./pipe/docker_engine', 'linux'), false);
    assert.equal(localDockerEndpoint('unix:///synthetic/docker.sock', 'win32'), false);
    assert.equal(localDockerEndpoint('unix:///Synthetic Operator/docker.sock', 'darwin'), true);
});
test('missing Docker is bounded and OS prerequisites never install or accept runtime terms', () => {
    for (const platform of ['win32', 'linux', 'darwin']) {
        assert.match(dockerPrerequisite(platform), /Node.js 24/u);
        assert.match(dockerPrerequisite(platform), /non installa Docker o VM/u);
        assert.match(dockerPrerequisite(platform), /termini/u);
    }
    const environment = dockerEnvironment({ DOCKER_HOST: 'synthetic', Docker_Host: 'synthetic-lowercase', docker_context: 'synthetic-lowercase', DOCKER_CONTEXT: 'synthetic', DOCKER_TLS_VERIFY: '1', DOCKER_CERT_PATH: 'synthetic', MEDIFLOW_DATA_DIR: 'synthetic', PATH: 'synthetic' });
    assert.deepEqual(environment, { MEDIFLOW_DATA_DIR: 'synthetic', PATH: 'synthetic' });
});
test('daemon, endpoint, platform and host changes invalidate the exact engine binding', () => {
    const host = { platform: 'linux', arch: 'arm64' };
    const original = inspectLocalEngine('synthetic', engine(host, 'arm64').run, host);
    assert.doesNotThrow(() => assertSameEngine(original, { ...original }));
    for (const patch of [{ daemonIdSha256: `sha256:${'f'.repeat(64)}` }, { endpointSha256: `sha256:${'e'.repeat(64)}` }, { platform: 'linux/amd64' }, { hostPlatform: 'win32' }, { hostArch: 'x64' }, { extra: true }]) {
        assert.throws(() => assertSameEngine(original, { ...original, ...patch }), { code: 'engine_identity_changed' });
    }
});
const evidencePaths = {
    'linux/arm64': ['docs/who-lock-evidence/2.6.0-arm64.json', 'docs/who-lock-evidence/2.6.0-readback.json'],
    'linux/amd64': ['docs/who-lock-evidence/2.6.0-amd64.json', 'docs/who-lock-evidence/2.6.0-amd64-readback.json'],
};
const lockPath = 'docs/who-local-release-lock.json';
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
for (const platform of Object.keys(evidencePaths)) {
    test(`${platform}: canonical public metadata proves neither acquisition, license nor qualification`, () => {
        const target = requireReleaseEvidence(readReleaseTarget(platform));
        const [childPath, readbackPath] = evidencePaths[platform];
        const readback = JSON.parse(read(readbackPath));
        assert.equal(target.evidenceState, 'verified_metadata'); assert.deepEqual(target.missing, []);
        assert.equal(hash(read(childPath)), target.imageDigest);
        assert.equal(hash(read(readbackPath)), target.registryEvidenceSha256);
        assert.equal(new Date(readback.observedAt).toISOString(), target.registryVerifiedAt);
        assert.equal(readback.imageAcquired, false);
        for (const key of ['snapshotId', 'acceptedAt', 'offlineRestartVerified', 'restoreVerified', 'available', 'imageAcquired']) {
            assert.equal(target[key], undefined);
        }
        const manifest = prepareManifest(target, 'synthetic-fixture-only', '2026-09-08T10:00:00.000Z');
        assert.deepEqual(validateWhoLocalManifest(manifest, 'activate'), ['dataset_inventory_and_offline_proof_required']);
        manifest.license.acceptedAt = null; manifest.license.acceptanceRecordRef = null;
        assert.ok(validateWhoLocalManifest(manifest, 'provision').includes('operator_license_acceptance_required'));
    });
    test(`${platform}: explicit missing evidence fixtures keep exact paths and fail closed`, () => {
        for (const absent of evidencePaths[platform]) {
            const target = readReleaseTarget(platform, relative => {
                if (relative === absent) throw Object.assign(new Error('synthetic missing'), { code: 'ENOENT' });
                return read(relative);
            });
            assert.equal(target.evidenceState, 'missing_evidence'); assert.deepEqual(target.missing, [absent]);
            assert.throws(() => requireReleaseEvidence(target), { code: 'image_evidence_missing' });
            assert.throws(() => prepareManifest(target, 'synthetic-fixture-only', null), { code: 'image_evidence_missing' });
        }
        // A descriptor alone is still insufficient; never delete canonical evidence for a test.
        for (const absentField of ['registryEvidenceSha256', 'registryVerifiedAt']) {
            const target = readReleaseTarget(platform, relative => {
                if (relative !== lockPath) return read(relative);
                const fixture = JSON.parse(read(relative)); fixture.targets[platform][absentField] = null;
                return Buffer.from(JSON.stringify(fixture));
            });
            assert.deepEqual(target.missing, [`${lockPath}#targets/${platform}`]);
            assert.throws(() => requireReleaseEvidence(target), { code: 'image_evidence_missing' });
        }
    });
    test(`${platform}: wrong/absent digest, modified bytes and cross-target child never verify`, () => {
        for (const value of [null, 'latest', `sha256:${'a'.repeat(64)}`]) {
            const loader = relative => {
                if (relative !== lockPath) return read(relative);
                const fixture = JSON.parse(read(relative)); fixture.targets[platform].imageDigest = value;
                return Buffer.from(JSON.stringify(fixture));
            };
            assert.throws(() => readReleaseTarget(platform, loader), { code: 'release_lock_invalid' });
        }
        for (const badPath of ['docs/who-lock-evidence/2.6.0-index.json', ...evidencePaths[platform]]) {
            assert.throws(() => readReleaseTarget(platform, relative => relative === badPath ? Buffer.concat([read(relative), Buffer.from(' ')]) : read(relative)), { code: 'release_lock_invalid' });
        }
        const other = platform === 'linux/amd64' ? 'linux/arm64' : 'linux/amd64';
        assert.throws(() => readReleaseTarget(platform, relative => relative === evidencePaths[platform][0] ? read(evidencePaths[other][0]) : read(relative)), { code: 'release_lock_invalid' });
    });
    test(`${platform}: recomputing a readback hash cannot hide a wrong repository/tag/platform/digest/time/layer total`, () => {
        const readbackPath = evidencePaths[platform][1];
        for (const patch of [{ repository: 'synthetic/other' }, { tag: 'latest' }, { platform: 'linux/unknown' },
            { imageDigest: `sha256:${'a'.repeat(64)}` }, { indexDigest: `sha256:${'b'.repeat(64)}` },
            { observedAt: '2026-09-01T00:00:00.000Z' }, { observedAt: 'invalid' }, { compressedLayerBytes: 1 }]) {
            const bytes = Buffer.from(JSON.stringify({ ...JSON.parse(read(readbackPath)), ...patch }));
            const loader = relative => {
                if (relative === readbackPath) return bytes;
                if (relative !== lockPath) return read(relative);
                const fixture = JSON.parse(read(relative)); fixture.targets[platform].registryEvidenceSha256 = hash(bytes);
                return Buffer.from(JSON.stringify(fixture));
            };
            assert.throws(() => readReleaseTarget(platform, loader), { code: 'release_lock_invalid' });
        }
    });
}
test('v2 strengthens evidence linkage; no weakening of v1 ARM64 and activation requirements', () => {
    for (const platform of Object.keys(evidencePaths)) {
        const manifest = prepareManifest(readReleaseTarget(platform), 'synthetic-fixture-only', '2026-09-08T10:00:00.000Z');
        assert.deepEqual(validateWhoLocalManifest(manifest, 'provision'), []);
        assert.deepEqual(validateWhoLocalManifest(manifest, 'activate'), ['dataset_inventory_and_offline_proof_required']);
        for (const change of [m => { m.image.digest = `sha256:${'a'.repeat(64)}`; }, m => { m.image.registryEvidenceSha256 = null; },
            m => { m.listener.host = '0.0.0.0'; }, m => { m.options.fhirSupport = true; }, m => { m.license.acceptedAt = null; },
            m => { m.dataset.include = '2025-01_en'; }, m => { m.mounts.push('synthetic'); }, m => { m.automaticUpdate = true; }]) {
            const m = structuredClone(manifest); change(m); assert.ok(validateWhoLocalManifest(m, 'provision').length);
        }
    }
    // Correct digest, wrong architecture's readback binding: metadata cannot be interchanged.
    const amd = prepareManifest(readReleaseTarget(), 'synthetic-fixture-only', '2026-09-08T10:00:00.000Z');
    amd.image.platform = 'linux/amd64'; amd.image.digest = WHO_IMAGE_DESCRIPTORS['linux/amd64'];
    assert.ok(validateWhoLocalManifest(amd, 'provision').includes('image_evidence_binding_invalid'));
    amd.schemaVersion = 'mediflow.who-local-sidecar.manifest.v1';
    assert.ok(validateWhoLocalManifest(amd, 'provision').includes('image_binding_invalid'));
});
test('Windows state paths allow spaces and non-executable data, reject UNC/device/ADS/traversal/reserved names', () => {
    for (const value of ['C:\\Users\\Synthetic Operator\\WHO', "D:\\Synthetic O'Brien\\WHO", 'C:\\Utente\\Dati WHO']) assert.equal(assertLocalStatePath(value, 'win32'), value);
    for (const value of ['relative', 'C:relative', '\\\\server\\share\\WHO', '\\\\?\\C:\\WHO', 'C:\\WHO:stream',
        'C:\\WHO\\..\\state', 'C:\\WHO\\.\\state', 'C:\\WHO\\NUL.json', 'C:\\WHO\\COM1', 'C:\\WHO\\state.',
        'C:\\WHO\\state ', 'C:\\WHO\nstate', 'C:/WHO/state', 'C:\\WHO\\x?']) assert.throws(() => assertLocalStatePath(value, 'win32'), { code: 'private_state_invalid' });
    assert.equal(defaultWhoDirectory({ platform: 'win32', arch: 'x64' }, { LOCALAPPDATA: 'C:\\Users\\Synthetic Operator\\AppData\\Local' }), 'C:\\Users\\Synthetic Operator\\AppData\\Local\\MediFlow\\WHO\\2026-01_en');
    assert.equal(defaultWhoDirectory({ platform: 'linux', arch: 'arm64' }, { XDG_DATA_HOME: '/synthetic data' }, '/synthetic home'), '/synthetic data/MediFlow/WHO/2026-01_en');
    assert.equal(defaultWhoDirectory({ platform: 'darwin', arch: 'x64' }, {}, '/synthetic home'), '/synthetic home/Library/Application Support/MediFlow/WHO/2026-01_en');
    assert.throws(() => defaultWhoDirectory({ platform: 'win32', arch: 'x64' }, {}), { code: 'private_permissions_required' });
});
const acl = directory => ({ currentSid: 'S-1-5-21-111-222-333-1001', ownerSid: 'S-1-5-21-111-222-333-1001', protected: true,
    isDirectory: directory, reparse: false, driveFormat: 'NTFS', rules: [{ sid: 'S-1-5-21-111-222-333-1001', type: 'Allow', rights: 0x1f01ff }] });
test('Windows ACL proof is distinct from POSIX mode bits and fails closed for broad/unknown/missing permissions', () => {
    assert.equal(validWindowsAcl(acl(true), true), true); assert.equal(validWindowsAcl(acl(false)), true);
    for (const patch of [{ ownerSid: 'S-1-5-18' }, { protected: false }, { driveFormat: 'FAT32' }, { reparse: true },
        { rules: [] }, { rules: [{ sid: 'S-1-1-0', type: 'Allow', rights: 0x1f01ff }] },
        { rules: [{ ...acl(true).rules[0], rights: 1 }] }, { rules: [{ ...acl(true).rules[0], type: 'Deny' }] }]) assert.equal(validWindowsAcl({ ...acl(true), ...patch }, true), false);
    assert.equal(validWindowsAcl({ mode: 0o700 }, true), false);
});
test('fixed PowerShell ACL adapter passes literal path as data and never elevates or repairs an existing ACL', () => {
    const filename = "C:\\Users\\Synthetic O'Brien\\WHO";
    let calls = 0;
    const execute = (executable, args, options) => {
        calls++;
        assert.equal(executable, 'powershell.exe'); assert.equal(args.at(-1), WINDOWS_ACL_SCRIPT);
        assert.equal(options.shell, false); assert.equal(options.env.MEDIFLOW_WHO_ACL_TARGET, filename);
        assert.equal(options.env.MEDIFLOW_WHO_ACL_MODE, 'inspect'); assert.equal(options.timeout, 15000);
        assert.doesNotMatch(args.join(' '), /ExecutionPolicy|RunAs|Synthetic O'Brien/u);
        return { status: 0, stdout: JSON.stringify(acl(true)) };
    };
    windowsAcl(filename, { directory: true, execute }); assert.equal(calls, 1);
    for (const result of [{ status: 1 }, { status: 0, stdout: '{}' }, { error: new Error('synthetic') }]) {
        assert.throws(() => windowsAcl(filename, { directory: true, execute: () => result }), { code: 'private_permissions_required' });
    }
    assert.match(WINDOWS_ACL_SCRIPT, /if \(Test-Path -LiteralPath \$p\) \{ throw 'exists' \}/u);
    assert.match(WINDOWS_ACL_SCRIPT, /ReparsePoint/u);
});
test('thin launchers and application specs keep path spaces, delegation and no policy bypass', () => {
    const win = appLaunchSpec('win32', 'C:\\Synthetic Project\\MediFlow');
    assert.equal(win.executable, 'powershell.exe');
    assert.deepEqual(win.args, ['-NoLogo', '-NoProfile', '-File', 'C:\\Synthetic Project\\MediFlow\\Start-MediFlow.ps1']);
    const linux = appLaunchSpec('linux', '/synthetic project/MediFlow');
    assert.deepEqual(linux.args, ['/synthetic project/MediFlow/scripts/start-mediflow.sh']);
    assert.equal(appLaunchSpec('darwin', '/synthetic project/MediFlow').args[0], '/synthetic project/MediFlow/Start_MediFlow.command');
    assert.match(ownedLauncher('win32', "C:\\Synthetic O'Brien").content, /O''Brien/u);
    const unicodeLauncher = ownedLauncher('win32', 'C:\\Synthetic Équipe');
    assert.equal(unicodeLauncher.content.codePointAt(0), 0xfeff, 'UTF-8 BOM for Windows PowerShell 5.1');
    assert.match(unicodeLauncher.content, /Équipe/u);
    assert.match(ownedLauncher('linux', "/synthetic O'Brien").content, /exec \/bin\/bash/u);
    const ps = read('Setup_WHO.ps1').toString();
    assert.match(ps, /Join-Path \$PSScriptRoot/u); assert.doesNotMatch(ps, /ExecutionPolicy|RunAs|Invoke-Expression|Invoke-WebRequest/u);
    assert.doesNotMatch(read('Setup_WHO.sh').toString(), /sudo|curl|wget|docker /u);
});
