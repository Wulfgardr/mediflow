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
                    handler: 'POST', serviceModule: '@/lib/security/web-logout-service', serviceExport: 'completeExactWebP3Logout',
                    ownerFile: 'lib/security/web-logout-service.ts', ownerName: 'completeExactWebP3Logout',
                    writerModule: '@/lib/security/audit', writerExport: 'writeAuditEvent', hashExport: 'hashAuditRef',
                    eventType: 'auth.logout', sourcesName: 'productionSources',
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
        }],
    },
    { route: 'app/api/settings/route.ts', events: ['settings.updated'], reason: 'bulk settings mutations must stay auditable' },
    { route: 'app/api/settings/[key]/route.ts', events: ['settings.updated'], reason: 'single-key settings mutations must stay auditable' },
    { route: 'app/api/patients/route.ts', events: ['patient.created'], reason: 'patient creation is a sensitive CRUD path' },
    { route: 'app/api/patients/[id]/route.ts', events: ['patient.updated', 'patient.deleted'], reason: 'patient update/delete are sensitive CRUD paths' },
    { route: 'app/api/v1/patients/route.ts', events: ['patient.created'], reason: 'native/shared patient creation must stay auditable' },
    { route: 'app/api/v1/patients/[id]/route.ts', events: ['patient.updated', 'patient.deleted'], reason: 'native/shared patient update/delete must stay auditable' },
    { route: 'app/api/entries/route.ts', events: ['entry.created'], reason: 'clinical entry creation is sensitive CRUD' },
    { route: 'app/api/entries/[id]/route.ts', events: ['entry.updated', 'entry.deleted'], reason: 'clinical entry update/delete are sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/entries/route.ts', events: ['entry.created'], reason: 'native/shared clinical entry creation is sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/entries/[entryId]/route.ts', events: ['entry.updated', 'entry.deleted'], reason: 'native/shared clinical entry update/delete is sensitive CRUD' },
    { route: 'lib/network-entry-write.ts', events: ['entry.created', 'entry.updated', 'entry.deleted'], reason: 'paired clinical diary writes must stay PHI-safe auditable' },
    { route: 'app/api/therapies/route.ts', events: ['therapy.created'], reason: 'therapy creation is sensitive CRUD' },
    { route: 'app/api/therapies/[id]/route.ts', events: ['therapy.updated', 'therapy.deleted'], reason: 'therapy update/delete are sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/therapies/route.ts', events: ['therapy.created'], reason: 'native/shared therapy creation is sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/therapies/[therapyId]/route.ts', events: ['therapy.updated', 'therapy.deleted'], reason: 'native/shared therapy update/delete are sensitive CRUD' },
    { route: 'lib/network-therapy-write.ts', events: ['therapy.created', 'therapy.updated', 'therapy.deleted'], reason: 'paired therapy writes must stay PHI-safe auditable' },
    { route: 'app/api/checkups/route.ts', events: ['checkup.created'], reason: 'checkup creation is sensitive CRUD' },
    { route: 'app/api/checkups/[id]/route.ts', events: ['checkup.updated', 'checkup.deleted'], reason: 'checkup update/delete are sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/checkups/route.ts', events: ['checkup.created'], reason: 'native/shared checkup creation is sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/checkups/[checkupId]/route.ts', events: ['checkup.updated', 'checkup.deleted'], reason: 'native/shared checkup update/delete are sensitive CRUD' },
    { route: 'lib/network-checkup-write.ts', events: ['checkup.created', 'checkup.updated', 'checkup.deleted'], reason: 'paired checkup writes must stay PHI-safe auditable' },
    { route: 'app/api/observations/route.ts', events: ['observation.created'], reason: 'observation creation is sensitive CRUD' },
    { route: 'app/api/observations/[id]/route.ts', events: ['observation.updated', 'observation.deleted'], reason: 'observation update/delete are sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/observations/route.ts', events: ['observation.created'], reason: 'native/shared observation creation is sensitive CRUD' },
    { route: 'app/api/v1/patients/[id]/observations/[observationId]/route.ts', events: ['observation.updated', 'observation.deleted'], reason: 'native/shared observation update/delete are sensitive CRUD' },
    { route: 'lib/network-observation-write.ts', events: ['observation.created', 'observation.updated', 'observation.deleted'], reason: 'paired observation writes must stay PHI-safe auditable' },
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
const EVENT_SOURCE_ALIASES = {
    'patient.updated': ['classifyPatientMutationEvent('],
};
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
                || ts.isContinueStatement(statement)
                || ts.isTryStatement(statement))) return false;
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

function exactPropertyAssignments(literal, allowedNames) {
    if (!literal || literal.properties.some((item) => !ts.isPropertyAssignment(item)
        || ts.isComputedPropertyName(item.name)
        || !(ts.isIdentifier(item.name) || ts.isStringLiteral(item.name)))) return null;
    const names = literal.properties.map((item) => item.name.text);
    if (new Set(names).size !== names.length || names.some((name) => !allowedNames.includes(name))) return null;
    return new Map(literal.properties.map((item) => [item.name.text, item]));
}

function responseStatus(statement, sourceFile) {
    const value = statement.expression && unwrap(statement.expression);
    if (!value || !ts.isNewExpression(value) || !ts.isIdentifier(value.expression)
        || value.expression.text !== 'Response' || value.arguments?.length !== 2
        || unwrap(value.arguments[0]).kind !== ts.SyntaxKind.NullKeyword) return null;
    const options = objectLiteral(value.arguments[1]);
    const properties = exactPropertyAssignments(options, ['status', 'headers']);
    const status = properties?.get('status')?.initializer;
    return status && ts.isNumericLiteral(status) ? Number(status.text) : null;
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

function exactCompletedGuard(statement, binding, sourceFile) {
    if (!ts.isIfStatement(statement) || statement.elseStatement) return false;
    const condition = unwrap(statement.expression);
    const operand = ts.isPrefixUnaryExpression(condition)
        && condition.operator === ts.SyntaxKind.ExclamationToken ? unwrap(condition.operand) : null;
    if (!operand || !ts.isPropertyAccessExpression(operand) || !ts.isIdentifier(operand.expression)
        || operand.expression.text !== binding || operand.name.text !== 'completed') return false;
    const denied = ts.isReturnStatement(statement.thenStatement) ? statement.thenStatement
        : ts.isBlock(statement.thenStatement) && statement.thenStatement.statements.length === 1
            && ts.isReturnStatement(statement.thenStatement.statements[0]) ? statement.thenStatement.statements[0] : null;
    const status = denied && responseStatus(denied, sourceFile);
    return typeof status === 'number' && status >= 400 && status <= 599;
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
        } else if (ts.isPropertyAccessExpression(node) && forbidden.test(node.name.text)) {
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
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return safe;
}

function metadataIsExactAndSafe(initializer) {
    const value = initializer && unwrap(initializer);
    if (value?.kind === ts.SyntaxKind.NullKeyword) return true;
    const literal = objectLiteral(initializer);
    const properties = exactPropertyAssignments(literal, METADATA_KEYS);
    if (!properties) return false;
    for (const [name, property] of properties) {
        const value = unwrap(property.initializer);
        if (name === 'resourceVersion' || name === 'counts') {
            if (!ts.isNumericLiteral(value)) return false;
        } else if (name === 'reasonCode') {
            if (!ts.isStringLiteral(value) || /authorization|bearer|cookie|token|session|patient|clinical|raw/iu.test(value.text)) return false;
        } else if (!ts.isArrayLiteralExpression(value) || value.elements.some((item) =>
            ts.isSpreadElement(item) || !ts.isStringLiteral(unwrap(item))
            || /authorization|bearer|cookie|token|session|patient|clinical|raw/iu.test(unwrap(item).text))) return false;
    }
    return true;
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
    problems.push(...validateDelegatedRouteAudit({ spec: delegated, routeSource, serviceSource }));
    const handler = namedFunction(route.sourceFile, delegated.handler, true);
    const delegate = importedBinding(route.sourceFile, route.checker, delegated.serviceModule, delegated.serviceExport);
    const routeCalls = handler && delegate ? bindingCalls(handler, route.checker, delegate.symbol) : [];
    const routeCall = routeCalls[0];
    const directDelegate = routeCall && ts.isIdentifier(unwrap(routeCall.expression))
        && unwrap(routeCall.expression).text === importedName(route.sourceFile, delegated.serviceModule, delegated.serviceExport);
    const callDeclaration = routeCall?.parent && ts.isAwaitExpression(routeCall.parent)
        && routeCall.parent.parent && ts.isVariableDeclaration(routeCall.parent.parent)
        ? routeCall.parent.parent : null;
    const receipt = callDeclaration && ts.isIdentifier(callDeclaration.name) ? callDeclaration.name.text : null;
    const callStatement = callDeclaration && directStatement(handler, callDeclaration);
    const routeStatements = handler?.body ? [...handler.body.statements] : [];
    const callIndex = callStatement ? routeStatements.indexOf(callStatement) : -1;
    const guard = callIndex >= 0 ? routeStatements[callIndex + 1] : null;
    const response204 = guard ? routeStatements[callIndex + 2] : null;
    const routeReturns = handler ? directReturnStatements(handler) : [];
    const all204 = [];
    const find204 = (node) => {
        if (node !== handler && ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && responseStatus(node, route.sourceFile) === 204) all204.push(node);
        ts.forEachChild(node, find204);
    };
    if (handler) find204(handler);
    if (routeCalls.length !== 1 || !directDelegate || !callDeclaration || !receipt
        || !ts.isVariableDeclarationList(callDeclaration.parent)
        || !(callDeclaration.parent.flags & ts.NodeFlags.Const)) problems.push('delegated logout call must be awaited directly into one exact receipt');
    if (!guard || !receipt || !exactCompletedGuard(guard, receipt, route.sourceFile)
        || !response204 || !ts.isReturnStatement(response204) || responseStatus(response204, route.sourceFile) !== 204
        || routeStatements.at(-1) !== response204 || routeReturns.length !== 2
        || !routeReturns.includes(response204) || all204.length !== 1 || all204[0] !== response204) {
        problems.push('the exact completed receipt must dominate the single terminal 204 response');
    }
    if (handler && hasDeferredWork(handler)) problems.push('logout route must not defer audit work');

    const service = checkedSource('service.ts', serviceSource);
    const owner = namedFunction(service.sourceFile, delegated.ownerName, true);
    const writer = importedName(service.sourceFile, delegated.writerModule, delegated.writerExport);
    const hash = importedName(service.sourceFile, delegated.writerModule, delegated.hashExport);
    const writerBinding = importedBinding(service.sourceFile, service.checker, delegated.writerModule, delegated.writerExport);
    const sourcesDeclaration = service.sourceFile.statements.flatMap((statement) => ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations] : []).find((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === delegated.sourcesName);
    const sources = objectLiteral(sourcesDeclaration?.initializer);
    const sourceProperties = exactPropertyAssignments(sources, ['resolve', 'retire', 'audit']);
    const auditProperty = sourceProperties?.get('audit');
    const auditOwner = auditProperty && ts.isFunctionLike(auditProperty.initializer) ? auditProperty.initializer : null;
    const sourcesAreConst = sourcesDeclaration && ts.isVariableDeclarationList(sourcesDeclaration.parent)
        && Boolean(sourcesDeclaration.parent.flags & ts.NodeFlags.Const);
    if (!owner || !writer || !hash || !writerBinding || !sourcesAreConst || !sourceProperties || !auditOwner) problems.push('delegated service writer is missing, shadowed, or unreachable');
    if (!owner || !writer || !hash || !writerBinding || !auditOwner) return problems;

    const sourceParameter = owner.parameters.find((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === 'sources');
    if (!sourceParameter?.initializer || !ts.isIdentifier(unwrap(sourceParameter.initializer))
        || unwrap(sourceParameter.initializer).text !== delegated.sourcesName || localBindingExists(owner, 'sources', true)) {
        problems.push('owner must use the exact immutable production sources binding');
    }
    const sourceCalls = exactDirectObjectCalls(owner, 'sources', ['resolve', 'retire', 'audit']);
    const retireCalls = sourceCalls.calls.get('retire');
    const auditCalls = sourceCalls.calls.get('audit');
    const auditCall = auditCalls[0];
    if (!sourceCalls.exact || retireCalls.length !== 1 || auditCalls.length !== 1 || !auditCall || !isAwaited(auditCall)
        || auditCall.arguments.map((argument) => argument.getText(service.sourceFile)).join(',') !== 'session,sessionId,request') {
        problems.push('owner must await exactly one sources.audit(session,sessionId,request) call');
    }
    const retirement = retireCalls[0]?.parent && ts.isVariableDeclaration(retireCalls[0].parent)
        && ts.isIdentifier(retireCalls[0].parent.name) ? retireCalls[0].parent.name.text : null;
    const completedGuard = owner.body?.statements.find((statement) => ts.isIfStatement(statement)
        && ts.isBinaryExpression(statement.expression)
        && statement.expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
        && ts.isPropertyAccessExpression(statement.expression.left)
        && ts.isIdentifier(statement.expression.left.expression)
        && statement.expression.left.expression.text === retirement && statement.expression.left.name.text === 'outcome'
        && ts.isStringLiteral(statement.expression.right) && statement.expression.right.text === 'completed'
        && alwaysTerminates(statement.thenStatement));
    if (!completedGuard || !auditCall || retireCalls[0].getStart() > completedGuard.getStart()
        || completedGuard.getStart() > auditCall.getStart()) problems.push('completed retirement must be checked before audit');
    const ownerStatements = owner.body ? [...owner.body.statements] : [];
    const retireStatement = retireCalls[0] && directStatement(owner, retireCalls[0]);
    const retireIndex = retireStatement ? ownerStatements.indexOf(retireStatement) : -1;
    const auditStatement = auditCall && directAwaitedExpressionStatement(owner, auditCall);
    const completedReturn = retireIndex >= 0 ? ownerStatements[retireIndex + 3] : null;
    const completedProperties = completedReturn && ts.isReturnStatement(completedReturn)
        ? exactPropertyAssignments(objectLiteral(completedReturn.expression), ['completed']) : null;
    if (retireIndex < 0 || ownerStatements[retireIndex + 1] !== completedGuard
        || ownerStatements[retireIndex + 2] !== auditStatement
        || !completedProperties || completedProperties.get('completed')?.initializer.kind !== ts.SyntaxKind.TrueKeyword
        || ownerStatements.at(-1) !== completedReturn) {
        problems.push('retirement, completed guard, awaited audit, and completed publication must be one terminal sequence');
    }

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
    const writerStatement = writerCalls.direct[0]
        && directAwaitedExpressionStatement(auditOwner, writerCalls.direct[0]);
    const auditStatements = ts.isBlock(auditOwner.body) ? [...auditOwner.body.statements] : [];
    if (localBindingExists(auditOwner, writer) || localBindingExists(auditOwner, hash)
        || allWriterCalls.length !== 1 || writerCalls.all.length !== 1 || writerCalls.direct.length !== 1 || !isAwaited(writerCalls.direct[0])
        || !writerStatement || auditStatements.length !== 1 || auditStatements[0] !== writerStatement
        || !auditProperties || !event || !ts.isStringLiteral(event.initializer) || event.initializer.text !== delegated.eventType) {
        problems.push('delegated writer must await exactly one auth.logout event');
    }
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
        || rawSessionIdUses !== 1 || !auditLiteralSyntaxIsExactAndSafe(input)
        || (metadata && !metadataIsExactAndSafe(metadata.initializer))) {
        problems.push('delegated audit exposes raw bearer material or unsafe metadata');
    }
    if (hasDeferredWork(owner) || hasDeferredWork(auditOwner)) problems.push('delegated owner must not defer or float audit work');
    return problems;
}

function checkAuditWriterControlFlow(findings) {
    const contracts = REQUIRED_ROUTE_AUDIT.flatMap((entry) =>
        (entry.writerContracts ?? []).filter((contract) => !contract.modes).map((contract) => ({ ...contract, route: entry.route })));
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
                const problems = contract.modes
                    ? validateLogoutAuditModes({
                        spec: contract,
                        routeSource: source,
                        serviceSource: exists(contract.modes.delegated.ownerFile)
                            ? read(contract.modes.delegated.ownerFile) : null,
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
    if (source.includes(`'${eventType}'`)) return true;
    return (EVENT_SOURCE_ALIASES[eventType] ?? []).some((token) => source.includes(token));
}

function checkPhiSafeMetadata(findings) {
    const targets = [
        'lib/security/audit.ts',
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
