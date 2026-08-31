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
    const gatePath = path.join(root, 'scripts/audit-quality-gate.mjs');
    const gateSource = fs.readFileSync(gatePath, 'utf8');
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-audit-wiring-'));
    const requiredFiles = [
        ...gateSource.matchAll(/\broute:\s*'([^']+)'/g).map((match) => match[1]),
        ...gateSource.matchAll(/\bownerFile:\s*'([^']+)'/g).map((match) => match[1]),
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
    const delegate = 'return completeExactWebP3Logout(bearerCookie, controlCookie, request);';
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
            'const response = await completeExactWebP3Logout(bearerCookie, controlCookie, request); void response; return new Response(null, { status: 204 });',
        ), logoutService],
        ['optional delegated call', replaceOnce(
            logoutRoute,
            delegate,
            'return completeExactWebP3Logout?.(bearerCookie, controlCookie, request);',
        ), logoutService],
        ['duplicate delegated call', replaceOnce(
            logoutRoute,
            delegate,
            'void completeExactWebP3Logout(bearerCookie, controlCookie, request); ' + delegate,
        ), logoutService],
        ['dynamic delegated call', replaceOnce(
            logoutRoute,
            delegate,
            "return (await import('./logout')).completeExactWebP3Logout(bearerCookie, controlCookie, request);",
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

test('PIN guard accepts the final ordered retirement flow and rejects atomicity drift', () => {
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
    const nativeCapability = 'const nativeRetirement = prepareNativeRetirement(user.id);';
    const webCapability = 'const webRetirement = prepareWebRetirement(input.session);';
    const webCommit = `try {
        webRetirementOutcome = commitWebRetirement(webRetirement).outcome;
    } catch {
        webRetirementOutcome = 'failed';
    }`;
    const nativeCommit = `try {
        nativeRetirementOutcome = commitNativeRetirement(nativeRetirement).outcome;
    } catch {
        try { abortNativeRetirement(nativeRetirement); } catch { /* fail-closed response below */ }
        nativeRetirementOutcome = 'failed';
    }`;
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
    ];
    for (const [name, mutation] of mutations) {
        assertParseClean('pin-change-service.ts', mutation);
        assert.notDeepEqual(validateAuditWriterControlFlow({ ...config, source: mutation }), [], name);
    }
});
