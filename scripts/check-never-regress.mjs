#!/usr/bin/env node
/* @Codex */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

main();

function main() {
    const runtimeFiles = collectRuntimeFiles();
    runCredentialLiteralChecks(runtimeFiles);
    runExternalUrlChecks(runtimeFiles);
    runTelemetryChecks(runtimeFiles);
    runZeroKnowledgeChecks(runtimeFiles);
    reportAndExit();
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
            file: 'app/api/ocr/extract/route.ts',
            token: 'validateLocalTarget(baseUrl)',
            message: 'OCR availability probe must validate configured local endpoint before fetching',
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
