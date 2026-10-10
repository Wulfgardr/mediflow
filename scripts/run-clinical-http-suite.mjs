import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertNodeRuntime, readNodeContract } from './node-runtime-contract.mjs';

// Closed inventory: local and CI use exactly these real HTTP harnesses, in order.
export const CLINICAL_HTTP_TEST_FILES = Object.freeze([
    'scripts/checkup-local-bounded-json.test.mjs',
    'scripts/entry-required-audit-http.test.mjs',
    'scripts/patient-create-required-audit-http.test.mjs',
    'scripts/patient-restore-required-audit-http.test.mjs',
    'scripts/therapy-required-audit-http.test.mjs',
]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    return port;
}

async function main() {
    if (process.argv.length !== 2) throw new Error('test:clinical-http accepts no arguments');
    assertNodeRuntime(readNodeContract(root));
    const suiteDir = await mkdtemp('/tmp/mediflow-clinical-http-');
    let child;
    let interrupted = false;
    const stop = () => {
        interrupted = true;
        if (child?.pid) {
            try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
                if (error.code !== 'ESRCH') throw error;
            }
        }
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    let passed = false;
    try {
        const ports = new Set();
        for (const file of CLINICAL_HTTP_TEST_FILES) {
            if (interrupted) throw new Error('Clinical HTTP suite interrupted');
            let port;
            do { port = await freePort(); } while (ports.has(port));
            ports.add(port);
            const dataDir = await mkdtemp(path.join(suiteDir, 'fixture-'));
            console.log(`[clinical-http] RUN ${file}`);
            const code = await new Promise((resolve, reject) => {
                child = spawn('bash', ['scripts/network-home-base-write-smoke.sh'], {
                    cwd: root, stdio: 'inherit', detached: true,
                    env: { ...process.env,
                        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
                        MEDIFLOW_NETWORK_WRITE_DATA_DIR: dataDir,
                        MEDIFLOW_DATA_DIR: dataDir,
                        MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
                        MEDIFLOW_NETWORK_WRITE_TEST_SCRIPT: file,
                        MEDIFLOW_THERAPY_HTTP_ONLY_PAIRED: '0',
                        E2E_BASE_URL: `http://127.0.0.1:${port}`,
                        MEDIFLOW_LOCAL_API_TOKEN: randomUUID(),
                        E2E_USERNAME: 'admin', E2E_PIN: randomUUID(),
                    },
                });
                child.once('error', reject);
                child.once('close', (exitCode, signal) => {
                    child = undefined;
                    resolve(signal ? 1 : exitCode ?? 1);
                });
            });
            if (code !== 0 || interrupted) throw new Error(`Clinical HTTP failed: ${file} (exit ${code})`);
            console.log(`[clinical-http] PASS ${file}`);
        }
        passed = true;
        console.log(`[clinical-http] PASS ${CLINICAL_HTTP_TEST_FILES.length} harnesses`);
    } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        // The wrapper owns server teardown and removes each copied Next workspace.
        // Keep failed synthetic fixtures/logs for diagnosis; successful runs leave none.
        if (passed) await rm(suiteDir, { recursive: true, force: true });
        else console.error(`[clinical-http] Synthetic failure artifacts: ${suiteDir}`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
