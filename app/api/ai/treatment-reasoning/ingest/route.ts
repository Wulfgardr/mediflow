import { withArchiveRequestContext } from '@/lib/security/archive-request-context';
import { createTreatmentReasoningIngestHttpHandler } from '@/lib/ai-providers/fabric/treatment-reasoning-production-http';
import { acquireTreatmentReasoningIngest } from '@/lib/ai-providers/fabric/treatment-reasoning-production-root';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withArchiveRequestContext(createTreatmentReasoningIngestHttpHandler({ acquireIngest: acquireTreatmentReasoningIngest }));
