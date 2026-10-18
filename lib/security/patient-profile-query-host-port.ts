import 'server-only';

import type { ProfileProjection, ProfileQuery, ProfileResult } from '../patient-profile-scoped-contract';
import { acquireScopedPatientProfileHostPort, isCurrentScopedPatientProfileResult } from '../patient-profile-service';

export type PatientProfileQueryHostPort = Readonly<{
    executeProfileQuery(input: ProfileQuery, signal?: AbortSignal): Promise<ProfileResult>;
    dispose(): boolean;
}>;

export function acquirePatientProfileQueryHostPort(projection: ProfileProjection): Promise<PatientProfileQueryHostPort | null> {
    return acquireScopedPatientProfileHostPort(projection);
}

export const isCurrentPatientProfileQueryResult = isCurrentScopedPatientProfileResult;
