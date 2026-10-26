import 'server-only';
import { NextResponse } from 'next/server';
import { archiveReplacementResponse } from '../api-error-response';
import { jsonBodyTooLargeResponse, readNativeNetworkJson } from '../native-network-json-body';
import { requireNetworkWriteContext } from '../network-write-context';
import { NETWORK_AMBULATORY_WRITE_CAPABILITY } from '../network-ambulatory-write';
import { commandObject } from '../ambulatory-destructive-command-contract';
import { isTrustedWebMutationRequest } from './request-transport';
import { requirePairedNativeSession, pairedNativeClientBinding, nativeSessionArchiveReplaced } from './paired-native-session';
import { setWebAuthControlCookie, setWebAuthControlEtag } from './web-auth-control-transport';
import { ambulatoryDestructiveService } from './ambulatory-destructive-service';

export type AmbulatoryDestructiveHttpAction = 'begin' | 'preview' | 'execute' | 'receipt' | 'close' | 'retire';
function reply(value: Record<string, unknown>, status: number): NextResponse {
    return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function ambulatoryDestructiveHttp(request: Request, action: AmbulatoryDestructiveHttpAction): Promise<Response> {
    if (new URL(request.url).search || !isTrustedWebMutationRequest(request)) return reply({ code: 'AMBULATORY_COMMAND_TRANSPORT_DENIED' }, 403);
    try {
        if (action === 'begin') {
            const native = await requirePairedNativeSession(request), device = native ? await pairedNativeClientBinding(request) : null;
            if (!native || !device) {
                const replaced = await nativeSessionArchiveReplaced(request);
                return reply({ code: replaced ? 'ARCHIVE_REPLACED' : 'AMBULATORY_COMMAND_DENIED' }, replaced ? 409 : 401);
            }
            const body = await readNativeNetworkJson(request, 4096);
            let scope: string | null = null;
            if (commandObject(body, ['purpose', 'command']) && body.purpose === 'execute') {
                const resolved = await requireNetworkWriteContext(request, NETWORK_AMBULATORY_WRITE_CAPABILITY);
                if (!resolved.ok) return resolved.response;
                if (resolved.context.session !== native || resolved.context.pairedClient.clientId !== device.clientId
                    || resolved.context.pairedClient.tokenHash !== device.tokenHash) return reply({ code: 'AMBULATORY_COMMAND_DENIED' }, 403);
                scope = resolved.context.scopeAmbulatoryId;
            }
            const opened = ambulatoryDestructiveService.begin(request, native, device, body, scope);
            const response = reply(opened.value, opened.status);
            if (opened.control) { setWebAuthControlCookie(response, request, opened.control.controlId); setWebAuthControlEtag(response, opened.control.etag); }
            return response;
        }
        const body = await readNativeNetworkJson(request, 4096);
        if (action !== 'execute' && !commandObject(body, [])) return reply({ code: 'AMBULATORY_COMMAND_INPUT_INVALID' }, 400);
        if (action === 'retire') {
            const response = await ambulatoryDestructiveService.retire(request);
            response.headers.set('Cache-Control', 'no-store'); return response;
        }
        const response = action === 'preview' ? ambulatoryDestructiveService.preview(request)
            : action === 'execute' ? ambulatoryDestructiveService.execute(request, body)
                : ambulatoryDestructiveService.recover(request, action === 'close');
        return reply(response.value, response.status);
    } catch (error) {
        return archiveReplacementResponse(error) ?? jsonBodyTooLargeResponse(error)
            ?? reply({ code: error instanceof SyntaxError ? 'AMBULATORY_COMMAND_INPUT_INVALID' : 'AMBULATORY_COMMAND_UNVERIFIED' }, error instanceof SyntaxError ? 400 : 500);
    }
}
