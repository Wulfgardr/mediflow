import type { Page, Request as BrowserRequest, TestInfo } from '@playwright/test';

type Event = { event: string; attempt: number; at: number; value?: number };
type Snapshot = { events: Event[]; dropped: number };
type Api = { arm(attempt: number): void; snapshot(): Snapshot; dispose(): void };
type DiagnosticGlobal = typeof globalThis & { __mfAnyDocDiagnostic?: Api };

/** Test-only metadata probe. Does not retain Response, stream, reader or body bytes.
 * Native arguments, return values and read/fetch Promise identities are preserved.
 * Observation reactions can perturb scheduling: this is diagnosis, never an oracle.
 * read_done records done=true, including cancellation; it is natural EOF evidence
 * only without preceding abort/cancel events and with a complete, error-free probe.
 */
export function installAnyDocConsumerDiagnostic(pathname: string) {
  const host = globalThis as DiagnosticGlobal;
  const target = new URL(pathname, location.href).href;
  const originalFetch = host.fetch;
  const events: Event[] = [];
  const removers: Array<() => void> = [];
  let attempt = 0, dropped = 0, disposed = false, requests = 0;
  const emit = (event: string, owner = attempt, value?: number) => {
    if (disposed) return;
    if (events.length >= 128) { dropped = Math.min(65535, dropped + 1); return; }
    events.push({ event, attempt: owner, at: Date.now(), ...(value === undefined ? {} : { value }) });
  };
  const hide = () => emit('pagehide');
  const show = () => emit('pageshow');
  addEventListener('pagehide', hide); addEventListener('pageshow', show);
  const wrappedFetch: typeof fetch = function(this: unknown, input, init) {
    let selected = false;
    try {
      selected = new URL(input instanceof Request ? input.url : String(input), location.href).href === target
        && (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() === 'POST'
        && new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
          .get('x-mediflow-extraction-action') === 'project';
    } catch { emit('selection_probe_error'); }
    const owner = attempt;
    const observe = selected && !disposed && ++requests <= 4;
    if (selected && !observe) emit('request_probe_limit', owner);
    if (observe) {
      emit('fetch_start', owner);
      const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
      if (signal) {
        const abort = () => emit('signal_abort', owner);
        signal.addEventListener('abort', abort, { once: true });
        removers.push(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) emit('signal_already_aborted', owner);
      }
    }
    let promise: Promise<Response>;
    try { promise = Reflect.apply(originalFetch, this, [input, init]); }
    catch (error) { if (observe) emit('fetch_throw', owner); throw error; }
    if (observe) void promise.then(response => {
      if (disposed) return;
      try {
        emit('fetch_response', owner, response.status);
        const stream = response.body;
        if (!stream) { emit('body_absent', owner); return; }
        const getReader = stream.getReader;
        Object.defineProperty(stream, 'getReader', { configurable: true, value: function(this: ReadableStream, ...args: unknown[]) {
          const reader = Reflect.apply(getReader, this, args) as ReadableStreamDefaultReader<Uint8Array>;
          if (disposed) return reader;
          emit('reader_acquired', owner);
          const read = reader.read, cancel = reader.cancel, release = reader.releaseLock;
          try {
            Object.defineProperty(reader, 'read', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>, ...readArgs: unknown[]) {
              let result: ReturnType<typeof read>;
              try { result = Reflect.apply(read, this, readArgs); }
              catch (error) { emit('read_throw', owner); throw error; }
              if (disposed) return result;
              emit('read_start', owner);
              void result.then(part => {
                try {
                  if (part.done) emit('read_done', owner);
                  else if (part.value instanceof Uint8Array) emit('read_chunk', owner, Math.min(part.value.byteLength, 16777216));
                  else emit('read_other_type', owner);
                } catch { emit('read_probe_error', owner); }
              }, () => emit('read_rejected', owner));
              return result;
            } });
            Object.defineProperty(reader, 'cancel', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>, ...args: unknown[]) {
              emit('reader_cancel', owner);
              return Reflect.apply(cancel, this, args);
            } });
            Object.defineProperty(reader, 'releaseLock', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>, ...args: unknown[]) {
              emit('reader_release', owner);
              return Reflect.apply(release, this, args);
            } });
          } catch { emit('reader_probe_install_error', owner); }
          return reader;
        } });
      } catch { emit('response_probe_error', owner); }
    }, () => emit('fetch_rejected', owner));
    return promise;
  };
  host.fetch = wrappedFetch;
  host.__mfAnyDocDiagnostic = {
    arm(value) { if (value !== 1 && value !== 2) throw new Error('DIAGNOSTIC_ATTEMPT_INVALID'); attempt = value; emit('armed'); },
    snapshot() { return { events: events.slice(), dropped }; },
    dispose() {
      disposed = true;
      for (const remove of removers) remove();
      removeEventListener('pagehide', hide); removeEventListener('pageshow', show);
      if (host.fetch === wrappedFetch) host.fetch = originalFetch;
      delete host.__mfAnyDocDiagnostic;
    },
  };
}

export async function createAnyDocConsumerDiagnostic(page: Page, attachmentId: string) {
  const pathname = `/api/attachments/${encodeURIComponent(attachmentId)}/local-extraction`;
  const url = new URL(pathname, page.url()).href;
  await page.evaluate(installAnyDocConsumerDiagnostic, pathname);
  let attempt = 0, dropped = 0;
  const events: Event[] = [];
  const owners = new WeakMap<BrowserRequest, number>();
  const emit = (event: string, owner = attempt) => {
    if (events.length >= 128) { dropped = Math.min(65535, dropped + 1); return; }
    events.push({ event, attempt: owner, at: Date.now() });
  };
  const request = (value: BrowserRequest) => {
    if (value.url() === url && value.method() === 'POST' && value.headers()['x-mediflow-extraction-action'] === 'project') {
      owners.set(value, attempt); emit('request', attempt);
    }
  };
  const finished = (value: BrowserRequest) => { const owner = owners.get(value); if (owner !== undefined) emit('requestfinished', owner); };
  const failed = (value: BrowserRequest) => { const owner = owners.get(value); if (owner !== undefined) emit('requestfailed', owner); };
  const navigation = (frame: import('@playwright/test').Frame) => { if (frame === page.mainFrame()) emit('navigation'); };
  const close = () => emit('page_closed');
  const crash = () => emit('page_crashed');
  page.on('request', request); page.on('requestfinished', finished); page.on('requestfailed', failed);
  page.on('framenavigated', navigation); page.on('close', close); page.on('crash', crash);
  return {
    async arm(value: number) {
      attempt = value;
      await page.evaluate(value => (globalThis as DiagnosticGlobal).__mfAnyDocDiagnostic!.arm(value), value);
    },
    async attachAndDispose(testInfo: TestInfo) {
      let consumer: Snapshot | null = null;
      try { consumer = await page.evaluate(() => (globalThis as DiagnosticGlobal).__mfAnyDocDiagnostic?.snapshot() ?? null); }
      catch { emit('consumer_snapshot_unavailable'); }
      try { await page.evaluate(() => (globalThis as DiagnosticGlobal).__mfAnyDocDiagnostic?.dispose()); }
      catch { emit('consumer_dispose_unavailable'); }
      page.off('request', request); page.off('requestfinished', finished); page.off('requestfailed', failed);
      page.off('framenavigated', navigation); page.off('close', close); page.off('crash', crash);
      await testInfo.attach('anydoc-consumer-diagnostic', {
        body: Buffer.from(JSON.stringify({ schema: 'anydoc-consumer-diagnostic.v1', consumer, browser: { events, dropped } })),
        contentType: 'application/json',
      });
    },
  };
}
