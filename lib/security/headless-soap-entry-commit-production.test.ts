/* @Codex */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-soap-entry-commit-production-'));
process.env.MEDIFLOW_DATA_DIR = dataDir;
execFileSync(process.execPath, ['scripts/prepare-e2e-db.mjs'], {
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir },
});

const internal = await import('./headless-soap-entry-commit-production-internal.ts');
const facade = await import('./headless-soap-entry-commit-production.ts');

const loaderInteropExports = new Set(['__esModule', 'default', ['module', 'exports'].join('.')]);
const publicKeys = (value: object) => Object.keys(value).filter((key) => !loaderInteropExports.has(key));

test('shares one H7 application service while exposing only its frozen execute facade', async () => {
    const repeated = await import('./headless-soap-entry-commit-production-internal.ts');
    assert.deepEqual(publicKeys(internal), ['headlessSoapEntryCommitProductionService']);
    assert.deepEqual(publicKeys(facade), ['headlessSoapEntryCommitService']);
    assert.equal(internal.headlessSoapEntryCommitProductionService,
        repeated.headlessSoapEntryCommitProductionService);
    assert.equal(facade.headlessSoapEntryCommitService,
        internal.headlessSoapEntryCommitProductionService);
    assert.equal(Object.isFrozen(facade.headlessSoapEntryCommitService), true);
    assert.deepEqual(Reflect.ownKeys(facade.headlessSoapEntryCommitService), ['execute']);
    assert.equal(facade.headlessSoapEntryCommitService.execute.length, 1);
});

test('keeps malformed envelopes inert at the public production seam', async () => {
    const malformed = Object.freeze(Object.create(null));
    await assert.rejects(facade.headlessSoapEntryCommitService.execute(malformed),
        (error: unknown) => (error as { code?: unknown }).code === 'envelope_unavailable');
    assert.equal('approvalController' in facade, false);
    assert.equal('selectionCommitBindingController' in facade, false);
    assert.equal('commitOwner' in facade, false);
});

test('internal root creates one SQLite owner and one H7 application service with private controllers', () => {
    const internalSource = fs.readFileSync(
        new URL('./headless-soap-entry-commit-production-internal.ts', import.meta.url), 'utf8',
    );
    const facadeSource = fs.readFileSync(
        new URL('./headless-soap-entry-commit-production.ts', import.meta.url), 'utf8',
    );
    const importsOf = (source: string) => [...source.matchAll(
        /^import\s+(?:['"]([^'"]+)['"]|[\s\S]*?\s+from\s+['"]([^'"]+)['"])\s*;/gmu,
    )].map((match) => match[1] ?? match[2]).sort();

    assert.deepEqual(importsOf(internalSource), [
        'server-only',
        './headless-soap-command-binding-production-internal',
        './headless-soap-entry-commit-application-service',
        './headless-soap-entry-commit-owner',
        './server-session-projection-owner-production-internal',
    ].sort());
    assert.deepEqual(importsOf(facadeSource), [
        'server-only', './headless-soap-entry-commit-production-internal',
    ].sort());
    assert.equal(internalSource.match(/\bcreateHeadlessSoapEntryCommitOwner\s*\(/gu)?.length, 1);
    assert.equal(internalSource.match(/\bcreateHeadlessSoapEntryCommitApplicationService\s*\(/gu)?.length, 1);
    assert.match(internalSource,
        /approvalController\s*:\s*headlessSoapCommandBindingProductionOwner\.approvalController/u);
    assert.match(internalSource,
        /selectionController\s*:\s*serverSessionProjectionOwnerProductionOwner\.selectionCommitBindingController/u);
    assert.match(internalSource, /commitOwner\s*:\s*headlessSoapEntryCommitOwner/u);
    assert.doesNotMatch(internalSource, /^export\s+const\s+\w*(?:Owner|Controller|Registry|Port)\b/gmu);
    assert.doesNotMatch(internalSource, /db-server|schema|route|fabric|provider|venue|egress/iu);
    assert.doesNotMatch(facadeSource,
        /approvalController|selectionCommitBindingController|commitOwner|createHeadless|db-server|schema/iu);
    for (const source of [internalSource, facadeSource]) {
        assert.doesNotMatch(source,
            /\b(?:import\s*\(|require\s*\()|^\s*export\s+(?:default|\{|\*)|['"]use client['"]|\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|NextResponse|NextRequest|JSX|React)\b/gmu);
    }
});

after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
