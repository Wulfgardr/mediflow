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
            handler: 'POST', serviceModule: '@/lib/security/web-auth-logout-server', serviceExport: 'completeExactWebP3Logout',
            ownerFile: 'lib/security/web-auth-logout-server.ts', ownerName: 'completeExactWebP3Logout',
            writerModule: './audit', writerExport: 'writeAuditEvent', hashExport: 'hashAuditRef',
            eventType: 'auth.logout', sourcesName: 'productionSources',
        },
    },
};
const logoutRoute = `import { cookies } from 'next/headers';
import { completeExactWebP3Logout } from '@/lib/security/web-auth-logout-server';
import { SESSION_COOKIE_NAME } from '@/lib/security/server-session';
export async function POST(request: Request): Promise<Response> {
    let cookie: unknown = null;
    try {
        const cookieStore = await cookies();
        cookie = cookieStore.get(SESSION_COOKIE_NAME);
    } catch {}
    return completeExactWebP3Logout(cookie, request);
}`;
const logoutService = `import { auditContextFromSession, hashAuditRef, requestIdFromRequest, withAuditContextMetadata, writeAuditEvent } from './audit';
type Session = { id: string };
type Sources = { resolve(id: string): Session | null; retire(id: string, reason: 'delete'): { outcome: 'completed' | 'denied' }; audit(session: Session, sessionId: string, request: Request): Promise<void> };
function completedReceipt(value: unknown): boolean { return Boolean(value); }
function empty(status: 204 | 401 | 409): Response { return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } }); }
const productionSources: Sources = Object.freeze({
    resolve: (_id: string) => ({ id: 'synthetic-session' }),
    retire: (_id: string, _reason: 'delete') => ({ outcome: 'completed' as const }),
    audit: async (session: Session, sessionId: string, request: Request) => {
        const context = auditContextFromSession(session);
        await writeAuditEvent({ eventType: 'auth.logout', outcome: 'success', actorType: context.actorType, actorRef: context.actorRef, subjectType: 'session', subjectRef: hashAuditRef(sessionId), sourceSurface: context.sourceSurface, requestId: requestIdFromRequest(request), redactedMetadata: withAuditContextMetadata(context, null) });
    },
});
export async function completeExactWebP3Logout(cookie: unknown, request: Request, sources = productionSources): Promise<Response> {
    void cookie;
    const sessionId = 'synthetic-bearer';
    let session: Session | null;
    try { session = sources.resolve(sessionId); } catch { return empty(401); }
    if (!session) return empty(401);
    let receipt: unknown;
    try { receipt = sources.retire(sessionId, 'delete'); } catch { return empty(409); }
    if (!completedReceipt(receipt)) return empty(409);
    try { await sources.audit(session, sessionId, request); } catch {}
    return empty(204);
}`;

function assertLogoutSemanticClean(route, service) {
    const sources = new Map([
        ['/fixture/route.ts', route], ['/fixture/lib/security/web-auth-logout-server.ts', service],
        ['/fixture/node_modules/next/headers.d.ts', `export declare function cookies(): Promise<{ get(name: string): unknown }>;`],
        ['/fixture/lib/security/server-session.d.ts', `export declare const SESSION_COOKIE_NAME: string;`],
        ['/fixture/lib/security/audit.d.ts', `export declare function auditContextFromSession(value: unknown): Record<string, unknown>;
export declare function hashAuditRef(value: string): string;
export declare function requestIdFromRequest(value: Request): string;
export declare function withAuditContextMetadata(context: Record<string, unknown>, value: null): null;
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

test('accepts the current inline logout and the exact service-owned delegated terminal audit', () => {
    const inline = fs.readFileSync(path.join(process.cwd(), 'app/api/auth/logout/route.ts'), 'utf8');
    assert.deepEqual(validateLogoutAuditModes({ spec: logoutSpec, routeSource: inline }), []);
    assertLogoutSemanticClean(logoutRoute, logoutService);
    assert.deepEqual(validateLogoutAuditModes({ spec: logoutSpec, routeSource: logoutRoute, serviceSource: logoutService }), []);
});

test('rejects stale paths and non-terminal, reordered, floating, or raw delegated logout shapes', () => {
    const mutations = [
        [logoutRoute.replace("@/lib/security/web-auth-logout-server", '@/lib/security/web-logout-service'), logoutService],
        [logoutRoute, logoutService.replace("from './audit'", "from './wrong-audit'")],
        [logoutRoute, logoutService.replace("'auth.logout'", "'auth.login.succeeded'")],
        [logoutRoute.replace('return completeExactWebP3Logout(cookie, request);', 'const response = await completeExactWebP3Logout(cookie, request); return new Response(null, { status: 204 });'), logoutService],
        [logoutRoute, logoutService.replace("try { receipt = sources.retire(sessionId, 'delete'); } catch { return empty(409); }\n    if (!completedReceipt(receipt)) return empty(409);\n    try { await sources.audit(session, sessionId, request); } catch {}", "try { await sources.audit(session, sessionId, request); } catch {}\n    try { receipt = sources.retire(sessionId, 'delete'); } catch { return empty(409); }\n    if (!completedReceipt(receipt)) return empty(409);")],
        [logoutRoute, logoutService.replace('try { await sources.audit(session, sessionId, request); } catch {}', 'try { void sources.audit(session, sessionId, request); } catch {}')],
        [logoutRoute, logoutService.replace('if (!completedReceipt(receipt)) return empty(409);\n    ', '')],
        [logoutRoute, logoutService.replace('hashAuditRef(sessionId)', 'sessionId')],
        [logoutRoute, logoutService.replace("'Cache-Control': 'no-store'", "'Cache-Control': 'cache'")],
        [logoutRoute, logoutService.replace('try { await sources.audit(session, sessionId, request); } catch {}', 'await sources.audit(session, sessionId, request);')],
        [logoutRoute, logoutService.replace('sources = productionSources', 'sources: Sources')],
        [logoutRoute, logoutService.replace("await writeAuditEvent({ eventType: 'auth.logout'", "const writeAuditEvent = async (_input: unknown) => {}; await writeAuditEvent({ eventType: 'auth.logout'")],
        [`import { writeAuditEvent } from '@/lib/security/audit';\n${logoutRoute}`, logoutService],
        ['export async function POST(): Promise<Response> { return new Response(null, { status: 204 }); }', logoutService],
    ];
    for (const [route, service] of mutations) {
        assert.notDeepEqual(validateLogoutAuditModes({ spec: logoutSpec, routeSource: route, serviceSource: service }), []);
    }
});

test('V5A rejects impure cookie routes and hostile service-owned response factories without throwing', () => {
    const mutations = [
        [logoutRoute.replace('} catch {}', "} catch { throw new Error('cookie rejection'); }"), logoutService],
        [logoutRoute.replace('cookie = cookieStore.get(SESSION_COOKIE_NAME);', 'cookieStore.delete(SESSION_COOKIE_NAME); cookie = cookieStore.get(SESSION_COOKIE_NAME);'), logoutService],
        [logoutRoute.replace('return completeExactWebP3Logout(cookie, request);', 'return completeExactWebP3Logout.call(null, cookie, request);'), logoutService],
        [logoutRoute.replace('return completeExactWebP3Logout(cookie, request);', 'return completeExactWebP3Logout?.(cookie, request);'), logoutService],
        [logoutRoute.replace('return completeExactWebP3Logout(cookie, request);', 'return completeExactWebP3Logout.apply(null, [cookie, request]);'), logoutService],
        [logoutRoute.replace('return completeExactWebP3Logout(cookie, request);', 'return completeExactWebP3Logout.bind(null)(cookie, request);'), logoutService],
        [logoutRoute.replace('return completeExactWebP3Logout(cookie, request);', 'return Reflect.apply(completeExactWebP3Logout, null, [cookie, request]);'), logoutService],
        [logoutRoute.replace('return completeExactWebP3Logout(cookie, request);', "return (await import('./logout')).completeExactWebP3Logout(cookie, request);"), logoutService],
        [logoutRoute.replace('return completeExactWebP3Logout(cookie, request);', 'void completeExactWebP3Logout(cookie, request); return completeExactWebP3Logout(cookie, request);'), logoutService],
        [logoutRoute.replace('} catch {}', '    return new Response(null, { status: 204 });\n    } catch {}'), logoutService],
        [logoutRoute.replace('return completeExactWebP3Logout(cookie, request);', 'return new Response(null, { status: 204 });'), logoutService],
        [logoutRoute, logoutService.replace("headers: { 'Cache-Control': 'no-store' }", "headers: { ...{ 'Cache-Control': 'no-store' } }")],
        [logoutRoute, logoutService.replace("'Cache-Control': 'no-store'", "['Cache-Control']: 'no-store'")],
        [logoutRoute, logoutService.replace("'Cache-Control': 'no-store'", "'cache-control': 'no-store'")],
        [logoutRoute, logoutService.replace("headers: { 'Cache-Control': 'no-store' }", 'headers: {}')],
        [logoutRoute, logoutService.replace('{ status, headers:', '{ status: status, headers:')],
        [logoutRoute, `import { Response } from './response';\n${logoutService}`],
        [logoutRoute, logoutService.replace('return empty(204);', "return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });")],
        [logoutRoute, logoutService.replace('return empty(204);', 'return empty?.(204);')],
    ];
    for (const [index, [route, service]] of mutations.entries()) {
        let findings;
        assert.doesNotThrow(() => { findings = validateLogoutAuditModes({ spec: logoutSpec, routeSource: route, serviceSource: service }); }, `mutation ${index}`);
        assert.notDeepEqual(findings, [], `mutation ${index}`);
    }
});
