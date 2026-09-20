/* @Codex: actual Next route + Drizzle/better-sqlite3 + physical owner 0.8.7.
 * Test-only HTTP context/cookie/audit seams are NOT a real middleware/login proof.
 * No production fault flag, alternate owner or real database. Original runner required. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { patients, ambulatories, patientsToAmbulatories } from '../../../lib/schema.ts';
import type * as Owner from '@mediflow/web-auth-lifecycle-owner';
import type { PatientCreatePreviewContext } from '../../../lib/security/patient-create-context.ts';

const load = createRequire(import.meta.url);
const ownerPath = load.resolve('@mediflow/web-auth-lifecycle-owner');
const owner = load(ownerPath) as typeof Owner;
const { registerHooks } = load('node:module') as {
    registerHooks: (hooks: { resolve: (specifier: string, context: { parentURL?: string },
        next: (specifier: string, context: { parentURL?: string }) => { url: string }) => { url: string; shortCircuit?: boolean } }) => { deregister: () => void };
};
function issue(index: number): Owner.WebSessionProjection {
    const control = owner.bootstrapControl(); assert(control);
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: `synthetic-route-${index}` }); assert(attempt);
    const issued = owner.issue(attempt, { id: 'synthetic-route-user', username: 'synthetic-route-user', role: 'admin' }); assert(issued);
    const resolution = owner.resolve(issued.sessionId, control.controlId); assert.equal(resolution.status, 'active');
    if (resolution.status !== 'active') throw new Error('Synthetic physical session unavailable');
    return resolution.projection;
}
const input = (id: string) => ({ id, firstName: 'Ada', lastName: 'Sintetica', taxCode: 'SYNTHETIC0000001',
    address: 'ENC:synthetic:opaque', phone: 'ENC:synthetic:opaque', ambulatoryId: 'synthetic-B' });
const fencedHeaders = (preview: PatientCreatePreviewContext) => ({
    'Content-Type': 'application/json', 'X-MediFlow-Patient-Create-Mode': 'fixed-preview-v1',
    'X-MediFlow-Patient-Create-Context': preview.nonce, 'X-MediFlow-Patient-Create-Target': preview.ambulatoryId,
});

test('actual patient HTTP route boundaries on synthetic SQL', async t => {
    assert.equal(JSON.parse(readFileSync(join(dirname(ownerPath), 'package.json'), 'utf8')).version, '0.8.7');
    assert.equal(createHash('sha256').update(readFileSync(ownerPath)).digest('hex'), '1abc52ee8abe9fd25b28046f1f00ecc2f09d699ba220c61e6222730c22ca44c5');
    // Register cleanup before acquiring resources. Run every disposer even if an
    // import/assertion (or another disposer) fails; never swallow cleanup errors.
    const cleanups: (() => void)[] = [];
    t.after(() => {
        const errors: unknown[] = [];
        for (const cleanup of cleanups.reverse()) {
            try { cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length > 0) throw new AggregateError(errors, 'Synthetic route fixture cleanup failed');
    });
    const sql = new BetterSqlite3(':memory:'); cleanups.push(() => sql.close());
    sql.pragma('foreign_keys = ON');
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    // All columns/types are read from the unchanged schema. Drizzle applies its
    // declared defaults to INSERTs; only these three synthetic tables are created.
    for (const table of [ambulatories, patients, patientsToAmbulatories]) {
        const config = getTableConfig(table);
        const columns = config.columns.map(column => `${quote(column.name)} ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}`);
        if (table === patients) columns.push('FOREIGN KEY(ambulatory_id) REFERENCES ambulatories(id)');
        if (table === patientsToAmbulatories) columns.push('PRIMARY KEY(patient_id,ambulatory_id)',
            'FOREIGN KEY(patient_id) REFERENCES patients(id)', 'FOREIGN KEY(ambulatory_id) REFERENCES ambulatories(id)');
        sql.exec(`CREATE TABLE ${quote(config.name)}(${columns.join(',')})`);
    }
    const database = drizzle(sql);
    database.insert(ambulatories).values([
        { id: 'synthetic-A', name: 'Ambulatorio sintetico A', isDefault: true },
        { id: 'synthetic-B', name: 'Ambulatorio sintetico B', isDefault: false },
    ]).run();
    const state = { database, session: null as Owner.WebSessionProjection | null, cookie: 'synthetic-A' as string | undefined,
        cookieReads: 0, authReads: 0, audit: [] as unknown[] };
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'mediflow-patient-route-'));
    cleanups.push(() => rmSync(fixtureDirectory, { recursive: true, force: true }));
    // A fresh directory also gives this fixture its own global slot/cache URLs.
    const stateKey = Symbol.for(fixtureDirectory);
    const globals = globalThis as unknown as Record<symbol, typeof state>;
    globals[stateKey] = state; cleanups.push(() => { delete globals[stateKey]; });
    const prelude = `const state=globalThis[Symbol.for(${JSON.stringify(fixtureDirectory)})];
if (!state) throw new Error('Synthetic route fixture is no longer active');
`;
    // Only the original four seams are substituted. Real .cjs files work with
    // the unchanged loader's CommonJS route emission; no data URLs or SQL mocks.
    const replacements: Record<string, string> = {
        '@/lib/db-server': 'exports.dbServer=state.database;',
        'next/headers': `exports.cookies=async function(){state.cookieReads++;return {get(name){return name==='ambulatory_id'&&state.cookie ? {value:state.cookie}:undefined}}};`,
        '@/lib/security/server-auth': `exports.requireSession=async function(){state.authReads++;return state.session};
            exports.unauthorizedResponse=function(){return Response.json({error:'Unauthorized'},{status:401})};`,
        '@/lib/security/audit': `exports.auditContextFromSession=()=>({actorType:'user',actorRef:'synthetic-route-user',sourceSurface:'web'});
            exports.listChangedFields=(body,excluded)=>Object.keys(body).filter(key=>!excluded.includes(key));
            exports.requestIdFromRequest=()=>null;
            exports.withAuditContextMetadata=(_context,metadata)=>metadata;
            exports.writeAuditEvent=async event=>{state.audit.push(event)};`,
    };
    const fixtureUrls = new Map<string, string>();
    const ownedModulePaths = new Set<string>();
    // Resolve, but do not evaluate, the two consumers. Refuse a preloaded route
    // instead of silently reusing exports that were bound before our hooks.
    const routePath = load.resolve('./route.ts');
    const captureRoutePath = load.resolve('./create-context/route.ts');
    for (const modulePath of [routePath, captureRoutePath]) {
        assert.equal(load.cache[modulePath], undefined, 'Route must be loaded after fixture registration');
        ownedModulePaths.add(modulePath);
    }
    cleanups.push(() => {
        // Remove only the two owned consumers and four fixture modules, not
        // Drizzle, the physical owner, or any unrelated module cache entries.
        for (const cached of Object.values(load.cache)) {
            if (cached) cached.children = cached.children.filter(child => !ownedModulePaths.has(child.id));
        }
        for (const modulePath of ownedModulePaths) delete load.cache[modulePath];
    });
    for (const [specifier, source] of Object.entries(replacements)) {
        const fixturePath = join(fixtureDirectory, `seam-${fixtureUrls.size}.cjs`);
        writeFileSync(fixturePath, prelude + source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        ownedModulePaths.add(fixturePath);
        fixtureUrls.set(specifier, pathToFileURL(fixturePath).href);
    }
    const hooks = registerHooks({ resolve(specifier, context, next) {
        const url = fixtureUrls.get(specifier);
        return url === undefined ? next(specifier, context) : { url, shortCircuit: true };
    } });
    cleanups.push(() => hooks.deregister());
    // The canonical loader emits both routes as CommonJS. Loading them through
    // this existing createRequire keeps their cache lifetime under our cleanup;
    // the type-only imports do not evaluate a route before hook registration.
    const route = load(routePath) as typeof import('./route.ts');
    const captureRoute = load(captureRoutePath) as typeof import('./create-context/route.ts');
    let sequence = 0;
    const rows = (table: 'patients' | 'patients_to_ambulatories') => sql.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
    const reset = () => {
        sql.exec('DELETE FROM patients_to_ambulatories; DELETE FROM patients');
        state.cookie = 'synthetic-A'; state.cookieReads = 0; state.authReads = 0; state.audit = [];
        state.session = issue(++sequence); const session = state.session;
        return () => { owner.retire(session, 'dispose'); state.session = null; };
    };
    const capture = async () => {
        const response = await captureRoute.GET(); assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        return await response.json() as PatientCreatePreviewContext;
    };
    const post = (id: string, headers: Record<string, string> = { 'Content-Type': 'application/json' }) => route.POST(new Request('http://synthetic.invalid/api/patients', {
        method: 'POST', headers, body: JSON.stringify(input(id)),
    }));

    await t.test('preview GET is authenticated, named, no-store, metadata-only and does not create patients', async st => {
        st.after(reset()); const preview = await capture();
        assert.deepEqual(Object.keys(preview).sort(), ['ambulatoryId', 'ambulatoryName', 'expiresAt', 'nonce', 'version']);
        assert.equal(preview.ambulatoryId, 'synthetic-A'); assert.equal(preview.ambulatoryName, 'Ambulatorio sintetico A');
        assert.match(preview.nonce, /^[a-f0-9]{64}$/u); assert(preview.expiresAt > Date.now());
        assert.deepEqual(rows('patients'), []); assert.deepEqual(rows('patients_to_ambulatories'), []);
        assert.equal(state.audit.length, 0); assert.equal(state.authReads, 1);
    });
    await t.test('captured A then cookie B: fenced POST ignores cookie/body B and persists BOTH SQL rows in A', async st => {
        st.after(reset()); const preview = await capture(); const reads = state.cookieReads; state.cookie = 'synthetic-B';
        const response = await post('synthetic-fixed-A', fencedHeaders(preview)); assert.equal(response.status, 201);
        assert.equal(state.cookieReads, reads); assert.equal(rows('patients')[0].ambulatory_id, 'synthetic-A');
        assert.equal(rows('patients_to_ambulatories')[0].ambulatory_id, 'synthetic-A');
        assert.equal(rows('patients')[0].address, input('x').address); assert.equal(rows('patients')[0].phone, input('x').phone);
        assert.equal(state.audit.length, 1); assert.equal(JSON.stringify(state.audit).includes(preview.nonce), false);
        assert.deepEqual(await response.json(), { id: 'synthetic-fixed-A' });
    });
    await t.test('no new headers: legacy add uses current B and original audit/201 contract', async st => {
        st.after(reset()); state.cookie = 'synthetic-B';
        assert.equal((await post('synthetic-legacy-B')).status, 201);
        assert.equal(state.cookieReads, 1); assert.equal(rows('patients')[0].ambulatory_id, 'synthetic-B');
        assert.equal(rows('patients_to_ambulatories')[0].ambulatory_id, 'synthetic-B'); assert.equal(state.audit.length, 1);
    });
    await t.test('legacy missing cookie still uses unchanged default A, ignoring body B', async st => {
        st.after(reset()); state.cookie = undefined;
        assert.equal((await post('synthetic-legacy-default')).status, 201);
        assert.equal(rows('patients')[0].ambulatory_id, 'synthetic-A'); assert.equal(rows('patients_to_ambulatories')[0].ambulatory_id, 'synthetic-A');
    });
    const malformedHeaders: Record<string, string>[] = [
        { 'X-MediFlow-Patient-Create-Mode': 'fixed-preview-v1' },
        { 'X-MediFlow-Patient-Create-Context': 'a'.repeat(64) },
        { 'X-MediFlow-Patient-Create-Target': 'synthetic-A' },
        { 'X-MediFlow-Patient-Create-Mode': 'other', 'X-MediFlow-Patient-Create-Context': 'a'.repeat(64), 'X-MediFlow-Patient-Create-Target': 'synthetic-A' },
    ];
    for (const malformed of malformedHeaders) await t.test(`invalid/partial fenced headers deny without legacy fallback: ${Object.keys(malformed).join(',')}`, async st => {
        st.after(reset()); const response = await post('synthetic-denied', malformed);
        assert.equal(response.status, 400); assert.equal(state.cookieReads, 0);
        assert.deepEqual(rows('patients'), []); assert.deepEqual(rows('patients_to_ambulatories'), []); assert.equal(state.audit.length, 0);
    });
    await t.test('well-formed but unknown nonce denies 409 with zero SQL and zero cookie reads', async st => {
        st.after(reset()); const response = await post('synthetic-unknown', fencedHeaders({ version: 1, nonce: 'f'.repeat(64),
            ambulatoryId: 'synthetic-A', ambulatoryName: 'Unused', expiresAt: Date.now() + 1_000 }));
        assert.equal(response.status, 409); assert.equal(state.cookieReads, 0); assert.deepEqual(rows('patients'), []);
        assert.deepEqual(rows('patients_to_ambulatories'), []);
    });
    await t.test('same operator with new genuine generation cannot reuse previous preview', async st => {
        st.after(reset()); const old = state.session!; const preview = await capture();
        owner.retire(old, 'dispose'); state.session = issue(++sequence); const replacement = state.session;
        st.after(() => owner.retire(replacement, 'dispose')); state.cookieReads = 0;
        assert.equal((await post('synthetic-generation', fencedHeaders(preview))).status, 409);
        assert.deepEqual(rows('patients'), []); assert.deepEqual(rows('patients_to_ambulatories'), []); assert.equal(state.cookieReads, 0);
    });
    await t.test('captured target removed before POST: zero rows, no B/default fallback', async st => {
        st.after(reset()); const preview = await capture(); sql.prepare('DELETE FROM ambulatories WHERE id=?').run('synthetic-A');
        st.after(() => database.insert(ambulatories).values({ id: 'synthetic-A', name: 'Ambulatorio sintetico A', isDefault: true }).run());
        state.cookie = 'synthetic-B'; state.cookieReads = 0;
        assert.equal((await post('synthetic-missing-target', fencedHeaders(preview))).status, 409);
        assert.deepEqual(rows('patients'), []); assert.deepEqual(rows('patients_to_ambulatories'), []); assert.equal(state.cookieReads, 0);
    });
    await t.test('capture never falls back from an explicit missing target and caps generation entries', async st => {
        st.after(reset()); state.cookie = 'missing-synthetic'; assert.equal((await captureRoute.GET()).status, 409);
        state.cookie = 'synthetic-A'; for (let i = 0; i < 8; i += 1) await capture();
        assert.equal((await captureRoute.GET()).status, 409); assert.deepEqual(rows('patients'), []);
    });
    await t.test('unauthenticated POST and capture deny before body, cookie or patient access', async st => {
        st.after(reset()); state.session = null;
        const response = await route.POST(new Request('http://synthetic.invalid/api/patients', { method: 'POST', body: 'not JSON' }));
        assert.equal(response.status, 401); assert.equal((await captureRoute.GET()).status, 401);
        assert.equal(state.cookieReads, 0); assert.equal(state.authReads, 2); assert.deepEqual(rows('patients'), []);
    });
});
