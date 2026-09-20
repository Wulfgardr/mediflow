/* @Codex: source/CLI contract only, no actual runtime distribution. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runPortableSetup, runTreatmentPortableSelfTest, TREATMENT_PORTABLE_SOURCE_CLOSURE } from './treatment-reasoning-portable-setup.mjs';
const script = fileURLToPath(new URL('./treatment-reasoning-portable-setup.mjs', import.meta.url));
function directory(t) {
    assert.ok(process.env.MEDIFLOW_DATA_DIR, 'Explicit synthetic MEDIFLOW_DATA_DIR required');
    fs.mkdirSync(process.env.MEDIFLOW_DATA_DIR, { recursive: true });
    const dir = fs.mkdtempSync(path.join(process.env.MEDIFLOW_DATA_DIR, 'portable-cli-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}
test('status reads missing evidence without installing or writing', async t => {
    const dir = directory(t); const status = await runPortableSetup(['status'], { dataDir: dir, platform: 'linux', arch: 'x64' });
    assert.equal(status.state, 'NEEDS_CONTEXT'); assert.equal(status.writesPerformed, 0); assert.deepEqual(fs.readdirSync(dir), []);
});
test('CLI rejects unconfirmed actions, URLs, path and command overrides', async t => {
    const dir = directory(t);
    for (const args of [['import'], ['activate'], ['recover'], ['status', '--path', '/tmp'], ['download', '--url', 'https://invalid.example'], ['import', '--consent-digest', '0'.repeat(64), '--exec', 'anything']]) {
        await assert.rejects(runPortableSetup(args, { dataDir: dir }), e => e.code === 'consent_required');
    }
    assert.deepEqual(fs.readdirSync(dir), []);
});
test('Node24 command returns honest unavailable status and no host path in stdout', t => {
    const dir = directory(t); const result = spawnSync(process.execPath, [script, 'status'], { env: { ...process.env, MEDIFLOW_DATA_DIR: dir }, encoding: 'utf8' });
    assert.equal(result.status, 3); const status = JSON.parse(result.stdout); assert.equal(status.state, process.platform === 'darwin' ? 'platform_unsupported' : 'NEEDS_CONTEXT');
    assert.equal(result.stdout.includes(dir), false); assert.equal(status.applyPolicy, 'none');
});
test('worker source has bounded local-only loads, no package acquisition or clinical writer', () => {
    const worker = fs.readFileSync(new URL('./treatment-reasoning-portable-worker.py', import.meta.url), 'utf8');
    assert.match(worker, /local_files_only=True/u); assert.match(worker, /trust_remote_code=False/u); assert.match(worker, /use_safetensors=True/u);
    assert.match(worker, /RLIMIT_AS/u); assert.match(worker, /AssignProcessToJobObject/u);
    assert.doesNotMatch(worker, /snapshot_download|hf_hub_download|subprocess|pip install|requests\.|https?:\/\//u);
});

test('portable packaging checks complete synthetic source/trace closure and every negative case without loading unrelated PDF modules', () => {
    const result = runTreatmentPortableSelfTest();
    assert.equal(result.liveInference, false); assert.equal(result.check, 'treatment-portable-bundle-synthetic'); assert.ok(result.cases >= 23);
});

/* @Codex: Execute real composition modules, not a string/URL-wrapper assertion.
 * Only external DB/auth/lifecycle/other-lane acquisition boundaries are fixtures.
 * The provisioning module gets a native non-file ESM origin to expose any illegal
 * dependency on import.meta.url. This is NOT Webpack or a Next build substitute.
 */
const compositionProbe = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { registerHooks, stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const input = JSON.parse(process.env.TR_COMPOSITION_FIXTURE);
const source = input.source;
const virtual = 'mediflow-composition-test:/lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.ts';
const provisioningFile = path.join(source, 'lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.ts');
Object.defineProperty(process, 'platform', { value: input.platform });
Object.defineProperty(process, 'arch', { value: 'arm64' });
os.machine = () => 'aarch64';
os.totalmem = () => 12 * 1024 ** 3;
os.freemem = () => 10 * 1024 ** 3;
os.availableParallelism = () => 4;
if (input.unsetData) delete process.env.MEDIFLOW_DATA_DIR;
const observed = { workerAccesses: 0, executions: 0, mutations: 0, databaseReads: 0, imported: [] };
globalThis.__trComposition = { observed, allowStatus: false };
const savedRead = fs.readFileSync.bind(fs);
const savedExists = fs.existsSync.bind(fs);
const savedStat = fs.statSync.bind(fs);
const rejectWorker = value => {
    const name = value instanceof URL ? value.pathname : typeof value === 'string' ? value : '';
    if (name.endsWith('.py')) { observed.workerAccesses++; throw new Error('EAGER_WORKER_ACCESS'); }
};
for (const name of ['existsSync', 'statSync', 'lstatSync', 'realpathSync', 'readFileSync', 'openSync', 'accessSync', 'createReadStream']) {
    const original = fs[name].bind(fs);
    fs[name] = (...args) => { rejectWorker(args[0]); return original(...args); };
}
for (const name of ['stat', 'lstat', 'realpath', 'readFile', 'open', 'access']) {
    const original = fsp[name].bind(fsp);
    fsp[name] = (...args) => { rejectWorker(args[0]); return original(...args); };
}
for (const name of ['writeFileSync', 'mkdirSync', 'rmSync', 'renameSync', 'unlinkSync', 'chmodSync']) {
    fs[name] = () => { observed.mutations++; throw new Error('IMPORT_OR_STATUS_MUTATION'); };
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    cp[name] = () => { observed.executions++; throw new Error('IMPORT_OR_STATUS_EXECUTION'); };
}
globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
syncBuiltinESMExports();
const fixture = code => ({ url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true });
const unavailable = 'export const createHostProviderLifecycleService = () => ({ service: { read: () => ({ status: "denied", reason: "unavailable" }) } });';
const forbid = name => 'export const ' + name + ' = () => { throw new Error("UNEXPECTED_OTHER_LANE_ACQUISITION"); };';
const leaves = new Map([
    ['lib/db-server.ts', 'const chain = { from: () => chain, where: () => chain, all: () => { globalThis.__trComposition.observed.databaseReads++; return []; } }; export const dbServer = { select: () => chain, insert: () => { throw new Error("DB_WRITE_FORBIDDEN"); } }; export const runDbServerImmediateTransaction = () => { throw new Error("TRANSACTION_FORBIDDEN"); };'],
    ['lib/schema.ts', 'export const settings = { key: "key", value: "value" }; export const patients = { id: "id", version: "version" }; export const patientsToAmbulatories = { patientId: "patientId", ambulatoryId: "ambulatoryId" };'],
    ['lib/security/server-auth.ts', 'export const requireSession = async () => null; export const requireSessionOrLocalToken = async () => globalThis.__trComposition.allowStatus ? { id: "synthetic-status-reader" } : null; export const unauthorizedResponse = () => Response.json({ error: "unauthorized" }, { status: 401 }); export const acquireAuthenticatedWebSessionProjectionOwnerContext = async () => { throw new Error("CLINICAL_CONTEXT_FORBIDDEN"); };'],
    ['lib/security/server-session.ts', forbid('registerServerSessionResource')],
    ['lib/patient-lifecycle.ts', forbid('activePatients')],
    ['lib/athena-mlx-runtime.ts', 'export const defaultAthenaMlxModelDir = () => "synthetic-unavailable-mlx"; export const isAthenaMlxModelAvailable = () => false; export const generateWithAthenaMlx = () => { throw new Error("INFERENCE_FORBIDDEN"); };'],
    ['lib/ai-providers/fabric/provider-lifecycle-service.ts', unavailable],
    ['lib/ai-providers/fabric/document-synthesis-production-operation.ts', forbid('acquireDocumentSynthesisProductionOperation')],
    ['lib/ai-providers/fabric/patient-insight-authenticated-preview-production.ts', forbid('acquireAuthenticatedPatientInsightPreview')],
    ['lib/security/server-session-authenticated-smart-import-preview-production.ts', forbid('acquireAuthenticatedSmartImportPreview')],
    ['lib/reference-data/icd11-who-production.ts', forbid('getIcd11WhoProductionRuntime')],
]);
const canonical = url => url === virtual ? provisioningFile : fileURLToPath(url);
registerHooks({
    resolve(specifier, context, next) {
        if (specifier === 'server-only') return fixture('export {};');
        if (specifier === 'next/server') return fixture('export const NextResponse = Response; export const NextRequest = Request;');
        if (specifier === 'drizzle-orm') return fixture('export const inArray = () => null; export const eq = () => null; export const and = () => null;');
        if (specifier === '@mediflow/web-auth-lifecycle-owner') return { url: pathToFileURL(path.join(source, 'packages/web-auth-lifecycle-owner/index.js')).href, shortCircuit: true };
        let base;
        if (specifier.startsWith('@/')) base = path.join(source, specifier.slice(2));
        else if (specifier.startsWith('file:')) base = fileURLToPath(specifier);
        else if (specifier.startsWith('.')) base = path.resolve(path.dirname(canonical(context.parentURL)), specifier);
        else return next(specifier, context);
        for (const candidate of [base, base + '.ts', base + '.tsx', base + '.mjs', base + '.js', path.join(base, 'index.ts')]) {
            const relative = path.relative(source, candidate).split(path.sep).join('/');
            if (leaves.has(relative)) return fixture(leaves.get(relative));
            if (savedExists(candidate) && savedStat(candidate).isFile()) return {
                url: candidate === provisioningFile ? virtual : pathToFileURL(candidate).href, shortCircuit: true,
            };
        }
        return next(specifier, context);
    },
    load(url, context, next) {
        if (url === virtual || (url.startsWith('file:') && url.endsWith('.ts'))) {
            const filename = canonical(url);
            const relative = path.relative(source, filename).split(path.sep).join('/');
            observed.imported.push(relative);
            return { format: 'module', shortCircuit: true,
                source: stripTypeScriptTypes(savedRead(filename, 'utf8'), { mode: 'transform', sourceUrl: url }) };
        }
        return next(url, context);
    },
});
const load = relative => import(pathToFileURL(path.join(source, relative)).href);
// Start with the actual failing entry point. Its production preferences module
// and the provisioning constructor execute unmodified (apart from type erasure).
for (const lane of ['document-synthesis', 'patient-insight', 'smart-import', 'treatment-reasoning']) {
    const route = await load('app/api/ai/' + lane + '/preview/route.ts');
    assert.equal(typeof route.POST, 'function');
    const denied = await route.POST(new Request('http://localhost/api/ai/' + lane + '/preview', { method: 'POST' }));
    assert.equal(denied.status, 401); // Fixture authority denies; no login is simulated.
}
for (const [relative, method] of [
    ['app/api/settings/ai/functions/route.ts', 'GET'],
    ['app/api/settings/ai/functions/preview/route.ts', 'POST'],
    ['app/api/system/function-status/route.ts', 'GET'],
]) {
    const route = await load(relative);
    assert.equal((await route[method](new Request('http://localhost/fixture'))).status, 401);
}
const ingest = await load('app/api/ai/treatment-reasoning/ingest/route.ts');
assert.equal(typeof ingest.POST, 'function');
const preferences = await load('lib/ai-providers/fabric/function-model-preferences-production.ts');
const sources = preferences.readProductionFunctionModelSources();
const state = input.platform === 'darwin' ? 'platform_unsupported' : 'NEEDS_CONTEXT';
if (input.platform === 'darwin') assert.equal(sources.portable, undefined);
else { assert.equal(sources.portable.state, state); assert.equal(sources.portable.selected, false); }
const v1 = preferences.functionModelPreferencesService.read('v1');
const v2 = preferences.functionModelPreferencesService.read('v2');
assert.equal(v1.schemaVersion, 'mediflow.function-preferences.v1');
assert.equal(v2.schemaVersion, 'mediflow.function-preferences.v2');
assert.equal(v1.catalogRevision, v2.catalogRevision);
assert.equal(v1.functions.flatMap(item => item.options).some(item => item.provider === 'athena_transformers'), false);
const runtime = await load('lib/ai-providers/fabric/treatment-reasoning-portable-runtime.ts');
const instance = runtime.createTreatmentReasoningPortableRuntime();
assert.equal(instance.status().state, state);
await assert.rejects(instance.prepare(), error => error.code === 'runtime_unavailable');
const statusRoute = await load('app/api/ai/fabric/status/route.ts');
assert.equal((await statusRoute.GET(new Request('http://localhost/api/ai/fabric/status'))).status, 401);
globalThis.__trComposition.allowStatus = true; // Status-reader unit fixture, not an auth/E2E assertion.
const request = version => new Request('http://localhost/api/ai/fabric/status', {
    headers: version === null ? {} : { 'x-mediflow-fabric-status': version },
});
const legacy = await (await statusRoute.GET(request(null))).json();
assert.equal(legacy.schemaVersion, 'mediflow.ai.fabric-status.v1');
assert.deepEqual(await (await statusRoute.GET(request('1'))).json(), legacy);
const reply = await statusRoute.GET(request('2')); const body = await reply.json();
assert.equal(reply.headers.get('x-mediflow-fabric-status'), '2');
assert.deepEqual(body.legacy, legacy);
assert.equal(body.treatmentReasoning.state, state);
assert.equal(body.treatmentReasoning.runtimeObservation, 'not_observed');
assert.equal(body.treatmentReasoning.configurationDisposition, 'blocked');
const disclosure = await load('lib/ai-providers/fabric/treatment-reasoning-portable-disclosure.ts');
assert.doesNotThrow(() => disclosure.parseTreatmentReasoningPortableDisclosure(body.treatmentReasoning));
assert.equal((await statusRoute.GET(request('unknown'))).status, 400);
const cli = await load('scripts/treatment-reasoning-portable-setup.mjs');
assert.equal((await cli.runPortableSetup(['status'])).state, state);
assert.equal((await cli.runPortableSetup(['hardware'])).qualification, 'not_observed');
await assert.rejects(cli.runPortableSetup(['import']), error => error.code === 'consent_required');
assert.equal(observed.workerAccesses, 0); assert.equal(observed.executions, 0); assert.equal(observed.mutations, 0);
for (const name of [
    'lib/ai-providers/fabric/treatment-reasoning-portable-provisioning.ts',
    'lib/ai-providers/fabric/function-model-preferences-production.ts',
    'lib/ai-providers/fabric/treatment-reasoning-portable-runtime.ts',
    'lib/ai-providers/fabric/treatment-reasoning-production-root.ts',
    'app/api/ai/fabric/status/route.ts',
]) assert.ok(observed.imported.includes(name), name + ' must actually execute');
console.log(JSON.stringify({ check: 'actual-source-composition-non-file-origin', platformFixture: input.platform,
    unsetData: input.unsetData, state, workerAccesses: observed.workerAccesses, executions: observed.executions,
    mutations: observed.mutations, sourceModules: new Set(observed.imported).size, nextBuild: false }));
`;

for (const platform of ['darwin', 'linux', 'win32']) {
    for (const unsetData of [false, true]) {
        test(`production caller graph with non-file provisioning origin: ${platform}, data ${unsetData ? 'unset' : 'empty'}`, t => {
            const dir = directory(t);
            const applicationRoot = path.join(dir, 'empty launcher root'); fs.mkdirSync(applicationRoot);
            const data = path.join(dir, 'empty data'); fs.mkdirSync(data);
            const source = path.dirname(path.dirname(script));
            const result = spawnSync(process.execPath, ['--input-type=module', '-e', compositionProbe], {
                cwd: applicationRoot, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
                env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', MEDIFLOW_DATA_DIR: data,
                    TR_COMPOSITION_FIXTURE: JSON.stringify({ source, platform, unsetData }) },
            });
            assert.equal(result.error, undefined); assert.equal(result.signal, null);
            assert.equal(result.status, 0, result.stderr);
            const receipt = JSON.parse(result.stdout.trim());
            assert.equal(receipt.nextBuild, false); assert.equal(receipt.workerAccesses, 0);
            assert.equal(receipt.executions, 0); assert.equal(receipt.mutations, 0);
            assert.deepEqual(fs.readdirSync(data), []); assert.deepEqual(fs.readdirSync(applicationRoot), []);
        });
    }
}

/* @Codex: relocated source closure, not a generated Next standalone bundle. */
function relocatedCliFixture(t) {
    const dir = directory(t); const app = path.join(dir, 'relocated app');
    const elsewhere = path.join(dir, 'operator cwd'); fs.mkdirSync(elsewhere);
    const source = path.dirname(path.dirname(script));
    for (const relative of [...TREATMENT_PORTABLE_SOURCE_CLOSURE, 'package.json']) {
        const target = path.join(app, relative); fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(source, relative), target);
    }
    const data = path.join(dir, 'synthetic data');
    const incoming = path.join(data, 'treatment-reasoning-portable/incoming');
    const worker = path.join(app, 'scripts/treatment-reasoning-portable-worker.py');
    const payloads = {
        'model/config.json': JSON.stringify({ model_type: 'qwen3' }),
        'model/tokenizer.json': '{}', 'model/tokenizer_config.json': '{}',
        'model/model.safetensors': 'SYNTHETIC-NOT-WEIGHTS', 'model/LICENSE': 'SYNTHETIC-NOT-A-LICENSE',
        'runtime/python': 'SYNTHETIC-NOT-AN-EXECUTABLE', 'runtime/LICENSE': 'SYNTHETIC-NOT-A-LICENSE',
        'worker/treatment-reasoning-portable-worker.py': fs.readFileSync(worker),
    };
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    for (const [relative, bytes] of Object.entries(payloads)) {
        const target = path.join(incoming, 'artifacts', relative); fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
    }
    const platform = `${process.platform}-${/^(?:aarch64|arm64)$/iu.test(os.machine()) ? 'arm64' : 'x64'}`;
    const manifest = { schemaVersion: 'mediflow.treatment-portable-release.v1', provider: 'athena_transformers',
        model: 'mims-harvard/ATHENA-R1-Qwen3-8B', modelRevision: 'a'.repeat(40), format: 'safetensors', platform,
        sourceRef: 'synthetic:source-only', approvalRef: 'synthetic:not-approved',
        runtime: { python: 'runtime/python', pythonVersion: '0.0.0', transformersVersion: '0.0.0', torchVersion: '0.0.0', sourceRef: 'synthetic:runtime' },
        licenses: { model: 'model/LICENSE', runtime: ['runtime/LICENSE'] }, limits: { memoryBytes: 8 * 1024 ** 3, threads: 1 },
        files: Object.entries(payloads).map(([relative, bytes]) => ({ path: relative, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) })),
    };
    const bytes = JSON.stringify(manifest); const digest = sha(bytes);
    fs.writeFileSync(path.join(incoming, 'release.json'), bytes);
    const invoke = args => spawnSync(process.execPath, [path.join(app, 'scripts/treatment-reasoning-portable-setup.mjs'), ...args], {
        cwd: elsewhere, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', MEDIFLOW_DATA_DIR: data },
    });
    return { data, worker, digest, invoke };
}
// Actual offline import is supported only on these OSes; Mac refusal is covered
// by the real-source composition matrix, not by changing the Mac platform here.
const offlineImportSupported = ['linux', 'win32'].includes(process.platform)
    && /^(?:aarch64|arm64|x86_64|amd64|x64)$/iu.test(os.machine());

test('direct Node CLI uses its relocated application root from an unrelated cwd for synthetic offline import', { skip: !offlineImportSupported }, t => {
    const f = relocatedCliFixture(t);
    const result = f.invoke(['import', '--consent-digest', f.digest]);
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout); assert.equal(status.state, 'needs_activation');
    assert.equal(status.selected, false); assert.equal(status.writesPerformed, 0); assert.equal(status.applyPolicy, 'none');
    assert.equal(fs.existsSync(path.join(f.data, 'treatment-reasoning-portable/selected.json')), false);
});

test('relocated CLI preserves worker verification after import and refuses activation on host-worker tamper', { skip: !offlineImportSupported }, t => {
    const f = relocatedCliFixture(t);
    const imported = f.invoke(['import', '--consent-digest', f.digest]);
    assert.equal(imported.status, 0, imported.stderr);
    fs.appendFileSync(f.worker, '\n# SYNTHETIC RELOCATION TAMPER\n');
    const activation = f.invoke(['activate', '--consent-digest', f.digest]);
    assert.equal(activation.error, undefined); assert.equal(activation.status, 2, activation.stderr);
    assert.deepEqual(JSON.parse(activation.stdout), { status: 'denied', code: 'artifact_tampered', writesPerformed: 0, applyPolicy: 'none' });
    assert.equal(fs.existsSync(path.join(f.data, 'treatment-reasoning-portable/selected.json')), false);
});
