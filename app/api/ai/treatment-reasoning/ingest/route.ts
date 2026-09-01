/* @Codex */
import { createTreatmentReasoningIngestHttpHandler } from '@/lib/ai-providers/fabric/treatment-reasoning-production-http';
import { acquireTreatmentReasoningIngest } from '@/lib/ai-providers/fabric/treatment-reasoning-production-root';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTreatmentReasoningIngestHttpHandler({ acquireIngest: acquireTreatmentReasoningIngest });
