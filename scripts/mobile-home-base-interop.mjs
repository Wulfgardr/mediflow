#!/usr/bin/env node
/* @Codex */
// Synthetic client/host interoperability support. No database imports, server
// lifecycle, pairing bootstrap, simulator control, or default host credentials.
import { createHash, randomBytes, randomUUID, webcrypto, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { checkServerIdentity } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';

const { subtle } = webcrypto;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

export function validateDescriptor(value) {
    requireValue(value?.schemaVersion === 1 && value.synthetic === true, 'An explicit synthetic v1 descriptor is required.');
    requireValue(typeof value.fixtureId === 'string' && /^[A-Za-z0-9._-]{1,100}$/u.test(value.fixtureId), 'Invalid fixture ID.');
    requireValue(['macos', 'windows', 'linux'].includes(value.host?.os), 'Invalid host OS.');
    requireValue(/^[a-f0-9]{40}$/u.test(value.host?.sourceCommit ?? ''), 'A full host source SHA is required.');
    let url;
    try { url = new URL(value.host.httpsURL); } catch { throw new Error('Invalid HTTPS URL.'); }
    const host = url.hostname.replace(/^\[|\]$/gu, '');
    const ipv4 = isIP(host) === 4 && host.split('.').map(Number);
    const privateAddress = ipv4 && (ipv4[0] === 127 || ipv4[0] === 10
        || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
        || (ipv4[0] === 192 && ipv4[1] === 168));
    requireValue(url.protocol === 'https:' && (privateAddress || host === '::1')
        && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'The descriptor must name one explicit loopback/private-IP HTTPS origin.');
    requireValue(typeof value.host.publicCertificatePath === 'string'
        && path.isAbsolute(value.host.publicCertificatePath), 'A local public certificate path is required.');
    requireValue(/^[a-f0-9]{64}$/u.test(value.host.tlsPinSHA256 ?? ''), 'A SHA256 DER certificate pin is required.');
    for (const key of ['username', 'pin', 'ambulatoryId']) {
        requireValue(nonempty(value.operator?.[key]), `Missing synthetic operator ${key}.`);
    }
    for (const key of ['id', 'firstName', 'lastName']) {
        requireValue(nonempty(value.patient?.[key]), `Missing synthetic patient ${key}.`);
    }
    for (const client of ['ios', 'ipados']) {
        requireValue(nonempty(value.clients?.[client]?.id) && nonempty(value.clients?.[client]?.token),
            `Missing ${client} paired credentials.`);
    }
    requireValue(value.clients.ios.id !== value.clients.ipados.id
        && value.clients.ios.token !== value.clients.ipados.token, 'The two clients require distinct pairings.');
    return value;
}

export function readDescriptor(descriptorPath) {
    const stat = fs.lstatSync(descriptorPath);
    requireValue(stat.isFile() && (stat.mode & 0o077) === 0, 'Descriptor must be a private regular file (0600).');
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(descriptorPath, 'utf8')); }
    catch { throw new Error('Descriptor is not valid JSON.'); }
    return validateDescriptor(parsed);
}

export function pinnedFetch(descriptor) {
    const origin = new URL(descriptor.host.httpsURL);
    const ca = fs.readFileSync(descriptor.host.publicCertificatePath);
    const certificate = new X509Certificate(ca);
    requireValue(digest(certificate.raw) === descriptor.host.tlsPinSHA256, 'Public certificate does not match the declared pin.');
    requireValue(certificate.checkIP(origin.hostname.replace(/^\[|\]$/gu, '')),
        'Public certificate SAN does not match the host IP.');
    return (input, options = {}) => new Promise((resolve, reject) => {
        const url = new URL(input, origin);
        if (url.origin !== origin.origin) return reject(new Error('Cross-origin request refused.'));
        const request = https.request(url, {
            method: options.method ?? 'GET', headers: options.headers, ca,
            rejectUnauthorized: true, timeout: 30_000,
            checkServerIdentity(serverName, presented) {
                const error = checkServerIdentity(serverName, presented);
                if (error) return error;
                if (digest(presented.raw) !== descriptor.host.tlsPinSHA256) return new Error('Certificate pin mismatch.');
            },
        }, (response) => {
            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size > 8 * 1024 * 1024) request.destroy(new Error('Response exceeds the bounded fixture size.'));
                else chunks.push(chunk);
            });
            response.on('error', () => reject(new Error('HTTPS response interrupted.')));
            response.on('end', () => {
                const headers = new Headers();
                for (let index = 0; index < response.rawHeaders.length; index += 2) {
                    headers.append(response.rawHeaders[index], response.rawHeaders[index + 1]);
                }
                const status = response.statusCode ?? 500;
                resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
            });
        });
        request.on('timeout', () => request.destroy(new Error('HTTPS request timed out.')));
        // Never include URL credentials, response bodies, PINs, or cookies in errors.
        request.on('error', (error) => reject(new Error(`HTTPS request failed (${error.code ?? 'transport'}).`)));
        request.end(options.body);
    });
}

// Same public wire formats as CryptoService: versioned PIN wrap, then JSON in
// ENC:base64(iv):base64(ciphertext+tag). Key material comes from real login only.
export async function unwrapLoginKey(login, pin) {
    const blob = login?.encryptedMasterKey;
    requireValue(nonempty(blob) && nonempty(login?.salt), 'Real login did not return wrapped field-crypto material.');
    const versioned = /^(v\d+):(.+)$/u.exec(blob);
    const version = versioned?.[1] ?? 'v1';
    const iterations = { v1: 100_000, v2: 600_000 }[version];
    requireValue(iterations, 'Unsupported wrapped-key version.');
    const combined = Buffer.from(versioned?.[2] ?? blob, 'base64');
    requireValue(combined.length >= 60, 'Invalid wrapped-key payload.');
    const pinKey = await subtle.importKey('raw', Buffer.from(pin), 'PBKDF2', false, ['deriveKey']);
    const kek = await subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(login.salt, 'base64'), iterations, hash: 'SHA-256' },
        pinKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let key;
    try { key = await subtle.decrypt({ name: 'AES-GCM', iv: combined.subarray(0, 12) }, kek, combined.subarray(12)); }
    catch { throw new Error('Operator login key could not be unwrapped.'); }
    requireValue(key.byteLength === 32, 'Unexpected master-key length.');
    return subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt', 'encrypt']);
}

export async function openField(value, key) {
    if (typeof value !== 'string' || !value.startsWith('ENC:')) return value;
    const parts = value.split(':');
    requireValue(parts.length === 3, 'Invalid encrypted field framing.');
    try {
        const bytes = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(parts[1], 'base64') }, key, Buffer.from(parts[2], 'base64'));
        return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch { throw new Error('Encrypted fixture field could not be authenticated and decoded.'); }
}

export async function sealField(value, key) {
    const iv = randomBytes(12);
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(JSON.stringify(value)));
    return `ENC:${iv.toString('base64')}:${Buffer.from(ciphertext).toString('base64')}`;
}

export function nativeSessionCookie(response) {
    const cookies = response.headers.getSetCookie().filter((cookie) => cookie.startsWith('mediflow_session='));
    requireValue(cookies.length === 1 && /;\s*Secure(?:;|$)/iu.test(cookies[0]), 'Native login did not return one Secure session cookie.');
    const match = /^mediflow_session=([a-f0-9]{64})(?:;|$)/u.exec(cookies[0]);
    requireValue(match, 'Native login returned an invalid session cookie.');
    return `mediflow_session=${match[1]}`;
}

export async function inspectHost(descriptor, clientPlatform, expectations = {}, mode = 'reread', checks = []) {
    requireValue(['ios', 'ipados'].includes(clientPlatform), 'Select ios or ipados explicitly.');
    requireValue(['preflight', 'reread', 'competing-write', 'native-boundary'].includes(mode), 'Unsupported operation.');
    const fetchHost = pinnedFetch(descriptor);
    const login = await loginWithWebAuthControl(descriptor.host.httpsURL,
        { username: descriptor.operator.username, password: descriptor.operator.pin }, fetchHost);
    checks.push({ operation: 'Web operator login', httpStatus: login.response.status });
    requireValue(login.response.status === 200 && login.cookieHeader, 'Synthetic web operator login failed.');
    const cookie = `${login.cookieHeader}; ambulatory_id=${encodeURIComponent(descriptor.operator.ambulatoryId)}`;
    const webHeaders = { Cookie: cookie, 'Cache-Control': 'no-store' };
    const client = descriptor.clients[clientPlatform];
    const pairingHeaders = { 'x-mediflow-paired-client-id': client.id, 'x-mediflow-paired-client-token': client.token };
    let pairedHeaders;
    let operationCompleted = false;
    const readJSON = async (route, headers, label) => {
        const response = await fetchHost(route, { headers });
        checks.push({ operation: label, httpStatus: response.status });
        requireValue(response.status === 200, `${label} failed (HTTP ${response.status}).`);
        try { return await response.json(); } catch { throw new Error(`${label} returned invalid JSON.`); }
    };
    try {
        const key = await unwrapLoginKey(login.json, descriptor.operator.pin);
        const revision = await readJSON('/api/v1/network/revision', pairingHeaders, 'Paired device revision admission');
        requireValue(nonempty(revision.revision) && nonempty(revision.fingerprint), 'The paired host revision is missing.');
        checks.push({ operation: 'Host revision receipt', revision: revision.revision,
            fingerprint: revision.fingerprint, sourceFingerprint: revision.sourceFingerprint });
        // Use the same native login route as HomeBasePatientsClient. A web
        // session plus pairing headers is not evidence that the real app works.
        const nativeLogin = await fetchHost('/api/auth/native/login', {
            method: 'POST', headers: { ...pairingHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: descriptor.operator.username, password: descriptor.operator.pin }),
        });
        checks.push({ operation: 'Native operator login', httpStatus: nativeLogin.status });
        requireValue(nativeLogin.status === 200, `Native operator login failed (HTTP ${nativeLogin.status}).`);
        pairedHeaders = { ...pairingHeaders, 'Cache-Control': 'no-store',
            Cookie: `${nativeSessionCookie(nativeLogin)}; ambulatory_id=${encodeURIComponent(descriptor.operator.ambulatoryId)}` };
        const nativeKey = await unwrapLoginKey(await nativeLogin.json(), descriptor.operator.pin);
        const patientRoute = `/api/patients/${encodeURIComponent(descriptor.patient.id)}`;
        const pairedRoute = `/api/v1/network/patients/${encodeURIComponent(descriptor.patient.id)}`;
        let web = await readJSON(patientRoute, webHeaders, 'Web patient reread');
        requireValue(web.id === descriptor.patient.id && web.firstName === descriptor.patient.firstName
            && web.lastName === descriptor.patient.lastName, 'The host patient does not match the synthetic descriptor.');
        requireValue(Number.isSafeInteger(web.version) && web.version > 0, 'Patient version is missing.');
        if (mode === 'native-boundary') {
            // A normal app-equivalent read/write/logout on the named fixture.
            // Retain the address value; if accepted, the real writer advances CAS.
            const read = await fetchHost('/api/v1/network/patients?include=diagnoses', { headers: pairedHeaders });
            checks.push({ operation: 'Native-session patient list', httpStatus: read.status });
            const originalAddress = await openField(web.address, key);
            const write = await fetchHost(pairedRoute, {
                method: 'PUT', headers: { ...pairedHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ version: web.version,
                    address: originalAddress == null ? null : await sealField(originalAddress, key) }),
            });
            checks.push({ operation: 'Native-session versioned address write', httpStatus: write.status });
            const persisted = await readJSON(patientRoute, webHeaders, 'Web reread after native boundary write');
            requireValue(await openField(persisted.address, key) === originalAddress,
                'The native boundary probe changed the synthetic address value.');
            requireValue(persisted.version === web.version + (write.status === 200 ? 1 : 0),
                'The native write result and persisted version disagree.');
            checks.push({ operation: 'Host persistence/version after native write',
                valuePreserved: true, previousVersion: web.version, currentVersion: persisted.version });
            requireValue(read.status === 200 && write.status === 200,
                `Normal native session boundary failed (read ${read.status}, write ${write.status}).`);
            operationCompleted = true;
            return { schemaVersion: 1, generatedAt: new Date().toISOString(), fixtureId: descriptor.fixtureId,
                hostOS: descriptor.host.os, hostSourceCommit: descriptor.host.sourceCommit, clientPlatform, mode,
                evidenceKind: 'real-https-api', nativeAppInteraction: 'not-run', checks };
        }
        const patients = await readJSON('/api/v1/network/patients?include=diagnoses', pairedHeaders, 'Native-session patient list');
        requireValue(Array.isArray(patients) && patients.some((item) => item.id === web.id), 'Synthetic patient is absent from the native-session scope.');
        await readJSON(pairedRoute, pairedHeaders, 'Native-session patient detail');
        if (mode === 'competing-write') {
            requireValue(nonempty(expectations.address), 'A synthetic competing address is required.');
            const response = await fetchHost(patientRoute, {
                method: 'PUT', headers: { ...webHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ version: web.version, address: await sealField(expectations.address, key) }),
            });
            checks.push({ operation: 'Competing web address write', httpStatus: response.status });
            requireValue(response.status === 200, `Competing web write failed (HTTP ${response.status}).`);
            const previousVersion = web.version;
            web = await readJSON(patientRoute, webHeaders, 'Web post-write reread');
            requireValue(web.version === previousVersion + 1, 'Competing write did not advance the patient version exactly once.');
        }
        const paired = await readJSON(pairedRoute, pairedHeaders, 'Paired patient reread');
        requireValue(paired.id === web.id && paired.version === web.version && paired.address === web.address,
            'Web and paired patient snapshots disagree.');
        const address = await openField(web.address, key);
        requireValue(await openField(paired.address, nativeKey) === address, 'Native and web login keys do not decode the same address.');
        if (expectations.address !== undefined) requireValue(address === expectations.address, 'Persisted address does not equal the expected mobile/web write.');
        const evidence = {
            schemaVersion: 1, generatedAt: new Date().toISOString(), fixtureId: descriptor.fixtureId,
            hostOS: descriptor.host.os, hostSourceCommit: descriptor.host.sourceCommit,
            hostOrigin: new URL(descriptor.host.httpsURL).origin, clientPlatform, mode,
            evidenceKind: 'real-https-api', nativeAppInteraction: 'separate-XCUITest-or-manual-receipt-required',
            authenticationChannels: ['web-auth-control', 'native-paired-login'], checks,
            patientVersion: web.version, webAndPairedSnapshotEqual: true,
            addressCiphertextSHA256: digest(JSON.stringify(web.address ?? null)),
            ...(expectations.address !== undefined ? { expectedAddressMatched: true } : {}),
        };
        if (expectations.diaryTitle !== undefined) {
            const webEntries = await readJSON(`/api/entries?patientId=${encodeURIComponent(web.id)}&limit=100`, webHeaders, 'Web diary reread');
            const pairedEntries = await readJSON(`${pairedRoute}/entries?limit=100`, pairedHeaders, 'Paired diary reread');
            requireValue(Array.isArray(webEntries) && Array.isArray(pairedEntries), 'Diary response is not a list.');
            const matches = [];
            for (const entry of webEntries) {
                if (await openField(entry.title, key) === expectations.diaryTitle) matches.push(entry);
            }
            requireValue(matches.length === 1, 'Expected exactly one persisted diary entry with the run title.');
            const entry = matches[0];
            const other = pairedEntries.find((item) => item.id === entry.id);
            requireValue(other && other.version === entry.version && other.title === entry.title && other.content === entry.content,
                'Web and paired diary snapshots disagree.');
            if (expectations.diaryContent !== undefined) {
                requireValue(await openField(entry.content, key) === expectations.diaryContent, 'Persisted diary content does not equal the expected canonical HTML.');
            }
            evidence.diary = { id: entry.id, version: entry.version, expectedTitleMatched: true,
                webAndPairedSnapshotEqual: true, ...(expectations.diaryContent !== undefined ? { expectedContentMatched: true } : {}) };
        }
        operationCompleted = true;
        return evidence;
    } finally {
        let nativeLogoutConfirmed = false;
        if (pairedHeaders) {
            try {
                // This deliberately exercises the actual app's current route.
                // An unconfirmed logout remains a gap, never a fabricated pass.
                const response = await fetchHost('/api/auth/native/logout', { method: 'POST', headers: pairedHeaders });
                checks.push({ operation: 'Native session logout', httpStatus: response.status });
                nativeLogoutConfirmed = [200, 204].includes(response.status);
            } catch {
                checks.push({ operation: 'Native session logout', transport: 'failed' });
            }
        }
        const response = await fetchHost('/api/auth/logout', { method: 'POST', headers: {
            ...webHeaders, 'If-Match': login.controlEtag, 'Idempotency-Key': randomUUID(),
        } });
        checks.push({ operation: 'Web session logout', httpStatus: response.status });
        if (operationCompleted) {
            requireValue([200, 204].includes(response.status), `Harness web session logout failed (HTTP ${response.status}).`);
            requireValue(nativeLogoutConfirmed, 'Native session logout was not confirmed through the current app route.');
        }
    }
}

async function main() {
    const { values, positionals } = parseArgs({ allowPositionals: true, options: {
        descriptor: { type: 'string' }, client: { type: 'string' }, output: { type: 'string' },
        'expected-address': { type: 'string' }, 'expected-diary-title': { type: 'string' }, 'expected-diary-content': { type: 'string' },
    } });
    requireValue(positionals.length === 1 && values.descriptor && values.client && values.output,
        'Usage: mobile-home-base-interop.mjs preflight|reread|competing-write|native-boundary --descriptor private.json --client ios|ipados --output new-receipt.json [--expected-address synthetic-text] [--expected-diary-title synthetic-title] [--expected-diary-content canonical-HTML]');
    const descriptor = readDescriptor(values.descriptor);
    // Reserve evidence before network activity; never replace a previous receipt.
    const fd = fs.openSync(values.output, 'wx', 0o600);
    const checks = [];
    try {
        const evidence = await inspectHost(descriptor, values.client, {
            address: values['expected-address'], diaryTitle: values['expected-diary-title'], diaryContent: values['expected-diary-content'],
        }, positionals[0], checks);
        fs.writeFileSync(fd, `${JSON.stringify(evidence, null, 2)}\n`);
        console.log(`${evidence.mode}: PASS (${evidence.hostOS}/${evidence.clientPlatform}, HTTPS API evidence only).`);
    } catch (error) {
        fs.writeFileSync(fd, `${JSON.stringify({ status: 'failed', generatedAt: new Date().toISOString(),
            fixtureId: descriptor.fixtureId, hostOS: descriptor.host.os, hostSourceCommit: descriptor.host.sourceCommit,
            clientPlatform: values.client, evidenceKind: 'real-https-api', error: error.message, checks }, null, 2)}\n`);
        throw error;
    } finally { fs.closeSync(fd); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
