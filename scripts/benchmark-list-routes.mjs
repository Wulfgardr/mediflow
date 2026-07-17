#!/usr/bin/env node
/* @Codex */

import { spawn } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_STRIP_TYPES = path.join(ROOT_DIR, 'scripts/run-strip-types.mjs');
const SEED_SCRIPT = path.join(ROOT_DIR, 'scripts/seed-performance-baseline.mjs');
const FIXTURE_KEY = Buffer.from('83c4f061bfd9c7d14fe63f7566fc0aa980b16019d8d8ab4a8ef971b52508b6db', 'hex');
const LOGIN = { username: 'performance-baseline', password: '314159' };
const ROUTES = [
  { id: 'patients', path: '/api/patients' },
  { id: 'entries', path: '/api/entries' },
  { id: 'observations', path: '/api/observations' },
  { id: 'documents', path: '/api/attachments?metadataOnly=true' },
];

function parseArgs(argv) {
  const args = {
    volumes: [200, 2000],
    runs: 7,
    port: 3113,
    out: path.join(ROOT_DIR, 'docs/analysis/2026-07-17-baseline-performance.json'),
    // Keep the absolute path below the macOS Unix-socket limit used by PM2.
    dataRoot: path.join(ROOT_DIR, 'tmp-perf'),
    distDir: '.next-performance-baseline',
    skipBuild: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--skip-build') args.skipBuild = true;
    else if (flag === '--volumes') {
      args.volumes = (value ?? '').split(',').map((item) => Number.parseInt(item, 10));
      index += 1;
    } else if (flag === '--runs') { args.runs = Number.parseInt(value ?? '', 10); index += 1; }
    else if (flag === '--port') { args.port = Number.parseInt(value ?? '', 10); index += 1; }
    else if (flag === '--out') { args.out = path.resolve(value ?? ''); index += 1; }
    else if (flag === '--data-root') { args.dataRoot = path.resolve(value ?? ''); index += 1; }
    else if (flag === '--dist-dir') { args.distDir = value ?? ''; index += 1; }
    else throw new Error(`Argomento non riconosciuto: ${flag}`);
  }
  if (args.runs < 5 || !Number.isSafeInteger(args.runs)) throw new Error('--runs deve essere un intero >= 5');
  if (args.port < 1024 || args.port > 65535) throw new Error('--port deve essere compresa tra 1024 e 65535');
  if (!args.volumes.length || args.volumes.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error('--volumes richiede interi positivi separati da virgola');
  }
  if (!args.distDir || path.isAbsolute(args.distDir) || args.distDir.includes('..')) {
    throw new Error('--dist-dir deve essere un path relativo interno al repository');
  }
  return args;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT_DIR, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(command)} ${commandArgs.join(' ')} terminato con ${signal ?? code}`)));
  });
}

function isPortOccupied(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', (error) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
}

async function seedVolume(dataDir, patients) {
  await run(process.execPath, [
    RUN_STRIP_TYPES,
    SEED_SCRIPT,
    '--data-dir', dataDir,
    '--patients', String(patients),
    '--entries-per-patient', '8',
    '--observations-per-patient', '6',
    '--documents-per-patient', '2',
    '--force',
  ]);
}

function startServer(args, dataDir) {
  const standaloneRoot = path.join(ROOT_DIR, args.distDir, 'standalone');
  return spawn(process.execPath, [path.join(standaloneRoot, 'server.js')], {
    cwd: standaloneRoot,
    env: {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      PORT: String(args.port),
      MEDIFLOW_DATA_DIR: dataDir,
      MEDIFLOW_NEXT_DIST_DIR: args.distDir,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

async function waitForServer(server, baseUrl) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Il server benchmark e terminato con ${server.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/auth/check`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      // Avvio non ancora completato.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timeout in attesa del server benchmark su ${baseUrl}`);
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(LOGIN),
  });
  if (!response.ok) throw new Error(`Login benchmark fallito: ${response.status} ${await response.text()}`);
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('Il login benchmark non ha restituito il cookie di sessione');
  return setCookie.split(';', 1)[0];
}

function decryptFixture(value) {
  const [, ivBase64, encryptedBase64] = value.split(':', 3);
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', FIXTURE_KEY, Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(encrypted.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'));
}

function simulateClientDecryption(payload) {
  let encryptedFields = 0;
  const visit = (value) => {
    if (typeof value === 'string' && value.startsWith('ENC:')) {
      decryptFixture(value);
      encryptedFields += 1;
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(payload);
  return encryptedFields;
}

async function measureRequest(baseUrl, route, cookie) {
  const requestStartedAt = performance.now();
  const response = await fetch(`${baseUrl}${route.path}`, {
    headers: { Cookie: cookie, 'Cache-Control': 'no-cache' },
    cache: 'no-store',
  });
  const body = Buffer.from(await response.arrayBuffer());
  const routeMs = performance.now() - requestStartedAt;
  if (!response.ok) throw new Error(`${route.path} ha risposto ${response.status}: ${body.toString('utf8')}`);

  const decryptStartedAt = performance.now();
  const payload = JSON.parse(body.toString('utf8'));
  const encryptedFields = simulateClientDecryption(payload);
  const clientDecryptMs = performance.now() - decryptStartedAt;
  return {
    routeMs: Number(routeMs.toFixed(3)),
    clientDecryptMs: Number(clientDecryptMs.toFixed(3)),
    payloadBytes: body.byteLength,
    records: Array.isArray(payload) ? payload.length : 1,
    encryptedFields,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function measureRoutes(baseUrl, cookie, runs) {
  const routeResults = {};
  for (const route of ROUTES) {
    await measureRequest(baseUrl, route, cookie);
    const samples = [];
    for (let index = 0; index < runs; index += 1) samples.push(await measureRequest(baseUrl, route, cookie));
    routeResults[route.id] = {
      path: route.path,
      warmupRunsExcluded: 1,
      samples,
      median: {
        routeMs: Number(median(samples.map((sample) => sample.routeMs)).toFixed(3)),
        clientDecryptMs: Number(median(samples.map((sample) => sample.clientDecryptMs)).toFixed(3)),
        payloadBytes: median(samples.map((sample) => sample.payloadBytes)),
        records: median(samples.map((sample) => sample.records)),
        encryptedFields: median(samples.map((sample) => sample.encryptedFields)),
      },
    };
  }
  return routeResults;
}

function sysctl(name) {
  try { return execFileSync('sysctl', ['-n', name], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

function gitValue(args) {
  return execFileSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
}

function printTable(volumes) {
  console.log('\nVolume | Route | Record | Payload | Route mediana | Decifratura mediana');
  console.log('--- | --- | ---: | ---: | ---: | ---:');
  for (const volume of volumes) {
    for (const [route, result] of Object.entries(volume.routes)) {
      console.log(`${volume.patients} | ${route} | ${result.median.records} | ${result.median.payloadBytes} B | ${result.median.routeMs} ms | ${result.median.clientDecryptMs} ms`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (await isPortOccupied(args.port)) {
    throw new Error(`porta dedicata ${args.port} gia occupata: nessun benchmark e stato avviato`);
  }
  const tsconfigPath = path.join(ROOT_DIR, 'tsconfig.json');
  const originalTsconfig = fs.readFileSync(tsconfigPath, 'utf8');
  try {
  fs.mkdirSync(args.dataRoot, { recursive: true });
  const seeded = [];
  for (const patients of args.volumes) {
    const dataDir = path.join(args.dataRoot, `p${patients}`);
    await seedVolume(dataDir, patients);
    seeded.push({ patients, dataDir });
  }

  if (!args.skipBuild) {
    fs.rmSync(path.join(ROOT_DIR, args.distDir), { recursive: true, force: true });
    await run(process.execPath, [path.join(ROOT_DIR, 'node_modules/next/dist/bin/next'), 'build'], {
      env: { ...process.env, MEDIFLOW_DATA_DIR: seeded[0].dataDir, MEDIFLOW_NEXT_DIST_DIR: args.distDir },
    });
  }

  const baseUrl = `http://127.0.0.1:${args.port}`;
  const volumes = [];
  for (const volume of seeded) {
    let server;
    try {
      server = startServer(args, volume.dataDir);
      await waitForServer(server, baseUrl);
      const cookie = await login(baseUrl);
      volumes.push({ patients: volume.patients, routes: await measureRoutes(baseUrl, cookie, args.runs) });
    } finally {
      await stopServer(server);
    }
  }

  const report = {
    schemaVersion: 'mediflow.list_route_performance_baseline.v1',
    measuredAt: new Date().toISOString(),
    git: { head: gitValue(['rev-parse', 'HEAD']), base: gitValue(['merge-base', 'HEAD', 'origin/main']) },
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      hardwareModel: sysctl('hw.model'),
      cpu: os.cpus()[0]?.model ?? null,
      logicalCores: os.cpus().length,
      memoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    },
    protocol: {
      server: 'Next.js standalone production server',
      host: '127.0.0.1',
      port: args.port,
      measuredRuns: args.runs,
      warmupRunsExcludedPerRoute: 1,
      statistic: 'median',
      seed: 'mediflow-performance-2026-07-17',
      rowsPerPatient: { entries: 8, observations: 6, documents: 2 },
      documentRouteUsesMetadataOnly: true,
      clientCost: 'JSON.parse + AES-256-GCM Node simulation for every ENC field',
    },
    volumes,
  };
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  printTable(volumes);
  console.log(`\nBaseline JSON scritta in ${args.out}`);
  } finally {
    if (fs.readFileSync(tsconfigPath, 'utf8') !== originalTsconfig) {
      fs.writeFileSync(tsconfigPath, originalTsconfig);
    }
    if (!args.skipBuild) fs.rmSync(path.join(ROOT_DIR, args.distDir), { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[performance-baseline] ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
