/* @Codex */
import 'server-only';

import { eq } from 'drizzle-orm';

import { AI_SMART_IMPORT_KILL_SWITCH_KEY } from '../ai-smart-import-kill-switch';
import { createHostLocalProviderBindingService } from '../ai-providers/host-local-provider-binding';
import { observeClinical } from '../ai-providers/host-local-provider-readiness';
import { routeHostResolvedCandidateCapability } from '../ai-providers/fabric/candidate-router';
import { createHostProviderLifecycleService } from '../ai-providers/fabric/provider-lifecycle-service';
import { createPatientSmartImportHostCapability } from '../domain/documents/patient-smart-import-host-capability';
import { createPatientSmartImportHostKillSwitch } from '../domain/documents/patient-smart-import-host-kill-switch';
import { dbServer } from '../db-server';
import { settings } from '../schema';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from './server-auth';
import { createAuthenticatedSmartImportPreviewService } from './server-session-authenticated-smart-import-preview';

const lifecycle = createHostProviderLifecycleService().service;
const readiness = Object.freeze({ observeClinical });
const killSwitch = createPatientSmartImportHostKillSwitch({
    readSetting: async () => {
        const row = await dbServer
            .select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, AI_SMART_IMPORT_KILL_SWITCH_KEY))
            .get();
        return row?.value;
    },
});

export const acquireAuthenticatedSmartImportPreview = createAuthenticatedSmartImportPreviewService({
    acquireContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    createCapability: (broker) => createPatientSmartImportHostCapability({
        killSwitch, broker, lifecycle,
        binding: createHostLocalProviderBindingService(), readiness, route: routeHostResolvedCandidateCapability,
    }),
}).acquire;
