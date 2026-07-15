/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertNodeRuntime, readNodeContract, standaloneDirectory } from './node-runtime-contract.mjs';

test('accepts only the Node major pinned by .nvmrc and package engines', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-node-contract-'));
    try {
        fs.writeFileSync(path.join(root, '.nvmrc'), '24\n');
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ engines: { node: '>=24 <25' } }));
        const contract = readNodeContract(root);
        assert.deepEqual(contract, { major: 24, engines: '>=24 <25' });
        assert.deepEqual(assertNodeRuntime(contract, { node: '24.18.0', modules: '137' }), {
            version: '24.18.0', moduleVersion: '137',
        });
        assert.throws(() => assertNodeRuntime(contract, { node: '20.20.2', modules: '115' }), /24\.x richiesto/);
        assert.throws(() => assertNodeRuntime(contract, { node: '26.4.0', modules: '147' }), /24\.x richiesto/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('uses the configured Next.js dist directory for standalone artifacts', () => {
    assert.equal(
        standaloneDirectory('/repo', { MEDIFLOW_NEXT_DIST_DIR: '.next-custom' }),
        path.join('/repo', '.next-custom', 'standalone')
    );
});

test('fails closed when .nvmrc and engines drift', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-node-contract-'));
    try {
        fs.writeFileSync(path.join(root, '.nvmrc'), '24\n');
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ engines: { node: '>=20' } }));
        assert.throws(() => readNodeContract(root), /Contratto Node incoerente/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
