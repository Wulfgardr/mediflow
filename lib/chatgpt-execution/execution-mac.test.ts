/* @Codex — synthetic tests, not OS or live qualification. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { MAC_CONFIG_SOURCE, MAC_C1_RECEIPT, assertMacInputProjection, readPinnedMacFile, verifyMacSourceSet, macDigest } = await import('./execution-mac-config.ts');
const { MAC_NATIVE_SOURCE } = await import('./execution-mac-native.ts');
const { expectedExecutionConfig, assertExecutionConfig } = await import('./execution-login.ts');
const { parseMacOwnerFrame, MacOwnerSequence } = await import('./execution-mac-state.ts');
const { readMacQualification, takeMacQualifiedHost, prepareMacProductQualification, MacQualificationFailure } = await import('./execution-mac-qualification.ts');
const { createReviewedMacProductPlatform, createProductionExecutionPlatform } = await import('./execution-platform.ts');
const { executionSandboxProfile } = await import('./execution-sandbox.ts');
const { createQualifiedExecutionHost } = await import('./execution-host.ts');
const { ExecutionError } = await import('./execution-contract.ts');
const rejected = (e: unknown) => e instanceof ExecutionError && e.code === 'unqualified_boundary';
// Explicit frozen public assets only. No default HOME/repository/account discovery.
const sourceDirectory = process.env.MEDIFLOW_MAC_PUBLIC_SOURCE_DIR;
const c1ReceiptPath = process.env.MEDIFLOW_MAC_C1_RECEIPT;
const nativeSourcePath = process.env.MEDIFLOW_MAC_NATIVE_SOURCE;
const nonce = '0123456789abcdef0123456789abcdef';
const frame = (seq: number, kind: string, value: number, detail = 0) => parseMacOwnerFrame(`MFM1 ${nonce} ${seq} ${kind} ${value} ${detail}`, nonce);

test('pinned complete source, receipts and 24 C1 comparisons validate only the fixed projection', { skip: process.platform !== 'darwin' }, () => {
    assert.ok(sourceDirectory, 'set MEDIFLOW_MAC_PUBLIC_SOURCE_DIR to the frozen config-schema directory');
    assert.ok(c1ReceiptPath, 'set MEDIFLOW_MAC_C1_RECEIPT to the frozen receipt');
    const pins = verifyMacSourceSet(sourceDirectory, c1ReceiptPath, expectedExecutionConfig());
    assert.equal(pins.length, 24); assert.equal(new Set(pins.map(p => p.path)).size, 24);
    assert.equal(MAC_CONFIG_SOURCE.binaryBuildBinding, 'unqualified');
    assert.equal(MAC_CONFIG_SOURCE.runtimeReadback, 'not_observed');
    assert.equal(readPinnedMacFile(c1ReceiptPath, MAC_C1_RECEIPT).length, 8330);
});
test('source truncation, wrong receipt and unknown or invalid typed inputs are rejected', { skip: process.platform !== 'darwin' }, () => {
    assert.ok(sourceDirectory);
    const bytes = readFileSync(join(sourceDirectory, 'config.schema.json'));
    assert.throws(() => assertMacInputProjection(bytes.subarray(1), expectedExecutionConfig()), rejected);
    for (const update of [{ unknown_permission: false }, { allow_login_shell: 'false' }, { sandbox_mode: 'invented' }, { approval_policy: null }]) {
        assert.throws(() => assertMacInputProjection(bytes, { ...expectedExecutionConfig(), ...update }), rejected);
    }
    const scratch = mkdtempSync(join(tmpdir(), 'mfmac-source-test-'));
    try {
        const p = join(scratch, 'bad.json'); writeFileSync(p, bytes);
        assert.throws(() => readPinnedMacFile(p, MAC_C1_RECEIPT), rejected);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
});
test('native source pin is over the complete delivered C bytes, never a caller helper digest', { skip: process.platform !== 'darwin' }, () => {
    assert.ok(nativeSourcePath, 'set MEDIFLOW_MAC_NATIVE_SOURCE to the delivered mac-owner.c');
    const source = readPinnedMacFile(nativeSourcePath, MAC_NATIVE_SOURCE);
    assert.equal(macDigest(source), MAC_NATIVE_SOURCE.sha256);
    assert.match(source.toString(), /RLIMIT_NPROC/); assert.match(source.toString(), /waitpid\(child/);
    assert.match(source.toString(), /errno != ENOENT/); assert.doesNotMatch(source.toString(), /kill\(-/);
});
test('no source or a successful isCurrent callback grants authority, callback is never invoked', async () => {
    let invoked = 0;
    const forged = Object.freeze({ currentEvidence() { invoked++; return { revision: 'caller-proof', isCurrent: () => true }; } });
    assert.equal(readMacQualification(forged, '/not-a-real-binary'), null);
    await assert.rejects(takeMacQualifiedHost(forged, '/not-a-real-binary', new AbortController().signal), rejected);
    const platform = createReviewedMacProductPlatform({ qualification: forged, binaryPath: '/not-a-real-binary' });
    assert.notEqual(platform.snapshot().state, 'qualified');
    await assert.rejects(platform.create(new AbortController().signal), rejected);
    assert.equal(invoked, 0);
    await assert.rejects(createQualifiedExecutionHost('/not-a-real-binary'), rejected);
    await assert.rejects(createProductionExecutionPlatform().create(new AbortController().signal), rejected);
});
test('JSON/prototype copies, absent authorities and arbitrary booleans cannot mint', () => {
    for (const fake of [{}, JSON.parse('{"revision":"x","qualified":true}'), Object.create({ currentEvidence: () => ({ isCurrent: () => true }) })]) {
        assert.equal(readMacQualification(fake, '/binary'), null);
    }
});
test('foreign-platform producer rejects before file reads, build, startup or egress', { skip: process.platform === 'darwin' }, async () => {
    await assert.rejects(prepareMacProductQualification({ binaryPath: '/never-read', nativeSourcePath: '/never-read',
        schemaDirectory: '/never-read', c1ReceiptPath: '/never-read' }), e => e instanceof MacQualificationFailure
        && e.stage === 'platform' && e.audit.readbackSha256 === null && e.retainedRoot === null);
});
test('same-run status framing rejects replay, wrong nonce, oversized, negative pid, extra text', () => {
    for (const value of [`MFM1 ${'f'.repeat(32)} 1 START 12 0`, `MFM1 ${nonce} 0 START 12 0`,
        `MFM1 ${nonce} 1 START -1 0`, `MFM1 ${nonce} 1 START 12 1`, `MFM1 ${nonce} 1 LIVE 1 0`,
        `MFM1 ${nonce} 1 ERROR 99 0`, `MFM1 ${nonce} 1 STOP 0 9`, `MFM1 ${nonce} 1 START 12 0 trailing`, 'x'.repeat(161)]) {
        assert.throws(() => parseMacOwnerFrame(value, nonce), rejected);
    }
});
test('native custody is current only while live, with strictly ordered same-pid observations', () => {
    const s = new MacOwnerSequence(); assert.equal(s.live(0), false); assert.equal(s.leaseTick(0), 'renew');
    s.accept(frame(1, 'START', 123), 100); assert.equal(s.live(100), true); assert.equal(s.live(99), false);
    assert.equal(s.leaseTick(100), 'renew'); assert.equal(s.live(451), false); assert.equal(s.leaseTick(451), 'expired');
    s.accept(frame(2, 'LIVE', 123), 200);
    assert.equal(s.live(549), true); assert.equal(s.drained, false);
    assert.throws(() => s.accept(frame(2, 'LIVE', 123), 201), rejected);
    assert.equal(s.live(202), false);
});
for (const scenario of ['wrong-pid', 'duplicate-start', 'time-backwards', 'stop-before-start', 'after-stop']) test(`reject custody transition ${scenario}`, () => {
    const s = new MacOwnerSequence();
    if (scenario === 'stop-before-start') {
        s.accept(frame(1, 'STOP', 0), 1); s.exited(0, null); assert.equal(s.failed, true); assert.equal(s.drained, false); return;
    }
    s.accept(frame(1, 'START', 123), 100);
    if (scenario === 'wrong-pid') assert.throws(() => s.accept(frame(2, 'LIVE', 124), 101), rejected);
    if (scenario === 'duplicate-start') assert.throws(() => s.accept(frame(2, 'START', 123), 101), rejected);
    if (scenario === 'time-backwards') assert.throws(() => s.accept(frame(2, 'LIVE', 123), 99), rejected);
    if (scenario === 'after-stop') {
        s.accept(frame(2, 'STOP', 0, 1), 101);
        assert.throws(() => s.accept(frame(3, 'LIVE', 123), 102), rejected);
    }
    assert.equal(s.failed, true);
});
test('leader exit/timeout is not a verified tree drain; actual STOP plus supervisor close is', () => {
    const s = new MacOwnerSequence(); s.accept(frame(1, 'START', 123), 10);
    s.accept(frame(2, 'STOP', -15, 1), 20); assert.equal(s.live(20), false); assert.equal(s.drained, false);
    s.exited(0, null); assert.equal(s.drained, true);
    const lost = new MacOwnerSequence(); lost.accept(frame(1, 'START', 123), 10); lost.exited(null, 'SIGKILL'); assert.equal(lost.drained, false);
});
test('a lease tick between a successful STOP and supervisor close preserves the terminal witness', () => {
    const s = new MacOwnerSequence(); s.accept(frame(1, 'START', 123), 10);
    s.accept(frame(2, 'STOP', 0), 100);
    assert.equal(s.leaseTick(200), 'stopped');
    assert.equal(s.failed, false); assert.equal(s.drained, false);
    s.exited(0, null); assert.equal(s.drained, true);
});
test('expiry/policy revokes qualification even when authentic reaping permits cleanup', () => {
    const s = new MacOwnerSequence(); s.accept(frame(1, 'START', 123), 10);
    s.accept(frame(2, 'STOP', -9, 2), 20); s.exited(0, null);
    assert.equal(s.failed, true); assert.equal(s.live(20), false); assert.equal(s.drained, true);
    const denied = new MacOwnerSequence(); denied.accept(frame(1, 'ERROR', 1), 1); denied.exited(78, null);
    assert.equal(denied.live(2), false); assert.equal(denied.drained, true);
});
test('error/unknown reaping cannot be turned into a clean drain by successful supervisor exit', () => {
    const s = new MacOwnerSequence(); s.accept(frame(1, 'START', 123), 10);
    s.accept(frame(2, 'ERROR', 5), 20); s.exited(0, null); assert.equal(s.drained, false);
});
test('runtime matcher still rejects nonempty origin, layers, unknown root and nullable unproved roots', () => {
    const base = { config: expectedExecutionConfig(), origins: {} };
    assert.doesNotThrow(() => assertExecutionConfig(base));
    for (const raw of [{ ...base, origins: { admin: 'ignored' } }, { ...base, layers: [] }, { ...base, extra: null },
        { ...base, config: { ...base.config, browser_use: null } }, { ...base, config: { ...base.config, mcp_servers: {} } }]) {
        assert.throws(() => assertExecutionConfig(raw), rejected);
    }
});
test('profile protects hard-link aliases through mode/owner/flag denial and leaves no ambient IPC', () => {
    const p = executionSandboxProfile('/private/tmp/mfmac-synthetic', '/private/tmp/mfmac-synthetic/runtime/codex', 42424);
    assert.match(p, /\(deny process-fork\)/); assert.doesNotMatch(p, /\(allow process-fork\)/);
    assert.match(p, /\(deny mach-lookup\)/); assert.doesNotMatch(p, /\(allow mach-lookup/);
    assert.match(p, /deny file-write-mode file-write-owner file-write-flags/);
    assert.match(p, /managed_config\.toml/); assert.match(p, /requirements\.toml/);
    assert.doesNotMatch(p, /\(allow file-write\* \(subpath "\/private\/tmp\/mfmac-synthetic"\)/);
    assert.throws(() => executionSandboxProfile('/tmp/unsafe\nroot', '/tmp/bin', 42), rejected);
});
