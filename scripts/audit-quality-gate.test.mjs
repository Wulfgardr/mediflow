/* @Codex */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

import { validateAuditWriterControlFlow, validateDelegatedRouteAudit, validateLogoutAuditModes } from './audit-quality-gate.mjs';

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
        inline: { handler: 'POST', writerModule: '@/lib/security/audit', writerExport: 'writeAuditEvent', eventType: 'auth.logout' },
        delegated: {
            handler: 'POST', serviceModule: '@/lib/security/web-logout-service', serviceExport: 'completeExactWebP3Logout',
            ownerFile: 'lib/security/web-logout-service.ts', ownerName: 'completeExactWebP3Logout',
            writerModule: '@/lib/security/audit', writerExport: 'writeAuditEvent', hashExport: 'hashAuditRef',
            eventType: 'auth.logout', sourcesName: 'productionSources',
        },
    },
};
const logoutRoute = `import { completeExactWebP3Logout } from '@/lib/security/web-logout-service';
export async function POST(request: Request): Promise<Response> {
    const receipt = await completeExactWebP3Logout(request);
    if (!receipt.completed) return new Response(null, { status: 401 });
    return new Response(null, { status: 204 });
}`;
const logoutService = `import { hashAuditRef, writeAuditEvent } from '@/lib/security/audit';
type Session = { id: string };
type Sources = { retire(id: string): { outcome: 'completed' | 'denied' }; audit(session: Session, sessionId: string, request: Request): Promise<void> };
const productionSources: Sources = Object.freeze({
    retire: (_id: string) => ({ outcome: 'completed' as const }),
    audit: async (_session: Session, sessionId: string, _request: Request) => {
        await writeAuditEvent({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) });
    },
});
export async function completeExactWebP3Logout(request: Request, sources = productionSources): Promise<{ completed: boolean }> {
    const session: Session = { id: 'synthetic-session' };
    const sessionId = 'synthetic-bearer';
    const retirement = sources.retire(sessionId);
    if (retirement.outcome !== 'completed') return { completed: false };
    await sources.audit(session,sessionId,request);
    return { completed: true };
}`;

function assertLogoutSemanticClean(route, service) {
    const sources = new Map([
        ['/fixture/route.ts', route], ['/fixture/lib/security/web-logout-service.ts', service],
        ['/fixture/lib/security/audit.d.ts', `export declare function hashAuditRef(value: string): string;
export declare function writeAuditEvent(input: Record<string, unknown>): Promise<void>;`],
    ]);
    const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Node10, baseUrl: '/fixture', paths: { '@/*': ['*'] } };
    const host = ts.createCompilerHost(options); const read = host.readFile.bind(host); const sourceFile = host.getSourceFile.bind(host);
    host.fileExists = (file) => sources.has(file) || ts.sys.fileExists(file);
    host.directoryExists = (directory) => directory.startsWith('/fixture') || ts.sys.directoryExists(directory);
    host.readFile = (file) => sources.get(file) ?? read(file);
    host.getSourceFile = (file, language, onError, fresh) => sources.has(file)
        ? ts.createSourceFile(file, sources.get(file), language, true, file.endsWith('.ts') ? ts.ScriptKind.TS : undefined)
        : sourceFile(file, language, onError, fresh);
    assert.deepEqual(ts.getPreEmitDiagnostics(ts.createProgram([...sources.keys()], options, host))
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
}

test('accepts the current inline logout and one exact delegated terminal audit', () => {
    const inline = fs.readFileSync(path.join(process.cwd(), 'app/api/auth/logout/route.ts'), 'utf8');
    assert.deepEqual(validateLogoutAuditModes({ spec: logoutSpec, routeSource: inline }), []);
    assertLogoutSemanticClean(logoutRoute, logoutService);
    assert.deepEqual(validateLogoutAuditModes({ spec: logoutSpec, routeSource: logoutRoute, serviceSource: logoutService }), []);
    for (const metadata of [
        "{ reasonCode: 'logout_completed', flags: ['auth:web'], changedFields: [], resourceVersion: 1, counts: 1 }",
        'null',
    ]) {
        const service = logoutService.replace(
            'subjectRef: hashAuditRef(sessionId)',
            `subjectRef: hashAuditRef(sessionId), redactedMetadata: ${metadata}`,
        );
        assertLogoutSemanticClean(logoutRoute, service);
        assert.deepEqual(validateLogoutAuditModes({ spec: logoutSpec, routeSource: logoutRoute, serviceSource: service }), []);
    }
});

test('rejects mixed, missing, unreachable, reordered, floating, and raw delegated logout audit shapes', () => {
    const mutations = [
        [logoutRoute.replace("@/lib/security/web-logout-service", '@/lib/security/wrong-service'), logoutService],
        [logoutRoute, logoutService.replace("@/lib/security/audit", '@/lib/security/wrong-audit')],
        [logoutRoute, logoutService.replace("'auth.logout'", "'auth.login.succeeded'")],
        [logoutRoute, logoutService.replace("const retirement = sources.retire(sessionId);\n    if (retirement.outcome !== 'completed') return { completed: false };\n    await sources.audit(session,sessionId,request);", "await sources.audit(session,sessionId,request);\n    const retirement = sources.retire(sessionId);\n    if (retirement.outcome !== 'completed') return { completed: false };")],
        [logoutRoute, logoutService.replace('await sources.audit(session,sessionId,request);', 'void sources.audit(session,sessionId,request);')],
        [logoutRoute, logoutService.replace("    if (retirement.outcome !== 'completed') return { completed: false };\n", '')],
        [logoutRoute, logoutService.replace('hashAuditRef(sessionId)', 'sessionId')],
        [logoutRoute, logoutService.replace("subjectRef: hashAuditRef(sessionId)", "subjectRef: hashAuditRef(sessionId), redactedMetadata: { token: sessionId }")],
        [logoutRoute.replace('const receipt = await', 'const receipt ='), logoutService],
        [logoutRoute, logoutService.replace('await sources.audit(session,sessionId,request);', 'queueMicrotask(() => void sources.audit(session,sessionId,request));')],
        [logoutRoute, logoutService.replace('sources = productionSources', 'sources: Sources')],
        [logoutRoute, logoutService.replace("await writeAuditEvent({ eventType: 'auth.logout'", "const writeAuditEvent = async (_input: unknown) => {}; await writeAuditEvent({ eventType: 'auth.logout'")],
        [`import { writeAuditEvent } from '@/lib/security/audit';\n${logoutRoute}`, logoutService],
        ['export async function POST(): Promise<Response> { return new Response(null, { status: 204 }); }', logoutService],
    ];
    for (const [route, service] of mutations) {
        assert.notDeepEqual(validateLogoutAuditModes({ spec: logoutSpec, routeSource: route, serviceSource: service }), []);
    }
});

test('rejects delegated logout 204 bypasses, hidden writers, and ambiguous audit objects', () => {
    const writerStatement = "        await writeAuditEvent({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) });";
    const mutations = [
        [logoutRoute.replace(
            '    const receipt = await completeExactWebP3Logout(request);',
            "    if (request.url.endsWith('/early')) return new Response(null, { status: 204 });\n    const receipt = await completeExactWebP3Logout(request);",
        ), logoutService],
        [logoutRoute.replace(
            "    if (!receipt.completed) return new Response(null, { status: 401 });\n    return new Response(null, { status: 204 });",
            "    if (receipt.completed) return new Response(null, { status: 204 });\n    return new Response(null, { status: 401 });",
        ), logoutService],
        [logoutRoute.replace('status: 401', "status: Number('204')"), logoutService],
        [logoutRoute.replace(
            'const receipt = await completeExactWebP3Logout(request);',
            'const finish = completeExactWebP3Logout; const receipt = await finish(request);',
        ), logoutService],
        [logoutRoute.replace(
            '    const receipt = await completeExactWebP3Logout(request);',
            "    const early = new Response(null, { status: 204 });\n    if (request.url.endsWith('/early')) return early;\n    const receipt = await completeExactWebP3Logout(request);",
        ), logoutService],
        [logoutRoute.replace(
            '    const receipt = await completeExactWebP3Logout(request);',
            "    const earlyStatus = 204;\n    if (request.url.endsWith('/early')) return new Response(null, { status: earlyStatus });\n    const receipt = await completeExactWebP3Logout(request);",
        ), logoutService],
        [logoutRoute, logoutService.replace(
            'await sources.audit(session,sessionId,request);',
            'if (true) await sources.audit(session,sessionId,request);',
        )],
        [logoutRoute, logoutService.replace(
            '    const retirement = sources.retire(sessionId);',
            '    const extraAudit = sources.audit;\n    await extraAudit(session,sessionId,request);\n    const retirement = sources.retire(sessionId);',
        )],
        [logoutRoute, logoutService.replace(
            '    const retirement = sources.retire(sessionId);',
            "    await sources['audit'](session,sessionId,request);\n    const retirement = sources.retire(sessionId);",
        )],
        [logoutRoute, logoutService.replace(
            "        await writeAuditEvent({ eventType: 'auth.logout'",
            "        if (false) await writeAuditEvent({ eventType: 'auth.logout'",
        )],
        [logoutRoute, logoutService.replace(
            "        await writeAuditEvent({ eventType: 'auth.logout'",
            "        return; await writeAuditEvent({ eventType: 'auth.logout'",
        )],
        [logoutRoute, logoutService.replace(writerStatement,
            "        if (_request.url.endsWith('/skip')) return;\n" + writerStatement)],
        [logoutRoute, logoutService.replace(writerStatement,
            "        if (_request.url.endsWith('/write')) " + writerStatement.trim())],
        [logoutRoute, logoutService.replace(writerStatement,
            "        await (_request.url.endsWith('/write') ? writeAuditEvent({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) }) : Promise.resolve());")],
        [logoutRoute, logoutService.replace(writerStatement,
            "        await (_request.url.endsWith('/write') && writeAuditEvent({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) }));")],
        [logoutRoute, logoutService.replace(writerStatement,
            "        try { await writeAuditEvent({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) }); } finally {}")],
        [logoutRoute, logoutService.replace(writerStatement,
            "        await writeAuditEvent?.({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) });")],
        [logoutRoute, logoutService.replace(writerStatement,
            "        await (writeAuditEvent)?.({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) });")],
        [logoutRoute, logoutService.replace(writerStatement,
            "        await (writeAuditEvent as typeof writeAuditEvent)?.({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) });")],
        [logoutRoute, logoutService.replace(writerStatement,
            "        await (writeAuditEvent satisfies typeof writeAuditEvent)?.({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) });")],
        [logoutRoute, logoutService.replace(writerStatement,
            "        await (writeAuditEvent!)?.({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) });")],
        [logoutRoute, logoutService.replace(writerStatement,
            "        await ({ writeAuditEvent })?.writeAuditEvent({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) });")],
        [logoutRoute, logoutService.replace(writerStatement,
            "        await ({ writeAuditEvent })?.['writeAuditEvent']({ eventType: 'auth.logout', subjectRef: hashAuditRef(sessionId) });")],
        [logoutRoute, logoutService.replace(
            'subjectRef: hashAuditRef(sessionId)',
            "subjectRef: hashAuditRef(sessionId), redactedMetadata: { ...{ reasonCode: 'logout' } }",
        )],
        [logoutRoute, logoutService.replace(
            'subjectRef: hashAuditRef(sessionId)',
            "subjectRef: hashAuditRef(sessionId), redactedMetadata: { reasonCode: { Authorization: sessionId } }",
        )],
        [logoutRoute, logoutService.replace(
            'subjectRef: hashAuditRef(sessionId)',
            "subjectRef: hashAuditRef(sessionId), actorRef: ({ Authorization: 'synthetic-secret' }).Authorization",
        )],
        [logoutRoute, logoutService.replace(
            'subjectRef: hashAuditRef(sessionId)',
            "subjectRef: hashAuditRef(sessionId), actorRef: ({ ...{ Authorization: 'synthetic-secret' } }).Authorization",
        )],
        [logoutRoute, logoutService.replace(
            'subjectRef: hashAuditRef(sessionId)',
            "subjectRef: hashAuditRef(sessionId), actorRef: _request.headers.get('Authorization') ?? 'anonymous'",
        )],
        [logoutRoute, logoutService.replace(
            "eventType: 'auth.logout', subjectRef:",
            "eventType: 'auth.logout', ['event' + 'Type']: 'auth.login.failed', subjectRef:",
        )],
        [logoutRoute, logoutService.replace('    audit: async', "    ['audit']: async")],
    ];
    for (const [index, [route, service]] of mutations.entries()) {
        assertLogoutSemanticClean(route, service);
        assert.notDeepEqual(
            validateLogoutAuditModes({ spec: logoutSpec, routeSource: route, serviceSource: service }),
            [],
            `mutation ${index}`,
        );
    }
});
