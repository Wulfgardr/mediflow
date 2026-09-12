/* @Codex — fixed authenticated operations, no prompt/source/policy input. */
import 'server-only';
import { requireSession } from '../security/server-auth';
import * as owner from '../security/web-auth-lifecycle-owner-adapter';
import { isTrustedWebMutationRequest } from '../security/request-transport';
import { readBoundedJsonBody } from '../bounded-request-body';
import { isFunctionModelId } from '../ai-providers/fabric/function-model-preferences';
import { ordinaryFunctionCommand, ordinaryFailure, cancelOrdinaryGeneration } from './ordinary-flow';
import { readOrdinaryCloudSettings, writeOrdinaryCloudSettings } from './ordinary-settings';
import { ordinaryWireObject } from './ordinary-wire';
import { ProductError } from './product-contract';
export const ORDINARY_NAMESPACE = '/api/settings/ai/chatgpt/ordinary/';
const fields: Readonly<Record<string, readonly string[]>> = Object.freeze({
    status: [], settings: [], policy: ['expectedRevision', 'enabled', 'retention'],
    default: ['expectedRevision', 'functionId'], consent: ['attemptId', 'expectedDisclosureRevision'],
    'login/start': ['attemptId'], 'login/complete': ['attemptId'], models: ['attemptId'], cancel: ['attemptId'],
    generate: ['attemptId', 'modelOptionId', 'expectedCatalogRevision'],
    preference: ['attemptId', 'modelOptionId', 'expectedCatalogRevision', 'expectedRevision'],
});
export function parseOrdinaryCommand(operation: string, value: unknown): Record<string, unknown> {
    const keys = fields[operation]; const parsed = keys && ordinaryWireObject(value, keys);
    if (!parsed) throw new ProductError('invalid_request');
    for (const key of keys) {
        const value = parsed[key];
        if (key === 'enabled') { if (typeof value !== 'boolean') throw new ProductError('invalid_request'); }
        else if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\x00-\x1f\x7f]/u.test(value)) throw new ProductError('invalid_request');
    }
    if (operation === 'policy' && parsed.retention !== 'chatgpt_service_terms_apply') throw new ProductError('invalid_request');
    if (operation === 'default' && !isFunctionModelId(parsed.functionId)) throw new ProductError('invalid_request');
    return Object.freeze(parsed);
}
export async function handleOrdinaryHttp(request: Request): Promise<Response> {
    let port: owner.WebResourcePort | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const url = new URL(request.url), operation = url.pathname.slice(ORDINARY_NAMESPACE.length);
        const reading = operation === 'status' || operation === 'settings';
        if (!url.pathname.startsWith(ORDINARY_NAMESPACE) || url.search || !Object.hasOwn(fields, operation)
            || request.method !== (reading ? 'GET' : 'POST')) throw new ProductError('invalid_request');
        if (!reading && !isTrustedWebMutationRequest(request)) throw new ProductError('forbidden');
        const session = await requireSession();
        // Do not inspect projection fields, look up attempts, or read settings first.
        if (!session || !(port = owner.mintResourcePort(session))) throw new ProductError('session_expired');
        if (request.signal.aborted) throw new ProductError('revoked');
        let body: Record<string, unknown> = {};
        if (!reading) {
            const abort = new AbortController(); timer = setTimeout(() => abort.abort(), 1000);
            const read = await readBoundedJsonBody(request, 4096, 'strict', { signal: AbortSignal.any([request.signal, abort.signal]), deadline: performance.now() + 1000 });
            clearTimeout(timer);
            if (!read.ok || abort.signal.aborted) throw new ProductError('invalid_request');
            body = parseOrdinaryCommand(operation, read.value);
        }
        const use = owner.beginResourceUse(port); if (!use) throw new ProductError('session_expired');
        try {
            if (!['settings', 'policy', 'default'].includes(operation)) {
                const response = await ordinaryFunctionCommand(session, operation, body, request.signal);
                // Cancel may release its attempt port; the genuine ingress port
                // still commits this request's response after asynchronous close.
                let publishable = false;
                if (!owner.withCurrentResourceBinding(use, () => { publishable = !request.signal.aborted; })
                    || !publishable || !owner.commitResourceUse(use)) throw new ProductError('session_expired');
                return response;
            }
            if (operation === 'policy') {
                await writeOrdinaryCloudSettings(session, body.expectedRevision as string, { enabled: body.enabled as boolean }, request.signal);
                // Disabling is a revocation for all live attempts, never a grant.
                if (body.enabled === false) cancelOrdinaryGeneration();
            } else if (operation === 'default') {
                await writeOrdinaryCloudSettings(session, body.expectedRevision as string, { preference: {
                    functionId: body.functionId as 'patient_insight' | 'smart_import' | 'document_synthesis' | 'treatment_reasoning',
                    value: { use: 'local', model: null, effort: null },
                } }, request.signal);
            }
            const settings = await readOrdinaryCloudSettings();
            let response: Response | undefined;
            if (!owner.withCurrentResourceBinding(use, () => {
                if (!request.signal.aborted) response = Response.json(settings, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
            }) || !response || request.signal.aborted || !owner.commitResourceUse(use)) throw new ProductError('session_expired');
            return response;
        } finally { owner.abortResourceUse(use); }
    } catch (error) { return ordinaryFailure(error); }
    finally { clearTimeout(timer); if (port) owner.releaseResourcePort(port); }
}
