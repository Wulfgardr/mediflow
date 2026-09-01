// @Codex
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('retired Docker ICD launch and raw-vendor benchmark entrypoints are absent', () => {
    for (const path of ['docker-compose.yml', 'debug_icd_connection.sh', 'scripts/benchmark-icd-resolver.ts']) {
        assert.equal(existsSync(new URL(path, root)), false, `${path} must stay retired`);
    }
    const manifest = JSON.parse(source('package.json'));
    assert.equal(manifest.scripts?.['benchmark:icd-resolver'], undefined);
});

test('current setup documents the server-only WHO boundary and honest readiness', () => {
    const setup = source('docs/icd-who-setup.md');
    assert.match(setup, /MEDIFLOW_ICD_WHO_ENABLED/u);
    assert.match(setup, /MEDIFLOW_ICD_WHO_CLIENT_SECRET/u);
    assert.match(setup, /configured` non equivale a `available/u);
    assert.match(setup, /server-only/u);
    assert.match(setup, /Non esiste fallback a\s+ICD-9/iu);
    assert.doesNotMatch(setup, /docker run|127\.0\.0\.1:8888/iu);

    const index = source('docs/markdown-index.md');
    assert.match(index, /docs\/icd-who-setup\.md/u);
    assert.doesNotMatch(index, /docs\/icd-local-setup\.md/u);
});
