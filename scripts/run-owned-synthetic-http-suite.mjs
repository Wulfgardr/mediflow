import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localTestCommands } from './local-test-selection.mjs';
import { assertNodeRuntime, readNodeContract } from './node-runtime-contract.mjs';

export const OWNED_HTTP_FILES = Object.freeze([
    "scripts/api-v1-put-negative-routes-test.sh",
    "scripts/api-v1-put-negative-routes.test.mjs",
    "scripts/legacy-clinical-writes-test.sh",
    "scripts/legacy-clinical-writes.test.mjs",
    "scripts/mediflow-headless-supervisor-standalone-smoke.mjs",
    "scripts/network-home-base-account-pin.test.mjs",
    "scripts/network-home-base-aggregate-read.test.mjs",
    "scripts/network-home-base-ambulatory-write.test.mjs",
    "scripts/network-home-base-catalog-read.test.mjs",
    "scripts/network-home-base-checkup-write.test.mjs",
    "scripts/network-home-base-diary-write.test.mjs",
    "scripts/network-home-base-discovery-read.test.mjs",
    "scripts/network-home-base-documents-write.test.mjs",
    "scripts/network-home-base-observation-write.test.mjs",
    "scripts/network-home-base-patient-lifecycle-write.test.mjs",
    "scripts/network-home-base-prescriptions-write.test.mjs",
    "scripts/network-home-base-readonly.test.mjs",
    "scripts/network-home-base-therapy-write.test.mjs",
    "scripts/network-home-base-write.test.mjs",
    "scripts/patient-concurrency.test.mjs"
]);
export const SUPERVISOR_HTTP_FILE = 'scripts/mediflow-headless-supervisor-standalone-smoke.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));

// Use the real registry recipe; a wrapper and its child share one invocation.
export function ownedHttpInvocations(directory, standalone = false) {
    const recipes = localTestCommands(directory);
    const chosen = OWNED_HTTP_FILES.filter(file => (file === SUPERVISOR_HTTP_FILE) === standalone && !file.endsWith('.sh'));
    return chosen.map(file => {
        const matches = recipes.filter(recipe => recipe.files.length === 1 && recipe.files[0] === file);
        if (matches.length !== 1) throw new Error(`Expected one HTTP recipe: ${file}`);
        const recipe = matches[0];
        if (standalone ? recipe.kind !== 'node-script' : !['network-write', 'network-fixed', 'wrapped-node'].includes(recipe.kind)) {
            throw new Error(`Unexpected HTTP recipe kind: ${file}`);
        }
        return { ...recipe, coveredFiles: [file, ...OWNED_HTTP_FILES.filter(candidate => candidate.endsWith('.sh') && recipe.args.includes(candidate))] };
    });
}

async function availablePort(port = 0) {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const selected = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return selected;
}
function signalGroup(pid, signal) {
    try { process.kill(-pid, signal); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function reapGroup(pid) {
    if (!signalGroup(pid, 'SIGTERM')) return;
    for (let attempt = 0; attempt < 50; attempt++) {
        if (!signalGroup(pid, 0)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    signalGroup(pid, 'SIGKILL');
    for (let attempt = 0; attempt < 20; attempt++) {
        if (!signalGroup(pid, 0)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Owned HTTP process group did not terminate');
}

async function run() {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--standalone')) throw new Error('Usage: run-owned-synthetic-http-suite.mjs [--standalone]');
    assertNodeRuntime(readNodeContract(root));
    const standalone = args.length === 1;
    if (standalone && !fs.existsSync(path.join(root, '.next/standalone/server.js'))) {
        throw new Error('Standalone HTTP prerequisite missing: run npm run build in this checkout first');
    }
    const invocations = ownedHttpInvocations(root, standalone);
    const suiteDirectory = await mkdtemp('/tmp/mediflow-owned-http-');
    const failures = [];
    let child;
    let interrupted = false;
    let interruptTimer;
    const stop = () => {
        interrupted = true;
        if (child?.pid) {
            const pid = child.pid;
            signalGroup(pid, 'SIGTERM');
            interruptTimer ??= setTimeout(() => signalGroup(pid, 'SIGKILL'), 5_000);
        }
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    try {
        for (const recipe of invocations) {
            if (interrupted) break;
            const dataDir = await mkdtemp(path.join(suiteDirectory, 'fixture-'));
            const port = await availablePort(standalone ? 3000 : 0);
            const logPath = path.join(suiteDirectory, `${path.basename(dataDir)}.log`);
            const log = fs.openSync(logPath, 'w');
            console.log(`[owned-http] RUN ${recipe.coveredFiles.join(' + ')}`);
            let timer;
            let forceTimer;
            let timedOut = false;
            let pid;
            let code;
            try {
                code = await new Promise((resolve, reject) => {
                    child = spawn(recipe.executable, recipe.args, { cwd: root, stdio: ['ignore', log, log], detached: true,
                        env: { ...process.env, ...recipe.env,
                            PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
                            MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_NETWORK_WRITE_DATA_DIR: dataDir,
                            MEDIFLOW_NETWORK_SMOKE_DATA_DIR: dataDir, MEDIFLOW_CONCURRENCY_DATA_DIR: dataDir,
                            MEDIFLOW_API_V1_PUT_NEGATIVE_DATA_DIR: dataDir, MEDIFLOW_LEGACY_CLINICAL_WRITES_DATA_DIR: dataDir,
                            MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', MEDIFLOW_THERAPY_HTTP_ONLY_PAIRED: '0',
                            MEDIFLOW_PROVIDER_V2_ENABLED: '0', MEDIFLOW_PROVIDER_V2_NETWORK: '0',
                            TMPDIR: dataDir, E2E_BASE_URL: `http://127.0.0.1:${port}`,
                            MEDIFLOW_LOCAL_API_TOKEN: randomUUID(), E2E_USERNAME: 'admin', E2E_PIN: randomUUID(),
                        } });
                    pid = child.pid;
                    timer = setTimeout(() => {
                        timedOut = true; signalGroup(pid, 'SIGTERM');
                        forceTimer = setTimeout(() => signalGroup(pid, 'SIGKILL'), 5_000);
                    }, 300_000);
                    child.once('error', reject);
                    child.once('close', (exitCode, signal) => resolve(signal ? 1 : exitCode ?? 1));
                });
            } finally {
                clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(interruptTimer); child = undefined;
                fs.closeSync(log);
                if (pid) await reapGroup(pid);
            }
            if (code !== 0 || timedOut || interrupted) {
                failures.push(recipe.id);
                console.error(`[owned-http] FAIL ${recipe.id}; exit=${code}; timeout=${timedOut}; log=${logPath}`);
                // CI runners are ephemeral: retain the failed child's actual assertion in the job log.
                console.error(`[owned-http] BEGIN failure output: ${recipe.id}`);
                process.stderr.write(fs.readFileSync(logPath));
                console.error(`[owned-http] END failure output: ${recipe.id}`);
            } else console.log(`[owned-http] PASS ${recipe.id}`);
        }
        if (interrupted || failures.length) throw new Error(`Owned HTTP failed: ${interrupted ? 'interrupted' : failures.join(', ')}`);
        console.log(`[owned-http] PASS ${invocations.length} invocations / ${invocations.flatMap(recipe => recipe.coveredFiles).length} files`);
        await rm(suiteDirectory, { recursive: true, force: true });
    } finally {
        process.off('SIGINT', stop); process.off('SIGTERM', stop);
        if (fs.existsSync(suiteDirectory)) console.error(`[owned-http] Synthetic artifacts: ${suiteDirectory}`);
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
