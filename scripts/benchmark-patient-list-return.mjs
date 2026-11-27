#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { chromium, expect } from '@playwright/test';
import encryptedFields from '../lib/backup-encrypted-fields.json' with { type: 'json' };
import { stopServer, trackClose } from '../visual-qualification/owned-server.mjs';
import './register-strip-types-loader.mjs';

const { documentRequests } = await import('../e2e/fixtures/trusted-web-request.ts');
const { isolatedChromeLaunch } = await import('../e2e/fixtures/secure-browser.ts');
const { encryptData } = await import('../lib/security/security.ts');
const { bootstrapUnlockedSession, onboardingPassphrase, unlockIfNeeded } = await import('../e2e/utils.ts');
const { deriveUnlockMaterial, openUnlockWrapping } = await import('../lib/security/unlock-credential.ts');

if (process.versions.node.split('.')[0] !== '24') throw new Error('Use the supported Node 24 runtime');

const root = path.resolve(import.meta.dirname, '..');
const pin = '314159';
const diagnosis = 'Diagnosi sintetica indice';
const limits = { 300: [150, 350], 3000: [300, 600] };
const tabDeltaLimit = 50;
const rowSelector = '[data-testid="lume-patient-row"]';
const tabSelector = 'nav[aria-label="Cartelle aperte"] a';
const sheetSelector = '[data-testid="lume-scheda-header"]';
const note = { type: 'note', title: 'Visita sintetica', content: 'Decorso sintetico. '.repeat(64) };
const attachmentText = 'Synthetic patient attachment';
const { values } = parseArgs({ options: {
  volumes: { type: 'string', default: '300,3000' },
  tabs: { type: 'string', default: '1,3,6' },
  runs: { type: 'string', default: '20' },
  'idle-runs': { type: 'string', default: '1' },
  'idle-seconds': { type: 'string', default: '120' },
  'bundle-dir': { type: 'string', default: path.join(root, '.next/standalone') },
  out: { type: 'string' },
  'server-profile': { type: 'boolean' },
  'skip-write': { type: 'boolean' },
  variants: { type: 'string', default: 'stock' },
  'assert-threshold': { type: 'boolean' },
} });

function integers(value, minimum) {
  const numbers = value.split(',').map(Number);
  if (numbers.some(n => !Number.isSafeInteger(n) || n < minimum)) throw new Error('Invalid integer list: ' + value);
  return numbers;
}
const volumes = integers(values.volumes, 6);
const tabCounts = integers(values.tabs, 1);
const variants = values.variants.split(',');
if (variants.some(variant => !['stock', 'reuse'].includes(variant))) throw new Error('Invalid variant');
const [runs] = integers(values.runs, 1);
const [idleRuns] = integers(values['idle-runs'], 0);
const [idleSeconds] = integers(values['idle-seconds'], 0);
if (values['assert-threshold'] && (values['skip-write'] || variants.length !== 1 || variants[0] !== 'stock' || runs < 20 || volumes.some(volume => !limits[volume]))) {
  throw new Error('Threshold verification needs at least 20 runs and a declared archive size');
}

function stats(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    max: sorted.at(-1),
  };
}
const uptime = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const patientName = index => 'Sintetico' + String(index).padStart(5, '0');

async function freePort() {
  const socket = net.createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  if (port === 3000) throw new Error('Porta riservata');
  return port;
}

async function start(dataDir, port) {
  const bundle = path.resolve(values['bundle-dir']);
  const contract = JSON.parse(await readFile(path.join(bundle, 'mediflow-runtime-contract.json'), 'utf8'));
  const identity = JSON.parse(await readFile(path.join(bundle, 'mediflow-build-identity.json'), 'utf8'));
  const serverArgs = values['server-profile'] ? ['--require', path.join(import.meta.dirname, 'benchmark-patient-list-server-probe.cjs')] : [];
  return spawn(process.execPath, [...serverArgs, 'server.js'], {
    cwd: bundle,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      MEDIFLOW_APP_REVISION: identity.revision, MEDIFLOW_APP_SOURCE_FINGERPRINT: identity.sourceFingerprint,
      MEDIFLOW_NEXT_DIST_DIR: contract.distDir, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' },
  });
}

async function waitForServer(child, origin) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Server exited: ' + child.exitCode);
    if ((await fetch(origin + '/api/system/revision', { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok) return;
    await sleep(200);
  }
  throw new Error('Production server did not become ready');
}

async function post(page, route, body) {
  const response = await documentRequests(page).post(route, { data: body });
  if (!response.ok()) throw new Error(route + ' ' + response.status() + ' ' + await response.text());
  return response.json();
}

async function seal(key, table, body) {
  for (const field of encryptedFields[table]) {
    if (!body[field]) continue;
    const { iv, data } = await encryptData(body[field], key);
    body[field] = `ENC:${iv}:${data}`;
  }
  return body;
}

async function addNote(page, key, patientId) {
  await post(page, '/api/entries', await seal(key, 'entries', { ...note, patientId, date: new Date().toISOString() }));
}

async function seed(page, count) {
  const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' && response.ok());
  await bootstrapUnlockedSession(page, pin);
  const { encryptedMasterKey, salt } = await (await loginResponse).json();
  const { kek } = await deriveUnlockMaterial(onboardingPassphrase(pin), Buffer.from(salt, 'base64'));
  const key = await openUnlockWrapping(encryptedMasterKey, kek);
  for (let n = 0; n < count; n++) {
    const { id } = await post(page, '/api/patients', await seal(key, 'patients', {
      firstName: 'Ada', lastName: patientName(n), taxCode: 'SYNTHETIC-RETURN-' + n,
      birthDate: '1980-12-31', address: 'Indirizzo sintetico', phone: '0000000000',
      notes: 'Profilo sintetico. '.repeat(32), diagnoses: [{ code: 'R69', description: diagnosis, date: '2026-10-01' }],
    }));
    await addNote(page, key, id);
    await addNote(page, key, id);
    await post(page, '/api/therapies', await seal(key, 'therapies', {
      patientId: id, drugName: 'Terapia sintetica', dosage: 'Dose sintetica', status: 'active',
      startDate: '2026-07-17T08:00:00.000Z', motivation: 'Motivazione sintetica',
    }));
    await post(page, '/api/attachments', await seal(key, 'attachments', {
      id: crypto.randomUUID(), patientId: id, name: 'Documento sintetico.txt', type: 'text/plain',
      size: attachmentText.length, path: 'uploads/synthetic.txt',
      data: 'data:text/plain;base64,' + Buffer.from(attachmentText).toString('base64'),
    }));
    if (n % 4 === 0) {
      await post(page, '/api/checkups', await seal(key, 'checkups', {
        patientId: id, title: 'Richiamo sintetico', date: '2027-01-10T09:00:00.000Z', status: 'pending',
        source: 'manual', notes: 'Nota sintetica del controllo',
      }));
    }
    if ((n + 1) % 100 === 0) console.log(`Seed ${n + 1}/${count}`);
  }
  const patients = await documentRequests(page).get('/api/patients');
  if (!patients.ok() || (await patients.json()).length !== count) throw new Error('Fixture list is incomplete');
}

function installProbe({ rowSelector, tabSelector, variant, diagnosis }) {
  const network = [];
  const tasks = [];
  const unlockDerivations = [];
  const server = performance.timeOrigin;
  const subtle = Object.getPrototypeOf(crypto.subtle);
  const decrypt = subtle.decrypt;
  let sample;
  let reusableFormatter;
  Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
    construct(target, args, newTarget) {
      const [locale, options] = args;
      if (locale !== 'it-IT' || options?.day !== '2-digit' || options?.month !== 'short' ||
          Object.keys(options).length !== 2) return Reflect.construct(target, args, newTarget);
      const start = performance.now();
      const formatter = variant === 'reuse'
        ? (reusableFormatter ??= Reflect.construct(target, args, newTarget))
        : Reflect.construct(target, args, newTarget);
      if (sample?.start !== undefined && sample.end === undefined) {
        sample.formatterCalls++;
        sample.formatterMs += performance.now() - start;
      }
      return formatter;
    },
  });
  const observe = (type, callback) => {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
    new PerformanceObserver(list => list.getEntries().forEach(callback)).observe({ type });
  };
  observe('resource', entry => {
    const url = new URL(entry.name);
    if (url.origin !== location.origin || !(url.pathname.startsWith('/api/') || url.searchParams.has('_rsc'))) return;
    network.push({
      path: url.pathname.replace(/\/patients\/[^/]+/, '/patients/:id'),
      rsc: url.searchParams.has('_rsc'), start: entry.startTime, firstByte: entry.responseStart,
      end: entry.responseEnd, bytes: entry.encodedBodySize, status: entry.responseStatus,
    });
  });
  observe('longtask', entry => tasks.push({ start: entry.startTime, duration: entry.duration }));
  subtle.decrypt = function (...args) {
    const start = performance.now();
    const measured = sample?.start !== undefined && sample.end === undefined ? sample : null;
    const pending = decrypt.apply(this, args);
    if (!measured) return pending;
    measured.decryptCount++;
    measured.decryptStart ??= start;
    return pending.finally(() => { measured.decryptEnd = performance.now(); });
  };
  const deriveBits = subtle.deriveBits;
  subtle.deriveBits = function (algorithm, ...args) {
    const start = performance.now();
    const pending = deriveBits.call(this, algorithm, ...args);
    if (algorithm.name === 'PBKDF2') {
      void pending.then(() => { unlockDerivations.push(performance.now() - start); }, () => {});
    }
    return pending;
  };
  window.__listProbe = {
    unlock: () => [...unlockDerivations],
    debug: () => ({ sample, timeOrigin: server, requests: network.slice(-8) }),
    activity: start => ({
      api: network.filter(entry => entry.start >= start),
      tasks: tasks.filter(entry => entry.start >= start),
    }),
    arm: () => {
      sample = { decryptCount: 0, formatterCalls: 0, formatterMs: 0 };
    },
    take: () => sample?.end === undefined ? null : {
      ...sample,
      timestamp: server + sample.start,
      ms: sample.end - sample.start,
      network: network.filter(entry => entry.end >= sample.start - 1000 && entry.start <= sample.end)
        .map(entry => ({ ...entry, start: entry.start - sample.start, firstByte: entry.firstByte - sample.start, end: entry.end - sample.start })),
      tasks: tasks.filter(entry => entry.start + entry.duration >= sample.start && entry.start < sample.end),
    },
  };
  document.addEventListener('click', event => {
    if (!sample || sample.start !== undefined || !event.target.closest(tabSelector + ':first-child')) return;
    sample.start = performance.now();
    const measured = sample;
    let confirmed = false;
    function frame() {
      if (sample !== measured) return;
      const rows = document.querySelectorAll(rowSelector);
      const search = document.querySelector('#ricerca-pazienti');
      const eligible = search && !search.disabled &&
        !document.querySelector('[aria-label="MediFlow lock screen"]');
      if (eligible) {
        const rowHit = Array.from(rows).some(row => {
          if (!row.textContent.includes(diagnosis)) return false;
          const box = row.getBoundingClientRect();
          return row.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        });
        if (rowHit) {
          if (confirmed) {
            sample.end = performance.now();
            return;
          }
          confirmed = true;
          requestAnimationFrame(frame);
          return;
        }
      }
      confirmed = false;
      if (performance.now() - sample.start < 20000) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }, true);
}

async function openTabs(page, count) {
  const rows = page.locator(rowSelector);
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(count);
  const patients = await rows.evaluateAll((rows, limit) =>
    rows.slice(0, limit).map(row => ({ id: row.dataset.patientId, name: row.querySelector('strong').textContent })), count);
  if (patients.length !== count) throw new Error('Too few patient rows to open ' + count + ' charts');
  for (const [index, { id, name }] of patients.entries()) {
    const row = page.locator(rowSelector + `[data-patient-id="${id}"]`);
    await row.dblclick();
    await expect(page.locator(sheetSelector)).toContainText(name);
    await expect(page.locator(tabSelector + `[href="/patients/${id}/modules"]`)).toBeVisible();
    if (index + 1 < count) await page.locator(tabSelector).first().click();
  }
  await expect(page.locator(tabSelector + '[href$="/modules"]')).toHaveCount(count);
  return patients.at(-1);
}

async function measure(page, cdp, serverRequests) {
  const prefetch = [];
  const listener = request => {
    if (request.headers()['next-router-prefetch'] === '1' || request.headers()['next-router-segment-prefetch']) {
      prefetch.push(new URL(request.url()).pathname.replace(/\/patients\/[^/]+/, '/patients/:id'));
    }
  };
  const getMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
  page.on('request', listener);
  try {
    const before = await getMetrics();
    await page.evaluate(() => window.__listProbe.arm());
    await page.locator(tabSelector).first().click();
    const handle = await page.waitForFunction(() => window.__listProbe?.take(), undefined, { timeout: 21000 });
    const sample = await handle.jsonValue();
    await handle.dispose();
    const after = await getMetrics();
    const metrics = Object.fromEntries(['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration']
      .map(name => [name, (after[name] - before[name]) * 1000]));
    return {
      ...sample, metrics, prefetch,
      server: serverRequests.filter(request => request.timestamp <= sample.timestamp + sample.ms &&
        request.timestamp + request.ms >= sample.timestamp - 1000),
    };
  } catch (error) {
    console.error(await page.evaluate(({ rowSelector, tabSelector }) => ({
      href: location.pathname + location.search,
      tab: document.querySelector(tabSelector)?.getAttribute('href'),
      rows: [...document.querySelectorAll(rowSelector)].slice(0, 4).map(row => {
        const box = row.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { text: row.textContent, box: box.toJSON(), receivesPointer: row.contains(hit), hit: hit?.className };
      }),
      search: document.querySelector('#ricerca-pazienti')?.outerHTML,
      probe: window.__listProbe?.debug(),
    }), { rowSelector, tabSelector }).catch(() => null));
    throw error;
  } finally {
    page.off('request', listener);
  }
}

async function runVolume(count) {
  const data = await mkdtemp(path.join(os.tmpdir(), 'mediflow-wul970-'));
  let server;
  let closed;
  let browser;
  try {
    const port = await freePort();
    const origin = 'http://127.0.0.1:' + port;
    server = await start(data, port);
    closed = trackClose(server);
    const serverRequests = [];
    server.on('message', request => {
      serverRequests.push(request);
      if (serverRequests.length > 2000) serverRequests.shift();
    });
    await waitForServer(server, origin);
    const revision = await (await fetch(origin + '/api/system/revision')).json();
    const scenarios = [];
    report.volumes.push({ count, revision, scenarios });
    browser = await chromium.launch(isolatedChromeLaunch(origin));
    const newContext = () => browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 960 } });
    const setup = await newContext();
    await seed(await setup.newPage(), count);
    await setup.close();

    for (const variant of variants) for (const tabs of tabCounts) {
      const series = { tabs, variant, startLoad: uptime(), warm: [], cold: [], postWrite: [], idle: [], idleActivity: [], unlockMs: [], unlockDerivations: [] };
      for (let iteration = 0; iteration < runs; iteration++) {
        const ctx = await newContext();
        try {
          await ctx.addInitScript(installProbe, { rowSelector, tabSelector, variant, diagnosis });
          const page = await ctx.newPage();
          const cdp = await ctx.newCDPSession(page);
          await cdp.send('Performance.enable');
          await page.goto('/?area=incarico');
          await page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true }).waitFor();
          const unlockStart = performance.now();
          await unlockIfNeeded(page, pin);
          series.unlockMs.push(performance.now() - unlockStart);
          series.unlockDerivations.push(await page.evaluate(() => window.__listProbe.unlock()));
          await page.locator(rowSelector).first().waitFor();
          const { id, name } = await openTabs(page, tabs);
          const last = page.locator(tabSelector + `[href="/patients/${id}/modules"]`);
          const reopen = async () => {
            await last.click();
            await expect(page.locator(sheetSelector)).toContainText(name);
          };
          series.cold.push(await measure(page, cdp, serverRequests));
          await reopen();
          series.warm.push(await measure(page, cdp, serverRequests));
          if (!values['skip-write']) {
            await reopen();
            await page.getByRole('link', { name: 'Nuova voce', exact: true }).click();
            await page.getByRole('textbox', { name: 'Resoconto clinico', exact: true }).fill('Resoconto sintetico per il banco di misura.');
            await page.getByRole('button', { name: 'Rivedi', exact: true }).click();
            await page.getByRole('button', { name: 'Conferma e registra', exact: true }).click();
            await expect(page.getByRole('region', { name: 'Esito della registrazione' })).toContainText('Registrata alle');
            await page.getByRole('link', { name: 'Chiudi la voce', exact: true }).click();
            series.postWrite.push(await measure(page, cdp, serverRequests));
          }
          if (iteration < idleRuns && idleSeconds) {
            await reopen();
            const startLoad = uptime();
            const idleStart = await page.evaluate(() => performance.now());
            await sleep(idleSeconds * 1000);
            const activity = await page.evaluate(start => window.__listProbe.activity(start), idleStart);
            series.idle.push(await measure(page, cdp, serverRequests));
            series.idleActivity.push({ startLoad, endLoad: uptime(), ...activity });
          }
        } finally {
          await ctx.close();
        }
        if ((iteration + 1) % 5 === 0) console.log(`Cohort ${count}/${tabs}/${variant}: ${iteration + 1}/${runs}`);
      }
      series.endLoad = uptime();
      const context = await newContext();
      try {
        const page = await context.newPage();
        await page.goto('/?area=incarico');
        await page.getByRole('heading', { name: 'Sblocca MediFlow', exact: true }).waitFor();
        await unlockIfNeeded(page, pin);
        const search = page.locator('#ricerca-pazienti');
        await search.fill(patientName(Math.floor(count / 2)));
        await expect(page.locator(rowSelector)).toHaveCount(1);
        await expect(page.locator(rowSelector)).toContainText(patientName(Math.floor(count / 2)));
      } finally {
        await context.close();
      }
      for (const stage of ['cold', 'warm', 'postWrite', 'idle']) {
        const result = stats(series[stage].map(sample => sample.ms));
        if (result) console.log(`| ${count} | ${tabs} | ${variant}/${stage} | ${result.n} | ${result.median.toFixed(1)} | ${result.max.toFixed(1)} |`);
      }
      scenarios.push(series);
      if (values.out) await writeFile(values.out, JSON.stringify(report, null, 2) + '\n');
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      if (server) await stopServer(server, closed);
      await rm(data, { recursive: true, force: true });
    }
  }
}

const report = { limits, tabDeltaLimit, serverProfile: Boolean(values['server-profile']), postWrite: !values['skip-write'], idleRuns, idleSeconds, node: process.version, machine: os.cpus()[0]?.model, volumes: [] };
console.log('| Pazienti | Cartelle | Scenario | n | Mediana (ms) | Peggiore (ms) |');
console.log('| ---: | ---: | --- | ---: | ---: | ---: |');
for (const count of volumes) await runVolume(count);
if (values['assert-threshold']) {
  for (const { count, scenarios } of report.volumes) {
    const [medianLimit, maxLimit] = limits[count];
    const warmByTabs = new Map();
    for (const { tabs, cold, warm, postWrite } of scenarios) {
      warmByTabs.set(tabs, stats(warm.map(sample => sample.ms)).median);
      for (const [stage, samples] of Object.entries({ cold, warm, postWrite })) {
        const { median, max } = stats(samples.map(sample => sample.ms));
        if (median > medianLimit || max > maxLimit) {
          console.error(`Soglia superata: ${count}/${tabs}/${stage}, ${median} ms mediana, ${max} ms massimo`);
          process.exitCode = 1;
        }
      }
    }
    if (warmByTabs.get(6) - warmByTabs.get(1) > tabDeltaLimit) {
      console.error(`Soglia di scala superata con ${count} pazienti`);
      process.exitCode = 1;
    }
  }
}
