import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { assertBootstrapBytesEqual, peByteDifferences } from '../scripts/verify-windows-bootstrap-rebuild.mjs';

for (const arch of ['x64', 'arm64']) {
    test(`Windows ${arch} provenance comparison rejects every changed byte including timestamps`, () => {
        const original = fs.readFileSync(new URL(`../scripts/windows-launcher-bootstrap/prebuilds/win32-${arch}/system-directory.node`, import.meta.url));
        assert.doesNotThrow(() => assertBootstrapBytesEqual(original, Buffer.from(original)));
        const pe = original.readUInt32LE(0x3c);
        for (const offset of [pe + 8, 0x1680, original.length - 1]) {
            const changed = Buffer.from(original);
            changed[offset] ^= 1;
            assert.throws(() => assertBootstrapBytesEqual(original, changed));
            assert.deepEqual(peByteDifferences(original, changed), [{ offset: `0x${offset.toString(16)}`, delivered: original[offset], rebuilt: changed[offset] }]);
        }
        assert.throws(() => assertBootstrapBytesEqual(original, original.subarray(0, -1)));
    });
}
