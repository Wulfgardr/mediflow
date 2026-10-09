/**
 * WUL-715: production, no-AI read/edit baseline. No mocked routes or latency gate.
 * Reproduce after `npm run build` and copying public/ and .next/static/ into
 * .next/standalone/: MF085_SYNTHETIC_E2E=1 npx playwright test
 * e2e/performance-patient-currentness.spec.ts --workers=1 --retries=0
 * E2E_ISOLATED_STANDALONE_DIR may select an already built equivalent bundle.
 * The JSON attachment retains every sample; first visit is not an OS-cold start.
 */
import { expect, test, type Request } from '@playwright/test';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, release, totalmem } from 'node:os';
import path from 'node:path';
import { unlockIfNeeded, waitForUnlockedInteractiveShell } from './utils';
import { trustedWebRequestHeaders } from './fixtures/trusted-web-request';

const root = path.resolve(__dirname, '..');
const patientId = 'perf-patient-000000';
const sentinelId = 'perf-patient-000001';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const round = (value: number) => Math.round(value * 1000) / 1000;
function treeHash(directory: string): string {
  const hash = createHash('sha256');
  const visit = (relative: string) => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) hash.update(name).update('\0').update(readFileSync(path.join(directory, name))).update('\0');
    }
  };
  visit('');
  return hash.digest('hex');
}

test('production patient read/edit stays fresh and correct without AI', async ({ page, browser }, info) => {
  expect(process.env.MF085_SYNTHETIC_E2E, 'Explicit synthetic run required').toBe('1');
  const bundle = path.resolve(process.env.E2E_ISOLATED_STANDALONE_DIR || path.join(root, '.next/standalone'));
  expect(process.env.MEDIFLOW_RUNTIME_TWIN).not.toBe('1');
  expect(process.env.NEXT_PUBLIC_MEDIFLOW_RUNTIME_TWIN).not.toBe('1');
  const contract = JSON.parse(readFileSync(path.join(bundle, 'mediflow-runtime-contract.json'), 'utf8'));
  expect(process.versions.node.split('.')[0]).toBe('24');
  expect(contract).toMatchObject({ node: { major: 24, moduleVersion: process.versions.modules }, platform: process.platform, arch: process.arch });
  expect(existsSync(path.join(bundle, 'medical.db')), 'No legacy database in bundle').toBe(false);
  const directory = mkdtempSync(path.join(tmpdir(), 'mediflow-performance-'));
  const dataDir = path.join(directory, 'data');
  const seeded = spawnSync(process.execPath, ['scripts/run-strip-types.mjs', 'scripts/seed-performance-baseline.mjs',
    '--data-dir', dataDir, '--patients', '20'], { cwd: root, encoding: 'utf8',
    env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_STRIP_TYPES_NODE: process.execPath } });
  expect(seeded.status, seeded.stderr).toBe(0);
  const seed = JSON.parse(seeded.stdout);
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  const report: Record<string, unknown> = { schemaVersion: 'mediflow.patient_performance.v1', measuredAt: new Date().toISOString(),
    source: { head: git('rev-parse', 'HEAD'), diffSHA256: sha(git('diff', 'HEAD')), harnessSHA256: sha(readFileSync(__filename)), seedSHA256: sha(readFileSync(path.join(root, 'scripts/seed-performance-baseline.mjs'))), lockSHA256: sha(readFileSync(path.join(root, 'package-lock.json'))) },
    artifact: { serverSHA256: sha(readFileSync(path.join(bundle, 'server.js'))), applicationSHA256: treeHash(path.join(bundle, process.env.MEDIFLOW_NEXT_DIST_DIR || '.next', 'server')), contract },
    environment: { node: process.version, platform: process.platform, arch: process.arch, os: release(), cpu: cpus()[0]?.model,
      logicalCores: cpus().length, memoryBytes: totalmem(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, browser: browser.version(), viewport: page.viewportSize() },
    protocol: { patients: 20, samples: 5, firstVisit: 'fresh page, already started/authenticated server; not OS-cold',
      warm: 'same browser context and server, full document navigation', startupSamples: 1,
      statistics: 'raw samples and median/range only; no P95 or wall-clock CI threshold',
      formReady: 'loaded and enabled firstName plus decrypted address/notes and two related checkups',
      saveToFresh: 'click through real PUT body EOF, app GET of advanced version, all post-save clinical reads complete, then newly opened editable form; includes test-driver observation overhead',
      ai: 'no provider configured; no feature kill switch changed; requests observed, not intercepted' },
    seed: { ...seed, dataDir: undefined, dbPath: undefined, login: undefined } };
  const samples: Array<Record<string, number>> = [];
  const apiRequests: Array<{ method: string; path: string; status?: number }> = [];
  const failures: string[] = [];
  const goldenOutputs: unknown[] = [];
  const pendingApi = new Set<Request>();
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) pendingApi.add(request); });
  page.on('requestfinished', request => pendingApi.delete(request));
  page.on('response', response => {
    const request = response.request();
    const parsed = new URL(response.url());
    if (parsed.pathname.startsWith('/api/')) apiRequests.push({ method: request.method(), path: parsed.pathname, status: response.status() });
  });
  page.on('requestfailed', request => { pendingApi.delete(request); failures.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`); });
  const start = performance.now();
  const child = spawn(process.execPath, [path.join(bundle, 'server.js')], { cwd: bundle,
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      MEDIFLOW_DATA_DIR: dataDir, MEDIFLOW_E2E_DISABLE_LEGACY_COPY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let log = '';
  child.stdout.on('data', chunk => { log += chunk.toString(); });
  child.stderr.on('data', chunk => { log += chunk.toString(); });
  try {
    await expect.poll(() => ({ ready: /Ready in/u.test(log), exit: child.exitCode }), { timeout: 30_000 }).toEqual({ ready: true, exit: null });
    const revisionResponse = await fetch(`${url}/api/system/revision`);
    expect(revisionResponse.status).toBe(200);
    const revision = await revisionResponse.json();
    report.runtime = revision;
    report.processStartToRevisionMs = round(performance.now() - start);
    const html = await (await fetch(url)).text();
    expect(html.includes(revision.fingerprint), 'HTML and reached runtime must identify the same build').toBe(true);
    const denied = await fetch(`${url}/api/patients/${patientId}`);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: 'Unauthorized' });
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Sblocca MediFlow' })).toBeVisible();
    await unlockIfNeeded(page, '314159');
    await waitForUnlockedInteractiveShell(page);
    const read = async (id: string) => {
      const response = await page.request.get(`${url}/api/patients/${id}`, { headers: { 'Cache-Control': 'no-cache' } });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const sentinel = await read(sentinelId);
    let current = await read(patientId);
    expect(current).toMatchObject({ id: patientId, version: 1, firstName: 'Persona000000' });
    for (let index = 0; index < 5; index++) {
      const name = page.locator('input[name="firstName"]');
      const notes = page.locator('textarea[name="notes"]');
      const save = page.getByRole('button', { name: 'Aggiorna scheda', exact: true });
      const ready = async (expectedName: string, expectedNotes: string) => {
        await expect(name).toHaveValue(expectedName);
        await expect(name).toBeEditable();
        await expect(notes).toHaveValue(expectedNotes);
        await expect(page.locator('input[name="address"]')).toHaveValue('Via sintetica 0, Comune test');
        const relatedIds = page.locator('input[name^="checkups."][name$=".id"]');
        await expect(relatedIds).toHaveCount(2);
        expect((await relatedIds.evaluateAll(rows => rows.map(row => (row as HTMLInputElement).value))).sort())
          .toEqual([`${patientId}-checkup-00`, `${patientId}-checkup-01`]);
        await expect(save).toBeEnabled();
      };
      const opened = performance.now();
      await page.goto(`${url}/patients/${patientId}/edit`);
      await ready(current.firstName, index ? `Nota sintetica aggiornata ${index - 1}` : 'Nota clinica sintetica ripetibile per il benchmark locale.');
      const formReadyMs = performance.now() - opened;
      const nextName = `PersonaAggiornata${index}`;
      const nextNotes = `Nota sintetica aggiornata ${index}`;
      await name.fill(nextName);
      await notes.fill(nextNotes);
      // Complete the real post-save page's clinical reads before leaving it.
      // Otherwise navigation can abort required work and produce an artificial gain.
      const relatedCounts: Record<string, number> = { entries: 8, checkups: 2, attachments: 2,
        therapies: 0, observations: 6, 'service-prescription-items': 0, 'service-prescriptions': 0,
        'prosthetic-prescriptions': 0, 'siss-handoffs': 0 };
      const relatedReads = Object.entries(relatedCounts).map(async ([resource, count]) => {
        const response = await page.waitForResponse(response => {
          const requestUrl = new URL(response.url());
          return requestUrl.pathname === `/api/${resource}` && requestUrl.searchParams.get('patientId') === patientId
            && response.request().method() === 'GET';
        }, { timeout: 15_000 });
        expect(response.status()).toBe(200);
        const rows = await response.json();
        expect(rows).toHaveLength(count);
        for (const row of rows) expect(row.patientId).toBe(patientId);
      });
      const saved = performance.now();
      const written = page.waitForResponse(response => new URL(response.url()).pathname === `/api/patients/${patientId}`
        && response.request().method() === 'PUT', { timeout: 15_000 }).then(async response =>
          ({ response, body: await response.json(), at: performance.now() }));
      const reread = page.waitForResponse(async response => new URL(response.url()).pathname === `/api/patients/${patientId}`
        && response.request().method() === 'GET' && response.ok() && (await response.json()).version === current.version + 1,
        { timeout: 15_000 }).then(async response => ({ body: await response.json(), at: performance.now() }));
      const [write, readResult] = await Promise.all([written, reread, save.click(), Promise.all(relatedReads)]);
      expect(write.response.status()).toBe(200);
      expect(write.body).toEqual({ success: true });
      const writeMs = write.at - saved;
      const payload = write.response.request().postDataJSON();
      expect(payload.version).toBe(current.version);
      expect(payload.notes).toMatch(/^ENC:/);
      const fresh = readResult.body;
      const freshResponseMs = readResult.at - saved;
      expect(fresh).toMatchObject({ id: patientId, version: current.version + 1, firstName: nextName });
      expect(fresh.notes).not.toBe(current.notes);
      await expect(page).toHaveURL(`${url}/patients/${patientId}/modules`);
      await expect(page.getByTestId('lume-scheda-header')).toContainText(nextName);
      await expect.poll(() => pendingApi.size).toBe(0);
      await page.goto(`${url}/patients/${patientId}/edit`);
      await ready(nextName, nextNotes);
      const saveToFreshFormMs = performance.now() - saved;
      expect(await read(sentinelId), 'Editing A must not change B').toEqual(sentinel);
      const replay = await page.request.put(`${url}/api/patients/${patientId}`, { headers: trustedWebRequestHeaders(url), data: payload });
      expect(replay.status()).toBe(409);
      const replayBody = await replay.json();
      expect(replayBody).toEqual({ error: 'Conflict', code: 'VERSION_CONFLICT', entity: 'patient', recordId: patientId,
        expectedVersion: current.version, currentVersion: current.version + 1, currentState: 'present', currentUpdatedAt: fresh.updatedAt,
        currentSnapshot: { id: patientId, version: current.version + 1, updatedAt: fresh.updatedAt, isArchived: fresh.isArchived } });
      const invalid = await page.request.put(`${url}/api/patients/${patientId}`, { headers: trustedWebRequestHeaders(url), data: { version: fresh.version, birthDate: 'invalid' } });
      expect(invalid.status()).toBe(400);
      const invalidBody = await invalid.json();
      expect(invalidBody).toEqual({ error: 'Invalid birthDate' });
      goldenOutputs.push({ write: { status: write.response.status(), body: write.body },
        staleReplay: { status: replay.status(), body: replayBody }, invalid: { status: invalid.status(), body: invalidBody },
        fresh: { id: fresh.id, version: fresh.version, firstName: fresh.firstName, decryptedNotes: nextNotes },
        unchangedSentinelSHA256: sha(JSON.stringify(sentinel)) });
      expect(await read(patientId)).toEqual(fresh);
      samples.push({ iteration: index, formReadyMs: round(formReadyMs), saveToWriteBodyMs: round(writeMs),
        saveToFreshResponseMs: round(freshResponseMs), saveToFreshFormMs: round(saveToFreshFormMs), putRequestMs: round(write.response.request().timing().responseEnd), version: fresh.version });
      current = fresh;
    }
    expect(apiRequests.filter(row => row.method === 'PUT')).toHaveLength(5);
    expect(apiRequests.filter(row => row.method === 'POST' && /(?:chat|generate|synthesis|insight|reasoning|ocr)/i.test(row.path))).toEqual([]);
    expect(apiRequests.filter(row => (row.status ?? 0) >= 500)).toEqual([]);
    expect(failures.filter(failure => /^\w+ \/api\//.test(failure)), 'No API work may be dropped to improve the measurement').toEqual([]);
    report.golden = { success: 5, invalid: 5, staleReplay: 5, unauthorized: 1, wrongPatientUnchanged: 5,
      final: { id: current.id, version: current.version, firstName: current.firstName }, encryptedNotesVerifiedInFreshForm: true };
    report.status = 'pass';
  } finally {
    report.samples = samples;
    report.goldenOutputs = goldenOutputs;
    const warmSamples = samples.slice(1);
    report.warmSummary = Object.fromEntries(['formReadyMs', 'saveToWriteBodyMs', 'saveToFreshResponseMs', 'saveToFreshFormMs', 'putRequestMs'].map(metric => {
      const values = warmSamples.map(sample => sample[metric]).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return [metric, { count: values.length, min: values[0] ?? null, max: values.at(-1) ?? null,
        median: values.length ? round(values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2) : null }];
    }));
    report.apiRequests = apiRequests;
    report.requestFailures = failures;
    report.status ??= 'fail';
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 5_000);
    await closed;
    clearTimeout(force);
    report.childStopped = true;
    const receipt = info.outputPath('patient-performance.json');
    writeFileSync(receipt, JSON.stringify(report, null, 2));
    await info.attach('patient-performance.json', { path: receipt, contentType: 'application/json' });
    if (report.status === 'pass') rmSync(directory, { recursive: true });
    else writeFileSync(path.join(directory, 'server.log'), log);
  }
});
