import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('separate route module evaluations share only the production command owner', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'mediflow-ambulatory-route-owner-'));
    try {
        const sourcePath = path.resolve('lib/security/ambulatory-destructive-service.ts');
        const load = createRequire(sourcePath);
        const source = readFileSync(sourcePath, 'utf8').replace(/from (['"])([^'"]+)\1/gu, (match, _quote, specifier: string) => {
            if (specifier.startsWith('node:')) return match;
            const target = specifier.startsWith('.')
                ? `${path.resolve(path.dirname(sourcePath), specifier)}.ts`
                : load.resolve(specifier);
            return `from ${JSON.stringify(pathToFileURL(target).href)}`;
        }) + '\nexport const moduleEvaluationUrl = import.meta.url;\n';
        const modules = ['begin.mts', 'preview.mts'].map(name => path.join(directory, name));
        for (const file of modules) writeFileSync(file, source);
        const program = `
            const first = await import(${JSON.stringify(pathToFileURL(modules[0]).href)});
            const second = await import(${JSON.stringify(pathToFileURL(modules[1]).href)});
            const observation = {
                separateEvaluations: first.moduleEvaluationUrl !== second.moduleEvaluationUrl,
                sharedProductionOwner: first.ambulatoryDestructiveService === second.ambulatoryDestructiveService,
                explicitFactoriesIsolated: first.createAmbulatoryDestructiveService() !== second.createAmbulatoryDestructiveService(),
                methods: Object.keys(first.ambulatoryDestructiveService).sort(),
            };
            process.stdout.write(JSON.stringify(observation));
        `;
        const child = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', '--input-type=module', '-e', program], {
            cwd: process.cwd(), env: { ...process.env, MEDIFLOW_DATA_DIR: path.join(directory, 'data'), MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' },
            encoding: 'utf8', timeout: 30_000,
        });
        assert.equal(child.status, 0, child.stderr);
        assert.deepEqual(JSON.parse(child.stdout), {
            separateEvaluations: true, sharedProductionOwner: true, explicitFactoriesIsolated: true,
            methods: ['begin', 'execute', 'preview', 'recover', 'retire'],
        });
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
