import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { canonicalPe } from '../scripts/verify-windows-bootstrap-rebuild.mjs';

for (const arch of ['x64', 'arm64']) {
    test(`Windows ${arch} provenance comparison ignores only build timestamps`, () => {
        const original = fs.readFileSync(new URL(`../scripts/windows-launcher-bootstrap/prebuilds/win32-${arch}/system-directory.node`, import.meta.url));
        const pe = original.readUInt32LE(0x3c);
        const changedTime = Buffer.from(original);
        changedTime.writeUInt32LE(12345, pe + 8);
        assert.deepEqual(canonicalPe(changedTime), canonicalPe(original));
        const changedCode = Buffer.from(original);
        changedCode[changedCode.length - 1] ^= 1;
        assert.notDeepEqual(canonicalPe(changedCode), canonicalPe(original));
        assert.throws(() => canonicalPe(Buffer.alloc(64)));
    });
}
