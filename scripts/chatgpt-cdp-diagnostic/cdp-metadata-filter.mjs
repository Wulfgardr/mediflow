#!/usr/bin/env node
// @Codex: temporary synthetic CI diagnosis; not a release fix.
// Read-only stream reducer for the ORIGINAL Playwright pw:protocol connection.
// Never opens CDP, issues Network.enable/getResponseBody, or forwards raw logs.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const NS = '/api/settings/ai/chatgpt/synthesis/';
const OPS = new Set(['status','prepare','consent','login/start','login/complete','login/cancel','read','models','generate','cancel','logout']);
const METHODS = new Set(['Network.enable','Network.disable','Network.setCacheDisabled','Fetch.enable','Fetch.disable',
    'Fetch.continueRequest','Fetch.fulfillRequest','Fetch.failRequest','Network.getResponseBody',
    'Page.navigate','Target.closeTarget','Target.detachFromTarget','Browser.close']);
const HMR = new Set(['sync','building','built','reloadPage','serverComponentChanges','serverOnlyChanges','serverError']);
const PAGE_PREFIX = '[mediflow-response-lifetime]';
const PAGE_EVENTS = new Set(['probe/overflow','fetch/call','fetch/resolved','fetch/rejected','response/body','stream/get-reader','stream/cancel-call',
    'reader/read-call','reader/read-settled','reader/read-rejected','reader/cancel-call','abort-controller/call','signal/abort']);
function failure(text) {
    if (typeof text !== 'string') return 'other';
    if (text.includes('No data found for resource with given identifier')) return 'resource-missing';
    if (text.includes('evicted from inspector cache')) return 'body-evicted';
    if (text.includes('ERR_ABORTED')) return 'aborted';
    if (text.includes('ERR_INCOMPLETE_CHUNKED_ENCODING')) return 'incomplete-body';
    if (text.includes('ERR_CONNECTION')) return 'connection';
    return 'other';
}
export function createReducer(emit, { recordLimit = 12000, mapLimit = 4096 } = {}) {
    let records = 0, dropped = 0, malformed = 0, protocol = 0, bodyCommands = 0, bodyErrors = 0, pageProbeEvents = 0;
    let overflow = false, inputIncomplete = false, originalProbeIncomplete = false, pageProbeIncomplete = false;
    const aliases = new Map(), pending = new Map(), websockets = new Set(), executionFrames = new Map();
    function alias(kind, raw) {
        if (typeof raw !== 'string' && typeof raw !== 'number') return null;
        const key = `${kind}:${raw}`;
        if (!aliases.has(key)) {
            if (aliases.size >= mapLimit) { overflow = true; return null; }
            aliases.set(key, `${kind}${aliases.size + 1}`);
        }
        return aliases.get(key);
    }
    function output(value) { if (records++ < recordLimit) emit(value); else dropped++; }
    function pageProbe(p) {
        if (!p || p.schema !== 'mediflow.synthetic-response-lifetime-page.v1' || !PAGE_EVENTS.has(p.event)
            || p.event !== 'probe/overflow' && !OPS.has(p.operation)) return null;
        const value = { kind:'page-probe', event:p.event, ...(OPS.has(p.operation) ? {operation:p.operation} : {}) };
        for (const k of ['counter','read','bytes','bytesRead']) if (Number.isSafeInteger(p[k]) && p[k] >= 0) value[k] = p[k];
        for (const k of ['done','doneSeen','signal','signalAborted']) if (typeof p[k] === 'boolean') value[k] = p[k];
        if (['readResponse','setActive','run','other'].includes(p.callSite)) value.callSite = p.callSite;
        if (['abort','other'].includes(p.failure)) value.failure = p.failure;
        pageProbeEvents++; if (p.event === 'probe/overflow') pageProbeIncomplete = true;
        return value;
    }
    function route(raw) {
        try {
            const u = new URL(raw);
            if (!['http:','https:','ws:','wss:'].includes(u.protocol) || !['127.0.0.1','localhost','[::1]'].includes(u.hostname)) return { route: 'external' };
            const suffix = u.pathname.slice(NS.length);
            return { route: u.pathname.startsWith(NS) && OPS.has(suffix) ? suffix : u.pathname === '/' ? 'document'
                : u.pathname === '/_next/hmr' ? 'hmr' : u.pathname.startsWith('/_next/static/') ? 'next-static' : 'other-local',
                port: Number(u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80)) };
        } catch { return { route: 'invalid' }; }
    }
    const method = value => value === 'POST' || value === 'GET' ? value : 'other';
    function line(raw) {
        const marker = raw.indexOf('pw:protocol');
        // The original, already-minimized per-scenario diagnostic is retained only
        // as whitelisted scalar fields; never trust arbitrary TAP JSON wholesale.
        if (marker < 0) {
            const start = raw.indexOf('{');
            if (start < 0 || !raw.includes('mediflow.synthetic-response-lifetime')) return;
            try {
                const p = JSON.parse(raw.slice(start));
                if (p.schema === 'mediflow.synthetic-response-lifetime-page.v1') {
                    const v = pageProbe(p); if (!v) { malformed++; return; }
                    output(v); return;
                }
                if (p.schema !== 'mediflow.synthetic-response-lifetime.v1' || !Array.isArray(p.events)) return;
                if (p.complete !== true) originalProbeIncomplete = true;
                output({ kind: 'scenario', startedAtUnixMs: Number(p.startedAtUnixMs), port: Number(p.gatewayPort), complete: p.complete === true });
                const eventNames = /^(?:scenario-(?:start|work-succeeded|cleanup-start|succeeded|failed)|ui-ready|consent-(?:wait-armed|http-asserted)|(?:context|gateway)-close-start|body\/read-(?:start|succeeded|failed)|wire\/(?:request|root-body-ready|finish|close|abort|error|hmr-upgrade)|browser\/(?:request|response|requestfinished|requestfailed|main-frame-commit|frame-detached|page-closed|page-crashed|context-closed|disconnected|hmr-console|hmr-socket|hmr-frame|hmr-closed)|page\/(?:probe\/overflow|fetch\/(?:call|resolved|rejected)|response\/body|stream\/(?:get-reader|cancel-call)|reader\/(?:read-call|read-settled|read-rejected|cancel-call)|abort-controller\/call|signal\/abort))$/u;
                const numbers = ['sequence','milliseconds','request','wire','status','bytes','document','counter','read','bytesRead'];
                const bools = ['originMatches','fetchSameOrigin','json','finished','noStore','serviceWorker','navigation','redirected','main','reload','rebuilding','done','doneSeen','signal','signalAborted'];
                const allowedStrings = new Set([...OPS,...HMR,'unknown','document','next-static','hmr','other-local','external','invalid-url','other','GET','POST','abort','aborted','failed','connection','incomplete-body','none','cdp-body-resource-missing','cdp-body-evicted','target-closed','cdp-body-other','invalid-json']);
                for (const e of p.events.slice(0,512)) {
                    if (!eventNames.test(e.event)) { malformed++; continue; }
                    if (e.event === 'page/probe/overflow') pageProbeIncomplete = true;
                    const v = { kind: 'scenario-event', event: e.event, port: Number(p.gatewayPort), startedAtUnixMs: Number(p.startedAtUnixMs) };
                    for (const k of numbers) if (typeof e[k] === 'number' && Number.isFinite(e[k])) v[k] = e[k];
                    for (const k of bools) if (typeof e[k] === 'boolean') v[k] = e[k];
                    for (const k of ['route','method','failure','action','operation','callSite']) if (allowedStrings.has(e[k]) || OPS.has(e[k]) || ['readResponse','setActive','run'].includes(e[k])) v[k] = e[k];
                    if (typeof e.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(e.sha256)) v.sha256 = e.sha256;
                    output(v);
                }
            } catch { malformed++; }
            return;
        }
        protocol++;
        const jsonStart = raw.indexOf('{', marker);
        const direction = /\bSEND\b/u.test(raw.slice(marker, jsonStart)) ? 'send' : /\bRECV\b/u.test(raw.slice(marker, jsonStart)) ? 'receive' : null;
        if (jsonStart < 0 || !direction) { malformed++; return; }
        let envelope;
        try { envelope = JSON.parse(raw.slice(jsonStart)); } catch { malformed++; return; }
        const session = alias('s', envelope.sessionId ?? 'browser'), key = `${envelope.sessionId ?? 'browser'}:${envelope.id}`;
        const prefix = { kind: 'cdp', at: raw.slice(0,marker).match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/u)?.[0] ?? null, session, direction };
        const p = envelope.params ?? {}, m = envelope.method;
        const executionKey = `${envelope.sessionId ?? 'browser'}:${p.executionContextId ?? p.context?.id}`;
        const request = () => alias('r', p.requestId);
        if (direction === 'send') {
            if (!METHODS.has(m)) return;
            const v = { ...prefix, method: m };
            if (m === 'Network.getResponseBody' || m.startsWith('Fetch.') && 'requestId' in p) v.request = request();
            if (m === 'Network.getResponseBody') bodyCommands++;
            if (m === 'Network.enable') {
                for (const k of ['maxTotalBufferSize','maxResourceBufferSize','maxPostDataSize']) if (Number.isFinite(p[k])) v[k] = p[k];
                if (typeof p.enableDurableMessages === 'boolean') v.enableDurableMessages = p.enableDurableMessages;
            }
            if (m === 'Network.setCacheDisabled') v.cacheDisabled = p.cacheDisabled === true;
            if (m === 'Fetch.enable') v.allUrls = Array.isArray(p.patterns) && p.patterns.some(x => x.urlPattern === '*');
            if (m === 'Fetch.continueRequest') v.overrides = ['url','method','postData','headers'].some(k => k in p);
            if (m === 'Page.navigate') Object.assign(v, route(p.url), { frame: alias('f', p.frameId) });
            if (m === 'Target.closeTarget') v.target = alias('t', p.targetId);
            if (m === 'Target.detachFromTarget') v.detachedSession = alias('s', p.sessionId);
            if (pending.size >= mapLimit) overflow = true;
            else pending.set(key, v);
            output(v); return;
        }
        if (envelope.id !== undefined) {
            const sent = pending.get(key); pending.delete(key);
            if (!sent) return;
            const v = { ...prefix, method: `${sent.method}/reply`, request: sent.request ?? null, ok: !envelope.error };
            if (envelope.error) {
                v.failure = failure(envelope.error.message); if (Number.isFinite(envelope.error.code)) v.code = envelope.error.code;
                if (sent.method === 'Network.getResponseBody') bodyErrors++;
            } else if (sent.method === 'Network.getResponseBody' && typeof envelope.result?.body === 'string') {
                const body = Buffer.from(envelope.result.body, envelope.result.base64Encoded ? 'base64' : 'utf8');
                v.bytes = body.length; v.sha256 = createHash('sha256').update(body).digest('hex');
            }
            output(v); return;
        }
        let v;
        switch (m) {
            case 'Runtime.executionContextCreated': {
                if (!Number.isSafeInteger(p.context?.id) || (typeof p.context?.auxData?.frameId !== 'string' && typeof p.context?.auxData?.frameId !== 'number')) return;
                if (executionFrames.size >= mapLimit) { overflow = true; return; }
                executionFrames.set(executionKey, alias('f',p.context.auxData.frameId)); return;
            }
            case 'Runtime.executionContextDestroyed': executionFrames.delete(executionKey); return;
            case 'Runtime.consoleAPICalled': {
                if (p.type !== 'debug' || !Array.isArray(p.args) || p.args.length !== 1 || p.args[0]?.type !== 'string'
                    || typeof p.args[0].value !== 'string' || !p.args[0].value.startsWith(PAGE_PREFIX)) return;
                let observed;
                try { observed = JSON.parse(p.args[0].value.slice(PAGE_PREFIX.length)); } catch { malformed++; return; }
                const safe = pageProbe(observed); if (!safe) { malformed++; return; }
                v = { ...safe, context: alias('c',p.executionContextId), frame: executionFrames.get(executionKey) ?? null }; break;
            }
            case 'Network.requestWillBeSent': v = { request: request(), ...route(p.request?.url), httpMethod: method(p.request?.method), frame: alias('f',p.frameId), loader: alias('l',p.loaderId), redirect: !!p.redirectResponse }; break;
            case 'Network.responseReceived': v = { request: request(), ...route(p.response?.url), status: p.response?.status, loader: alias('l',p.loaderId), frame: alias('f',p.frameId), serviceWorker: p.response?.fromServiceWorker === true }; break;
            case 'Network.loadingFinished': v = { request: request(), bytes: p.encodedDataLength }; break;
            case 'Network.loadingFailed': v = { request: request(), canceled: p.canceled === true, failure: failure(p.errorText) }; break;
            case 'Fetch.requestPaused': v = { fetchRequest: request(), networkRequest: alias('r',p.networkId), ...route(p.request?.url), httpMethod: method(p.request?.method), responseStage: p.responseStatusCode !== undefined }; break;
            case 'Page.frameNavigated': v = { frame: alias('f',p.frame?.id), loader: alias('l',p.frame?.loaderId), main: !p.frame?.parentId, ...route(p.frame?.url) }; break;
            case 'Page.frameDetached': v = { frame: alias('f',p.frameId), swap: p.reason === 'swap' }; break;
            case 'Runtime.executionContextsCleared': {
                const prefix = `${envelope.sessionId ?? 'browser'}:`;
                for (const key of executionFrames.keys()) if (key.startsWith(prefix)) executionFrames.delete(key);
                v = {}; break;
            }
            case 'Target.attachedToTarget': v = { attachedSession: alias('s',p.sessionId), target: alias('t',p.targetInfo?.targetId) }; break;
            case 'Target.detachedFromTarget': v = { detachedSession: alias('s',p.sessionId), target: alias('t',p.targetId) }; break;
            case 'Network.webSocketCreated': {
                if (route(p.url).route !== 'hmr') return;
                if (websockets.size >= mapLimit) { overflow = true; return; }
                websockets.add(`${session}:${p.requestId}`); v = { request: request(), ...route(p.url) }; break;
            }
            case 'Network.webSocketFrameReceived': {
                if (!websockets.has(`${session}:${p.requestId}`)) return;
                let action = 'unknown';
                try { const x = JSON.parse(p.response?.payloadData); const candidate = typeof x.type === 'string' ? x.type : x.action; if (HMR.has(candidate)) action = candidate; } catch { /* No payload retained. */ }
                v = { request: request(), action }; break;
            }
            case 'Network.webSocketClosed': if (!websockets.delete(`${session}:${p.requestId}`)) return; v = { request: request() }; break;
            default: return;
        }
        output({ ...prefix, method: m, ...v });
    }
    return { line, incomplete() { inputIncomplete = true; },
        finish() {
            const result = { kind: 'capture-summary', schema: 'mediflow.cdp-metadata.v1', protocol, bodyCommands, bodyErrors,
                emitted: Math.min(records,recordLimit), dropped, malformed, overflow, inputIncomplete, originalProbeIncomplete, pageProbeEvents, pageProbeIncomplete,
                pendingBodyCommands: [...pending.values()].filter(x => x.method === 'Network.getResponseBody').length,
                complete: protocol > 0 && bodyCommands > 0 && !dropped && !malformed && !overflow && !inputIncomplete && !originalProbeIncomplete && !pageProbeIncomplete };
            emit(result); return result;
        } };
}
export async function filterStream(input, write) {
    const reducer = createReducer(write);
    const LINE_LIMIT = 4 * 1024 * 1024, INPUT_LIMIT = 256 * 1024 * 1024;
    let pending = Buffer.alloc(0), total = 0, skipping = false;
    for await (const chunk of input) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += data.length;
        if (total > INPUT_LIMIT) { reducer.incomplete(); pending = Buffer.alloc(0); continue; }
        let start = 0;
        while (start < data.length) {
            const end = data.indexOf(10,start), stop = end < 0 ? data.length : end;
            const part = data.subarray(start,stop);
            if (!skipping && pending.length + part.length > LINE_LIMIT) { skipping = true; pending = Buffer.alloc(0); reducer.incomplete(); }
            if (!skipping) pending = Buffer.concat([pending,part]);
            if (end < 0) break;
            if (!skipping) reducer.line(pending.toString('utf8'));
            pending = Buffer.alloc(0); skipping = false; start = end + 1;
        }
    }
    if (pending.length && !skipping) reducer.line(pending.toString('utf8'));
    return reducer.finish();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = await filterStream(process.stdin, value => process.stdout.write(JSON.stringify(value) + '\n'));
    if (!result.complete) process.exitCode = 2;
}
