/* @Codex */
import { createHeadlessCheckupActiveRoleHttpHandlersV1 } from '@/lib/security/headless-checkup-active-role-http';
import { enrollHeadlessCheckupActiveRoleAttestation,
  revokeHeadlessCheckupActiveRoleAttestation } from '@/lib/security/headless-checkup-active-role-enrollment-production';
import { disposeCheckupStatusTransitionForHostV1 } from '@/lib/security/headless-checkup-status-transition-web-production';
import { readAuthenticatedWebSession } from '@/lib/security/server-auth';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createHeadlessCheckupActiveRoleHttpHandlersV1({
  readAuthorizedAdmin: async () => isWebAdminSession(await readAuthenticatedWebSession()),
  enroll: enrollHeadlessCheckupActiveRoleAttestation,
  revoke: revokeHeadlessCheckupActiveRoleAttestation,
  retireOperation: disposeCheckupStatusTransitionForHostV1,
});
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
