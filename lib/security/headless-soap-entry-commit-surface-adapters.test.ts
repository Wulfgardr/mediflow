/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-entry-commit-surface-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});

const production = await import('./headless-soap-entry-commit-production.ts');
const adapters = await import('./headless-soap-entry-commit-surface-adapters.ts');

const loaderInteropExports = new Set(['__esModule', 'default', ['module', 'exports'].join('.')]);
const publicKeys = (value: object) => Object.keys(value).filter((key) => !loaderInteropExports.has(key));

test('exposes closed Web and chat aliases to the one frozen H7 service', () => {
    assert.deepEqual(publicKeys(adapters), [
        'headlessSoapEntryCommitChatAdapter',
        'headlessSoapEntryCommitWebAdapter',
    ]);
    assert.equal(adapters.headlessSoapEntryCommitWebAdapter,
        production.headlessSoapEntryCommitService);
    assert.equal(adapters.headlessSoapEntryCommitChatAdapter,
        production.headlessSoapEntryCommitService);
    assert.equal(adapters.headlessSoapEntryCommitWebAdapter,
        adapters.headlessSoapEntryCommitChatAdapter);
    assert.equal(Object.isFrozen(adapters.headlessSoapEntryCommitWebAdapter), true);
    assert.deepEqual(Reflect.ownKeys(adapters.headlessSoapEntryCommitWebAdapter), ['execute']);
    assert.equal(adapters.headlessSoapEntryCommitWebAdapter.execute.length, 1);
});

test('preserves malformed-envelope denial without adding surface authority', async () => {
    const malformed = Object.freeze(Object.create(null));
    for (const adapter of [
        adapters.headlessSoapEntryCommitWebAdapter,
        adapters.headlessSoapEntryCommitChatAdapter,
    ]) {
        await assert.rejects(adapter.execute(malformed),
            (error: unknown) => (error as { code?: unknown }).code === 'envelope_unavailable');
    }
});

test('imports only the production facade and creates no wrapper or transport', () => {
    const source = fs.readFileSync(
        new URL('./headless-soap-entry-commit-surface-adapters.ts', import.meta.url), 'utf8',
    );
    const imports = [...source.matchAll(
        /^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu,
    )].map((match) => match[1] ?? match[2]).sort();

    assert.deepEqual(imports, [
        'server-only', './headless-soap-entry-commit-production',
    ].sort());
    assert.doesNotMatch(source,
        /\b(?:async|function|class|new|create|route|transport|mini|fabric|controller|owner|registry|provider|venue|egress)\b/iu);
    assert.doesNotMatch(source,
        /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
