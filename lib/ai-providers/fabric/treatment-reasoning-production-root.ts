import 'server-only';

/* @Codex */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import {
    AI_TREATMENT_REASONING_KILL_SWITCH_KEY,
    isAiTreatmentReasoningEnabledValue,
} from '../../ai-treatment-reasoning-kill-switch';
import {
    generateWithAthenaMlx,
    isAthenaMlxModelAvailable,
} from '../../athena-mlx-runtime';
import { dbServer } from '../../db-server';
import { activePatients } from '../../patient-lifecycle';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from '../../security/server-auth';
import { registerServerSessionResource } from '../../security/server-session';
import { patients, patientsToAmbulatories, settings } from '../../schema';
import { createHostProviderLifecycleService } from './provider-lifecycle-service';
import { createTreatmentReasoningAuthenticatedProjectionBroker } from './treatment-reasoning-authenticated-projection';
import { createTreatmentReasoningProductionService } from './treatment-reasoning-production-operation';

const lifecycle = createHostProviderLifecycleService({ provider: 'athena_mlx' }).service;

const projectionBroker = createTreatmentReasoningAuthenticatedProjectionBroker({
    acquireContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    clock: () => new Date().toISOString(),
    entropy: () => randomBytes(16),
    readPatientVersion(patientId, ambulatoryId) {
        const row = dbServer.select({ version: patients.version }).from(patients)
            .innerJoin(patientsToAmbulatories, eq(patients.id, patientsToAmbulatories.patientId))
            .where(and(
                eq(patients.id, patientId),
                eq(patientsToAmbulatories.ambulatoryId, ambulatoryId),
                activePatients(),
            )).get();
        return Number.isSafeInteger(row?.version) ? row!.version : null;
    },
    registerResource: (sessionId, dispose) => registerServerSessionResource(sessionId, () => dispose()),
});

const killSwitch = Object.freeze({
    async read() {
        try {
            const row = dbServer.select({ value: settings.value }).from(settings)
                .where(eq(settings.key, AI_TREATMENT_REASONING_KILL_SWITCH_KEY)).get();
            return isAiTreatmentReasoningEnabledValue(row?.value)
                ? Object.freeze({ status: 'enabled' as const })
                : Object.freeze({ status: 'denied' as const, code: 'disabled' as const });
        } catch { return Object.freeze({ status: 'denied' as const, code: 'unavailable' as const }); }
    },
});

const runtime = Object.freeze({
    available: () => isAthenaMlxModelAvailable(),
    invoke(input: Readonly<{ instruction: string; signal: Readonly<{ isAborted(): boolean }> }>) {
        if (input.signal.isAborted()) return Promise.reject(new Error('Treatment Reasoning execution cancelled.'));
        return generateWithAthenaMlx({ prompt: input.instruction, maxTokens: 1_600, timeoutMs: 420_000 })
            .then((result) => {
                if (input.signal.isAborted()) throw new Error('Treatment Reasoning execution cancelled.');
                return result.content;
            });
    },
});

const service = createTreatmentReasoningProductionService({
    projectionBroker,
    killSwitch,
    lifecycle,
    runtime,
    entropy: () => randomBytes(32),
});

export const acquireTreatmentReasoningIngest = service.acquireIngest;
export const acquireTreatmentReasoningPreview = service.acquirePreview;
