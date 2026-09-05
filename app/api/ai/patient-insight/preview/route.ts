/* @Codex */
import { acquireAuthenticatedPatientInsightPreview } from '@/lib/ai-providers/fabric/patient-insight-authenticated-preview-production';
import { createPatientInsightPreviewHttpHandler } from '@/lib/ai-providers/fabric/patient-insight-authenticated-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createPatientInsightPreviewHttpHandler({ acquirePreview: acquireAuthenticatedPatientInsightPreview });
