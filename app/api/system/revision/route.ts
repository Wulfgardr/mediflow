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
export const dynamic = 'force-dynamic';

/* @Codex */
export async function GET() {
  return NextResponse.json(
    {
      branch: getAppBranch(),
      revision: getAppRevision(),
      worktreeHash: getAppWorktreeHash(),
      sourceFingerprint: getAppSourceFingerprint(),
      fingerprint: getAppFingerprint(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, must-revalidate',
      },
    }
  );
}
