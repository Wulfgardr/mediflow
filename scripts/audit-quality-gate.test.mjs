/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

import { validateAuditWriterControlFlow } from './audit-quality-gate.mjs';

const EVENT = 'record.changed';
const base = {
    fileName: 'synthetic-service.ts',
    ownerName: 'performWrite',
    writerModule: 'audit-kit',
    writerExport: 'writeAudit',
    eventType: EVENT,
};
const makeSource = (body, alias = 'writeAudit', parameters = 'condition = false, dependencies = {}') =>
    `import { writeAudit as ${alias} } from 'audit-kit';
    export async function performWrite(${parameters}) { ${body} }`;
const call = (name = 'writeAudit', event = EVENT, prefix = '') =>
    `${prefix}await ${name}({ eventType: '${event}' });`;
const validate = (body, options = {}) => {
    const source = makeSource(body, options.alias, options.parameters);
    assert.equal(ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).parseDiagnostics.length, 0);
    return validateAuditWriterControlFlow({ ...base, source, ...options.config });
};

test('accepts parse-valid direct, alias, fallback, conditional, and current-service shapes', () => {
    const positives = [
        [call()],
        [call('record'), { alias: 'record' }],
        [call('(dependencies.writeAuditEvent ?? record)'), {
            alias: 'record',
            config: { dependencyFallback: { parameter: 'dependencies', property: 'writeAuditEvent' } },
        }],
        [`if (condition) return; ${call()}`],
        [`if (!condition) return; try { ${call('record', EVENT, 'const marker = 1; ')} } catch (error) { console.error(error); }`, { alias: 'record' }],
        [`if (!condition) return; ${call('record', EVENT, 'await step(); ')}`, {
            alias: 'record',
            config: { writerArgumentIndex: 2 },
            parameters: 'condition = true',
        }],
    ];
    positives[5][0] = `if (!condition) return; await record({}, {}, { eventType: '${EVENT}' });`;
    for (const [body, options] of positives) assert.deepEqual(validate(body, options), []);
});

test('rejects parse-valid unreachable, nested, shadowed, duplicate, and wrong-event mutations', () => {
    const negatives = [
        `return; ${call()}`,
        `throw new Error('stop'); ${call()}`,
        `if (true) return; ${call()}`,
        `if (condition) return; else throw new Error('stop'); ${call()}`,
        `false && writeAudit({ eventType: '${EVENT}' });`,
        `queue.map(() => writeAudit({ eventType: '${EVENT}' }));`,
        `async function later() { ${call()} } return;`,
        `const writeAudit = async () => {}; ${call()}`,
        `${call()} ${call()} async function later() { ${call()} }`,
        `await writeAudit({ eventType: '${EVENT}', ...{ eventType: 'record.wrong' } });`,
        `await writeAudit({ ...{ eventType: 'record.wrong' }, eventType: '${EVENT}' });`,
        `await writeAudit({ eventType: '${EVENT}', eventType: '${EVENT}' });`,
        `await writeAudit({ ['eventType']: '${EVENT}' });`,
        call('writeAudit', 'record.wrong'),
    ];
    for (const body of negatives) assert.notDeepEqual(validate(body), [], body);
    assert.notDeepEqual(validateAuditWriterControlFlow({
        ...base, source: `export async function performWrite() { ${call()} }`,
    }), []);
});

test('main checks the four real writer contracts and rejects a mutated service', () => {
    const root = process.cwd();
    const gatePath = path.join(root, 'scripts/audit-quality-gate.mjs');
    const gateSource = fs.readFileSync(gatePath, 'utf8');
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-wiring-'));
    const requiredFiles = [
        ...gateSource.matchAll(/\broute:\s*'([^']+)'/g).map((match) => match[1]),
        'lib/security/audit-db.ts',
        'lib/security/audit.ts',
        'lib/siss-audit.ts',
        'lib/security/pin-change-service.ts',
        'lib/prosthetic-prescription-write.ts',
    ];

    try {
        for (const relativePath of new Set(requiredFiles)) {
            const destination = path.join(fixtureRoot, relativePath);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(path.join(root, relativePath), destination);
        }
        const cleanResult = spawnSync(process.execPath, [gatePath, '--out', 'tmp/g3a-wiring-clean.json'], { cwd: fixtureRoot });
        const cleanReport = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'tmp/g3a-wiring-clean.json'), 'utf8'));
        assert.equal(cleanResult.status, 1);
        assert.equal(cleanReport.findings.length, 7);
        assert.equal(cleanReport.findings.filter((finding) => finding.code === 'AUDIT_CONTROL_FLOW').length, 0); assert.equal(cleanReport.findings.some((finding) => 'writerContracts' in finding), false);
        assert.deepEqual([cleanReport.checked.auditControlFlowTargets, cleanReport.checked.auditControlFlowFiles], [4, 2]);

        const pinService = path.join(fixtureRoot, 'lib/security/pin-change-service.ts');
        const original = fs.readFileSync(pinService, 'utf8');
        const mutated = original.replace(
            "eventType: 'settings.updated'",
            "eventType: 'auth.logout'",
        );
        assert.notEqual(mutated, original);
        fs.writeFileSync(pinService, mutated);
        const config = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, 'tsconfig.typecheck.json'), ts.sys.readFile).config, ts.sys, root);
        const compileMutation = (auditSource = fs.readFileSync(path.join(root, 'lib/security/audit.ts'), 'utf8')) => { const host = ts.createCompilerHost(config.options); const readFile = host.readFile; host.readFile = (file) => path.resolve(file) === path.join(root, 'lib/security/pin-change-service.ts') ? mutated : path.resolve(file) === path.join(root, 'lib/security/audit.ts') ? auditSource : readFile(file); return ts.getPreEmitDiagnostics(ts.createProgram(config.fileNames, config.options, host)).filter((diagnostic) => diagnostic.file && path.resolve(diagnostic.file.fileName) === path.join(root, 'lib/security/pin-change-service.ts')); };
        assert.deepEqual(compileMutation(), []);
        assert.notDeepEqual(compileMutation(fs.readFileSync(path.join(root, 'lib/security/audit.ts'), 'utf8').replace("    'auth.logout',", "    // 'auth.logout',")), []);

        const result = spawnSync(process.execPath, [gatePath, '--out', 'tmp/g3a-wiring-test.json'], {
            cwd: fixtureRoot,
            encoding: 'utf8',
        });
        assert.equal(result.status, 1);
        const report = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'tmp/g3a-wiring-test.json'), 'utf8'));
        assert.equal(report.checked.auditControlFlowTargets, 4);
        assert.equal(report.checked.auditControlFlowFiles, 2);
        assert.deepEqual(
            report.findings.filter((finding) => finding.code === 'AUDIT_CONTROL_FLOW'),
            [{
                code: 'AUDIT_CONTROL_FLOW',
                message: 'writer event literal is missing or incorrect',
                route: 'app/api/auth/change-pin/route.ts',
                target: 'change-pin',
                owner: 'changePin',
                eventType: 'settings.updated',
            }],
        );
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
});
