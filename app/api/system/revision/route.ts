/* @Codex */
import { NextResponse } from 'next/server';
/* @Codex */
import {
  getAppBranch,
  getAppFingerprint,
  getAppRevision,
  getAppSourceFingerprint,
  getAppWorktreeHash,
} from '@/lib/app-revision';
/* @Codex */
import { requireSession } from '@/lib/security/server-auth';

/* @Codex */
export const dynamic = 'force-dynamic';

/* @Codex */
export async function GET() {
  /* @Codex */
  const session = await requireSession();

  return NextResponse.json(
    {
      revision: getAppRevision(),
      sourceFingerprint: getAppSourceFingerprint(),
      fingerprint: getAppFingerprint(),
      ...(session
        ? {
            branch: getAppBranch(),
            worktreeHash: getAppWorktreeHash(),
          }
        : {}),
    },
    {
      headers: {
        'Cache-Control': 'no-store, must-revalidate',
      },
    }
  );
}
