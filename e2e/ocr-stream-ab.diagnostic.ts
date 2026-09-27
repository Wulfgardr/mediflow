import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { bootstrapUnlockedSession, openPatientSection } from './utils';
import { attachAnyDocLifecycleProbe, installAnyDocLifecycleProbe } from './anydoc-lifecycle-probe';

type Arm = 'stream-on' | 'stream-off';
type Terminal = 'finished' | 'failed' | 'timeout';
type StreamCommand = 'not_requested' | 'pending' | 'accepted' | 'rejected';
type Observation = {
  terminal: Terminal;
  status: number | null;
  receivedBytes: number;
  encodedBytes: number | null;
  eventStreamedBytes: number;
  bufferedBytes: number;
  streamCommand: StreamCommand;
  errorEnum: string;
};

const safeError = (value: unknown) => typeof value === 'string' && /^net::ERR_[A-Z0-9_]{1,80}$/u.test(value)
  ? value : 'redacted_or_unknown';
const decodedLength = (data: string) => {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor(data.length * 3 / 4) - padding;
};

function requireSyntheticRuntime(baseURL: string | undefined) {
  const dataDir = process.env.MEDIFLOW_DATA_DIR;
  const base = new URL(baseURL ?? 'http://localhost:3000');
  if (!dataDir || !isAbsolute(dataDir) || base.hostname !== '127.0.0.1' || base.port !== '3123'
    || process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1'
    || process.env.MEDIFLOW_OCR_LIFECYCLE_PROBE !== '1'
    || !readFileSync(join(dataDir, 'SYNTHETIC_ONLY'), 'utf8').startsWith('Synthetic E2E fixture;')) {
    throw new Error('Diagnostic requires the dedicated marked synthetic runtime on loopback:3123');
  }
}

async function syntheticProtectedPdf(page: Page) {
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');
  const marker = randomUUID();
  const patient = await page.request.post('/api/patients', { data: {
    firstName: 'Synthetic', lastName: 'OCR Recovery', birthDate: '1975-01-01T00:00:00.000Z',
    taxCode: `REC${marker.replaceAll('-', '').slice(0, 13)}`, diagnoses: [],
  } });
  if (!patient.ok()) throw new Error(`Synthetic patient setup HTTP ${patient.status()}`);
  const patientId = (await patient.json() as { id: string }).id;
  const name = 'synthetic-recovery.pdf';
  await page.goto(`/patients/${patientId}/modules`);
  await openPatientSection(page, 'documenti');
  await expect(page.locator('#documenti').getByRole('heading', { name: /Archivio documenti ed evidenze/ })).toBeVisible();
  const saved = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/attachments');
  await page.locator('#documenti input[type="file"]').setInputFiles({ name, mimeType: 'application/pdf',
    buffer: readFileSync('e2e/fixtures/ocr-synthetic-protected.pdf') });
  const response = await saved;
  if (response.status() !== 201) throw new Error(`Synthetic attachment setup HTTP ${response.status()}`);
  const uploaded = response.request().postDataJSON() as { id?: string; patientId?: string; data?: string };
  if (!uploaded.id || uploaded.patientId !== patientId || !uploaded.data?.startsWith('ENC:')) {
    throw new Error('Synthetic encrypted upload precondition failed');
  }
  return { id: uploaded.id, name };
}

async function observeProjectTerminals(page: Page, attachmentId: string, streaming: boolean) {
  const endpoint = new URL(`/api/attachments/${encodeURIComponent(attachmentId)}/local-extraction`, page.url()).href;
  const session = await page.context().newCDPSession(page);
  type Active = Observation & { requestId: string; resolve: (value: Observation) => void };
  let active: Active | undefined;
  let pending: ((value: Observation) => void) | undefined;
  let disposed = false;
  const observation = (): Observation => ({ terminal: 'timeout', status: null, receivedBytes: 0,
    encodedBytes: null, eventStreamedBytes: 0, bufferedBytes: 0,
    streamCommand: streaming ? 'pending' : 'not_requested', errorEnum: 'none' });
  const finish = (terminal: Terminal, errorEnum = 'none', encodedBytes: number | null = null) => {
    if (!active) return;
    active.terminal = terminal;
    active.errorEnum = errorEnum;
    active.encodedBytes = encodedBytes;
    const { resolve } = active;
    const result: Observation = { terminal: active.terminal, status: active.status,
      receivedBytes: active.receivedBytes, encodedBytes: active.encodedBytes,
      eventStreamedBytes: active.eventStreamedBytes, bufferedBytes: active.bufferedBytes,
      streamCommand: active.streamCommand, errorEnum: active.errorEnum };
    active = undefined;
    resolve(result);
  };
  const onRequest = (event: { requestId: string; request: { url: string; method: string; headers: Record<string, string> } }) => {
    if (disposed || !pending || active || event.request.url !== endpoint || event.request.method !== 'POST') return;
    if (Object.entries(event.request.headers).find(([key]) => key.toLowerCase() === 'x-mediflow-extraction-action')?.[1] !== 'project') return;
    const resolve = pending;
    pending = undefined;
    active = { ...observation(), requestId: event.requestId, resolve };
    if (streaming) {
      void session.send('Network.streamResourceContent', { requestId: event.requestId }).then(
        ({ bufferedData }: { bufferedData: string }) => {
          if (!active || active.requestId !== event.requestId) return;
          active.bufferedBytes = decodedLength(bufferedData);
          active.streamCommand = 'accepted';
        }, () => {
          if (active?.requestId === event.requestId) active.streamCommand = 'rejected';
        });
    }
  };
  const onResponse = (event: { requestId: string; response: { status: number } }) => {
    if (active?.requestId === event.requestId) active.status = event.response.status;
  };
  const onData = (event: { requestId: string; dataLength: number; data?: string }) => {
    if (active?.requestId !== event.requestId) return;
    if (Number.isSafeInteger(event.dataLength) && event.dataLength >= 0) active.receivedBytes += event.dataLength;
    if (typeof event.data === 'string') active.eventStreamedBytes += decodedLength(event.data);
  };
  const onFinished = (event: { requestId: string; encodedDataLength: number }) => {
    if (active?.requestId === event.requestId) finish('finished', 'none', event.encodedDataLength);
  };
  const onFailed = (event: { requestId: string; errorText?: string }) => {
    if (active?.requestId === event.requestId) finish('failed', safeError(event.errorText));
  };
  session.on('Network.requestWillBeSent', onRequest);
  session.on('Network.responseReceived', onResponse);
  session.on('Network.dataReceived', onData);
  session.on('Network.loadingFinished', onFinished);
  session.on('Network.loadingFailed', onFailed);
  await session.send('Network.enable');
  return {
    nextTerminal() {
      if (pending || active) throw new Error('Previous diagnostic project request is unresolved');
      return new Promise<Observation>(resolve => {
        const deadline = setTimeout(() => {
          if (pending === settle) {
            pending = undefined;
            settle({ ...observation(), errorEnum: 'request_timeout' });
          } else if (active?.resolve === settle) finish('timeout', 'terminal_timeout');
        }, 10_000);
        const settle = (result: Observation) => { clearTimeout(deadline); resolve(result); };
        pending = settle;
      });
    },
    async dispose() {
      disposed = true;
      session.off('Network.requestWillBeSent', onRequest);
      session.off('Network.responseReceived', onResponse);
      session.off('Network.dataReceived', onData);
      session.off('Network.loadingFinished', onFinished);
      session.off('Network.loadingFailed', onFailed);
      if (active) finish('timeout', 'observer_disposed');
      if (pending) { pending({ ...observation(), errorEnum: 'observer_disposed' }); pending = undefined; }
      await session.detach().catch(() => {});
    },
  };
}

test.beforeEach(async ({ page }, info) => { await installAnyDocLifecycleProbe(page, info); });
test.afterEach(async ({ page }, info) => { await attachAnyDocLifecycleProbe(page, info); });

for (const arm of ['stream-on', 'stream-off'] as const satisfies readonly Arm[]) {
  test(`diagnostic protected PDF project terminal: ${arm}`, async ({ page, baseURL }, testInfo) => {
    requireSyntheticRuntime(baseURL);
    testInfo.annotations.push({ type: 'diagnostic-only', description: 'No OCR qualification or response-body assertion' });
    const file = await syntheticProtectedPdf(page);
    const observer = await observeProjectTerminals(page, file.id, arm === 'stream-on');
    const outcomes: Observation[] = [];
    try {
      const extract = page.getByRole('button', { name: `Estrai testo localmente da ${file.name}` });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(extract).toBeEnabled({ timeout: 10_000 });
        const terminal = observer.nextTerminal();
        await extract.click({ timeout: 3_000 });
        outcomes.push(await terminal);
      }
    } finally {
      await testInfo.attach('ocr-stream-ab-diagnostic-only.json', {
        contentType: 'application/json', body: JSON.stringify({ qualification: false, arm, outcomes,
          streamArmInterpretable: arm === 'stream-off' ? null
            : outcomes.length === 2 && outcomes.every(item => item.streamCommand === 'accepted') }),
      });
      await observer.dispose();
    }
  });
}
