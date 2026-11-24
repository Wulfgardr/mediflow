import { NextResponse } from 'next/server';
import { ARCHIVE_POLICY_MESSAGES, type BackupRestoreBlockedReason } from '@/lib/backup-restore-blocked';

export function blockedRestoreResponse(reason: BackupRestoreBlockedReason | 'source') {
    return NextResponse.json({
        success: false, code: 'restore_blocked', reason,
        error: Object.hasOwn(ARCHIVE_POLICY_MESSAGES, reason)
            ? ARCHIVE_POLICY_MESSAGES[reason as keyof typeof ARCHIVE_POLICY_MESSAGES]
            : 'Ripristino bloccato. I dati attuali sono rimasti intatti.',
    }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
}
