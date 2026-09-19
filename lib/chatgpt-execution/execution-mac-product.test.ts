/* @Codex — synthetic issuer failures exercise resource ownership, not admission. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MacQualificationAudit } from './execution-mac-qualification';
const { createMacProductPlatformManager } = await import('./execution-mac-product.ts');
const { MacQualificationFailure } = await import('./execution-mac-qualification.ts');
const { ExecutionError } = await import('./execution-contract.ts');
const assets = () => ({ binaryPath: '/synthetic/codex', nativeSourcePath: '/synthetic/mac-owner.c', schemaDirectory: '/synthetic/schema', c1ReceiptPath: '/synthetic/c1' });
const audit = (clean: boolean): MacQualificationAudit => ({
    schema: 'mediflow.mac-custody-audit.v1', run: 'synthetic', phase: 'revoked', stage: 'readback',
    claim: 'candidate_boundary_only_not_live_or_clinical', revision: null, baseContextSha256: '', sourceAvailable: true,
    fullSourceBuildBinding: 'unqualified', consumedProjectionBinding: 'not_observed', omittedToolBinding: 'not_observed',
    protocolRegeneration: 'not_observed', initializeSha256: null, readbackSha256: null, nativeHelperSha256: null,
    compilerSha256: null, binarySha256: '', osBuild: 'synthetic', cleanupComplete: clean, ownedTreeCeased: clean,
    administrativePolicy: 'absent_only_no_overrides', resourcesRetained: !clean,
});
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
test('construction and snapshots are passive; one reservation precedes asynchronous startup', async t => {
    const root = mkdtempSync(join(tmpdir(), 'mf-mac-reservation-')); t.after(() => rmSync(root, { recursive: true, force: true }));
    const directory = join(root, 'hold'), gate = deferred(); let starts = 0;
    const manager = createMacProductPlatformManager({ assets, reservationDirectory: () => directory,
        async prepare() { starts++; await gate.promise; throw new MacQualificationFailure('readback', audit(true), null); } });
    const first = manager.createPlatform(), second = manager.createPlatform();
    first.snapshot(); first.preparation!(); assert.equal(starts, 0); assert.equal(existsSync(directory), false);
    const work = first.prepare!(new AbortController().signal, 300000);
    assert.equal(existsSync(join(directory, 'mac-preparation.hold')), true);
    await assert.rejects(second.prepare!(new AbortController().signal, 300000), e => e instanceof ExecutionError && e.code === 'busy');
    assert.equal(starts, 1); gate.resolve(); await assert.rejects(work, MacQualificationFailure);
    assert.equal(first.preparation!().state, 'closed'); assert.equal(existsSync(join(directory, 'mac-preparation.hold')), false);
});
test('unconfirmed cleanup survives owner disappearance and a fresh manager', async t => {
    const root = mkdtempSync(join(tmpdir(), 'mf-mac-unconfirmed-')); t.after(() => rmSync(root, { recursive: true, force: true }));
    const manager = createMacProductPlatformManager({ assets, reservationDirectory: () => root,
        async prepare() { throw new MacQualificationFailure('readback', audit(false), '/synthetic-retained'); } });
    const first = manager.createPlatform(); await assert.rejects(first.prepare!(new AbortController().signal, 300000));
    assert.equal(first.preparation!().state, 'blocked'); await first.close!();
    assert.equal(first.preparation!().state, 'blocked');
    let starts = 0;
    const restarted = createMacProductPlatformManager({ assets, reservationDirectory: () => root,
        async prepare() { starts++; throw new Error('must not launch'); } });
    await assert.rejects(restarted.createPlatform().prepare!(new AbortController().signal, 300000), e => e instanceof ExecutionError && e.code === 'busy');
    assert.equal(starts, 0); assert.equal(existsSync(join(root, 'mac-preparation.hold')), true);
});
test('cancel keeps the original pending promise and reservation until actual failed-start cleanup', async t => {
    const root = mkdtempSync(join(tmpdir(), 'mf-mac-late-')); t.after(() => rmSync(root, { recursive: true, force: true }));
    const gate = deferred(); let signal: AbortSignal | undefined;
    const manager = createMacProductPlatformManager({ assets, reservationDirectory: () => root,
        async prepare(options) { signal = options.signal; await gate.promise; throw new MacQualificationFailure('readback', audit(true), null); } });
    const first = manager.createPlatform(), abort = new AbortController();
    const work = first.prepare!(abort.signal, 300000); await Promise.resolve(); abort.abort();
    const cleanup = first.close!(); assert.equal(signal?.aborted, true);
    assert.equal(existsSync(join(root, 'mac-preparation.hold')), true);
    await assert.rejects(manager.createPlatform().prepare!(new AbortController().signal, 300000));
    gate.resolve(); await assert.rejects(work); await cleanup;
    assert.equal(first.preparation!().state, 'closed'); assert.equal(existsSync(join(root, 'mac-preparation.hold')), false);
});


test('host-only diagnostic reaches preparation without changing failed-start cleanup', async t => {
    const { reportExecutionDiagnostic } = await import('./execution-transport.ts');
    const root = mkdtempSync(join(tmpdir(), 'mf-mac-diagnostic-')); t.after(() => rmSync(root, { recursive: true, force: true }));
    const events: unknown[] = []; const diagnostic = (event: unknown) => { events.push(event); throw new Error('PRIVATE_PROVIDER_SENTINEL'); };
    const failure = new MacQualificationFailure('readback', audit(true), null);
    const manager = createMacProductPlatformManager({ assets, diagnostic, reservationDirectory: () => root,
        async prepare(options) {
            assert.equal(options.diagnostic, diagnostic);
            reportExecutionDiagnostic(options.diagnostic, { event: 'rpc_error', method: 'initialize', errorCode: 'upstream_error',
                rpcCode: -32603, httpStatus: 503, tls: true, network: false, device: false, experimental: false, permission: false });
            throw failure;
        } });
    const platform = manager.createPlatform();
    await assert.rejects(platform.prepare!(new AbortController().signal, 300000), error => error === failure);
    assert.equal(events.length, 1); assert.doesNotMatch(JSON.stringify(events), /PRIVATE_/u);
    assert.equal(platform.preparation!().state, 'closed'); assert.equal(existsSync(join(root, 'mac-preparation.hold')), false);
});

test('host diagnostics are silent by default and emit only the closed projection when opted in', async t => {
    const root = mkdtempSync(join(tmpdir(), 'mf-mac-host-diagnostic-')); t.after(() => rmSync(root, { recursive: true, force: true }));
    const env = process.env.MEDIFLOW_CHATGPT_EXECUTION_DIAGNOSTICS, warn = console.warn;
    const warnings: unknown[][] = []; console.warn = (...args: unknown[]) => { warnings.push(args); };
    t.after(() => { console.warn = warn; if (env === undefined) delete process.env.MEDIFLOW_CHATGPT_EXECUTION_DIAGNOSTICS;
        else process.env.MEDIFLOW_CHATGPT_EXECUTION_DIAGNOSTICS = env; });
    const run = async (enabled: boolean) => {
        if (enabled) process.env.MEDIFLOW_CHATGPT_EXECUTION_DIAGNOSTICS = '1';
        else delete process.env.MEDIFLOW_CHATGPT_EXECUTION_DIAGNOSTICS;
        const manager = createMacProductPlatformManager({ assets, reservationDirectory: () => root,
            async prepare(options) {
                options.diagnostic?.({ event: 'rpc_error', method: 'initialize', errorCode: 'upstream_error',
                    rpcCode: -32042 as -32000, httpStatus: 599, tls: true, network: false, device: false,
                    experimental: false, permission: false, privateValue: 'PRIVATE_PROVIDER_SENTINEL' } as unknown as Parameters<NonNullable<typeof options.diagnostic>>[0]);
                throw new MacQualificationFailure('readback', audit(true), null);
            } });
        await assert.rejects(manager.createPlatform().prepare!(new AbortController().signal, 300000), MacQualificationFailure);
    };
    await run(false); assert.equal(warnings.length, 0);
    await run(true); assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0]?.slice(0, 1), ['MEDIFLOW_CHATGPT_EXECUTION_DIAGNOSTIC']);
    const projection = JSON.parse(String(warnings[0]?.[1]));
    assert.deepEqual(projection, { event: 'rpc_error', method: 'initialize', errorCode: 'upstream_error',
        rpcCode: -32000, httpStatus: 599, tls: true, network: false, device: false, experimental: false, permission: false });
    assert.doesNotMatch(JSON.stringify(warnings), /PRIVATE_/u);
    console.warn = () => { throw new Error('diagnostic sink failure'); };
    await run(true);
});
