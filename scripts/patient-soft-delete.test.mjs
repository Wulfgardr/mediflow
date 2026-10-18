// WUL-306 (ADR 0066): static guards for the patient soft-delete lifecycle.
// Behavioral tombstone coverage lives in lib/patient-lifecycle.test.ts (bash wrapper:
// scripts/patient-soft-delete-test.sh); these checks pin the route wiring instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { validateRequiredPatientDeleteAudit, validateRequiredPatientUpdateAudit } from './audit-quality-gate.mjs';

const ROOT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const PATIENT_DELETE_ROUTES = [
    { file: 'app/api/v1/patients/[id]/route.ts', deletionReason: 'api-v1-delete', projection: 'api-v1', auditContextExport: 'auditContextFromRequest' },
    { file: 'app/api/patients/[id]/route.ts', deletionReason: 'web-delete', projection: 'web', auditContextExport: 'auditContextFromSession' },
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

function matchingNodes(root, predicate) {
    const nodes = [];
    const visit = (node) => { if (predicate(node)) nodes.push(node); ts.forEachChild(node, visit); };
    visit(root);
    return nodes;
}

function checkedSource(source) {
    const file = ts.createSourceFile('lifecycle.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    assert.equal(file.parseDiagnostics.length, 0, 'lifecycle wiring must parse');
    return file;
}

function exportedFunction(file, name) {
    const functions = file.statements.filter((node) => ts.isFunctionDeclaration(node)
        && node.name?.text === name && node.body
        && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
    assert.equal(functions.length, 1, 'expected one exported implementation of ' + name);
    return functions[0];
}

function assertNamedImports(file, module, names) {
    const imports = file.statements.filter((node) => ts.isImportDeclaration(node)
        && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === module
        && node.importClause && !node.importClause.isTypeOnly
        && node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings))
        .flatMap((node) => [...node.importClause.namedBindings.elements]);
    for (const name of names) {
        assert.equal(imports.filter((node) => !node.isTypeOnly && node.name.text === name
            && (node.propertyName?.text ?? node.name.text) === name).length, 1, 'required import ' + module + ':' + name);
    }
}

function assertImportedProfileRead(file, declaration) {
    const options = { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext };
    const host = { ...ts.createCompilerHost(options),
        fileExists: (name) => name === file.fileName,
        readFile: (name) => name === file.fileName ? file.text : undefined,
        getSourceFile: (name) => name === file.fileName ? file : undefined };
    const checker = ts.createProgram([file.fileName], options, host).getTypeChecker();
    const imported = file.statements.filter((node) => ts.isImportDeclaration(node)
        && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === '@/lib/patient-profile-service')
        .flatMap((node) => [...node.importClause.namedBindings.elements])
        .find((node) => node.name.text === 'readPatientProfile');
    const call = declaration.initializer.expression;
    const binding = checker.getSymbolAtLocation(imported.name);
    assert.ok(binding && ts.isCallExpression(call), 'GET must call the imported profile reader');
    assert.ok(checker.getSymbolAtLocation(call.expression) === binding,
        'GET must resolve to the imported profile reader, not an identically named local binding');
}

// Token comparison ignores formatting/comments/quote style, not executable syntax
// or string values. It pins the small response/delegation boundary, not whole files.
function syntaxTokens(source) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
    const tokens = [];
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
        tokens.push([kind, kind === ts.SyntaxKind.StringLiteral ? scanner.getTokenValue() : scanner.getTokenText()]);
    }
    return tokens;
}

function assertSyntax(node, expected, message) {
    assert.ok(node, message);
    assert.deepEqual(syntaxTokens(node.getText()), syntaxTokens(expected), message);
}

function assertIfReturn(statement, condition, returned, message) {
    assert.ok(statement && ts.isIfStatement(statement) && !statement.elseStatement, message);
    assertSyntax(statement.expression, condition, message);
    const body = ts.isBlock(statement.thenStatement) ? statement.thenStatement.statements : [statement.thenStatement];
    assert.equal(body.length, 1, message);
    assertSyntax(body[0], 'return ' + returned + ';', message);
}

function tryStatements(handler) {
    const attempts = handler.body.statements.filter(ts.isTryStatement);
    assert.equal(attempts.length, 1, 'expected one direct route try block');
    return attempts[0].tryBlock.statements;
}

function constantDeclaration(statement, name) {
    assert.ok(statement && ts.isVariableStatement(statement)
        && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
        && statement.declarationList.declarations.length === 1, 'expected const ' + name);
    const declaration = statement.declarationList.declarations[0];
    assert.ok(ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer, name);
    return declaration;
}

function assertPatientProfileTombstones({ route, routeSource, profileSource, dispatchSource, coreSource, auditSource }) {
    const routeFile = checkedSource(routeSource);
    assertNamedImports(routeFile, '@/lib/patient-profile-service', ['readPatientProfile', 'updatePatientProfile']);
    const get = tryStatements(exportedFunction(routeFile, 'GET'));
    assert.equal(get.length, 5, 'GET must admit and read once, then return 404 before projecting the patient');
    assertSyntax(get[0], 'const resolved = await readPatientProfile({ request, projection: "' + route.projection + '", patientId: async () => (await params).id });',
        'GET must delegate the same request and route patient to the approved profile projection');
    assertImportedProfileRead(routeFile, constantDeclaration(get[0], 'resolved'));
    assertIfReturn(get[1], '!resolved.ok', 'resolved.response', 'GET must propagate admission denial before the profile');
    assertSyntax(get[2], 'const patient = resolved.profile;', 'GET must consume the admitted profile');
    assertIfReturn(get[3], '!patient', 'NextResponse.json({ error: "Not found" }, { status: 404 })', 'GET must preserve 404');
    assertSyntax(get[4], 'return NextResponse.json(patient);', 'GET must return the filtered profile');

    const put = tryStatements(exportedFunction(routeFile, 'PUT'));
    const commitIndex = put.findIndex((statement) => ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name)
            && declaration.name.text === 'commit'));
    assert.ok(commitIndex >= 0, 'PUT must retain the profile result');
    assertIfReturn(put[commitIndex + 1], 'commit.status !== 200',
        'NextResponse.json(commit.value, { status: commit.status })', 'PUT must propagate the profile 404');

    const profile = checkedSource(profileSource);
    assertNamedImports(profile, 'drizzle-orm', ['and', 'eq']);
    assertNamedImports(profile, './patient-lifecycle', ['activePatients']);
    assertNamedImports(profile, './patient-profile-update-dispatch', ['createPatientProfileUpdateExecution', 'dispatchPatientProfileUpdate']);
    assertNamedImports(checkedSource(dispatchSource), './patient-update-operation', ['updatePatientOperation']);
    const readBody = exportedFunction(profile, 'readPatientProfile').body.statements;
    assert.equal(readBody.length, 1, 'profile read must dispatch through its host admission');
    const admitted = readBody[0].expression;
    assert.ok(ts.isReturnStatement(readBody[0]) && ts.isCallExpression(admitted));
    assertSyntax(admitted.expression, 'admitProfileRead', 'profile read must use host admission');
    assert.equal(admitted.arguments.length, 2);
    assertSyntax(admitted.arguments[0], 'input', 'profile admission must consume the original host input');
    const consume = admitted.arguments[1];
    assert.ok(ts.isArrowFunction(consume) && ts.isBlock(consume.body));
    assertSyntax(consume.body.statements[0], `const query: PatientProfileQuery | null = patientId ? {
        operation: PATIENT_PROFILE_READ_OPERATION.id, actor: admitted.actor, purpose: admitted.purpose,
        patientId, scope: admitted.scope,
    } : null;`, 'query must retain admitted patient, purpose and scope');
    assertSyntax(consume.body.statements[1], 'const snapshot = query ? queryPatientProfile(query) : null;',
        'the admitted query must reach the filtered lookup');
    assertSyntax(consume.body.statements.at(-1), 'return { ok: true, profile: snapshot, scopeAmbulatoryId };',
        'profile read must return the filtered snapshot');
    const queries = profile.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'queryPatientProfile');
    assert.equal(queries.length, 1, 'expected one private profile query implementation');
    assert.ok(!ts.getModifiers(queries[0])?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
        'the raw query must stay private');
    const queryBody = queries[0].body.statements;
    assert.equal(queryBody.length, 4, 'query must retain operation check, filtered lookup and absent result');
    assertSyntax(queryBody[1], 'const condition = and(eq(patients.id, query.patientId), activePatients());',
        'profile predicate must bind the admitted patient and exclude tombstones');
    const patient = constantDeclaration(queryBody[2], 'patient');
    assert.equal(matchingNodes(patient.initializer, isFromPatients).length, 2, 'both profile read branches must query patients');
    assertSyntax(patient.initializer, `query.scope.kind === 'ambulatory'
        ? dbServer.select({ patient: patients }).from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(condition, eq(patientsToAmbulatories.ambulatoryId, query.scope.ambulatoryId))).get()?.patient
        : dbServer.select().from(patients).where(condition).get()`,
    'scoped query must retain membership and both branches must retain the active predicate');
    assertSyntax(queryBody[3], 'return patient ? projectDetail(patient) : null;',
        'absent profile must stay absent before projection');
    assert.deepEqual(unfilteredPatientReads('lib/patient-profile-service.ts', profileSource), [],
        'every profile lookup must exclude tombstones');

    const admission = exportedFunction(profile, 'updatePatientProfile').body.statements[0];
    assert.ok(ts.isIfStatement(admission) && !admission.elseStatement && ts.isBlock(admission.thenStatement));
    assertSyntax(admission.expression, 'context.scopeAmbulatoryId === undefined', 'unscoped update must preflight absence');
    assert.equal(admission.thenStatement.statements.length, 2);
    assertSyntax(admission.thenStatement.statements[0],
        'const existing = await dbServer.select({ id: patients.id }).from(patients).where(and(eq(patients.id, context.patientId), activePatients())).get();',
        'profile update must preserve the filtered same-patient preflight');
    assertIfReturn(admission.thenStatement.statements[1], '!existing',
        '{ status: 404, value: { error: "Not found" } }', 'preflight absence must precede validation and audit');

    const core = checkedSource(coreSource);
    assertNamedImports(core, 'drizzle-orm', ['and', 'eq']);
    assertNamedImports(core, './patient-lifecycle', ['activePatients']);
    const owner = exportedFunction(core, 'updatePatientOperation');
    const transactions = matchingNodes(owner, (node) => ts.isCallExpression(node) && propertyName(node) === 'transaction');
    assert.equal(transactions.length, 1);
    const callback = transactions[0].arguments[0];
    assert.ok(ts.isArrowFunction(callback) && ts.isBlock(callback.body));
    const statements = callback.body.statements;
    const existingIndex = statements.findIndex((statement) => ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name)
            && declaration.name.text === 'existing'));
    const existing = constantDeclaration(statements[existingIndex], 'existing');
    assert.equal(matchingNodes(existing.initializer, isFromPatients).length, 2, 'writer must reread both scoped/unscoped patients');
    assertIfReturn(statements[existingIndex + 1], '!existing',
        '{ status: 404, value: { error: "Not found" } }', 'transaction must reject absence before the write');
    assert.deepEqual(unfilteredPatientReads('lib/patient-update-operation.ts', coreSource), [],
        'transaction reads must exclude tombstones, including conflict rereads');
    const updates = matchingNodes(callback, (node) => ts.isCallExpression(node) && propertyName(node) === 'update'
        && node.arguments.length === 1 && ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === 'patients');
    assert.equal(updates.length, 1);
    assert.ok(patientReadIsFiltered(updates[0]), 'the final patient UPDATE must itself exclude tombstones');

    // Reuse the existing audit contract for real import bindings, reachability,
    // same-patient delegation and the one synchronous transaction/audit writer.
    assert.deepEqual(validateRequiredPatientUpdateAudit({
        spec: { handler: 'PUT', serviceModule: '@/lib/patient-profile-service', serviceExport: 'updatePatientProfile',
            profileFile: 'lib/patient-profile-service.ts', auditContextExport: route.auditContextExport,
            ownerFile: 'lib/patient-update-operation.ts', ownerName: 'updatePatientOperation' },
        routeSource, profileSource, dispatchSource, coreSource, auditSource,
    }), [], route.file);
}

test('patient DELETE routes delegate one version-guarded tombstone and required audit transaction', () => {
    const coreSource = read('lib/patient-delete-operation.ts');
    const auditSource = read('lib/security/audit.ts');
    for (const route of PATIENT_DELETE_ROUTES) {
        const source = read(route.file);
        assert.doesNotMatch(source, /\.delete\(patients\)/, `${route.file} must not hard-delete patients`);
        assert.deepEqual(validateRequiredPatientDeleteAudit({
            spec: {
                handler: 'DELETE', serviceModule: '@/lib/patient-delete-operation', serviceExport: 'deletePatientOperation',
                ownerFile: 'lib/patient-delete-operation.ts', ownerName: 'deletePatientOperation',
                deletionReason: route.deletionReason,
            },
            routeSource: source, coreSource, auditSource,
        }), [], route.file);
    }
});

function profileTombstoneSources(route) {
    return { route, routeSource: read(route.file), profileSource: read('lib/patient-profile-service.ts'), dispatchSource: read('lib/patient-profile-update-dispatch.ts'),
        coreSource: read('lib/patient-update-operation.ts'), auditSource: read('lib/security/audit.ts') };
}

test('patient GET and PUT handlers preserve tombstones through the profile port and writer (404 contract)', () => {
    for (const route of PATIENT_DELETE_ROUTES) assertPatientProfileTombstones(profileTombstoneSources(route));
});

test('profile tombstone guard rejects broken imports, delegation, filters, 404s and final updates', (t) => {
    const mutations = [
        ['unapproved profile import', 'routeSource', "'@/lib/patient-profile-service'", "'@/lib/unapproved-profile-service'"],
        ['different GET delegate', 'routeSource', 'await readPatientProfile(', 'await readUncheckedPatientProfile('],
        ['GET shadows the imported reader with a const', 'routeSource',
            '    try {\n        const resolved = await readPatientProfile',
            '    const readPatientProfile = async () => ({ deletedAt: "synthetic-tombstone" });\n    try {\n        const resolved = await readPatientProfile'],
        ['GET shadows the imported reader with a function', 'routeSource',
            '    try {\n        const resolved = await readPatientProfile',
            '    function readPatientProfile() { return { deletedAt: "synthetic-tombstone" }; }\n    try {\n        const resolved = await readPatientProfile'],
        ['GET shadows the imported reader with destructuring', 'routeSource',
            '    try {\n        const resolved = await readPatientProfile',
            '    const { readPatientProfile } = unapproved;\n    try {\n        const resolved = await readPatientProfile'],
        ['different GET patient', 'routeSource', 'patientId: async () => (await params).id', 'patientId: async () => otherId'],
        ['GET turns absence into success', 'routeSource', '{ status: 404 }', '{ status: 200 }'],
        ['GET removes its absent guard', 'routeSource', 'if (!patient)', 'if (false)'],
        ['different PUT delegate', 'routeSource', 'await updatePatientProfile(', 'await updateUncheckedPatientProfile('],
        ['PUT discards the status', 'routeSource', '{ status: commit.status }', '{ status: 200 }'],
        ['profile loses the active predicate', 'profileSource',
            'const condition = and(eq(patients.id, query.patientId), activePatients());',
            'const condition = eq(patients.id, query.patientId);'],
        ['scoped profile uses OR', 'profileSource',
            '.where(and(condition, eq(patientsToAmbulatories.ambulatoryId, query.scope.ambulatoryId)))',
            '.where(or(condition, eq(patientsToAmbulatories.ambulatoryId, query.scope.ambulatoryId)))'],
        ['unscoped profile loses the predicate', 'profileSource', '.where(condition).get()', '.where(eq(patients.id, query.patientId)).get()'],
        ['scoped profile loses membership scope', 'profileSource', '.where(and(condition, eq(patientsToAmbulatories.ambulatoryId, query.scope.ambulatoryId)))', '.where(condition)'],
        ['raw query becomes public', 'profileSource', 'function queryPatientProfile(', 'export function queryPatientProfile('],
        ['absent profile becomes an object', 'profileSource', 'return patient ? projectDetail(patient) : null;', 'return patient ? projectDetail(patient) : {};'],
        ['query scope is replaced with local access', 'profileSource', 'patientId, scope: admitted.scope,', "patientId, scope: { kind: 'local' },"],
        ['query skips the filtered implementation', 'profileSource', 'const snapshot = query ? queryPatientProfile(query) : null;', 'const snapshot = query ? uncheckedPatientProfile(query) : null;'],
        ['GET ignores admission denial', 'routeSource', 'if (!resolved.ok)', 'if (false)'],
        ['profile preflight loses 404', 'profileSource',
            "if (!existing) return { status: 404, value: { error: 'Not found' } };",
            "if (!existing) return { status: 200, value: { error: 'Not found' } };"],
        ['profile uses another writer', 'profileSource', 'const outcome = await dispatchPatientProfileUpdate(execution, execution.command)', 'const outcome = await uncheckedDispatch(execution, execution.command)'],
        ['writer loses 404', 'coreSource',
            "if (!existing) return { status: 404, value: { error: 'Not found' } };",
            "if (!existing) return { status: 200, value: { error: 'Not found' } };"],
        ['writer lookup weakens AND with OR', 'coreSource', '            activePatients(),',
            '            or(activePatients(), eq(patients.id, input.patientId)),'],
        ['final UPDATE loses the active predicate', 'coreSource',
            '.where(and(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion), activePatients()))',
            '.where(and(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion)))'],
        ['final UPDATE uses OR', 'coreSource',
            '.where(and(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion), activePatients()))',
            '.where(or(eq(patients.id, input.patientId), eq(patients.version, input.expectedVersion), activePatients()))'],
    ];
    for (const route of PATIENT_DELETE_ROUTES) {
        const sources = profileTombstoneSources(route);
        for (const [name, file, before, after] of mutations) {
            assert.ok(sources[file].includes(before), 'mutation must apply: ' + name);
            assert.throws(() => assertPatientProfileTombstones({
                ...sources, [file]: sources[file].replace(before, after),
            }), { name: 'AssertionError' }, route.file + ': ' + name);
        }
    }
    t.diagnostic(mutations.length + ' in-memory rejection cases per route; production files unchanged');
});

test('the schema owner keeps the additive ensureColumn guards for the tombstone columns', () => {
    const source = read('lib/sqlite-schema.ts');
    assert.match(source, /ensureColumn\(sqlite, 'patients', 'deleted_at', 'deleted_at INTEGER'\)/);
    assert.match(source, /ensureColumn\(sqlite, 'patients', 'deletion_reason', 'deletion_reason TEXT'\)/);
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
    assert.match(routeSource, /NextResponse\.json\(result\.value, \{ status: result\.status \}\)/, 'route must preserve the core response and status');
    assert.match(clearServiceSource, /const result = clearTestContainerByMembership\(tx, ambulatoryId\)/, 'clear must retain the transactional membership result');
    assert.match(clearServiceSource, /for \(const patient of result\.clearedPatients\)/, 'clear must audit each cleared patient');
    assert.match(clearServiceSource, /resourceVersion: patient\.version/, 'each patient audit must retain the resulting version');
    assert.match(clearServiceSource, /target\.version !== parsedVersion/, 'stale container versions must be rejected');
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
    // Create identity checks intentionally include tombstones after admission: IDs may not be reused.
    // Two Web branches, one local-v1 branch, and the paired branch each have one exact lookup.
    ['app/api/patients/route.ts', 'tx.select({ id: patients.id }).from(patients).where(eq(patients.id, values.id)).get()', 1],
    ['app/api/patients/route.ts', 'tx.select({ id: patients.id }).from(patients).where(eq(patients.id, normalized.values.id)).get()', 1],
    ['app/api/v1/patients/route.ts', 'tx.select({ id: patients.id }).from(patients).where(eq(patients.id, normalized.values.id)).get()', 1],
    ['lib/network-patient-lifecycle.ts', 'tx.select({ id: patients.id }).from(patients).where(eq(patients.id, normalized.values.id)).get()', 1],
    // SISS create checks deletedAt immediately after lookup and returns 404 before insert/audit.
    // The SISS family SQLite oracle retains its tombstoned-parent denial case.
    ['app/api/siss-handoffs/route.ts', 'tx.select({ deletedAt: patients.deletedAt }).from(patients) .where(eq(patients.id, patientId)).get()', 1],
    ['app/api/system/backup-restore/route.ts', 'tx.select().from(patients).all()', 1],
    // ADR0066: admin orphan inspection and transactional repair deliberately include tombstones.
    ['app/api/system/fix-orphans/route.ts', 'tx.select({ id: patients.id }).from(patients)', 1],
    ['app/api/system/fix-orphans/route.ts', 'tx.select({ id: patients.id, version: patients.version }).from(patients).all()', 1],
    ['app/api/system/migrate/route.ts', 'dbServer.select().from(patients).where(isNull(patients.ambulatoryId))', 1],
    ['app/api/system/migrate-m2m/route.ts', 'tx.select({ id: patients.id, version: patients.version, ambulatoryId: patients.ambulatoryId }) .from(patients).where(isNotNull(patients.ambulatoryId)).all()', 1],
    // Admin purge previews tombstone/version in a read transaction and rereads them before cascade in the write transaction.
    ['app/api/system/purge-patient/route.ts', 'tx.select({ id: patients.id, version: patients.version, deletedAt: patients.deletedAt }) .from(patients).where(eq(patients.id, patientId)).get()', 2],
    ['app/api/system/restore-patient/route.ts', 'dbServer .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, deletedAt: patients.deletedAt, deletionReason: patients.deletionReason, version: patients.version, }) .from(patients) .where(isNotNull(patients.deletedAt)) .orderBy(desc(patients.deletedAt))', 1],
    // admin restore reads this tombstone inside its IMMEDIATE transaction.
    ['app/api/system/restore-patient/route.ts', 'tx.select({ id: patients.id, version: patients.version, deletedAt: patients.deletedAt }) .from(patients).where(eq(patients.id, patientId)).get()', 1],
    ['lib/network-patient-lifecycle.ts', 'tx .select({ id: patients.id, version: patients.version, updatedAt: patients.updatedAt, isArchived: patients.isArchived, }) .from(patients) .where(and(eq(patients.id, patientId), isNotNull(patients.deletedAt))) .get()', 1],
    ['lib/network-patient-lifecycle.ts', 'tx .select({ patient: patients }) .from(patients) .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId)) .where(and(eq(patients.id, context.patientId), eq(patientsToAmbulatories.ambulatoryId, context.scopeAmbulatoryId), isNotNull(patients.deletedAt))) .get()', 1],
    ['lib/network-patient-read.ts', 'dbServer .select({ patient: patients }) .from(patients) .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId)) .where(and(...filters)) .orderBy(desc(patients.updatedAt))', 1],
    // Clear's remaining selected members include existing tombstones: bump membership authority
    // without rewriting lifecycle fields (test-container-clear's tombstoned-member oracle).
    ['lib/test-container-clear.ts', 'runner .select({ id: patients.id, version: patients.version }).from(patients) .where(inArray(patients.id, remainingIds)).all()', 1],
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

function isAndCall(node) {
    return ts.isCallExpression(node) && !node.questionDotToken
        && ts.isIdentifier(node.expression) && node.expression.text === 'and';
}

function isActivePatientsPredicate(node) {
    if (ts.isFunctionLike(node)) return false;
    if (!ts.isCallExpression(node)) return false;
    if (ts.isIdentifier(node.expression) && node.expression.text === 'activePatients') return node.arguments.length === 0;
    return isAndCall(node) && node.arguments.some(isActivePatientsPredicate);
}

/* Follow a local const only through AND arguments into the owning patient WHERE.
 * Every use must satisfy that path: one safe query cannot hide a later escape. */
function isLocalConstantActivePredicate(node) {
    if (!ts.isIdentifier(node)) return false;
    let block = node.parent;
    while (block && !ts.isBlock(block)) block = block.parent;
    if (!block) return false;
    const declarations = block.statements
        .filter(ts.isVariableStatement)
        .filter((statement) => (statement.declarationList.flags & ts.NodeFlags.Const) !== 0)
        .flatMap((statement) => [...statement.declarationList.declarations])
        .filter((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === node.text);
    if (declarations.length !== 1) return false;
    const declaration = declarations[0];
    if (!declaration.initializer || declaration.end >= node.pos
        || !isActivePatientsPredicate(declaration.initializer)) return false;
    const localAndBindings = matchingNodes(node.getSourceFile(), (current) => ts.isIdentifier(current)
        && current.text === 'and' && current.parent.name === current
        && (ts.isVariableDeclaration(current.parent) || ts.isBindingElement(current.parent)
            || ts.isParameter(current.parent) || ts.isFunctionDeclaration(current.parent)));
    if (localAndBindings.length) return false;
    const isPatientWhere = (call) => {
        if (!ts.isCallExpression(call) || call.questionDotToken || propertyName(call) !== 'where'
            || call.expression.questionDotToken) return false;
        let receiver = call.expression.expression;
        while (ts.isCallExpression(receiver)) {
            if (isFromPatients(receiver)) return true;
            if (!ts.isPropertyAccessExpression(receiver.expression)) return false;
            receiver = receiver.expression.expression;
        }
        return false;
    };
    let safe = true;
    const visit = (current) => {
        if (ts.isIdentifier(current) && current.text === node.text && current !== declaration.name) {
            let argument = current;
            while (isAndCall(argument.parent) && argument.parent.arguments.includes(argument)) argument = argument.parent;
            const call = argument.parent;
            if (current.pos < declaration.end || !isPatientWhere(call) || call.arguments.length !== 1
                || call.arguments[0] !== argument) safe = false;
            for (let scope = current.parent; scope && scope !== block; scope = scope.parent) {
                if (ts.isFunctionLike(scope)) safe = false;
            }
        }
        ts.forEachChild(current, visit);
    };
    visit(block);
    return safe;
}

function isFilteredPatientPredicate(node) {
    return isActivePatientsPredicate(node) || isLocalConstantActivePredicate(node)
        || isAndCall(node) && node.arguments.some(isFilteredPatientPredicate);
}

function patientReadIsFiltered(fromCall) {
    for (let call = fromCall; call; call = directReceiverCall(call)) {
        if (propertyName(call) === 'where' && call.arguments.some(isFilteredPatientPredicate)) return true;
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

test('AST guard follows a local immutable predicate without accepting aliases, mutation, or shadowing', () => {
    const query = 'db.select().from(patients).where(condition).get();';
    const active = 'const condition = and(eq(patients.id, id), activePatients());';
    assert.deepEqual(unfilteredPatientReads('synthetic.ts', `function read() { ${active} ${query} ${query} }`), []);
    for (const source of [
        `function read() { let condition = activePatients(); ${query} }`,
        `function read() { const condition = eq(patients.id, id); ${query} }`,
        `function read() { const condition = or(activePatients(), eq(patients.id, id)); ${query} }`,
        `function read() { ${active} condition.append(sql); ${query} }`,
        `function read() { ${active} mutate(condition); ${query} }`,
        `function read() { ${active} unrelated.where(condition); ${query} }`,
        `function read() { ${active} const alias = condition; ${query} }`,
        `function read() { ${active} condition = replacement; ${query} }`,
        `function read() { ${query} ${active} }`,
        `${active} function read() { ${query} }`,
        `function read() { ${active} function other(condition) { ${query} } ${query} }`,
    ]) {
        assert.ok(unfilteredPatientReads('synthetic.ts', source).length > 0, source);
    }
});

test('AST guard follows AND-only predicate paths and invalidates every query after an unsafe use', (t) => {
    const active = 'const condition = and(eq(patients.id, id), activePatients());';
    const direct = 'db.select().from(patients).where(condition).get()';
    const scoped = 'db.select().from(patients).where(and(condition, eq(scope.id, id))).get()';
    const nested = 'db.select().from(patients).where(and(eq(scope.id, id), and(condition, eq(scope.enabled, true)))).get()';
    for (const query of [scoped, nested]) {
        assert.deepEqual(unfilteredPatientReads('synthetic.ts',
            'function read() { ' + active + ' return scoped ? ' + query + ' : ' + direct + '; }'), []);
    }
    const invalid = [
        'function read() { let condition = activePatients(); return ' + scoped + '; }',
        'function read() { const condition = or(activePatients(), eq(patients.id, id)); return ' + scoped + '; }',
        'function read() { ' + scoped + '; ' + active + ' }',
        active + ' function read() { return ' + scoped + '; }',
        'function read(and) { ' + active + ' return ' + scoped + '; }',
        'function read() { ' + active + ' function and(value) { return true; } return ' + scoped + '; }',
        'function read() { ' + active + ' condition = replacement; return ' + scoped + '; }',
        'function read() { ' + active + ' condition.append(sql); return ' + scoped + '; }',
        'function read() { ' + active + ' mutate(condition); return ' + scoped + '; }',
        'function read() { ' + active + ' const alias = condition; return ' + scoped + '; }',
        'function read() { ' + active + ' unrelated.where(and(condition, other)); return ' + scoped + '; }',
        'function read() { ' + active + ' return db.select().from(patients).where(and(or(condition, other), scope)).get(); }',
        'function read() { ' + active + ' return db.select().from(patients).where(and(not(condition), scope)).get(); }',
        'function read() { ' + active + ' return db.select().from(patients).where(and(() => condition, scope)).get(); }',
        'function read() { ' + active + ' return db.select().from(patients).where(and(...condition, scope)).get(); }',
        'function read() { ' + active + ' return db.select().from(patients).where(and?.(condition, scope)).get(); }',
        'function read() { ' + active + ' return db.select().from(patients).where(' + scoped + ').get(); }',
        'function read() { ' + active + ' const deferred = () => ' + scoped + '; return deferred; }',
        'function read() { ' + active + ' { const condition = other; ' + scoped + '; } return ' + direct + '; }',
    ];
    for (const source of invalid) assert.ok(unfilteredPatientReads('synthetic.ts', source).length > 0, source);
    const escaped = 'function read() { ' + active + ' ' + direct
        + '; unrelated.where(and(condition, other)); return ' + nested + '; }';
    assert.equal(unfilteredPatientReads('synthetic.ts', escaped).length, 2,
        'the later unrelated use must invalidate both otherwise filtered patient queries');
    t.diagnostic(invalid.length + ' rejected AND/escape cases, plus all-use invalidation of two patient queries');
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
