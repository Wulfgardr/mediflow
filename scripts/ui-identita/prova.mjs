// Identità UI senza il disco Vision: banco sintetico in una cartella temporanea
// sul disco interno (APFS), porte libere scelte al momento, solo loopback.
// Avvia il banco, esegue web-regression, arresta il banco anche se la prova fallisce.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reserved = new Set([3000, 3443, 11434, 11435]);

async function freePort() {
  for (;;) {
    const server = net.createServer();
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    await new Promise(resolve => server.close(resolve));
    if (port >= 1024 && !reserved.has(port)) return port;
  }
}

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'mf-identita-ui-')));
const httpPort = await freePort();
let tlsPort = await freePort();
while (tlsPort === httpPort) tlsPort = await freePort();
const env = {
  ...process.env,
  MF_BANCO_SCRATCH: scratch,
  MEDIFLOW_DATA_DIR: path.join(scratch, 'banco'),
  MF_BANCO_HTTP_PORT: String(httpPort),
  MF_BANCO_TLS_PORT: String(tlsPort),
  MF_BANCO_LOCAL_ONLY: '1',
  MF_BANCO_ARTIFACTS: path.join(scratch, 'prove'),
};
const banco = action => spawnSync(process.execPath, ['scripts/ui-identita/banco.mjs', action], { cwd: root, env, stdio: 'inherit' });

let code = 1;
try {
  const started = banco('start');
  if (started.status !== 0) throw new Error(`banco non avviato; log in ${env.MEDIFLOW_DATA_DIR}`);
  // next dev compila ogni pagina alla prima richiesta: senza riscaldamento il primo test
  // trova la schermata di sblocco ancora in idratazione (pulsanti disabilitati).
  const { referenceId } = JSON.parse(readFileSync(path.join(env.MEDIFLOW_DATA_DIR, 'reference.json'), 'utf8'));
  for (const route of ['/', '/?area=incarico', '/settings', `/patients/${referenceId}/modules`, `/patients/${referenceId}/entries/new`]) {
    await fetch(`http://127.0.0.1:${httpPort}${route}`).then(response => response.arrayBuffer());
  }
  const playwright = spawnSync(process.execPath, [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test', '-c', 'scripts/ui-identita/playwright.config.ts', 'web-regression'], { cwd: root, env, stdio: 'inherit' });
  code = playwright.status ?? 1;
} catch (error) {
  console.error(error.message);
} finally {
  const stopped = banco('stop');
  if (stopped.status !== 0) code = code || 1;
  console.log(`Banco e risultati: ${scratch}`);
}
process.exitCode = code;
