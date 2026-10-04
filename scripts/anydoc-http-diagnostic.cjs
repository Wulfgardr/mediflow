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

module.exports = { assertSyntheticFixture, installHttpDiagnostic };
if (process.env.MEDIFLOW_ANYDOC_HTTP_DIAGNOSTIC === '1') {
  assertSyntheticFixture(process.env);
  installHttpDiagnostic(http.Server.prototype, event => {
    process.stdout.write(`ANYDOC_HTTP_DIAGNOSTIC ${JSON.stringify(event)}\n`);
  });
}
