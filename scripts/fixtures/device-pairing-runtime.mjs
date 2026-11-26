import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { generateMasterKey } from '../../lib/security/security.ts';
import { createRecoveryWrapping, createUnlockWrapping, deriveUnlockMaterial } from '../../lib/security/unlock-credential.ts';
import { loginWithWebAuthControl } from '../web-auth-control-test-client.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
export const pin = '527418';
export const passphrase = 'ortica pendolo quarzo mosaico';

async function freePort() {
    const server = createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

export async function startDevicePairingFixture({ source = root, proxy: ownProxy = true } = {}) {
    const directory = mkdtempSync(join(root, 'tmp-device-pairing-'));
    const children = [];
    const tlsPort = await freePort();
    const httpPort = await freePort();
    const peer = Object.entries(networkInterfaces()).sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([, addresses]) => addresses ?? []).find(address => address.family === 'IPv4'
        && !address.internal && !address.address.startsWith('169.254.'))?.address;
    const httpOrigin = `http://127.0.0.1:${httpPort}`;
    const localApiToken = randomBytes(32).toString('hex');
    const env = { ...process.env, MEDIFLOW_DATA_DIR: directory, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
        MEDIFLOW_LOCAL_API_TOKEN: localApiToken, NEXT_TELEMETRY_DISABLED: '1' };
    delete env.MEDIFLOW_NEXT_DIST_DIR;

    function launch(args, log, extra = {}) {
        const logPath = join(directory, log);
        const fd = openSync(logPath, 'wx', 0o600);
        const child = spawn(process.execPath, args, { cwd: source, env: { ...env, ...extra }, stdio: ['ignore', fd, fd] });
        closeSync(fd);
        children.push(child);
        return child;
    }

    async function close() {
        await Promise.all(children.map(async child => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const closed = new Promise(resolve => child.once('exit', resolve));
            child.kill('SIGTERM');
            const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
            await closed;
            clearTimeout(timer);
        }));
        rmSync(directory, { recursive: true, force: true });
    }

    async function waitFor(child, predicate, name) {
        for (let attempt = 0; attempt < 240 && child.exitCode === null; attempt++) {
            if (await predicate()) return;
            await delay(250);
        }
        throw new Error(`${name} did not become ready`);
    }

    try {
        if (!peer) throw new Error('The test requires one non-loopback IPv4 interface');
        const server = launch([resolve(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack',
            '--hostname', '127.0.0.1', '--port', String(httpPort)], 'next.log');
        await waitFor(server, async () => {
            try { return (await fetch(httpOrigin + '/api/auth/check')).ok; } catch { return false; }
        }, 'Next');

        const setupHeaders = { 'x-mediflow-local-client-instance': randomBytes(32).toString('hex') };
        const bootstrap = await fetch(httpOrigin + '/api/auth/check', { headers: setupHeaders });
        if ((await bootstrap.json()).isSetup !== false) throw new Error('The test requires an empty synthetic archive');
        const control = bootstrap.headers.getSetCookie()[0]?.split(';')[0];
        if (!control?.startsWith('mediflow_auth_control=')) throw new Error('Missing synthetic auth control');
        const master = await generateMasterKey();
        const unlock = await createUnlockWrapping(master, passphrase);
        const { wrappedMasterKey, salt, verifier } = await createRecoveryWrapping(master);
        const setup = await fetch(httpOrigin + '/api/auth/setup', {
            method: 'POST',
            headers: { ...setupHeaders, Cookie: control, 'If-Match': bootstrap.headers.get('etag'),
                'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: pin, displayName: 'Operatore sintetico',
                ambulatoryName: 'MediFlow Prova', ...unlock, recovery: { wrappedMasterKey, salt, verifier } }),
        });
        if (setup.status !== 200) throw new Error('Synthetic setup returned ' + setup.status + ' ' + await setup.text());
        const mode = await fetch(httpOrigin + '/api/settings/network.mode', {
            method: 'PUT', headers: { Authorization: 'Bearer ' + localApiToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: 'network-home-base' }),
        });
        if (mode.status !== 200) throw new Error('Changing the synthetic network mode returned ' + mode.status);

        if (!ownProxy) return { httpOrigin, peer, directory, ...await signIn(), localApiToken, close, signIn,
            verifier: (await deriveUnlockMaterial(passphrase, Buffer.from(unlock.salt, 'base64'))).verifier };
        const certPath = join(directory, 'test.crt');
        const keyPath = join(directory, 'test.key');
        execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-x509', '-nodes', '-days', '1',
            '-keyout', keyPath, '-out', certPath, '-subj', '/CN=localhost',
            '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
        writeFileSync(join(directory, 'runtime-status.json'), JSON.stringify({ bindHost: '0.0.0.0', port: tlsPort, certPath }));
        const proxy = launch([resolve(source, 'scripts/local-api-tls-proxy.mjs')], 'proxy.log', {
            MEDIFLOW_TLS_CERT_PATH: certPath, MEDIFLOW_TLS_KEY_PATH: keyPath,
            MEDIFLOW_TLS_BIND_HOST: '0.0.0.0', MEDIFLOW_TLS_PORT: String(tlsPort),
            MEDIFLOW_TLS_NETWORK_MODE: 'network-home-base', MEDIFLOW_HTTP_TARGET: httpOrigin,
        });
        function lan(path, { method = 'GET', headers = {}, body } = {}) {
            return new Promise((resolve, reject) => {
                const req = httpsRequest(`https://127.0.0.1:${tlsPort}${path}`, {
                    method, headers, localAddress: peer, servername: 'localhost',
                    ca: readFileSync(certPath), timeout: 30_000,
                }, response => {
                    let text = '';
                    response.on('data', chunk => { text += chunk; });
                    response.on('end', () => resolve({ status: response.statusCode, text, headers: response.headers }));
                });
                req.once('error', reject);
                req.once('timeout', () => req.destroy(new Error('Synthetic LAN request timed out')));
                req.end(body);
            });
        }
        await waitFor(proxy, async () => {
            try { return (await lan('/api/auth/check')).status === 200; } catch { return false; }
        }, 'TLS proxy');

        async function signIn() {
            const material = await deriveUnlockMaterial(passphrase, Buffer.from(unlock.salt, 'base64'));
            const web = await loginWithWebAuthControl(httpOrigin, { username: 'admin', verifier: material.verifier });
            if (web.response.status !== 200) throw new Error('Synthetic Web login returned ' + web.response.status);
            const webHeaders = { ...web.webHeaders, 'Content-Type': 'application/json', Origin: httpOrigin, 'Sec-Fetch-Site': 'same-origin' };
            return { web, webHeaders };
        }
        return { httpOrigin, peer, tlsPort, directory, ...await signIn(), localApiToken, lan, close,
            signIn, verifier: (await deriveUnlockMaterial(passphrase, Buffer.from(unlock.salt, 'base64'))).verifier };
    } catch (error) {
        for (const name of ['next.log', 'proxy.log']) {
            try { console.error(readFileSync(join(directory, name), 'utf8').split('\n').slice(-12).join('\n')); } catch {}
        }
        await close();
        throw error;
    }
}
