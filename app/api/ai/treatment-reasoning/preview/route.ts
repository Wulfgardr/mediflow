/* @Codex */
import { createTreatmentReasoningPreviewHttpHandler } from '@/lib/ai-providers/fabric/treatment-reasoning-production-http';
import { acquireTreatmentReasoningPreview } from '@/lib/ai-providers/fabric/treatment-reasoning-production-root';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createTreatmentReasoningPreviewHttpHandler({ acquirePreview: acquireTreatmentReasoningPreview });
