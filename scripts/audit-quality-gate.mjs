#!/usr/bin/env node
/* @Codex */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = process.cwd();
const DEFAULT_OUT = 'tmp-audit-quality-gate-report.json';

const REQUIRED_ROUTE_AUDIT = [
    { route: 'app/api/auth/login/route.ts', events: ['auth.login.failed', 'auth.login.succeeded'], reason: 'auth login success/failure must stay auditable' },
    {
        route: 'app/api/auth/logout/route.ts', events: ['auth.logout'], reason: 'auth logout must stay auditable',
        writerContracts: [{
            target: 'auth.logout',
            modes: {
                inline: { handler: 'POST', writerModule: '@/lib/security/audit', writerExport: 'writeAuditEvent', eventType: 'auth.logout' },
                delegated: {
                    handler: 'POST', serviceModule: '@/lib/security/web-auth-logout-server', serviceExport: 'completeExactWebP3Logout',
                    ownerFile: 'lib/security/web-auth-logout-server.ts', ownerName: 'completeExactWebP3Logout',
                    writerModule: './audit', writerExport: 'writeAuditEvent', hashExport: 'hashAuditRef',
                    ownerModule: './web-auth-lifecycle-owner-adapter', resolveExport: 'resolve', retireExport: 'retire',
                    transportModule: './web-auth-control-transport', etagExport: 'strongWebAuthControlEtag',
                    eventType: 'auth.logout', sourcesName: 'productionSources', receiptValidator: 'retirementReceipt',
                },
            },
        }],
    },
    {
        route: 'app/api/auth/change-pin/route.ts', events: ['settings.updated'], reason: 'PIN rotation is an administrative settings mutation',
        writerContracts: [{
            handler: 'POST', serviceModule: '@/lib/security/pin-change-service', serviceExport: 'changePin',
            target: 'change-pin', ownerFile: 'lib/security/pin-change-service.ts', ownerName: 'changePin',
            writerModule: '@/lib/security/audit', writerExport: 'writeAuditEvent', eventType: 'settings.updated',
            dependencyFallback: { parameter: 'dependencies', property: 'writeAuditEvent' },
            requirePinRetirementOrder: true,
        }],
    },
    { route: 'app/api/settings/route.ts', events: ['settings.updated'], reason: 'bulk settings mutations must stay auditable' },
    { route: 'app/api/settings/[key]/route.ts', events: ['settings.updated'], reason: 'single-key settings mutations must stay auditable' },
    { route: 'app/api/patients/route.ts', events: ['patient.created'], reason: 'patient creation is a sensitive CRUD path' },
    {
        route: 'app/api/patients/[id]/route.ts', events: ['patient.updated'], reason: 'patient update requires one transactional audit owner',
        writerContracts: [{ handler: 'PUT', serviceModule: '@/lib/patient-update-operation', serviceExport: 'updatePatientOperation',
            ownerFile: 'lib/patient-update-operation.ts', ownerName: 'updatePatientOperation',
            target: 'patient-update.web', eventType: 'patient.updated', transactionalPatientUpdate: true }],
    },
    {
        route: 'app/api/patients/[id]/route.ts', events: ['patient.deleted'], reason: 'patient delete requires one transactional audit owner',
        writerContracts: [{ handler: 'DELETE', serviceModule: '@/lib/patient-delete-operation', serviceExport: 'deletePatientOperation',
            ownerFile: 'lib/patient-delete-operation.ts', ownerName: 'deletePatientOperation',
            target: 'patient-delete.web', eventType: 'patient.deleted', deletionReason: 'web-delete', transactionalPatientDelete: true }],
    },
    { route: 'app/api/v1/patients/route.ts', events: ['patient.created'], reason: 'native/shared patient creation must stay auditable' },
    {
        route: 'app/api/v1/patients/[id]/route.ts', events: ['patient.updated'], reason: 'native patient update requires one transactional audit owner',
        writerContracts: [{ handler: 'PUT', serviceModule: '@/lib/patient-update-operation', serviceExport: 'updatePatientOperation',
            ownerFile: 'lib/patient-update-operation.ts', ownerName: 'updatePatientOperation',
            target: 'patient-update.native', eventType: 'patient.updated', transactionalPatientUpdate: true }],
    },
    {
        route: 'app/api/v1/patients/[id]/route.ts', events: ['patient.deleted'], reason: 'native patient delete requires one transactional audit owner',
        writerContracts: [{ handler: 'DELETE', serviceModule: '@/lib/patient-delete-operation', serviceExport: 'deletePatientOperation',
            ownerFile: 'lib/patient-delete-operation.ts', ownerName: 'deletePatientOperation',
            target: 'patient-delete.native', eventType: 'patient.deleted', deletionReason: 'api-v1-delete', transactionalPatientDelete: true }],
    },
    { route: 'app/api/entries/route.ts', events: ['entry.created'],
        writerContracts: [diaryAuditContract('POST', 'web', 'create')] },
    { route: 'app/api/entries/[id]/route.ts', events: ['entry.updated', 'entry.deleted'],
        writerContracts: [diaryAuditContract('PUT', 'web', 'update'), diaryAuditContract('DELETE', 'web', 'update')] },
    { route: 'app/api/v1/patients/[id]/entries/route.ts', events: ['entry.created'],
        writerContracts: [diaryAuditContract('POST', 'v1', 'create')] },
    { route: 'app/api/v1/patients/[id]/entries/[entryId]/route.ts', events: ['entry.updated', 'entry.deleted'],
        writerContracts: [diaryAuditContract('PUT', 'v1', 'update'), diaryAuditContract('DELETE', 'v1', 'update')] },
    { route: 'app/api/v1/network/patients/[id]/entries/route.ts', events: ['entry.created'],
        writerContracts: [diaryAuditContract('POST', 'network', 'create')] },
    { route: 'app/api/v1/network/patients/[id]/entries/[entryId]/route.ts', events: ['entry.updated', 'entry.deleted'],
        writerContracts: [diaryAuditContract('PUT', 'network', 'update')] },
    { route: 'app/api/therapies/route.ts', events: ['therapy.created'], reason: 'therapy creation requires transactional audit',
        writerContracts: [therapyAuditContract('POST', 'web', 'create')] },
    { route: 'app/api/therapies/[id]/route.ts', events: ['therapy.updated', 'therapy.deleted'], reason: 'therapy update/delete require transactional audit',
        writerContracts: [therapyAuditContract('PUT', 'web', 'update'), therapyAuditContract('DELETE', 'web', 'update')] },
    { route: 'app/api/v1/patients/[id]/therapies/route.ts', events: ['therapy.created'], reason: 'local therapy creation requires transactional audit',
        writerContracts: [therapyAuditContract('POST', 'v1', 'create')] },
    { route: 'app/api/v1/patients/[id]/therapies/[therapyId]/route.ts', events: ['therapy.updated', 'therapy.deleted'], reason: 'local therapy update/delete require transactional audit',
        writerContracts: [therapyAuditContract('PUT', 'v1', 'update'), therapyAuditContract('DELETE', 'v1', 'update')] },
    { route: 'app/api/v1/network/patients/[id]/therapies/route.ts', events: ['therapy.created'], reason: 'paired therapy creation requires transactional audit',
        writerContracts: [therapyAuditContract('POST', 'network', 'create')] },
    { route: 'app/api/v1/network/patients/[id]/therapies/[therapyId]/route.ts', events: ['therapy.updated', 'therapy.deleted'], reason: 'paired therapy update requires transactional audit',
        writerContracts: [therapyAuditContract('PUT', 'network', 'update')] },
    { route: 'app/api/checkups/route.ts', events: ['checkup.created'], reason: 'checkup creation is sensitive CRUD' },
    { route: 'app/api/checkups/[id]/route.ts', events: ['checkup.updated', 'checkup.deleted'], reason: 'checkup update/delete are sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/checkups/route.ts', events: ['checkup.created'], reason: 'native/shared checkup creation is sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/checkups/[checkupId]/route.ts', events: ['checkup.updated', 'checkup.deleted'], reason: 'native/shared checkup update/delete are sensitive CRUD' },
    { route: 'lib/network-checkup-write.ts', events: ['checkup.created', 'checkup.updated', 'checkup.deleted'], reason: 'paired checkup writes must stay PHI-safe auditable' },
    { route: 'app/api/observations/route.ts', events: ['observation.created'],
        writerContracts: [observationAuditContract('POST', 'web', 'create')] },
    { route: 'app/api/observations/[id]/route.ts', events: ['observation.updated', 'observation.deleted'],
        writerContracts: [observationAuditContract('PUT', 'web', 'update'), observationAuditContract('DELETE', 'web', 'update')] },
    { route: 'app/api/v1/patients/[id]/observations/route.ts', events: ['observation.created'],
        writerContracts: [observationAuditContract('POST', 'v1', 'create')] },
    { route: 'app/api/v1/patients/[id]/observations/[observationId]/route.ts', events: ['observation.updated', 'observation.deleted'],
        writerContracts: [observationAuditContract('PUT', 'v1', 'update'), observationAuditContract('DELETE', 'v1', 'update')] },
    { route: 'app/api/v1/network/patients/[id]/observations/route.ts', events: ['observation.created'],
        writerContracts: [observationAuditContract('POST', 'network', 'create')] },
    { route: 'app/api/v1/network/patients/[id]/observations/[observationId]/route.ts', events: ['observation.updated', 'observation.deleted'],
        writerContracts: [observationAuditContract('PUT', 'network', 'update')] },
    {
        route: 'app/api/prosthetic-prescriptions/route.ts', events: ['prosthetic.prescription.created'], reason: 'prosthetic prescription creation is sensitive CRUD',
        writerContracts: [{
            handler: 'POST', serviceModule: '@/lib/prosthetic-prescription-write',
            serviceExport: 'createHostProstheticPrescription',
            target: 'prosthetic-prescription.create', ownerFile: 'lib/prosthetic-prescription-write.ts',
            ownerName: 'createHostProstheticPrescription', writerModule: './security/audit',
            writerExport: 'safeWriteAuditEventFromRequest', writerArgumentIndex: 2,
            eventType: 'prosthetic.prescription.created',
        }],
    },
    {
        route: 'app/api/prosthetic-prescriptions/[id]/route.ts', events: ['prosthetic.prescription.updated', 'prosthetic.prescription.deleted'], reason: 'prosthetic prescription update/delete are sensitive CRUD',
        writerContracts: [
            {
                handler: 'PUT', serviceModule: '@/lib/prosthetic-prescription-write',
                serviceExport: 'updateHostProstheticPrescription',
                hop: { target: 'updateProstheticPrescription', argumentIndex: 2, literal: 'host' },
                target: 'prosthetic-prescription.update', ownerFile: 'lib/prosthetic-prescription-write.ts',
                ownerName: 'updateProstheticPrescription', writerModule: './security/audit',
                writerExport: 'safeWriteAuditEventFromRequest', writerArgumentIndex: 2,
                eventType: 'prosthetic.prescription.updated',
            },
            {
                handler: 'DELETE', serviceModule: '@/lib/prosthetic-prescription-write',
                serviceExport: 'deleteHostProstheticPrescription',
                target: 'prosthetic-prescription.delete', ownerFile: 'lib/prosthetic-prescription-write.ts',
                ownerName: 'deleteHostProstheticPrescription', writerModule: './security/audit',
                writerExport: 'safeWriteAuditEventFromRequest', writerArgumentIndex: 2,
                eventType: 'prosthetic.prescription.deleted',
            },
        ],
    },
    { route: 'app/api/siss-handoffs/route.ts', events: ['siss.handoff.created'], reason: 'SISS handoff creation must stay PHI-safe auditable' },
    { route: 'app/api/siss-handoffs/[id]/route.ts', events: ['siss.handoff.updated', 'siss.handoff.deleted'], reason: 'SISS handoff update/delete must stay PHI-safe auditable' },
    { route: 'app/api/siss/context/route.ts', events: ['patient.siss.prescription.launch'], reason: 'prescription handoff launch must stay PHI-safe auditable' },
    { route: 'app/api/siss/prescription/route.ts', events: ['patient.siss.prescription.launch'], reason: 'prescription panel launch must stay PHI-safe auditable' },
];

const REQUIRED_EVENT_TYPES = new Set(REQUIRED_ROUTE_AUDIT.flatMap((entry) => entry.events));

/* @Codex: explicit eight-handler roster; no exemption for delegated diary writes. */
function diaryAuditContract(handler, mode, operation) {
    return {
        handler, mode, operation, transactionalDiary: true,
        target: `entry-${operation}.${mode}.${handler.toLowerCase()}`,
        ownerFile: 'lib/entry-write-operation.ts', ownerName: `${operation}EntryOperation`,
        serviceModule: '@/lib/entry-write-operation', serviceExport: `${operation}EntryOperation`,
        bridgeFile: 'lib/network-entry-write.ts',
        bridgeExport: `${operation}NetworkScopedEntry`,
    };
}
/* @Codex: therapy roster is explicit; runtime policy is not inherited from diary. */
function therapyAuditContract(handler, mode, operation) {
    return {
        handler, mode, operation, transactionalTherapy: true,
        target: `therapy-${operation}.${mode}.${handler.toLowerCase()}`,
        ownerFile: 'lib/therapy-write-operation.ts', ownerName: `${operation}TherapyOperation`,
        serviceModule: '@/lib/therapy-write-operation', serviceExport: `${operation}TherapyOperation`,
        bridgeFile: 'lib/network-therapy-write.ts', bridgeExport: `${operation}NetworkScopedTherapy`,
    };
}
/* @Codex: eight ordinary observation handlers, without extending link or input authority. */
function observationAuditContract(handler, mode, operation) {
    return {
        handler, mode, operation, transactionalObservation: true,
        target: `observation-${operation}.${mode}.${handler.toLowerCase()}`,
        ownerFile: 'lib/observation-write-operation.ts', ownerName: `${operation}ObservationOperation`,
        serviceModule: '@/lib/observation-write-operation', serviceExport: `${operation}ObservationOperation`,
        bridgeFile: 'lib/network-observation-write.ts', bridgeExport: `${operation}NetworkScopedObservation`,
    };
}
const METADATA_KEYS = ['changedFields', 'resourceVersion', 'counts', 'flags', 'reasonCode'];
const FORBIDDEN_METADATA_KEYS = [
    'address',
    'attachment',
    'base64',
    'birthDate',
    'cf',
    'clinicalReason',
    'codiceFiscale',
    'content',
    'dateOfBirth',
    'description',
    'diagnosis',
    'document',
    'email',
    'firstName',
    'fiscalCode',
    'lastName',
    'masterKey',
    'name',
    'note',
    'notes',
    'ocr',
    'password',
    'patientName',
    'phone',
    'pin',
    'prompt',
    'raw',
    'salt',
    'summary',
    'text',
    'token',
];

function parseArgs(argv) {
    const options = { out: process.env.MEDIFLOW_AUDIT_QUALITY_GATE_OUT || DEFAULT_OUT };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--out' && argv[index + 1]) {
            options.out = argv[index + 1];
            index += 1;
        }
    }
    return options;
}

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

function addFinding(findings, code, message, details = {}) {
    findings.push({ code, message, ...details });
}

function bindingNameContains(name, target) {
    if (ts.isIdentifier(name)) return name.text === target;
    return (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))
        && name.elements.some((item) => ts.isBindingElement(item) && bindingNameContains(item.name, target));
}

function importedName(sourceFile, moduleName, exportName) {
    const names = sourceFile.statements.flatMap((statement) => {
        if (!ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || statement.moduleSpecifier.text !== moduleName
            || statement.importClause?.isTypeOnly
            || !statement.importClause?.namedBindings
            || !ts.isNamedImports(statement.importClause.namedBindings)) return [];
        return statement.importClause.namedBindings.elements
            .filter((item) => !item.isTypeOnly && (item.propertyName?.text ?? item.name.text) === exportName)
            .map((item) => item.name.text);
    });
    return names.length === 1 ? names[0] : null;
}

function localBindingExists(owner, name, allowOwnerParameter = false) {
    let found = !allowOwnerParameter && owner.parameters.some((parameter) => bindingNameContains(parameter.name, name));
    const visit = (node) => {
        if (found || (node !== owner && ts.isFunctionLike(node))) return;
        if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
            && node.name && bindingNameContains(node.name, name)) found = true;
        ts.forEachChild(node, visit);
    };
    if (owner.body) visit(owner.body);
    return found;
}

function unwrap(expression) {
    let current = expression;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
        || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)
        || ts.isSatisfiesExpression(current)) current = current.expression;
    return current;
}

function isWriterCall(call, binding, owner, fallback) {
    const callee = unwrap(call.expression);
    if (ts.isIdentifier(callee)) return callee.text === binding;
    if (!fallback || !ts.isBinaryExpression(callee)
        || callee.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
        || !ts.isPropertyAccessExpression(callee.left)
        || !ts.isIdentifier(callee.left.expression)
        || callee.left.expression.text !== fallback.parameter
        || callee.left.name.text !== fallback.property
        || !ts.isIdentifier(callee.right)
        || callee.right.text !== binding) return false;
    return owner.parameters.some((parameter) => bindingNameContains(parameter.name, fallback.parameter));
}

function directWriterCalls(owner, binding, fallback) {
    const calls = { direct: [], all: [] };
    const visit = (node, nested = false) => {
        const isNested = nested || (node !== owner && ts.isFunctionLike(node));
        if (ts.isCallExpression(node) && isWriterCall(node, binding, owner, fallback)) {
            calls.all.push(node);
            if (!isNested) calls.direct.push(node);
        }
        ts.forEachChild(node, (child) => visit(child, isNested));
    };
    if (owner.body) visit(owner.body);
    return calls;
}

function constantBoolean(expression) {
    const value = unwrap(expression);
    if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isNumericLiteral(value)) return Number(value.text) !== 0;
    if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) { const operand = constantBoolean(value.operand); return operand === null ? null : !operand; }
    return null;
}

function alwaysTerminates(statement) {
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return true;
    if (ts.isBlock(statement)) return statement.statements.some(alwaysTerminates);
    if (ts.isTryStatement(statement)) {
        if (statement.finallyBlock && alwaysTerminates(statement.finallyBlock)) return true;
        if (!statement.catchClause) return alwaysTerminates(statement.tryBlock);
        return alwaysTerminates(statement.tryBlock) && alwaysTerminates(statement.catchClause.block);
    }
    if (!ts.isIfStatement(statement)) return false;
    const constant = constantBoolean(statement.expression);
    if (constant !== null) return constant
        ? alwaysTerminates(statement.thenStatement)
        : Boolean(statement.elseStatement && alwaysTerminates(statement.elseStatement));
    return Boolean(statement.elseStatement
        && alwaysTerminates(statement.thenStatement)
        && alwaysTerminates(statement.elseStatement));
}

function isReachableCall(call, owner) {
    let child = call;
    for (let parent = child.parent; parent && parent !== owner; child = parent, parent = parent.parent) {
        if (ts.isFunctionLike(parent)) return false;
        if (ts.isBinaryExpression(parent) || ts.isConditionalExpression(parent)) return false;
        if (ts.isIfStatement(parent)) {
            const constant = constantBoolean(parent.expression);
            if ((constant === false && parent.thenStatement === child)
                || (constant === true && parent.elseStatement === child)) return false;
        }
        if (ts.isBlock(parent)) {
            const index = parent.statements.indexOf(child);
            if (index >= 0 && parent.statements.slice(0, index).some((statement) =>
                alwaysTerminates(statement)
                || ts.isIterationStatement(statement, false)
                || ts.isSwitchStatement(statement)
                || ts.isBreakStatement(statement)
                || ts.isContinueStatement(statement))) return false;
        }
        if (ts.isIterationStatement(parent, false) || ts.isSwitchStatement(parent) || ts.isLabeledStatement(parent)) return false;
    }
    return true;
}

function isReachableStandaloneCall(call, owner) {
    let current = call;
    while (ts.isAwaitExpression(current.parent) || ts.isParenthesizedExpression(current.parent)) current = current.parent;
    return ts.isExpressionStatement(current.parent) && isReachableCall(call, owner);
}

/* @Codex */
function validatePinRetirementAuditOrder(sourceFile, owner, writerCall) {
    const problems = [];
    const statements = owner.body ? [...owner.body.statements] : [];
    const compact = (node) => node?.getText(sourceFile).replace(/\s+/gu, ' ') ?? '';
    const findIndex = (predicate) => statements.findIndex((statement) => predicate(statement, compact(statement)));
    const variableInitializer = (statement, name) => {
        if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) return null;
        const declaration = statement.declarationList.declarations[0];
        return ts.isIdentifier(declaration.name) && declaration.name.text === name
            ? declaration.initializer ?? null
            : null;
    };
    const identifierCalls = (root, callee, argument = null, includeNested = false) => {
        const calls = [];
        const visit = (node) => {
            if (!includeNested && node !== root && ts.isFunctionLike(node)) return;
            if (ts.isCallExpression(node) && !node.questionDotToken) {
                const expression = unwrap(node.expression);
                const exactArgument = argument === null
                    || (node.arguments.length === 1
                        && ts.isIdentifier(unwrap(node.arguments[0]))
                        && unwrap(node.arguments[0]).text === argument);
                if (ts.isIdentifier(expression) && expression.text === callee && exactArgument) calls.push(node);
            }
            ts.forEachChild(node, visit);
        };
        visit(root);
        return calls;
    };
    const exactReachableCall = (root, callee, argument = null) => {
        const calls = identifierCalls(root, callee, argument);
        return calls.length === 1 && isReachableStandaloneCall(calls[0], root);
    };
    // @Codex: both native admission checks must return before preparing/mutating
    // credentials; the second check also burns the two prepared capabilities.
    const nativeCurrentGuard = (statement, abortPrepared = false) => {
        if (!statement || !ts.isIfStatement(statement) || statement.elseStatement
            || compact(statement.expression) !== 'nativeSession && await readNativeSession(input.request) !== nativeSession') return false;
        const body = ts.isBlock(statement.thenStatement)
            ? [...statement.thenStatement.statements] : [statement.thenStatement];
        return body.length === (abortPrepared ? 2 : 1)
            && (!abortPrepared || exactReachableCall(body[0], 'abortPreparedRetirements'))
            && ts.isReturnStatement(body.at(-1))
            && compact(body.at(-1).expression) === "{ kind: 'unauthorized' }";
    };
    // @Codex: inspect executable statements, so comments cannot impersonate a
    // commit. A failed post-CAS commit retains its fence and never calls abort.
    const retirementCommit = (outcome, commit, capability) => findIndex((statement) =>
        ts.isTryStatement(statement) && !statement.finallyBlock && statement.catchClause
        && statement.tryBlock.statements.length === 1
        && compact(statement.tryBlock.statements[0]) === `${outcome} = ${commit}(${capability}).outcome;`
        && statement.catchClause.block.statements.length === 1
        && compact(statement.catchClause.block.statements[0]) === `${outcome} = 'failed';`);

    const prepareNativeAlias = findIndex((_statement, text) => text
        === 'const prepareNativeRetirement = dependencies.prepareNativeSessionsForUserRetirement ?? prepareNativeLegacyUserRetirement;');
    const commitNativeAlias = findIndex((_statement, text) => text
        === 'const commitNativeRetirement = dependencies.commitNativeSessionsForUserRetirement ?? commitNativeLegacyUserRetirement;');
    const abortNativeAlias = findIndex((_statement, text) => text
        === 'const abortNativeRetirement = dependencies.abortNativeSessionsForUserRetirement ?? abortNativeLegacyUserRetirement;');
    const prepareWebAlias = findIndex((_statement, text) => text
        === 'const prepareWebRetirement = dependencies.prepareWebSessionsForUserRetirement ?? prepareUserRetirement;');
    const commitWebAlias = findIndex((_statement, text) => text
        === 'const commitWebRetirement = dependencies.commitWebSessionsForUserRetirement ?? commitUserRetirement;');
    const abortWebAlias = findIndex((_statement, text) => text
        === 'const abortWebRetirement = dependencies.abortWebSessionsForUserRetirement ?? abortUserRetirement;');
    const nativeSession = findIndex((_statement, text) => text
        === "const nativeSession = input.session.authChannel === 'native' ? input.session : null;");
    const readNativeAlias = findIndex((_statement, text) => text
        === 'const readNativeSession = dependencies.readPairedNativeSession ?? requirePairedNativeSession;');
    const nativeAdmission = findIndex((statement) => nativeCurrentGuard(statement));
    const nativeCapability = findIndex((_statement, text) => text
        === 'const nativeRetirement = nativeSession ? preparePairedNativePinRetirement(nativeSession) : prepareNativeRetirement(user.id);');
    const nativeCapabilityGuard = findIndex((statement) => ts.isIfStatement(statement)
        && compact(statement.expression) === '!nativeRetirement' && alwaysTerminates(statement.thenStatement));
    const webCapability = findIndex((_statement, text) => text
        === 'const webRetirement = nativeSession ? prepareNativeUserRetirement(nativeRetirement) : prepareWebRetirement(input.session);');
    const webCapabilityGuard = findIndex((statement) => ts.isIfStatement(statement)
        && compact(statement.expression) === '!webRetirement'
        && exactReachableCall(statement.thenStatement, 'abortNativeRetirement', 'nativeRetirement')
        && alwaysTerminates(statement.thenStatement));
    const abortPrepared = findIndex((statement) => {
        const initializer = variableInitializer(statement, 'abortPreparedRetirements');
        if (!initializer || (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer))) return false;
        const webCalls = identifierCalls(initializer, 'abortWebRetirement', 'webRetirement');
        const nativeCalls = identifierCalls(initializer, 'abortNativeRetirement', 'nativeRetirement');
        return webCalls.length === 1 && nativeCalls.length === 1
            && isReachableStandaloneCall(webCalls[0], initializer)
            && isReachableStandaloneCall(nativeCalls[0], initializer)
            && webCalls[0].pos < nativeCalls[0].pos;
    });
    const hashDeclaration = findIndex((_statement, text) => text === 'let nextPasswordHash: string;');
    const hash = findIndex((statement, text) => ts.isTryStatement(statement)
        && text.includes('nextPasswordHash = await bcrypt.hash(input.newPin, 10);')
        && statement.catchClause
        && exactReachableCall(statement.catchClause.block, 'abortPreparedRetirements')
        && alwaysTerminates(statement.catchClause.block));
    const updateDeclaration = findIndex((_statement, text) => text === 'let updateResult: { changes: number };');
    const transaction = findIndex((statement, text) => ts.isTryStatement(statement)
        && text.includes('updateResult = db.transaction(')
        && nativeCurrentGuard(statement.tryBlock.statements[0], true)
        && statement.catchClause
        && exactReachableCall(statement.catchClause.block, 'abortPreparedRetirements')
        && alwaysTerminates(statement.catchClause.block));
    const casGuard = findIndex((statement) => ts.isIfStatement(statement)
        && compact(statement.expression) === 'updateResult.changes !== 1'
        && exactReachableCall(statement.thenStatement, 'abortPreparedRetirements')
        && alwaysTerminates(statement.thenStatement));
    const webOutcome = findIndex((_statement, text) => text
        === "let webRetirementOutcome: 'completed' | 'failed' | 'denied' = 'failed';");
    const webCommit = retirementCommit('webRetirementOutcome', 'commitWebRetirement', 'webRetirement');
    const nativeOutcome = findIndex((_statement, text) => text
        === "let nativeRetirementOutcome: 'completed' | 'failed' | 'denied' = 'failed';");
    const nativeCommit = retirementCommit('nativeRetirementOutcome', 'commitNativeRetirement', 'nativeRetirement');
    const completedGuard = findIndex((statement) => ts.isIfStatement(statement)
        && compact(statement.expression)
        === "webRetirementOutcome !== 'completed' || nativeRetirementOutcome !== 'completed'"
        && alwaysTerminates(statement.thenStatement));
    const auditStatement = writerCall ? directStatement(owner, writerCall) : null;
    const audit = auditStatement ? statements.indexOf(auditStatement) : -1;
    const ordered = [
        prepareNativeAlias, commitNativeAlias, abortNativeAlias,
        prepareWebAlias, commitWebAlias, abortWebAlias,
        nativeSession, readNativeAlias, nativeAdmission,
        nativeCapability, nativeCapabilityGuard, webCapability, webCapabilityGuard, abortPrepared,
        hashDeclaration, hash, updateDeclaration, transaction, casGuard,
        webOutcome, webCommit, nativeOutcome, nativeCommit, completedGuard, audit,
    ];
    if (importedName(sourceFile, '@/lib/security/web-auth-lifecycle-owner-adapter', 'prepareUserRetirement')
            !== 'prepareUserRetirement'
        || importedName(sourceFile, '@/lib/security/web-auth-lifecycle-owner-adapter', 'commitUserRetirement')
            !== 'commitUserRetirement'
        || importedName(sourceFile, '@/lib/security/web-auth-lifecycle-owner-adapter', 'abortUserRetirement')
            !== 'abortUserRetirement'
        || importedName(sourceFile, '@/lib/security/server-session', 'prepareNativeLegacyUserRetirement')
            !== 'prepareNativeLegacyUserRetirement'
        || importedName(sourceFile, '@/lib/security/server-session', 'commitNativeLegacyUserRetirement')
            !== 'commitNativeLegacyUserRetirement'
        || importedName(sourceFile, '@/lib/security/server-session', 'abortNativeLegacyUserRetirement')
            !== 'abortNativeLegacyUserRetirement'
        || importedName(sourceFile, '@/lib/security/server-session', 'preparePairedNativePinRetirement')
            !== 'preparePairedNativePinRetirement'
        || importedName(sourceFile, '@/lib/security/web-auth-lifecycle-owner-adapter', 'prepareNativeUserRetirement')
            !== 'prepareNativeUserRetirement'
        || importedName(sourceFile, '@/lib/security/paired-native-session', 'requirePairedNativeSession')
            !== 'requirePairedNativeSession'
        || ['preparePairedNativePinRetirement', 'prepareNativeUserRetirement', 'requirePairedNativeSession']
            .some((name) => localBindingExists(owner, name))) {
        problems.push('PIN audit must retain the exact Web and native retirement owner imports');
    }
    if (casGuard >= 0 && statements.slice(casGuard + 1).some((statement) =>
        ['abortPreparedRetirements', 'abortWebRetirement', 'abortNativeRetirement',
            'abortUserRetirement', 'abortNativeLegacyUserRetirement']
            .some((callee) => identifierCalls(statement, callee, null, true).length > 0))) {
        problems.push('PIN audit must not abort retirement fences after a successful credential CAS');
    }
    if (ordered.some((index) => index < 0)
        || ordered.some((index, position) => position > 0 && index <= ordered[position - 1])) {
        problems.push('PIN audit must prepare both owners, abort both before failed CAS tails, commit Web then native, and audit only after completion');
    }
    return problems;
}

/* @Codex */
export function validateAuditWriterControlFlow({
    source,
    fileName = 'fixture.ts',
    sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    ownerName,
    writerModule,
    writerExport,
    eventType,
    writerArgumentIndex = 0,
    dependencyFallback = null,
    requirePinRetirementOrder = false,
}) {
    const problems = sourceFile.parseDiagnostics.length > 0 ? [`${fileName} has parser diagnostics`] : [];
    const binding = importedName(sourceFile, writerModule, writerExport);
    const owners = sourceFile.statements.filter((statement) =>
        ts.isFunctionDeclaration(statement) && statement.name?.text === ownerName);
    if (!binding) problems.push('approved writer import is missing or ambiguous');
    if (owners.length !== 1) problems.push('owner function is missing or ambiguous');
    if (!binding || owners.length !== 1) return problems;
    const owner = owners[0];
    if (localBindingExists(owner, binding)) problems.push('approved writer import is shadowed');
    if (dependencyFallback && localBindingExists(owner, dependencyFallback.parameter, true)) problems.push('dependency fallback binding is shadowed');
    const calls = directWriterCalls(owner, binding, dependencyFallback);
    if (calls.all.length !== 1 || calls.direct.length !== 1) problems.push('owner must contain exactly one direct approved writer call');
    if (calls.all.length === 1 && calls.direct.length === 1) {
        const input = calls.direct[0].arguments[writerArgumentIndex];
        const events = input && ts.isObjectLiteralExpression(input)
            ? input.properties.filter((property) => ts.isPropertyAssignment(property)
                && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
                && property.name.text === 'eventType')
            : [];
        const hasUnsafeProperty = input && ts.isObjectLiteralExpression(input)
            && input.properties.some((property) => ts.isSpreadAssignment(property)
                || Boolean(property.name && ts.isComputedPropertyName(property.name)));
        if (hasUnsafeProperty || events.length !== 1 || !ts.isStringLiteral(events[0].initializer)
            || events[0].initializer.text !== eventType) problems.push('writer event literal is missing or incorrect');
        if (!isReachableStandaloneCall(calls.direct[0], owner)) problems.push('writer call is unreachable or uses unsupported control flow');
        if (requirePinRetirementOrder) {
            problems.push(...validatePinRetirementAuditOrder(sourceFile, owner, calls.direct[0]));
        }
    }
    return problems;
}

function namedFunction(sourceFile, name, requireExport = false) {
    const matches = sourceFile.statements.filter((statement) => ts.isFunctionDeclaration(statement)
        && statement.name?.text === name
        && (!requireExport || ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)));
    return matches.length === 1 ? matches[0] : null;
}

function checkedSource(fileName, source) {
    const options = { noLib: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext };
    const host = {
        ...ts.createCompilerHost(options),
        fileExists: (name) => name === fileName,
        readFile: (name) => name === fileName ? source : undefined,
        getSourceFile: (name, language) => name === fileName
            ? ts.createSourceFile(name, source, language, true, ts.ScriptKind.TS)
            : undefined,
    };
    const program = ts.createProgram([fileName], options, host);
    return { sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker() };
}

function importedBinding(sourceFile, checker, moduleName, exportName) {
    const matches = sourceFile.statements.flatMap((statement) => {
        if (!ts.isImportDeclaration(statement)
            || !ts.isStringLiteral(statement.moduleSpecifier)
            || statement.moduleSpecifier.text !== moduleName
            || statement.importClause?.isTypeOnly
            || !statement.importClause?.namedBindings
            || !ts.isNamedImports(statement.importClause.namedBindings)) return [];
        return statement.importClause.namedBindings.elements.filter((element) =>
            !element.isTypeOnly && (element.propertyName?.text ?? element.name.text) === exportName);
    });
    if (matches.length !== 1) return null;
    return { symbol: checker.getSymbolAtLocation(matches[0].name) };
}

function resolvesToBinding(checker, symbol, target, seen = new Set()) {
    if (!symbol || !target || seen.has(symbol)) return false;
    if (symbol === target) return true;
    seen.add(symbol);
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0])
        || !ts.isVariableDeclarationList(declarations[0].parent)
        || !(declarations[0].parent.flags & ts.NodeFlags.Const)) return false;
    const initializer = declarations[0].initializer && unwrap(declarations[0].initializer);
    return Boolean(initializer && ts.isIdentifier(initializer))
        && resolvesToBinding(checker, checker.getSymbolAtLocation(initializer), target, seen);
}

function bindingCalls(root, checker, target) {
    const calls = [];
    const visit = (node) => {
        const callee = ts.isCallExpression(node) ? unwrap(node.expression) : null;
        if (callee && ts.isIdentifier(callee)
            && resolvesToBinding(checker, checker.getSymbolAtLocation(callee), target)) calls.push(node);
        ts.forEachChild(node, visit);
    };
    visit(root);
    return calls;
}

/* @Codex */
export function validateDelegatedRouteAudit({ spec, routeSource, serviceSource }) {
    const problems = [];
    const route = checkedSource('route.ts', routeSource);
    const service = checkedSource('service.ts', serviceSource);
    if (route.sourceFile.parseDiagnostics.length > 0) problems.push('route has parser diagnostics');
    if (service.sourceFile.parseDiagnostics.length > 0) problems.push('service has parser diagnostics');
    const delegate = importedBinding(route.sourceFile, route.checker, spec.serviceModule, spec.serviceExport);
    const handler = namedFunction(route.sourceFile, spec.handler, true);
    if (!delegate) problems.push('approved service import is missing or ambiguous');
    if (!handler) problems.push(`exported ${spec.handler} handler is missing or ambiguous`);
    if (delegate && handler) {
        const allCalls = bindingCalls(route.sourceFile, route.checker, delegate.symbol);
        const handlerCalls = bindingCalls(handler, route.checker, delegate.symbol);
        if (allCalls.length !== 1 || handlerCalls.length !== 1 || !isReachableCall(handlerCalls[0], handler)) {
            problems.push('handler must make exactly one reachable approved service call');
        }
    }

    const serviceEntry = namedFunction(service.sourceFile, spec.serviceExport, true);
    if (!serviceEntry) problems.push('configured service export is missing or ambiguous');
    if (serviceEntry && spec.hop) {
        const owner = namedFunction(service.sourceFile, spec.ownerName);
        const target = owner?.name && service.checker.getSymbolAtLocation(owner.name);
        const calls = bindingCalls(serviceEntry, service.checker, target);
        const literal = calls[0]?.arguments[spec.hop.argumentIndex];
        if (!owner || calls.length !== 1 || !isReachableCall(calls[0], serviceEntry)
            || !ts.isStringLiteral(literal) || literal.text !== spec.hop.literal) {
            problems.push('service export must make exactly one reachable configured hop with the exact literal');
        }
    } else if (serviceEntry && spec.ownerName !== spec.serviceExport) {
        problems.push('owner mismatch requires one configured hop');
    }
    return problems;
}

/* @Codex: bounded diary wiring/order guard, complementary to real SQLite rollback and scope tests.
 * The required audit writer itself is checked by the patient contracts in the same gate.
 * This does not claim to prove parent admission, CAS or cipher semantics statically. */
export function validateRequiredDiaryAudit(input) {
    return validateRequiredClinicalRowAudit(input, 'entry');
}

/* @Codex: reuse only the structural proof, not date/cap/idempotency policy. */
export function validateRequiredTherapyAudit(input) {
    return validateRequiredClinicalRowAudit(input, 'therapy');
}

/* @Codex: structural proof only; link/currentness/value semantics require real SQLite tests. */
export function validateRequiredObservationAudit(input) {
    return validateRequiredClinicalRowAudit(input, 'observation');
}

function validateRequiredClinicalRowAudit({ spec, routeSource, coreSource, bridgeSource = null }, resource) {
    const problems = [];
    const core = checkedSource(spec.ownerFile, coreSource);
    const owner = namedFunction(core.sourceFile, spec.ownerName, true);
    const delegateCall = (source, handlerName, moduleName, exportName) => {
        const parsed = checkedSource(`${resource}-adapter.ts`, source);
        const handler = namedFunction(parsed.sourceFile, handlerName, true);
        const binding = importedBinding(parsed.sourceFile, parsed.checker, moduleName, exportName);
        const calls = handler && binding ? bindingCalls(handler, parsed.checker, binding.symbol) : [];
        if (parsed.sourceFile.parseDiagnostics.length || !handler || calls.length !== 1
            || !isReachableCall(calls[0], handler)) {
            problems.push(`${handlerName} must call exactly one reachable approved clinical-row delegate`);
            return null;
        }
        return calls[0];
    };
    let call;
    if (spec.mode === 'network') {
        delegateCall(routeSource, spec.handler, `@/lib/network-${resource}-write`, spec.bridgeExport);
        call = bridgeSource && delegateCall(bridgeSource, spec.bridgeExport,
            `./${resource}-write-operation`, spec.ownerName);
        if (!bridgeSource) problems.push('network clinical-row adapter is missing');
    } else {
        call = delegateCall(routeSource, spec.handler, spec.serviceModule, spec.serviceExport);
    }
    const argument = call?.arguments[0] && unwrap(call.arguments[0]);
    const modeProperties = argument && ts.isObjectLiteralExpression(argument)
        ? argument.properties.filter((property) => ts.isPropertyAssignment(property)
            && ts.isIdentifier(property.name) && property.name.text === 'mode') : [];
    if (!argument || !ts.isObjectLiteralExpression(argument)
        || argument.properties.some((property) => ts.isSpreadAssignment(property)
            || (property.name && ts.isComputedPropertyName(property.name)))
        || modeProperties.length !== 1 || !ts.isStringLiteral(modeProperties[0].initializer)
        || modeProperties[0].initializer.text !== spec.mode) problems.push('clinical-row adapter must select its exact admitted mode');

    const db = importedBinding(core.sourceFile, core.checker, './db-server', 'dbServer');
    const writer = importedBinding(core.sourceFile, core.checker, './security/audit', 'writeAuditEventInTransaction');
    const table = importedBinding(core.sourceFile, core.checker, './schema', ({ entry: 'entries', therapy: 'therapies', observation: 'observations' })[resource]);
    if (core.sourceFile.parseDiagnostics.length || !owner || !db || !writer || !table) {
        problems.push('clinical-row core must import the approved database, resource table and required audit writer');
        return problems;
    }
    const calls = [];
    const visit = (node) => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit); };
    visit(owner);
    const transactions = calls.filter((node) => {
        const callee = unwrap(node.expression);
        return ts.isPropertyAccessExpression(callee) && !callee.questionDotToken && callee.name.text === 'transaction'
            && ts.isIdentifier(callee.expression)
            && resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(callee.expression), db.symbol);
    });
    const transaction = transactions.length === 1 ? transactions[0] : null;
    const callback = transaction?.arguments[0] && unwrap(transaction.arguments[0]);
    const options = transaction?.arguments[1] && unwrap(transaction.arguments[1]);
    const behavior = options && ts.isObjectLiteralExpression(options)
        ? exactPropertyAssignments(options, ['behavior'])?.get('behavior')?.initializer : null;
    if (!transaction || transaction.arguments.length !== 2 || !ts.isReturnStatement(transaction.parent)
        || transaction.parent.parent !== owner.body || !isReachableCall(transaction, owner)
        || !callback || !ts.isArrowFunction(callback) || !ts.isBlock(callback.body)
        || callback.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
        || callback.parameters.length !== 1 || !ts.isIdentifier(callback.parameters[0].name)
        || localBindingExists(callback, callback.parameters[0].name.text, true)
        || !behavior || !ts.isStringLiteral(behavior) || behavior.text !== 'immediate') {
        problems.push('clinical-row owner must return one synchronous immediate transaction');
        return problems;
    }
    const txName = callback.parameters[0].name.text;
    const auditCalls = bindingCalls(owner, core.checker, writer.symbol);
    const audit = auditCalls.length === 1 ? auditCalls[0] : null;
    const auditStatement = audit?.parent;
    const statements = [...callback.body.statements];
    const auditIndex = statements.indexOf(auditStatement);
    if (!audit || audit.arguments.length !== 2 || !ts.isIdentifier(unwrap(audit.arguments[0]))
        || unwrap(audit.arguments[0]).text !== txName || auditIndex < 2
        || !ts.isExpressionStatement(auditStatement) || !isReachableStandaloneCall(audit, callback)) {
        problems.push('exactly one direct required clinical-row audit must execute on the same transaction');
        return problems;
    }
    const compact = (node) => node?.getText(core.sourceFile).replace(/\s+/gu, '') ?? '';
    const mutationStatement = statements[auditIndex - 2];
    const declaration = ts.isVariableStatement(mutationStatement)
        && mutationStatement.declarationList.declarations.length === 1
        ? mutationStatement.declarationList.declarations[0] : null;
    const mutation = declaration?.initializer;
    const mutations = calls.filter((node) => {
        const callee = unwrap(node.expression);
        const target = node.arguments[0] && unwrap(node.arguments[0]);
        return ts.isPropertyAccessExpression(callee) && callee.name.text === (spec.operation === 'create' ? 'insert' : 'update')
            && ts.isIdentifier(callee.expression) && callee.expression.text === txName
            && target && ts.isIdentifier(target)
            && resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(target), table.symbol);
    });
    const guard = statements[auditIndex - 1];
    const throws = ts.isIfStatement(guard) && (ts.isBlock(guard.thenStatement)
        ? [...guard.thenStatement.statements] : [guard.thenStatement]);
    // @Codex: follow receivers, not source containment (a nested callback is not a write).
    let receiver = mutation;
    let directChain = true;
    for (const [method, arity] of spec.operation === 'create'
        ? [['run', 0], ['values', 1]] : [['run', 0], ['where', 1], ['set', 1]]) {
        if (!receiver || !ts.isCallExpression(receiver) || receiver.questionDotToken
            || receiver.arguments.length !== arity || !ts.isPropertyAccessExpression(receiver.expression)
            || receiver.expression.questionDotToken || receiver.expression.name.text !== method) {
            directChain = false;
            break;
        }
        receiver = unwrap(receiver.expression.expression);
    }
    if (!declaration || !ts.isIdentifier(declaration.name) || !mutation || !ts.isCallExpression(mutation)
        || !ts.isPropertyAccessExpression(mutation.expression) || mutation.expression.name.text !== 'run'
        || !directChain || mutations.length !== 1 || receiver !== mutations[0]
        || !ts.isIfStatement(guard) || guard.elseStatement
        || compact(guard.expression) !== `${declaration.name.text}.changes!==1`
        || throws.length !== 1 || !ts.isThrowStatement(throws[0])) {
        problems.push('clinical-row mutation and exact-one-row throwing check must directly precede audit');
    }
    const input = audit.arguments[1] && unwrap(audit.arguments[1]);
    const props = input && ts.isObjectLiteralExpression(input)
        ? exactPropertyAssignments(input, ['eventType', 'outcome', 'actorType', 'actorRef',
            'subjectType', 'subjectRef', 'sourceSurface', 'requestId', 'redactedMetadata']) : null;
    const literal = (name, value) => {
        const node = props?.get(name)?.initializer;
        return node && ts.isStringLiteral(node) && node.text === value;
    };
    const event = props?.get('eventType')?.initializer;
    const inputName = owner.parameters[0]?.name;
    const name = inputName && ts.isIdentifier(inputName) ? inputName.text : null;
    const eventValid = spec.operation === 'create' ? literal('eventType', `${resource}.created`)
        : event && ts.isConditionalExpression(event) && compact(event.condition) === `${name}.values.deletedAt`
            && ts.isStringLiteral(event.whenTrue) && event.whenTrue.text === `${resource}.deleted`
            && ts.isStringLiteral(event.whenFalse) && event.whenFalse.text === `${resource}.updated`;
    if (!name || !props || !eventValid || !literal('outcome', 'success') || !literal('subjectType', resource)
        || compact(props.get('subjectRef')?.initializer) !== `${name}.${resource === 'entry' && spec.operation === 'create' ? 'id' : `${resource}Id`}`) {
        problems.push('clinical-row audit event and subject must describe the applied resource mutation');
    }
    if (auditIndex !== statements.length - 2 || !ts.isReturnStatement(statements[auditIndex + 1])) {
        problems.push('clinical-row success must return immediately after the required audit');
    }
    return problems;
}

/* @Codex: bounded C04 patient-update contract; this source guard complements the real transaction tests. */
export function validateRequiredPatientUpdateAudit({ spec, routeSource, coreSource, auditSource }) {
    const problems = validateDelegatedRouteAudit({ spec, routeSource, serviceSource: coreSource });
    const core = checkedSource(spec.ownerFile, coreSource);
    const owner = namedFunction(core.sourceFile, spec.ownerName, true);
    const db = importedBinding(core.sourceFile, core.checker, './db-server', 'dbServer');
    const membership = importedBinding(core.sourceFile, core.checker, './patient-ambulatory-membership', 'upsertPrimaryAmbulatoryMembership');
    const writer = importedBinding(core.sourceFile, core.checker, './security/audit', 'writeAuditEventInTransaction');
    const classifier = importedBinding(core.sourceFile, core.checker, './security/audit', 'classifyPatientMutationEvent');
    const patientTable = importedBinding(core.sourceFile, core.checker, './schema', 'patients');
    if (core.sourceFile.parseDiagnostics.length || !owner || !db || !membership || !writer || !classifier || !patientTable) {
        problems.push('patient update core must import the approved transaction, membership, classifier, table and required writer');
        return problems;
    }
    const calls = (root, predicate) => {
        const found = [];
        const visit = (node) => {
            if (ts.isCallExpression(node) && predicate(node)) found.push(node);
            ts.forEachChild(node, visit);
        };
        visit(root);
        return found;
    };
    const importedObjectCall = (call, importBinding, name) => {
        const callee = unwrap(call.expression);
        return ts.isPropertyAccessExpression(callee) && !callee.questionDotToken && callee.name.text === name
            && ts.isIdentifier(callee.expression)
            && resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(callee.expression), importBinding.symbol);
    };
    const transactionCalls = calls(owner.body, (call) => importedObjectCall(call, db, 'transaction'));
    const transaction = transactionCalls.length === 1 ? transactionCalls[0] : null;
    const returned = transaction && transaction.parent && ts.isReturnStatement(transaction.parent)
        && transaction.parent.parent === owner.body;
    const callback = transaction?.arguments[0] && unwrap(transaction.arguments[0]);
    const txName = callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body)
        && callback.parameters.length === 1 && ts.isIdentifier(callback.parameters[0].name)
        ? callback.parameters[0].name.text : null;
    const options = transaction?.arguments[1] && unwrap(transaction.arguments[1]);
    const optionProperties = options && ts.isObjectLiteralExpression(options)
        ? exactPropertyAssignments(options, ['behavior']) : null;
    const behavior = optionProperties?.get('behavior')?.initializer;
    if (!returned || transaction.arguments.length !== 2 || !isReachableCall(transaction, owner)
        || !txName || localBindingExists(callback, txName, true)
        || !behavior || !ts.isStringLiteral(behavior) || behavior.text !== 'immediate') {
        problems.push('patient update must return one immediate dbServer.transaction with an unshadowed tx callback');
        return problems;
    }
    const txArgument = (call) => call.arguments.length > 0
        && ts.isIdentifier(unwrap(call.arguments[0])) && unwrap(call.arguments[0]).text === txName;
    const membershipCalls = bindingCalls(owner, core.checker, membership.symbol);
    const writerCalls = bindingCalls(owner, core.checker, writer.symbol);
    const member = membershipCalls.length === 1 ? membershipCalls[0] : null;
    const audit = writerCalls.length === 1 ? writerCalls[0] : null;
    const auditStatement = audit && directStatement(callback, audit);
    if (!member || !audit || !txArgument(member) || !txArgument(audit)
        || !isReachableCall(member, callback) || !isReachableStandaloneCall(audit, callback)
        || !auditStatement || !ts.isExpressionStatement(auditStatement)
        || member.pos >= audit.pos) {
        problems.push('membership and exactly one required audit writer must use the same tx inside the callback, in order');
        return problems;
    }
    const updates = calls(callback.body, (call) => {
        const callee = unwrap(call.expression);
        const table = call.arguments[0] && unwrap(call.arguments[0]);
        return ts.isPropertyAccessExpression(callee) && callee.name.text === 'update'
            && ts.isIdentifier(callee.expression) && callee.expression.text === txName
            && ts.isIdentifier(table)
            && resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(table), patientTable.symbol);
    });
    if (updates.length !== 1 || !isReachableCall(updates[0], callback) || updates[0].pos >= member.pos) {
        problems.push('patient update must use the transaction before membership and required audit');
    }
    const input = audit.arguments[1] && unwrap(audit.arguments[1]);
    const props = input && ts.isObjectLiteralExpression(input)
        ? exactPropertyAssignments(input, ['eventType', 'outcome', 'actorType', 'actorRef',
            'subjectType', 'subjectRef', 'sourceSurface', 'requestId', 'redactedMetadata']) : null;
    const event = props?.get('eventType')?.initializer;
    const subject = props?.get('subjectType')?.initializer;
    const subjectRef = props?.get('subjectRef')?.initializer;
    const outcome = props?.get('outcome')?.initializer;
    const ownerInput = owner.parameters[0]?.name;
    const previousState = event && ts.isCallExpression(event) && event.arguments[0] && unwrap(event.arguments[0]);
    const nextState = event && ts.isCallExpression(event) && event.arguments[1] && unwrap(event.arguments[1]);
    const nextValues = nextState && ts.isPropertyAccessExpression(nextState) ? nextState.expression : null;
    if (!event || !ts.isCallExpression(event) || !ts.isIdentifier(unwrap(event.expression))
        || !resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(unwrap(event.expression)), classifier.symbol)
        || event.arguments.length !== 2
        || !previousState || !ts.isBinaryExpression(previousState)
        || previousState.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
        || !ts.isPropertyAccessExpression(previousState.left)
        || !ts.isIdentifier(previousState.left.expression)
        || previousState.left.expression.text !== 'existing'
        || previousState.left.name.text !== 'isArchived'
        || previousState.right.kind !== ts.SyntaxKind.NullKeyword
        || !nextState || !ts.isPropertyAccessExpression(nextState)
        || nextState.name.text !== 'isArchived'
        || !nextValues || !ts.isPropertyAccessExpression(nextValues)
        || nextValues.name.text !== 'values'
        || !ts.isIdentifier(nextValues.expression) || !ts.isIdentifier(ownerInput)
        || !resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(nextValues.expression),
            core.checker.getSymbolAtLocation(ownerInput))
        || !subject || !ts.isStringLiteral(subject) || subject.text !== 'patient'
        || !subjectRef || !ts.isPropertyAccessExpression(subjectRef)
        || !ts.isIdentifier(subjectRef.expression) || !ts.isIdentifier(ownerInput)
        || !resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(subjectRef.expression),
            core.checker.getSymbolAtLocation(ownerInput)) || subjectRef.name.text !== 'patientId'
        || !outcome || !ts.isStringLiteral(outcome) || outcome.text !== 'success') {
        problems.push('required audit must classify the patient event and bind the same patient subject');
    }

    const auditFile = checkedSource('lib/security/audit.ts', auditSource);
    const writerOwner = namedFunction(auditFile.sourceFile, 'writeAuditEventInTransaction', true);
    const auditTable = importedBinding(auditFile.sourceFile, auditFile.checker, '../schema', 'auditEvents');
    const writerTx = writerOwner?.parameters[0]?.name;
    const inserts = writerOwner && auditTable ? calls(writerOwner.body, (call) => {
        const run = unwrap(call.expression);
        if (!writerTx || !ts.isIdentifier(writerTx) || !ts.isPropertyAccessExpression(run)
            || run.name.text !== 'run') return false;
        const valuesCall = unwrap(run.expression);
        if (!ts.isCallExpression(valuesCall) || valuesCall.arguments.length !== 1
            || !ts.isIdentifier(unwrap(valuesCall.arguments[0]))
            || unwrap(valuesCall.arguments[0]).text !== 'row') return false;
        const values = unwrap(valuesCall.expression);
        if (!ts.isPropertyAccessExpression(values) || values.name.text !== 'values') return false;
        const insertCall = unwrap(values.expression);
        if (!ts.isCallExpression(insertCall)) return false;
        const insert = unwrap(insertCall.expression);
        const table = insertCall.arguments[0] && unwrap(insertCall.arguments[0]);
        return ts.isPropertyAccessExpression(insert) && insert.name.text === 'insert'
            && ts.isIdentifier(insert.expression) && insert.expression.text === writerTx.text
            && table && ts.isIdentifier(table)
            && resolvesToBinding(auditFile.checker, auditFile.checker.getSymbolAtLocation(table), auditTable.symbol);
    }) : [];
    const insertStatement = inserts.length === 1 && directStatement(writerOwner, inserts[0]);
    const resultDeclaration = insertStatement && ts.isVariableStatement(insertStatement)
        && insertStatement.declarationList.declarations.length === 1
        ? insertStatement.declarationList.declarations[0] : null;
    const resultName = resultDeclaration?.name;
    const statementIndex = writerOwner?.body?.statements.indexOf(insertStatement) ?? -1;
    const resultGuard = statementIndex >= 0 ? writerOwner.body.statements[statementIndex + 1] : null;
    const guardCondition = resultGuard && ts.isIfStatement(resultGuard) ? unwrap(resultGuard.expression) : null;
    const checkedResult = resultDeclaration?.initializer === inserts[0]
        && resultName && ts.isIdentifier(resultName)
        && guardCondition && ts.isBinaryExpression(guardCondition)
        && guardCondition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
        && ts.isPropertyAccessExpression(guardCondition.left)
        && ts.isIdentifier(guardCondition.left.expression)
        && guardCondition.left.expression.text === resultName.text
        && guardCondition.left.name.text === 'changes'
        && ts.isNumericLiteral(guardCondition.right) && guardCondition.right.text === '1'
        && !resultGuard.elseStatement
        && ts.isBlock(resultGuard.thenStatement)
        && resultGuard.thenStatement.statements.length === 1
        && ts.isThrowStatement(resultGuard.thenStatement.statements[0]);
    const rowDeclaration = writerOwner?.body?.statements.find((statement) => ts.isVariableStatement(statement)
        && statement.declarationList.declarations.length === 1
        && ts.isIdentifier(statement.declarationList.declarations[0].name)
        && statement.declarationList.declarations[0].name.text === 'row');
    const rowInitializer = rowDeclaration?.declarationList.declarations[0].initializer;
    const writerInput = writerOwner?.parameters[1]?.name;
    if (auditFile.sourceFile.parseDiagnostics.length || !writerOwner || !auditTable || inserts.length !== 1
        || !isReachableCall(inserts[0], writerOwner) || !checkedResult
        || !rowInitializer || !ts.isCallExpression(rowInitializer)
        || !ts.isIdentifier(rowInitializer.expression) || rowInitializer.expression.text !== 'buildAuditEventRow'
        || !writerInput || !ts.isIdentifier(writerInput) || rowInitializer.arguments.length !== 1
        || !ts.isIdentifier(rowInitializer.arguments[0]) || rowInitializer.arguments[0].text !== writerInput.text) {
        problems.push('required writer must execute one auditEvents insert on the supplied tx');
    }
    return problems;
}

/* @Codex: bounded C05 DELETE contract; runtime tests remain the authority for rollback behavior. */
export function validateRequiredPatientDeleteAudit({ spec, routeSource, coreSource, auditSource }) {
    const problems = validateDelegatedRouteAudit({ spec, routeSource, serviceSource: coreSource });
    const core = checkedSource(spec.ownerFile, coreSource);
    const owner = namedFunction(core.sourceFile, spec.ownerName, true);
    const db = importedBinding(core.sourceFile, core.checker, './db-server', 'dbServer');
    const patients = importedBinding(core.sourceFile, core.checker, './schema', 'patients');
    const andBinding = importedBinding(core.sourceFile, core.checker, 'drizzle-orm', 'and');
    const eqBinding = importedBinding(core.sourceFile, core.checker, 'drizzle-orm', 'eq');
    const active = importedBinding(core.sourceFile, core.checker, './patient-lifecycle', 'activePatients');
    const tombstone = importedBinding(core.sourceFile, core.checker, './patient-lifecycle', 'buildPatientTombstoneValues');
    const conflict = importedBinding(core.sourceFile, core.checker, './patient-concurrency', 'buildPatientVersionConflictPayload');
    const writer = importedBinding(core.sourceFile, core.checker, './security/audit', 'writeAuditEventInTransaction');
    if (core.sourceFile.parseDiagnostics.length || !owner || !db || !patients || !andBinding || !eqBinding
        || !active || !tombstone || !conflict || !writer) {
        problems.push('delete core must import the approved transaction, patient table, lifecycle, conflict and required writer');
        return problems;
    }
    const calls = (root, predicate) => {
        const found = [];
        const visit = (node) => { if (ts.isCallExpression(node) && predicate(node)) found.push(node); ts.forEachChild(node, visit); };
        visit(root);
        return found;
    };
    const route = checkedSource('route.ts', routeSource);
    const routeHandler = namedFunction(route.sourceFile, 'DELETE', true);
    const routeDelegate = importedBinding(route.sourceFile, route.checker, spec.serviceModule, spec.serviceExport);
    const jsonParser = importedBinding(route.sourceFile, route.checker, '@/lib/patient-json-object', 'parsePatientJsonObject');
    const versionParser = importedBinding(route.sourceFile, route.checker, '@/lib/patient-concurrency', 'parseExpectedVersion');
    const contextExport = spec.deletionReason === 'web-delete' ? 'auditContextFromSession' : 'auditContextFromRequest';
    const auditContext = importedBinding(route.sourceFile, route.checker, '@/lib/security/audit', contextExport);
    const reasonOwner = namedFunction(route.sourceFile, 'parsePatientDeletionReason');
    const reasonSymbol = reasonOwner?.name && route.checker.getSymbolAtLocation(reasonOwner.name);
    const routeCalls = routeHandler && routeDelegate ? bindingCalls(routeHandler, route.checker, routeDelegate.symbol) : [];
    const parserCalls = routeHandler && jsonParser ? bindingCalls(routeHandler, route.checker, jsonParser.symbol) : [];
    const versionCalls = routeHandler && versionParser ? bindingCalls(routeHandler, route.checker, versionParser.symbol) : [];
    const reasonCalls = routeHandler && reasonSymbol ? bindingCalls(routeHandler, route.checker, reasonSymbol) : [];
    const contextCalls = routeHandler && auditContext ? bindingCalls(routeHandler, route.checker, auditContext.symbol) : [];
    const routeCall = routeCalls.length === 1 ? routeCalls[0] : null;
    const parserParent = parserCalls[0]?.parent;
    const parserDeclaration = parserParent && ts.isAwaitExpression(parserParent) ? parserParent.parent : parserParent;
    const parsedName = parserDeclaration && ts.isVariableDeclaration(parserDeclaration) ? parserDeclaration.name : null;
    const tryBlock = routeHandler?.body?.statements.find((statement) => ts.isTryStatement(statement))?.tryBlock;
    const parseGuard = tryBlock && parsedName && ts.isIdentifier(parsedName) && tryBlock.statements.find((statement) => {
        const condition = ts.isIfStatement(statement) ? unwrap(statement.expression) : null;
        const denied = condition && ts.isPrefixUnaryExpression(condition)
            && condition.operator === ts.SyntaxKind.ExclamationToken && ts.isPropertyAccessExpression(condition.operand)
            && ts.isIdentifier(condition.operand.expression) && condition.operand.expression.text === parsedName.text
            && condition.operand.name.text === 'ok';
        const response = ts.isIfStatement(statement) && ts.isReturnStatement(statement.thenStatement)
            && statement.thenStatement.expression
            ? unwrap(statement.thenStatement.expression) : null;
        const callee = response && ts.isCallExpression(response) ? unwrap(response.expression) : null;
        const responseOptions = response && ts.isCallExpression(response) && response.arguments[1]
            ? unwrap(response.arguments[1]) : null;
        const status = responseOptions && ts.isObjectLiteralExpression(responseOptions)
            ? exactPropertyAssignments(responseOptions, ['status'])?.get('status')?.initializer : null;
        return denied && statement.pos > parserCalls[0].pos && statement.pos < routeCall?.pos
            && callee && ts.isPropertyAccessExpression(callee) && callee.name.text === 'json'
            && ts.isIdentifier(callee.expression) && callee.expression.text === 'NextResponse'
            && status && ts.isNumericLiteral(status) && status.text === '400';
    });
    const reasonFallback = reasonCalls[0]?.arguments[1];
    if (route.sourceFile.parseDiagnostics.length || !routeHandler || !routeDelegate || !jsonParser
        || !versionParser || !auditContext || !reasonSymbol || routeCalls.length !== 1
        || parserCalls.length !== 1 || versionCalls.length !== 1 || reasonCalls.length !== 1
        || contextCalls.length !== 1 || !parsedName || !parseGuard
        || !ts.isStringLiteral(reasonFallback) || reasonFallback.text !== spec.deletionReason
        || !isReachableCall(routeCall, routeHandler)
        || !(parserCalls[0].pos < versionCalls[0].pos && versionCalls[0].pos < reasonCalls[0].pos
            && reasonCalls[0].pos < contextCalls[0].pos && contextCalls[0].pos < routeCall.pos)) {
        problems.push('DELETE route must parse an object, version and approved reason before host audit identity and delegation');
    }
    const inputName = owner.parameters[0]?.name;
    const inputSymbol = inputName && ts.isIdentifier(inputName) ? core.checker.getSymbolAtLocation(inputName) : null;
    const inputPath = (expression, names) => {
        let node = expression && unwrap(expression);
        for (let index = names.length - 1; index >= 0; index -= 1) {
            if (!node || !ts.isPropertyAccessExpression(node) || node.name.text !== names[index]) return false;
            node = unwrap(node.expression);
        }
        return Boolean(node && ts.isIdentifier(node) && inputSymbol
            && resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(node), inputSymbol));
    };
    const plusOne = (expression, field) => {
        const node = expression && unwrap(expression);
        return Boolean(node && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
            && inputPath(node.left, [field]) && ts.isNumericLiteral(node.right) && node.right.text === '1');
    };
    const importedCall = (call, binding) => ts.isIdentifier(unwrap(call.expression))
        && resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(unwrap(call.expression)), binding.symbol);
    const transactionCalls = calls(owner.body, (call) => {
        const callee = unwrap(call.expression);
        return ts.isPropertyAccessExpression(callee) && callee.name.text === 'transaction'
            && ts.isIdentifier(callee.expression)
            && resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(callee.expression), db.symbol);
    });
    const transaction = transactionCalls.length === 1 ? transactionCalls[0] : null;
    const callback = transaction?.arguments[0] && unwrap(transaction.arguments[0]);
    const txName = callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body)
        && callback.parameters.length === 1 && ts.isIdentifier(callback.parameters[0].name)
        ? callback.parameters[0].name.text : null;
    const options = transaction?.arguments[1] && unwrap(transaction.arguments[1]);
    const behavior = options && ts.isObjectLiteralExpression(options)
        ? exactPropertyAssignments(options, ['behavior'])?.get('behavior')?.initializer : null;
    if (!transaction || transaction.arguments.length !== 2 || !ts.isReturnStatement(transaction.parent)
        || transaction.parent.parent !== owner.body || !isReachableCall(transaction, owner)
        || !txName || localBindingExists(callback, txName, true)
        || !behavior || !ts.isStringLiteral(behavior) || behavior.text !== 'immediate') {
        problems.push('delete core must return one immediate transaction with an unshadowed tx');
        return problems;
    }
    const sameTx = (expression) => ts.isIdentifier(unwrap(expression)) && unwrap(expression).text === txName;
    const writerCalls = bindingCalls(owner, core.checker, writer.symbol);
    const audit = writerCalls.length === 1 ? writerCalls[0] : null;
    const auditStatement = audit && directStatement(callback, audit);
    if (!audit || audit.arguments.length !== 2 || !sameTx(audit.arguments[0])
        || !isReachableStandaloneCall(audit, callback)
        || !auditStatement || !ts.isExpressionStatement(auditStatement)) {
        problems.push('delete core must call exactly one required audit writer directly inside the same tx');
        return problems;
    }
    const auditInput = unwrap(audit.arguments[1]);
    const props = ts.isObjectLiteralExpression(auditInput)
        ? exactPropertyAssignments(auditInput, ['eventType', 'outcome', 'actorType', 'actorRef',
            'subjectType', 'subjectRef', 'sourceSurface', 'requestId', 'redactedMetadata']) : null;
    const event = props?.get('eventType')?.initializer;
    const outcome = props?.get('outcome')?.initializer;
    const subject = props?.get('subjectType')?.initializer;
    const subjectRef = props?.get('subjectRef')?.initializer;
    const metadata = props?.get('redactedMetadata')?.initializer;
    const metadataProps = metadata && ts.isObjectLiteralExpression(metadata)
        ? exactPropertyAssignments(metadata, ['resourceVersion', 'reasonCode', 'flags']) : null;
    if (!event || !ts.isStringLiteral(event) || event.text !== 'patient.deleted'
        || !outcome || !ts.isStringLiteral(outcome) || outcome.text !== 'success'
        || !subject || !ts.isStringLiteral(subject) || subject.text !== 'patient'
        || !inputPath(subjectRef, ['patientId'])
        || !metadataProps || !plusOne(metadataProps.get('resourceVersion')?.initializer, 'expectedVersion')) {
        problems.push('delete audit must bind patient.deleted, success, the patient subject and next resource version');
    }
    const builderCalls = bindingCalls(owner, core.checker, tombstone.symbol);
    const builder = builderCalls.length === 1 ? builderCalls[0] : null;
    const setCall = builder?.parent;
    const setCallee = setCall && ts.isCallExpression(setCall) ? unwrap(setCall.expression) : null;
    const updateCall = setCallee && ts.isPropertyAccessExpression(setCallee) && setCallee.name.text === 'set'
        ? unwrap(setCallee.expression) : null;
    const updateCallee = updateCall && ts.isCallExpression(updateCall) ? unwrap(updateCall.expression) : null;
    const table = updateCall && ts.isCallExpression(updateCall) ? updateCall.arguments[0] : null;
    const whereProperty = setCall?.parent;
    const whereCall = whereProperty && ts.isPropertyAccessExpression(whereProperty)
        && whereProperty.name.text === 'where' && ts.isCallExpression(whereProperty.parent) ? whereProperty.parent : null;
    const runProperty = whereCall?.parent;
    const runCall = runProperty && ts.isPropertyAccessExpression(runProperty)
        && runProperty.name.text === 'run' && ts.isCallExpression(runProperty.parent) ? runProperty.parent : null;
    const updateStatement = runCall && directStatement(callback, runCall);
    const updateResult = updateStatement && ts.isVariableStatement(updateStatement)
        && updateStatement.declarationList.declarations.length === 1
        ? updateStatement.declarationList.declarations[0] : null;
    const boundCall = (expression, binding, arity) => {
        const call = expression && unwrap(expression);
        return call && ts.isCallExpression(call) && call.arguments.length === arity && importedCall(call, binding)
            ? call : null;
    };
    const column = (expression, name) => {
        const node = expression && unwrap(expression);
        return Boolean(node && ts.isPropertyAccessExpression(node) && node.name.text === name
            && ts.isIdentifier(node.expression)
            && resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(node.expression), patients.symbol));
    };
    const predicate = whereCall?.arguments.length === 1 ? boundCall(whereCall.arguments[0], andBinding, 3) : null;
    const idEq = predicate && boundCall(predicate.arguments[0], eqBinding, 2);
    const versionEq = predicate && boundCall(predicate.arguments[1], eqBinding, 2);
    const activeWhere = predicate && boundCall(predicate.arguments[2], active, 0);
    if (!builder || builder.arguments.length !== 2
        || !inputPath(builder.arguments[0], ['expectedVersion']) || !inputPath(builder.arguments[1], ['deletionReason'])
        || !updateCallee || !ts.isPropertyAccessExpression(updateCallee) || updateCallee.name.text !== 'update'
        || !ts.isIdentifier(updateCallee.expression) || updateCallee.expression.text !== txName
        || !table || !ts.isIdentifier(table)
        || !resolvesToBinding(core.checker, core.checker.getSymbolAtLocation(table), patients.symbol)
        || !whereCall || !runCall || !updateResult || updateResult.initializer !== runCall
        || !isReachableCall(runCall, callback) || runCall.pos >= audit.pos
        || !idEq || !column(idEq.arguments[0], 'id') || !inputPath(idEq.arguments[1], ['patientId'])
        || !versionEq || !column(versionEq.arguments[0], 'version')
        || !inputPath(versionEq.arguments[1], ['expectedVersion']) || !activeWhere) {
        problems.push('delete must run a version-and-active guarded tombstone update on the same tx before audit');
    }
    const resultName = updateResult?.name;
    const casGuards = resultName && ts.isIdentifier(resultName) ? callback.body.statements.filter((statement) => {
        if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
        const condition = unwrap(statement.expression);
        return ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
            && ts.isPropertyAccessExpression(condition.left) && condition.left.name.text === 'changes'
            && ts.isIdentifier(condition.left.expression) && condition.left.expression.text === resultName.text
            && ts.isNumericLiteral(condition.right) && condition.right.text === '0';
    }) : [];
    const cas = casGuards?.length === 1 ? casGuards[0] : null;
    const conflicts = cas && bindingCalls(cas.thenStatement, core.checker, conflict.symbol);
    const conflictReturn = cas && calls(cas.thenStatement, (call) => importedCall(call, conflict))
        .some((call) => call.arguments.length >= 2 && inputPath(call.arguments[0], ['expectedVersion'])
            && inputPath(call.arguments[1], ['patientId']) && isReachableCall(call, cas.thenStatement));
    const status409 = cas && ts.isBlock(cas.thenStatement) && cas.thenStatement.statements.find((statement) => {
        if (!ts.isReturnStatement(statement) || !statement.expression) return false;
        const value = unwrap(statement.expression);
        const returnProps = ts.isObjectLiteralExpression(value) ? exactPropertyAssignments(value, ['status', 'value']) : null;
        const status = returnProps?.get('status')?.initializer;
        return status && ts.isNumericLiteral(status) && status.text === '409';
    });
    const casReturns = [];
    if (cas) {
        const visit = (node) => {
            if (ts.isReturnStatement(node)) casReturns.push(node);
            ts.forEachChild(node, visit);
        };
        visit(cas.thenStatement);
    }
    const updateIndex = callback.body.statements.indexOf(updateStatement);
    const auditIndex = callback.body.statements.indexOf(auditStatement);
    const onlyCasBeforeAudit = updateIndex >= 0 && auditIndex === updateIndex + 2
        && callback.body.statements[updateIndex + 1] === cas;
    const preAuditReturns = [];
    if (auditIndex >= 0) {
        const visit = (node) => {
            if (ts.isReturnStatement(node)) preAuditReturns.push(node);
            ts.forEachChild(node, visit);
        };
        callback.body.statements.slice(0, auditIndex).forEach(visit);
    }
    const notFound = updateIndex > 0 && callback.body.statements.slice(0, updateIndex)
        .filter((statement) => ts.isIfStatement(statement) && !statement.elseStatement
            && ts.isReturnStatement(statement.thenStatement))
        .map((statement) => statement.thenStatement)
        .find((statement) => {
            const value = statement.expression && unwrap(statement.expression);
            const props = value && ts.isObjectLiteralExpression(value)
                ? exactPropertyAssignments(value, ['status', 'value']) : null;
            const status = props?.get('status')?.initializer;
            return status && ts.isNumericLiteral(status) && status.text === '404';
        });
    if (!cas || cas.pos <= (runCall?.pos ?? Infinity) || cas.pos >= audit.pos
        || conflicts?.length !== 1 || !conflictReturn || !status409
        || casReturns.length !== 1 || casReturns[0] !== status409 || !onlyCasBeforeAudit
        || preAuditReturns.length !== 2 || !preAuditReturns.includes(notFound)
        || !preAuditReturns.includes(status409)) {
        problems.push('delete CAS miss must return the version conflict before audit');
    }
    const success = callback.body.statements.find((statement) => ts.isReturnStatement(statement)
        && statement.pos > auditStatement.pos && statement.expression
        && ts.isObjectLiteralExpression(unwrap(statement.expression))
        && exactPropertyAssignments(unwrap(statement.expression), ['status', 'value'])?.get('status')?.initializer?.getText(core.sourceFile) === '200');
    if (!success) problems.push('delete success must return after the required audit');
    const auditFile = checkedSource('lib/security/audit.ts', auditSource);
    const requiredWriter = namedFunction(auditFile.sourceFile, 'writeAuditEventInTransaction', true);
    const auditTable = importedBinding(auditFile.sourceFile, auditFile.checker, '../schema', 'auditEvents');
    const writerTx = requiredWriter?.parameters[0]?.name;
    const inserts = requiredWriter && auditTable && writerTx && ts.isIdentifier(writerTx)
        ? calls(requiredWriter.body, (call) => {
            const run = unwrap(call.expression);
            if (!ts.isPropertyAccessExpression(run) || run.name.text !== 'run') return false;
            const valuesCall = unwrap(run.expression);
            const values = ts.isCallExpression(valuesCall) ? unwrap(valuesCall.expression) : null;
            const insertCall = values && ts.isPropertyAccessExpression(values) && values.name.text === 'values'
                ? unwrap(values.expression) : null;
            const insert = insertCall && ts.isCallExpression(insertCall) ? unwrap(insertCall.expression) : null;
            const table = insertCall && ts.isCallExpression(insertCall) ? insertCall.arguments[0] : null;
            return ts.isCallExpression(valuesCall) && valuesCall.arguments.length === 1
                && ts.isIdentifier(unwrap(valuesCall.arguments[0])) && unwrap(valuesCall.arguments[0]).text === 'row'
                && insertCall && ts.isCallExpression(insertCall) && insertCall.arguments.length === 1
                && insert && ts.isPropertyAccessExpression(insert) && insert.name.text === 'insert'
                && ts.isIdentifier(insert.expression) && insert.expression.text === writerTx.text
                && table && ts.isIdentifier(table)
                && resolvesToBinding(auditFile.checker, auditFile.checker.getSymbolAtLocation(table), auditTable.symbol);
        }) : [];
    const insertStatement = inserts.length === 1 && directStatement(requiredWriter, inserts[0]);
    const insertResult = insertStatement && ts.isVariableStatement(insertStatement)
        && insertStatement.declarationList.declarations.length === 1
        ? insertStatement.declarationList.declarations[0] : null;
    const insertResultName = insertResult?.name;
    const insertIndex = requiredWriter?.body?.statements.indexOf(insertStatement) ?? -1;
    const insertGuard = insertIndex >= 0 ? requiredWriter.body.statements[insertIndex + 1] : null;
    const insertCondition = insertGuard && ts.isIfStatement(insertGuard) ? unwrap(insertGuard.expression) : null;
    const checkedInsert = insertResult?.initializer === inserts[0] && insertResultName && ts.isIdentifier(insertResultName)
        && insertCondition && ts.isBinaryExpression(insertCondition)
        && insertCondition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
        && ts.isPropertyAccessExpression(insertCondition.left) && insertCondition.left.name.text === 'changes'
        && ts.isIdentifier(insertCondition.left.expression) && insertCondition.left.expression.text === insertResultName.text
        && ts.isNumericLiteral(insertCondition.right) && insertCondition.right.text === '1'
        && !insertGuard.elseStatement && ts.isBlock(insertGuard.thenStatement)
        && insertGuard.thenStatement.statements.length === 1
        && ts.isThrowStatement(insertGuard.thenStatement.statements[0]);
    if (auditFile.sourceFile.parseDiagnostics.length || !requiredWriter || !auditTable
        || inserts.length !== 1 || !isReachableCall(inserts[0], requiredWriter) || !checkedInsert) {
        problems.push('required audit primitive must check the exact insert result');
    }
    return problems;
}

function anyNamedImport(sourceFile, exportName) {
    return sourceFile.statements.some((statement) => ts.isImportDeclaration(statement)
        && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
        && statement.importClause.namedBindings.elements.some((element) =>
            !element.isTypeOnly && (element.propertyName?.text ?? element.name.text) === exportName));
}

function exactDirectObjectCalls(owner, objectName, allowedNames) {
    const calls = new Map(allowedNames.map((name) => [name, []]));
    let exact = true;
    const visit = (node) => {
        if (ts.isIdentifier(node) && node.text === objectName) {
            const property = node.parent;
            const call = property && ts.isPropertyAccessExpression(property)
                && property.expression === node && !property.questionDotToken
                && allowedNames.includes(property.name.text)
                && property.parent && ts.isCallExpression(property.parent)
                && unwrap(property.parent.expression) === property ? property.parent : null;
            if (!call) exact = false;
            else calls.get(property.name.text).push(call);
        }
        ts.forEachChild(node, visit);
    };
    if (owner.body) visit(owner.body);
    return { calls, exact };
}

function isAwaited(call) {
    let current = call;
    while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
    return ts.isAwaitExpression(current.parent);
}

function objectLiteral(initializer) {
    const value = initializer && unwrap(initializer);
    if (value && ts.isObjectLiteralExpression(value)) return value;
    return value && ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)
        && ts.isIdentifier(value.expression.expression) && value.expression.expression.text === 'Object'
        && value.expression.name.text === 'freeze' && value.arguments.length === 1
        && ts.isObjectLiteralExpression(unwrap(value.arguments[0])) ? unwrap(value.arguments[0]) : null;
}

function exactFrozenObjectLiteral(initializer, sourceFile) {
    const value = initializer && unwrap(initializer);
    if (!value || !ts.isCallExpression(value) || value.questionDotToken
        || value.typeArguments?.length || value.arguments.length !== 1
        || !ts.isPropertyAccessExpression(value.expression) || value.expression.questionDotToken
        || !ts.isIdentifier(value.expression.expression) || value.expression.expression.text !== 'Object'
        || value.expression.name.text !== 'freeze' || moduleScopeBindingExists(sourceFile, 'Object')) return null;
    const literal = unwrap(value.arguments[0]);
    return ts.isObjectLiteralExpression(literal) ? literal : null;
}

function hasDeferredWork(root) {
    let found = false;
    const visit = (node) => {
        if (found) return;
        if (ts.isIdentifier(node) && ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask'].includes(node.text)) found = true;
        if (ts.isPropertyAccessExpression(node) && ['then', 'catch', 'finally'].includes(node.name.text)) found = true;
        if ((ts.isCallExpression(node) || ts.isNewExpression(node))) {
            const callee = unwrap(node.expression);
            if ((ts.isIdentifier(callee) && ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'Promise'].includes(callee.text))
                || (ts.isPropertyAccessExpression(callee) && ['then', 'catch', 'finally'].includes(callee.name.text))) found = true;
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
}

function directStatement(owner, node) {
    let current = node;
    while (current.parent && current.parent !== owner.body) current = current.parent;
    return current.parent === owner.body && ts.isStatement(current) ? current : null;
}

function isUnconditionalOwnerCall(owner, call) {
    let child = call;
    for (let parent = child.parent; parent && parent !== owner; child = parent, parent = parent.parent) {
        if (ts.isFunctionLike(parent) || ts.isIfStatement(parent) || ts.isConditionalExpression(parent)
            || ts.isIterationStatement(parent, false) || ts.isSwitchStatement(parent)) return false;
        if (ts.isBinaryExpression(parent) && parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
        if (!ts.isExpressionStatement(parent)) continue;
        if (parent.parent === owner.body) return true;
        return Boolean(ts.isBlock(parent.parent) && parent.parent.parent && ts.isTryStatement(parent.parent.parent)
            && parent.parent.parent.tryBlock === parent.parent && parent.parent.parent.parent === owner.body);
    }
    return false;
}

const EXACT_LOGOUT_RECORD_VALIDATOR_BODY = `{ if (!value || typeof value !== 'object' || isProxy(value)) return null; try { if (ObjectGetPrototypeOf(value) !== prototype || (frozen && !ObjectIsFrozen(value)) || ObjectGetOwnPropertySymbols(value).length !== 0) return null; const names = ObjectGetOwnPropertyNames(value); if (names.length !== keys.length) return null; for (const key of keys) { if (!names.includes(key)) return null; const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null; if (frozen && (descriptor.configurable || descriptor.writable)) return null; } return value as ExactRecord; } catch { return null; } }`;
const EXACT_LOGOUT_COOKIE_VALIDATOR_BODY = `{ const plain = exactRecord(value, ['name', 'value'], Object.prototype, false); const framework = plain ? null : exactRecord(value, ['name', 'value', 'path'], Object.prototype, false); const record = plain ?? (framework?.path === '/' ? framework : null); return record?.name === name && typeof record.value === 'string' && pattern.test(record.value) ? record.value : null; }`;
const EXACT_LOGOUT_PROJECTION_VALIDATOR_BODY = `{ const resolution = exactRecord(value, ['status', 'projection'], null, true); if (!resolution || resolution.status !== 'active') return null; const projection = exactRecord(resolution.projection, SESSION_KEYS, null, true); if (!projection || projection.id !== sessionId || projection.authChannel !== 'web' || typeof projection.userId !== 'string' || !projection.userId || typeof projection.username !== 'string' || !projection.username || typeof projection.role !== 'string' || !projection.role || typeof projection.createdAt !== 'number' || !Number.isSafeInteger(projection.createdAt) || typeof projection.expiresAt !== 'number' || !Number.isSafeInteger(projection.expiresAt) || projection.expiresAt <= DateNow()) return null; return resolution.projection as WebSessionProjection; }`;
const EXACT_LOGOUT_RECEIPT_VALIDATOR_BODY = `{ const oneField = exactRecord(value, ['outcome'], null, true); const twoFields = oneField ? null : exactRecord(value, ['outcome', 'etag'], null, true); const record = oneField ?? twoFields; if (!record || (record.outcome !== 'completed' && record.outcome !== 'denied' && record.outcome !== 'failed')) return null; if (!twoFields) return { outcome: record.outcome, etag: null }; const etag = strongWebAuthControlEtag(twoFields.etag); return etag ? { outcome: record.outcome, etag } : null; }`;

function exactModuleConstProperty(sourceFile, checker, name, object, property, objectSymbol = null) {
    const matches = sourceFile.statements.flatMap((statement) => ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations].filter((declaration) =>
            ts.isIdentifier(declaration.name) && declaration.name.text === name) : []);
    const declaration = matches.length === 1 ? matches[0] : null;
    const initializer = declaration?.initializer && unwrap(declaration.initializer);
    return Boolean(declaration && ts.isVariableDeclarationList(declaration.parent)
        && (declaration.parent.flags & ts.NodeFlags.Const)
        && initializer && ts.isPropertyAccessExpression(initializer) && !initializer.questionDotToken
        && ts.isIdentifier(initializer.expression) && initializer.expression.text === object
        && (!objectSymbol || checker.getSymbolAtLocation(initializer.expression) === objectSymbol)
        && initializer.name.text === property);
}

function hasExactLogoutValidationPrimitives(sourceFile, checker) {
    const exactRecord = namedFunction(sourceFile, 'exactRecord');
    const exactObjectCaptures = [
        ['ObjectGetPrototypeOf', 'getPrototypeOf'],
        ['ObjectGetOwnPropertyDescriptor', 'getOwnPropertyDescriptor'],
        ['ObjectGetOwnPropertyNames', 'getOwnPropertyNames'],
        ['ObjectGetOwnPropertySymbols', 'getOwnPropertySymbols'],
        ['ObjectIsFrozen', 'isFrozen'],
    ].every(([binding, property]) => exactModuleConstProperty(sourceFile, checker, binding, 'Object', property));
    const typesBinding = importedBinding(sourceFile, checker, 'node:util', 'types');
    return Boolean(exactRecord && exactObjectCaptures && !moduleScopeBindingExists(sourceFile, 'Object')
        && importedName(sourceFile, 'node:util', 'types') === 'types' && typesBinding
        && exactModuleConstProperty(sourceFile, checker, 'isProxy', 'types', 'isProxy', typesBinding.symbol)
        && exactRecord.parameters.map((parameter) => parameter.name.getText(sourceFile)).join(',') === 'value,keys,prototype,frozen'
        && exactRecord.body?.getText(sourceFile).replace(/\s+/gu, ' ') === EXACT_LOGOUT_RECORD_VALIDATOR_BODY);
}

function exactLogoutValidator(sourceFile, name, parameters, body) {
    const validator = namedFunction(sourceFile, name);
    return validator
        && validator.parameters.map((parameter) => parameter.name.getText(sourceFile)).join(',') === parameters
        && validator.body?.getText(sourceFile).replace(/\s+/gu, ' ') === body
        ? validator : null;
}

function exactPropertyAssignments(literal, allowedNames) {
    if (!literal || literal.properties.some((item) => !ts.isPropertyAssignment(item)
        || ts.isComputedPropertyName(item.name)
        || !(ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)))) return null;
    const names = literal.properties.map((item) => item.name.text);
    if (new Set(names).size !== names.length || names.some((name) => !allowedNames.includes(name))) return null;
    return new Map(literal.properties.map((item) => [item.name.text, item]));
}

function exactArguments(call, expected) {
    return call.arguments.length === expected.length && expected.every((item, index) => {
        const value = unwrap(call.arguments[index]);
        return 'identifier' in item ? ts.isIdentifier(value) && value.text === item.identifier
            : ts.isStringLiteral(value) && value.text === item.literal
            || item.null && value.kind === ts.SyntaxKind.NullKeyword;
    });
}

function isNullOrUndefined(expression) {
    const value = unwrap(expression);
    return value.kind === ts.SyntaxKind.NullKeyword || ts.isIdentifier(value) && value.text === 'undefined';
}

function exactNamedImport(statement, moduleName, exportName) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== moduleName || !statement.importClause
        || statement.importClause.isTypeOnly || statement.importClause.name
        || !statement.importClause.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) return false;
    const [element] = statement.importClause.namedBindings.elements;
    return statement.importClause.namedBindings.elements.length === 1 && !element.isTypeOnly
        && (element.propertyName?.text ?? element.name.text) === exportName && element.name.text === exportName;
}

function exactIdentifierBinding(checker, node, binding) {
    return Boolean(node && binding && ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === binding);
}

function bindingIsWritten(root, checker, binding) {
    let found = false;
    const containsBinding = (node) => exactIdentifierBinding(checker, node, binding)
        || ts.isShorthandPropertyAssignment(node) && checker.getShorthandAssignmentValueSymbol(node) === binding
        || node.getChildren().some(containsBinding);
    const visit = (node) => {
        const assignment = ts.isBinaryExpression(node)
            && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
            && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && containsBinding(node.left);
        const update = (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
            && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
            && containsBinding(node.operand);
        const iteration = (ts.isForInStatement(node) || ts.isForOfStatement(node))
            && containsBinding(node.initializer);
        if (assignment || update || iteration) found = true;
        else if (!found) ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
}

function exactCookieLookup(expression, checker, cookieStore, sessionCookieName) {
    const value = unwrap(expression);
    return ts.isCallExpression(value) && !value.questionDotToken && ts.isPropertyAccessExpression(value.expression)
        && !value.expression.questionDotToken
        && exactIdentifierBinding(checker, value.expression.expression, cookieStore)
        && value.expression.name.text === 'get' && value.arguments.length === 1
        && exactIdentifierBinding(checker, unwrap(value.arguments[0]), sessionCookieName);
}

function validateExactServiceOwnedLogoutRoute(sourceFile, checker, spec) {
    const delegated = spec.modes.delegated;
    const lifecycleModule = '@/lib/security/portable-supervisor-web-lifecycle';
    const lifecycleExport = 'completePortableSupervisorWebLifecycleMutationV1';
    const [cookiesImport, serviceImport, lifecycleImport, sessionConstant, controlConstant, handler] = sourceFile.statements;
    const problems = [];
    const cookiesBinding = importedBinding(sourceFile, checker, 'next/headers', 'cookies')?.symbol;
    const serviceBinding = importedBinding(
        sourceFile, checker, delegated.serviceModule, delegated.serviceExport,
    )?.symbol;
    const lifecycleBinding = importedBinding(sourceFile, checker, lifecycleModule, lifecycleExport)?.symbol;
    const exactStringConstant = (statement, name, value) => {
        if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)
            || statement.declarationList.declarations.length !== 1) return null;
        const [declaration] = statement.declarationList.declarations;
        return ts.isIdentifier(declaration.name) && declaration.name.text === name
            && declaration.initializer && ts.isStringLiteral(declaration.initializer) && declaration.initializer.text === value
            ? checker.getSymbolAtLocation(declaration.name) : null;
    };
    const sessionCookieBinding = exactStringConstant(sessionConstant, 'SESSION_COOKIE_NAME', 'mediflow_session');
    const controlCookieBinding = exactStringConstant(controlConstant, 'CONTROL_COOKIE_NAME', 'mediflow_auth_control');
    if (sourceFile.statements.length !== 6
        || !exactNamedImport(cookiesImport, 'next/headers', 'cookies')
        || !exactNamedImport(serviceImport, delegated.serviceModule, delegated.serviceExport)
        || !exactNamedImport(lifecycleImport, lifecycleModule, lifecycleExport)
        || !sessionCookieBinding || !controlCookieBinding
        || !handler || !ts.isFunctionDeclaration(handler) || !handler.name || handler.name.text !== delegated.handler
        || !ts.getModifiers(handler)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        problems.push('logout route must expose only cookies, the terminal service, both fixed cookie names, and POST');
        return problems;
    }
    const [request] = handler.parameters;
    const statements = handler.body ? [...handler.body.statements] : [];
    const exactInertCookie = (statement, name) => {
        if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Let)
            || statement.declarationList.declarations.length !== 1) return null;
        const [declaration] = statement.declarationList.declarations;
        return ts.isIdentifier(declaration.name) && declaration.name.text === name
            && declaration.initializer && isNullOrUndefined(declaration.initializer)
            ? { name, symbol: checker.getSymbolAtLocation(declaration.name) } : null;
    };
    const bearer = exactInertCookie(statements[0], 'bearerCookie');
    const control = exactInertCookie(statements[1], 'controlCookie');
    const acquisition = statements[2] && ts.isTryStatement(statements[2]) ? statements[2] : null;
    const acquisitionStatements = acquisition?.tryBlock ? [...acquisition.tryBlock.statements] : [];
    const cookieStoreDeclaration = acquisitionStatements[0] && ts.isVariableStatement(acquisitionStatements[0])
        ? acquisitionStatements[0] : null;
    const [cookieStore] = cookieStoreDeclaration?.declarationList.declarations ?? [];
    const cookieStoreBinding = cookieStore && ts.isIdentifier(cookieStore.name) ? cookieStore.name.text : null;
    const cookieStoreSymbol = cookieStore && ts.isIdentifier(cookieStore.name)
        ? checker.getSymbolAtLocation(cookieStore.name) : null;
    const cookieStoreInitializer = cookieStore?.initializer && unwrap(cookieStore.initializer);
    const cookiesCall = cookieStoreInitializer && ts.isAwaitExpression(cookieStoreInitializer)
        ? unwrap(cookieStoreInitializer.expression) : null;
    const bearerRead = acquisitionStatements[1] && ts.isExpressionStatement(acquisitionStatements[1])
        ? unwrap(acquisitionStatements[1].expression) : null;
    const controlRead = acquisitionStatements[2] && ts.isExpressionStatement(acquisitionStatements[2])
        ? unwrap(acquisitionStatements[2].expression) : null;
    const returnStatement = statements[3] && ts.isReturnStatement(statements[3]) ? statements[3] : null;
    const lifecycleCall = returnStatement?.expression && unwrap(returnStatement.expression);
    const delegateCall = lifecycleCall && ts.isCallExpression(lifecycleCall)
        ? unwrap(lifecycleCall.arguments[0]) : null;
    const lifecycleReason = lifecycleCall && ts.isCallExpression(lifecycleCall)
        ? unwrap(lifecycleCall.arguments[1]) : null;
    const exactDelegate = Boolean(lifecycleCall && ts.isCallExpression(lifecycleCall)
        && !lifecycleCall.questionDotToken && exactIdentifierBinding(checker, lifecycleCall.expression, lifecycleBinding)
        && lifecycleCall.arguments.length === 2 && ts.isStringLiteral(lifecycleReason) && lifecycleReason.text === 'logout'
        && delegateCall && ts.isCallExpression(delegateCall) && !delegateCall.questionDotToken
        && exactIdentifierBinding(checker, delegateCall.expression, serviceBinding)
        && exactArguments(delegateCall, [
            { identifier: bearer?.name ?? '' }, { identifier: control?.name ?? '' },
            { identifier: request?.name && ts.isIdentifier(request.name) ? request.name.text : '' },
        ]));
    const exactRead = (read, target, cookieName) => Boolean(read && ts.isBinaryExpression(read)
        && read.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && exactIdentifierBinding(checker, read.left, target?.symbol)
        && exactCookieLookup(read.right, checker, cookieStoreSymbol, cookieName));
    if (handler.parameters.length !== 1 || !request || !ts.isIdentifier(request.name) || request.name.text !== 'request'
        || statements.length !== 4 || !bearer || !control
        || !acquisition || acquisition.finallyBlock || !acquisition.catchClause || acquisition.catchClause.variableDeclaration
        || acquisition.catchClause.block.statements.length !== 0 || acquisitionStatements.length !== 3
        || !cookieStoreBinding || !cookieStoreDeclaration || !(cookieStoreDeclaration.declarationList.flags & ts.NodeFlags.Const)
        || cookieStoreDeclaration.declarationList.declarations.length !== 1
        || !cookiesCall || !ts.isCallExpression(cookiesCall) || cookiesCall.questionDotToken || !ts.isIdentifier(cookiesCall.expression)
        || !exactIdentifierBinding(checker, cookiesCall.expression, cookiesBinding)
        || cookiesCall.arguments.length !== 0
        || !exactRead(bearerRead, bearer, sessionCookieBinding)
        || !exactRead(controlRead, control, controlCookieBinding) || !exactDelegate) {
        problems.push('POST must read both fixed cookies inertly and directly return the exact service-owned response');
    }
    return problems;
}

function moduleScopeBindingExists(sourceFile, name) {
    return sourceFile.statements.some((statement) => {
        if (ts.isImportDeclaration(statement) && statement.importClause) {
            if (statement.importClause.name?.text === name) return true;
            const bindings = statement.importClause.namedBindings;
            if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) return true;
            return bindings && ts.isNamedImports(bindings) && bindings.elements.some((element) => element.name.text === name);
        }
        if (ts.isImportEqualsDeclaration(statement)) return statement.name.text === name;
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)
            || ts.isModuleDeclaration(statement)) && statement.name?.getText(sourceFile) === name) return true;
        return ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
            bindingNameContains(declaration.name, name));
    });
}

function hasPriorUnconditionalTermination(owner, node) {
    const statement = directStatement(owner, node);
    if (!statement || !owner.body) return true;
    const index = owner.body.statements.indexOf(statement);
    return index < 0 || owner.body.statements.slice(0, index).some(alwaysTerminates);
}

function exactNoStoreResponseFactory(sourceFile) {
    const factory = namedFunction(sourceFile, 'empty');
    const [statusParameter, etagParameter] = factory?.parameters ?? [];
    const status = statusParameter && ts.isIdentifier(statusParameter.name) ? statusParameter.name.text : null;
    const etag = etagParameter && ts.isIdentifier(etagParameter.name) ? etagParameter.name.text : null;
    const [headersStatement, etagStatement, returnStatement] = factory?.body?.statements ?? [];
    const headersDeclaration = ts.isVariableStatement(headersStatement)
        && Boolean(headersStatement.declarationList.flags & ts.NodeFlags.Const)
        && headersStatement.declarationList.declarations.length === 1
        ? headersStatement.declarationList.declarations[0] : null;
    const headersName = headersDeclaration && ts.isIdentifier(headersDeclaration.name)
        ? headersDeclaration.name.text : null;
    const headersInitializer = headersDeclaration?.initializer && unwrap(headersDeclaration.initializer);
    const headerOptions = headersInitializer && ts.isNewExpression(headersInitializer)
        && ts.isIdentifier(headersInitializer.expression) && headersInitializer.expression.text === 'Headers'
        && headersInitializer.arguments?.length === 1 ? objectLiteral(headersInitializer.arguments[0]) : null;
    const headerProperties = exactPropertyAssignments(headerOptions, ['Cache-Control']);
    const cacheControl = headerProperties?.get('Cache-Control')?.initializer
        && unwrap(headerProperties.get('Cache-Control').initializer);
    const etagIf = etagStatement && ts.isIfStatement(etagStatement) ? etagStatement : null;
    const setStatement = etagIf && ts.isExpressionStatement(etagIf.thenStatement)
        ? etagIf.thenStatement : etagIf && ts.isBlock(etagIf.thenStatement)
            && etagIf.thenStatement.statements.length === 1 && ts.isExpressionStatement(etagIf.thenStatement.statements[0])
            ? etagIf.thenStatement.statements[0] : null;
    const setCall = setStatement && ts.isCallExpression(unwrap(setStatement.expression))
        ? unwrap(setStatement.expression) : null;
    const response = returnStatement && ts.isReturnStatement(returnStatement)
        && returnStatement.expression && unwrap(returnStatement.expression);
    if (factory?.parameters.length !== 2 || status !== 'status' || etag !== 'etag'
        || !etagParameter.initializer || unwrap(etagParameter.initializer).kind !== ts.SyntaxKind.NullKeyword
        || factory?.body?.statements.length !== 3 || moduleScopeBindingExists(sourceFile, 'Response')
        || moduleScopeBindingExists(sourceFile, 'Headers') || !headersName || !headerOptions
        || !etagIf || etagIf.elseStatement || !ts.isIdentifier(unwrap(etagIf.expression))
        || unwrap(etagIf.expression).text !== etag || !setCall || setCall.questionDotToken
        || !ts.isPropertyAccessExpression(setCall.expression) || setCall.expression.questionDotToken
        || !ts.isIdentifier(setCall.expression.expression) || setCall.expression.expression.text !== headersName
        || setCall.expression.name.text !== 'set' || !exactArguments(setCall, [{ literal: 'ETag' }, { identifier: etag }])
        || !response || !ts.isNewExpression(response) || !ts.isIdentifier(response.expression)
        || response.expression.text !== 'Response' || response.arguments?.length !== 2
        || unwrap(response.arguments[0]).kind !== ts.SyntaxKind.NullKeyword) return false;
    const options = objectLiteral(response.arguments[1]);
    const statusProperty = options?.properties.find((property) => ts.isShorthandPropertyAssignment(property)
        && property.name.text === 'status');
    const headersProperty = options?.properties.find((property) => ts.isShorthandPropertyAssignment(property)
        && property.name.text === headersName);
    let responseConstructors = 0; let headersConstructors = 0;
    const visit = (node) => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Response') responseConstructors += 1;
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Headers') headersConstructors += 1;
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return Boolean(options && options.properties.length === 2 && statusProperty && headersProperty && cacheControl)
        && statusProperty.name.text === status && ts.isStringLiteral(cacheControl) && cacheControl.text === 'no-store'
        && responseConstructors === 1 && headersConstructors === 1;
}

function exactEmptyStatusReturn(statement) {
    const expression = statement.expression && unwrap(statement.expression);
    return Boolean(expression && ts.isCallExpression(expression) && !expression.questionDotToken
        && ts.isIdentifier(expression.expression) && expression.expression.text === 'empty'
        && [1, 2].includes(expression.arguments.length) && ts.isNumericLiteral(unwrap(expression.arguments[0]))
        && [204, 401, 409].includes(Number(unwrap(expression.arguments[0]).text))
        && (expression.arguments.length === 1 || (() => {
            const etag = unwrap(expression.arguments[1]);
            return ts.isPropertyAccessExpression(etag) && !etag.questionDotToken
                && ts.isIdentifier(etag.expression) && etag.expression.text === 'receipt' && etag.name.text === 'etag';
        })()));
}

function directAwaitedExpressionStatement(owner, call) {
    let current = call;
    while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
    if (!ts.isAwaitExpression(current.parent)) return null;
    current = current.parent;
    while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
    return ts.isExpressionStatement(current.parent) && directStatement(owner, current.parent) === current.parent
        ? current.parent : null;
}

function directReturnStatements(owner) {
    const returns = [];
    const visit = (node) => {
        if (node !== owner && ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node)) returns.push(node);
        ts.forEachChild(node, visit);
    };
    if (owner.body) visit(owner.body);
    return returns;
}

function auditLiteralSyntaxIsExactAndSafe(root) {
    let safe = true;
    const forbidden = /^(?:authorization|bearer|cookie|token|raw)$/iu;
    const visit = (node) => {
        if (!safe) return;
        if (ts.isObjectLiteralExpression(node)) {
            const names = [];
            for (const property of node.properties) {
                if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)
                    || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
                    safe = false;
                    return;
                }
                names.push(property.name.text);
                if (forbidden.test(property.name.text)) {
                    safe = false;
                    return;
                }
            }
            if (new Set(names).size !== names.length) {
                safe = false;
                return;
            }
        } else if (ts.isArrayLiteralExpression(node)
            && node.elements.some((item) => ts.isSpreadElement(item))) {
            safe = false;
            return;
        } else if (ts.isPropertyAccessExpression(node)
            && (forbidden.test(node.name.text)
                || (ts.isIdentifier(node.expression) && node.expression.text === 'session' && node.name.text === 'id'))) {
            safe = false;
            return;
        } else if (ts.isElementAccessExpression(node)) {
            const argument = node.argumentExpression && unwrap(node.argumentExpression);
            if (argument && ts.isStringLiteral(argument) && forbidden.test(argument.text)) {
                safe = false;
                return;
            }
        } else if (ts.isStringLiteral(node) && forbidden.test(node.text)) {
            safe = false;
            return;
        } else if (ts.isIdentifier(node) && forbidden.test(node.text)) {
            safe = false;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return safe;
}

/* @Codex */
export function validateLogoutAuditModes({ spec, routeSource, serviceSource = null }) {
    const problems = [];
    const route = checkedSource('route.ts', routeSource);
    const inline = spec.modes.inline;
    const delegated = spec.modes.delegated;
    const inlinePresent = anyNamedImport(route.sourceFile, inline.writerExport)
        || routeSource.includes(`'${inline.eventType}'`);
    const delegatedPresent = anyNamedImport(route.sourceFile, delegated.serviceExport)
        || routeSource.includes(delegated.serviceExport);
    if (inlinePresent === delegatedPresent) return ['logout must use exactly one inline or delegated audit mode'];
    if (inlinePresent) {
        return validateAuditWriterControlFlow({
            source: routeSource, fileName: 'route.ts', ownerName: inline.handler,
            writerModule: inline.writerModule, writerExport: inline.writerExport, eventType: inline.eventType,
        });
    }
    if (!serviceSource) return ['delegated logout owner source is missing'];
    problems.push(...validateExactServiceOwnedLogoutRoute(route.sourceFile, route.checker, spec));
    const handler = namedFunction(route.sourceFile, delegated.handler, true);
    const delegate = importedBinding(route.sourceFile, route.checker, delegated.serviceModule, delegated.serviceExport);
    const routeCalls = handler && delegate ? bindingCalls(handler, route.checker, delegate.symbol) : [];
    const routeCall = routeCalls[0];
    const directDelegate = routeCall && ts.isIdentifier(unwrap(routeCall.expression))
        && unwrap(routeCall.expression).text === importedName(route.sourceFile, delegated.serviceModule, delegated.serviceExport);
    const serviceStatement = routeCall ? directStatement(handler, routeCall) : null;
    const serviceReturn = serviceStatement && ts.isReturnStatement(serviceStatement) ? serviceStatement : null;
    const routeReturns = handler ? directReturnStatements(handler) : [];
    if (routeCalls.length !== 1 || !directDelegate || !serviceReturn
        || routeReturns.length !== 1 || routeReturns[0] !== serviceReturn) {
        problems.push('delegated logout route must return exactly one direct service-owned terminal response');
    }
    if (handler && hasDeferredWork(handler)) problems.push('logout route must not defer audit work');

    const service = checkedSource('service.ts', serviceSource);
    const owner = namedFunction(service.sourceFile, delegated.ownerName, true);
    const writer = importedName(service.sourceFile, delegated.writerModule, delegated.writerExport);
    const hash = importedName(service.sourceFile, delegated.writerModule, delegated.hashExport);
    const writerBinding = importedBinding(service.sourceFile, service.checker, delegated.writerModule, delegated.writerExport);
    const resolveBinding = importedBinding(service.sourceFile, service.checker, delegated.ownerModule, delegated.resolveExport);
    const retireBinding = importedBinding(service.sourceFile, service.checker, delegated.ownerModule, delegated.retireExport);
    const etagBinding = importedBinding(service.sourceFile, service.checker, delegated.transportModule, delegated.etagExport);
    const sourcesDeclaration = service.sourceFile.statements.flatMap((statement) => ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations] : []).find((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === delegated.sourcesName);
    const sources = exactFrozenObjectLiteral(sourcesDeclaration?.initializer, service.sourceFile);
    const sourceProperties = exactPropertyAssignments(sources, ['resolve', 'retire', 'audit']);
    const resolveProperty = sourceProperties?.get('resolve');
    const resolveInitializer = resolveProperty?.initializer && unwrap(resolveProperty.initializer);
    const retireProperty = sourceProperties?.get('retire');
    const retireInitializer = retireProperty?.initializer && unwrap(retireProperty.initializer);
    const auditProperty = sourceProperties?.get('audit');
    const auditOwner = auditProperty && ts.isFunctionLike(auditProperty.initializer) ? auditProperty.initializer : null;
    const sourcesAreConst = sourcesDeclaration && ts.isVariableDeclarationList(sourcesDeclaration.parent)
        && Boolean(sourcesDeclaration.parent.flags & ts.NodeFlags.Const);
    const ownerReturns = owner ? directReturnStatements(owner) : [];
    const exactCookie = exactLogoutValidator(
        service.sourceFile, 'exactCookie', 'value,name,pattern', EXACT_LOGOUT_COOKIE_VALIDATOR_BODY,
    );
    const exactProjection = exactLogoutValidator(
        service.sourceFile, 'exactActiveWebProjection', 'value,sessionId', EXACT_LOGOUT_PROJECTION_VALIDATOR_BODY,
    );
    const receiptValidator = exactLogoutValidator(
        service.sourceFile, delegated.receiptValidator, 'value', EXACT_LOGOUT_RECEIPT_VALIDATOR_BODY,
    );
    const transportName = importedName(service.sourceFile, delegated.transportModule, delegated.etagExport);
    if (!owner || !writer || !hash || !writerBinding || !resolveBinding || !retireBinding || !etagBinding
        || transportName !== delegated.etagExport || !sourcesAreConst || !sourceProperties || !auditOwner
        || !exactIdentifierBinding(service.checker, resolveInitializer, resolveBinding.symbol)
        || !exactIdentifierBinding(service.checker, retireInitializer, retireBinding.symbol)
        || !hasExactLogoutValidationPrimitives(service.sourceFile, service.checker)
        || !exactCookie || !exactProjection || !receiptValidator
        || localBindingExists(receiptValidator, delegated.etagExport)
        || !exactNoStoreResponseFactory(service.sourceFile)
        || serviceSource.includes("from './server-session'")
        || serviceSource.includes('dispatchActiveWebServerSessionRetirement')) {
        problems.push('delegated service must use the exact package owner transport, validators, writer, and no-store response factory');
    }
    if (!owner || !writer || !hash || !writerBinding || !auditOwner) return problems;
    if (localBindingExists(owner, 'empty') || ownerReturns.length === 0 || ownerReturns.some((statement) => !exactEmptyStatusReturn(statement))) {
        problems.push('all delegated service terminal statuses must return through the exact no-store response factory');
    }

    const [bearerParameter, controlParameter, requestParameter, sourceParameter] = owner.parameters;
    const sourceInitializer = sourceParameter?.initializer && unwrap(sourceParameter.initializer);
    const sourcesSymbol = sourcesDeclaration && ts.isIdentifier(sourcesDeclaration.name)
        ? service.checker.getSymbolAtLocation(sourcesDeclaration.name) : null;
    if (owner.parameters.length !== 4
        || !bearerParameter || !ts.isIdentifier(bearerParameter.name) || bearerParameter.name.text !== 'bearerCookie'
        || !controlParameter || !ts.isIdentifier(controlParameter.name) || controlParameter.name.text !== 'controlCookie'
        || !requestParameter || !ts.isIdentifier(requestParameter.name) || requestParameter.name.text !== 'request'
        || !sourceParameter || !ts.isIdentifier(sourceParameter.name) || sourceParameter.name.text !== 'sources'
        || !exactIdentifierBinding(service.checker, sourceInitializer, sourcesSymbol)
        || localBindingExists(owner, 'sources', true)) {
        problems.push('owner must use the exact immutable production sources binding');
    }
    const sourceCalls = exactDirectObjectCalls(owner, 'sources', ['resolve', 'retire', 'audit']);
    const resolveCalls = sourceCalls.calls.get('resolve');
    const retireCalls = sourceCalls.calls.get('retire');
    const auditCalls = sourceCalls.calls.get('audit');
    const moduleConstant = (name) => service.sourceFile.statements.flatMap((statement) => ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations] : []).filter((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name);
    const exactModuleInitializer = (name, expected) => {
        const [declaration] = moduleConstant(name);
        return moduleConstant(name).length === 1 && declaration.initializer
            && ts.isVariableDeclarationList(declaration.parent) && Boolean(declaration.parent.flags & ts.NodeFlags.Const)
            && declaration.initializer.getText(service.sourceFile).replace(/\s+/gu, ' ') === expected;
    };
    const exactCookieDeclaration = (name, parameterName, cookieName, patternName) => {
        const declarations = owner.body.statements.flatMap((statement) => ts.isVariableStatement(statement)
            ? [...statement.declarationList.declarations].filter((declaration) =>
                ts.isIdentifier(declaration.name) && declaration.name.text === name) : []);
        const declaration = declarations.length === 1 ? declarations[0] : null;
        const initializer = declaration?.initializer && unwrap(declaration.initializer);
        const symbol = declaration && ts.isIdentifier(declaration.name)
            ? service.checker.getSymbolAtLocation(declaration.name) : null;
        return declaration && ts.isVariableDeclarationList(declaration.parent)
            && Boolean(declaration.parent.flags & ts.NodeFlags.Const)
            && initializer && ts.isCallExpression(initializer) && !initializer.questionDotToken
            && ts.isIdentifier(initializer.expression) && initializer.expression.text === 'exactCookie'
            && exactArguments(initializer, [
                { identifier: parameterName }, { identifier: cookieName }, { identifier: patternName },
            ]) && !bindingIsWritten(owner.body, service.checker, symbol) ? { declaration, symbol } : null;
    };
    const sessionId = exactCookieDeclaration('sessionId', 'bearerCookie', 'SESSION_COOKIE_NAME', 'SESSION_ID');
    const controlId = exactCookieDeclaration('controlId', 'controlCookie', 'CONTROL_COOKIE_NAME', 'CONTROL_ID');
    const exactConstants = exactModuleInitializer('SESSION_COOKIE_NAME', "'mediflow_session'")
        && exactModuleInitializer('CONTROL_COOKIE_NAME', "'mediflow_auth_control'")
        && exactModuleInitializer('SESSION_ID', '/^[a-f0-9]{64}$/u')
        && exactModuleInitializer('CONTROL_ID', '/^[A-Za-z0-9_-]{32,256}$/u')
        && exactModuleInitializer('SESSION_KEYS', "Object.freeze(['id', 'userId', 'username', 'role', 'authChannel', 'createdAt', 'expiresAt'])")
        && exactModuleConstProperty(service.sourceFile, service.checker, 'DateNow', 'Date', 'now');
    if (!sessionId || !controlId || !exactConstants
        || moduleScopeBindingExists(service.sourceFile, 'sessionId') || moduleScopeBindingExists(service.sourceFile, 'controlId')) {
        problems.push('owner must derive exact immutable bearer and control ids from the two fixed cookies');
    }
    const resolveCall = resolveCalls.length === 1 ? resolveCalls[0] : null;
    const projectionCall = resolveCall?.parent && ts.isCallExpression(resolveCall.parent)
        && ts.isIdentifier(resolveCall.parent.expression) && resolveCall.parent.expression.text === 'exactActiveWebProjection'
        ? resolveCall.parent : null;
    if (!resolveCall || !isUnconditionalOwnerCall(owner, resolveCall)
        || !exactArguments(resolveCall, [{ identifier: 'sessionId' }, { identifier: 'controlId' }])
        || !projectionCall || projectionCall.arguments.length !== 2 || projectionCall.arguments[0] !== resolveCall
        || !ts.isIdentifier(unwrap(projectionCall.arguments[1])) || unwrap(projectionCall.arguments[1]).text !== 'sessionId') {
        problems.push('owner must resolve exactly once with both ids and validate the ACTIVE Web projection');
    }
    const auditCall = auditCalls[0];
    if (!sourceCalls.exact || resolveCalls.length !== 1 || retireCalls.length !== 1 || auditCalls.length !== 1
        || !auditCall || !isAwaited(auditCall)
        || !exactArguments(retireCalls[0], [{ identifier: 'projection' }, { literal: 'delete' }])
        || !exactArguments(auditCall, [{ identifier: 'projection' }, { identifier: 'sessionId' }, { identifier: 'request' }])) {
        problems.push('owner must resolve and retire the exact projection before one awaited audit');
    }
    if ([resolveCalls[0], retireCalls[0], auditCalls[0]].some((call) =>
        !call || hasPriorUnconditionalTermination(owner, call))) {
        problems.push('owner must not terminate before the exact resolution, retirement, and audit flow');
    }
    const receiptWrapper = retireCalls[0]?.parent && ts.isCallExpression(retireCalls[0].parent)
        && ts.isIdentifier(retireCalls[0].parent.expression)
        && retireCalls[0].parent.expression.text === delegated.receiptValidator ? retireCalls[0].parent : null;
    const compact = (statement) => statement?.getText(service.sourceFile).replace(/\s+/gu, ' ');
    const cookieGuard = owner.body?.statements.find((statement) => compact(statement) === 'if (!sessionId || !controlId) return empty(401);');
    const projectionGuard = owner.body?.statements.find((statement) => compact(statement) === 'if (!projection) return empty(401);');
    const receiptGuard = owner.body?.statements.find((statement) => compact(statement) === 'if (!receipt) return empty(409);');
    const completedGuard = owner.body?.statements.find((statement) =>
        compact(statement) === "if (receipt.outcome !== 'completed') return empty(409, receipt.etag);");
    if (!cookieGuard || !projectionGuard || !receiptWrapper || receiptWrapper.arguments.length !== 1
        || !receiptGuard || !completedGuard || localBindingExists(owner, delegated.receiptValidator)
        || !isUnconditionalOwnerCall(owner, retireCalls[0]) || !isUnconditionalOwnerCall(owner, auditCall)
        || retireCalls[0].getStart() > receiptGuard.getStart() || receiptGuard.getStart() > completedGuard.getStart()
        || completedGuard.getStart() > auditCall.getStart()) {
        problems.push('completed package-owner retirement and its ETag must be checked before audit');
    }
    const terminal204 = ownerReturns.filter((statement) => {
        const expression = statement.expression && unwrap(statement.expression);
        return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
            && expression.expression.text === 'empty' && expression.arguments.length === 2
            && ts.isNumericLiteral(unwrap(expression.arguments[0])) && unwrap(expression.arguments[0]).text === '204'
            && ts.isPropertyAccessExpression(unwrap(expression.arguments[1]))
            && ts.isIdentifier(unwrap(expression.arguments[1]).expression)
            && unwrap(expression.arguments[1]).expression.text === 'receipt'
            && unwrap(expression.arguments[1]).name.text === 'etag';
    });
    const auditTry = auditCall?.parent && ts.isAwaitExpression(auditCall.parent)
        && auditCall.parent.parent && ts.isExpressionStatement(auditCall.parent.parent)
        && auditCall.parent.parent.parent && ts.isBlock(auditCall.parent.parent.parent)
        && auditCall.parent.parent.parent.parent && ts.isTryStatement(auditCall.parent.parent.parent.parent)
        ? auditCall.parent.parent.parent.parent : null;
    const guardIndex = owner.body?.statements.indexOf(completedGuard) ?? -1;
    const exactTerminalSequence = guardIndex >= 0 && owner.body.statements[guardIndex + 1] === auditTry
        && owner.body.statements[guardIndex + 2] === terminal204[0];
    if (!completedGuard || !auditCall || !auditTry?.catchClause || auditTry.catchClause.block.statements.length !== 0
        || auditTry.catchClause.variableDeclaration
        || auditTry.tryBlock.statements.length !== 1 || auditTry.tryBlock.statements[0] !== auditCall.parent.parent
        || auditTry.finallyBlock
        || !terminal204[0] || terminal204.length !== 1 || ownerReturns.at(-1) !== terminal204[0]
        || completedGuard.getStart() > auditCall.getStart() || auditCall.getStart() > terminal204[0].getStart()
        || !exactTerminalSequence) {
        problems.push('completed retirement must contain the awaited audit before one service-owned terminal 204 with ETag');
    }

    const context = importedName(service.sourceFile, delegated.writerModule, 'auditContextFromSession');
    const requestId = importedName(service.sourceFile, delegated.writerModule, 'requestIdFromRequest');
    const metadataBuilder = importedName(service.sourceFile, delegated.writerModule, 'withAuditContextMetadata');
    const writerCalls = directWriterCalls(auditOwner, writer, null);
    const allWriterCalls = bindingCalls(service.sourceFile, service.checker, writerBinding.symbol);
    const input = writerCalls.direct[0]?.arguments[0];
    const auditProperties = exactPropertyAssignments(input && ts.isObjectLiteralExpression(input) ? input : null, [
        'eventType', 'outcome', 'actorType', 'actorRef', 'subjectType', 'subjectRef',
        'sourceSurface', 'occurredAt', 'requestId', 'redactedMetadata',
    ]);
    const event = auditProperties?.get('eventType');
    const subject = auditProperties?.get('subjectRef');
    const subjectValue = subject && unwrap(subject.initializer);
    const writerCall = writerCalls.direct[0];
    const writerStatement = writerCall && directAwaitedExpressionStatement(auditOwner, writerCall);
    const exactWriterCallee = writerCall && !writerCall.questionDotToken
        && ts.isIdentifier(writerCall.expression) && writerCall.expression.text === writer;
    const auditStatements = ts.isBlock(auditOwner.body) ? [...auditOwner.body.statements] : [];
    const contextDeclaration = auditStatements[0] && ts.isVariableStatement(auditStatements[0])
        ? auditStatements[0].declarationList.declarations[0] : null;
    const contextInitializer = contextDeclaration?.initializer && unwrap(contextDeclaration.initializer);
    const requestIdValue = auditProperties?.get('requestId')?.initializer && unwrap(auditProperties.get('requestId').initializer);
    const metadataValue = auditProperties?.get('redactedMetadata')?.initializer && unwrap(auditProperties.get('redactedMetadata').initializer);
    const exactContextValue = (name, property) => {
        const value = auditProperties?.get(name)?.initializer && unwrap(auditProperties.get(name).initializer);
        return Boolean(value && ts.isPropertyAccessExpression(value) && !value.questionDotToken
            && ts.isIdentifier(value.expression) && value.expression.text === 'context' && value.name.text === property);
    };
    const exactStringValue = (name, expected) => {
        const value = auditProperties?.get(name)?.initializer;
        return Boolean(value && ts.isStringLiteral(value) && value.text === expected);
    };
    const safeAuditInput = Boolean(auditProperties && auditLiteralSyntaxIsExactAndSafe(input));
    const exactAuditIdentity = Boolean(auditProperties
        && exactStringValue('outcome', 'success')
        && exactContextValue('actorType', 'actorType') && exactContextValue('actorRef', 'actorRef')
        && exactStringValue('subjectType', 'session')
        && exactContextValue('sourceSurface', 'sourceSurface'));
    if (localBindingExists(auditOwner, writer) || localBindingExists(auditOwner, hash)
        || !context || !requestId || !metadataBuilder || localBindingExists(auditOwner, context)
        || localBindingExists(auditOwner, requestId) || localBindingExists(auditOwner, metadataBuilder)
        || allWriterCalls.length !== 1 || writerCalls.all.length !== 1 || writerCalls.direct.length !== 1 || !isAwaited(writerCall)
        || !exactWriterCallee || !writerStatement || auditStatements.length !== 2 || auditStatements[1] !== writerStatement
        || !contextDeclaration || !ts.isIdentifier(contextDeclaration.name) || contextDeclaration.name.text !== 'context'
        || !ts.isCallExpression(contextInitializer) || !ts.isIdentifier(contextInitializer.expression) || contextInitializer.expression.text !== context
        || !exactArguments(contextInitializer, [{ identifier: 'session' }])
        || !ts.isCallExpression(requestIdValue) || !ts.isIdentifier(requestIdValue.expression) || requestIdValue.expression.text !== requestId
        || !exactArguments(requestIdValue, [{ identifier: 'request' }])
        || !ts.isCallExpression(metadataValue) || !ts.isIdentifier(metadataValue.expression) || metadataValue.expression.text !== metadataBuilder
        || !exactArguments(metadataValue, [{ identifier: 'context' }, { null: true }])
        || !auditProperties || !event || !ts.isStringLiteral(event.initializer) || event.initializer.text !== delegated.eventType) {
        problems.push('delegated writer must await exactly one auth.logout event');
    }
    if (safeAuditInput && !exactAuditIdentity) problems.push('delegated writer must bind the exact success identity and session subject');
    let eventLiteralCount = 0;
    const countEvent = (node) => { if (ts.isStringLiteral(node) && node.text === delegated.eventType) eventLiteralCount += 1; ts.forEachChild(node, countEvent); };
    countEvent(service.sourceFile);
    if (eventLiteralCount !== 1) problems.push('delegated service must contain exactly one auth.logout literal');
    if (!subjectValue || !ts.isCallExpression(subjectValue) || !ts.isIdentifier(subjectValue.expression)
        || subjectValue.expression.text !== hash || subjectValue.arguments.length !== 1
        || subjectValue.arguments[0].getText(service.sourceFile) !== 'sessionId') problems.push('logout subject must be the approved hash of the exact session id');
    let rawSessionIdUses = 0;
    const countSessionId = (node) => { if (ts.isIdentifier(node) && node.text === 'sessionId') rawSessionIdUses += 1; ts.forEachChild(node, countSessionId); };
    if (input) countSessionId(input);
    const metadata = auditProperties?.get('redactedMetadata');
    if (!auditProperties || [...auditProperties.keys()].some((name) => /authorization|bearer|cookie|token|raw/iu.test(name))
        || rawSessionIdUses !== 1 || !safeAuditInput) {
        problems.push('delegated audit exposes raw bearer material or unsafe metadata');
    }
    if (hasDeferredWork(owner) || hasDeferredWork(auditOwner)) problems.push('delegated owner must not defer or float audit work');
    return problems;
}

function checkAuditWriterControlFlow(findings) {
    const contracts = REQUIRED_ROUTE_AUDIT.flatMap((entry) =>
        (entry.writerContracts ?? []).filter((contract) => !contract.modes
            && !contract.transactionalPatientUpdate && !contract.transactionalPatientDelete
            && !contract.transactionalDiary && !contract.transactionalTherapy && !contract.transactionalObservation)
            .map((contract) => ({ ...contract, route: entry.route })));
    const parsedFiles = new Map();
    for (const contract of contracts) {
        if (!parsedFiles.has(contract.ownerFile)) {
            const source = read(contract.ownerFile);
            parsedFiles.set(contract.ownerFile, {
                source,
                sourceFile: ts.createSourceFile(contract.ownerFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
            });
        }
        const parsed = parsedFiles.get(contract.ownerFile);
        for (const problem of validateAuditWriterControlFlow({
            ...contract,
            ...parsed,
            fileName: contract.ownerFile,
        })) {
            addFinding(findings, 'AUDIT_CONTROL_FLOW', problem, {
                route: contract.route,
                target: contract.target,
                owner: contract.ownerName,
                eventType: contract.eventType,
            });
        }
    }
    return { targets: contracts.length, files: parsedFiles.size };
}

function checkAppendOnly(findings) {
    const source = read('lib/security/audit-db.ts');
    for (const token of [
        'CREATE TRIGGER IF NOT EXISTS audit_events_no_update',
        'BEFORE UPDATE ON audit_events',
        'CREATE TRIGGER IF NOT EXISTS audit_events_no_delete',
        'BEFORE DELETE ON audit_events',
        'AUDIT_APPEND_ONLY_ERROR',
    ]) {
        if (!source.includes(token)) {
            addFinding(findings, 'AUDIT_APPEND_ONLY', `Missing append-only schema guard token: ${token}`);
        }
    }
}

function checkAuditCatalog(findings) {
    const source = read('lib/security/audit.ts');
    for (const eventType of REQUIRED_EVENT_TYPES) {
        if (!source.includes(`'${eventType}'`)) {
            addFinding(findings, 'AUDIT_CATALOG', `Required audit event type is missing from AUDIT_EVENT_TYPES: ${eventType}`);
        }
    }
    for (const key of METADATA_KEYS) {
        if (!source.includes(`${key}?:`)) {
            addFinding(findings, 'AUDIT_METADATA_SHAPE', `PHI-safe metadata key is missing from AuditRedactedMetadata: ${key}`);
        }
    }
}

function checkRouteCoverage(findings) {
    for (const entry of REQUIRED_ROUTE_AUDIT) {
        if (!exists(entry.route)) {
            addFinding(findings, 'AUDIT_ROUTE_MISSING', `Required audited route is missing: ${entry.route}`, entry);
            continue;
        }

        const source = read(entry.route);
        if (entry.writerContracts) {
            for (const contract of entry.writerContracts) {
                if (!contract.modes && !exists(contract.ownerFile)) {
                    addFinding(findings, 'AUDIT_ROUTE_DELEGATION', `${entry.route}: required audit owner is missing`, {
                        route: entry.route, target: contract.target, eventType: contract.eventType ?? entry.events[0],
                    });
                    continue;
                }
                const problems = contract.modes
                    ? validateLogoutAuditModes({
                        spec: contract,
                        routeSource: source,
                        serviceSource: exists(contract.modes.delegated.ownerFile)
                            ? read(contract.modes.delegated.ownerFile) : null,
                    })
                    : contract.transactionalPatientUpdate
                        ? validateRequiredPatientUpdateAudit({
                            spec: contract, routeSource: source, coreSource: read(contract.ownerFile),
                            auditSource: read('lib/security/audit.ts'),
                        })
                    : contract.transactionalPatientDelete
                        ? validateRequiredPatientDeleteAudit({
                            spec: contract, routeSource: source, coreSource: read(contract.ownerFile),
                            auditSource: read('lib/security/audit.ts'),
                        })
                    : contract.transactionalDiary
                        ? validateRequiredDiaryAudit({
                            spec: contract, routeSource: source, coreSource: read(contract.ownerFile),
                            bridgeSource: exists(contract.bridgeFile) ? read(contract.bridgeFile) : null,
                        })
                    : contract.transactionalTherapy
                        ? validateRequiredTherapyAudit({
                            spec: contract, routeSource: source, coreSource: read(contract.ownerFile),
                            bridgeSource: exists(contract.bridgeFile) ? read(contract.bridgeFile) : null,
                        })
                    : contract.transactionalObservation
                        ? validateRequiredObservationAudit({
                            spec: contract, routeSource: source, coreSource: read(contract.ownerFile),
                            bridgeSource: exists(contract.bridgeFile) ? read(contract.bridgeFile) : null,
                        })
                    : validateDelegatedRouteAudit({
                        spec: contract,
                        routeSource: source,
                        serviceSource: read(contract.ownerFile),
                    });
                for (const problem of problems) {
                    addFinding(findings, 'AUDIT_ROUTE_DELEGATION', `${entry.route}: ${problem}`, {
                        route: entry.route,
                        target: contract.target,
                        eventType: contract.eventType ?? entry.events[0],
                    });
                }
            }
            continue;
        }
        const hasWriter = source.includes('writeAuditEvent') || source.includes('safeWriteAuditEventFromRequest');
        if (!hasWriter) {
            addFinding(findings, 'AUDIT_ROUTE_WRITER', `Route lacks an audit writer call: ${entry.route}`, entry);
        }

        for (const eventType of entry.events) {
            if (!sourceIncludesEvent(source, eventType)) {
                addFinding(findings, 'AUDIT_ROUTE_EVENT', `Route lacks required audit event ${eventType}: ${entry.route}`, {
                    ...entry,
                    eventType,
                });
            }
        }
    }
}

function sourceIncludesEvent(source, eventType) {
    return source.includes(`'${eventType}'`);
}

function checkPhiSafeMetadata(findings) {
    const targets = [
        'lib/security/audit.ts',
        'lib/patient-update-operation.ts',
        'lib/patient-delete-operation.ts',
        'lib/siss-audit.ts',
        ...REQUIRED_ROUTE_AUDIT.map((entry) => entry.route),
    ];
    const keyPattern = new RegExp(`\\b(${FORBIDDEN_METADATA_KEYS.map(escapeRegex).join('|')})\\s*:`, 'gi');

    for (const relativePath of [...new Set(targets)]) {
        if (!exists(relativePath)) continue;
        const lines = read(relativePath).split(/\r?\n/);
        lines.forEach((line, index) => {
            if (!isAuditRelevantLine(line)) return;
            keyPattern.lastIndex = 0;
            for (const match of line.matchAll(keyPattern)) {
                addFinding(findings, 'AUDIT_PHI_METADATA', `Forbidden PHI/PII-shaped audit metadata key "${match[1]}"`, {
                    file: relativePath,
                    line: index + 1,
                });
            }
        });
    }
}

function isAuditRelevantLine(line) {
    return line.includes('redactedMetadata')
        || line.includes('sanitizeAuditMetadata')
        || line.includes('withAuditContextMetadata')
        || line.includes('buildSissPrescriptionLaunchAuditMetadata')
        || line.includes('changedFields')
        || line.includes('reasonCode')
        || line.includes('flags')
        || line.includes('counts')
        || line.includes('resourceVersion');
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const findings = [];

    checkAppendOnly(findings);
    checkAuditCatalog(findings);
    checkRouteCoverage(findings);
    const auditControlFlow = checkAuditWriterControlFlow(findings);
    checkPhiSafeMetadata(findings);

    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: findings.length === 0 ? 'pass' : 'fail',
        checked: {
            routes: REQUIRED_ROUTE_AUDIT.length,
            requiredEvents: REQUIRED_EVENT_TYPES.size,
            auditControlFlowTargets: auditControlFlow.targets,
            auditControlFlowFiles: auditControlFlow.files,
            metadataKeys: METADATA_KEYS,
            forbiddenMetadataKeys: FORBIDDEN_METADATA_KEYS,
        },
        findings,
    };

    const outPath = path.join(ROOT, options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

    if (findings.length === 0) {
        process.stdout.write(`Audit quality gate passed. Report: ${options.out}\n`);
        return;
    }

    process.stderr.write(`Audit quality gate failed with ${findings.length} finding(s). Report: ${options.out}\n`);
    for (const finding of findings) {
        process.stderr.write(`- ${finding.code}: ${finding.message}\n`);
    }
    process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
