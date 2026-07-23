// WUL-306 (ADR 0066): static guards for the patient soft-delete lifecycle.
// Behavioral tombstone coverage lives in lib/patient-lifecycle.test.ts (bash wrapper:
// scripts/patient-soft-delete-test.sh); these checks pin the route wiring instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const PATIENT_DELETE_ROUTES = [
    { file: 'app/api/v1/patients/[id]/route.ts', deletionReason: 'api-v1-delete' },
    { file: 'app/api/patients/[id]/route.ts', deletionReason: 'web-delete' },
];

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function handlerSource(source, handlerName) {
    const start = source.indexOf(`export async function ${handlerName}`);
    assert.notEqual(start, -1, `Expected ${handlerName} handler`);
    const next = source.indexOf('\nexport async function ', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

test('patient DELETE routes write a version-guarded tombstone instead of a hard delete', () => {
    for (const route of PATIENT_DELETE_ROUTES) {
        const source = read(route.file);
        assert.doesNotMatch(source, /\.delete\(patients\)/, `${route.file} must not hard-delete patients`);

        const deleteBlock = handlerSource(source, 'DELETE');
        assert.match(deleteBlock, new RegExp(`const deletionReason = parsePatientDeletionReason\\(body, '${route.deletionReason}'\\)`), `${route.file} DELETE must parse the optional delete reason with default ${route.deletionReason}`);
        assert.match(deleteBlock, /buildPatientTombstoneValues\(expectedVersion, deletionReason\)/, `${route.file} DELETE must tombstone with the parsed reason`);
        assert.match(deleteBlock, /eq\(patients\.version, expectedVersion\)/, `${route.file} DELETE must stay version-guarded`);
        assert.match(deleteBlock, /activePatients\(\)/, `${route.file} DELETE must not re-delete tombstones`);
        assert.match(deleteBlock, /buildPatientVersionConflictPayload\(/, `${route.file} DELETE must keep the 409 payload`);
        assert.match(deleteBlock, /'patient\.deleted'/, `${route.file} DELETE must keep the patient.deleted audit event`);
    }
});

test('patient GET and PUT handlers hide soft-deleted patients (404 contract)', () => {
    for (const route of PATIENT_DELETE_ROUTES) {
        const source = read(route.file);
        for (const handler of ['GET', 'PUT']) {
            const block = handlerSource(source, handler);
            assert.match(block, /activePatients\(\)/, `${route.file} ${handler} must filter tombstoned patients`);
        }
    }
});

test('db-server keeps the additive ensureColumn guards for the tombstone columns', () => {
    const source = read('lib/db-server.ts');
    assert.match(source, /ensureColumn\('patients', 'deleted_at', 'deleted_at INTEGER'\)/);
    assert.match(source, /ensureColumn\('patients', 'deletion_reason', 'deletion_reason TEXT'\)/);
});

test('primary patient list reads exclude soft-deleted patients', () => {
    for (const file of ['app/api/patients/route.ts', 'app/api/v1/patients/route.ts']) {
        const source = read(file);
        assert.match(source, /activePatients\(\)/, `${file} must filter tombstoned patients from lists`);
    }
});

// WUL-322 (ADR 0066 Slice 3): the test-container clear must select victims via the
// M2M membership and tombstone them, never via the stale legacy patients.ambulatoryId
// column (WUL-300 constraint), never as a hard delete.
/* @Codex */
test('ambulatories/clear is membership-based, soft-deletes and stays test-only', () => {
    const routeSource = read('app/api/ambulatories/clear/route.ts');
    const writeSource = read('lib/ambulatory-write.ts');
    const clearServiceSource = handlerSource(writeSource, 'clearAmbulatory');

    assert.match(routeSource, /clearAmbulatory\(\{ request, session \}, ambulatoryId, body\.version\)/, 'clear route must delegate to the ambulatory write service');
    assert.doesNotMatch(clearServiceSource, /\.delete\(patients\)/, 'clear must never hard-delete patients');
    assert.doesNotMatch(clearServiceSource, /patients\.ambulatoryId/, 'clear must not select patients via the stale legacy column (WUL-300)');
    assert.match(clearServiceSource, /clearTestContainerByMembership\(/, 'clear service must go through the membership-based helper');
    assert.match(clearServiceSource, /dbServer\.transaction\(/, 'clear service must run in one synchronous transaction');

    // (e) the non-test safety check stays: clearing a LIVE ambulatory is rejected.
    assert.match(clearServiceSource, /type !== 'test'/, 'clear must keep the test-only safety check');
    assert.match(clearServiceSource, /status: 403/, 'clearing a non-test ambulatory must stay rejected');

    // (d) one patient.deleted audit event per cleared patient, PHI-safe metadata only.
    assert.match(clearServiceSource, /clearedPatientVersions: result\.clearedPatients/, 'clear service must retain the membership-clear result for auditing');
    assert.match(clearServiceSource, /for \(const item of cleared\)/, 'clear must audit each cleared patient');
    assert.match(clearServiceSource, /'patient\.deleted'/, 'clear must emit the patient.deleted audit event');
    assert.match(clearServiceSource, /reasonCode: TEST_CONTAINER_CLEAR_REASON/, 'audit metadata must carry the dedicated deletion reason');
});

test('the membership-clear helper tombstones with the dedicated reason', () => {
    const source = read('lib/test-container-clear.ts');
    assert.match(source, /TEST_CONTAINER_CLEAR_REASON = 'test-container-clear'/);
    assert.match(source, /buildPatientTombstoneValues\(/, 'helper must reuse the WUL-306 tombstone builder');
    assert.doesNotMatch(source, /\.delete\(patients\)/, 'helper must never hard-delete patients');
    assert.doesNotMatch(source, /patients\.ambulatoryId/, 'helper must not read the stale legacy column (WUL-300)');
});

// ADR 0066 allowlist guard (WUL-316 style): unfiltered reads are intentional only
// at these stable AST fingerprints. The number is the expected multiplicity.
const UNFILTERED_PATIENTS_READ_ALLOWLIST = [
    ['app/api/system/backup-restore/route.ts', 'tx.select().from(patients).all()', 1],
    ['app/api/system/fix-orphans/route.ts', 'dbServer.select({ id: patients.id }).from(patients)', 2],
    ['app/api/system/migrate/route.ts', 'dbServer.select().from(patients).where(isNull(patients.ambulatoryId))', 1],
    ['app/api/system/migrate-m2m/route.ts', 'dbServer.select().from(patients).where(isNotNull(patients.ambulatoryId))', 1],
    ['app/api/system/purge-patient/route.ts', 'dbServer .select({ id: patients.id, version: patients.version, deletedAt: patients.deletedAt }) .from(patients) .where(eq(patients.id, patientId)) .get()', 1],
    ['app/api/system/restore-patient/route.ts', 'dbServer .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, deletedAt: patients.deletedAt, deletionReason: patients.deletionReason, version: patients.version, }) .from(patients) .where(isNotNull(patients.deletedAt)) .orderBy(desc(patients.deletedAt))', 1],
    ['app/api/system/restore-patient/route.ts', 'dbServer .select({ id: patients.id, version: patients.version, deletedAt: patients.deletedAt }) .from(patients) .where(eq(patients.id, patientId)) .get()', 1],
    ['lib/network-patient-lifecycle.ts', 'tx .select({ id: patients.id, version: patients.version, updatedAt: patients.updatedAt, isArchived: patients.isArchived, }) .from(patients) .where(and(eq(patients.id, patientId), isNotNull(patients.deletedAt))) .get()', 1],
    ['lib/network-patient-lifecycle.ts', 'tx .select({ patient: patients }) .from(patients) .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId)) .where(and(eq(patients.id, context.patientId), eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId), isNotNull(patients.deletedAt))) .get()', 1],
    ['lib/network-patient-read.ts', 'dbServer .select({ patient: patients }) .from(patients) .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId)) .where(and(...filters)) .orderBy(desc(patients.updatedAt))', 1],
    ['lib/patient-cascade.ts', 'runner.select({ id: patients.id }).from(patients)', 2],
];

const PATIENTS_HARD_DELETE_ALLOWLIST = new Set([
    'app/api/system/purge-patient/route.ts', // ADR 0066 audited admin erasure
    'app/api/system/backup-restore/route.ts', // restore clears tables via TABLE_LOOKUP
]);

function* walkSources(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* walkSources(entryPath);
            continue;
        }
        if (!entry.isFile()) continue;
        if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith('.test.ts')) continue;
        yield entryPath;
    }
}

// @Codex
const AST_PRINTER = ts.createPrinter({ removeComments: true });

function propertyName(call) {
    return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : null;
}

function directReceiverCall(call) {
    const parent = call.parent;
    return ts.isPropertyAccessExpression(parent) && parent.expression === call && ts.isCallExpression(parent.parent)
        ? parent.parent
        : null;
}

function isFromPatients(node) {
    return ts.isCallExpression(node)
        && propertyName(node) === 'from'
        && node.arguments.length === 1
        && ts.isIdentifier(node.arguments[0])
        && node.arguments[0].text === 'patients';
}

function isActivePatientsPredicate(node) {
    if (ts.isFunctionLike(node)) return false;
    if (!ts.isCallExpression(node)) return false;
    if (ts.isIdentifier(node.expression) && node.expression.text === 'activePatients') return node.arguments.length === 0;
    return ts.isIdentifier(node.expression) && node.expression.text === 'and'
        && node.arguments.some(isActivePatientsPredicate);
}

function patientReadIsFiltered(fromCall) {
    for (let call = fromCall; call; call = directReceiverCall(call)) {
        if (propertyName(call) === 'where' && call.arguments.some(isActivePatientsPredicate)) return true;
    }
    return false;
}

function patientReadFingerprint(sourceFile, fromCall) {
    let query = fromCall;
    for (let next = directReceiverCall(query); next; next = directReceiverCall(query)) query = next;
    return AST_PRINTER.printNode(ts.EmitHint.Unspecified, query, sourceFile).replace(/\s+/g, ' ').trim();
}

function scriptKind(relativePath) {
    return relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function unfilteredPatientReads(relativePath, source) {
    const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, scriptKind(relativePath));
    assert.equal(sourceFile.parseDiagnostics.length, 0, `Cannot parse ${relativePath}: ${sourceFile.parseDiagnostics.map(({ code }) => code).join(', ')}`);
    const reads = [];
    const visit = (node) => {
        if (isFromPatients(node) && !patientReadIsFiltered(node)) {
            reads.push({ relativePath, fingerprint: patientReadFingerprint(sourceFile, node) });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return reads;
}

function assertAllowlistedPatientReads(reads, allowlist = UNFILTERED_PATIENTS_READ_ALLOWLIST) {
    const pending = new Map(allowlist.map(([relativePath, fingerprint, count]) => [`${relativePath}\0${fingerprint}`, count]));
    for (const read of reads) {
        const key = `${read.relativePath}\0${read.fingerprint}`;
        const count = pending.get(key);
        assert.notEqual(count, undefined, `Unexpected unfiltered patient read: ${read.relativePath} :: ${read.fingerprint}`);
        if (count === 1) pending.delete(key);
        else pending.set(key, count - 1);
    }
    assert.equal(pending.size, 0, `Stale unfiltered patient-read allowlist entries: ${[...pending.keys()].join(', ')}`);
}

test('AST guard isolates direct patient-read chains and normalizes their fingerprints', () => {
    const source = [
        'db.select().from(patients).where(activePatients()).get();',
        'db.select()\n  .from(\n    patients\n  ).where(and(eq(patients.id, id), activePatients())).get();',
        'db . select().from( patients ).where(activePatients()).get();',
        'db.select().from(patients).get();',
        'db.select().from(patients).where(db.select().from(patients).where(activePatients()).get()).get();',
        'db.select().from(patients).where(activePatients()).get() ?? db.select().from(patients).get();',
        'const marker = `;`; db.select().from(patients).where(() => activePatients()).get();',
    ].join('\n');
    const reads = unfilteredPatientReads('synthetic.ts', source);
    assert.equal(reads.length, 4, 'only direct activePatients() filters the owning chain');
    const baseline = unfilteredPatientReads('synthetic.ts', 'db.select().from(patients).get();');
    const shifted = unfilteredPatientReads('synthetic.ts', '\n\n db . select() . from( patients ).get();');
    assert.equal(baseline[0].fingerprint, shifted[0].fingerprint, 'line shifts and whitespace keep the fingerprint stable');
    const assertion = 'const value = <Foo>input; db.select().from(patients).get();';
    assert.equal(unfilteredPatientReads('synthetic.ts', assertion).length, 1, 'a .ts type assertion must keep its read visible');
    assert.throws(() => unfilteredPatientReads('synthetic.tsx', assertion), /Cannot parse synthetic\.tsx/);
    assert.throws(() => unfilteredPatientReads('synthetic.ts', 'const value = ;'), /Cannot parse synthetic\.ts/);
});

test('AST allowlist consumes fingerprints and rejects stale, substituted, or duplicate reads', () => {
    const path = 'synthetic.ts';
    const baseline = unfilteredPatientReads(path, 'db.select().from(patients).get();');
    const allowlist = [[path, baseline[0].fingerprint, 1]];
    assert.doesNotThrow(() => assertAllowlistedPatientReads(baseline, allowlist));
    assert.throws(() => assertAllowlistedPatientReads(unfilteredPatientReads(path, 'db.select({ id: patients.id }).from(patients).get();'), allowlist));
    assert.throws(() => assertAllowlistedPatientReads(unfilteredPatientReads(path, 'db.select().from(patients).get(); db.select().from(patients).get();'), allowlist));
});

test('patients table access stays behind activePatients() outside the allowlist', () => {
    const unfilteredReads = [];
    for (const root of ['app', 'lib']) {
        for (const filePath of walkSources(path.join(ROOT_DIR, root))) {
            const relativePath = path.relative(ROOT_DIR, filePath);
            const source = fs.readFileSync(filePath, 'utf8');
            unfilteredReads.push(...unfilteredPatientReads(relativePath, source));

            if (source.includes('.delete(patients)')
                && !PATIENTS_HARD_DELETE_ALLOWLIST.has(relativePath)) {
                assert.fail(`${relativePath} hard-deletes patients outside the ADR 0066 allowlist`);
            }
        }
    }
    assertAllowlistedPatientReads(unfilteredReads);
});
