import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, openSync, closeSync, writeFileSync, lstatSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.versions.node.split('.')[0] !== '24') throw new Error('Usa Node 24.');
if (process.argv[2] === '--server') {
  const { default: next } = await import('next');
  const { createServer: createHttpServer } = await import('node:http');
  const port = Number(process.argv[3]);
  const app = next({ dev: true, hostname: '127.0.0.1', port, webpack: true });
  await app.prepare();
  const server = createHttpServer(app.getRequestHandler());
  server.listen(port, '127.0.0.1', () => console.log('GESTURE_SERVER_READY'));
  process.on('SIGTERM', async () => { server.closeAllConnections(); server.close(); await app.close(); process.exit(0); });
} else {
  const root = path.resolve(import.meta.dirname, '..');
  if (!lstatSync(path.join(root, 'node_modules')).isDirectory()) throw new Error('Serve node_modules reale: npm ci.');
  const evidence = path.resolve(process.env.GESTURE_OUTPUT_DIR || mkdtempSync(path.join(tmpdir(), 'mediflow-gestures-')));
  mkdirSync(evidence, { recursive: true });
  const data = mkdtempSync(path.join(tmpdir(), 'mediflow-gestures-data-'));
  writeFileSync(path.join(data, 'SYNTHETIC_ONLY'), 'Synthetic gesture measurement only.');
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const { port } = reservation.address();
  await new Promise(resolve => reservation.close(resolve));
  if (port === 11434) throw new Error('Porta riservata.');
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, MEDIFLOW_DATA_DIR: data, MEDIFLOW_E2E_DATA_DIR: data,
    MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', E2E_DISABLE_LEGACY_COPY: '1',
    MEDIFLOW_NEXT_DIST_DIR: '.next-twin-gestures', E2E_BASE_URL: url, E2E_GESTURES_SYNTHETIC: '1',
    GESTURE_RUNTIME: 'sviluppo', GESTURE_BUNDLER: 'webpack' };
  const run = (args, output) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', output, output] });
    child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
  });
  const seedLog = openSync(path.join(evidence, 'seed.log'), 'w');
  try { if (await run(['scripts/prepare-e2e-db.mjs'], seedLog)) throw new Error('Fixture non preparata.'); }
  finally { closeSync(seedLog); }
  // Run Next's server in this direct child, without the CLI's extra process.
  const tsconfigPath = path.join(root, 'tsconfig.json');
  const tsconfigBefore = readFileSync(tsconfigPath, 'utf8');
  const serverLog = openSync(path.join(evidence, 'server.log'), 'w');
  const server = spawn(process.execPath, [import.meta.filename, '--server', String(port)], { cwd: root, env, stdio: ['ignore', serverLog, serverLog] });
  const closed = new Promise(resolve => server.once('exit', resolve));
  const stop = () => { if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 180; attempt++) {
      if (server.exitCode !== null) throw new Error('Server terminato prima di essere pronto.');
      try { ready = (await fetch(`${url}/api/auth/check`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (ready) break;
      await delay(500);
    }
    if (!ready) throw new Error('Server non pronto.');
    const fixture = new Database(path.join(data, 'medical.db'));
    fixture.prepare("INSERT INTO drugs (aic,name,active_principle,name_search,active_principle_search,packaging,packaging_search) VALUES (?,?,?,?,?,?,?)").run('SYNTHETIC-GESTURES', 'MISURASTATINA 20 mg', 'Principio sintetico', 'misurastatina 20 mg', 'principio sintetico', '20 mg', '20 mg');
    fixture.close();
    const runs = Number(process.env.GESTURE_RUNS || '1');
    if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('Numero di esecuzioni non valido.');
    let firstCounts;
    const stability = [];
    for (let index = 1; index <= runs; index++) {
      env.GESTURE_RESULT_PATH = path.join(evidence, `conti-${index}.json`);
      const output = openSync(path.join(evidence, `run-${index}.log`), 'w');
      let status;
      try { status = await run(['node_modules/@playwright/test/cli.js', 'test', 'e2e/web-gestures.spec.ts', 'e2e/gesture-counter.spec.ts', '--workers=1', '--retries=0', '--reporter=list'], output); }
      finally { closeSync(output); }
      console.log(`Esecuzione ${index}: exit ${status}, ${evidence}/run-${index}.log`);
      if (status) { process.exitCode = status; break; }
      const report = JSON.parse(readFileSync(env.GESTURE_RESULT_PATH, 'utf8'));
      const counts = JSON.stringify(report.measurements.map(({ id, modo, gesti, clic, tasti, comandi }) => ({ id, modo, gesti, clic, tasti, comandi })));
      firstCounts ??= counts;
      if (counts !== firstCounts) throw new Error(`Conti diversi nell’esecuzione ${index}.`);
      stability.push({ run: index, durationMs: report.durationMs, identical: true, under90Seconds: report.durationMs < 90_000 });
      writeFileSync(path.join(evidence, 'stability.json'), JSON.stringify(stability, null, 2) + '\n');
    }
  } finally {
    stop();
    const force = setTimeout(() => { if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL'); }, 5000);
    await closed; clearTimeout(force); closeSync(serverLog);
    const after = readFileSync(tsconfigPath, 'utf8').replace(',\n    \".next-twin-gestures/types/**/*.ts\",\n    \".next-twin-gestures/dev/types/**/*.ts\"', '');
    if (after === tsconfigBefore) writeFileSync(tsconfigPath, tsconfigBefore);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    console.log(`Evidenze: ${evidence}; archivio sintetico: ${data}; PID ${server.pid} chiuso.`);
  }

}
