import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPrivateDacl } from '../scripts/windows-private-directory.mjs';
const sid = 'S-1-5-21-123-456-789-1001';
const valid = `D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;${sid})`;
test('private backup DACL accepts only inheritable full access for current user and SYSTEM', () => {
    assert.doesNotThrow(() => assertPrivateDacl(valid, sid));
    for (const value of [valid.replace('D:P', 'D:'), valid.replace('OICI', 'OICIID'),
        valid.replace('SY', 'BU'), valid.replace(sid, 'S-1-5-21-123-456-789-1002'),
        valid + '(A;OICI;FR;;;BU)', valid.replace(';FA;', ';FR;'), valid + 'S:']) {
        assert.throws(() => assertPrivateDacl(value, sid));
    }
});

test('Windows creates and verifies the private DACL before any payload', { skip: process.platform !== 'win32' }, async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { restrictNewPrivateDirectory, assertPrivateDirectory } = await import('../scripts/windows-private-directory.mjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-private-dacl-'));
    try {
        restrictNewPrivateDirectory(root);
        assertPrivateDirectory(root);
        assert.deepEqual(fs.readdirSync(root), []);
        fs.writeFileSync(path.join(root, 'synthetic.txt'), 'synthetic');
        assert.throws(() => restrictNewPrivateDirectory(root));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
