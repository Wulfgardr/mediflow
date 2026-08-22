/* @Codex */
import 'server-only';

import { createHostLocalProviderBindingService } from '../ai-providers/host-local-provider-binding';
import { observeClinical } from '../ai-providers/host-local-provider-readiness';
import { routeHostResolvedCandidateCapability } from '../ai-providers/fabric/candidate-router';
import { createHostProviderLifecycleService } from '../ai-providers/fabric/provider-lifecycle-service';
import { createPatientSmartImportHostCapability } from '../domain/documents/patient-smart-import-host-capability';
import { createPatientSmartImportHostKillSwitch } from '../domain/documents/patient-smart-import-host-kill-switch';
import { acquireAuthenticatedWebSessionProjectionOwnerContext } from './server-auth';
import { createAuthenticatedSmartImportPreviewService } from './server-session-authenticated-smart-import-preview';

const lifecycle = createHostProviderLifecycleService().service;
const readiness = Object.freeze({ observeClinical });

export const previewAuthenticatedSmartImport = createAuthenticatedSmartImportPreviewService({
    acquireContext: acquireAuthenticatedWebSessionProjectionOwnerContext,
    createCapability: (broker) => createPatientSmartImportHostCapability({
        killSwitch: createPatientSmartImportHostKillSwitch(), broker, lifecycle,
        binding: createHostLocalProviderBindingService(), readiness, route: routeHostResolvedCandidateCapability,
    }),
}).preview;
