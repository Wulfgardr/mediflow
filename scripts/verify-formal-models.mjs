#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const TLA_RELEASE = 'v1.7.4';
const TLA_URL = 'https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar';
const TLA_SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function externalDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true });
    const real = fs.realpathSync(directory);
    for (const forbidden of [ROOT, path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Desktop')]) {
        if (real === forbidden || real.startsWith(forbidden + path.sep)) {
            throw new Error(`Formal artifacts must stay outside the repository and synchronized folders: ${real}`);
        }
    }
    return real;
}

async function resolveTlaJar() {
    for (const candidate of [
        process.env.TLA_JAR,
        path.join(os.homedir(), '.codex/tools/tlaplus/1.7.4/tla2tools.jar'),
        path.join(process.env.MEDIFLOW_TLA_CACHE || path.join(os.homedir(), '.cache/mediflow-formal/tla', TLA_RELEASE), 'tla2tools.jar'),
    ]) {
        if (candidate && fs.existsSync(candidate)) {
            if (sha256(fs.readFileSync(candidate)) !== TLA_SHA256) {
                throw new Error(`TLC jar hash mismatch at ${candidate}; expected pinned v1.7.4 / TLC 2.19`);
            }
            return candidate;
        }
    }
    const cacheDir = externalDirectory(process.env.MEDIFLOW_TLA_CACHE || path.join(os.homedir(), '.cache/mediflow-formal/tla', TLA_RELEASE));
    const cachedJar = path.join(cacheDir, 'tla2tools.jar');
    const response = await fetch(TLA_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Official TLC download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== TLA_SHA256) throw new Error('Downloaded TLC jar hash mismatch');
    fs.writeFileSync(cachedJar, bytes, { flag: 'wx' });
    return cachedJar;
}

function verifyCoverageHashes(coveragePath) {
    const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    const ordered = Object.entries(coverage.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const expectedFilesHash = sha256(ordered.map(([file, digest]) => `${file}\t${digest}\n`).join(''));
    if (coverage.filesSha256 !== expectedFilesHash) {
        throw new Error(`Formal coverage manifest mismatch in ${path.relative(ROOT, coveragePath)}.`);
    }
    for (const [file, digest] of ordered) {
        const actual = sha256(fs.readFileSync(path.join(ROOT, file)));
        if (actual !== digest) {
            throw new Error(
                `Formal coverage drift in ${file} (covered by ${path.relative(ROOT, coveragePath)}). `
                + 'Review transitions and assumptions against the TLA+ model before updating coverage.json.',
            );
        }
    }
    return coverage;
}

function runCommand(outputDir, name, executable, args, expected, env = {}) {
    const started = performance.now();
    const res = spawnSync(executable, args, {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, ...env, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' },
    });
    const log = `${res.stdout || ''}${res.stderr || ''}`;
    fs.writeFileSync(path.join(outputDir, `${name}.log`), log);
    if (res.error || !expected(res.status, log)) {
        process.stderr.write(`${log.slice(-8000)}\n`);
        throw new Error(`${name} failed (exit ${res.status}, ${res.error?.message || 'unexpected outcome'}). Log: ${path.join(outputDir, `${name}.log`)}`);
    }
    const counts = /([\d,]+) states generated, ([\d,]+) distinct states found, ([\d,]+) states left on queue/.exec(log);
    const elapsedMs = Math.round(performance.now() - started);
    console.log(`${name}: PASS (${elapsedMs} ms${counts ? `, ${counts[2]} distinct states` : ''})`);
    return log;
}

function runTlc(jar, outputDir, name, { modelDir, tlaFile, configText, deadlock = true, expectViolation = null }) {
    const work = path.join(outputDir, name);
    fs.mkdirSync(work, { recursive: true });
    const targetTla = path.join(work, tlaFile);
    const targetCfg = path.join(work, 'MC.cfg');
    fs.copyFileSync(path.join(modelDir, tlaFile), targetTla);
    fs.writeFileSync(targetCfg, configText);
    const args = [
        '-XX:+UseParallelGC', '-Xmx512m', '-cp', jar, 'tlc2.TLC',
        '-workers', '1', '-seed', '1', '-metadir', path.join(work, 'states'),
        ...(deadlock ? [] : ['-deadlock']),
        '-config', targetCfg, targetTla,
    ];
    return runCommand(outputDir, name, process.env.JAVA || 'java', args, (status, log) => {
        if (expectViolation) {
            const isInvariant = log.includes(`Invariant ${expectViolation} is violated.`);
            const isProperty = log.includes(`Action property ${expectViolation} is violated.`);
            const expectedStatus = isProperty ? 13 : 12;
            return status === expectedStatus && (isInvariant || isProperty) && log.includes('The behavior up to this point is:');
        }
        return status === 0 && log.includes('Model checking completed. No error has been found.') && /0 states left on queue/.test(log);
    });
}

function runAmbulatoryPr943CodeMutant(outputDir, dataDir) {
    const scratch = path.join(outputDir, 'code-mutant-pr943');
    const secDir = path.join(scratch, 'lib', 'security');
    fs.mkdirSync(secDir, { recursive: true });
    for (const rel of ['lib', 'packages']) {
        fs.cpSync(path.join(ROOT, rel), path.join(scratch, rel), { recursive: true });
    }
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(scratch, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const servicePath = path.join(secDir, 'ambulatory-destructive-service.ts');
    const original = fs.readFileSync(servicePath, 'utf8');
    const target = 'if (controlIsIdle(flow.controlId)) flows.delete(reference);';
    if (!original.includes(target)) {
        throw new Error('PR #943 code mutant anchor drifted in lib/security/ambulatory-destructive-service.ts');
    }
    const mutated = original.replace(
        target,
        "if (flow.webId !== null && resolve(flow.webId, flow.controlId).status === 'active') continue; flows.delete(reference);",
    );
    fs.writeFileSync(servicePath, mutated);
    const testFile = path.join(secDir, 'ambulatory-destructive-capacity.test.ts');
    const mutantData = path.join(dataDir, 'pr943-mutant');
    fs.mkdirSync(mutantData, { recursive: true });
    runCommand(
        outputDir,
        'ambulatory-flow-code-mutant-pr943',
        process.execPath,
        ['scripts/run-strip-types.mjs', '--test', '--test-reporter=tap', testFile],
        (status, log) => status === 1 && log.includes('ERR_ASSERTION'),
        { MEDIFLOW_DATA_DIR: mutantData },
    );
}

async function main() {
    const jar = await resolveTlaJar();
    const outputDir = externalDirectory(process.env.MEDIFLOW_FORMAL_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-formal-models-')));
    const dataDir = path.join(outputDir, 'synthetic-data');
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Formal verification artifacts: ${outputDir}`);

    const flowDir = path.join(ROOT, 'docs/formal/ambulatory-destructive-flow');
    verifyCoverageHashes(path.join(flowDir, 'coverage.json'));
    const flowCfg = fs.readFileSync(path.join(flowDir, 'MC.cfg'), 'utf8');
    runTlc(jar, outputDir, 'ambulatory-flow-current', { modelDir: flowDir, tlaFile: 'AmbulatoryDestructiveFlow.tla', configText: flowCfg });
    runTlc(jar, outputDir, 'ambulatory-flow-mutant-pr943-webid', {
        modelDir: flowDir,
        tlaFile: 'AmbulatoryDestructiveFlow.tla',
        configText: flowCfg
            .replace('CheckFlowWebIdOnly = FALSE', 'CheckFlowWebIdOnly = TRUE')
            .replace(/INVARIANTS[\s\S]*/, 'INVARIANT NoOrphanedActiveSession\n'),
        expectViolation: 'NoOrphanedActiveSession',
    });
    runTlc(jar, outputDir, 'ambulatory-flow-mutant-pr943-skiplock', {
        modelDir: flowDir,
        tlaFile: 'AmbulatoryDestructiveFlow.tla',
        configText: flowCfg
            .replace('SkipControlLockOnPrune = FALSE', 'SkipControlLockOnPrune = TRUE')
            .replace(/INVARIANTS[\s\S]*/, 'INVARIANT NoSessionBornAfterPrune\n'),
        expectViolation: 'NoSessionBornAfterPrune',
    });
    for (const witness of ['NoActiveRetireWitness', 'NoPruneAfterPendingLoginWitness']) {
        runTlc(jar, outputDir, `ambulatory-flow-reach-${witness}`, {
            modelDir: flowDir,
            tlaFile: 'AmbulatoryDestructiveFlow.tla',
            configText: flowCfg.replace(/INVARIANTS[\s\S]*/, `INVARIANT ${witness}\n`),
            expectViolation: witness,
        });
    }
    const flowData = path.join(dataDir, 'flow');
    fs.mkdirSync(flowData, { recursive: true });
    runCommand(
        outputDir,
        'ambulatory-flow-code-current',
        process.execPath,
        ['scripts/run-strip-types.mjs', '--test', '--test-reporter=tap', 'lib/security/ambulatory-destructive-capacity.test.ts'],
        (status, log) => status === 0 && /# fail 0/.test(log),
        { MEDIFLOW_DATA_DIR: flowData },
    );
    runAmbulatoryPr943CodeMutant(outputDir, dataDir);

    const unlockDir = path.join(ROOT, 'docs/formal/agent-unlock');
    const unlockCfg = fs.readFileSync(path.join(unlockDir, 'MC.cfg'), 'utf8');
    runTlc(jar, outputDir, 'agent-unlock-current', { modelDir: unlockDir, tlaFile: 'AgentUnlock.tla', configText: unlockCfg, deadlock: false });
    runTlc(jar, outputDir, 'agent-unlock-mutant-ignore-lock', {
        modelDir: unlockDir,
        tlaFile: 'AgentUnlock.tla',
        configText: unlockCfg.replace('IgnoreLock = FALSE', 'IgnoreLock = TRUE'),
        deadlock: false,
        expectViolation: 'NoUnauthorizedDeposit',
    });
    runTlc(jar, outputDir, 'agent-unlock-reach-NoSharedWitness', {
        modelDir: unlockDir,
        tlaFile: 'AgentUnlock.tla',
        configText: unlockCfg.replace(/INVARIANTS[\s\S]*/, 'INVARIANT NoSharedWitness\n'),
        deadlock: false,
        expectViolation: 'NoSharedWitness',
    });
    const unlockData = path.join(dataDir, 'unlock');
    fs.mkdirSync(unlockData, { recursive: true });
    runCommand(
        outputDir,
        'agent-unlock-code-current',
        process.execPath,
        ['scripts/run-strip-types.mjs', '--test', '--test-reporter=tap', 'lib/agent-registration-store.test.ts'],
        (status, log) => status === 0 && /# fail 0/.test(log),
        { MEDIFLOW_DATA_DIR: unlockData },
    );

    const confirmDir = path.join(ROOT, 'docs/formal/agent-visit-confirmation');
    const confirmCfg = fs.readFileSync(path.join(confirmDir, 'MC.cfg'), 'utf8');
    runTlc(jar, outputDir, 'visit-confirmation-current', { modelDir: confirmDir, tlaFile: 'VisitConfirmation.tla', configText: confirmCfg });
    runTlc(jar, outputDir, 'visit-confirmation-mutant-binding', {
        modelDir: confirmDir,
        tlaFile: 'VisitConfirmation.tla',
        configText: confirmCfg.replace('CheckBinding = TRUE', 'CheckBinding = FALSE'),
        expectViolation: 'BoundCommit',
    });
    runTlc(jar, outputDir, 'visit-confirmation-mutant-consumption', {
        modelDir: confirmDir,
        tlaFile: 'VisitConfirmation.tla',
        configText: confirmCfg.replace('CheckConsumption = TRUE', 'CheckConsumption = FALSE'),
        expectViolation: 'OnceAndAtomic',
    });
    runTlc(jar, outputDir, 'visit-confirmation-reach-Reachable', {
        modelDir: confirmDir,
        tlaFile: 'VisitConfirmation.tla',
        configText: confirmCfg.replace(/INVARIANTS[\s\S]*/, 'INVARIANT Reachable\nCHECK_DEADLOCK FALSE\n'),
        expectViolation: 'Reachable',
    });
    const confirmData = path.join(dataDir, 'confirm');
    fs.mkdirSync(confirmData, { recursive: true });
    runCommand(
        outputDir,
        'visit-confirmation-code-current',
        process.execPath,
        ['scripts/run-strip-types.mjs', '--test', '--test-reporter=tap', 'lib/agent-visit-application.test.ts'],
        (status, log) => status === 0 && /# fail 0/.test(log),
        { MEDIFLOW_DATA_DIR: confirmData },
    );

    console.log('All formal models, bug-replay mutants, witnesses, and runtime proofs passed.');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
