import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash, X509Certificate } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const scratch = '/Volumes/Vision/mf-ui-identita-20261107-scratch';
export const data = path.resolve(process.env.MEDIFLOW_DATA_DIR || `${scratch}/apfs/banco`);
fs.mkdirSync(scratch, { recursive: true });
function validateData() {
  if (!fs.existsSync(`${scratch}/apfs`)) throw new Error('Montare prima il contenitore APFS: vedere README');
  if (!data.startsWith(`${scratch}/`)) throw new Error('SYNTHETIC_ONLY: data dir fuori dallo scratch rifiutata');
  let existing = data;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  if (fs.realpathSync(existing) !== fs.realpathSync(scratch) && !fs.realpathSync(existing).startsWith(`${fs.realpathSync(scratch)}/`)) throw new Error('SYNTHETIC_ONLY: symlink fuori scratch rifiutato');
  if (fs.existsSync(`${data}/medical.db`) && !fs.existsSync(`${data}/SYNTHETIC_ONLY`)) throw new Error('Archivio senza SYNTHETIC_ONLY rifiutato');
}
validateData();
const statePath = `${data}/banco-state.json`;
const read = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : {};
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function request(route, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`http://127.0.0.1:3100${route}`, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${text.slice(0, 800)}`);
  return { response, json };
}
export async function login() {
  const bootstrap = await request('/api/auth/check');
  const control = bootstrap.response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const result = await request('/api/auth/login', { method: 'POST', headers: { Cookie: control, 'If-Match': bootstrap.response.headers.get('etag'), 'Idempotency-Key': randomUUID() }, body: { username: 'performance-baseline', password: '314159' } });
  const session = result.response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return { ...result, cookie: `${control}; ${session}; ambulatory_id=performance-baseline-ambulatory` };
}
function spawnOwned(args, env, log) {
  const fd = fs.openSync(`${data}/${log}`, 'a');
  const child = spawn(process.execPath, args, { cwd: root, env, detached: true, stdio: ['ignore', fd, fd] });
  child.unref(); fs.closeSync(fd); return child.pid;
}
async function free(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', resolve); });
  await new Promise(r => server.close(r));
}
async function stop() {
  const state = read();
  for (const pid of [state.proxyPid, state.nextPid]) if (pid && alive(pid)) {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    if (!command.includes(root) && !command.includes('next-server')) throw new Error(`PID ${pid} non riconosciuto: arresto rifiutato`);
    process.kill(-pid, 'SIGTERM');
    for (let n = 0; n < 40 && alive(pid); n++) await sleep(250);
    if (alive(pid)) throw new Error(`PID ${pid} ancora attivo`);
  }
  console.log(JSON.stringify({ stopped: true, data }));
}
async function start() {
  if (!execFileSync('/sbin/mount', { encoding: 'utf8' }).includes(` on ${scratch}/apfs (apfs,`)) throw new Error('Contenitore APFS non montato: vedere README');
  if (process.version !== 'v24.22.0') throw new Error(`Richiesto Node v24.22.0: ${process.version}`);
  const previous = read();
  if (alive(previous.nextPid) && alive(previous.proxyPid)) { await seedReference(); return status(); }
  if (alive(previous.nextPid) || alive(previous.proxyPid)) await stop();
  await free(3100); await free(3543);
  const ip = execFileSync('ifconfig', { encoding: 'utf8' }).match(/inet (10\.211\.55\.\d+)/)?.[1];
  if (!ip) throw new Error('IP Parallels non trovato');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(`${data}/SYNTHETIC_ONLY`, 'Archivio sintetico creato dal banco UI 2026-11-07\n');
  const distTarget = `${scratch}/apfs/next-banco`;
  const distLink = `${root}/node_modules/.cache/mf-ui-identita`;
  fs.mkdirSync(`${root}/node_modules/.cache`, { recursive: true });
  fs.mkdirSync(distTarget, { recursive: true });
  if (!fs.existsSync(distLink)) fs.symlinkSync(distTarget, distLink, 'dir');
  if (fs.realpathSync(distLink) !== fs.realpathSync(distTarget)) throw new Error('Dist link occupato da altro banco');
  const env = { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', MEDIFLOW_NEXT_DIST_DIR: 'node_modules/.cache/mf-ui-identita', NEXT_TELEMETRY_DISABLED: '1', NODE_PATH: `${root}/node_modules` };
  if (!fs.existsSync(`${data}/medical.db`)) execFileSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/seed-performance-baseline.mjs', '--data-dir', data, '--patients', '40', '--entries-per-patient', '0', '--observations-per-patient', '0', '--documents-per-patient', '0'], { cwd: root, env, stdio: ['ignore', fs.openSync(`${data}/seed.log`, 'a'), 'inherit'] });
  if (!fs.existsSync(`${data}/local-api-token`)) fs.writeFileSync(`${data}/local-api-token`, randomBytes(32).toString('hex'), { mode: 0o600 });
  if (!fs.existsSync(`${data}/local-api.crt`)) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-keyout', `${data}/local-api.key`, '-out', `${data}/local-api.crt`, '-subj', '/CN=MediFlow Synthetic UI', '-addext', `subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${ip}`], { stdio: 'ignore' });
  fs.chmodSync(`${data}/local-api.key`, 0o600);
  const state = { data, ip, nextPid: spawnOwned([`${root}/node_modules/next/dist/bin/next`, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3100'], env, 'next.log') };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  let ready = false;
  for (let n = 0; n < 120; n++) { try { await request('/api/auth/check'); ready = true; break; } catch {} await sleep(1000); }
  if (!ready) throw new Error('Next non pronto: consultare next.log');
  const tsconfig = `${root}/tsconfig.json`;
  fs.writeFileSync(tsconfig, fs.readFileSync(tsconfig, 'utf8').replace(/,\n\s*"(?:\/Volumes\/Vision\/mf-ui-identita-20261107-scratch\/|\.next-visual-ui-identita\/|node_modules\/\.cache\/mf-ui-identita\/)[^"]+"/g, ''));
  const headers = { Authorization: `Bearer ${fs.readFileSync(`${data}/local-api-token`, 'utf8').trim()}` };
  await request('/api/settings/network.mode', { method: 'PUT', headers, body: { value: 'network-home-base' } });
  state.proxyPid = spawnOwned([`${root}/scripts/local-api-tls-proxy.mjs`], { ...env, MEDIFLOW_TLS_CERT_PATH: `${data}/local-api.crt`, MEDIFLOW_TLS_KEY_PATH: `${data}/local-api.key`, MEDIFLOW_TLS_PORT: '3543', MEDIFLOW_TLS_BIND_HOST: '0.0.0.0', MEDIFLOW_TLS_NETWORK_MODE: 'network-home-base', MEDIFLOW_HTTP_TARGET: 'http://127.0.0.1:3100' }, 'proxy.log');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  await seedReference();
  await sleep(500); return status();
}
async function seal(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(JSON.stringify(value)));
  return `ENC:${Buffer.from(iv).toString('base64')}:${Buffer.from(encrypted).toString('base64')}`;
}
async function seedReference() {
  if (fs.existsSync(`${data}/reference.json`)) return;
  const auth = await login();
  const material = await crypto.subtle.importKey('raw', Buffer.from('314159'), 'PBKDF2', false, ['deriveKey']);
  const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(auth.json.salt, 'base64'), iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const wrapped = Buffer.from(auth.json.encryptedMasterKey.slice(3), 'base64');
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrapped.subarray(0, 12) }, kek, wrapped.subarray(12));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const headers = { Cookie: auth.cookie, Origin: 'http://127.0.0.1:3100', 'Sec-Fetch-Site': 'same-origin', 'x-mediflow-archive-generation': auth.json.archiveGeneration };
  const { syntheticTaxCode } = await import('../../lib/patient-identity.test-support.ts');
  const existing = (await request('/api/patients', { headers })).json;
  const patients = [];
  for (const [index, firstName, lastName] of [[9001, 'Maria', 'Rossi Sintetica'], [9002, 'Paolo', 'Vuoto Sintetico']]) {
    let patient = existing.find(p => p.taxCode === syntheticTaxCode(index));
    if (!patient) patient = (await request('/api/patients', { method: 'POST', headers, body: { firstName, lastName, taxCode: syntheticTaxCode(index), birthDate: '1958-04-17T00:00:00Z', diagnoses: index === 9001 ? await seal([{ system: 'ICD-10', code: 'I10', description: 'Ipertensione arteriosa', date: '2026-10-01' }, { system: 'ICD-10', code: 'E11', description: 'Diabete mellito tipo 2', date: '2026-10-01' }], key) : [], notes: await seal(index === 9001 ? 'Allergia riferita ad amoxicillina. Dati interamente inventati per la misura UI.' : 'Paziente sintetico senza diario.', key) } })).json;
    patients.push(patient.id);
  }
  const entries = [ ['Controllo ambulatoriale', 'Paziente in buone condizioni generali. Pressione 132/78 mmHg, frequenza 72/min. Non riferisce dispnea né dolore toracico. Concordato controllo fra un mese.'], ['Contatto telefonico', 'Riferisce buona aderenza alla terapia e assenza di capogiri. Ricordata la registrazione della pressione a domicilio per sette giorni.'], ['Revisione degli esami', 'Esami sintetici: creatinina 0,9 mg/dL, emoglobina glicata 6,8%. Discussi alimentazione e attività fisica compatibile con le condizioni generali.'], ['Visita di follow-up', 'Diario pressorio mediamente nei limiti. Nessun edema periferico. Prosegue la terapia concordata; rivalutazione programmata.'] ];
  const priorEntries = (await request(`/api/entries?patientId=${patients[0]}`, { headers })).json;
  for (const [i, [title, content]] of entries.entries()) if (!priorEntries.some(e => e.id === `ui-identita-${patients[0]}-entry-${i}`)) await request('/api/entries', { method: 'POST', headers, body: { id: `ui-identita-${patients[0]}-entry-${i}`, patientId: patients[0], type: i === 1 ? 'phone' : 'visit', date: new Date(Date.UTC(2026, 10, 7 - i * 7)).toISOString(), title: await seal(title, key), content: await seal(content, key) } });
  const priorTherapies = (await request(`/api/therapies?patientId=${patients[0]}`, { headers })).json;
  for (const [drugName, dosage] of [['Ramipril', '5 mg, una compressa al mattino'], ['Metformina', '500 mg, una compressa dopo cena']]) if (!priorTherapies.some(t => t.id === `ui-identita-${patients[0]}-${drugName}`)) await request('/api/therapies', { method: 'POST', headers, body: { id: `ui-identita-${patients[0]}-${drugName}`, patientId: patients[0], drugName, dosage, status: 'active', startDate: '2026-10-01T00:00:00Z' } });
  fs.writeFileSync(`${data}/reference.json`, JSON.stringify({ referenceId: patients[0], emptyId: patients[1] }, null, 2));
}
async function status() {
  const state = read();
  const result = { ...state, nextRunning: alive(state.nextPid), proxyRunning: alive(state.proxyPid), syntheticOnly: fs.existsSync(`${data}/SYNTHETIC_ONLY`), http: 'http://127.0.0.1:3100', https: `https://${state.ip}:3543` };
  console.log(JSON.stringify(result, null, 2)); return result;
}
async function pair(platform) {
  if (!['ios', 'ipados', 'macos', 'windows', 'linux'].includes(platform)) throw new Error('Usare pair ios|ipados|macos|windows|linux');
  const state = read();
  const headers = { Authorization: `Bearer ${fs.readFileSync(`${data}/local-api-token`, 'utf8').trim()}` };
  const capabilities = (await request('/api/v1/network/capabilities', { headers })).json;
  const requestedCapabilities = capabilities.capabilities.map(c => c.key);
  const intent = (await request('/api/v1/network/pairing-intents', { method: 'POST', body: { deviceName: `UI Sintetica ${platform}`, clientPlatform: platform, requestedCapabilities } })).json;
  const confirmed = (await request(`/api/v1/network/pairing-intents/${intent.intentId}/confirm`, { method: 'POST', headers })).json;
  const auth = await login();
  const reference = JSON.parse(fs.readFileSync(`${data}/reference.json`));
  const paired = { Cookie: auth.cookie, 'x-mediflow-paired-client-id': confirmed.pairedClient.clientId, 'x-mediflow-paired-client-token': confirmed.pairedClientToken, 'x-mediflow-expected-ambulatory-id': 'performance-baseline-ambulatory' };
  const detail = await request(`/api/v1/network/patients/${reference.referenceId}`, { headers: paired });
  const identity = (await request('/api/v1/network/identity', { headers: paired })).json;
  const tlsPin = createHash('sha256').update(new X509Certificate(fs.readFileSync(`${data}/local-api.crt`)).raw).digest('hex');
  const result = { platform, protocolVersion: confirmed.protocolVersion, serverURL: `https://${state.ip}:3543`, loopbackURL: 'https://127.0.0.1:3543', tlsPin, username: 'performance-baseline', operatorPin: '314159', ambulatoryId: 'performance-baseline-ambulatory', pairedClientId: confirmed.pairedClient.clientId, pairedClientToken: confirmed.pairedClientToken, grantedCapabilities: confirmed.pairedClient.grantedCapabilities, patientDetailStatus: detail.response.status, identity, reference, gpuiIdentifier: confirmed.pairedClient.clientId, gpuiPairingCode: confirmed.pairedClientToken };
  fs.writeFileSync(`${data}/pair-${platform}.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2];
    if (action === 'start') await start(); else if (action === 'stop') await stop(); else if (action === 'status') await status(); else if (action === 'pair') await pair(process.argv[3]); else throw new Error('Uso: banco.mjs start|stop|status|pair <platform>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
