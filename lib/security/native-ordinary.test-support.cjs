/* @Codex — explicit synthetic DB-row/transport fixture. NEVER replaces an issuer. */
'use strict';
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const sourceOwner = path.join(root, 'packages/web-auth-lifecycle-owner/index.js');
if (!process.env.MEDIFLOW_DATA_DIR || !path.isAbsolute(process.env.MEDIFLOW_DATA_DIR)) throw new Error('EXPLICIT_SYNTHETIC_DATA_DIR_REQUIRED');
const originalLoad = Module._load, originalResolve = Module._resolveFilename;
const schema = {};
for (const [table, names] of Object.entries({
    settings: ['key', 'value'], users: ['id', 'username', 'role'], patients: ['id', 'version', 'deletedAt', 'isArchived'],
    ambulatories: ['id'], patientsToAmbulatories: ['patientId', 'ambulatoryId'],
})) schema[table] = Object.fromEntries([['$table', table], ...names.map(name => [name, { table, name }])]);
const rows = { settings: [], users: [], patients: [], ambulatories: [], patientsToAmbulatories: [] };
const drizzle = { eq: (column, value) => row => row[column.name] === value,
    and: (...parts) => row => parts.every(part => !part || part(row)),
    isNull: column => row => row[column.name] == null };
const dbServer = { select(fields) {
    let table, predicate = () => true;
    const query = { from(value) { table = value.$table; return query; }, where(value) { predicate = value; return query; },
        get() { const row = rows[table].find(predicate); return row && Object.fromEntries(Object.entries(fields).map(([key, col]) => [key, row[col.name]])); },
        all() { return rows[table].filter(predicate).map(row => Object.fromEntries(Object.entries(fields).map(([key, col]) => [key, row[col.name]]))); } };
    return query;
} };
const db = { dbServer, runDbServerImmediateTransaction: operation => operation() };
const replacements = new Map([[path.join(root, 'lib/db-server.ts'), db], [path.join(root, 'lib/schema.ts'), schema]]);
// No positive auth callbacks, fake session tokens, C2/OS/drain replacements, or network.
Module._resolveFilename = function(request, parent, ...args) {
    // The fixture must issue through the owner pinned by this source checkout,
    // never an unrelated installation inherited from a coordinating worktree.
    if (request === '@mediflow/web-auth-lifecycle-owner') return sourceOwner;
    if (request.startsWith('@/')) request = path.join(root, request.slice(2));
    return originalResolve.call(this, request, parent, ...args);
};
function fixtureReplacement(request, parent) {
    if (typeof request !== 'string') return null;
    const base = request.startsWith('@/') ? path.join(root, request.slice(2))
        : request.startsWith('.') && typeof parent?.filename === 'string'
            ? path.resolve(path.dirname(parent.filename), request) : null;
    if (!base) return null;
    return [base, `${base}.ts`, `${base}.js`].find(candidate => replacements.has(candidate)) ?? null;
}
Module._load = function(request, parent, ...args) {
    if (request === 'server-only') return {};
    if (request === 'drizzle-orm') return drizzle;
    const replacement = fixtureReplacement(request, parent);
    if (replacement) return replacements.get(replacement);
    let filename;
    try { filename = Module._resolveFilename(request, parent); } catch { /* original loader reports missing modules */ }
    if (replacements.has(filename)) return replacements.get(filename);
    return originalLoad.call(this, request, parent, ...args);
};
// Standalone scoped runner only: global compiler is declared in VALIDATION, not installed into the app.
if (process.env.MEDIFLOW_SCOPED_TYPESCRIPT) {
    const ts = require(process.env.MEDIFLOW_SCOPED_TYPESCRIPT);
    Module._extensions['.ts'] = function(module, filename) {
        const source = fs.readFileSync(filename, 'utf8');
        const emitted = ts.transpileModule(source, { fileName: filename, compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
        } }).outputText;
        module._compile(emitted.replaceAll('import.meta.url', "require('node:url').pathToFileURL(__filename).href"), filename);
    };
}
const owner = require('@mediflow/web-auth-lifecycle-owner');
const user = { id: 'synthetic-native-user', username: 'synthetic-operator', role: 'user' };
const binding = { clientId: 'synthetic-native-mac', clientPlatform: 'macos', tokenHash: 'b'.repeat(64) };
const sessions = [];
function reset() {
    for (const session of sessions.splice(0)) owner.serverSessions.deleteSession(session.id);
    for (const table of Object.keys(rows)) rows[table] = [];
    rows.users.push({ ...user });
    rows.patients.push({ id: 'synthetic-patient', version: 1, deletedAt: null, isArchived: false });
    rows.ambulatories.push({ id: 'synthetic-ambulatory' });
    rows.patientsToAmbulatories.push({ patientId: 'synthetic-patient', ambulatoryId: 'synthetic-ambulatory' });
    setSetting('network.mode', 'network-home-base'); pair();
}
function setSetting(key, value) { rows.settings = rows.settings.filter(row => row.key !== key); rows.settings.push({ key, value }); }
function pair(overrides = {}) {
    const client = { ...binding, deviceName: 'Synthetic Mac', appVersion: '0.8.6', pairedAt: new Date().toISOString(),
        lastSeenAt: null, sourceIntentId: 'synthetic-intent', grantedCapabilities: ['network.ai.central-runtime', 'network.replica.readonly-patients'], ...overrides };
    setSetting('network.pairing.state', JSON.stringify({ clients: [client], intents: [] })); return client;
}
function issue(userOverride = {}, bindingOverride = {}) {
    const session = owner.serverSessions.createNativeServerSession({ ...user, ...userOverride }, { ...binding, ...bindingOverride },
        owner.serverSessions.captureNativeLoginSessionFence());
    assert.ok(session, 'genuine native lifecycle issuance'); sessions.push(session); return session;
}
function web() {
    const control = owner.bootstrapControl(); assert.ok(control);
    const attempt = owner.begin('login', { controlId: control.controlId, ifMatch: control.etag, idempotencyKey: 'synthetic-' + require('node:crypto').randomUUID() });
    assert.ok(attempt); const issued = owner.issue(attempt, user); assert.ok(issued);
    const resolved = owner.resolve(issued.sessionId, control.controlId); assert.equal(resolved.status, 'active');
    return resolved.projection;
}
function replace(relative, exports) { replacements.set(path.join(root, relative), exports); }
reset();
module.exports = { root, rows, db, schema, owner, user, binding, issue, web, reset, pair, setSetting, replace };
