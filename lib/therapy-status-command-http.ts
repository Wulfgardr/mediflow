import { NextResponse } from 'next/server';
import { requireSession } from './security/server-auth';
import { archiveWriteRequestDenial } from './security/archive-write-request';
import { readBoundedJsonBody } from './bounded-request-body';
import { apiInternalError } from './api-error-response';
import { parseTherapyStatusCommand, type TherapyStatusExecute } from './therapy-status-command-contract';
import { executeTherapyStatusCommand, closeTherapyStatusCommand, readTherapyStatusReceipt, TherapyStatusCommandDenied } from './therapy-status-command-service';

export async function therapyStatusCommandHttp(request: Request, commandId: string, operation: 'execute' | 'receipt' | 'close'): Promise<Response> {
    const session = await requireSession();
    const respond = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
    if (!session) return respond({ code: 'unauthorized' }, 401);
    if (session.authChannel !== 'web' || session.role !== 'admin') return respond({ code: 'denied' }, 403);
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    try {
        let value: unknown;
        if (operation === 'receipt') {
            const query = new URL(request.url).searchParams;
            if (Array.from(query.keys()).some(key => query.getAll(key).length !== 1)) return respond({ code: 'invalid' }, 400);
            value = Object.fromEntries(query);
            if (typeof (value as Record<string, unknown>).expectedVersion === 'string' && /^[1-9][0-9]{0,15}$/.test((value as Record<string, string>).expectedVersion!))
                (value as Record<string, unknown>).expectedVersion = Number((value as Record<string, string>).expectedVersion);
        } else {
            const parsed = await readBoundedJsonBody(request, 4096, 'request-json');
            if (!parsed.ok) return respond({ code: 'invalid' }, parsed.status);
            value = parsed.value;
        }
        const command = parseTherapyStatusCommand(value, operation === 'execute');
        if (!command || command.commandId !== commandId) return respond({ code: 'invalid' }, 400);
        if (operation === 'receipt') return respond(readTherapyStatusReceipt(session, command));
        const receipt = operation === 'execute' ? executeTherapyStatusCommand(session, command as TherapyStatusExecute) : closeTherapyStatusCommand(session, command);
        return respond({ outcome: 'terminal', historical: false, receipt });
    } catch (error) {
        if (error instanceof TherapyStatusCommandDenied) return respond({ code: error.code }, error.code === 'invalid' ? 400 : error.code === 'collision' ? 409 : 403);
        return apiInternalError(`therapy-status-command:${operation}`, error);
    }
}
