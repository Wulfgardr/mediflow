import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, openSync, closeSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

if (process.env.CI || process.env.PLAYWRIGHT_ALLOW_EXTERNAL_NETWORK === '1') throw new Error('Qualifica solo locale con rete del browser limitata al loopback');
if (!process.env.VISUAL_091_OUTPUT) throw new Error('Impostare VISUAL_091_OUTPUT a una nuova cartella esterna al repository');
const output = path.resolve(process.env.VISUAL_091_OUTPUT);
if (output.startsWith(process.cwd() + path.sep)) throw new Error('Le evidenze devono restare fuori dal repository');
mkdirSync(output, { recursive: false });
const temporary = mkdtempSync(path.join(tmpdir(), 'mediflow-visual-091-'));
const dist = `.next-visual-${path.basename(temporary)}`;
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const env = { ...process.env, MEDIFLOW_DATA_DIR: temporary, MEDIFLOW_E2E_DATA_DIR: temporary,
  MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1', MEDIFLOW_NEXT_DIST_DIR: dist,
  E2E_BASE_URL: `http://127.0.0.1:${port}`, VISUAL_091_OUTPUT: output, E2E_PIN: '1234' };
const run = (args, stdio = 'inherit') => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { env, stdio });
  child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
});
const log = openSync(path.join(output, 'server.log'), 'wx');
let server;
const started = Date.now();
try {
  if (await run(['scripts/prepare-e2e-db.mjs'])) throw new Error('Preparazione archivio fallita');
  writeFileSync(path.join(temporary, 'SYNTHETIC_ONLY'), 'Qualifica visiva sintetica');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--turbopack', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: ['ignore', log, log] });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('Server terminato prima della disponibilità');
    try { ready = (await fetch(`${env.E2E_BASE_URL}/api/system/revision`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Server non disponibile');
  process.exitCode = await run(['node_modules/@playwright/test/cli.js', 'test', '--config', 'visual-qualification/playwright.config.ts', ...process.argv.slice(2)]);
} finally {
  if (server) {
    const closed = new Promise(resolve => server.once('close', resolve));
    server.kill('SIGTERM');
    const force = setTimeout(() => server.kill('SIGKILL'), 5000);
    await closed; clearTimeout(force);
  }
  closeSync(log);
  rmSync(temporary, { recursive: true, force: true });
  rmSync(dist, { recursive: true, force: true });
  const config = readFileSync('tsconfig.json', 'utf8');
  const parsed = JSON.parse(config);
  parsed.include = parsed.include.filter(value => !value.startsWith(dist + '/'));
  writeFileSync('tsconfig.json', JSON.stringify(parsed, null, 2) + '\n');
  const files = [];
  const inventory = folder => { for (const name of readdirSync(folder)) {
    const file = path.join(folder, name); if (statSync(file).isDirectory()) inventory(file);
    else files.push({ file: path.relative(output, file), bytes: statSync(file).size });
  } };
  inventory(output);
  const receipt = { seconds: (Date.now() - started) / 1000, exitCode: process.exitCode ?? 1, files };
  writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}
