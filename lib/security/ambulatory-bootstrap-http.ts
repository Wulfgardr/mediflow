import 'server-only';
import { archiveReplacementResponse } from '../api-error-response';
import { jsonBodyTooLargeResponse, readNativeNetworkJson } from '../native-network-json-body';
import { isTrustedWebMutationRequest } from './request-transport';
import { requirePairedNativeSession, pairedNativeClientBinding, nativeSessionArchiveReplaced } from './paired-native-session';
import { setWebAuthControlCookie, setWebAuthControlEtag } from './web-auth-control-transport';
import { NextResponse } from 'next/server';
import { ambulatoryBootstrapService } from './ambulatory-bootstrap-service';

function response(value: Record<string, unknown>, status: number): NextResponse {
    return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function ambulatoryBootstrapHttp(request: Request, action: 'begin' | 'commit' | 'read' | 'retire'): Promise<Response> {
    if (new URL(request.url).search || !isTrustedWebMutationRequest(request, action !== 'read')) return response({ code: 'BOOTSTRAP_TRANSPORT_DENIED' }, 403);
    try {
        if (action === 'begin') {
            const native = await requirePairedNativeSession(request);
            const binding = native ? await pairedNativeClientBinding(request) : null;
            if (!native || !binding) {
                const replaced = await nativeSessionArchiveReplaced(request);
                return response({ code: replaced ? 'ARCHIVE_REPLACED' : 'BOOTSTRAP_DENIED' }, replaced ? 409 : 401);
            }
            const result = ambulatoryBootstrapService.begin(request, native, binding, await readNativeNetworkJson(request, 4096));
            const reply = response(result.value, result.status);
            if (result.control) {
                setWebAuthControlCookie(reply, request, result.control.controlId);
                setWebAuthControlEtag(reply, result.control.etag);
            }
            return reply;
        }
        if (action === 'retire') {
            const reply = await ambulatoryBootstrapService.retire(request, await readNativeNetworkJson(request, 4096));
            reply.headers.set('Cache-Control', 'no-store');
            return reply;
        }
        const result = action === 'read' ? ambulatoryBootstrapService.read(request)
            : ambulatoryBootstrapService.commit(request, await readNativeNetworkJson(request, 4096));
        return response(result.value, result.status);
    } catch (error) {
        return archiveReplacementResponse(error) ?? jsonBodyTooLargeResponse(error)
            ?? response({ code: error instanceof SyntaxError ? 'BOOTSTRAP_INPUT_INVALID' : 'BOOTSTRAP_UNVERIFIED' }, error instanceof SyntaxError ? 400 : 500);
    }
}
