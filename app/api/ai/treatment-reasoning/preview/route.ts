/* @Codex */
import { withFunctionModelDispatch } from '@/lib/ai-providers/fabric/function-model-preferences-production';
import { createTreatmentReasoningPreviewHttpHandler } from '@/lib/ai-providers/fabric/treatment-reasoning-production-http';
import { acquireTreatmentReasoningPreview } from '@/lib/ai-providers/fabric/treatment-reasoning-production-root';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withFunctionModelDispatch('treatment_reasoning', createTreatmentReasoningPreviewHttpHandler({ acquirePreview: acquireTreatmentReasoningPreview }));
