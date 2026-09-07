/* @Codex */
import { requireSession } from '@/lib/security/server-auth';
import { functionModelPreferencesService } from '@/lib/ai-providers/fabric/function-model-preferences-production';
import { createFunctionModelPreferencesHttp } from '@/lib/ai-providers/fabric/function-model-preferences-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createFunctionModelPreferencesHttp({ authenticate: requireSession, service: functionModelPreferencesService }).PREVIEW;
