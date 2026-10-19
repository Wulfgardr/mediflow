import 'server-only';

import type { ProfileProjection, ProfileQuery, ProfileResult } from '../../packages/patient-profile-contracts/src/query';
import { acquireScopedPatientProfileHostPort, isCurrentScopedPatientProfileResult } from '../patient-profile-service';

export type PatientProfileQueryHostPort = Readonly<{
    executeProfileQuery(input: ProfileQuery, signal?: AbortSignal): Promise<ProfileResult>;
    dispose(): boolean;
}>;

export function acquirePatientProfileQueryHostPort(projection: ProfileProjection, expiresAt: number): Promise<PatientProfileQueryHostPort | null> {
    return acquireScopedPatientProfileHostPort(projection, expiresAt);
}

export const isCurrentPatientProfileQueryResult = isCurrentScopedPatientProfileResult;
