// Temporary synthetic E2E diagnostics (AnyDoc correlation v2), never product telemetry.
const fs = require('node:fs');
const path = require('node:path');
const HEADER = 'x-mediflow-anydoc-diagnostic';
const ID = /^ad1-([a-f0-9]{32})-([12])-([1-8])$/u;
const count = value => Number.isSafeInteger(value) && value >= 0;

function parseId(value) {
  const match = typeof value === 'string' && ID.exec(value);
  return match ? { id: value, scope: match[1], attempt: Number(match[2]) } : null;
}

function assertSyntheticFixture(env) {
  const directory = env.MEDIFLOW_DATA_DIR;
  if (!directory || !path.isAbsolute(directory) || env.MEDIFLOW_E2E_DATA_DIR !== directory
    || env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY !== '1' || env.E2E_DISABLE_LEGACY_COPY !== '1'
    || !fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()
    || !fs.lstatSync(path.join(directory, 'SYNTHETIC_ONLY')).isFile()
    || fs.lstatSync(path.join(directory, 'SYNTHETIC_ONLY')).isSymbolicLink())
    throw new Error('ANYDOC_HTTP_DIAGNOSTIC_REQUIRES_SYNTHETIC_FIXTURE');
}

function clientComplete(snapshot) {
  return snapshot?.sealed === true && count(snapshot.total) && snapshot.dropped === 0
    && Array.isArray(snapshot.events) && snapshot.events.length === snapshot.total
    && snapshot.events.every((event, index) => event.seq === index + 1
      && !/error|unavailable|limit/u.test(event.event));
}

function serverComplete(input) {
  const records = input.filter(record => record.event !== 'collection_status');
  const end = records.at(-1);
  return records[0]?.event === 'collector_start' && end?.event === 'collector_end'
    && records.filter(record => record.event === 'collector_start').length === 1
    && records.filter(record => record.event === 'collector_end').length === 1
    && records.every((record, index) => record.seq === index + 1)
    && end.observed === records.length - 1 && end.written === end.observed
    && end.dropped === 0 && end.limited === 0 && end.invalid === 0 && end.pending === 0
    && end.requests === records.filter(record => record.event === 'request').length;
}

// No timestamp comparisons. Completeness concerns the captured window, not
// HTTP success: a fully recorded failed request is still a failed request.
function auditJoin(attachment, server) {
  const consumer = attachment?.consumer?.events ?? [];
  const browser = attachment?.browser?.events ?? [];
  const scope = attachment?.scope;
  const collection = { consumer: clientComplete(attachment?.consumer), browser: clientComplete(attachment?.browser),
    server: serverComplete(server) };
  const errors = [];
  if (typeof scope !== 'string' || !/^[a-f0-9]{32}$/u.test(scope)) errors.push('invalid_scope');
  const contextual = new Set(['armed', 'pagehide', 'pageshow', 'navigation', 'page_closed', 'page_crashed']);
  if ([...consumer, ...browser].some(record => !contextual.has(record.event)
    && parseId(record.id)?.scope !== scope)) errors.push('missing_or_foreign_id');
  const roots = consumer.filter(record => ['fetch_start', 'release_start'].includes(record.event));
  const browserRoots = browser.filter(record => ['request', 'release_request'].includes(record.event));
  const serverRoots = server.filter(record => record.event === 'request' && parseId(record.id)?.scope === scope);
  const ids = new Set([...roots, ...browserRoots, ...serverRoots].map(record => record.id));
  if (ids.size === 0) errors.push('no_requests');
  const requests = [];
  for (const id of ids) {
    const parsed = parseId(id);
    if (!parsed || parsed.scope !== scope) { errors.push('invalid_id'); continue; }
    const c = consumer.filter(record => record.id === id);
    const b = browser.filter(record => record.id === id);
    const s = server.filter(record => record.id === id);
    const starts = roots.filter(record => record.id === id);
    const action = starts[0]?.event === 'release_start' ? 'release' : 'project';
    const prefix = action === 'release' ? 'release_' : '';
    if (starts.length !== 1 || browserRoots.filter(record => record.id === id).length !== 1
      || serverRoots.filter(record => record.id === id).length !== 1) errors.push('non_unique_join');
    if ([...c, ...b].some(record => record.attempt !== parsed.attempt)
      || s.some(record => record.action !== action)
      || b.filter(record => ['request', 'release_request'].includes(record.event))
        .some(record => record.event !== `${prefix}request`)) errors.push('owner_mismatch');
    const terminals = b.filter(record => [`${prefix}requestfinished`, `${prefix}requestfailed`].includes(record.event));
    if (terminals.length !== 1 || s.filter(record => record.event === 'response_close').length !== 1)
      errors.push('terminal_missing_or_duplicate');
    const consumerTerminal = action === 'release' ? ['release_response', 'release_rejected', 'release_throw']
      : ['read_done', 'read_rejected', 'read_throw', 'fetch_rejected', 'fetch_throw', 'body_absent'];
    if (!c.some(record => consumerTerminal.includes(record.event))) errors.push('consumer_terminal_missing');
    requests.push({ id, attempt: parsed.attempt, action, browserTerminal: terminals[0]?.event ?? null,
      serverFinished: s.some(record => record.event === 'response_finish'),
      serverClosed: s.some(record => record.event === 'response_close') });
  }
  for (const records of [consumer, browser, server.filter(record => parseId(record.id)?.scope === scope)]) {
    if (records.some(record => record.id && !ids.has(record.id))) errors.push('orphan_record');
  }
  return { complete: Object.values(collection).every(Boolean) && errors.length === 0,
    collection, errors: [...new Set(errors)], requests };
}

module.exports = { HEADER, parseId, assertSyntheticFixture, clientComplete, serverComplete, auditJoin };
