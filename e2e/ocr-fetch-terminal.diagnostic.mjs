import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const REPORT_PATH = process.env.OCR_FETCH_TERMINAL_REPORT ?? 'ocr-fetch-terminal-sanitized.json';
const TIMEOUT_MS = 10_000;
const BODY_BYTES = 1_078;
const allModes = [
  { name: 'manual-no-store', reader: 'manual', responseCache: 'no-store', retain: false },
  { name: 'array-buffer-no-store', reader: 'arrayBuffer', responseCache: 'no-store', retain: false },
  { name: 'manual-no-cache-control', reader: 'manual', responseCache: 'no-cache', retain: false },
  { name: 'manual-no-store-retained', reader: 'manual', responseCache: 'no-store', retain: true },
  { name: 'manual-no-store-known-length', reader: 'manual', responseCache: 'no-store', retain: false, knownLength: true },
];

const modes = process.env.OCR_FETCH_LENGTH_ONLY === '1' ? allModes.filter(mode => mode.knownLength) : allModes;

// Synthetic content is never included in output.
const prefix = '{"synthetic":"';
const suffix = '"}';
const syntheticLength = BODY_BYTES - prefix.length - suffix.length;
const body = Buffer.from(prefix + 'x'.repeat(syntheticLength) + suffix);
if (body.length !== BODY_BYTES) throw new Error('synthetic_body_size');

function networkError(value) {
  return typeof value === 'string' && /^net::ERR_[A-Z0-9_]{1,80}$/.test(value)
    ? value : 'redacted_or_unknown';
}

function terminalObserver(session, fixtureUrl) {
  let requestId;
  let receivedBytes = 0;
  let status = null;
  let settled = false;
  let timer;
  let resolveTerminal;
  const terminal = new Promise((resolve) => { resolveTerminal = resolve; });
  const finish = (state, encodedBytes = null, errorEnum = 'none') => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolveTerminal({ state, status, receivedBytes, encodedBytes, errorEnum });
  };
  session.on('Network.requestWillBeSent', (event) => {
    if (event.request.url === fixtureUrl && event.request.method === 'GET') requestId = event.requestId;
  });
  session.on('Network.responseReceived', (event) => {
    if (event.requestId === requestId) status = event.response.status;
  });
  session.on('Network.dataReceived', (event) => {
    if (event.requestId === requestId) receivedBytes += event.dataLength;
  });
  session.on('Network.loadingFinished', (event) => {
    if (event.requestId === requestId) finish('finished', event.encodedDataLength);
  });
  session.on('Network.loadingFailed', (event) => {
    if (event.requestId === requestId) finish('failed', null, networkError(event.errorText));
  });
  return {
    wait() {
      timer = setTimeout(() => finish('timeout', null, 'terminal_timeout'), TIMEOUT_MS);
      return terminal;
    },
  };
}

async function clientObservation(page, fixtureUrl, mode) {
  const work = page.evaluate(async ({ url, reader, retain, expectedLength }) => {
    const classify = (error) => {
      const name = error?.name;
      return ['AbortError', 'TypeError', 'SyntaxError', 'RangeError'].includes(name) ? name : 'other';
    };
    let status = null;
    let bytes = 0;
    let eof = null;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      status = response.status;
      if (retain) {
        window.__ocrFetchResponses ??= new Map();
        window.__ocrFetchResponses.set('current', response);
      }
      let content;
      if (reader === 'manual') {
        const streamReader = response.body.getReader();
        const chunks = [];
        try {
          while (true) {
            const part = await streamReader.read();
            if (part.done) {
              eof = true;
              break;
            }
            chunks.push(part.value);
            bytes += part.value.byteLength;
          }
        } finally {
          streamReader.releaseLock();
        }
        content = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
          content.set(chunk, offset);
          offset += chunk.byteLength;
        }
      } else {
        content = new Uint8Array(await response.arrayBuffer());
        bytes = content.byteLength;
      }
      let parseOkay = false;
      try {
        parseOkay = JSON.parse(new TextDecoder().decode(content))?.synthetic?.length === expectedLength;
      } catch {
        // A parse failure remains an observation, not an OCR assertion.
      }
      return { status, bytes, eof, parseOkay, errorEnum: 'none' };
    } catch (error) {
      return { status, bytes, eof, parseOkay: false, errorEnum: classify(error) };
    }
  }, {
    url: fixtureUrl, reader: mode.reader,
    retain: mode.retain, expectedLength: syntheticLength,
  });
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: null, bytes: null, eof: null,
          parseOkay: false, errorEnum: 'client_timeout' }), TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    work.catch(() => {});
  }
}

async function startServer() {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Synthetic fetch diagnostic</title>');
      return;
    }
    const knownLength = request.url === '/fixture?responseCache=no-store&length=known';
    const responseCache = knownLength || request.url === '/fixture?responseCache=no-store'
      ? 'no-store' : request.url === '/fixture?responseCache=no-cache' ? 'no-cache' : null;
    if (request.method !== 'GET' || responseCache === null) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': responseCache,
      ...(knownLength ? { 'content-length': body.length } : {}),
    });
    response.write(body.subarray(0, 539));
    setTimeout(() => {
      if (!response.destroyed && !response.writableEnded) response.end(body.subarray(539));
    }, 20);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

async function main() {
  const report = {
    schemaVersion: 1, diagnosticOnly: true, browserVersion: null,
    bodyBytes: BODY_BYTES, observations: [],
  };
  let server;
  let browser;
  try {
    server = await startServer();
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    report.browserVersion = browser.version();
    for (const mode of modes) {
      for (let repeatIndex = 1; repeatIndex <= 2; repeatIndex += 1) {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(origin, { waitUntil: 'load' });
          const session = await context.newCDPSession(page);
          await session.send('Network.enable');
          const fixtureUrl = `${origin}/fixture?responseCache=${mode.responseCache}${mode.knownLength ? '&length=known' : ''}`;
          const terminal = terminalObserver(session, fixtureUrl).wait();
          const [client, network] = await Promise.all([
            clientObservation(page, fixtureUrl, mode), terminal,
          ]);
          report.observations.push({
            mode: mode.name, repeatIndex, requestCache: 'no-store',
            responseCache: mode.responseCache, reader: mode.reader,
            retainedUntilTerminal: mode.retain, knownLength: Boolean(mode.knownLength), client, network,
          });
          if (mode.retain && client.errorEnum !== 'client_timeout') {
            await page.evaluate(() => window.__ocrFetchResponses?.clear());
          }
          await session.detach();
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    if (browser) await browser.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (report.observations.length !== modes.length * 2) process.exitCode = 1;
  process.stdout.write(`Saved ${report.observations.length} sanitized diagnostic observations.\n`);
}

main().catch(() => {
  // Never expose browser/server error text, request URLs or bodies in CI output.
  process.stderr.write('Synthetic fetch diagnostic harness failed; inspect sanitized metrics.\n');
  process.exitCode = 1;
});
