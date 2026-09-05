/* @Codex */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const providerSource = readFileSync(new URL('./security-provider.tsx', import.meta.url), 'utf8');

function typeScriptSources(directory: string): string[] {
    const ignoredDirectories = new Set(['.git', '.next', 'coverage', 'node_modules']);
    const sources: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) sources.push(...typeScriptSources(resolve(directory, entry.name)));
        } else if (/\.(?:ts|tsx)$/u.test(entry.name) && !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)) {
            sources.push(resolve(directory, entry.name));
        }
    }
    return sources;
}

test('SecurityProvider owns one closure-bound H4 seal service without caller authority parameters', () => {
    const providerStart = providerSource.indexOf('export function SecurityProvider(');
    const providerEnd = providerSource.indexOf('\nexport function useSecurity', providerStart);
    assert.ok(providerStart >= 0 && providerEnd > providerStart);
    const providerScope = providerSource.slice(providerStart, providerEnd);

    assert.equal(providerSource.match(/createClinicianSoapEntrySealOwner\s*\(\s*\{/gu)?.length, 1);
    assert.match(providerScope, /const clinicianSoapEntrySealOwnerRef = useRef<ClinicianSoapEntrySealOwner \| null>\(null\);/u);

    const authorityClosure = providerScope.match(
        /readAuthority:\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\n\s*crypto:/u,
    );
    assert.ok(authorityClosure);
    assert.equal(authorityClosure[1]!.replace(/\s+/gu, ' ').trim(), [
        'const key = masterKeyRef.current;',
        'return key ? { key, generation: authorityAttemptGenerationRef.current } : null;',
    ].join(' '));

    assert.match(providerScope,
        /const sealClinicianSoapEntry = \(fieldSet: ClinicianSoapEntryFieldSetV1\) =>\s*clinicianSoapEntrySealOwnerRef\.current!\.seal\(fieldSet\);/u);
    assert.match(providerScope,
        /const reopenClinicianSoapEntry = \(\s*bundle: ClinicianSoapEntrySealV1,\s*expectedFieldSet: ClinicianSoapEntryFieldSetV1,\s*\) => clinicianSoapEntrySealOwnerRef\.current!\.reopen\(bundle, expectedFieldSet\);/u);
});

test('the H4 codec internal is restricted to the exact H4-H7 verification owners', () => {
    const importPattern = /(?:from\s+|import\s*\()['"][^'"]*clinician-soap-entry-seal-codec-internal(?:\.ts)?['"]/u;
    const importers = typeScriptSources(repositoryRoot)
        .filter((path) => importPattern.test(readFileSync(path, 'utf8')))
        .map((path) => relative(repositoryRoot, path));

    /* @Codex Later SOAP gates must parse and verify the H4 seal server-side.
       Keep that privileged surface explicit instead of reviving the stale H4-only
       assumption or allowing a broad import pattern. */
    assert.deepEqual(importers, [
        'lib/headless/clinician-soap-entry-seal.ts',
        'lib/security/headless-soap-command-binding-lifecycle.ts',
        'lib/security/headless-soap-command-binding-test-fixture.ts',
        'lib/security/headless-soap-entry-commit-owner.ts',
        'lib/security/headless-soap-entry-commit-semantic-validator.ts',
        'lib/security/headless-soap-entry-seal-binding.ts',
    ]);
});

test('only SecurityProvider composes the H4 seal owner outside tests', () => {
    /* @Codex Type-only consumers carry the public seal contract through H5-H7;
       authority composition remains a single concrete factory call. */
    const factoryCallPattern = /createClinicianSoapEntrySealOwner\s*\(\s*\{/u;
    const composers = typeScriptSources(repositoryRoot)
        .filter((path) => factoryCallPattern.test(readFileSync(path, 'utf8')))
        .map((path) => relative(repositoryRoot, path));

    assert.deepEqual(composers, ['components/security-provider.tsx']);
});
