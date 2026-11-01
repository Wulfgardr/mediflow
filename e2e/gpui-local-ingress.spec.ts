import { test, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, networkInterfaces } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

const base = new URL(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000');
if (base.port === '3000' || !['127.0.0.1', '[::1]'].includes(base.hostname)) {
    throw new Error('GPUI ingress tests require an isolated loopback runtime outside port 3000');
}
const username = process.env.E2E_USERNAME || 'admin';
const password = process.env.E2E_PIN || '1234';

test('server binds GPUI authority to its socket ingress across login, both writers and exact logout', async () => {
    test.setTimeout(120_000);
    const directory = mkdtempSync(path.join(tmpdir(), 'mf725-tls-'));
    const reservation = http.createServer();
    reservation.listen(0, '::'); await once(reservation, 'listening');
    const port = (reservation.address() as import('node:net').AddressInfo).port;
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    const cert = path.join(directory, 'cert.pem'), key = path.join(directory, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=synthetic-mediflow', '-days', '1'], { stdio: 'ignore' });
    const proxy = spawn(process.execPath, ['scripts/local-api-tls-proxy.mjs'], { env: { ...process.env,
        MEDIFLOW_TLS_CERT_PATH: cert, MEDIFLOW_TLS_KEY_PATH: key, MEDIFLOW_TLS_PORT: String(port),
        MEDIFLOW_TLS_BIND_HOST: '::', MEDIFLOW_TLS_NETWORK_MODE: 'network-home-base', MEDIFLOW_HTTP_TARGET: base.origin }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; proxy.stdout.on('data', chunk => output += chunk); proxy.stderr.on('data', chunk => output += chunk);
    const lan = Object.values(networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)?.address;
    expect(lan, 'A real non-loopback peer address is required for this negative test').toBeTruthy();
    const call = (pathname: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown, peer = 'local', alias = 'localhost') =>
        new Promise<{status: number; headers: http.IncomingHttpHeaders; json: any}>((resolve, reject) => {
            const host = `${alias}:${port}`;
            const request = https.request({ hostname: peer === 'ipv6' ? '::1' : '127.0.0.1', port,
                localAddress: peer === 'lan' ? lan : undefined, rejectUnauthorized: false, path: pathname, method,
                headers: { Host: host, Origin: `https://${host}`, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', ...(body === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(JSON.stringify(body))) }), ...headers } }, response => {
                let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => {
                    let json; try { json = JSON.parse(text); } catch { json = null; }
                    resolve({ status: response.statusCode!, headers: response.headers, json });
                });
            });
            request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
        });
    try {
        await expect.poll(() => output, { timeout: 15_000 }).toContain('TLS proxy listening');
        const checked = await call('/api/auth/check');
        const control = checked.headers['set-cookie']!.find(value => value.startsWith('mediflow_auth_control='))!.split(';')[0];
        const auth = { Cookie: control, 'If-Match': String(checked.headers.etag), 'Idempotency-Key': randomUUID() };
        const forged = { ...auth, 'x-mediflow-server-loopback': 'a'.repeat(64), 'x-mediflow-proxy-loopback': 'a'.repeat(64), 'x-forwarded-for': '::1' };
        expect((await call('/api/auth/local-client/login', 'POST', forged, {username, password}, 'lan')).status).toBe(403);
        const logged = await call('/api/auth/local-client/login', 'POST', auth, {username, password}, 'ipv6', 'mediflow.local');
        expect(logged.status, JSON.stringify(logged.json)).toBe(200);
        const cookie = logged.headers['set-cookie']!.find(value => value.startsWith('mediflow_session='))!.split(';')[0];
        const session = { Cookie: `${cookie}; ${control}`, 'x-mediflow-archive-generation': logged.json.archiveGeneration };
        const patient = await call('/api/patients', 'POST', session, { firstName: 'Ada', lastName: 'Prova sintetica GPUI', taxCode: `SYN${randomUUID()}`, birthDate: '1980-01-01' });
        expect(patient.status).toBe(201);
        const id = randomUUID();
        expect((await call('/api/attachments', 'POST', session, { id, patientId: patient.json.id, name: 'Sintetico.txt', type: 'text/plain', size: 9, path: 'uploads/synthetic.txt', data: 'data:text/plain;base64,U2ludGV0aWNv' })).status).toBe(201);
        const document = await call(`/api/attachments/${id}`, 'GET', session);
        expect(document.status).toBe(200);
        const deletion = { patientId: patient.json.id, expected: document.json.currentness };
        const setting = '/api/settings/aiPatientInsightKillSwitch';
        const before = (await call(setting, 'GET', session)).json;
        expect((await call(setting, 'PUT', session, {value: 'enabled'})).status).toBe(200);
        for (const extra of [{}, forged]) {
            const attack = { ...extra, ...session };
            for (const key of ['aiPatientInsightKillSwitch', 'aiDocumentSynthesisKillSwitch', 'aiSmartImportKillSwitch']) {
                expect((await call(`/api/settings/${key}`, 'PUT', attack, {value: 'disabled'}, 'lan')).status).toBe(403);
            }
            expect((await call(`/api/attachments/${id}`, 'DELETE', attack, deletion, 'lan')).status).toBe(403);
        }
        expect((await call(setting, 'GET', session)).json.value).toBe('enabled');
        expect((await call(`/api/attachments/${id}`, 'GET', session)).status).toBe(200);
        expect((await call(`/api/attachments/${id}`, 'DELETE', session, deletion)).status).toBe(200);
        expect((await call(`/api/attachments/${id}`, 'GET', session)).status).toBe(404);
        // Restore the synthetic setting before retiring this authority.
        expect((await call(setting, 'PUT', session, {value: before.value ?? 'disabled'})).status).toBe(200);
        const fence = await call('/api/auth/check', 'GET', session);
        const logout = { ...session, 'If-Match': String(fence.headers.etag), 'Idempotency-Key': randomUUID() };
        expect((await call('/api/auth/local-client/logout', 'POST', logout, undefined, 'lan')).status).toBe(403);
        expect((await call('/api/auth/local-client/logout', 'POST', logout, undefined, 'ipv6', '[::1]')).status).toBe(204);
        expect((await call(setting, 'GET', session)).status).toBe(401);
    } finally {
        const exited = once(proxy, 'exit'); proxy.kill('SIGTERM'); await exited;
        rmSync(directory, {recursive: true, force: true});
    }
});
