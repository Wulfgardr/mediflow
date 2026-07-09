// WUL-306 (ADR 0066): static guards for the patient soft-delete lifecycle.
// Behavioral tombstone coverage lives in lib/patient-lifecycle.test.ts (bash wrapper:
// scripts/patient-soft-delete-test.sh); these checks pin the route wiring instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
test('ambulatories/clear is membership-based, soft-deletes and stays test-only', () => {
    const source = read('app/api/ambulatories/clear/route.ts');

    assert.doesNotMatch(source, /\.delete\(patients\)/, 'clear must never hard-delete patients');
    assert.doesNotMatch(source, /patients\.ambulatoryId/, 'clear must not select patients via the stale legacy column (WUL-300)');
    assert.match(source, /clearTestContainerByMembership\(/, 'clear must go through the membership-based helper');
    assert.match(source, /dbServer\.transaction\(/, 'clear must run in one synchronous transaction');

    // (e) the non-test safety check stays: clearing a LIVE ambulatory is rejected.
    assert.match(source, /type !== 'test'/, 'clear must keep the test-only safety check');
    assert.match(source, /status: 403/, 'clearing a non-test ambulatory must stay rejected');

    // (d) one patient.deleted audit event per cleared patient, PHI-safe metadata only.
    assert.match(source, /for \(const cleared of result\.clearedPatients\)/, 'clear must audit each cleared patient');
    assert.match(source, /'patient\.deleted'/, 'clear must emit the patient.deleted audit event');
    assert.match(source, /reasonCode: TEST_CONTAINER_CLEAR_REASON/, 'audit metadata must carry the dedicated deletion reason');
});

test('the membership-clear helper tombstones with the dedicated reason', () => {
    const source = read('lib/test-container-clear.ts');
    assert.match(source, /TEST_CONTAINER_CLEAR_REASON = 'test-container-clear'/);
    assert.match(source, /buildPatientTombstoneValues\(/, 'helper must reuse the WUL-306 tombstone builder');
    assert.doesNotMatch(source, /\.delete\(patients\)/, 'helper must never hard-delete patients');
    assert.doesNotMatch(source, /patients\.ambulatoryId/, 'helper must not read the stale legacy column (WUL-300)');
});

// ADR 0066 allowlist guard (WUL-316 style): patients reads outside this list must go
// through the shared activePatients() predicate; hard deletes are confined to the
// canonical cascade modules.
const UNFILTERED_PATIENTS_READ_ALLOWLIST = new Set([
    'app/api/system/backup-restore/route.ts', // backups must carry tombstones (ADR 0066)
    'app/api/system/fix-orphans/route.ts', // relink + orphan sweep operate on all rows
    'app/api/system/migrate/route.ts', // legacy ambulatory backfill, admin maintenance
    'app/api/system/migrate-m2m/route.ts', // legacy ambulatory backfill, admin maintenance
    'app/api/system/purge-patient/route.ts', // purge must address tombstoned patients
    'app/api/system/restore-patient/route.ts', // restore must list/read tombstones
    'lib/patient-cascade.ts', // orphan subquery scans the full patients table
]);

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

test('patients table access stays behind activePatients() outside the allowlist', () => {
    for (const root of ['app', 'lib']) {
        for (const filePath of walkSources(path.join(ROOT_DIR, root))) {
            const relativePath = path.relative(ROOT_DIR, filePath);
            const source = fs.readFileSync(filePath, 'utf8');

            if (source.includes('from(patients)')
                && !source.includes('activePatients(')
                && !UNFILTERED_PATIENTS_READ_ALLOWLIST.has(relativePath)) {
                assert.fail(`${relativePath} reads from(patients) without activePatients() and is not allowlisted`);
            }

            if (source.includes('.delete(patients)')
                && !PATIENTS_HARD_DELETE_ALLOWLIST.has(relativePath)) {
                assert.fail(`${relativePath} hard-deletes patients outside the ADR 0066 allowlist`);
            }
        }
    }
});
