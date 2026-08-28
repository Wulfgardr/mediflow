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
                    retireModule: './server-session', retireExport: 'dispatchActiveWebServerSessionRetirement',
                    eventType: 'auth.logout', sourcesName: 'productionSources', receiptValidator: 'completedReceipt',
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

const EXACT_LOGOUT_RECORD_VALIDATOR_BODY = `{ if (!value || typeof value !== 'object' || isProxy(value)) return null; try { if (ObjectGetPrototypeOf(value) !== prototype || (frozen && !ObjectIsFrozen(value)) || ObjectGetOwnPropertySymbols(value).length !== 0) return null; const names = ObjectGetOwnPropertyNames(value); if (names.length !== keys.length) return null; for (let index = 0; index < keys.length; index += 1) { const key = keys[index]; if (names[index] !== key) return null; const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null; if (frozen && (descriptor.configurable || descriptor.writable)) return null; } return value as ExactRecord; } catch { return null; } }`;

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

function isExactCompletedReceiptValidator(sourceFile, checker, name) {
    const validator = namedFunction(sourceFile, name);
    const exactRecord = namedFunction(sourceFile, 'exactRecord');
    const exactObjectCaptures = [
        ['ObjectGetPrototypeOf', 'getPrototypeOf'],
        ['ObjectGetOwnPropertyDescriptor', 'getOwnPropertyDescriptor'],
        ['ObjectGetOwnPropertyNames', 'getOwnPropertyNames'],
        ['ObjectGetOwnPropertySymbols', 'getOwnPropertySymbols'],
        ['ObjectIsFrozen', 'isFrozen'],
    ].every(([binding, property]) => exactModuleConstProperty(sourceFile, checker, binding, 'Object', property));
    const typesBinding = importedBinding(sourceFile, checker, 'node:util', 'types');
    if (!validator || !exactRecord || !exactObjectCaptures || moduleScopeBindingExists(sourceFile, 'Object')
        || importedName(sourceFile, 'node:util', 'types') !== 'types' || !typesBinding
        || !exactModuleConstProperty(sourceFile, checker, 'isProxy', 'types', 'isProxy', typesBinding.symbol)
        || validator.parameters.length !== 1
        || !ts.isIdentifier(validator.parameters[0].name) || validator.parameters[0].name.text !== 'value'
        || exactRecord.parameters.map((parameter) => parameter.name.getText(sourceFile)).join(',') !== 'value,keys,prototype,frozen'
        || exactRecord.body?.getText(sourceFile).replace(/\s+/gu, ' ') !== EXACT_LOGOUT_RECORD_VALIDATOR_BODY
        || validator.body?.statements.length !== 2) return null;
    const [declarationStatement, returnStatement] = validator.body.statements;
    const declaration = ts.isVariableStatement(declarationStatement)
        && Boolean(declarationStatement.declarationList.flags & ts.NodeFlags.Const)
        && declarationStatement.declarationList.declarations.length === 1
        ? declarationStatement.declarationList.declarations[0] : null;
    const initializer = declaration?.initializer && unwrap(declaration.initializer);
    const returned = ts.isReturnStatement(returnStatement) && returnStatement.expression
        ? unwrap(returnStatement.expression) : null;
    const left = returned && ts.isBinaryExpression(returned) ? unwrap(returned.left) : null;
    if (!declaration || !ts.isIdentifier(declaration.name) || declaration.name.text !== 'record'
        || !initializer || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression)
        || checker.getSymbolAtLocation(initializer.expression) !== checker.getSymbolAtLocation(exactRecord.name)
        || initializer.arguments.length !== 4 || initializer.arguments[0].getText(sourceFile) !== 'value'
        || initializer.arguments[1].getText(sourceFile) !== "['outcome']"
        || unwrap(initializer.arguments[2]).kind !== ts.SyntaxKind.NullKeyword
        || unwrap(initializer.arguments[3]).kind !== ts.SyntaxKind.TrueKeyword
        || !returned || !ts.isBinaryExpression(returned) || returned.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
        || !left || !ts.isPropertyAccessExpression(left) || !left.questionDotToken
        || !ts.isIdentifier(left.expression) || left.expression.text !== 'record' || left.name.text !== 'outcome'
        || !ts.isStringLiteral(unwrap(returned.right)) || unwrap(returned.right).text !== 'completed') return null;
    return validator;
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
        || node.getChildren().some(containsBinding);
    const visit = (node) => {
        const assignment = ts.isBinaryExpression(node)
            && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
            && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && containsBinding(node.left);
        const update = (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
            && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
            && containsBinding(node.operand);
        if (assignment || update) found = true;
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
    const [cookiesImport, serviceImport, sessionImport, handler] = sourceFile.statements;
    const problems = [];
    const cookiesBinding = importedBinding(sourceFile, checker, 'next/headers', 'cookies')?.symbol;
    const sessionCookieBinding = importedBinding(
        sourceFile, checker, '@/lib/security/server-session', 'SESSION_COOKIE_NAME',
    )?.symbol;
    if (sourceFile.statements.length !== 4
        || !exactNamedImport(cookiesImport, 'next/headers', 'cookies')
        || !exactNamedImport(serviceImport, delegated.serviceModule, delegated.serviceExport)
        || !exactNamedImport(sessionImport, '@/lib/security/server-session', 'SESSION_COOKIE_NAME')
        || !handler || !ts.isFunctionDeclaration(handler) || !handler.name || handler.name.text !== delegated.handler
        || !ts.getModifiers(handler)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        problems.push('logout route must expose only the exact cookies, service, and session-cookie imports plus POST');
        return problems;
    }
    const [request] = handler.parameters;
    const statements = handler.body ? [...handler.body.statements] : [];
    const cookieDeclaration = statements[0] && ts.isVariableStatement(statements[0]) ? statements[0] : null;
    const [cookie] = cookieDeclaration?.declarationList.declarations ?? [];
    const cookieBinding = cookie && ts.isIdentifier(cookie.name) ? cookie.name.text : null;
    const cookieSymbol = cookie && ts.isIdentifier(cookie.name) ? checker.getSymbolAtLocation(cookie.name) : null;
    const cookieInitialized = Boolean(cookie?.initializer && isNullOrUndefined(cookie.initializer));
    const cookieIsLet = Boolean(cookieDeclaration?.declarationList.flags & ts.NodeFlags.Let);
    const acquisition = statements[1] && ts.isTryStatement(statements[1]) ? statements[1] : null;
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
    const read = acquisitionStatements[1] && ts.isExpressionStatement(acquisitionStatements[1])
        ? unwrap(acquisitionStatements[1].expression) : null;
    const returnStatement = statements[2] && ts.isReturnStatement(statements[2]) ? statements[2] : null;
    const delegateCall = returnStatement?.expression && unwrap(returnStatement.expression);
    const exactDelegate = Boolean(delegateCall && ts.isCallExpression(delegateCall) && !delegateCall.questionDotToken
        && ts.isIdentifier(delegateCall.expression) && delegateCall.expression.text === delegated.serviceExport
        && exactArguments(delegateCall, [{ identifier: cookieBinding ?? '' }, { identifier: request?.name && ts.isIdentifier(request.name) ? request.name.text : '' }]));
    const exactRead = Boolean(read && ts.isBinaryExpression(read) && read.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && exactIdentifierBinding(checker, read.left, cookieSymbol)
        && exactCookieLookup(read.right, checker, cookieStoreSymbol, sessionCookieBinding));
    if (handler.parameters.length !== 1 || !request || !ts.isIdentifier(request.name) || request.name.text !== 'request'
        || statements.length !== 3 || !cookieBinding || !cookieInitialized || !cookieIsLet
        || cookieDeclaration.declarationList.declarations.length !== 1
        || !acquisition || acquisition.finallyBlock || !acquisition.catchClause || acquisition.catchClause.variableDeclaration
        || acquisition.catchClause.block.statements.length !== 0 || acquisitionStatements.length !== 2
        || !cookieStoreBinding || !cookieStoreDeclaration || !(cookieStoreDeclaration.declarationList.flags & ts.NodeFlags.Const)
        || cookieStoreDeclaration.declarationList.declarations.length !== 1
        || !cookiesCall || !ts.isCallExpression(cookiesCall) || cookiesCall.questionDotToken || !ts.isIdentifier(cookiesCall.expression)
        || !exactIdentifierBinding(checker, cookiesCall.expression, cookiesBinding)
        || cookiesCall.arguments.length !== 0 || !exactRead || !exactDelegate) {
        problems.push('POST must deny cookie acquisition failure and directly return the exact service-owned response');
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
    const parameter = factory?.parameters.length === 1 && ts.isIdentifier(factory.parameters[0].name)
        ? factory.parameters[0].name.text : null;
    const statement = factory?.body?.statements.length === 1 ? factory.body.statements[0] : null;
    const response = statement && ts.isReturnStatement(statement) && statement.expression && unwrap(statement.expression);
    if (parameter !== 'status' || moduleScopeBindingExists(sourceFile, 'Response')
        || !response || !ts.isNewExpression(response) || !ts.isIdentifier(response.expression)
        || response.expression.text !== 'Response' || response.arguments?.length !== 2
        || unwrap(response.arguments[0]).kind !== ts.SyntaxKind.NullKeyword) return false;
    const options = objectLiteral(response.arguments[1]);
    const statusProperty = options?.properties.find((property) => ts.isShorthandPropertyAssignment(property)
        && property.name.text === 'status');
    const headersProperty = options?.properties.find((property) => ts.isPropertyAssignment(property)
        && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'headers');
    const headers = headersProperty?.initializer && objectLiteral(headersProperty.initializer);
    const headerProperties = exactPropertyAssignments(headers, ['Cache-Control']);
    const cacheControl = headerProperties?.get('Cache-Control')?.initializer && unwrap(headerProperties.get('Cache-Control').initializer);
    let responseConstructors = 0;
    const visit = (node) => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Response') responseConstructors += 1;
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return Boolean(options && options.properties.length === 2 && statusProperty && headersProperty && cacheControl)
        && statusProperty.name.text === parameter && ts.isStringLiteral(cacheControl) && cacheControl.text === 'no-store'
        && responseConstructors === 1;
}

function exactEmptyStatusReturn(statement) {
    const expression = statement.expression && unwrap(statement.expression);
    return Boolean(expression && ts.isCallExpression(expression) && !expression.questionDotToken
        && ts.isIdentifier(expression.expression) && expression.expression.text === 'empty'
        && expression.arguments.length === 1 && ts.isNumericLiteral(unwrap(expression.arguments[0]))
        && [204, 401, 409].includes(Number(unwrap(expression.arguments[0]).text)));
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
    const serviceReturn = routeCall?.parent && ts.isReturnStatement(routeCall.parent) ? routeCall.parent : null;
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
    const retireBinding = importedBinding(service.sourceFile, service.checker, delegated.retireModule, delegated.retireExport);
    const sourcesDeclaration = service.sourceFile.statements.flatMap((statement) => ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations] : []).find((declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === delegated.sourcesName);
    const sources = exactFrozenObjectLiteral(sourcesDeclaration?.initializer, service.sourceFile);
    const sourceProperties = exactPropertyAssignments(sources, ['resolve', 'retire', 'audit']);
    const retireProperty = sourceProperties?.get('retire');
    const retireInitializer = retireProperty?.initializer && unwrap(retireProperty.initializer);
    const auditProperty = sourceProperties?.get('audit');
    const auditOwner = auditProperty && ts.isFunctionLike(auditProperty.initializer) ? auditProperty.initializer : null;
    const sourcesAreConst = sourcesDeclaration && ts.isVariableDeclarationList(sourcesDeclaration.parent)
        && Boolean(sourcesDeclaration.parent.flags & ts.NodeFlags.Const);
    const ownerReturns = owner ? directReturnStatements(owner) : [];
    if (!owner || !writer || !hash || !writerBinding || !retireBinding || !sourcesAreConst || !sourceProperties || !auditOwner
        || !exactIdentifierBinding(service.checker, retireInitializer, retireBinding.symbol)
        || !exactNoStoreResponseFactory(service.sourceFile)) problems.push('delegated service writer or no-store response factory is missing, shadowed, or unreachable');
    if (!owner || !writer || !hash || !writerBinding || !auditOwner) return problems;
    if (localBindingExists(owner, 'empty') || ownerReturns.length === 0 || ownerReturns.some((statement) => !exactEmptyStatusReturn(statement))) {
        problems.push('all delegated service terminal statuses must return through the exact no-store response factory');
    }

    const [cookieParameter, requestParameter, sourceParameter] = owner.parameters;
    const sourceInitializer = sourceParameter?.initializer && unwrap(sourceParameter.initializer);
    const sourcesSymbol = sourcesDeclaration && ts.isIdentifier(sourcesDeclaration.name)
        ? service.checker.getSymbolAtLocation(sourcesDeclaration.name) : null;
    if (owner.parameters.length !== 3
        || !cookieParameter || !ts.isIdentifier(cookieParameter.name) || cookieParameter.name.text !== 'cookie'
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
    const sessionIdDeclarations = owner.body.statements.flatMap((statement) => ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations].filter((declaration) =>
            ts.isIdentifier(declaration.name) && declaration.name.text === 'sessionId') : []);
    const sessionIdDeclaration = sessionIdDeclarations.length === 1 ? sessionIdDeclarations[0] : null;
    const sessionIdInitializer = sessionIdDeclaration?.initializer && unwrap(sessionIdDeclaration.initializer);
    const sessionIdSymbol = sessionIdDeclaration
        ? service.checker.getSymbolAtLocation(sessionIdDeclaration.name) : null;
    const cookieSymbol = cookieParameter && ts.isIdentifier(cookieParameter.name)
        ? service.checker.getSymbolAtLocation(cookieParameter.name) : null;
    const exactBearer = namedFunction(service.sourceFile, 'exactBearer');
    const exactBearerSymbol = exactBearer?.name && service.checker.getSymbolAtLocation(exactBearer.name);
    if (!sessionIdDeclaration || !ts.isVariableDeclarationList(sessionIdDeclaration.parent)
        || !(sessionIdDeclaration.parent.flags & ts.NodeFlags.Const) || moduleScopeBindingExists(service.sourceFile, 'sessionId')
        || !ts.isCallExpression(sessionIdInitializer) || sessionIdInitializer.questionDotToken
        || !exactIdentifierBinding(service.checker, unwrap(sessionIdInitializer.expression), exactBearerSymbol)
        || sessionIdInitializer.arguments.length !== 1
        || !exactIdentifierBinding(service.checker, unwrap(sessionIdInitializer.arguments[0]), cookieSymbol)
        || bindingIsWritten(owner.body, service.checker, sessionIdSymbol)) {
        problems.push('owner session id must be the exact const bearer binding');
    }
    const resolveCall = resolveCalls.length === 1 ? resolveCalls[0] : null;
    const resolveArgument = resolveCall?.arguments.length === 1 ? unwrap(resolveCall.arguments[0]) : null;
    if (!resolveCall || !isUnconditionalOwnerCall(owner, resolveCall)
        || !exactIdentifierBinding(service.checker, resolveArgument, sessionIdSymbol)) {
        problems.push('owner must resolve exactly once with the bound session id');
    }
    const auditCall = auditCalls[0];
    if (!sourceCalls.exact || resolveCalls.length !== 1 || retireCalls.length !== 1 || auditCalls.length !== 1
        || !auditCall || !isAwaited(auditCall)
        || !exactArguments(retireCalls[0], [{ identifier: 'sessionId' }, { literal: 'delete' }])
        || !exactArguments(auditCall, [{ identifier: 'session' }, { identifier: 'sessionId' }, { identifier: 'request' }])) {
        problems.push('owner must resolve and retire the exact session before one awaited audit');
    }
    if ([resolveCalls[0], retireCalls[0], auditCalls[0]].some((call) =>
        !call || hasPriorUnconditionalTermination(owner, call))) {
        problems.push('owner must not terminate before the exact resolution, retirement, and audit flow');
    }
    const retirement = retireCalls[0]?.parent && ts.isVariableDeclaration(retireCalls[0].parent)
        && ts.isIdentifier(retireCalls[0].parent.name) ? retireCalls[0].parent.name.text
        : retireCalls[0]?.parent && ts.isBinaryExpression(retireCalls[0].parent)
            && retireCalls[0].parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isIdentifier(retireCalls[0].parent.left) ? retireCalls[0].parent.left.text : null;
    const receiptValidator = isExactCompletedReceiptValidator(
        service.sourceFile, service.checker, delegated.receiptValidator,
    );
    const receiptValidatorSymbol = receiptValidator?.name && service.checker.getSymbolAtLocation(receiptValidator.name);
    const completedGuard = owner.body?.statements.find((statement) => ts.isIfStatement(statement)
        && ts.isPrefixUnaryExpression(unwrap(statement.expression))
        && unwrap(statement.expression).operator === ts.SyntaxKind.ExclamationToken
        && ts.isCallExpression(unwrap(statement.expression).operand)
        && exactIdentifierBinding(service.checker, unwrap(statement.expression).operand.expression, receiptValidatorSymbol)
        && exactArguments(unwrap(statement.expression).operand, [{ identifier: retirement ?? '' }])
        && alwaysTerminates(statement.thenStatement));
    if (!receiptValidator || localBindingExists(owner, delegated.receiptValidator)
        || !completedGuard || !auditCall || !isUnconditionalOwnerCall(owner, retireCalls[0])
        || !isUnconditionalOwnerCall(owner, auditCall) || retireCalls[0].getStart() > completedGuard.getStart()
        || completedGuard.getStart() > auditCall.getStart()) problems.push('completed retirement must be checked before audit');
    const terminal204 = ownerReturns.filter((statement) => {
        const expression = statement.expression && unwrap(statement.expression);
        return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
            && expression.expression.text === 'empty' && expression.arguments.length === 1
            && ts.isNumericLiteral(unwrap(expression.arguments[0])) && Number(unwrap(expression.arguments[0]).text) === 204;
    });
    const auditTry = auditCall?.parent && ts.isAwaitExpression(auditCall.parent)
        && auditCall.parent.parent && ts.isExpressionStatement(auditCall.parent.parent)
        && auditCall.parent.parent.parent && ts.isBlock(auditCall.parent.parent.parent)
        && auditCall.parent.parent.parent.parent && ts.isTryStatement(auditCall.parent.parent.parent.parent)
        ? auditCall.parent.parent.parent.parent : null;
    const guardIndex = owner.body?.statements.indexOf(completedGuard) ?? -1;
    const exactTerminalSequence = guardIndex >= 0
        && owner.body.statements[guardIndex + 1] === auditTry
        && owner.body.statements[guardIndex + 2] === terminal204[0];
    if (!completedGuard || !auditCall || !auditTry?.catchClause || auditTry.catchClause.block.statements.length !== 0
        || auditTry.catchClause.variableDeclaration
        || auditTry.tryBlock.statements.length !== 1 || auditTry.tryBlock.statements[0] !== auditCall.parent.parent
        || auditTry.finallyBlock
        || !terminal204[0] || terminal204.length !== 1 || ownerReturns.at(-1) !== terminal204[0]
        || completedGuard.getStart() > auditCall.getStart() || auditCall.getStart() > terminal204[0].getStart()
        || !exactTerminalSequence) {
        problems.push('completed retirement must contain the awaited audit before one service-owned terminal 204');
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
