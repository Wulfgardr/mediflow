#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSON_SCHEMA, load } from 'js-yaml';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const EXEMPT_CI_GUARDS = Object.freeze({
    'check:standalone-runtime-bundle': 'Runs via package.json postbuild during npm run build in web-core.yml and e2e.yml.',
    'check:terminology-parity': 'Split across three CI phases: web-core.yml (test:unit), e2e.yml (test:network:home-base-catalog-read), and apple-native.yml (assert-apple-terminology-tests.sh).',
    'check:web-auth-lifecycle-owner-boundary': 'All four boundary test files run unconditionally in npm run test:unit (web-core.yml).',
    'verify:local-operation': 'Local TLA+/TLC formal verifier pending shared TLC setup in web-core.yml.',
    'verify:specialist-operation': 'Local specialist vertical verifier requiring TLC and browser runtime.',
});

function isDisabled(condition) {
    if (condition === false) return true;
    return typeof condition === 'string' && /^(?:false|\$\{\{\s*false\s*\}\})$/u.test(condition.trim());
}

function extractNpmRuns(runScript) {
    const scripts = new Set();
    if (typeof runScript !== 'string') return scripts;
    for (const rawLine of runScript.split(/\r?\n/u)) {
        const trimmed = rawLine.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const codePart = trimmed.replace(/(?:^|\s)#.*$/u, '');
        for (const match of codePart.matchAll(/\bnpm\s+run\s+([A-Za-z0-9_][A-Za-z0-9:_-]*)(?=$|\s|&&|;|\|)/gu)) {
            scripts.add(match[1]);
        }
    }
    return scripts;
}

export function collectWiredCiScripts(root) {
    const workflowsDir = path.join(root, '.github', 'workflows');
    const wired = new Set();
    if (!fs.existsSync(workflowsDir)) return wired;
    for (const entry of fs.readdirSync(workflowsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue;
        const parsed = load(fs.readFileSync(path.join(workflowsDir, entry.name), 'utf8'), { schema: JSON_SCHEMA });
        if (!parsed || typeof parsed !== 'object' || !parsed.jobs || typeof parsed.jobs !== 'object') continue;
        for (const job of Object.values(parsed.jobs)) {
            if (!job || typeof job !== 'object' || isDisabled(job.if) || job['continue-on-error'] === true) continue;
            if (!Array.isArray(job.steps)) continue;
            for (const step of job.steps) {
                if (!step || typeof step !== 'object' || isDisabled(step.if) || step['continue-on-error'] === true) continue;
                for (const name of extractNpmRuns(step.run)) wired.add(name);
            }
        }
    }
    return wired;
}

export function checkCiGuardsWired(root, exemptions = EXEMPT_CI_GUARDS) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const scripts = pkg.scripts ?? {};
    const guardScripts = Object.keys(scripts)
        .filter((name) => name.startsWith('check:') || name.startsWith('verify:'))
        .sort();
    const wired = collectWiredCiScripts(root);
    const errors = [];

    for (const name of guardScripts) {
        const isWired = wired.has(name);
        const hasExemption = Object.hasOwn(exemptions, name);
        if (!isWired && !hasExemption) {
            const targetWorkflow = name.startsWith('verify:')
                ? '.github/workflows/web-core.yml'
                : '.github/workflows/openapi-contract-guard.yml';
            errors.push(
                `UNWIRED_GUARD: ${name} is defined in package.json but never invoked in .github/workflows/*.yml. `
                + `Add "npm run ${name}" to ${targetWorkflow}, or document why it is indirect/local-only in `
                + 'scripts/check-ci-guards-wired.mjs (EXEMPT_CI_GUARDS).',
            );
        }
        if (isWired && hasExemption) {
            errors.push(
                `REDUNDANT_EXEMPTION: ${name} is now wired in CI. Remove it from EXEMPT_CI_GUARDS in `
                + 'scripts/check-ci-guards-wired.mjs.',
            );
        }
    }

    for (const name of Object.keys(exemptions)) {
        if (!guardScripts.includes(name)) {
            errors.push(
                `STALE_EXEMPTION: ${name} in EXEMPT_CI_GUARDS does not match any check:* or verify:* script in package.json.`,
            );
        }
    }

    return { guardCount: guardScripts.length, wiredCount: guardScripts.filter((name) => wired.has(name)).length, errors };
}

function main() {
    const result = checkCiGuardsWired(ROOT_DIR);
    if (result.errors.length > 0) {
        process.stderr.write(`${result.errors.join('\n')}\n`);
        process.exit(1);
    }
    console.log(`CI guard wiring: ${result.wiredCount}/${result.guardCount} check/verify scripts wired in workflows.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
