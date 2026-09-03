/* @Codex */
import { createHeadlessCheckupStatusTransitionWebHttpHandlersV1 } from
  '@/lib/security/headless-checkup-status-transition-web-http';
import { revokeCheckupStatusTransitionForHostV1, selectCheckupStatusTransitionForHostV1,
  readCheckupStatusTransitionProposalV1, confirmCheckupStatusTransitionProposalV1 } from
  '@/lib/security/headless-checkup-status-transition-web-production';
import { readAuthenticatedWebSession } from '@/lib/security/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createHeadlessCheckupStatusTransitionWebHttpHandlersV1({
  readAuthenticated: async () => (await readAuthenticatedWebSession()) !== null,
  select: selectCheckupStatusTransitionForHostV1,
  read: readCheckupStatusTransitionProposalV1,
  confirm: confirmCheckupStatusTransitionProposalV1,
  revoke: revokeCheckupStatusTransitionForHostV1,
});
export const GET = handlers.read;
export const POST = handlers.confirm;
