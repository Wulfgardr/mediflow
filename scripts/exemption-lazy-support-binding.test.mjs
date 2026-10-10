import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { collectExemptionLazySupportBinding } from './exemption-lazy-support-binding.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const importer = 'lib/aifa-update-guide-route.test.ts';
const support = 'scripts/fixtures/exemption-import-session.ts';
const original = fs.readFileSync(path.join(root, importer), 'utf8');
const lazy = "const { syntheticExemptionSession } = await import('../scripts/fixtures/exemption-import-session.ts');";
function fixture(t, source = original) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-lazy-binding-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.mkdirSync(path.join(directory, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'scripts/fixtures'), { recursive: true });
    fs.writeFileSync(path.join(directory, importer), source);
    // The adapter must never execute the support file.
    fs.writeFileSync(path.join(directory, support), 'throw new Error("must not execute fixture");');
    return directory;
}
test('real exemption support edge is lazy after isolated SQLite bootstrap', () => {
    const binding = collectExemptionLazySupportBinding(root);
    assert.equal(binding.importer, importer);
    assert.equal(binding.support, support);
    assert.equal(binding.owner, '@Wulfgardr');
    assert.ok(binding.reason);
    assert.deepEqual(binding.errors, []);
});
test('unrelated test body, title and comments do not invalidate the lazy edge', t => {
    const source = original.replace('actual route + guide: abort preserves the catalog', 'another descriptive test title')
        .replace('const session = syntheticExemptionSession();', 'const session = syntheticExemptionSession();\n    assert.ok(session);')
        .replace(lazy, `/* lazy fixture comment */\n    ${lazy}`);
    assert.deepEqual(collectExemptionLazySupportBinding(fixture(t, source)).errors, []);
});
test('removed, hoisted, redirected, conditional and textual pseudo-imports fail closed', t => {
    const cases = [
        original.replace(lazy, ''),
        `import { syntheticExemptionSession } from '../scripts/fixtures/exemption-import-session.ts';\n${original.replace(lazy, '')}`,
        original.replace(lazy, lazy.replace('exemption-import-session.ts', 'different-session.ts')),
        original.replace(lazy, `if (false) { ${lazy} }`),
        original.replace(lazy, `// ${lazy}`),
        original.replace(lazy, `const description = ${JSON.stringify(lazy)};`),
        original.replace(lazy, '').replace("const { dbServer } = await import('./db-server.ts');", `${lazy}\n    const { dbServer } = await import('./db-server.ts');`),
        original.replace("new Database(path.join(directory, 'medical.db')).close();", ''),
        original.replace('process.env.MEDIFLOW_DATA_DIR = directory;', ''),
        original.replace(lazy, `return;\n    ${lazy}`),
        original.replace(lazy, `process.env.MEDIFLOW_DATA_DIR = 'another-directory';\n    ${lazy}`),
        original.replace('{ timeout: 15_000 }', '{ timeout: 15_000, skip: true }'),
    ];
    for (const [index, source] of cases.entries()) {
        assert.notDeepEqual(source, original, `mutation ${index} applies`);
        assert.notDeepEqual(collectExemptionLazySupportBinding(fixture(t, source)).errors, [], `mutation ${index}`);
    }
});
test('missing importer or renamed support rejects binding', t => {
    const directory = fixture(t);
    fs.renameSync(path.join(directory, support), path.join(directory, `${support}.renamed`));
    assert.match(collectExemptionLazySupportBinding(directory).errors.join('\n'), /support missing/);
    fs.rmSync(path.join(directory, importer));
    assert.match(collectExemptionLazySupportBinding(directory).errors.join('\n'), /importer missing/);
});
