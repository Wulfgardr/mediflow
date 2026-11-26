#!/usr/bin/env node

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { chromium } from '@playwright/test';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_SCRIPT = path.join(ROOT_DIR, 'scripts/seed-performance-baseline.mjs');
const RUN_STRIP_TYPES = path.join(ROOT_DIR, 'scripts/run-strip-types.mjs');
const PIN = '314159';

const THRESHOLDS = {
  300: { medianMs: 150, worstMs: 350 },
  3000: { medianMs: 300, worstMs: 600 },
  tabScalingDeltaMs: 50,
};

function parseArgs(argv) {
  const args = {
    volumes: [300, 3000],
    tabCounts: [1, 3, 6],
    runs: 20,
    idleSeconds: 35,
    bundleDir: path.join(ROOT_DIR, '.next/standalone'),
    out: null,
    assertThreshold: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--volumes') {
      args.volumes = (value ?? '').split(',').map((v) => Number.parseInt(v, 10)).filter((v) => Number.isSafeInteger(v) && v > 0);
      i += 1;
    } else if (flag === '--tabs') {
      args.tabCounts = (value ?? '').split(',').map((v) => Number.parseInt(v, 10)).filter((v) => Number.isSafeInteger(v) && v > 0);
      i += 1;
    } else if (flag === '--runs') {
      args.runs = Number.parseInt(value ?? '', 10);
      i += 1;
    } else if (flag === '--idle-seconds') {
      args.idleSeconds = Number.parseInt(value ?? '', 10);
      i += 1;
    } else if (flag === '--bundle-dir') {
      args.bundleDir = path.resolve(value ?? '');
      i += 1;
    } else if (flag === '--out') {
      args.out = path.resolve(value ?? '');
      i += 1;
    } else if (flag === '--assert-threshold') {
      args.assertThreshold = true;
    } else {
      throw new Error(`Argomento non riconosciuto: ${flag}`);
    }
  }
  return args;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function stats(values) {
  if (values.length === 0) return { count: 0, min: null, median: null, p95: null, max: null, mean: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  const mean = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;
  return {
    count: sorted.length,
    min: round(sorted[0]),
    median: round(median),
    p95: round(sorted[p95Index]),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
  };
}

function readUptime() {
  try {
    return execFileSync('uptime', { encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}

async function allocateFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  if (!port || port === 3000) throw new Error('Porta effimera non valida');
  return port;
}

function seedArchive(dataDir, patients) {
  const result = spawnSync(
    process.execPath,
    [
      RUN_STRIP_TYPES,
      SEED_SCRIPT,
      '--data-dir',
      dataDir,
      '--patients',
      String(patients),
      '--entries-per-patient',
      '8',
      '--observations-per-patient',
      '6',
      '--documents-per-patient',
      '2',
      '--force',
    ],
    {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_STRIP_TYPES_NODE: process.execPath },
    },
  );
  if (result.status !== 0) {
    throw new Error(`Seed fallito (${result.status}): ${result.stderr}`);
  }
  const dbPath = path.join(dataDir, 'medical.db');
  const db = new Database(dbPath);
  try {
    const insertTherapy = db.prepare(`
      INSERT INTO therapies (
        id, patient_id, drug_name, dosage, status, start_date, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, 1, ?, ?)
    `);
    const now = Math.floor(Date.parse('2026-07-17T08:00:00.000Z') / 1000);
    db.transaction(() => {
      for (let i = 0; i < patients; i += 1) {
        const pid = `perf-patient-${String(i).padStart(6, '0')}`;
        insertTherapy.run(`${pid}-therapy-00`, pid, 'Ramipril 5 mg', '1 cp al mattino', now - 86400 * 30, now - 86400 * 30, now - 86400 * 30);
        insertTherapy.run(`${pid}-therapy-01`, pid, 'Metformina 500 mg', '1 cp ai pasti', now - 86400 * 15, now - 86400 * 15, now - 86400 * 15);
      }
      db.prepare(`
        INSERT OR REPLACE INTO settings (key, value)
        VALUES ('work_profile_v1', ?)
      `).run(JSON.stringify({ active: 'medicina_generale', updatedAt: '2026-07-17T08:00:00.000Z' }));
    })();
    db.exec('ANALYZE');
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

function startProductionServer(bundleDir, port, dataDir) {
  const contract = JSON.parse(fs.readFileSync(path.join(bundleDir, 'mediflow-runtime-contract.json'), 'utf8'));
  const child = spawn(process.execPath, [path.join(bundleDir, 'server.js')], {
    cwd: bundleDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      MEDIFLOW_NEXT_DIST_DIR: contract.distDir,
      MEDIFLOW_DATA_DIR: dataDir,
      MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk.toString(); });
  child.stderr.on('data', (chunk) => { log += chunk.toString(); });
  return { child, getLog: () => log };
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server terminato con ${child.exitCode}`);
    try {
      const res = await fetch(`${url}/api/system/revision`, { cache: 'no-store' });
      if (res.ok) return;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timeout server su ${url}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function unlockApp(page, url) {
  await page.goto(`${url}/?area=incarico`, { waitUntil: 'domcontentloaded' });
  const pinInput = page.locator('input[type="password"], input[inputmode="numeric"]').first();
  await pinInput.waitFor({ state: 'visible', timeout: 20_000 });
  await pinInput.fill(PIN);
  const submit = page.getByRole('button', { name: /sblocca|accedi|entra/i }).first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  } else {
    await pinInput.press('Enter');
  }
  await page.getByTestId('lume-patient-row').first().waitFor({ state: 'visible', timeout: 30_000 });
}

async function openPatientTabs(page, url, count) {
  const openedIds = [];
  for (let i = 0; i < count; i += 1) {
    const pid = `perf-patient-${String(i).padStart(6, '0')}`;
    openedIds.push(pid);
    await page.goto(`${url}/patients/${pid}/modules`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('lume-scheda-header').waitFor({ state: 'visible', timeout: 20_000 });
  }
  return openedIds;
}

async function measureSingleReturn(page, cdp, triggerClick) {
  const requests = [];
  const inFlight = new Set();
  let clickTime = 0;
  let patientsResponseEnd = null;
  let checkupsResponseEnd = null;

  const onRequest = (req) => {
    if (!clickTime) return;
    const u = new URL(req.url());
    const isRelevant = u.pathname.startsWith('/api/') || u.searchParams.has('_rsc') || req.headers()['next-router-prefetch'] === '1' || req.headers()['rsc'] === '1';
    if (!isRelevant) return;
    inFlight.add(req);
    requests.push({
      req,
      method: req.method(),
      path: `${u.pathname}${u.search}`,
      isPrefetch: req.headers()['next-router-prefetch'] === '1',
      isRsc: u.searchParams.has('_rsc') || req.headers()['rsc'] === '1',
      startedMs: performance.now() - clickTime,
      finishedMs: null,
      status: null,
      bytes: 0,
      serverMs: null,
    });
  };

  const onResponse = async (res) => {
    const req = res.request();
    const entry = requests.find((r) => r.req === req);
    if (!entry) return;
    entry.status = res.status();
    try {
      const buf = await res.body();
      entry.bytes = buf.byteLength;
    } catch {
      entry.bytes = 0;
    }
    const now = performance.now() - clickTime;
    entry.finishedMs = now;
    entry.serverMs = round(now - entry.startedMs);
    if (entry.path === '/api/patients' || entry.path.startsWith('/api/patients?')) {
      patientsResponseEnd = now;
    }
    if (entry.path === '/api/checkups' || entry.path.startsWith('/api/checkups?')) {
      checkupsResponseEnd = now;
    }
  };

  const onDone = (req) => {
    inFlight.delete(req);
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);

  await page.evaluate(() => {
    window.__mfLongTasks = [];
    if (window.__mfLongTaskObserver) window.__mfLongTaskObserver.disconnect();
    window.__mfLongTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__mfLongTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    });
    try {
      window.__mfLongTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
    }
  });

  const beforeMetrics = await cdp.send('Performance.getMetrics');
  const metricMap = (m) => Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
  const mBefore = metricMap(beforeMetrics);

  clickTime = performance.now();
  await triggerClick();

  await page.getByTestId('lume-patient-row').first().waitFor({ state: 'visible', timeout: 30_000 });
  const listReadyMs = performance.now() - clickTime;

  await page.locator('[data-worklist-todo="ready"]').first().waitFor({ state: 'visible', timeout: 30_000 });
  const todosReadyMs = performance.now() - clickTime;

  const idleDeadline = Date.now() + 10_000;
  while (inFlight.size > 0 && Date.now() < idleDeadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const networkIdleMs = performance.now() - clickTime;

  const afterMetrics = await cdp.send('Performance.getMetrics');
  const mAfter = metricMap(afterMetrics);
  const longTasks = await page.evaluate(() => {
    if (window.__mfLongTaskObserver) window.__mfLongTaskObserver.disconnect();
    return window.__mfLongTasks || [];
  });

  page.off('request', onRequest);
  page.off('response', onResponse);
  page.off('requestfinished', onDone);
  page.off('requestfailed', onDone);

  const cleanRequests = requests.map(({ req: _req, ...rest }) => ({
    ...rest,
    startedMs: round(rest.startedMs),
    finishedMs: rest.finishedMs === null ? null : round(rest.finishedMs),
  }));

  return {
    listReadyMs: round(listReadyMs),
    todosReadyMs: round(todosReadyMs),
    networkIdleMs: round(networkIdleMs),
    patientsFetchEndMs: patientsResponseEnd === null ? null : round(patientsResponseEnd),
    clientPostPatientsMs: patientsResponseEnd === null ? null : round(listReadyMs - patientsResponseEnd),
    checkupsFetchEndMs: checkupsResponseEnd === null ? null : round(checkupsResponseEnd),
    clientPostCheckupsMs: checkupsResponseEnd === null ? null : round(todosReadyMs - checkupsResponseEnd),
    scriptDurationMs: round(((mAfter.ScriptDuration ?? 0) - (mBefore.ScriptDuration ?? 0)) * 1000),
    layoutDurationMs: round(((mAfter.LayoutDuration ?? 0) - (mBefore.LayoutDuration ?? 0)) * 1000),
    taskDurationMs: round(((mAfter.TaskDuration ?? 0) - (mBefore.TaskDuration ?? 0)) * 1000),
    longTaskCount: longTasks.length,
    longTaskTotalMs: round(longTasks.reduce((sum, t) => sum + t.duration, 0)),
    requestCount: cleanRequests.length,
    requests: cleanRequests,
  };
}

async function runVolume(args, patientCount) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mediflow-list-bench-${patientCount}-`));
  const dataDir = path.join(tempRoot, 'data');
  seedArchive(dataDir, patientCount);
  const port = await allocateFreePort();
  const url = `http://127.0.0.1:${port}`;
  const { child } = startProductionServer(args.bundleDir, port, dataDir);
  const volumeResult = { patients: patientCount, scenarios: {} };

  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    args: ['--proxy-server=http://127.0.0.1:1', `--proxy-bypass-list=<-loopback>;127.0.0.1:${port}`],
  });

  try {
    await waitForServer(child, url);

    for (const tabCount of args.tabCounts) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');

      await unlockApp(page, url);
      const openedIds = await openPatientTabs(page, url, tabCount);
      const lastPatientId = openedIds[openedIds.length - 1];
      const clickBackToList = () => page.locator('header nav[aria-label="Cartelle aperte"] a').first().click();
      const clickLastTab = () => page.locator(`header nav[aria-label="Cartelle aperte"] a[href="/patients/${lastPatientId}/modules"]`).first().click();

      const uptimeBefore = readUptime();
      const cold = await measureSingleReturn(page, cdp, clickBackToList);
      const warmSamples = [];
      for (let runIndex = 0; runIndex < args.runs; runIndex += 1) {
        await clickLastTab();
        await page.getByTestId('lume-scheda-header').waitFor({ state: 'visible', timeout: 20_000 });
        const sample = await measureSingleReturn(page, cdp, clickBackToList);
        warmSamples.push(sample);
      }
      const uptimeAfter = readUptime();

      volumeResult.scenarios[`tabs_${tabCount}`] = {
        tabs: tabCount,
        uptimeBefore,
        uptimeAfter,
        cold,
        warm: {
          listReadyMs: stats(warmSamples.map((s) => s.listReadyMs)),
          todosReadyMs: stats(warmSamples.map((s) => s.todosReadyMs)),
          networkIdleMs: stats(warmSamples.map((s) => s.networkIdleMs)),
          patientsFetchEndMs: stats(warmSamples.map((s) => s.patientsFetchEndMs).filter((v) => v !== null)),
          clientPostPatientsMs: stats(warmSamples.map((s) => s.clientPostPatientsMs).filter((v) => v !== null)),
          checkupsFetchEndMs: stats(warmSamples.map((s) => s.checkupsFetchEndMs).filter((v) => v !== null)),
          clientPostCheckupsMs: stats(warmSamples.map((s) => s.clientPostCheckupsMs).filter((v) => v !== null)),
          scriptDurationMs: stats(warmSamples.map((s) => s.scriptDurationMs)),
          layoutDurationMs: stats(warmSamples.map((s) => s.layoutDurationMs)),
          taskDurationMs: stats(warmSamples.map((s) => s.taskDurationMs)),
          longTaskTotalMs: stats(warmSamples.map((s) => s.longTaskTotalMs)),
          sampleRequestBreakdown: warmSamples[0]?.requests ?? [],
          rawListReadyMs: warmSamples.map((s) => s.listReadyMs),
          rawTodosReadyMs: warmSamples.map((s) => s.todosReadyMs),
        },
      };

      if (tabCount === args.tabCounts[args.tabCounts.length - 1]) {
        await clickLastTab();
        await page.getByTestId('lume-scheda-header').waitFor({ state: 'visible', timeout: 20_000 });
        await page.evaluate(async (pid) => {
          const res = await fetch('/api/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              patientId: pid,
              type: 'note',
              title: 'Nota sintetica post-scrittura',
              content: 'Testo sintetico per misura ritorno elenco dopo scrittura.',
              date: new Date().toISOString(),
            }),
          });
          if (!res.ok) throw new Error(`POST /api/entries failed: ${res.status}`);
        }, lastPatientId);
        const postWrite = await measureSingleReturn(page, cdp, clickBackToList);
        volumeResult.scenarios.post_write = { tabs: tabCount, uptime: readUptime(), sample: postWrite };

        if (args.idleSeconds > 0) {
          await clickLastTab();
          await page.getByTestId('lume-scheda-header').waitFor({ state: 'visible', timeout: 20_000 });
          await new Promise((r) => setTimeout(r, args.idleSeconds * 1000));
          const postIdle = await measureSingleReturn(page, cdp, clickBackToList);
          volumeResult.scenarios.post_idle = { tabs: tabCount, idleSeconds: args.idleSeconds, uptime: readUptime(), sample: postIdle };
        }
      }

      await context.close();
    }
  } finally {
    await browser.close();
    await stopServer(child);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  return volumeResult;
}

function printSummary(report) {
  console.log('\nVolume | Scenario | List mediana (ms) | List peggiore (ms) | Todos mediana (ms) | Todos peggiore (ms) | Script med (ms) | Fetch /patients (ms) | Client post-fetch (ms)');
  console.log('--- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---:');
  for (const vol of report.volumes) {
    for (const [name, sc] of Object.entries(vol.scenarios)) {
      if (sc.warm) {
        console.log(
          `${vol.patients} | ${name} (cold) | ${sc.cold.listReadyMs} | ${sc.cold.listReadyMs} | ${sc.cold.todosReadyMs} | ${sc.cold.todosReadyMs} | ${sc.cold.scriptDurationMs} | ${sc.cold.patientsFetchEndMs ?? '-'} | ${sc.cold.clientPostPatientsMs ?? '-'}`,
        );
        console.log(
          `${vol.patients} | ${name} (warm n=${sc.warm.listReadyMs.count}) | ${sc.warm.listReadyMs.median} | ${sc.warm.listReadyMs.max} | ${sc.warm.todosReadyMs.median} | ${sc.warm.todosReadyMs.max} | ${sc.warm.scriptDurationMs.median} | ${sc.warm.patientsFetchEndMs.median ?? '-'} | ${sc.warm.clientPostPatientsMs.median ?? '-'}`,
        );
      } else if (sc.sample) {
        const s = sc.sample;
        console.log(
          `${vol.patients} | ${name} | ${s.listReadyMs} | ${s.listReadyMs} | ${s.todosReadyMs} | ${s.todosReadyMs} | ${s.scriptDurationMs} | ${s.patientsFetchEndMs ?? '-'} | ${s.clientPostPatientsMs ?? '-'}`,
        );
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = {
    schemaVersion: 'mediflow.patient_list_return_benchmark.v1',
    measuredAt: new Date().toISOString(),
    gitHead: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim(),
    thresholds: THRESHOLDS,
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model ?? null,
      logicalCores: os.cpus().length,
      memoryGiB: round(os.totalmem() / 1024 ** 3),
    },
    volumes: [],
  };

  for (const volume of args.volumes) {
    report.volumes.push(await runVolume(args, volume));
  }

  printSummary(report);

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nReport salvato in ${args.out}`);
  }

  if (args.assertThreshold) {
    const violations = [];
    for (const vol of report.volumes) {
      const limit = THRESHOLDS[vol.patients];
      if (!limit) continue;
      for (const [name, sc] of Object.entries(vol.scenarios)) {
        if (!sc.warm) continue;
        if (sc.warm.listReadyMs.median > limit.medianMs) {
          violations.push(`${vol.patients} ${name}: listReadyMs mediana ${sc.warm.listReadyMs.median} ms > ${limit.medianMs} ms`);
        }
        if (sc.warm.listReadyMs.max > limit.worstMs) {
          violations.push(`${vol.patients} ${name}: listReadyMs peggiore ${sc.warm.listReadyMs.max} ms > ${limit.worstMs} ms`);
        }
      }
    }
    if (violations.length > 0) {
      console.error('\nSOGLIA SUPERATA:\n' + violations.join('\n'));
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(`[benchmark-patient-list-return] ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
