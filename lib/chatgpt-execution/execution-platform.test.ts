/* @Codex — source gating tests are not OS qualification. No probe or spawn. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
const { executionPlatformSnapshot, createProductionExecutionPlatform, createReviewedMacProductPlatform } = await import('./execution-platform.ts');
const { createLinuxExecutionHost } = await import('./execution-linux.ts');
const { createWindowsExecutionHost } = await import('./execution-windows.ts');
const { ExecutionError } = await import('./execution-contract.ts');
const denied = (error: unknown) => error instanceof ExecutionError && error.code === 'unqualified_boundary';
for (const platform of ['darwin', 'linux', 'win32', 'unknown-os']) test(`${platform} does not self-qualify from source flags`, () => {
    const value = executionPlatformSnapshot(platform); assert.notEqual(value.state, 'qualified'); assert.ok(value.missing.length);
});
test('default, Linux/Windows and absent-evidence Mac deny before creating a host', async () => {
    await assert.rejects(createProductionExecutionPlatform().create(new AbortController().signal), denied);
    await assert.rejects(createLinuxExecutionHost(), denied); await assert.rejects(createWindowsExecutionHost(), denied);
    const platform = createReviewedMacProductPlatform({ binaryPath: 'not-a-real-binary-never-resolved', qualification: { currentEvidence: () => null } });
    assert.notEqual(platform.snapshot().state, 'qualified'); await assert.rejects(platform.create(new AbortController().signal), denied);
});

test('C1 attached regeneration is not mislabeled missing and never enables the Mac factory', () => {
    const held = executionPlatformSnapshot('darwin');
    assert.equal(held.state, 'unqualified');
    assert.equal(held.missing.includes('protocol.exact-generator-receipt'), false);
    assert.ok(held.missing.includes('protocol.current-runtime-pin-binding'));
    assert.ok(held.missing.includes('protocol.exact-public-config-schema-and-readback'));
});
