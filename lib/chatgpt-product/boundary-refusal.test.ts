/* A failed container probe: recorded per build, refused with what is missing.
 * Synthetic issuer outcome; the real probe is in execution-mac-probe.test.ts. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MacQualificationAudit } from '../chatgpt-execution/execution-mac-qualification';
import type { MacBoundaryProbeRecord } from '../chatgpt-execution/execution-mac-probe';

const originalDataDir = process.env.MEDIFLOW_DATA_DIR;
assert.ok(originalDataDir, 'Run-owned synthetic data directory required');
mkdirSync(originalDataDir, { recursive: true });
const dataDir = mkdtempSync(join(originalDataDir, 'boundary-refusal-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
after(() => { process.env.MEDIFLOW_DATA_DIR = originalDataDir; });
const { createMacProductPlatformManager } = await import('../chatgpt-execution/execution-mac-product.ts');
const { MacQualificationFailure } = await import('../chatgpt-execution/execution-mac-qualification.ts');
const { MAC_BOUNDARY_PROBE_CHECKS } = await import('../chatgpt-execution/execution-mac-probe.ts');
const { ordinaryFailure } = await import('./ordinary-flow.ts');
const { boundaryPreparationError } = await import('../function-models/ordinary-browser.ts');

const directory = join(dataDir, 'chatgpt-execution');
const probe = (osBuild: string, failing: readonly string[]): MacBoundaryProbeRecord => Object.freeze({
    schema: 'mediflow.mac-boundary-probe.v1', osBuild, osVersion: '27.3', observedAt: new Date().toISOString(),
    codexSha256: 'a'.repeat(64), dyldSupportSha256: 'b'.repeat(64), profileSha256: 'c'.repeat(64), probeProfileSha256: 'd'.repeat(64),
    nativeHelperSha256: 'e'.repeat(64), outcome: failing.length ? 'failed' : 'passed',
    checks: Object.fromEntries(MAC_BOUNDARY_PROBE_CHECKS.map(name => [name, failing.includes(name) ? 'failed' : 'passed'])) });
const audit = (boundaryProbe: MacBoundaryProbeRecord | null): MacQualificationAudit => ({
    schema: 'mediflow.mac-custody-audit.v1', run: 'synthetic', phase: 'revoked', stage: 'probe',
    claim: 'candidate_boundary_only_not_live_or_clinical', revision: null, baseContextSha256: '', sourceAvailable: true,
    fullSourceBuildBinding: 'unqualified', consumedProjectionBinding: 'not_observed', omittedToolBinding: 'not_observed',
    protocolRegeneration: 'not_observed', initializeSha256: null, readbackSha256: null, nativeHelperSha256: null,
    compilerSha256: null, binarySha256: '', osBuild: boundaryProbe?.osBuild ?? null, boundaryProbe, cleanupComplete: true,
    ownedTreeCeased: true, administrativePolicy: 'absent_only_no_overrides', resourcesRetained: false });

test('a failed probe on a new build is recorded and refuses the preparation', async () => {
    const failure = new MacQualificationFailure('probe', audit(probe('26C10', ['home_read', 'external_network'])), null);
    const platform = createMacProductPlatformManager({ reservationDirectory: () => directory,
        assets: () => ({ binaryPath: '/synthetic', nativeSourcePath: '/synthetic', schemaDirectory: '/synthetic', c1ReceiptPath: '/synthetic' }),
        async prepare() { throw failure; } }).createPlatform();
    await assert.rejects(platform.prepare!(new AbortController().signal, 60_000), error => error === failure);
    assert.notEqual(platform.snapshot().state, 'qualified');
    const log = JSON.parse(readFileSync(join(directory, 'boundary-probe.json'), 'utf8'));
    assert.equal(log.builds['26C10'].outcome, 'failed');
    assert.equal(log.builds['26C10'].checks.home_read, 'failed');

    const response = ordinaryFailure(failure);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, 'unqualified_boundary');
    assert.deepEqual(body.boundary, { stage: 'probe', osBuild: '26C10', probe: 'failed', failed: ['home_read', 'external_network'] });
    const message = boundaryPreparationError(body);
    assert.match(message, /26C10/u);
    assert.match(message, /cartella personale/u);
    assert.match(message, /rete fuori dalle destinazioni ufficiali/u);
    assert.match(message, /Nessun dato è stato inviato/u);
});
test('names outside the fixed checks never reach the interface', () => {
    const message = boundaryPreparationError({ code: 'unqualified_boundary',
        boundary: { stage: 'probe', osBuild: '/Users/x', probe: 'failed', failed: ['<script>', 'home_read'] } });
    assert.doesNotMatch(message, /script|Users/u);
    assert.match(message, /cartella personale/u);
});
test('a refusal before the probe still says that nothing was sent', () => {
    for (const stage of ['sources', 'build', 'platform', undefined])
        assert.match(boundaryPreparationError({ code: 'unqualified_boundary', ...(stage ? { boundary: { stage, osBuild: null, probe: null, failed: [] } } : {}) }), /Nessun dato è stato inviato/u);
});
