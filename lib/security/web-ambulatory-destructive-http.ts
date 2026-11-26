import 'server-only';
import { NextResponse } from 'next/server';
import { archiveReplacementResponse } from '../api-error-response';
import { jsonBodyTooLargeResponse, readNativeNetworkJson } from '../native-network-json-body';
import { logServerError } from '../server-error-log';
import { requireLocalWebAdminSession } from './local-web-admin-session';
import { webAmbulatoryDestructiveService } from './web-ambulatory-destructive-service';

function reply(value: Record<string, unknown>, status: number): NextResponse {
    return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function webAmbulatoryDestructiveHttp(request: Request, action: 'prepare' | 'execute'): Promise<Response> {
    try {
        const access = await requireLocalWebAdminSession(request, true);
        if (!access || new URL(request.url).search) return reply({ code: 'LOCAL_ADMIN_REQUIRED' }, 403);
        const body = await readNativeNetworkJson(request, 1024);
        const result = action === 'prepare'
            ? webAmbulatoryDestructiveService.prepare(access, body)
            : await webAmbulatoryDestructiveService.execute(request, access, body);
        return reply(result.value, result.status);
    } catch (error) {
        const known = archiveReplacementResponse(error) ?? jsonBodyTooLargeResponse(error);
        if (known) return known;
        if (error instanceof SyntaxError) return reply({ code: 'AMBULATORY_COMMAND_INPUT_INVALID' }, 400);
        logServerError(`API POST /ambulatories/commands/${action} error`, error);
        return reply({ code: 'AMBULATORY_COMMAND_FAILED' }, 500);
    }
}
