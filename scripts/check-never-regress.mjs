#!/usr/bin/env node
/* @Codex */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { NEVER_REGRESS_ALLOWLIST } from './never-regress-allowlist.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const RUNTIME_ROOTS = ['app', 'lib', 'native'];
const RUNTIME_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.swift']);
const SKIPPED_DIRS = new Set([
    '.git',
    '.next',
    '.next-e2e',
    '.next-e2e-smart-import',
    'node_modules',
    'Build',
    '.build',
    'DerivedData',
    'dist',
    'out',
    'coverage',
]);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0', 'host.docker.internal']);
const TELEMETRY_PACKAGES = [
    '@sentry/browser',
    '@sentry/nextjs',
    '@sentry/react',
    '@amplitude/analytics-browser',
    '@segment/analytics-next',
    'analytics-node',
    'mixpanel-browser',
    'posthog-js',
    'rudder-sdk-js',
];

const findings = [];

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main();

function main() {
    const runtimeFiles = collectRuntimeFiles();
    runCredentialLiteralChecks(runtimeFiles);
    runExternalUrlChecks(runtimeFiles);
    runTelemetryChecks(runtimeFiles);
    runZeroKnowledgeChecks(runtimeFiles);
    runLegacyOcrRetirementCheck();
    reportAndExit();
}

/* @Codex */
export function validateLegacyOcrRetirementSource(source) {
    const issues = new Set();
    const sourceFile = ts.createSourceFile(
        'app/api/ocr/extract/route.ts',
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    if (sourceFile.parseDiagnostics.length > 0) issues.add('route source has syntax errors');

    const imports = sourceFile.statements.filter(ts.isImportDeclaration);
    if (imports.length !== 2) issues.add('route must have exactly two static imports');
    if (!imports.some(isCanonicalNextServerImport)) issues.add('Next server import must remain canonical and unaliased');
    if (!imports.some(isCanonicalAuthImport)) issues.add('authentication import must remain canonical and unaliased');

    const handlers = new Map();
    for (const [index, statement] of sourceFile.statements.entries()) {
        if (ts.isImportDeclaration(statement) || (index >= 2 && isInertStringStatement(statement))) continue;
        if (!ts.isFunctionDeclaration(statement) || !statement.name || !['GET', 'POST'].includes(statement.name.text)) {
            issues.add('route may contain only canonical imports, inert strings, GET and POST');
            continue;
        }
        if (handlers.has(statement.name.text)) issues.add(`${statement.name.text} must be declared exactly once`);
        handlers.set(statement.name.text, statement);
    }

    for (const name of ['GET', 'POST']) {
        const handler = handlers.get(name);
        if (!handler) issues.add(`${name} retirement handler is missing`);
        else validateRetirementHandler(handler, name, issues);
    }
    return [...issues];
}

function isCanonicalNamedImport(node, moduleName, expectedNames) {
    if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== moduleName) return false;
    if (node.attributes || node.assertClause) return false;
    const clause = node.importClause;
    if (!clause || clause.isTypeOnly || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false;
    const names = clause.namedBindings.elements;
    if (names.length !== expectedNames.length) return false;
    return expectedNames.every((expected) => names.some((element) => (
        !element.isTypeOnly && !element.propertyName && element.name.text === expected
    )));
}

function isCanonicalNextServerImport(node) {
    return isCanonicalNamedImport(node, 'next/server', ['NextRequest', 'NextResponse']);
}

function isCanonicalAuthImport(node) {
    return isCanonicalNamedImport(node, '@/lib/security/server-auth', ['requireSessionOrLocalToken']);
}

function isInertStringStatement(node) {
    return ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression);
}

function hasModifier(node, kind) {
    return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function validateRetirementHandler(handler, name, issues) {
    if (!hasModifier(handler, ts.SyntaxKind.ExportKeyword) || !hasModifier(handler, ts.SyntaxKind.AsyncKeyword)) {
        issues.add(`${name} must remain an exported async function`);
    }
    if (hasModifier(handler, ts.SyntaxKind.DefaultKeyword) || handler.asteriskToken
        || handler.typeParameters?.length || handler.parameters.length !== 1 || !handler.body) {
        issues.add(`${name} must keep the exact request handler shape`);
        return;
    }
    const parameter = handler.parameters[0];
    const validParameter = ts.isIdentifier(parameter.name)
        && parameter.name.text === 'request'
        && !parameter.initializer
        && !parameter.dotDotDotToken
        && ts.isTypeReferenceNode(parameter.type)
        && ts.isIdentifier(parameter.type.typeName)
        && parameter.type.typeName.text === 'NextRequest';
    if (!validParameter) issues.add(`${name} request parameter must remain canonical`);

    const statements = handler.body.statements;
    if (statements.length !== 3) {
        issues.add(`${name} must contain only authentication, unauthorized denial and retirement denial`);
        return;
    }
    if (!isCanonicalAuthStatement(statements[0])) issues.add(`${name} must await canonical authentication as its first statement`);
    if (!isCanonicalUnauthorizedIf(statements[1])) issues.add(`${name} must keep the exact no-store 401 Unauthorized denial`);
    if (!isCanonicalResponseReturn(statements[2], 410, [
        ['error', 'OCR extraction endpoint retired'],
        ['code', 'OCR_EXTRACTION_RETIRED'],
    ])) issues.add(`${name} must keep the exact no-store 410 OCR_EXTRACTION_RETIRED denial`);
}

function isCanonicalAuthStatement(node) {
    if (!ts.isVariableStatement(node) || (node.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
    const declarations = node.declarationList.declarations;
    if (declarations.length !== 1 || !ts.isIdentifier(declarations[0].name) || declarations[0].name.text !== 'session') return false;
    const awaited = declarations[0].initializer;
    if (!awaited || !ts.isAwaitExpression(awaited) || !ts.isCallExpression(awaited.expression)) return false;
    const call = awaited.expression;
    return ts.isIdentifier(call.expression)
        && call.expression.text === 'requireSessionOrLocalToken'
        && !call.questionDotToken
        && !call.typeArguments?.length
        && call.arguments.length === 1
        && ts.isIdentifier(call.arguments[0])
        && call.arguments[0].text === 'request';
}

function isCanonicalUnauthorizedIf(node) {
    if (!ts.isIfStatement(node) || node.elseStatement) return false;
    const condition = node.expression;
    if (!ts.isPrefixUnaryExpression(condition)
        || condition.operator !== ts.SyntaxKind.ExclamationToken
        || !ts.isIdentifier(condition.operand)
        || condition.operand.text !== 'session') return false;
    return ts.isBlock(node.thenStatement)
        && node.thenStatement.statements.length === 1
        && isCanonicalResponseReturn(node.thenStatement.statements[0], 401, [['error', 'Unauthorized']]);
}

function isCanonicalResponseReturn(node, status, bodyEntries) {
    if (!ts.isReturnStatement(node) || !node.expression || !ts.isCallExpression(node.expression)) return false;
    const call = node.expression;
    if (!ts.isPropertyAccessExpression(call.expression)
        || !ts.isIdentifier(call.expression.expression)
        || call.expression.expression.text !== 'NextResponse'
        || call.expression.name.text !== 'json'
        || call.arguments.length !== 2) return false;
    return isExactStringObject(call.arguments[0], bodyEntries)
        && isExactResponseOptions(call.arguments[1], status);
}

function isExactStringObject(node, entries) {
    if (!ts.isObjectLiteralExpression(node) || node.properties.length !== entries.length) return false;
    return entries.every(([name, value], index) => {
        const property = node.properties[index];
        return ts.isPropertyAssignment(property)
            && ((ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === name)
            && ts.isStringLiteral(property.initializer)
            && property.initializer.text === value;
    });
}

function isExactResponseOptions(node, status) {
    if (!ts.isObjectLiteralExpression(node) || node.properties.length !== 2) return false;
    const [statusProperty, headersProperty] = node.properties;
    return ts.isPropertyAssignment(statusProperty)
        && ts.isIdentifier(statusProperty.name)
        && statusProperty.name.text === 'status'
        && ts.isNumericLiteral(statusProperty.initializer)
        && Number(statusProperty.initializer.text) === status
        && ts.isPropertyAssignment(headersProperty)
        && ts.isIdentifier(headersProperty.name)
        && headersProperty.name.text === 'headers'
        && isExactStringObject(headersProperty.initializer, [['cache-control', 'no-store']]);
}

function runLegacyOcrRetirementCheck() {
    const relativePath = 'app/api/ocr/extract/route.ts';
    const source = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
    for (const issue of validateLegacyOcrRetirementSource(source)) {
        addFinding({
            code: 'NR-OCR-RETIRED',
            file: relativePath,
            line: 1,
            message: issue,
            snippet: 'legacy OCR route retirement boundary',
        });
    }
}

function collectRuntimeFiles() {
    const files = [];
    for (const root of RUNTIME_ROOTS) {
        walkRuntimeTree(path.join(ROOT_DIR, root), files);
    }
    return files;
}

function walkRuntimeTree(currentPath, files) {
    if (!fs.existsSync(currentPath)) return;
    const stat = fs.statSync(currentPath);
    if (!stat.isDirectory()) return;

    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
            walkRuntimeTree(fullPath, files);
            continue;
        }
        if (!entry.isFile()) continue;
        if (!RUNTIME_EXTENSIONS.has(path.extname(entry.name))) continue;
        files.push(fullPath);
    }
}

function runCredentialLiteralChecks(runtimeFiles) {
    const rules = [
        {
            code: 'NR-CRED',
            message: 'Hardcoded username literal in runtime auth path',
            regex: /\busername\s*[:=]\s*["'`][^"'`\r\n]+["'`]/g,
            allowlistKind: 'credentialLiterals',
        },
        {
            code: 'NR-CRED',
            message: 'Hardcoded password literal in runtime auth path',
            regex: /\bpassword\s*[:=]\s*["'`][^"'`\r\n]+["'`]/g,
            allowlistKind: 'credentialLiterals',
        },
        {
            code: 'NR-CRED',
            message: 'Hardcoded PIN literal in runtime auth path',
            regex: /\bpin\s*[:=]\s*["'`][^"'`\r\n]+["'`]/g,
            allowlistKind: 'credentialLiterals',
        },
    ];

    for (const filePath of runtimeFiles) {
        const relativePath = toRelative(filePath);
        const lines = readLines(filePath);
        lines.forEach((line, index) => {
            for (const rule of rules) {
                rule.regex.lastIndex = 0;
                const matches = Array.from(line.matchAll(rule.regex));
                for (const match of matches) {
                    if (match[0].includes('local-api')) continue;
                    if (isAllowlisted(rule.allowlistKind, relativePath, line)) continue;
                    addFinding({
                        code: rule.code,
                        file: relativePath,
                        line: index + 1,
                        message: rule.message,
                        snippet: match[0],
                    });
                }
            }
        });
    }
}

function runExternalUrlChecks(runtimeFiles) {
    const urlRegex = /https?:\/\/[^\s"'`)>]+/g;

    for (const filePath of runtimeFiles) {
        const relativePath = toRelative(filePath);
        if (relativePath.startsWith('lib/fhir/')) continue;
        const lines = readLines(filePath);
        lines.forEach((line, index) => {
            if (line.includes('system:')) return;
            if (line.includes('href=')) return;

            const matches = Array.from(line.matchAll(urlRegex));
            for (const match of matches) {
                const rawUrl = match[0];
                let parsed;
                try {
                    parsed = new URL(rawUrl);
                } catch {
                    continue;
                }

                if (LOCAL_HOSTS.has(parsed.hostname)) continue;
                if (isAllowlisted('externalUrls', relativePath, line)) continue;

                addFinding({
                    code: 'NR-EGRESS',
                    file: relativePath,
                    line: index + 1,
                    message: 'Non-local runtime URL literal requires explicit allowlist or redesign',
                    snippet: rawUrl,
                });
            }
        });
    }
}

function runTelemetryChecks(runtimeFiles) {
    const packageJsonPath = path.join(ROOT_DIR, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const dependencies = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
    };

    for (const packageName of TELEMETRY_PACKAGES) {
        if (dependencies[packageName]) {
            addFinding({
                code: 'NR-TELEMETRY',
                file: 'package.json',
                line: 1,
                message: 'Telemetry/analytics dependency present in repository',
                snippet: packageName,
            });
        }
    }

    const importRegex = new RegExp(
        String.raw`(?:from\s+['"]|require\(\s*['"]|import\(\s*['"])(${TELEMETRY_PACKAGES.map(escapeRegex).join('|')})['"]`,
        'g',
    );

    for (const filePath of runtimeFiles) {
        const relativePath = toRelative(filePath);
        const lines = readLines(filePath);
        lines.forEach((line, index) => {
            importRegex.lastIndex = 0;
            const matches = Array.from(line.matchAll(importRegex));
            for (const match of matches) {
                addFinding({
                    code: 'NR-TELEMETRY',
                    file: relativePath,
                    line: index + 1,
                    message: 'Telemetry/analytics import detected in runtime code',
                    snippet: match[1],
                });
            }
        });
    }
}

function runZeroKnowledgeChecks(runtimeFiles) {
    const requiredChecks = [
        {
            file: 'lib/schema.ts',
            token: "encryptedMasterKey: text('encrypted_master_key').notNull()",
            message: 'Users schema must keep encrypted master key as required field',
        },
        {
            file: 'lib/schema.ts',
            token: "salt: text('salt').notNull()",
            message: 'Users schema must keep salt as required field',
        },
        {
            file: 'app/api/auth/setup/route.ts',
            token: 'const { username, password, encryptedMasterKey, salt',
            message: 'Setup flow must accept encrypted master key and salt',
        },
        {
            // WUL zod boundary (STREAM G) moved setup validation from an imperative
            // `if (!username || !password || !encryptedMasterKey || !salt)` guard to
            // a zod schema parsed via parseApiBody. The zero-knowledge invariant is
            // now enforced by authSetupSchema requiring encryptedMasterKey and salt;
            // assert that mechanism is wired instead of the removed literal guard.
            file: 'app/api/auth/setup/route.ts',
            token: 'parseApiBody(authSetupSchema',
            message: 'Setup flow must validate the body through authSetupSchema (which requires encrypted master key and salt)',
        },
        {
            file: 'lib/api-schemas/auth.ts',
            token: 'encryptedMasterKey: requiredTextSchema',
            message: 'authSetupSchema must reject a missing/empty encrypted master key',
        },
        {
            file: 'lib/api-schemas/auth.ts',
            token: 'salt: requiredTextSchema',
            message: 'authSetupSchema must reject a missing/empty salt',
        },
        {
            file: 'app/api/auth/login/route.ts',
            token: 'encryptedMasterKey: user.encryptedMasterKey',
            message: 'Login flow must return encrypted master key for local unlock',
        },
        {
            file: 'app/api/auth/login/route.ts',
            token: 'salt: user.salt',
            message: 'Login flow must return salt for local unlock',
        },
        {
            file: 'lib/security/security.ts',
            token: "'PBKDF2'",
            message: 'Zero-knowledge flow must keep PBKDF2 key derivation',
        },
        {
            file: 'lib/security/security.ts',
            token: "'AES-GCM'",
            message: 'Zero-knowledge flow must keep AES-GCM wrapping/encryption',
        },
        {
            file: 'lib/security/security.ts',
            token: 'localStorage.setItem(SECURITY_CONFIG.PIN_SALT_KEY',
            message: 'Security storage must persist salt explicitly',
        },
        {
            file: 'lib/security/security.ts',
            token: 'localStorage.setItem(SECURITY_CONFIG.ENCRYPTED_MASTER_KEY',
            message: 'Security storage must persist encrypted master key explicitly',
        },
    ];

    for (const check of requiredChecks) {
        const filePath = path.join(ROOT_DIR, check.file);
        const contents = fs.readFileSync(filePath, 'utf8');
        if (!contents.includes(check.token)) {
            addFinding({
                code: 'NR-ZK',
                file: check.file,
                line: 1,
                message: check.message,
                snippet: check.token,
            });
        }
    }

    const persistedPinRegex = /\b(?:localStorage|sessionStorage)\.setItem\([^,\n]+,\s*[^)\n]*\b(pin|password)\b/i;
    for (const filePath of runtimeFiles) {
        if (!filePath.includes(`${path.sep}app${path.sep}`) && !filePath.includes(`${path.sep}lib${path.sep}`)) continue;
        const relativePath = toRelative(filePath);
        const lines = readLines(filePath);
        lines.forEach((line, index) => {
            if (!persistedPinRegex.test(line)) return;
            addFinding({
                code: 'NR-ZK',
                file: relativePath,
                line: index + 1,
                message: 'PIN/password must not be persisted in browser storage',
                snippet: line.trim(),
            });
        });
    }

    const localValidationChecks = [
        {
            file: 'app/api/icd/proxy/route.ts',
            token: 'validateLocalTarget(ICD_LOCAL_URL)',
            message: 'ICD proxy must validate configured local endpoint before fetching',
        },
        {
            file: 'app/api/proxy/ollama/chat/route.ts',
            token: 'attestLocalOllamaModel(baseUrl, body?.model, req.signal)',
            message: 'Ollama chat proxy must attest the selected local model before forwarding',
        },
        {
            file: 'app/api/proxy/ollama/chat/route.ts',
            token: 'assertLocalOllamaResponse(data, attestation)',
            message: 'Ollama chat proxy must reject responses that violate its local attestation',
        },
        {
            file: 'app/api/proxy/ollama/generate/route.ts',
            token: 'attestLocalOllamaModel(baseUrl, body?.model, req.signal)',
            message: 'Ollama generate proxy must attest the selected local model before forwarding',
        },
        {
            file: 'app/api/proxy/ollama/generate/route.ts',
            token: 'assertLocalOllamaResponse(data, attestation)',
            message: 'Ollama generate proxy must reject responses that violate its local attestation',
        },
        {
            file: 'app/api/ai/models/route.ts',
            token: '.filter(isLocalOllamaModelDescriptor)',
            message: 'Ollama model discovery must exclude remote model descriptors',
        },
        {
            file: 'app/api/ai/pull/route.ts',
            token: "new OllamaLocalityError('model_pull_disabled')",
            message: 'Ollama model pull must remain disabled in the local-only clinical lane',
        },
    ];

    for (const check of localValidationChecks) {
        const filePath = path.join(ROOT_DIR, check.file);
        const contents = fs.readFileSync(filePath, 'utf8');
        if (!contents.includes(check.token)) {
            addFinding({
                code: 'NR-EGRESS',
                file: check.file,
                line: 1,
                message: check.message,
                snippet: check.token,
            });
        }
    }
}

function isAllowlisted(kind, relativePath, line) {
    const entries = NEVER_REGRESS_ALLOWLIST[kind] || [];
    return entries.some((entry) => {
        if (entry.path !== relativePath) return false;
        return new RegExp(entry.pattern).test(line);
    });
}

function readLines(filePath) {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function toRelative(filePath) {
    return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function addFinding(finding) {
    findings.push(finding);
}

function reportAndExit() {
    if (findings.length === 0) {
        console.log('check:never-regress passed');
        console.log(`Scanned ${RUNTIME_ROOTS.join(', ')} for default creds, egress drift, telemetry, and zero-knowledge invariants.`);
        process.exit(0);
    }

    console.error(`check:never-regress failed with ${findings.length} finding(s):`);
    for (const finding of findings) {
        console.error(`- [${finding.code}] ${finding.file}:${finding.line} ${finding.message}`);
        console.error(`  ${finding.snippet}`);
    }
    process.exit(1);
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
