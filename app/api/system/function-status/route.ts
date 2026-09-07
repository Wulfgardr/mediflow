/* @Codex WUL-674: reuse configuration owners, never invoke an inference here. */
import { inArray } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { settings } from '@/lib/schema';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { isAiLaneEnabledValue } from '@/lib/ai-lane-kill-switch';
import { AI_PATIENT_INSIGHT_KILL_SWITCH_KEY } from '@/lib/ai-patient-insight-kill-switch';
import { AI_SMART_IMPORT_KILL_SWITCH_KEY } from '@/lib/ai-smart-import-kill-switch';
import { AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY } from '@/lib/ai-document-synthesis-kill-switch';
import { AI_TREATMENT_REASONING_KILL_SWITCH_KEY } from '@/lib/ai-treatment-reasoning-kill-switch';
import { createHostLocalProviderBindingService } from '@/lib/ai-providers/host-local-provider-binding';
import { createHostProviderLifecycleService } from '@/lib/ai-providers/fabric/provider-lifecycle-service';
import { isAthenaMlxModelAvailable } from '@/lib/athena-mlx-runtime';
import { getIcd11WhoProductionRuntime } from '@/lib/reference-data/icd11-who-production';
import { buildFunctionStatus, type FunctionStatusSources } from '@/lib/function-status';
import { functionModelPreferencesService } from '@/lib/ai-providers/fabric/function-model-preferences-production';

export const dynamic = 'force-dynamic';
const keys = { patient_insight: AI_PATIENT_INSIGHT_KILL_SWITCH_KEY, smart_import: AI_SMART_IMPORT_KILL_SWITCH_KEY,
    document_synthesis: AI_DOCUMENT_SYNTHESIS_KILL_SWITCH_KEY, treatment_reasoning: AI_TREATMENT_REASONING_KILL_SWITCH_KEY } as const;
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
    if (!await requireSession()) return unauthorizedResponse();
    if (new URL(request.url).searchParams.size) return Response.json({ error: 'request_invalid' }, { status: 400, headers });
    try {
        const rows = await dbServer.select({ key: settings.key, value: settings.value }).from(settings)
            .where(inArray(settings.key, Object.values(keys)));
        const values = new Map(rows.map(item => [item.key, item.value]));
        const binding = await createHostLocalProviderBindingService().readClinical();
        const lifecycle = (provider: string) => {
            const result = createHostProviderLifecycleService({ provider }).service.read();
            return result.status === 'available' ? result.record.lifecycle.status : result.reason;
        };
        // @Codex: report the persisted default, never an ephemeral request override.
        let functionBindings: FunctionStatusSources['functionBindings'];
        try {
            const preferences = functionModelPreferencesService.read();
            functionBindings = Object.fromEntries(preferences.functions.map(item => {
                const selected = item.options.find(option => option.modelOptionId === item.defaultModelOptionId);
                return [item.id, { state: item.bindingState !== 'current' || !selected ? 'invalid' : item.id === 'treatment_reasoning' && selected.state === 'unavailable' ? 'invalid' : 'configured',
                    model: selected?.label ?? null }];
            }));
        } catch { functionBindings = Object.fromEntries(Object.keys(keys).map(id => [id, { state: 'unavailable', model: null }])); }
        return Response.json(buildFunctionStatus({
            functionBindings,
            platform: process.platform,
            enabled: { patient_insight: isAiLaneEnabledValue(values.get(keys.patient_insight)), smart_import: isAiLaneEnabledValue(values.get(keys.smart_import)),
                document_synthesis: isAiLaneEnabledValue(values.get(keys.document_synthesis)), treatment_reasoning: isAiLaneEnabledValue(values.get(keys.treatment_reasoning)) },
            ollamaLifecycle: lifecycle('ollama'), athenaLifecycle: lifecycle('athena_mlx'),
            clinicalBinding: binding.status === 'available' ? { state: 'configured', model: binding.resolution.receipt.model } : { state: binding.code === 'settings_unavailable' ? 'unavailable' : 'invalid', model: null },
            athenaArtifact: isAthenaMlxModelAvailable(),
            who: getIcd11WhoProductionRuntime().readiness().status,
        }, new Date().toISOString()), { headers });
    } catch {
        return Response.json({ error: 'function_status_unavailable' }, { status: 503, headers });
    }
}
