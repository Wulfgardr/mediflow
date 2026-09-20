#!/usr/bin/env node
// @Codex — single-experiment decision reducer. No browser, network or body reads.
// Input is ONLY the existing allowlisted metadata, never raw pw:protocol output.
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const integer = value => Number.isSafeInteger(value) && value >= 0;
const alias = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}[0-9]+$`, 'u').test(value);
const first = (rows, event) => rows.find(row => row.event === event);
const cancels = new Set(['reader/cancel-call', 'stream/cancel-call']);
const actions = {
    INVALID_CAPTURE: 'Stop: repair the bounded capture/association, not the product. Do not infer absence from missing records.',
    MISSING_CALLER_WITNESS: 'Stop: no caller attribution. Execute the one predeclared checkpoint capture, not repeated reruns.',
    NOT_REPRODUCED: 'Stop: retain this control observation; no fix, no merge and no automatic repetition.',
    LIFETIME_CHANGED: 'Inspect the witnessed document/session/cleanup transition. This is not the frozen stable-lifetime signature.',
    SIGNAL_ABORT_CANDIDATE: 'Inspect the witnessed cancellation caller. setActive does not identify HMR; preserve revocation/abort controls.',
    EARLY_CANCEL_CANDIDATE: 'Inspect the witnessed pre-EOF cancel. doneSeen=false does not prove readable state or establish causality.',
    CLOSED_CANCEL_EXCLUDED: 'Do not remove finally.cancel as a fix. Investigate the pinned native loader/inspector path; EOF is not Network.loadingFinished.',
    READ_FAILURE_PRECEDES_CANCEL: 'Do not blame finally.cancel: the read already rejected. Isolate the pinned native/transport failure, not a product cleanup workaround.',
    CALLER_ORDER_UNRESOLVED: 'Stop: the observed public-API ordering does not select a cause. Do not infer HMR, GC or a production defect.',
};

/** Classification selects the NEXT causal investigation, never authorizes a fix.
 * Row order is the received protocol order, NOT a shared renderer/network clock.
 * Only same-document caller sequences certify the order of JS public-API calls.
 */
export function analyzeCapture(input, status) {
    if (!Array.isArray(input) || input.length > 16000 || input.some(row => !row || typeof row !== 'object' || Array.isArray(row)))
        throw new Error('DECISION_INPUT_SHAPE');
    const rows = input.map((row, index) => ({ ...row, line: index + 1 }));
    const summaries = rows.filter(row => row.kind === 'capture-summary');
    const summary = summaries[0];
    const globalProblems = [];
    if (summaries.length !== 1 || summary?.line !== rows.length || summary?.schema !== 'mediflow.cdp-metadata.v1'
        || summary?.complete !== true || summary?.pendingBodyCommands !== 0 || summary?.emitted !== rows.length - 1
        || ['dropped', 'malformed'].some(key => summary?.[key] !== 0)
        || ['overflow', 'inputIncomplete', 'originalProbeIncomplete'].some(key => summary?.[key] !== false)
        || summary?.pageProbeIncomplete === true) globalProblems.push('capture-completeness');
    if (!status || !integer(status.canonicalExit) || status.filterExit !== 0 || status.attempts !== 1 || status.syntheticOnly !== true)
        globalProblems.push('single-canonical-status');
    const protocolRows = rows.filter(row => row.kind === 'cdp');
    const commands = protocolRows.filter(row => row.method === 'Network.getResponseBody' && row.direction === 'send');
    const allPageRows = rows.filter(row => row.kind === 'page-probe');
    if (summary?.pageProbeEvents !== undefined && summary.pageProbeEvents !== allPageRows.length) globalProblems.push('page-event-accounting');
    const errors = protocolRows.filter(row => row.method === 'Network.getResponseBody/reply' && row.ok === false);
    if (commands.length !== summary?.bodyCommands || errors.length !== summary?.bodyErrors) globalProblems.push('body-command-accounting');
    const headers = protocolRows.filter(row => row.method === 'Network.responseReceived' && row.route === 'consent' && row.status === 200);
    if (!headers.length) globalProblems.push('no-accepted-consent');
    const decisions = headers.map(header => {
        const problems = [...globalProblems];
        const base = { session: alias(header.session, 's') ? header.session : null, request: alias(header.request, 'r') ? header.request : null,
            headerLine: header.line, fixEstablished: false };
        function result(branch, details = {}) { return { ...base, branch, action: actions[branch], ...details, problems }; }
        const same = protocolRows.filter(row => row.session === header.session && row.request === header.request);
        const byMethod = method => same.filter(row => row.method === method);
        const requests = byMethod('Network.requestWillBeSent'), replies = byMethod('Network.getResponseBody/reply');
        const sent = byMethod('Network.getResponseBody'), terminal = same.filter(row => ['Network.loadingFinished', 'Network.loadingFailed'].includes(row.method));
        const request = requests[0], reply = replies[0], end = terminal[0];
        const acceptedHere = headers.filter(row => row.session === header.session && row.frame === header.frame);
        if (!base.session || !base.request || !integer(header.port) || header.port < 1 || header.port > 65535
            || !alias(header.frame, 'f') || !alias(header.loader, 'l') || acceptedHere.length !== 1
            || requests.length !== 1 || replies.length !== 1 || sent.length !== 1 || terminal.length !== 1
            || request?.direction !== 'receive' || header.direction !== 'receive' || sent[0]?.direction !== 'send' || reply?.direction !== 'receive'
            || request?.route !== 'consent' || request?.httpMethod !== 'POST' || request?.redirect !== false
            || request?.frame !== header.frame || request?.loader !== header.loader || header.serviceWorker !== false
            || !(request.line < header.line && header.line < end?.line && end.line < sent[0]?.line && sent[0].line < reply?.line))
            problems.push('request-terminal-association');
        if (problems.length) return result('INVALID_CAPTURE');
        base.terminalLine = end.line; base.bodyReplyLine = reply.line;
        base.network = end.method === 'Network.loadingFailed' ? 'failed' : 'finished'; base.bodyOk = reply.ok === true;
        const reproduced = end.method === 'Network.loadingFailed' && end.canceled === true && end.failure === 'aborted'
            && reply.ok === false && reply.failure === 'resource-missing';
        base.originalSignature = reproduced;
        if (!reproduced && !(end.method === 'Network.loadingFinished' && reply.ok === true)) {
            problems.push('different-failure-signature'); return result('INVALID_CAPTURE');
        }
        const lifecycle = protocolRows.find(row => request.line < row.line && row.line < reply.line && (
            row.detachedSession === header.session || row.session === header.session && (
                row.method === 'Runtime.executionContextsCleared' || row.method === 'Page.frameDetached' && row.frame === header.frame
                || row.method === 'Page.frameNavigated' && row.frame === header.frame && row.loader !== header.loader)));
        if (lifecycle) return result('LIFETIME_CHANGED', { transitionLine: lifecycle.line });
        // Accept a wire witness only from the single scenario using this port.
        // A port reuse, multiple accepted POSTs or missing success snapshot is ambiguous.
        const scenarios = rows.filter(row => row.kind === 'scenario' && row.port === header.port);
        const scenario = scenarios[0];
        const events = rows.filter(row => row.kind === 'scenario-event' && row.port === header.port && row.startedAtUnixMs === scenario?.startedAtUnixMs);
        const wires = events.filter(row => row.event === 'wire/request' && row.route === 'consent' && row.method === 'POST'
            && row.originMatches === true && row.fetchSameOrigin === true && row.json === true);
        const ready = events.filter(row => row.event === 'wire/root-body-ready' && row.wire === wires[0]?.wire);
        const finish = events.filter(row => row.event === 'wire/finish' && row.wire === wires[0]?.wire && row.finished === true);
        const cleanup = first(events, 'scenario-cleanup-start');
        const browserHeaders = events.filter(row => row.event === 'browser/response' && row.route === 'consent' && row.status === 200);
        const bodyResult = events.filter(row => ['body/read-failed', 'body/read-succeeded'].includes(row.event) && row.request === browserHeaders[0]?.request);
        const browserEnd = events.filter(row => ['browser/requestfinished', 'browser/requestfailed'].includes(row.event) && row.request === browserHeaders[0]?.request);
        if (scenarios.length !== 1 || scenario?.complete !== true || wires.length !== 1 || ready.length !== 1
            || ready[0]?.status !== 200 || ready[0]?.noStore !== true || !integer(ready[0]?.bytes)
            || browserHeaders.length !== 1 || browserHeaders[0]?.noStore !== true || !cleanup || bodyResult.length !== 1
            || finish.length !== 1 || browserEnd.length !== 1
            || bodyResult[0]?.event !== (reproduced ? 'body/read-failed' : 'body/read-succeeded')
            || browserEnd[0]?.event !== (reproduced ? 'browser/requestfailed' : 'browser/requestfinished')
            || (reproduced && (bodyResult[0]?.failure !== 'cdp-body-resource-missing' || browserEnd[0]?.failure !== 'aborted'))
            || !(wires[0].sequence < ready[0].sequence && ready[0].sequence < finish[0]?.sequence
                && finish[0].sequence < browserEnd[0]?.sequence && browserEnd[0].sequence < bodyResult[0].sequence && bodyResult[0].sequence < cleanup.sequence)) problems.push('wire-or-precleanup-witness');
        const pageRows = rows.filter(row => row.kind === 'page-probe' && row.method === 'Runtime.consoleAPICalled'
            && row.session === header.session && row.frame === header.frame);
        const calls = pageRows.filter(row => row.event === 'fetch/call' && row.operation === 'consent');
        const call = calls[0];
        const document = pageRows.filter(row => row.context === call?.context);
        const checkpoints = document.filter(row => row.event === 'probe/checkpoint');
        const checkpoint = checkpoints[0];
        const prefix = document.filter(row => row.line <= (checkpoint?.line ?? -1));
        if (calls.length !== 1 || !alias(call?.context, 'c') || !integer(call?.counter) || call.counter === 0
            || checkpoints.length !== 1 || checkpoint.line <= reply.line || prefix[0]?.event !== 'probe/armed'
            || prefix.some((row, index) => row.pageSequence !== index + 1 || row.event === 'probe/overflow')
            || prefix.at(-1)?.event !== 'probe/checkpoint' || !integer(summary?.pageProbeEvents) || summary.pageProbeIncomplete !== false)
            problems.push('contiguous-caller-checkpoint');
        const mirrored = events.filter(row => row.event === 'page/probe/checkpoint' && row.pageSequence === checkpoint?.pageSequence);
        if (mirrored.length !== 1 || !cleanup || !bodyResult[0] || !(bodyResult[0].sequence < mirrored[0].sequence && mirrored[0].sequence < cleanup.sequence)) problems.push('checkpoint-before-cleanup');
        if (problems.length) return result(reproduced ? 'MISSING_CALLER_WITNESS' : 'NOT_REPRODUCED', { callerCoverage: false });
        // A same-frame navigation after the body reply invalidates the checkpoint too.
        if (protocolRows.some(row => reply.line < row.line && row.line < checkpoint.line && (row.detachedSession === header.session
            || row.session === header.session && ['Page.frameNavigated', 'Page.frameDetached', 'Runtime.executionContextsCleared'].includes(row.method)))) {
            problems.push('checkpoint-document-changed'); return result('MISSING_CALLER_WITNESS', { callerCoverage: false });
        }
        const caller = prefix.filter(row => row.operation === 'consent' && row.counter === call.counter);
        base.callerCoverage = true; base.checkpointLine = checkpoint.line;
        base.callerLines = caller.map(row => row.line);
        const settled = caller.filter(row => row.event === 'reader/read-settled');
        const eof = settled.find(row => row.done === true);
        const rejected = caller.find(row => ['reader/read-rejected', 'fetch/rejected'].includes(row.event));
        const signal = first(caller, 'signal/abort');
        const cancel = caller.find(row => cancels.has(row.event));
        const abort = first(caller, 'abort-controller/call');
        const readCalls = caller.filter(row => row.event === 'reader/read-call');
        const readOutcomes = caller.filter(row => ['reader/read-settled', 'reader/read-rejected'].includes(row.event));
        const readers = caller.filter(row => row.event === 'stream/get-reader').length;
        const resolved = caller.filter(row => row.event === 'fetch/resolved').length;
        const fetchRejected = caller.filter(row => row.event === 'fetch/rejected').length;
        const wellFormedReads = readers <= 1 && readCalls.every((row, index) => row.read === index + 1)
            && readOutcomes.every(row => readCalls.filter(call => call.read === row.read && call.line < row.line).length === 1)
            && new Set(readOutcomes.map(row => row.read)).size === readOutcomes.length
            && settled.every(row => typeof row.done === 'boolean' && integer(row.bytes) && integer(row.bytesRead));
        if (!wellFormedReads || resolved + fetchRejected > 1 || call.signal !== true || call.signalAborted !== false) {
            problems.push('caller-state-not-established'); return result('CALLER_ORDER_UNRESOLVED');
        }
        if (!reproduced) return result('NOT_REPRODUCED', { closedCancelObserved: !!(eof && cancel && eof.line < cancel.line && !signal && !rejected) });
        // Never promote a cleanup cancel following an existing read rejection.
        // Cross-domain log order selects a candidate only; it is not causality.
        if (signal && abort && abort.line < signal.line && signal.line < end.line && (!rejected || signal.line < rejected.line))
            return result('SIGNAL_ABORT_CANDIDATE', { site: ['setActive', 'run', 'readResponse'].includes(abort.callSite) ? abort.callSite : 'other',
                signalLine: signal.line, abortLine: abort.line, eofBeforeSignal: !!(eof && eof.line < signal.line) });
        if (resolved !== 1 || readers !== 1) {
            problems.push('no-resolved-single-reader'); return result('CALLER_ORDER_UNRESOLVED');
        }
        if (cancel && cancel.line < end.line && (!eof || cancel.line < eof.line) && (!rejected || cancel.line < rejected.line)
            && (!signal || cancel.line < signal.line)) return result('EARLY_CANCEL_CANDIDATE', { cancelLine: cancel.line, streamReadableNotProven: true });
        // A natural done:true excludes an effectful cancel on that closed stream.
        // A done:true produced by an EARLIER cancel/abort is not natural EOF.
        const naturalEof = eof && !rejected && !signal && !abort && (!cancel || eof.line < cancel.line)
            && eof.bytes === 0 && eof.bytesRead === ready[0].bytes
            && readCalls.length === readOutcomes.length && settled.filter(row => row.done === true).length === 1
            && settled.filter(row => row.done === false).reduce((sum, row) => sum + row.bytes, 0) === ready[0].bytes;
        if (naturalEof && cancel && cancel.doneSeen === true && cancel.bytesRead === ready[0].bytes && cancel.callSite === 'readResponse')
            return result('CLOSED_CANCEL_EXCLUDED', { eofLine: eof.line, cancelLine: cancel.line, callerBytes: eof.bytesRead, wireBytes: ready[0].bytes });
        if (rejected && (!cancel || rejected.line < cancel.line) && (!signal || rejected.line < signal.line) && (!abort || rejected.line < abort.line))
            return result('READ_FAILURE_PRECEDES_CANCEL', { readRejectedLine: rejected.line, cancelLine: cancel?.line ?? null });
        return result('CALLER_ORDER_UNRESOLVED');
    });
    return { schema: 'mediflow.consent-cancellation-decision.v1', fixEstablished: false, productChangeAuthorized: false,
        stopAfterThisCapture: true, canonicalExit: integer(status?.canonicalExit) ? status.canonicalExit : null,
        captureProblems: globalProblems, acceptedConsents: headers.length, originalFailures: decisions.filter(row => row.originalSignature).length,
        decisions };
}
function boundedRead(path, maximum) {
    if (statSync(path).size > maximum) throw new Error('DECISION_INPUT_LIMIT');
    return readFileSync(path, 'utf8');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 4) throw new Error('Usage: node decide-consent-cancellation.mjs metadata.jsonl status.json');
        const lines = boundedRead(process.argv[2], 8 * 1024 * 1024).trim().split('\n').map(line => JSON.parse(line));
        const status = JSON.parse(boundedRead(process.argv[3], 4096));
        process.stdout.write(JSON.stringify(analyzeCapture(lines, status), null, 2) + '\n');
    } catch {
        // No paths, raw protocol values or parser excerpts in the output.
        console.error('DECISION_INPUT_INVALID'); process.exitCode = 2;
    }
}
