/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

import { validateAuditWriterControlFlow, validateDelegatedRouteAudit, validateLogoutAuditModes,
    validateRequiredPatientUpdateAudit, validateRequiredPatientDeleteAudit, validateRequiredDiaryAudit, validateRequiredTherapyAudit, validateRequiredObservationAudit, validateRequiredCheckupAudit } from './audit-quality-gate.mjs';

const EVENT = 'record.changed';

/* @Codex: real eight-handler roster plus parse-valid negative wiring/order mutations. */
test('diary required-audit guard follows all eight handlers and rejects detached or bypassed audit', () => {
    const read = (file) => fs.readFileSync(file, 'utf8');
    const coreSource = read('lib/entry-write-operation.ts');
    const bridgeSource = read('lib/network-entry-write.ts');
    const rows = [
        ['app/api/entries/route.ts', 'POST', 'web', 'create'],
        ['app/api/entries/[id]/route.ts', 'PUT', 'web', 'update'],
        ['app/api/entries/[id]/route.ts', 'DELETE', 'web', 'update'],
        ['app/api/v1/patients/[id]/entries/route.ts', 'POST', 'v1', 'create'],
        ['app/api/v1/patients/[id]/entries/[entryId]/route.ts', 'PUT', 'v1', 'update'],
        ['app/api/v1/patients/[id]/entries/[entryId]/route.ts', 'DELETE', 'v1', 'update'],
        ['app/api/v1/network/patients/[id]/entries/route.ts', 'POST', 'network', 'create'],
        ['app/api/v1/network/patients/[id]/entries/[entryId]/route.ts', 'PUT', 'network', 'update'],
    ];
    for (const [file, handler, mode, operation] of rows) {
        const spec = { handler, mode, operation, ownerFile: 'lib/entry-write-operation.ts',
            ownerName: `${operation}EntryOperation`, serviceExport: `${operation}EntryOperation`,
            serviceModule: '@/lib/entry-write-operation', bridgeExport: `${operation}NetworkScopedEntry` };
        const original = { spec, routeSource: read(file), coreSource, bridgeSource };
        const validate = (patch = {}) => validateRequiredDiaryAudit({ ...original, ...patch });
        assert.deepEqual(validate(), [], `${mode} ${handler}`);
        const change = (source, before, after) => {
            assert.ok(source.includes(before), before);
            const mutated = source.replaceAll(before, after);
            assert.equal(ts.createSourceFile('mutant.ts', mutated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
                .parseDiagnostics.length, 0);
            return mutated;
        };
        for (const [before, after] of [
            ["behavior: 'immediate'", "behavior: 'deferred'"],
            ['transaction((tx)', 'transaction(async (tx)'],
            ['writeAuditEventInTransaction(tx, {', 'writeAuditEventInTransaction(dbServer, {'],
            ['writeAuditEventInTransaction(tx, {', 'if (input.audit.actorRef) writeAuditEventInTransaction(tx, {'],
            ['writeAuditEventInTransaction(tx, {', 'return { status: 200, value: {} }; writeAuditEventInTransaction(tx, {'],
            ['changes !== 1', 'changes < 0'],
            ["subjectType: 'entry'", "subjectType: 'patient'"],
            ["eventType: 'entry.created'", "eventType: 'entry.updated'"],
            ["? 'entry.deleted' : 'entry.updated'", "? 'entry.updated' : 'entry.deleted'"],
        ]) {
            if ((before.includes('entry.created') && operation !== 'create')
                || (before.startsWith('?') && operation !== 'update')) continue;
            assert.notDeepEqual(validate({ coreSource: change(coreSource, before, after) }), [],
                `${mode} ${handler}: ${before}`);
        }
        const sourceKey = mode === 'network' ? 'bridgeSource' : 'routeSource';
        if (operation === 'create') {
            assert.notDeepEqual(validate({ coreSource: change(coreSource,
                'const inserted = tx.insert(entries).values(input.values).run();',
                'const inserted = ({ run: () => ({ changes: 1 }), pending: () => tx.insert(entries).values(input.values).run() }).run();') }), []);
        }
        const source = original[sourceKey];
        assert.notDeepEqual(validate({ [sourceKey]: change(source, `mode: '${mode}'`, "mode: 'unadmitted'") }), []);
        const callee = mode === 'network' ? spec.bridgeExport : spec.ownerName;
        assert.notDeepEqual(validate({ routeSource: change(original.routeSource,
            `${callee}(`, `unapprovedDiaryWrite(`) }), []);
        if (mode === 'network') assert.notDeepEqual(validate({ bridgeSource: change(bridgeSource,
            `${spec.ownerName}(`, 'unapprovedDiaryWrite(') }), []);
    }
});

/* @Codex: each therapy operation has independent wiring and negative assertions. */
test('therapy required-audit guard follows all eight handlers and rejects detached or bypassed audit', () => {
    const read = (file) => fs.readFileSync(file, 'utf8');
    const coreSource = read('lib/therapy-write-operation.ts');
    const bridgeSource = read('lib/network-therapy-write.ts');
    const rows = [
        ['app/api/therapies/route.ts', 'POST', 'web', 'create'],
        ['app/api/therapies/[id]/route.ts', 'PUT', 'web', 'update'],
        ['app/api/therapies/[id]/route.ts', 'DELETE', 'web', 'update'],
        ['app/api/v1/patients/[id]/therapies/route.ts', 'POST', 'v1', 'create'],
        ['app/api/v1/patients/[id]/therapies/[therapyId]/route.ts', 'PUT', 'v1', 'update'],
        ['app/api/v1/patients/[id]/therapies/[therapyId]/route.ts', 'DELETE', 'v1', 'update'],
        ['app/api/v1/network/patients/[id]/therapies/route.ts', 'POST', 'network', 'create'],
        ['app/api/v1/network/patients/[id]/therapies/[therapyId]/route.ts', 'PUT', 'network', 'update'],
    ];
    for (const [file, handler, mode, operation] of rows) {
        const spec = { handler, mode, operation, ownerFile: 'lib/therapy-write-operation.ts',
            ownerName: `${operation}TherapyOperation`, serviceExport: `${operation}TherapyOperation`,
            serviceModule: '@/lib/therapy-write-operation', bridgeExport: `${operation}NetworkScopedTherapy` };
        const original = { spec, routeSource: read(file), coreSource, bridgeSource };
        const validate = (patch = {}) => validateRequiredTherapyAudit({ ...original, ...patch });
        assert.deepEqual(validate(), [], `${mode} ${handler}`);
        const change = (source, before, after) => {
            assert.ok(source.includes(before), before);
            const mutated = source.replaceAll(before, after);
            assert.equal(ts.createSourceFile('mutant.ts', mutated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
                .parseDiagnostics.length, 0);
            return mutated;
        };
        for (const [before, after] of [
            ["behavior: 'immediate'", "behavior: 'deferred'"],
            ['transaction((tx)', 'transaction(async (tx)'],
            ['writeAuditEventInTransaction(tx, {', 'writeAuditEventInTransaction(dbServer, {'],
            ['writeAuditEventInTransaction(tx, {', 'if (input.audit.actorRef) writeAuditEventInTransaction(tx, {'],
            ['writeAuditEventInTransaction(tx, {', 'return { status: 200, value: {} }; writeAuditEventInTransaction(tx, {'],
            ['changes !== 1', 'changes < 0'],
            ["subjectType: 'therapy'", "subjectType: 'patient'"],
            ["eventType: 'therapy.created'", "eventType: 'therapy.updated'"],
            ["? 'therapy.deleted' : 'therapy.updated'", "? 'therapy.updated' : 'therapy.deleted'"],
        ]) {
            if ((before.includes('therapy.created') && operation !== 'create')
                || (before.startsWith('?') && operation !== 'update')) continue;
            assert.notDeepEqual(validate({ coreSource: change(coreSource, before, after) }), [],
                `${mode} ${handler}: ${before}`);
        }
        const sourceKey = mode === 'network' ? 'bridgeSource' : 'routeSource';
        if (operation === 'create') {
            assert.notDeepEqual(validate({ coreSource: change(coreSource,
                'const inserted = tx.insert(therapies).values(input.values).run();',
                'const inserted = ({ run: () => ({ changes: 1 }), pending: () => tx.insert(therapies).values(input.values).run() }).run();') }), []);
        }
        const source = original[sourceKey];
        assert.notDeepEqual(validate({ [sourceKey]: change(source, `mode: '${mode}'`, "mode: 'unadmitted'") }), []);
        const callee = mode === 'network' ? spec.bridgeExport : spec.ownerName;
        assert.notDeepEqual(validate({ routeSource: change(original.routeSource,
            `${callee}(`, `unapprovedTherapyWrite(`) }), []);
        if (mode === 'network') assert.notDeepEqual(validate({ bridgeSource: change(bridgeSource,
            `${spec.ownerName}(`, 'unapprovedTherapyWrite(') }), []);
    }
});

/* @Codex: each observation operation has independent wiring and negative assertions. */
test('observation required-audit guard follows all eight handlers and rejects detached or bypassed audit', () => {
    const read = (file) => fs.readFileSync(file, 'utf8');
    const coreSource = read('lib/observation-write-operation.ts');
    const bridgeSource = read('lib/network-observation-write.ts');
    const rows = [
        ['app/api/observations/route.ts', 'POST', 'web', 'create'],
        ['app/api/observations/[id]/route.ts', 'PUT', 'web', 'update'],
        ['app/api/observations/[id]/route.ts', 'DELETE', 'web', 'update'],
        ['app/api/v1/patients/[id]/observations/route.ts', 'POST', 'v1', 'create'],
        ['app/api/v1/patients/[id]/observations/[observationId]/route.ts', 'PUT', 'v1', 'update'],
        ['app/api/v1/patients/[id]/observations/[observationId]/route.ts', 'DELETE', 'v1', 'update'],
        ['app/api/v1/network/patients/[id]/observations/route.ts', 'POST', 'network', 'create'],
        ['app/api/v1/network/patients/[id]/observations/[observationId]/route.ts', 'PUT', 'network', 'update'],
    ];
    for (const [file, handler, mode, operation] of rows) {
        const spec = { handler, mode, operation, ownerFile: 'lib/observation-write-operation.ts',
            ownerName: `${operation}ObservationOperation`, serviceExport: `${operation}ObservationOperation`,
            serviceModule: '@/lib/observation-write-operation', bridgeExport: `${operation}NetworkScopedObservation` };
        const original = { spec, routeSource: read(file), coreSource, bridgeSource };
        const validate = (patch = {}) => validateRequiredObservationAudit({ ...original, ...patch });
        assert.deepEqual(validate(), [], `${mode} ${handler}`);
        const change = (source, before, after) => {
            assert.ok(source.includes(before), before);
            const mutated = source.replaceAll(before, after);
            assert.equal(ts.createSourceFile('mutant.ts', mutated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
                .parseDiagnostics.length, 0);
            return mutated;
        };
        for (const [before, after] of [
            ["behavior: 'immediate'", "behavior: 'deferred'"],
            ['transaction((tx)', 'transaction(async (tx)'],
            ['writeAuditEventInTransaction(tx, {', 'writeAuditEventInTransaction(dbServer, {'],
            ['writeAuditEventInTransaction(tx, {', 'if (input.audit.actorRef) writeAuditEventInTransaction(tx, {'],
            ['writeAuditEventInTransaction(tx, {', 'return { status: 200, value: {} }; writeAuditEventInTransaction(tx, {'],
            ['changes !== 1', 'changes < 0'],
            ["subjectType: 'observation'", "subjectType: 'patient'"],
            ["eventType: 'observation.created'", "eventType: 'observation.updated'"],
            ["? 'observation.deleted' : 'observation.updated'", "? 'observation.updated' : 'observation.deleted'"],
        ]) {
            if ((before.includes('observation.created') && operation !== 'create')
                || (before.startsWith('?') && operation !== 'update')) continue;
            assert.notDeepEqual(validate({ coreSource: change(coreSource, before, after) }), [],
                `${mode} ${handler}: ${before}`);
        }
        const sourceKey = mode === 'network' ? 'bridgeSource' : 'routeSource';
        if (operation === 'create') {
            /* @Codex: mutate the actual insert, including its authoritative identity overrides. */
            const insert = coreSource.match(/const inserted = (tx\.insert\(observations\)[\s\S]*?\.run\(\));/);
            assert.ok(insert, 'observation create must expose the real insert statement');
            assert.notDeepEqual(validate({ coreSource: change(coreSource, insert[0],
                `const inserted = ({ run: () => ({ changes: 1 }), pending: () => ${insert[1]} }).run();`) }), []);
        }
        const source = original[sourceKey];
        assert.notDeepEqual(validate({ [sourceKey]: change(source, `mode: '${mode}'`, "mode: 'unadmitted'") }), []);
        const callee = mode === 'network' ? spec.bridgeExport : spec.ownerName;
        assert.notDeepEqual(validate({ routeSource: change(original.routeSource,
            `${callee}(`, `unapprovedObservationWrite(`) }), []);
        if (mode === 'network') assert.notDeepEqual(validate({ bridgeSource: change(bridgeSource,
            `${spec.ownerName}(`, 'unapprovedObservationWrite(') }), []);
    }
});
test('checkup required-audit guard follows all eight handlers and rejects detached or bypassed audit', () => {
    const read = (file) => fs.readFileSync(file, 'utf8');
    const coreSource = read('lib/checkup-write-operation.ts');
    const bridgeSource = read('lib/network-checkup-write.ts');
    const rows = [
        ['app/api/checkups/route.ts', 'POST', 'web', 'create'],
        ['app/api/checkups/[id]/route.ts', 'PUT', 'web', 'update'],
        ['app/api/checkups/[id]/route.ts', 'DELETE', 'web', 'update'],
        ['app/api/v1/patients/[id]/checkups/route.ts', 'POST', 'v1', 'create'],
        ['app/api/v1/patients/[id]/checkups/[checkupId]/route.ts', 'PUT', 'v1', 'update'],
        ['app/api/v1/patients/[id]/checkups/[checkupId]/route.ts', 'DELETE', 'v1', 'update'],
        ['app/api/v1/network/patients/[id]/checkups/route.ts', 'POST', 'network', 'create'],
        ['app/api/v1/network/patients/[id]/checkups/[checkupId]/route.ts', 'PUT', 'network', 'update'],
    ];
    for (const [file, handler, mode, operation] of rows) {
        const spec = { handler, mode, operation, ownerFile: 'lib/checkup-write-operation.ts',
            ownerName: `${operation}CheckupOperation`, serviceExport: `${operation}CheckupOperation`,
            serviceModule: '@/lib/checkup-write-operation', bridgeExport: `${operation}NetworkScopedCheckup` };
        const original = { spec, routeSource: read(file), coreSource, bridgeSource };
        const validate = (patch = {}) => validateRequiredCheckupAudit({ ...original, ...patch });
        assert.deepEqual(validate(), [], `${mode} ${handler}`);
        const change = (source, before, after) => {
            assert.ok(source.includes(before), before);
            const mutated = source.replaceAll(before, after);
            assert.equal(ts.createSourceFile('mutant.ts', mutated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
                .parseDiagnostics.length, 0);
            return mutated;
        };
        for (const [before, after] of [
            ["behavior: 'immediate'", "behavior: 'deferred'"],
            ['transaction((tx)', 'transaction(async (tx)'],
            ['writeAuditEventInTransaction(tx, {', 'writeAuditEventInTransaction(dbServer, {'],
            ['writeAuditEventInTransaction(tx, {', 'if (input.audit.actorRef) writeAuditEventInTransaction(tx, {'],
            ['writeAuditEventInTransaction(tx, {', 'return { status: 200, value: {} }; writeAuditEventInTransaction(tx, {'],
            ['changes !== 1', 'changes < 0'],
            ["subjectType: 'checkup'", "subjectType: 'patient'"],
            ["eventType: 'checkup.created'", "eventType: 'checkup.updated'"],
            ["? 'checkup.deleted' : 'checkup.updated'", "? 'checkup.updated' : 'checkup.deleted'"],
        ]) {
            if ((before.includes('checkup.created') && operation !== 'create')
                || (before.startsWith('?') && operation !== 'update')) continue;
            assert.notDeepEqual(validate({ coreSource: change(coreSource, before, after) }), [],
                `${mode} ${handler}: ${before}`);
        }
        const sourceKey = mode === 'network' ? 'bridgeSource' : 'routeSource';
        if (operation === 'create') {
            /* @Codex: mutate the actual insert, including its authoritative identity overrides. */
            const insert = coreSource.match(/const inserted = (tx\.insert\(checkups\)[\s\S]*?\.run\(\));/);
            assert.ok(insert, 'checkup create must expose the real insert statement');
            assert.notDeepEqual(validate({ coreSource: change(coreSource, insert[0],
                `const inserted = ({ run: () => ({ changes: 1 }), pending: () => ${insert[1]} }).run();`) }), []);
        }
        const source = original[sourceKey];
        assert.notDeepEqual(validate({ [sourceKey]: change(source, `mode: '${mode}'`, "mode: 'unadmitted'") }), []);
        const callee = mode === 'network' ? spec.bridgeExport : spec.ownerName;
        assert.notDeepEqual(validate({ routeSource: change(original.routeSource,
            `${callee}(`, `unapprovedCheckupWrite(`) }), []);
        if (mode === 'network') assert.notDeepEqual(validate({ bridgeSource: change(bridgeSource,
            `${spec.ownerName}(`, 'unapprovedCheckupWrite(') }), []);
    }
});

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
        [`try { await step(); } catch { throw new Error('stop'); } ${call()}`],
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
        `try { return; } catch { throw new Error('stop'); } ${call()}`,
        `try { return; } finally {} ${call()}`,
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
    const gatePath = fileURLToPath(new URL('./audit-quality-gate.mjs', import.meta.url));
    const gateSource = fs.readFileSync(gatePath, 'utf8');
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-wiring-'));
    const requiredFiles = [
        ...gateSource.matchAll(/\broute:\s*'([^']+)'/g).map((match) => match[1]),
        ...gateSource.matchAll(/\bownerFile:\s*'([^']+)'/g).map((match) => match[1]),
        ...gateSource.matchAll(/\bbridgeFile:\s*'([^']+)'/g).map((match) => match[1]),
        'lib/security/audit-db.ts',
        'lib/security/audit.ts',
        'lib/siss-audit.ts',
        'lib/security/pin-change-service.ts',
        'lib/prosthetic-prescription-write.ts',
    ];

    try {
        for (const relativePath of new Set(requiredFiles)) {
            if (!fs.existsSync(path.join(root, relativePath))) continue;
            const destination = path.join(fixtureRoot, relativePath);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(path.join(root, relativePath), destination);
        }
        const cleanResult = spawnSync(process.execPath, [gatePath, '--out', 'tmp/g3a-wiring-clean.json'], { cwd: fixtureRoot });
        const cleanReport = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'tmp/g3a-wiring-clean.json'), 'utf8'));
        assert.equal(cleanResult.status, 0);
        assert.equal(cleanReport.findings.length, 0);
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

const routeSource = (body) => `import { perform as delegate } from './service';
export async function POST(): Promise<void> { ${body} }`;
const serviceSource = (body = 'return;') => `
export async function perform(): Promise<void> { ${body} }
async function owner(a: unknown, b: unknown, surface: string): Promise<void> {
    void a; void b; void surface;
}`;
const delegatedSpec = (overrides = {}) => ({
    handler: 'POST',
    serviceModule: './service',
    serviceExport: 'perform',
    ownerName: 'perform',
    ...overrides,
});

function assertSemanticClean(route, service) {
    const sources = new Map([
        ['/fixture/route.ts', route],
        ['/fixture/service.ts', service],
    ]);
    const options = {
        strict: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
    };
    const host = ts.createCompilerHost(options);
    const fileExists = host.fileExists.bind(host);
    const readFile = host.readFile.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.fileExists = (file) => sources.has(file) || fileExists(file);
    host.directoryExists = (directory) => directory === '/fixture' || ts.sys.directoryExists(directory);
    host.readFile = (file) => sources.get(file) ?? readFile(file);
    host.getSourceFile = (file, language, onError, fresh) => sources.has(file)
        ? ts.createSourceFile(file, sources.get(file), language, true, ts.ScriptKind.TS)
        : getSourceFile(file, language, onError, fresh);
    const program = ts.createProgram([...sources.keys()], options, host);
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
}

function validateDelegation(route, service, spec = delegatedSpec()) {
    assertSemanticClean(route, service);
    return validateDelegatedRouteAudit({ spec, routeSource: route, serviceSource: service });
}

test('accepts TypeScript-valid aliases for route delegates and the configured update hop', () => {
    const route = routeSource('const alias = delegate; await alias();');
    const service = serviceSource("const alias = owner; await alias(null, null, 'host');");
    assert.deepEqual(validateDelegation(route, service), []);
    assert.deepEqual(validateDelegation(route, service, delegatedSpec({
        ownerName: 'owner',
        hop: { target: 'owner', argumentIndex: 2, literal: 'host' },
    })), []);
});

test('rejects TypeScript-valid route and hop false-green mutations', () => {
    const direct = routeSource('await delegate();');
    const service = serviceSource("await owner(null, null, 'host');");
    const hop = delegatedSpec({
        ownerName: 'owner',
        hop: { target: 'owner', argumentIndex: 2, literal: 'host' },
    });
    const mutations = [
        [routeSource("const text = 'delegate()'; void text;"), service, delegatedSpec()],
        [routeSource('const alias = delegate; await delegate(); await alias();'), service, delegatedSpec()],
        [routeSource('async function later() { await delegate(); } void later;'), service, delegatedSpec()],
        [direct, serviceSource("const alias = owner; await owner(null, null, 'host'); await alias(null, null, 'host');"), hop],
        [direct, serviceSource("async function later() { await owner(null, null, 'host'); } void later;"), hop],
        [direct, serviceSource("const alias = owner; await alias(null, null, 'network');"), hop],
    ];
    for (const [route, owner, spec] of mutations) {
        assert.notDeepEqual(validateDelegation(route, owner, spec), []);
    }
});

test('rejects mutable aliases and numerically unreachable delegated calls', () => {
    const direct = routeSource('await delegate();');
    const service = serviceSource("await owner(null, null, 'host');");
    const hop = delegatedSpec({
        ownerName: 'owner',
        hop: { target: 'owner', argumentIndex: 2, literal: 'host' },
    });
    const mutations = [
        ['route reassigned alias', routeSource(
            'const wrong = async (): Promise<void> => {}; let alias = delegate; alias = wrong; await alias();',
        ), service, delegatedSpec()],
        ['hop reassigned alias', direct, serviceSource(
            "const wrong = async (a: unknown, b: unknown, surface: string): Promise<void> => { void a; void b; void surface; }; let alias = owner; alias = wrong; await alias(null, null, 'host');",
        ), hop],
        ['route if zero', routeSource('if (0) await delegate();'), service, delegatedSpec()],
        ['hop if zero', direct, serviceSource("if (0) await owner(null, null, 'host');"), hop],
        ['route after certain return', routeSource('if (1) return; await delegate();'), service, delegatedSpec()],
        ['hop after certain return', direct, serviceSource("if (1) return; await owner(null, null, 'host');"), hop],
    ];
    const accepted = mutations.flatMap(([name, route, owner, spec]) =>
        validateDelegation(route, owner, spec).length === 0 ? [name] : []);
    assert.deepEqual(accepted, []);
    assert.deepEqual(validateDelegation(routeSource('if (1) await delegate();'), service), []);
    assert.deepEqual(validateDelegation(
        direct, serviceSource("if (0) return; await owner(null, null, 'host');"), hop,
    ), []);
});

const logoutSpec = {
    target: 'auth.logout',
    modes: {
        inline: {
            handler: 'POST',
            writerModule: '@/lib/security/audit',
            writerExport: 'writeAuditEvent',
            eventType: 'auth.logout',
        },
        delegated: {
            handler: 'POST',
            serviceModule: '@/lib/security/web-auth-logout-server',
            serviceExport: 'completeExactWebP3Logout',
            ownerFile: 'lib/security/web-auth-logout-server.ts',
            ownerName: 'completeExactWebP3Logout',
            writerModule: './audit',
            writerExport: 'writeAuditEvent',
            hashExport: 'hashAuditRef',
            ownerModule: './web-auth-lifecycle-owner-adapter',
            resolveExport: 'resolve',
            retireExport: 'retire',
            transportModule: './web-auth-control-transport',
            etagExport: 'strongWebAuthControlEtag',
            eventType: 'auth.logout',
            sourcesName: 'productionSources',
            receiptValidator: 'retirementReceipt',
        },
    },
};

const logoutRoutePath = path.join(process.cwd(), 'app/api/auth/logout/route.ts');
const logoutServicePath = path.join(process.cwd(), 'lib/security/web-auth-logout-server.ts');
const logoutRoute = fs.readFileSync(logoutRoutePath, 'utf8');
const logoutService = fs.readFileSync(logoutServicePath, 'utf8');

function replaceOnce(source, before, after) {
    assert.equal(source.includes(before), true, `fixture fragment missing: ${before}`);
    const mutated = source.replace(before, after);
    assert.notEqual(mutated, source);
    return mutated;
}

function swapOnce(source, first, second) {
    assert.equal(source.includes(first), true, `first fixture fragment missing: ${first}`);
    assert.equal(source.includes(second), true, `second fixture fragment missing: ${second}`);
    const marker = '/*__MEDIFLOW_AUDIT_SWAP__*/';
    assert.equal(source.includes(marker), false);
    return source.replace(first, marker).replace(second, first).replace(marker, second);
}

function assertParseClean(fileName, source) {
    const diagnostics = ts.createSourceFile(
        fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
    ).parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    assert.deepEqual(diagnostics, []);
}

function validateLogout(route, service) {
    assertParseClean('route.ts', route);
    assertParseClean('service.ts', service);
    return validateLogoutAuditModes({ spec: logoutSpec, routeSource: route, serviceSource: service });
}

function assertLogoutMutationsRejected(mutations) {
    for (const [name, route, service] of mutations) {
        let findings;
        assert.doesNotThrow(() => { findings = validateLogout(route, service); }, name);
        assert.notDeepEqual(findings, [], name);
    }
}

test('accepts the final package-owner delegated terminal logout', () => {
    assert.deepEqual(validateLogout(logoutRoute, logoutService), []);
});

test('rejects route cookie, delegation, and terminal-response drift', () => {
    const serviceCall = 'completeExactWebP3Logout(bearerCookie, controlCookie, request)';
    const delegate = `return completePortableSupervisorWebLifecycleMutationV1(
        ${serviceCall},
        'logout',
    );`;
    const mutations = [
        ['wrong service module', replaceOnce(
            logoutRoute,
            "@/lib/security/web-auth-logout-server",
            '@/lib/security/web-logout-service',
        ), logoutService],
        ['wrong bearer cookie name', replaceOnce(
            logoutRoute,
            "const SESSION_COOKIE_NAME = 'mediflow_session';",
            "const SESSION_COOKIE_NAME = 'forged_session';",
        ), logoutService],
        ['wrong control cookie name', replaceOnce(
            logoutRoute,
            "const CONTROL_COOKIE_NAME = 'mediflow_auth_control';",
            "const CONTROL_COOKIE_NAME = 'forged_control';",
        ), logoutService],
        ['control read from bearer name', replaceOnce(
            logoutRoute,
            'controlCookie = cookieStore.get(CONTROL_COOKIE_NAME);',
            'controlCookie = cookieStore.get(SESSION_COOKIE_NAME);',
        ), logoutService],
        ['cookie mutation in route', replaceOnce(
            logoutRoute,
            'bearerCookie = cookieStore.get(SESSION_COOKIE_NAME);',
            'cookieStore.delete(SESSION_COOKIE_NAME); bearerCookie = cookieStore.get(SESSION_COOKIE_NAME);',
        ), logoutService],
        ['cookie failure fabricates success', replaceOnce(
            logoutRoute,
            '} catch { /* The terminal service receives only the inert denial input. */ }',
            "} catch { return new Response(null, { status: 204 }); }",
        ), logoutService],
        ['wrapped delegated response', replaceOnce(
            logoutRoute,
            delegate,
            `const response = await ${serviceCall}; void response; return new Response(null, { status: 204 });`,
        ), logoutService],
        ['optional delegated call', replaceOnce(
            logoutRoute,
            serviceCall,
            'completeExactWebP3Logout?.(bearerCookie, controlCookie, request)',
        ), logoutService],
        ['duplicate delegated call', replaceOnce(
            logoutRoute,
            delegate,
            `void ${serviceCall}; ${delegate}`,
        ), logoutService],
        ['dynamic delegated call', replaceOnce(
            logoutRoute,
            serviceCall,
            "(await import('./logout')).completeExactWebP3Logout(bearerCookie, controlCookie, request)",
        ), logoutService],
        ['wrong lifecycle reason', replaceOnce(
            logoutRoute,
            "        'logout',",
            "        'application_lock',",
        ), logoutService],
    ];
    assertLogoutMutationsRejected(mutations);
});

test('rejects package owner transport and exact bearer-control drift', () => {
    const mutations = [
        ['legacy owner module', logoutRoute, replaceOnce(
            logoutService,
            "from './web-auth-lifecycle-owner-adapter';",
            "from './server-session';",
        )],
        ['forged production resolver', logoutRoute, replaceOnce(
            logoutService,
            'resolve: resolveWebSession,',
            "resolve: (_sessionId: unknown, _controlId: unknown) => ({ status: 'absent' as const }),",
        )],
        ['forged production retire', logoutRoute, replaceOnce(
            logoutService,
            'retire: retireWebSession,',
            "retire: (_projection: unknown, _reason: 'delete') => ({ outcome: 'completed' as const }),",
        )],
        ['optional production freeze', logoutRoute, replaceOnce(
            logoutService,
            'const productionSources: WebAuthLogoutSources = Object.freeze({',
            'const productionSources: WebAuthLogoutSources = Object.freeze?.({',
        )],
        ['unbound production sources', logoutRoute, replaceOnce(
            logoutService,
            'sources: WebAuthLogoutSources = productionSources,',
            'sources: WebAuthLogoutSources,',
        )],
        ['forged bearer constant', logoutRoute, replaceOnce(
            logoutService,
            "const SESSION_COOKIE_NAME = 'mediflow_session';",
            "const SESSION_COOKIE_NAME = 'forged_session';",
        )],
        ['forged control constant', logoutRoute, replaceOnce(
            logoutService,
            "const CONTROL_COOKIE_NAME = 'mediflow_auth_control';",
            "const CONTROL_COOKIE_NAME = 'forged_control';",
        )],
        ['weak bearer pattern', logoutRoute, replaceOnce(
            logoutService,
            'const SESSION_ID = /^[a-f0-9]{64}$/u;',
            'const SESSION_ID = /.+/u;',
        )],
        ['weak control pattern', logoutRoute, replaceOnce(
            logoutService,
            'const CONTROL_ID = /^[A-Za-z0-9_-]{32,256}$/u;',
            'const CONTROL_ID = /.+/u;',
        )],
        ['control derived from bearer cookie', logoutRoute, replaceOnce(
            logoutService,
            'const controlId = exactCookie(controlCookie, CONTROL_COOKIE_NAME, CONTROL_ID);',
            'const controlId = exactCookie(bearerCookie, CONTROL_COOKIE_NAME, CONTROL_ID);',
        )],
        ['resolution omits control id', logoutRoute, replaceOnce(
            logoutService,
            'sources.resolve(sessionId, controlId)',
            'sources.resolve(sessionId)',
        )],
        ['inactive projection accepted', logoutRoute, replaceOnce(
            logoutService,
            "resolution.status !== 'active'",
            "resolution.status !== 'absent'",
        )],
        ['cookie parser bypasses fixed pattern', logoutRoute, replaceOnce(
            logoutService,
            'pattern.test(record.value)',
            'Boolean(record.value)',
        )],
        ['expiry clock forged', logoutRoute, replaceOnce(
            logoutService,
            'const DateNow = Date.now;',
            'const DateNow = () => 0;',
        )],
    ];
    assertLogoutMutationsRejected(mutations);
});

test('rejects retirement, ETag, audit-order, and terminality drift', () => {
    const retireTry = "try { receipt = retirementReceipt(sources.retire(projection, 'delete')); }\n    catch { return empty(409); }";
    const completedGuard = "if (receipt.outcome !== 'completed') return empty(409, receipt.etag);";
    const auditTry = 'try { await sources.audit(projection, sessionId, request); } catch { /* Terminal retirement is authoritative. */ }';
    const mutations = [
        ['retire wrong authority', logoutRoute, replaceOnce(
            logoutService,
            "sources.retire(projection, 'delete')",
            "sources.retire(sessionId, 'delete')",
        )],
        ['receipt parser bypassed', logoutRoute, replaceOnce(
            logoutService,
            "retirementReceipt(sources.retire(projection, 'delete'))",
            "sources.retire(projection, 'delete')",
        )],
        ['audit before retirement', logoutRoute, swapOnce(logoutService, retireTry, auditTry)],
        ['audit before completed guard', logoutRoute, swapOnce(logoutService, completedGuard, auditTry)],
        ['floating audit', logoutRoute, replaceOnce(
            logoutService,
            'await sources.audit(projection, sessionId, request)',
            'void sources.audit(projection, sessionId, request)',
        )],
        ['conditional audit', logoutRoute, replaceOnce(
            logoutService,
            auditTry,
            'if (controlId) { ' + auditTry + ' }',
        )],
        ['terminal branch before audit', logoutRoute, replaceOnce(
            logoutService,
            auditTry,
            'if (projection.id) return empty(409, receipt.etag); ' + auditTry,
        )],
        ['completed outcome inverted', logoutRoute, replaceOnce(
            logoutService,
            completedGuard,
            "if (receipt.outcome === 'completed') return empty(409, receipt.etag);",
        )],
        ['success omits successor ETag', logoutRoute, replaceOnce(
            logoutService,
            'return empty(204, receipt.etag);',
            'return empty(204);',
        )],
        ['denial omits successor ETag', logoutRoute, replaceOnce(
            logoutService,
            completedGuard,
            "if (receipt.outcome !== 'completed') return empty(409);",
        )],
        ['receipt transport bypassed', logoutRoute, replaceOnce(
            logoutService,
            'const etag = strongWebAuthControlEtag(twoFields.etag);',
            "const etag = typeof twoFields.etag === 'string' ? twoFields.etag : null;",
        )],
        ['receipt completion forged', logoutRoute, replaceOnce(
            logoutService,
            "if (!record || (record.outcome !== 'completed' && record.outcome !== 'denied' && record.outcome !== 'failed')) return null;",
            "if (!record) return { outcome: 'completed', etag: null };",
        )],
        ['cacheable response', logoutRoute, replaceOnce(
            logoutService,
            "new Headers({ 'Cache-Control': 'no-store' })",
            "new Headers({ 'Cache-Control': 'public' })",
        )],
        ['raw terminal response', logoutRoute, replaceOnce(
            logoutService,
            'return empty(204, receipt.etag);',
            "return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });",
        )],
        ['audit failure changes terminality', logoutRoute, replaceOnce(
            logoutService,
            auditTry,
            'try { await sources.audit(projection, sessionId, request); } catch { return empty(409, receipt.etag); }',
        )],
    ];
    assertLogoutMutationsRejected(mutations);
});

test('rejects alternate, unsafe, shadowed, and deferred logout audit writers', () => {
    const mutations = [
        ['wrong writer module', logoutRoute, replaceOnce(
            logoutService,
            "from './audit';",
            "from './wrong-audit';",
        )],
        ['wrong event', logoutRoute, replaceOnce(
            logoutService,
            "eventType: 'auth.logout'",
            "eventType: 'auth.login.succeeded'",
        )],
        ['raw subject', logoutRoute, replaceOnce(
            logoutService,
            'subjectRef: hashAuditRef(sessionId)',
            'subjectRef: sessionId',
        )],
        ['raw actor', logoutRoute, replaceOnce(
            logoutService,
            'actorRef: context.actorRef',
            'actorRef: session.id',
        )],
        ['missing actor type', logoutRoute, replaceOnce(
            logoutService,
            'actorType: context.actorType, ',
            '',
        )],
        ['forged source surface', logoutRoute, replaceOnce(
            logoutService,
            'sourceSurface: context.sourceSurface',
            "sourceSurface: 'network'",
        )],
        ['unsafe metadata', logoutRoute, replaceOnce(
            logoutService,
            'redactedMetadata: withAuditContextMetadata(context, null)',
            'redactedMetadata: { token: sessionId }',
        )],
        ['shadowed writer', logoutRoute, replaceOnce(
            logoutService,
            'const context = auditContextFromSession(session);',
            'const writeAuditEvent = async (_input: unknown) => {}; const context = auditContextFromSession(session);',
        )],
        ['deferred audit', logoutRoute, replaceOnce(
            logoutService,
            'try { await sources.audit(projection, sessionId, request); } catch { /* Terminal retirement is authoritative. */ }',
            'queueMicrotask(async () => { await sources.audit(projection, sessionId, request); });',
        )],
    ];
    assertLogoutMutationsRejected(mutations);
});

test('PIN guard accepts both canonical channels and rejects retirement/currentness drift', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/security/pin-change-service.ts'), 'utf8');
    const config = {
        source,
        fileName: 'lib/security/pin-change-service.ts',
        ownerName: 'changePin',
        writerModule: '@/lib/security/audit',
        writerExport: 'writeAuditEvent',
        eventType: 'settings.updated',
        dependencyFallback: { parameter: 'dependencies', property: 'writeAuditEvent' },
        requirePinRetirementOrder: true,
    };
    assert.deepEqual(validateAuditWriterControlFlow(config), []);
    // @Codex: the post-CAS comment is explanatory, never the evidence of a commit.
    assert.deepEqual(validateAuditWriterControlFlow({ ...config, source: source.replace(
        '/* The credential CAS has committed: never abort its retirement fence. */',
        '/* Retain the failed completion state. */',
    ) }), []);
    const nativeCapability = `const nativeRetirement = nativeSession
        ? preparePairedNativePinRetirement(nativeSession)
        : prepareNativeRetirement(user.id);`;
    const webCapability = `const webRetirement = nativeSession
        ? prepareNativeUserRetirement(nativeRetirement)
        : prepareWebRetirement(input.session);`;
    const nativeAdmission = "if (nativeSession && await readNativeSession(input.request) !== nativeSession) return { kind: 'unauthorized' };";
    const nativeRevalidation = `if (nativeSession && await readNativeSession(input.request) !== nativeSession) {
            abortPreparedRetirements();
            return { kind: 'unauthorized' };
        }`;
    const webCommit = `try {
        webRetirementOutcome = commitWebRetirement(webRetirement).outcome;
    } catch {
        webRetirementOutcome = 'failed';
    }`;
    const nativeCommit = `try {
        nativeRetirementOutcome = commitNativeRetirement(nativeRetirement).outcome;
    } catch {
        /* The credential CAS has committed: never abort its retirement fence. */
        nativeRetirementOutcome = 'failed';
    }`;
    const completedGuard = `if (webRetirementOutcome !== 'completed' || nativeRetirementOutcome !== 'completed') {
        return {
            kind: 'failure',
            status: 409,
            code: PIN_CHANGE_AUTHORITY_RETIREMENT_UNCONFIRMED_CODE,
            message: 'La rotazione delle credenziali non può essere confermata. Accedi di nuovo.',
        };
    }`;
    const audit = source.slice(source.indexOf('try {\n        const context = auditContextFromSession'),
        source.indexOf("\n\n    return { kind: 'success' };"));
    assert.ok(audit.includes("eventType: 'settings.updated'"));
    const mutations = [
        ['old owner import', replaceOnce(
            source,
            "from '@/lib/security/web-auth-lifecycle-owner-adapter';",
            "from '@/lib/security/server-session';",
        )],
        ['Web prepare alias bypassed', replaceOnce(
            source,
            'const prepareWebRetirement = dependencies.prepareWebSessionsForUserRetirement\n        ?? prepareUserRetirement;',
            'const prepareWebRetirement = () => null;',
        )],
        ['native prepare imported from a different owner', replaceOnce(
            source,
            '    preparePairedNativePinRetirement,',
            '    prepareNativeLegacyUserRetirement as preparePairedNativePinRetirement,',
        )],
        ['native proof bridge imported from a different owner', replaceOnce(
            source,
            '    prepareNativeUserRetirement,',
            '    prepareUserRetirement as prepareNativeUserRetirement,',
        )],
        ['native prepare shadowed locally', replaceOnce(
            source, nativeCapability,
            `const preparePairedNativePinRetirement = () => null;\n    ${nativeCapability}`,
        )],
        ['native resolver bypassed', replaceOnce(
            source,
            'const readNativeSession = dependencies.readPairedNativeSession ?? requirePairedNativeSession;',
            'const readNativeSession = async () => nativeSession;',
        )],
        ['native channel disguised as Web', replaceOnce(
            source,
            "const nativeSession = input.session.authChannel === 'native' ? input.session : null;",
            'const nativeSession = null;',
        )],
        ['native prepare loses exact session binding', replaceOnce(
            source, 'preparePairedNativePinRetirement(nativeSession)', 'prepareNativeRetirement(user.id)',
        )],
        ['native Web bridge loses exact capability', replaceOnce(
            source, 'prepareNativeUserRetirement(nativeRetirement)', 'prepareNativeUserRetirement(null)',
        )],
        ['Web prepare uses the native bridge', replaceOnce(
            source, ': prepareWebRetirement(input.session);', ': prepareNativeUserRetirement(nativeRetirement);',
        )],
        ['native session not checked before prepare', replaceOnce(source, nativeAdmission, '')],
        ['stale native admission reports success', replaceOnce(
            source, nativeAdmission, nativeAdmission.replace("kind: 'unauthorized'", "kind: 'success'"),
        )],
        ['native session not rechecked before CAS', replaceOnce(source, nativeRevalidation, '')],
        ['stale native session skips prepared aborts', replaceOnce(
            source, nativeRevalidation, nativeRevalidation.replace('abortPreparedRetirements();', ''),
        )],
        ['capability order reversed', swapOnce(source, nativeCapability, webCapability)],
        ['native capability not aborted when Web prepare fails', replaceOnce(
            source,
            'try { abortNativeRetirement(nativeRetirement); } catch { /* the credential mutation has not started */ }',
            'void nativeRetirement;',
        )],
        ['Web capability missing from shared abort', replaceOnce(
            source,
            'try { abortWebRetirement(webRetirement); } catch { /* the uncommitted capability remains non-authorizing */ }',
            'void webRetirement;',
        )],
        ['hash failure skips both aborts', replaceOnce(
            source,
            `try {
        nextPasswordHash = await bcrypt.hash(input.newPin, 10);
    } catch (error) {
        abortPreparedRetirements();
        throw error;
    }`,
            `try {
        nextPasswordHash = await bcrypt.hash(input.newPin, 10);
    } catch (error) {
        throw error;
    }`,
        )],
        ['transaction failure skips both aborts', replaceOnce(
            source,
            `    } catch (error) {
        abortPreparedRetirements();
        throw error;
    }

    if (updateResult.changes !== 1) {`,
            `    } catch (error) {
        throw error;
    }

    if (updateResult.changes !== 1) {`,
        )],
        ['CAS conflict skips both aborts', replaceOnce(
            source,
            `if (updateResult.changes !== 1) {
        abortPreparedRetirements();`,
            `if (updateResult.changes !== 1) {
        void updateResult;`,
        )],
        ['native retirement before web', swapOnce(
            source,
            webCommit,
            nativeCommit,
        )],
        ['audit before both completions', swapOnce(source, completedGuard, audit)],
        ['native commit failure aborts a committed credential fence', replaceOnce(
            source, nativeCommit, nativeCommit.replace("nativeRetirementOutcome = 'failed';",
                "abortNativeRetirement(nativeRetirement);\n        nativeRetirementOutcome = 'failed';"),
        )],
        ['post-CAS tail aborts both fences', replaceOnce(
            source, completedGuard, `abortPreparedRetirements();\n    ${completedGuard}`,
        )],
        ['post-CAS tail defers a Web abort', replaceOnce(
            source, completedGuard, `queueMicrotask(() => abortWebRetirement(webRetirement));\n    ${completedGuard}`,
        )],
        ['web completion not required', replaceOnce(
            source,
            "webRetirementOutcome !== 'completed' || nativeRetirementOutcome !== 'completed'",
            "webRetirementOutcome === 'failed' || nativeRetirementOutcome !== 'completed'",
        )],
        ['Web commit bypassed', replaceOnce(
            source,
            'webRetirementOutcome = commitWebRetirement(webRetirement).outcome;',
            "webRetirementOutcome = 'completed';",
        )],
        ['native commit bypassed', replaceOnce(
            source,
            'nativeRetirementOutcome = commitNativeRetirement(nativeRetirement).outcome;',
            "nativeRetirementOutcome = 'completed';",
        )],
        ['comment impersonates a Web commit', replaceOnce(
            source,
            'webRetirementOutcome = commitWebRetirement(webRetirement).outcome;',
            "/* webRetirementOutcome = commitWebRetirement(webRetirement).outcome; */\n        webRetirementOutcome = 'completed';",
        )],
        ['comment impersonates a native commit', replaceOnce(
            source,
            'nativeRetirementOutcome = commitNativeRetirement(nativeRetirement).outcome;',
            "/* nativeRetirementOutcome = commitNativeRetirement(nativeRetirement).outcome; */\n        nativeRetirementOutcome = 'completed';",
        )],
    ];
    for (const [name, mutation] of mutations) {
        assertParseClean('pin-change-service.ts', mutation);
        assert.notDeepEqual(validateAuditWriterControlFlow({ ...config, source: mutation }), [], name);
    }
});

/* @Codex: synthetic C04 transaction chain, independent of the runtime candidate checkout. */
test('patient-update audit guard binds the PUT delegate, patient subject and required tx writer', () => {
    const spec = {
        handler: 'PUT', serviceModule: '@/lib/patient-update-operation', serviceExport: 'updatePatientOperation',
        ownerFile: 'lib/patient-update-operation.ts', ownerName: 'updatePatientOperation',
    };
    const route = `import { updatePatientOperation } from '@/lib/patient-update-operation';
        export async function PUT() { const commit = updatePatientOperation({ patientId: 'synthetic' }); return commit; }`;
    const auditCall = `writeAuditEventInTransaction(tx, {
            eventType: classifyPatientMutationEvent(existing.isArchived ?? null, input.values.isArchived), outcome: 'success',
            actorType: input.audit.actorType, actorRef: input.audit.actorRef,
            subjectType: 'patient', subjectRef: input.patientId,
            sourceSurface: input.audit.sourceSurface, requestId: input.audit.requestId,
            redactedMetadata: null,
        });`;
    const membership = 'if (input.setPrimaryAmbulatory) upsertPrimaryAmbulatoryMembership(tx, input.patientId);';
    const core = `import { dbServer } from './db-server';
        import { patients } from './schema';
        import { upsertPrimaryAmbulatoryMembership } from './patient-ambulatory-membership';
        import { classifyPatientMutationEvent, writeAuditEventInTransaction } from './security/audit';
        export function updatePatientOperation(input) {
            return dbServer.transaction((tx) => {
                const existing = { isArchived: false };
                tx.update(patients).set({}).run();
                ${membership}
                ${auditCall}
                return { status: 200 };
            }, { behavior: 'immediate' });
        }`;
    const audit = `import { auditEvents } from '../schema';
        function buildAuditEventRow(input) { return input; }
        export function writeAuditEventInTransaction(tx, input) {
            const row = buildAuditEventRow(input);
            const result = tx.insert(auditEvents).values(row).run();
            if (result.changes !== 1) { throw new Error('synthetic insert failed'); }
            return 'synthetic-event';
        }`;
    const validatePatient = (routeSource = route, coreSource = core, auditSource = audit) => {
        for (const [file, source] of [['route.ts', routeSource], ['core.ts', coreSource], ['audit.ts', auditSource]]) {
            assertParseClean(file, source);
        }
        return validateRequiredPatientUpdateAudit({ spec, routeSource, coreSource, auditSource });
    };
    assert.deepEqual(validatePatient(), []);
    const mutations = [
        ['route removes delegate', route.replace("updatePatientOperation({ patientId: 'synthetic' })", '{ status: 200 }'), core, audit],
        ['route shadows imported delegate', route.replace('const commit =', 'const updatePatientOperation = () => ({ status: 200 }); const commit ='), core, audit],
        ['core loses required writer', route, core.replace(auditCall, 'void input.audit;'), audit],
        ['core moves writer outside transaction', route,
            core.replace(auditCall, '').replace('return dbServer.transaction', `${auditCall.replaceAll('tx,', 'input.tx,')}\n            return dbServer.transaction`), audit],
        ['core moves membership outside transaction', route,
            core.replace(membership, '').replace('return dbServer.transaction',
                `upsertPrimaryAmbulatoryMembership(input.tx, input.patientId); return dbServer.transaction`), audit],
        ['core conditionally skips required writer', route, core.replace(auditCall, `if (false) { ${auditCall} }`), audit],
        ['core changes subject', route, core.replace('subjectRef: input.patientId', 'subjectRef: input.otherId'), audit],
        ['core replaces classifier with literal', route,
            core.replace('classifyPatientMutationEvent(existing.isArchived ?? null, input.values.isArchived)', "'patient.updated'"), audit],
        ['core classifies fabricated state', route,
            core.replace('existing.isArchived ?? null, input.values.isArchived', 'null, false'), audit],
        ['core imports fake writer', route, core.replace("from './security/audit'", "from './fake-audit'"), audit],
        ['writer no longer executes insert', route, core, audit.replace('.values(row).run()', '.values(row)')],
        ['writer ignores failed insert', route, core,
            audit.replace("if (result.changes !== 1) { throw new Error('synthetic insert failed'); }", 'void result;')],
    ];
    for (const [name, routeSource, coreSource, auditSource] of mutations) {
        assert.notDeepEqual(validatePatient(routeSource, coreSource, auditSource), [], name);
    }
});

/* @Codex: C05 DELETE mutations use the frozen real source shape, without modifying runtime files. */
test('patient-delete audit guard binds both DELETE routes to one tombstone and required tx writer', () => {
    const core = fs.readFileSync(path.join(process.cwd(), 'lib/patient-delete-operation.ts'), 'utf8');
    const audit = fs.readFileSync(path.join(process.cwd(), 'lib/security/audit.ts'), 'utf8');
    const routes = [
        'app/api/patients/[id]/route.ts',
        'app/api/v1/patients/[id]/route.ts',
    ];
    const spec = {
        handler: 'DELETE', serviceModule: '@/lib/patient-delete-operation', serviceExport: 'deletePatientOperation',
        ownerFile: 'lib/patient-delete-operation.ts', ownerName: 'deletePatientOperation', deletionReason: 'web-delete',
    };
    const validate = (routeSource, coreSource = core, auditSource = audit, contract = spec) => {
        for (const [fileName, source] of [['route.ts', routeSource], ['core.ts', coreSource], ['audit.ts', auditSource]]) {
            assertParseClean(fileName, source);
        }
        return validateRequiredPatientDeleteAudit({ spec: contract, routeSource, coreSource, auditSource });
    };
    for (const routePath of routes) {
        const route = fs.readFileSync(path.join(process.cwd(), routePath), 'utf8');
        const contract = { ...spec, deletionReason: routePath.includes('/v1/') ? 'api-v1-delete' : 'web-delete' };
        const deleteOffset = route.indexOf('export async function DELETE');
        assert.notEqual(deleteOffset, -1);
        const mutateDelete = (before, after) => route.slice(0, deleteOffset)
            + replaceOnce(route.slice(deleteOffset), before, after);
        assert.deepEqual(validate(route, core, audit, contract), [], routePath);
        assert.notDeepEqual(validate(mutateDelete('deletePatientOperation({', 'missingDeleteOperation({'), core, audit, contract), [],
            `${routePath}: missing delegate`);
        assert.notDeepEqual(validate(mutateDelete(
            "if (!parsed.ok) return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });",
            "if (!parsed.ok) void NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 });"),
        core, audit, contract), [], `${routePath}: body-class denial must return`);
    }
    const route = fs.readFileSync(path.join(process.cwd(), routes[0]), 'utf8');
    const auditStart = '        writeAuditEventInTransaction(tx, {';
    const mutations = [
        ['missing writer', replaceOnce(core, auditStart, '        missingAuditWriter(tx, {')],
        ['late writer', replaceOnce(core, auditStart,
            '        return { status: 200, value: { success: true } };\n        writeAuditEventInTransaction(tx, {')],
        ['nested writer', replaceOnce(replaceOnce(core, auditStart,
            '        if (false) { writeAuditEventInTransaction(tx, {'),
        '        });\n        return { status: 200', '        }); }\n        return { status: 200')],
        ['wrong transaction', replaceOnce(core, auditStart, '        writeAuditEventInTransaction(input.tx, {')],
        ['duplicate writer', replaceOnce(core, '        return { status: 200, value: { success: true } };',
            "        writeAuditEventInTransaction(tx, { eventType: 'patient.deleted' });\n        return { status: 200, value: { success: true } };")],
        ['wrong event', replaceOnce(core, "eventType: 'patient.deleted'", "eventType: 'patient.updated'")],
        ['wrong subject', replaceOnce(core, 'subjectRef: input.patientId', 'subjectRef: input.otherId')],
        ['wrong resource version', replaceOnce(core, 'resourceVersion: input.expectedVersion + 1',
            'resourceVersion: input.expectedVersion')],
        ['hard delete', replaceOnce(core, 'tx.update(patients)', 'tx.delete(patients)')],
        ['wrong builder', replaceOnce(core, 'buildPatientTombstoneValues(input.expectedVersion, input.deletionReason)',
            'fakeTombstone(input.expectedVersion, input.deletionReason)')],
        ['CAS version lost', replaceOnce(core, 'eq(patients.version, input.expectedVersion), activePatients()))',
            'eq(patients.version, input.expectedVersion + 1), activePatients()))')],
        ['CAS active lost', replaceOnce(core, 'eq(patients.version, input.expectedVersion), activePatients()))',
            'eq(patients.version, input.expectedVersion)))')],
        ['CAS predicate OR', replaceOnce(core,
            '.where(and(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion), activePatients()))',
            '.where(or(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion), activePatients()))')],
        ['CAS patient id lost', replaceOnce(core,
            '.where(and(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion), activePatients()))',
            '.where(and(eq(patients.version, input.expectedVersion), activePatients()))')],
        ['CAS wrong patient id', replaceOnce(core,
            '.where(and(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion), activePatients()))',
            '.where(and(eq(patients.id, input.otherId), eq(patients.version, input.expectedVersion), activePatients()))')],
        ['CAS shadowed and binding', replaceOnce(core,
            '        const deleted = tx.update(patients)',
            '        const and = (...conditions) => conditions[0];\n        const deleted = tx.update(patients)')],
        ['early successful return before audit', replaceOnce(core, auditStart,
            "        if (input.deletionReason === 'web-delete') return { status: 200, value: { success: true } };\n"
            + auditStart)],
        ['conflict builder lost', replaceOnce(core,
            'buildPatientVersionConflictPayload(input.expectedVersion, input.patientId, current ?? null)', '{}')],
    ];
    for (const [name, mutated] of mutations) assert.notDeepEqual(validate(route, mutated), [], name);
    assert.notDeepEqual(validate(route, core,
        replaceOnce(audit, 'if (result.changes !== 1) {', 'if (false) {')), [], 'required insert result ignored');
});
