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
    { route: 'app/api/auth/logout/route.ts', events: ['auth.logout'], reason: 'auth logout must stay auditable' },
    { route: 'app/api/auth/change-pin/route.ts', events: ['settings.updated'], reason: 'PIN rotation is an administrative settings mutation' },
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
    { route: 'app/api/prosthetic-prescriptions/route.ts', events: ['prosthetic.prescription.created'], reason: 'prosthetic prescription creation is sensitive CRUD' },
    { route: 'app/api/prosthetic-prescriptions/[id]/route.ts', events: ['prosthetic.prescription.updated', 'prosthetic.prescription.deleted'], reason: 'prosthetic prescription update/delete are sensitive CRUD' },
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

function isReachableStandaloneCall(call, owner) {
    let current = call;
    while (ts.isAwaitExpression(current.parent) || ts.isParenthesizedExpression(current.parent)) current = current.parent;
    if (!ts.isExpressionStatement(current.parent)) return false;
    let child = current.parent;
    for (let parent = child.parent; parent && parent !== owner; child = parent, parent = parent.parent) {
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

/* @Codex */
export function validateAuditWriterControlFlow({
    source,
    fileName = 'fixture.ts',
    ownerName,
    writerModule,
    writerExport,
    eventType,
    writerArgumentIndex = 0,
    dependencyFallback = null,
}) {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
    checkPhiSafeMetadata(findings);

    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: findings.length === 0 ? 'pass' : 'fail',
        checked: {
            routes: REQUIRED_ROUTE_AUDIT.length,
            requiredEvents: REQUIRED_EVENT_TYPES.size,
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
