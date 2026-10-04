// Opt-in synthetic E2E metadata only. No request/response bodies, identifiers,
// headers or error messages are logged; finish is not proof of browser receipt.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

function assertSyntheticFixture(env) {
  const directory = env.MEDIFLOW_DATA_DIR;
  if (!directory || !path.isAbsolute(directory) || env.MEDIFLOW_E2E_DATA_DIR !== directory
    || env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1' || env.E2E_DISABLE_LEGACY_COPY !== '1'
    || !fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()
    || !fs.lstatSync(path.join(directory, 'SYNTHETIC_ONLY')).isFile()
    || fs.lstatSync(path.join(directory, 'SYNTHETIC_ONLY')).isSymbolicLink())
    throw new Error('ANYDOC_HTTP_DIAGNOSTIC_REQUIRES_SYNTHETIC_FIXTURE');
}

function diagnosticMetadata(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  const { event, request, source, action, at, status, headersSent, writableFinished } = record;
  if (!Number.isSafeInteger(at) || at < 0) return null;
  if (event === 'diagnostic_limit') return { event: 'diagnostic_limit', at };
  const ordinal = value => Number.isInteger(value) && value >= 1 && value <= 128;
  if (!['request', 'request_aborted', 'response_finish', 'response_close'].includes(event)
    || !ordinal(request) || !ordinal(source) || (action !== 'project' && action !== 'release')
    || !Number.isInteger(status) || status < 0 || status > 999
    || typeof headersSent !== 'boolean' || typeof writableFinished !== 'boolean') return null;
  return { event, request, source, action, at, status, headersSent, writableFinished };
}

function openDiagnosticFile(env) {
  assertSyntheticFixture(env);
  // A fresh, dedicated file cannot inherit or overwrite ordinary server output.
  const fd = fs.openSync(path.join(env.MEDIFLOW_DATA_DIR, 'anydoc-http-diagnostic.jsonl'), 'wx', 0o600);
  return {
    write(record) {
      const metadata = diagnosticMetadata(record);
      if (metadata) fs.writeSync(fd, `${JSON.stringify(metadata)}\n`);
    },
    close() { fs.closeSync(fd); },
  };
}

function exportDiagnosticFile(env, destination) {
  assertSyntheticFixture(env);
  const source = path.join(env.MEDIFLOW_DATA_DIR, 'anydoc-http-diagnostic.jsonl');
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 513 * 256 || !path.isAbsolute(destination))
    throw new Error('ANYDOC_HTTP_DIAGNOSTIC_INVALID_ARTIFACT');
  const text = fs.readFileSync(source, 'utf8');
  const lines = text === '' ? [] : text.trimEnd().split('\n');
  if (lines.length > 513) throw new Error('ANYDOC_HTTP_DIAGNOSTIC_INVALID_ARTIFACT');
  const records = lines.map(line => {
    const record = JSON.parse(line);
    const metadata = diagnosticMetadata(record);
    if (!metadata || Object.keys(record).length !== Object.keys(metadata).length
      || Object.keys(record).some(key => !Object.hasOwn(metadata, key)))
      throw new Error('ANYDOC_HTTP_DIAGNOSTIC_INVALID_ARTIFACT');
    return JSON.stringify(metadata);
  });
  // Re-serialize approved primitives; never copy raw lines or overwrite an older artifact.
  fs.writeFileSync(destination, records.length ? `${records.join('\n')}\n` : '', { flag: 'wx', mode: 0o600 });
}

function installHttpDiagnostic(prototype, write) {
  const original = prototype.emit;
  // Bounded synthetic route-to-ordinal map; paths are never emitted. This
  // groups project/release for one source, without retaining a grant header.
  const sources = new Map();
  let sequence = 0, emitted = 0, limited = false;
  const emit = (event, request, source, action, response) => {
    if (emitted >= 512) return;
    emitted++;
    try {
      write({ event, request, source, action, at: Date.now(),
        status: Number.isInteger(response.statusCode) ? response.statusCode : 0,
        headersSent: response.headersSent === true, writableFinished: response.writableFinished === true });
    } catch { /* A diagnostic sink must not change application delivery. */ }
  };
  function wrapped(event, ...args) {
    if (event === 'request') {
      const [request, response] = args;
      try {
        const matches = typeof request.url === 'string'
          && /^\/api\/attachments\/[^/?]+\/local-extraction$/u.test(request.url);
        const action = request.method === 'DELETE' ? 'release'
          : request.method === 'POST' && request.headers['x-mediflow-extraction-action'] === 'project' ? 'project' : null;
        if (matches && action && sequence >= 128 && !limited) {
          limited = true;
          try { write({ event: 'diagnostic_limit', at: Date.now() }); } catch { /* Metadata only. */ }
        }
        if (matches && action && sequence < 128) {
          const id = ++sequence;
          if (!sources.has(request.url)) sources.set(request.url, sources.size + 1);
          const source = sources.get(request.url);
          emit('request', id, source, action, response);
          request.once('aborted', () => emit('request_aborted', id, source, action, response));
          response.once('finish', () => emit('response_finish', id, source, action, response));
          response.once('close', () => emit('response_close', id, source, action, response));
        }
      } catch { /* Ignore non-HTTP events; never change their arguments or result. */ }
    }
    return Reflect.apply(original, this, [event, ...args]);
  }
  prototype.emit = wrapped;
  return () => { if (prototype.emit === wrapped) prototype.emit = original; };
}

module.exports = { assertSyntheticFixture, installHttpDiagnostic, openDiagnosticFile, exportDiagnosticFile };
if (require.main === module) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--export') throw new Error();
    exportDiagnosticFile(process.env, process.argv[3]);
  } catch {
    process.stderr.write('ANYDOC_HTTP_DIAGNOSTIC_EXPORT_FAILED\n');
    process.exitCode = 1;
  }
} else if (process.env.MEDIFLOW_ANYDOC_HTTP_DIAGNOSTIC === '1') {
  const sink = openDiagnosticFile(process.env);
  installHttpDiagnostic(http.Server.prototype, sink.write);
}
