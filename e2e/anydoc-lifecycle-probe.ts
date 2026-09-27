/* @Codex */
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

/** Opt-in causal probe, never an ordinary qualification result. The extra promise
 * observers can affect timing. No interception, body clone, extra read or retry.
 * Keep the original CDP response oracle independent and unchanged. */
export async function installAnyDocLifecycleProbe(page: Page, testInfo: TestInfo) {
  if (process.env.MEDIFLOW_OCR_LIFECYCLE_PROBE !== '1') return;
  const dataDir = process.env.MEDIFLOW_DATA_DIR;
  const base = new URL(process.env.E2E_BASE_URL || 'http://localhost:3000');
  if (!dataDir || !isAbsolute(dataDir) || base.hostname !== '127.0.0.1' || !base.port || base.port === '3000'
    || !readFileSync(join(dataDir, 'SYNTHETIC_ONLY'), 'utf8').startsWith('Synthetic E2E fixture;'))
    throw new Error('OCR lifecycle probe requires an explicitly marked isolated synthetic runtime');
  testInfo.annotations.push({ type: 'diagnostic-only', description: 'Instrumented timing; not OCR qualification' });
  await page.addInitScript(() => {
    type Entry = { sequence: number; event: string; at: number; bytes?: number; done?: boolean; aborted?: boolean; error?: string };
    type State = { sequence: number; bytes: number; signal: AbortSignal | null };
    const entries: Entry[] = [];
    const streams = new WeakMap<ReadableStream, State>();
    const readers = new WeakMap<ReadableStreamDefaultReader, State>();
    const states: State[] = [];
    let sequence = 0;
    const record = (state: State, event: string, extra: Partial<Entry> = {}) => {
      if (entries.length < 256) entries.push({ sequence: state.sequence, event, at: performance.now(),
        aborted: state.signal?.aborted ?? false, ...extra });
    };
    const errorName = (error: unknown) => error instanceof Error
      && ['AbortError', 'TypeError', 'SyntaxError', 'RangeError'].includes(error.name) ? error.name : 'other';
    Object.defineProperty(window, '__mediflowOcrLifecycle', { value: entries });
    const fetchOriginal = window.fetch;
    window.fetch = function (input, init) {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const project = url.origin === location.origin && /^\/api\/attachments\/[^/]+\/local-extraction$/u.test(url.pathname)
        && (init?.method ?? (input instanceof Request ? input.method : 'GET')) === 'POST'
        && headers.get('x-mediflow-extraction-action') === 'project';
      if (!project) return Reflect.apply(fetchOriginal, this, [input, init]);
      const state = { sequence: ++sequence, bytes: 0, signal: init?.signal ?? (input instanceof Request ? input.signal : null) };
      states.push(state); record(state, 'fetch-start');
      state.signal?.addEventListener('abort', () => record(state, 'signal-abort'), { once: true });
      const result = Reflect.apply(fetchOriginal, this, [input, init]) as Promise<Response>;
      // Return the original promise, preserving its identity and outcome.
      void result.then(response => {
        record(state, 'headers');
        if (response.body) streams.set(response.body, state);
      }, error => record(state, 'fetch-error', { error: errorName(error) }));
      return result;
    };
    const getReader = ReadableStream.prototype.getReader;
    ReadableStream.prototype.getReader = function (this: ReadableStream, ...args: Parameters<typeof getReader>) {
      const reader = Reflect.apply(getReader, this, args);
      const state = streams.get(this);
      if (state && reader instanceof ReadableStreamDefaultReader) { readers.set(reader, state); record(state, 'reader-acquired'); }
      return reader;
    } as typeof getReader; // All original overloads forward unchanged.
    const read = ReadableStreamDefaultReader.prototype.read;
    ReadableStreamDefaultReader.prototype.read = function (...args: Parameters<typeof read>) {
      const result = Reflect.apply(read, this, args) as ReturnType<typeof read>;
      const state = readers.get(this);
      if (state) void result.then(next => {
        if (!next.done && next.value instanceof Uint8Array) state.bytes += next.value.byteLength;
        record(state, 'reader-read', { done: next.done, bytes: state.bytes });
      }, error => record(state, 'reader-error', { error: errorName(error), bytes: state.bytes }));
      return result;
    };
    const cancel = ReadableStreamDefaultReader.prototype.cancel;
    ReadableStreamDefaultReader.prototype.cancel = function (...args: Parameters<typeof cancel>) {
      const state = readers.get(this);
      if (state) record(state, 'reader-cancel', { bytes: state.bytes });
      return Reflect.apply(cancel, this, args);
    };
    const release = ReadableStreamDefaultReader.prototype.releaseLock;
    ReadableStreamDefaultReader.prototype.releaseLock = function (...args: Parameters<typeof release>) {
      const state = readers.get(this);
      if (state) record(state, 'reader-release', { bytes: state.bytes });
      return Reflect.apply(release, this, args);
    };
    window.addEventListener('pagehide', () => { for (const state of states) record(state, 'pagehide'); });
  });
}

export async function attachAnyDocLifecycleProbe(page: Page, testInfo: TestInfo) {
  if (process.env.MEDIFLOW_OCR_LIFECYCLE_PROBE !== '1') return;
  const events = await page.evaluate(() => Reflect.get(window, '__mediflowOcrLifecycle') ?? [])
    .catch(() => [{ event: 'page-unavailable' }]); // Do not mask the original failure.
  await testInfo.attach('ocr-lifecycle-diagnostic-only', {
    body: Buffer.from(JSON.stringify({ qualification: false, events })), contentType: 'application/json',
  });
}
