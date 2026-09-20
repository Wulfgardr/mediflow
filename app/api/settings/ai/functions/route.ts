/* @Codex */
import { requireSession } from '@/lib/security/server-auth';
import { functionModelPreferencesService } from '@/lib/ai-providers/fabric/function-model-preferences-production';
import { createFunctionModelPreferencesHttp } from '@/lib/ai-providers/fabric/function-model-preferences-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlers = createFunctionModelPreferencesHttp({ authenticate: requireSession, service: functionModelPreferencesService });
export const GET = handlers.GET;
export const POST = handlers.POST;
