/* Public bytes only. No account, network, process qualification or clinical store. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
installSyntheticPackagingPins();
const { executionPublicCaBundle, EXECUTION_PUBLIC_CA_PIN } = await import('./execution-sandbox.ts');
import { ExecutionError } from './execution-contract';
import { regeneratePublicCa, PUBLIC_CA_SOURCE } from '../../scripts/regenerate-chatgpt-public-ca.mjs';
import { installedFixture } from '../../scripts/fixtures/mac-packaging-test-support.mjs';
import { installSyntheticPackagingPins } from '../../scripts/fixtures/mac-packaging-test-loader.mjs';

const asset = new URL('../../assets/chatgpt-execution/public-ca.pem', import.meta.url);
const denied = (error: unknown) => error instanceof ExecutionError && error.code === 'unqualified_boundary' && error.reason === 'public_ca_mismatch';
test('qualified public roots are byte-identical to the pinned Node 24.21.0 source', () => {
    const bytes = readFileSync(asset);
    assert.deepEqual(regeneratePublicCa(), bytes);
    assert.equal(executionPublicCaBundle(asset.pathname), bytes.toString());
    assert.equal(bytes.length, EXECUTION_PUBLIC_CA_PIN.bytes);
    assert.equal(PUBLIC_CA_SOURCE.pemSha256, EXECUTION_PUBLIC_CA_PIN.sha256);
    const certificates = bytes.toString().match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/gu)!;
    assert.equal(certificates.length, 121);
    for (const pem of certificates) assert.equal(new X509Certificate(pem).ca, true);
    assert.throws(() => regeneratePublicCa(Buffer.from('altered source')), /public_ca_source_mismatch/);
});
installSyntheticPackagingPins();
const { resolveInstalledMacExecutionAssets } = await import('./execution-mac-assets.ts');
for (const mutation of ['byte', 'missing', 'extra-authority'] as const) {
    test(`${mutation}: real CA pin denies both direct read and installed resolution before transport`, t => {
        const f = installedFixture(t), path = join(f.assets, 'public-ca.pem');
        assert.equal(executionPublicCaBundle(path), readFileSync(asset, 'utf8')); // valid control
        resolveInstalledMacExecutionAssets(f.root);
        const bytes = readFileSync(path);
        if (mutation === 'missing') rmSync(path);
        else if (mutation === 'byte') { bytes[100] ^= 1; writeFileSync(path, bytes); }
        else writeFileSync(path, Buffer.concat([bytes, Buffer.from('\n'), bytes.subarray(0, bytes.indexOf('-----END CERTIFICATE-----') + 25)]));
        assert.throws(() => executionPublicCaBundle(path), denied);
        assert.throws(() => resolveInstalledMacExecutionAssets(f.root), denied);
    });
}
