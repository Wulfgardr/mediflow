// @Codex — synthetic classification fixtures, NOT additional browser captures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeCapture } from './decide-consent-cancellation.mjs';
const status = { canonicalExit: 1, filterExit: 0, attempts: 1, syntheticOnly: true };
function fixture(mode = 'closed') {
    const rows = [], port = 4567, session = 's2', request = 'r24', frame = 'f4', loader = 'l6', context = 'c8';
    let sequence = 0;
    const cdp = (method, fields = {}) => rows.push({ kind: 'cdp', session, request, frame, loader, port, direction: 'receive', method, ...fields });
    const page = (event, fields = {}) => rows.push({ kind: 'page-probe', session, frame, context, method: 'Runtime.consoleAPICalled',
        event, pageSequence: ++sequence, ...(!event.startsWith('probe/') ? { operation: 'consent', counter: 1 } : {}), ...fields });
    page('probe/armed');
    page('fetch/call', { signal: true, signalAborted: false });
    cdp('Network.requestWillBeSent', { route: 'consent', httpMethod: 'POST', redirect: false });
    cdp('Network.responseReceived', { route: 'consent', status: 200, serviceWorker: false });
    page('fetch/resolved'); page('response/body'); page('stream/get-reader');
    page('reader/read-call', { read: 1 });
    if (mode === 'closed' || mode === 'pass') {
        page('reader/read-settled', { read: 1, done: false, bytes: 3, bytesRead: 3 });
        page('reader/read-call', { read: 2 });
        page('reader/read-settled', { read: 2, done: true, bytes: 0, bytesRead: 3 });
        page('reader/cancel-call', { doneSeen: true, bytesRead: 3, callSite: 'readResponse' });
    } else if (mode === 'signal' || mode === 'signal-then-done') {
        page('abort-controller/call', { doneSeen: false, bytesRead: 0, callSite: 'setActive' });
        page('signal/abort', { doneSeen: false, bytesRead: 0, callSite: 'setActive' });
        page('reader/cancel-call', { doneSeen: false, bytesRead: 0, callSite: 'readResponse' });
        if (mode === 'signal-then-done') page('reader/read-settled', { read: 1, done: true, bytes: 0, bytesRead: 0 });
    } else if (mode === 'early') {
        page('reader/cancel-call', { doneSeen: false, bytesRead: 0, callSite: 'readResponse' });
        page('reader/read-settled', { read: 1, done: true, bytes: 0, bytesRead: 0 });
    } else if (mode === 'rejected' || mode === 'rejected-then-signal') {
        page('reader/read-rejected', { read: 1, failure: 'other' });
        if (mode === 'rejected-then-signal') {
            page('abort-controller/call', { doneSeen: false, bytesRead: 0, callSite: 'run' });
            page('signal/abort', { doneSeen: false, bytesRead: 0, callSite: 'run' });
        }
        page('reader/cancel-call', { doneSeen: false, bytesRead: 0, callSite: 'readResponse' });
    }
    cdp(mode === 'pass' ? 'Network.loadingFinished' : 'Network.loadingFailed',
        mode === 'pass' ? { encodedBytes: 263 } : { canceled: true, failure: 'aborted' });
    cdp('Network.getResponseBody', { direction: 'send' });
    cdp('Network.getResponseBody/reply', mode === 'pass' ? { ok: true, bytes: 3 } : { ok: false, failure: 'resource-missing' });
    page('probe/checkpoint');
    rows.push({ kind: 'scenario', port, startedAtUnixMs: 1, complete: true });
    const event = (name, seq, fields = {}) => rows.push({ kind: 'scenario-event', port, startedAtUnixMs: 1, event: name, sequence: seq, ...fields });
    event('wire/request', 1, { wire: 4, route: 'consent', method: 'POST', originMatches: true, fetchSameOrigin: true, json: true });
    event('wire/root-body-ready', 2, { wire: 4, status: 200, noStore: true, bytes: 3 });
    event('wire/finish', 3, { wire: 4, finished: true });
    event('browser/response', 4, { request: 9, route: 'consent', status: 200, noStore: true });
    event(mode === 'pass' ? 'browser/requestfinished' : 'browser/requestfailed', 5, { request: 9, ...(mode === 'pass' ? {} : { failure: 'aborted' }) });
    event(mode === 'pass' ? 'body/read-succeeded' : 'body/read-failed', 6, { request: 9, ...(mode === 'pass' ? {} : { failure: 'cdp-body-resource-missing' }) });
    event('page/probe/checkpoint', 7, { pageSequence: sequence });
    event('scenario-cleanup-start', 8);
    rows.push({ kind: 'capture-summary', schema: 'mediflow.cdp-metadata.v1', complete: true, bodyCommands: 1, bodyErrors: mode === 'pass' ? 0 : 1,
        emitted: rows.length, dropped: 0, malformed: 0, overflow: false, inputIncomplete: false, originalProbeIncomplete: false,
        pendingBodyCommands: 0, pageProbeEvents: sequence, pageProbeIncomplete: false });
    return rows;
}
function classify(rows, runStatus = status) {
    const result = analyzeCapture(rows, runStatus);
    assert.equal(result.fixEstablished, false); assert.equal(result.productChangeAuthorized, false); assert.equal(result.stopAfterThisCapture, true);
    return result.decisions[0];
}
const find = (rows, event) => rows.find(row => row.kind === 'page-probe' && row.event === event);
function recount(rows) { const summary = rows.at(-1); summary.emitted = rows.length - 1; summary.pageProbeEvents = rows.filter(row => row.kind === 'page-probe').length; }
for (const [mode, branch] of [
    ['closed', 'CLOSED_CANCEL_EXCLUDED'], ['signal', 'SIGNAL_ABORT_CANDIDATE'], ['early', 'EARLY_CANCEL_CANDIDATE'],
    ['rejected', 'READ_FAILURE_PRECEDES_CANCEL'], ['signal-then-done', 'SIGNAL_ABORT_CANDIDATE'],
    ['rejected-then-signal', 'READ_FAILURE_PRECEDES_CANCEL'], ['unresolved', 'CALLER_ORDER_UNRESOLVED'],
    ['pass', 'NOT_REPRODUCED'],
]) test(`bounded decision: ${mode} -> ${branch}; never a fix`, () => {
    const decision = classify(fixture(mode), { ...status, canonicalExit: mode === 'pass' ? 0 : 1 });
    assert.equal(decision.branch, branch, JSON.stringify(decision));
    if (mode === 'signal') { assert.equal(decision.site, 'setActive'); assert.match(decision.action, /does not identify HMR/u); }
    if (mode === 'early') assert.equal(decision.streamReadableNotProven, true);
});

test('wire payload bytes, not encoded HTTP overhead, bound the closed-stream inference', () => {
    const rows = fixture(); rows.find(row => row.event === 'wire/root-body-ready').bytes = 263;
    assert.equal(classify(rows).branch, 'CALLER_ORDER_UNRESOLVED');
});
test('old complete=true cannot certify missing caller telemetry', () => {
    const rows = fixture().filter(row => row.kind !== 'page-probe'); recount(rows);
    delete rows.at(-1).pageProbeEvents; delete rows.at(-1).pageProbeIncomplete;
    assert.equal(classify(rows).branch, 'MISSING_CALLER_WITNESS');
});
test('an isolated passing run remains inconclusive even with lost page events', () => {
    const rows = fixture('pass').filter(row => row.kind !== 'page-probe' && row.kind !== 'scenario' && row.kind !== 'scenario-event'); recount(rows);
    delete rows.at(-1).pageProbeEvents; delete rows.at(-1).pageProbeIncomplete;
    assert.equal(classify(rows, { ...status, canonicalExit: 0 }).branch, 'NOT_REPRODUCED');
});
for (const gap of ['missing-first', 'missing-middle', 'duplicate-sequence', 'missing-checkpoint', 'other-context', 'other-session', 'early-checkpoint'])
    test(`caller completeness fails closed: ${gap}`, () => {
        let rows = fixture();
        if (gap === 'missing-first') rows = rows.filter(row => row.event !== 'probe/armed');
        if (gap === 'missing-middle') rows = rows.filter(row => row.event !== 'response/body');
        if (gap === 'duplicate-sequence') find(rows, 'reader/cancel-call').pageSequence--;
        if (gap === 'missing-checkpoint') rows = rows.filter(row => row.event !== 'probe/checkpoint');
        if (gap === 'other-context') find(rows, 'probe/checkpoint').context = 'c99';
        if (gap === 'other-session') find(rows, 'probe/checkpoint').session = 's99';
        if (gap === 'early-checkpoint') {
            const checkpoint = rows.splice(rows.indexOf(find(rows, 'probe/checkpoint')), 1)[0];
            rows.splice(rows.findIndex(row => row.method === 'Network.getResponseBody'), 0, checkpoint);
        }
        recount(rows); assert.equal(classify(rows).branch, 'MISSING_CALLER_WITNESS');
    });
for (const key of ['complete', 'dropped', 'malformed', 'overflow', 'inputIncomplete', 'originalProbeIncomplete', 'pageProbeIncomplete', 'pendingBodyCommands', 'emitted', 'bodyCommands', 'bodyErrors', 'pageProbeEvents'])
    test(`capture accounting fails closed: ${key}`, () => {
        const rows = fixture(), summary = rows.at(-1); summary[key] = typeof summary[key] === 'boolean' ? !summary[key] : summary[key] + 1;
        assert.equal(classify(rows).branch, 'INVALID_CAPTURE');
    });
for (const method of ['Page.frameNavigated', 'Page.frameDetached', 'Runtime.executionContextsCleared', 'Target.detachedFromTarget'])
    test(`changed lifetime is not the frozen signature: ${method}`, () => {
        const rows = fixture(), at = rows.findIndex(row => row.method === 'Network.loadingFailed');
        rows.splice(at, 0, { kind: 'cdp', session: 's2', frame: 'f4', loader: 'l99', detachedSession: method === 'Target.detachedFromTarget' ? 's2' : undefined, method });
        recount(rows); assert.equal(classify(rows).branch, 'LIFETIME_CHANGED');
    });
test('checkpoint after changed document and checkpoint after cleanup cannot attribute callers', () => {
    const rows = fixture();
    rows.splice(rows.indexOf(find(rows, 'probe/checkpoint')), 0, { kind: 'cdp', session: 's2', method: 'Runtime.executionContextsCleared' }); recount(rows);
    assert.equal(classify(rows).branch, 'MISSING_CALLER_WITNESS');
    const late = fixture(); late.find(row => row.event === 'page/probe/checkpoint').sequence = 9;
    assert.equal(classify(late).branch, 'MISSING_CALLER_WITNESS');
});
test('the Node witness must place the checkpoint after the original body read', () => {
    const rows = fixture(); rows.find(row => row.event === 'page/probe/checkpoint').sequence = 5;
    assert.equal(classify(rows).branch, 'MISSING_CALLER_WITNESS');
});
test('a missing wire finish or mismatched observed failure cannot be treated as this reproduction', () => {
    for (const event of ['wire/finish', 'body/read-failed']) {
        const rows = fixture(); rows.find(row => row.event === event).event = 'unknown';
        assert.equal(classify(rows).branch, 'MISSING_CALLER_WITNESS');
    }
});
test('two accepted POSTs, redirects, a different resource error, or an orphaned read are never explained away', () => {
    const twice = fixture(), header = twice.find(row => row.method === 'Network.responseReceived');
    twice.splice(twice.indexOf(header), 0, { ...header }); recount(twice); assert.equal(classify(twice).branch, 'INVALID_CAPTURE');
    const redirected = fixture(); redirected.find(row => row.method === 'Network.requestWillBeSent').redirect = true;
    assert.equal(classify(redirected).branch, 'INVALID_CAPTURE');
    const evicted = fixture(); evicted.find(row => row.method === 'Network.getResponseBody/reply').failure = 'body-evicted';
    assert.equal(classify(evicted).branch, 'INVALID_CAPTURE');
    const orphan = fixture(); find(orphan, 'reader/read-settled').read = 8; assert.equal(classify(orphan).branch, 'CALLER_ORDER_UNRESOLVED');
});
test('a second reader invalidates natural EOF attribution to one reader', () => {
    const rows = fixture(); find(rows, 'response/body').event = 'stream/get-reader';
    assert.equal(classify(rows).branch, 'CALLER_ORDER_UNRESOLVED');
});
test('abort seen after the failed transport is not automatically its cause', () => {
    const rows = fixture('signal'), firstAbort = rows.findIndex(row => row.event === 'abort-controller/call');
    // Move only the transport event; the same-document JS sequence is intact.
    const terminal = rows.splice(rows.findIndex(row => row.method === 'Network.loadingFailed'), 1)[0];
    rows.splice(firstAbort, 0, terminal); recount(rows);
    assert.equal(classify(rows).branch, 'CALLER_ORDER_UNRESOLVED');
});
test('status cannot silently authorize multiple attempts or a broken filter', () => {
    for (const bad of [{ attempts: 2 }, { filterExit: 1 }, { syntheticOnly: false }, { canonicalExit: -1 }])
        assert.equal(classify(fixture(), { ...status, ...bad }).branch, 'INVALID_CAPTURE');
});
test('input without accepted consent is inconclusive, not a vacuous fix', () => {
    const result = analyzeCapture([], status); assert.equal(result.acceptedConsents, 0);
    assert.ok(result.captureProblems.includes('no-accepted-consent')); assert.equal(result.fixEstablished, false);
    assert.throws(() => analyzeCapture([null], status), /DECISION_INPUT_SHAPE/u);
});

test('WHATWG control: cancel after a natural closed stream does not call its source cancel', async () => {
    let cancellations = 0;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); }, cancel() { cancellations++; } });
    const reader = stream.getReader(); assert.equal((await reader.read()).done, false); assert.equal((await reader.read()).done, true);
    await reader.cancel(); assert.equal(cancellations, 0);
});
test('WHATWG control: cancel a readable stream calls its source; subsequent done is not natural EOF', async () => {
    let cancellations = 0;
    const reader = new ReadableStream({ cancel() { cancellations++; } }).getReader();
    await reader.cancel(); assert.equal(cancellations, 1); assert.equal((await reader.read()).done, true);
});
test('WHATWG control: cancel after a read rejected retains the stored error without invoking source cancel', async () => {
    let cancellations = 0; const error = new Error('synthetic stream error');
    const reader = new ReadableStream({ start(controller) { controller.error(error); }, cancel() { cancellations++; } }).getReader();
    await assert.rejects(reader.read(), actual => actual === error); await assert.rejects(reader.cancel(), actual => actual === error);
    assert.equal(cancellations, 0);
});

test('an actual signal after EOF remains a candidate; EOF never excuses a later controller abort', () => {
    const rows = fixture(), terminal = rows.findIndex(row => row.method === 'Network.loadingFailed');
    const template = find(rows, 'reader/cancel-call');
    rows.splice(terminal, 0, { ...template, event: 'abort-controller/call', callSite: 'run' }, { ...template, event: 'signal/abort', callSite: 'run' });
    let sequence = 0; for (const row of rows) if (row.kind === 'page-probe') row.pageSequence = ++sequence;
    rows.find(row => row.event === 'page/probe/checkpoint').pageSequence = sequence; recount(rows);
    const decision = classify(rows); assert.equal(decision.branch, 'SIGNAL_ABORT_CANDIDATE'); assert.equal(decision.eofBeforeSignal, true);
});


test('a controller abort can precede fetch rejection without any acquired body reader', () => {
    let rows = fixture('signal').filter(row => !['fetch/resolved','response/body','stream/get-reader','reader/read-call','reader/cancel-call'].includes(row.event));
    const terminal = rows.findIndex(row => row.method === 'Network.loadingFailed');
    rows.splice(terminal, 0, { ...find(rows, 'signal/abort'), event: 'fetch/rejected', failure: 'abort' });
    let sequence = 0; for (const row of rows) if (row.kind === 'page-probe') row.pageSequence = ++sequence;
    rows.find(row => row.event === 'page/probe/checkpoint').pageSequence = sequence; recount(rows);
    assert.equal(classify(rows).branch, 'SIGNAL_ABORT_CANDIDATE');
});

test('a fetch rejection before an observed controller abort is not promoted to caller causation', () => {
    let rows = fixture('signal').filter(row => !['fetch/resolved','response/body','stream/get-reader','reader/read-call','reader/cancel-call'].includes(row.event));
    rows.splice(rows.indexOf(find(rows, 'abort-controller/call')), 0, { ...find(rows, 'signal/abort'), event: 'fetch/rejected', failure: 'other' });
    let sequence = 0; for (const row of rows) if (row.kind === 'page-probe') row.pageSequence = ++sequence;
    rows.find(row => row.event === 'page/probe/checkpoint').pageSequence = sequence; recount(rows);
    assert.equal(classify(rows).branch, 'CALLER_ORDER_UNRESOLVED');
});
