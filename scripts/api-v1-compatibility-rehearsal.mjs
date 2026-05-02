/* @Codex */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const SPEC_PATH = 'docs/openapi/mediflow-v1.yaml';
const POLICY_PATH = 'docs/openapi/contract-policy.json';
const ROUTE_ROOT = 'app/api/v1';
const SENSITIVE_PREFIXES = [
    'app/api/v1/',
    'lib/api/v1/',
    'native/',
    'docs/openapi/',
    'scripts/check-openapi-drift.mjs',
    'scripts/api-v1-compatibility-rehearsal.mjs',
    'package.json'
];
const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SPEC_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function parseArgs(argv) {
    const options = {
        baseRef: process.env.MEDIFLOW_OPENAPI_BASE_REF || 'main',
        out: process.env.MEDIFLOW_API_V1_REHEARSAL_OUT || 'tmp-api-v1-compatibility-rehearsal.md'
    };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--base-ref' && argv[index + 1]) {
            options.baseRef = argv[index + 1];
            index += 1;
        } else if (argv[index] === '--out' && argv[index + 1]) {
            options.out = argv[index + 1];
            index += 1;
        }
    }
    return options;
}

function git(args, options = {}) {
    try {
        return execFileSync('git', args, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
    } catch (error) {
        if (options.allowFailure) return null;
        throw error;
    }
}

function command(args, options = {}) {
    try {
        const stdout = execFileSync(args[0], args.slice(1), {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return { ok: true, output: stdout.trim() };
    } catch (error) {
        const output = [
            error.stdout?.toString().trim(),
            error.stderr?.toString().trim()
        ].filter(Boolean).join('\n');
        if (options.allowFailure) return { ok: false, output };
        throw error;
    }
}

function routeFileToPath(filePath) {
    const relativePath = path.relative(ROUTE_ROOT, filePath);
    const directory = path.dirname(relativePath);
    if (directory === '.') return '/api/v1';
    return `/api/v1/${directory.split(path.sep).map((segment) => (
        segment.startsWith('[') && segment.endsWith(']')
            ? `{${segment.slice(1, -1)}}`
            : segment
    )).join('/')}`;
}

function* walkRoutes(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* walkRoutes(entryPath);
            continue;
        }
        if (entry.isFile() && entry.name === 'route.ts') yield entryPath;
    }
}

function extractMethods(source) {
    return ROUTE_METHODS.filter((method) => (
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(source)
    ));
}

function currentRouteOperations() {
    const operations = [];
    for (const filePath of walkRoutes(path.join(ROOT, ROUTE_ROOT))) {
        const relativePath = path.relative(ROOT, filePath);
        const source = fs.readFileSync(filePath, 'utf8');
        for (const method of extractMethods(source)) {
            operations.push(`${method} ${routeFileToPath(relativePath)}`);
        }
    }
    return operations.sort();
}

function documentedOperations(spec) {
    const operations = [];
    for (const [apiPath, pathItem] of Object.entries(spec.paths ?? {})) {
        for (const method of SPEC_METHODS) {
            if (pathItem?.[method]) operations.push(`${method.toUpperCase()} ${apiPath}`);
        }
    }
    return operations.sort();
}

function policyOperations(policy) {
    const operations = [];
    for (const entry of policy.undocumentedOperations ?? []) {
        for (const method of entry.methods ?? []) {
            operations.push(`${method} ${entry.path} (${entry.trackingIssue})`);
        }
    }
    return operations.sort();
}

function changedFiles(baseRef) {
    const files = new Set();
    const outputs = [
        git(['diff', '--name-only', `${baseRef}...HEAD`], { allowFailure: true }),
        git(['diff', '--name-only', 'HEAD'], { allowFailure: true }),
        git(['ls-files', '--others', '--exclude-standard'], { allowFailure: true })
    ];
    for (const output of outputs) {
        for (const file of (output ?? '').split('\n').filter(Boolean)) {
            files.add(file);
        }
    }
    return [...files].sort();
}

function markdownList(items) {
    if (items.length === 0) return '- none';
    return items.map((item) => `- ${item}`).join('\n');
}

function classifyChange(guardOk, sensitiveFiles) {
    if (!guardOk) {
        return 'migration-required-or-breaking: the OpenAPI drift guard failed, so the branch needs a migration plan, spec/policy correction, or explicit breaking override before review.';
    }
    if (sensitiveFiles.length === 0) {
        return 'no-contract-impact: no `/api/v1` route, DTO, native client, OpenAPI, or contract-guard file changed since the selected base.';
    }
    const runtimeContractTouched = sensitiveFiles.some((file) => (
        file.startsWith('app/api/v1/')
        || file.startsWith('lib/api/v1/')
        || file.startsWith('native/')
        || file === SPEC_PATH
        || file === POLICY_PATH
        || file === 'scripts/check-openapi-drift.mjs'
    ));
    if (!runtimeContractTouched) {
        return 'tooling-only: rehearsal tooling or documentation changed, while the runtime `/api/v1` contract stayed untouched.';
    }
    return 'non-breaking-or-policy-covered: contract-sensitive files changed, but the OpenAPI drift guard found no untracked breaking change.';
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const spec = yaml.load(fs.readFileSync(path.join(ROOT, SPEC_PATH), 'utf8'));
    const policy = JSON.parse(fs.readFileSync(path.join(ROOT, POLICY_PATH), 'utf8'));
    const guard = command(['node', 'scripts/check-openapi-drift.mjs', '--base-ref', options.baseRef], { allowFailure: true });
    const files = changedFiles(options.baseRef);
    const sensitiveFiles = files.filter((file) => SENSITIVE_PREFIXES.some((prefix) => file.startsWith(prefix)));
    const routeOps = currentRouteOperations();
    const specOps = documentedOperations(spec);
    const policyOps = policyOperations(policy);
    const classification = classifyChange(guard.ok, sensitiveFiles);
    const now = new Date().toISOString();
    const head = git(['rev-parse', '--short', 'HEAD']);
    const base = git(['rev-parse', '--short', options.baseRef], { allowFailure: true }) ?? options.baseRef;

    const body = `# API v1 Compatibility Rehearsal Ledger

Generated: ${now}

## Scope

- Base ref: \`${options.baseRef}\` (${base})
- Head: \`${head}\`
- Contract: \`${SPEC_PATH}\` version \`${spec.info?.version ?? 'unknown'}\`
- Guard command: \`node scripts/check-openapi-drift.mjs --base-ref ${options.baseRef}\`
- Result: ${guard.ok ? '`passed`' : '`failed`'}

## Guard Output

\`\`\`text
${guard.output || '(no output)'}
\`\`\`

## Current Coverage

- Implemented route operations: ${routeOps.length}
- Documented stable OpenAPI operations: ${specOps.length}
- Policy-covered implementation-only operations: ${policyOps.length}
- Breaking overrides: ${(policy.breakingOverrides ?? []).length}

## Sensitive Diff Since Base

${markdownList(sensitiveFiles)}

## Change Classification

${classification}

## Compatibility Decision

${guard.ok
        ? 'No untracked breaking `/api/v1` contract change was detected by the guard. Any implementation-only `/api/v1` operation is represented in the compatibility policy ledger.'
        : 'The rehearsal failed. Treat this branch as not review-ready until every guard finding is resolved or explicitly justified in `docs/openapi/contract-policy.json` with its Linear issue.'}
`;

    fs.mkdirSync(path.dirname(path.join(ROOT, options.out)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, options.out), body);
    process.stdout.write(`${body}\n`);
    if (!guard.ok) process.exit(1);
}

main();
