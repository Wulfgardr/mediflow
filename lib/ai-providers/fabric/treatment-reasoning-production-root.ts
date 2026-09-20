import 'server-only';
import { isOrdinaryFunctionSelected } from '../../chatgpt-product/ordinary-flow';
import { createTreatmentReasoningChatGptService } from './treatment-reasoning-chatgpt-production';
import { captureFunctionModelTransportGuard, captureTreatmentReasoningDispatch } from './function-model-dispatch';

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
import {
    acquireOrdinaryApplicationContext,
    registerOrdinaryApplicationResource,
} from '../../security/ordinary-application-context';
import type { AuthenticatedWebSessionProjectionOwnerContext } from '../../security/server-auth';
import {
    mintResourcePort,
    registerPrivateResource,
    releaseResourcePort,
    unregisterPrivateResource,
} from '../../security/web-auth-lifecycle-owner-adapter';
import { patients, patientsToAmbulatories, settings } from '../../schema';
import { createHostProviderLifecycleService } from './provider-lifecycle-service';
import { createTreatmentReasoningAuthenticatedProjectionBroker } from './treatment-reasoning-authenticated-projection';
import { createTreatmentReasoningProductionService, createTreatmentReasoningPortableProductionService } from './treatment-reasoning-production-operation';
import { createTreatmentReasoningPortableRuntime } from './treatment-reasoning-portable-runtime';
import { createPortableProvisioning } from './treatment-reasoning-portable-provisioning';

const lifecycle = createHostProviderLifecycleService({ provider: 'athena_mlx' }).service;

/** @Codex: Web P3 resources follow the exact active cell; native keeps its existing owner path. */
export function registerTreatmentReasoningProductionResource(
    context: AuthenticatedWebSessionProjectionOwnerContext,
    dispose: () => void,
): (() => void) | null {
    if (context.session.authChannel !== 'web') {
        return registerOrdinaryApplicationResource(context.session.id, dispose);
    }
    const port = mintResourcePort(context.session);
    if (!port) return null;
    let registration;
    let active = true;
    try {
        registration = registerPrivateResource(port, () => {
            if (!active) return;
            active = false;
            dispose();
        });
    } catch {
        releaseResourcePort(port);
        return null;
    }
    if (!registration) {
        releaseResourcePort(port);
        return null;
    }
    return () => {
        if (!active) return;
        active = false;
        try { unregisterPrivateResource(port, registration); }
        finally { releaseResourcePort(port); }
    };
}

const projectionBroker = createTreatmentReasoningAuthenticatedProjectionBroker({
    acquireContext: acquireOrdinaryApplicationContext,
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
    registerResource: registerTreatmentReasoningProductionResource,
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
    async invoke(input: Readonly<{ instruction: string; signal: Readonly<{ isAborted(): boolean }> }>) {
        const verifyChoice = captureFunctionModelTransportGuard('athena_mlx');
        await verifyChoice();
        if (input.signal.isAborted()) return Promise.reject(new Error('Treatment Reasoning execution cancelled.'));
        return generateWithAthenaMlx({ prompt: input.instruction, maxTokens: 1_600, timeoutMs: 420_000 })
            .then(async (result) => {
                await verifyChoice();
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
// Launcher owns the application cwd; bundler chunk paths are not artifact identities.
const portableRuntime = createTreatmentReasoningPortableRuntime({ provisioning: createPortableProvisioning({
    applicationRoot: process.cwd(),
}) });
export async function acquireTreatmentReasoningPreview() {
    if (isOrdinaryFunctionSelected('treatment_reasoning')) return createTreatmentReasoningChatGptService({ projectionBroker, killSwitch }).acquirePreview();
    const selected = captureTreatmentReasoningDispatch();
    await selected.verify();
    if (selected.provider === 'athena_mlx') return service.acquirePreview();
    const portableService = createTreatmentReasoningPortableProductionService({
        projectionBroker, killSwitch, entropy: () => randomBytes(32),
        selection: () => Object.freeze({ provider: 'athena_transformers' as const,
            modelOptionId: selected.modelOptionId, catalogRevision: selected.catalogRevision }),
        verifyChoice: selected.verify,
        prepare: () => portableRuntime.prepare({ signal: selected.signal, verifyChoice: selected.verify }),
    });
    return portableService.acquirePreview();
}
