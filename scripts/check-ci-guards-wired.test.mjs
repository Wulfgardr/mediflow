import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCiGuardsWired, EXEMPT_CI_GUARDS } from './check-ci-guards-wired.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function writeFixture(t, scripts, workflowYaml) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-ci-guards-wired-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }, null, 2));
    const wfDir = path.join(root, '.github', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'openapi-contract-guard.yml'), workflowYaml);
    return root;
}

test('live repository wires every non-exempt check:* and verify:* script into CI workflows', () => {
    const result = checkCiGuardsWired(REPO_ROOT);
    assert.deepEqual(result.errors, []);
    assert.ok(result.wiredCount >= 25);
});

test('catches WUL-547 regression when check:schema-drift is dropped from CI workflow', (t) => {
    const root = writeFixture(
        t,
        {
            'check:schema-drift': 'node scripts/check-schema-drift.mjs',
            'check:anydoc-local-only': 'node scripts/check-anydoc-local-only.mjs',
        },
        [
            'name: Repository Guards',
            'on: [pull_request]',
            'jobs:',
            '  repository-guards:',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - run: npm run check:anydoc-local-only',
        ].join('\n'),
    );
    const result = checkCiGuardsWired(root, {});
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /UNWIRED_GUARD: check:schema-drift/);
    assert.match(result.errors[0], /\.github\/workflows\/openapi-contract-guard\.yml/);
});

test('ignores commented-out, disabled, and continue-on-error workflow steps', (t) => {
    const root = writeFixture(
        t,
        {
            'check:commented': 'node a.mjs',
            'check:disabled': 'node b.mjs',
            'check:soft-fail': 'node c.mjs',
            'check:soft-fail-expr': 'node c2.mjs',
            'verify:formal-model': 'node d.mjs',
        },
        [
            'name: Guards',
            'on: [pull_request]',
            'jobs:',
            '  guards:',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - run: |',
            '          # npm run check:commented',
            '          echo ok',
            '      - if: FALSE',
            '        run: npm run check:disabled',
            '      - continue-on-error: true',
            '        run: npm run check:soft-fail',
            '      - continue-on-error: ${{ true }}',
            '        run: npm run check:soft-fail-expr',
        ].join('\n'),
    );
    const result = checkCiGuardsWired(root, {});
    assert.equal(result.errors.length, 5);
    assert.match(result.errors.join('\n'), /UNWIRED_GUARD: check:commented/);
    assert.match(result.errors.join('\n'), /UNWIRED_GUARD: check:disabled/);
    assert.match(result.errors.join('\n'), /UNWIRED_GUARD: check:soft-fail\b/);
    assert.match(result.errors.join('\n'), /UNWIRED_GUARD: check:soft-fail-expr/);
    assert.match(result.errors.join('\n'), /UNWIRED_GUARD: verify:formal-model[\s\S]*web-core\.yml/);
});

test('rejects stale and redundant exemptions so the exemption list only shrinks', (t) => {
    const root = writeFixture(
        t,
        { 'check:wired-now': 'node wired.mjs' },
        [
            'name: Guards',
            'on: [pull_request]',
            'jobs:',
            '  guards:',
            '    runs-on: ubuntu-latest',
            '    steps:',
            '      - run: npm run check:wired-now',
        ].join('\n'),
    );
    const result = checkCiGuardsWired(root, {
        'check:wired-now': 'formerly local',
        'check:deleted-script': 'no longer exists',
    });
    assert.equal(result.errors.length, 2);
    assert.match(result.errors.join('\n'), /REDUNDANT_EXEMPTION: check:wired-now/);
    assert.match(result.errors.join('\n'), /STALE_EXEMPTION: check:deleted-script/);
    assert.equal(Object.hasOwn(EXEMPT_CI_GUARDS, 'check:anydoc-local-only'), false);
    assert.equal(Object.hasOwn(EXEMPT_CI_GUARDS, 'check:attachment-currentness-writers'), false);
});
