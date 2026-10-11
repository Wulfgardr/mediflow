import { NextResponse } from 'next/server';
import type { ServerSession } from './server-session';
import { archiveGenerationForSession, currentArchiveGeneration } from './archive-session-generation';

/** Call only after ordinary authentication/authorization; a generation is not a credential. */
export function archiveWriteRequestDenial(request: Request, session: ServerSession | null): NextResponse | null {
    if (!session || session.authChannel !== 'web' || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return null;
    const expected = request.headers.get('x-mediflow-archive-generation');
    if (expected && expected === archiveGenerationForSession(session) && expected === currentArchiveGeneration()) return null;
    return NextResponse.json({ code: 'ARCHIVE_REPLACED',
        error: 'I dati sono stati ripristinati. Ricarica la pagina prima di continuare.' },
    { status: 409, headers: { 'Cache-Control': 'no-store' } });
}
