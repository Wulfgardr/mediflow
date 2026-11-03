import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { NextResponse } from 'next/server';
import { openDbServer } from '@/lib/db-server';
import { requireSession, unauthorizedResponse, forbiddenResponse } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';
import { AccountResetError, listAccountResetReceipts, resetAccountsDurably, type AccountResetReceipt } from '@/lib/security/account-reset-journal';
import {
    abortNativeSystemAdminReset,
    commitNativeSystemAdminReset,
    prepareNativeSystemAdminReset,
    SESSION_COOKIE_NAME,
} from '@/lib/security/server-session';
import {
    abortAdminReset,
    commitAdminReset,
    prepareAdminReset,
} from '@/lib/security/web-auth-lifecycle-owner-adapter';
import { sessionCookieOptionsForRequest } from '@/lib/security/request-transport';

export const dynamic = 'force-dynamic';

function resetFailure(status: 409 | 500, code: string, message: string, receipt: AccountResetReceipt | null = null) {
    const response = NextResponse.json({ success: false, error: message, code, receipt }, { status });
    response.headers.set('Cache-Control', 'no-store');
    return response;
}

function abortPreparedReset(webCapability: object | null, nativeCapability: object | null): void {
    if (webCapability) {
        try { abortAdminReset(webCapability); } catch { /* no database mutation has occurred */ }
    }
    if (nativeCapability) {
        try { abortNativeSystemAdminReset(nativeCapability); } catch { /* no database mutation has occurred */ }
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (session.role !== 'admin') return forbiddenResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    let webCapability: object | null = null;
    let nativeCapability: object | null = null;
    try {
        webCapability = prepareAdminReset(session);
        if (!webCapability) {
            return resetFailure(409, 'RESET_AUTHORITY_PREPARE_FAILED', 'Impossibile preparare il reset delle sessioni Web.');
        }
        nativeCapability = prepareNativeSystemAdminReset();
        if (!nativeCapability) {
            abortPreparedReset(webCapability, null);
            return resetFailure(409, 'RESET_AUTHORITY_PREPARE_FAILED', 'Impossibile preparare il reset delle sessioni native.');
        }
    } catch {
        abortPreparedReset(webCapability, nativeCapability);
        return resetFailure(409, 'RESET_AUTHORITY_PREPARE_FAILED', 'Impossibile preparare il reset delle sessioni.');
    }

    let receipt: AccountResetReceipt | null;
    try {
        // The two authority capabilities are already fenced before this destructive DB mutation.
        // Journal, preserved copy and receipt make the outcome decidable after a crash.
        receipt = resetAccountsDurably(openDbServer());
    } catch (error) {
        const failure = error instanceof AccountResetError ? error : null;
        if (failure?.code === 'RESET_RECEIPT_UNRECORDED') {
            // The accounts are gone: the sessions must be retired; the next start records the outcome.
            receipt = failure.receipt;
        } else {
            abortPreparedReset(webCapability, nativeCapability);
            console.error('Reset error:', failure?.code ?? error);
            return failure?.code === 'RESET_ARCHIVE_CHANGED'
                ? resetFailure(409, failure.code, 'Archivio modificato durante il reset. Nessun account eliminato.', failure.receipt)
                : resetFailure(500, 'RESET_DATABASE_FAILED', 'Reset non completato. Archivio precedente intatto.', failure?.receipt ?? null);
        }
    }

    let webOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    let nativeOutcome: 'completed' | 'failed' | 'denied' = 'failed';
    try { webOutcome = commitAdminReset(webCapability).outcome; } catch { webOutcome = 'failed'; }
    try { nativeOutcome = commitNativeSystemAdminReset(nativeCapability).outcome; } catch { nativeOutcome = 'failed'; }

    const completed = webOutcome === 'completed' && nativeOutcome === 'completed';
    const response = completed
        ? NextResponse.json({ success: true, receipt })
        : resetFailure(500, 'RESET_AUTHORITY_COMMIT_FAILED', 'Reset eseguito, ma la chiusura delle sessioni non è stata confermata.', receipt);
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(SESSION_COOKIE_NAME, '', {
        ...sessionCookieOptionsForRequest(request),
        maxAge: 0,
    });
    return response;
}

/** Receipts of earlier resets, including those decided at a later start after an interruption. */
export async function GET() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    if (!isWebAdminSession(session)) return forbiddenResponse();
    let receipts: AccountResetReceipt[];
    try { receipts = listAccountResetReceipts(openDbServer()); }
    catch { return resetFailure(500, 'RESET_JOURNAL_UNAVAILABLE', 'Ricevute del reset non leggibili.'); }
    return NextResponse.json({ receipts }, { headers: { 'Cache-Control': 'no-store' } });
}
