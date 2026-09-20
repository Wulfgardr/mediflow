/* @Codex */
import type { Page, Response as PlaywrightResponse } from '@playwright/test';

// Same ceiling as boundedResponseText(project), not a larger inspector buffer.
const MAX_PROJECT_BYTES = 8 * 1024 * 1024 + 4096 + 2048;
const ACTION = 'x-mediflow-extraction-action';
const GRANT = 'x-mediflow-extraction-grant';
type Headers = Record<string, string>;
type RequestEvent = { requestId: string; redirectResponse?: unknown;
  request: { url: string; method: string; headers: Headers } };
type ResponseEvent = { requestId: string; response: { url: string; status: number } };
type DataEvent = { requestId: string; dataLength: number; data?: string };
type FailedEvent = { requestId: string; canceled?: boolean; errorText?: string; type?: string; blockedReason?: string };
const header = (headers: Headers, name: string): string | undefined =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
const SAFE_RESOURCE_TYPES = new Set(['Document', 'Stylesheet', 'Image', 'Media', 'Font', 'Script', 'TextTrack', 'XHR', 'Fetch',
  'Prefetch', 'EventSource', 'WebSocket', 'Manifest', 'SignedExchange', 'Ping', 'CSPViolationReport', 'Preflight', 'FedCM', 'Other']);
const SAFE_BLOCKED_REASONS = new Set(['other', 'csp', 'mixed-content', 'origin', 'inspector', 'integrity', 'subresource-filter',
  'content-type', 'coep-frame-resource-needs-coep-header', 'coop-sandboxed-iframe-cannot-navigate-to-coop-page',
  'corp-not-same-origin', 'corp-not-same-origin-after-defaulted-to-same-origin-by-coep',
  'corp-not-same-origin-after-defaulted-to-same-origin-by-dip',
  'corp-not-same-origin-after-defaulted-to-same-origin-by-coep-and-dip', 'corp-not-same-site', 'sri-message-signature-mismatch']);
const safeTerminalValue = (value: unknown, allowed: ReadonlySet<string>) =>
  typeof value === 'string' && allowed.has(value) ? value : 'unknown';
const safeNetworkError = (value: unknown) =>
  typeof value === 'string' && /^net::ERR_[A-Z0-9_]{1,80}$/u.test(value) ? value : 'redacted_or_unknown';

/**
 * Observe the one real project POST. Arm before clicking; no Fetch interception,
 * page instrumentation, getResponseBody, extra HTTP request or network override.
 * Streaming is requested at requestWillBeSent, NOT after responseReceived.
 * Unsupported/late/incomplete capture fails the test; there is no fallback.
 */
export async function observeAnyDocProjectResponse(page: Page, attachmentId: string) {
  const url = new URL(`/api/attachments/${encodeURIComponent(attachmentId)}/local-extraction`, page.url()).href;
  const session = await page.context().newCDPSession(page);
  const complete = Promise.withResolvers<string>();
  void complete.promise.catch(() => {}); // Preserve an earlier acquire/UI failure.
  let requestId: string | undefined;
  let grant: string | undefined;
  let status: number | undefined;
  let matches = 0;
  let prefix: Buffer | undefined;
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let streamedBytes = 0;
  let finished = false;
  let disposed = false;
  let failure: Error | undefined;
  const fail = (reason: string) => {
    failure ??= new Error(`AnyDoc same-response observation: ${reason}`);
    complete.reject(failure); // Never include request headers or response payload.
  };
  const decode = (data: string): Buffer => {
    if (data.length > 4 * Math.ceil(MAX_PROJECT_BYTES / 3)) throw new Error('capture exceeds client bound');
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > MAX_PROJECT_BYTES) throw new Error('capture exceeds client bound');
    return bytes;
  };
  const finish = () => {
    if (disposed || failure || !finished || prefix === undefined) return;
    // dataLength is decoded body length, NOT loadingFinished.encodedDataLength.
    // The prefix covers all pre-stream bytes; data-bearing events cover the rest.
    if (status === undefined || receivedBytes === 0 || prefix.length + streamedBytes !== receivedBytes) {
      fail('incomplete response bytes'); return;
    }
    try {
      complete.resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([prefix, ...chunks])));
    } catch { fail('invalid UTF-8'); }
  };
  const onRequest = (event: RequestEvent) => {
    if (disposed) return;
    if (requestId === event.requestId && event.redirectResponse) { fail('redirected project'); return; }
    if (event.request.url !== url || event.request.method !== 'POST' || header(event.request.headers, ACTION) !== 'project') return;
    matches += 1;
    if (matches !== 1 || event.redirectResponse) { fail('ambiguous project request'); return; }
    requestId = event.requestId;
    grant = header(event.request.headers, GRANT);
    if (!grant) { fail('missing project grant'); return; }
    // No pause/continue handshake. The application proceeds independently.
    void session.send('Network.streamResourceContent', { requestId }).then(({ bufferedData }) => {
      if (disposed || failure) return;
      try { prefix = decode(bufferedData); finish(); }
      catch { fail('invalid buffered capture'); }
    }, () => fail('stream unavailable or enabled too late'));
  };
  const onResponse = (event: ResponseEvent) => {
    if (disposed || failure || event.requestId !== requestId) return;
    if (status !== undefined || event.response.url !== url) { fail('ambiguous project response'); return; }
    status = event.response.status;
  };
  const onData = (event: DataEvent) => {
    if (disposed || failure || event.requestId !== requestId) return;
    if (finished || !Number.isSafeInteger(event.dataLength) || event.dataLength < 0) { fail('invalid data event'); return; }
    receivedBytes += event.dataLength;
    if (receivedBytes > MAX_PROJECT_BYTES) { fail('capture exceeds client bound'); return; }
    if (event.data === undefined) return; // Covered by bufferedData, or denied at finish.
    try {
      const bytes = decode(event.data);
      if (bytes.length !== event.dataLength) { fail('chunk length mismatch'); return; }
      streamedBytes += bytes.length;
      if (bytes.length) chunks.push(bytes);
    } catch { fail('invalid streamed capture'); }
  };
  const onFinished = (event: { requestId: string }) => {
    if (disposed || failure || event.requestId !== requestId) return;
    if (finished) { fail('duplicate completion'); return; }
    finished = true; finish(); // May precede the stream command's Promise callback.
  };
  const onFailed = (event: FailedEvent) => {
    if (!disposed && event.requestId === requestId) {
      const canceled = event.canceled === undefined ? 'absent' : String(event.canceled);
      const terminal = `status=${status ?? 'null'} received=${receivedBytes} streamed=${streamedBytes} prefix=${prefix?.length ?? 0}`
        + ` finished=${finished} canceled=${canceled} error=${safeNetworkError(event.errorText)}`
        + ` type=${safeTerminalValue(event.type, SAFE_RESOURCE_TYPES)} blocked=${safeTerminalValue(event.blockedReason, SAFE_BLOCKED_REASONS)}`;
      fail(`project did not finish (${terminal})`);
    }
  };
  const onClose = () => { if (!disposed) fail('page closed'); };
  session.on('Network.requestWillBeSent', onRequest);
  session.on('Network.responseReceived', onResponse);
  session.on('Network.dataReceived', onData);
  session.on('Network.loadingFinished', onFinished);
  session.on('Network.loadingFailed', onFailed);
  page.on('close', onClose);
  const dispose = async () => {
    disposed = true;
    session.off('Network.requestWillBeSent', onRequest);
    session.off('Network.responseReceived', onResponse);
    session.off('Network.dataReceived', onData);
    session.off('Network.loadingFinished', onFinished);
    session.off('Network.loadingFailed', onFailed);
    page.off('close', onClose);
    complete.reject(new Error('AnyDoc same-response observation disposed'));
    prefix?.fill(0); prefix = undefined;
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
    await session.detach().catch(() => {}); // Teardown only, never an observation PASS.
  };
  try { await session.send('Network.enable'); }
  catch { await dispose(); throw new Error('AnyDoc same-response Network observer unavailable'); }
  const assertSameResponse = (response: PlaywrightResponse) => {
    if (failure) throw failure;
    const request = response.request();
    if (matches !== 1 || !finished || response.url() !== url || response.status() !== status
      || request.method() !== 'POST' || request.url() !== url
      || request.headers()[ACTION] !== 'project' || request.headers()[GRANT] !== grant)
      throw new Error('AnyDoc same-response observation does not match the UI request');
  };
  return {
    async json(response: PlaywrightResponse): Promise<ReturnType<typeof JSON.parse>> {
      const raw = await complete.promise;
      assertSameResponse(response);
      try { return JSON.parse(raw); }
      catch { throw new Error('AnyDoc same-response response is not JSON'); }
    },
    assertSameResponse, // Call again after UI assertions to catch a second POST.
    dispose,
  };
}
