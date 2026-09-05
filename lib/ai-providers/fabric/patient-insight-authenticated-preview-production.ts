/* @Codex */
import 'server-only';

import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { AI_PATIENT_INSIGHT_KILL_SWITCH_KEY, isAiPatientInsightEnabledValue } from '../../ai-patient-insight-kill-switch';
import { createHostLocalProviderBindingService } from '../host-local-provider-binding';
import { observeClinical } from '../host-local-provider-readiness';
import { dbServer } from '../../db-server';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from '../../security/server-auth';
import { patients, settings } from '../../schema';
import { activePatients } from '../../patient-lifecycle';
import { routeHostResolvedCandidateCapability } from './candidate-router';
import { createHostProviderLifecycleService } from './provider-lifecycle-service';
import { createAuthenticatedPatientInsightPreviewService } from './patient-insight-authenticated-preview';
import { createPatientInsightHostCapability } from './patient-insight-host-capability';

const lifecycle = createHostProviderLifecycleService().service;
const binding = createHostLocalProviderBindingService();
const readiness = Object.freeze({ observeClinical });
const killSwitch = Object.freeze({
    async read() {
        try {
            const row = await dbServer.select({ value: settings.value }).from(settings)
                .where(eq(settings.key, AI_PATIENT_INSIGHT_KILL_SWITCH_KEY)).get();
            return isAiPatientInsightEnabledValue(row?.value)
                ? Object.freeze({ status: 'enabled' as const })
                : Object.freeze({ status: 'denied' as const, code: 'disabled' as const });
        } catch { return Object.freeze({ status: 'denied' as const, code: 'unavailable' as const }); }
    },
});

export const acquireAuthenticatedPatientInsightPreview = createAuthenticatedPatientInsightPreviewService({
    acquireContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    readPatientRevision: (patientId) => {
        // ADR 0066: ordinary currentness reads must not expose tombstoned rows.
        const row = dbServer.select({ version: patients.version }).from(patients)
            .where(and(eq(patients.id, patientId), activePatients())).get();
        return Number.isSafeInteger(row?.version) ? row!.version : null;
    },
    createCapability: (currentness) => createPatientInsightHostCapability({
        killSwitch, currentness, lifecycle, binding, readiness, route: routeHostResolvedCandidateCapability,
    }),
    clock: () => new Date().toISOString(),
    entropy: () => randomBytes(32),
}).acquire;
