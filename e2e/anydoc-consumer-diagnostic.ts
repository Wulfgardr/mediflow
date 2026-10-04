import type { Page, Request as BrowserRequest, TestInfo } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import contract from '../scripts/anydoc-diagnostic-contract.cjs';

type Event = { event: string; seq: number; attempt: number; at: number; value?: number; id?: string };
type Snapshot = { events: Event[]; total: number; dropped: number; sealed: boolean };
type Api = { arm(attempt: number): void; snapshot(): Snapshot; dispose(): void; finish(): Snapshot };
type DiagnosticGlobal = typeof globalThis & { __mfAnyDocDiagnostic?: Api };

/** Test-only metadata probe. Does not retain Response, stream, reader or body bytes.
 * Correlation adds ONE reserved header only in the explicitly marked synthetic run.
 * Input/body/signal, return values and native read/fetch Promise identities are preserved.
 * The original init/Headers are not mutated; all other init properties are forwarded.
 * Observation reactions can perturb scheduling: this is diagnosis, never an oracle.
 * read_done records done=true, including cancellation; it is natural EOF evidence
 * only without preceding abort/cancel events and with a complete, error-free probe.
 */
export function installAnyDocConsumerDiagnostic(config: string | { pathname: string; scope: string | null }) {
  const pathname = typeof config === 'string' ? config : config.pathname;
  const scope = typeof config === 'string' ? null : config.scope;
  if (scope !== null && !/^[a-f0-9]{32}$/u.test(scope)) throw new Error('DIAGNOSTIC_SCOPE_INVALID');
  const host = globalThis as DiagnosticGlobal;
  const target = new URL(pathname, location.href).href;
  const originalFetch = host.fetch;
  const events: Event[] = [];
  const removers: Array<() => void> = [];
  let attempt = 0, total = 0, dropped = 0, disposed = false, requests = 0, releases = 0, sequence = 0;
  const emit = (event: string, owner = attempt, value?: number, id?: string) => {
    if (disposed) return;
    total++;
    if (events.length >= 128) { dropped = Math.min(65535, dropped + 1); return; }
    events.push({ event, seq: total, attempt: owner, at: Date.now(), ...(value === undefined ? {} : { value }), ...(id ? { id } : {}) });
  };
  const hide = () => emit('pagehide');
  const show = () => emit('pageshow');
  addEventListener('pagehide', hide); addEventListener('pageshow', show);
  const wrappedFetch: typeof fetch = function(this: unknown, input, init) {
    let selected = false, releasing = false;
    try {
      const matches = new URL(input instanceof Request ? input.url : String(input), location.href).href === target;
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      releasing = matches && method === 'DELETE';
      selected = releasing || (matches && method === 'POST'
        && new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
          .get('x-mediflow-extraction-action') === 'project');
    } catch { emit('selection_probe_error'); }
    const owner = attempt;
    const observe = selected && !disposed && (releasing ? ++releases : ++requests) <= 4;
    if (selected && !observe) emit(releasing ? 'release_probe_limit' : 'request_probe_limit', owner);
    let id: string | undefined;
    let diagnosticInit = init;
    if (observe && scope) {
      if ((owner === 1 || owner === 2) && sequence < 8) {
        id = `ad1-${scope}-${owner}-${++sequence}`;
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set('x-mediflow-anydoc-diagnostic', id);
        // Fetch reads dictionary properties, including inherited/non-enumerable
        // values. Preserve their receiver; an empty target also avoids proxy
        // invariants for non-configurable properties on the original init.
        diagnosticInit = new Proxy({}, { get(_target, key) {
          return key === 'headers' ? headers : init == null ? undefined : Reflect.get(init, key, init);
        } });
      } else emit('correlation_probe_error', owner);
    }
    const report = (event: string, value?: number) => emit(event, owner, value, id);
    if (observe) {
      report(releasing ? 'release_start' : 'fetch_start');
      const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
      if (signal) {
        const abort = () => report(releasing ? 'release_signal_abort' : 'signal_abort');
        signal.addEventListener('abort', abort, { once: true });
        removers.push(() => signal.removeEventListener('abort', abort));
        if (signal.aborted) report(releasing ? 'release_signal_already_aborted' : 'signal_already_aborted');
      }
    }
    let promise: Promise<Response>;
    try { promise = Reflect.apply(originalFetch, this, [input, diagnosticInit]); }
    catch (error) { if (observe) report(releasing ? 'release_throw' : 'fetch_throw'); throw error; }
    if (observe) void promise.then(response => {
      if (disposed) return;
      try {
        // Observe the existing cleanup request without reading its body or
        // delaying it. Its ordering is evidence, never a success criterion.
        if (releasing) { report('release_response', response.status); return; }
        report('fetch_response', response.status);
        const stream = response.body;
        if (!stream) { report('body_absent'); return; }
        const getReader = stream.getReader;
        Object.defineProperty(stream, 'getReader', { configurable: true, value: function(this: ReadableStream, ...args: unknown[]) {
          const reader = Reflect.apply(getReader, this, args) as ReadableStreamDefaultReader<Uint8Array>;
          if (disposed) return reader;
          report('reader_acquired');
          const read = reader.read, cancel = reader.cancel, release = reader.releaseLock;
          try {
            Object.defineProperty(reader, 'read', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>, ...readArgs: unknown[]) {
              let result: ReturnType<typeof read>;
              try { result = Reflect.apply(read, this, readArgs); }
              catch (error) { report('read_throw'); throw error; }
              if (disposed) return result;
              report('read_start');
              void result.then(part => {
                try {
                  if (part.done) report('read_done');
                  else if (part.value instanceof Uint8Array) report('read_chunk', Math.min(part.value.byteLength, 16777216));
                  else report('read_other_type');
                } catch { report('read_probe_error'); }
              }, () => report('read_rejected'));
              return result;
            } });
            Object.defineProperty(reader, 'cancel', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>, ...args: unknown[]) {
              report('reader_cancel');
              return Reflect.apply(cancel, this, args);
            } });
            Object.defineProperty(reader, 'releaseLock', { configurable: true, value: function(this: ReadableStreamDefaultReader<Uint8Array>, ...args: unknown[]) {
              report('reader_release');
              return Reflect.apply(release, this, args);
            } });
          } catch { report('reader_probe_install_error'); }
          return reader;
        } });
      } catch { report('response_probe_error'); }
    }, () => report(releasing ? 'release_rejected' : 'fetch_rejected'));
    return promise;
  };
  host.fetch = wrappedFetch;
  host.__mfAnyDocDiagnostic = {
    arm(value) { if (value !== 1 && value !== 2) throw new Error('DIAGNOSTIC_ATTEMPT_INVALID'); attempt = value; emit('armed'); },
    snapshot() { return { events: events.slice(), total, dropped, sealed: disposed }; },
    finish() { this.dispose(); return this.snapshot(); },
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
  const correlated = process.env.MEDIFLOW_ANYDOC_HTTP_DIAGNOSTIC === '1';
  if (correlated) contract.assertSyntheticFixture(process.env);
  const scope = correlated ? randomBytes(16).toString('hex') : null;
  await page.evaluate(installAnyDocConsumerDiagnostic, { pathname, scope });
  let attempt = 0, total = 0, dropped = 0;
  const events: Event[] = [];
  const owners = new WeakMap<BrowserRequest, { attempt: number; releasing: boolean; id?: string }>();
  const emit = (event: string, owner = attempt, id?: string) => {
    total++;
    if (events.length >= 128) { dropped = Math.min(65535, dropped + 1); return; }
    events.push({ event, seq: total, attempt: owner, at: Date.now(), ...(id ? { id } : {}) });
  };
  const request = (value: BrowserRequest) => {
    const releasing = value.method() === 'DELETE';
    if (value.url() === url && (releasing || (value.method() === 'POST' && value.headers()['x-mediflow-extraction-action'] === 'project'))) {
      const parsed = contract.parseId(value.headers()[contract.HEADER]);
      const valid = parsed && parsed.scope === scope;
      const owner = valid ? parsed.attempt : attempt;
      const id = valid ? parsed.id : undefined;
      if (correlated && !valid) emit('correlation_probe_error', owner);
      owners.set(value, { attempt: owner, releasing, id }); emit(releasing ? 'release_request' : 'request', owner, id);
    }
  };
  const finished = (value: BrowserRequest) => {
    const owner = owners.get(value); if (owner) emit(owner.releasing ? 'release_requestfinished' : 'requestfinished', owner.attempt, owner.id);
  };
  const failed = (value: BrowserRequest) => {
    const owner = owners.get(value); if (owner) emit(owner.releasing ? 'release_requestfailed' : 'requestfailed', owner.attempt, owner.id);
  };
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
      try { consumer = await page.evaluate(() => (globalThis as DiagnosticGlobal).__mfAnyDocDiagnostic?.finish() ?? null); }
      catch { emit('consumer_snapshot_unavailable'); }
      page.off('request', request); page.off('requestfinished', finished); page.off('requestfailed', failed);
      page.off('framenavigated', navigation); page.off('close', close); page.off('crash', crash);
      await testInfo.attach('anydoc-consumer-diagnostic', {
        body: Buffer.from(JSON.stringify({ schema: 'anydoc-consumer-diagnostic.v2', scope, consumer, browser: { events, total, dropped, sealed: true } })),
        contentType: 'application/json',
      });
    },
  };
}
