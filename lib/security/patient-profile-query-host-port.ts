import 'server-only';

import type { ProfileProjection, ProfileQuery, ProfileResult } from '../../packages/patient-profile-contracts/src/query';
import { acquireScopedPatientProfileHostPort, isCurrentScopedPatientProfileResult } from '../patient-profile-service';
import type { ProfileRelease } from '../patient-profile-pseudonymization';
import { HEADLESS_AGENT_KIND_ENV } from './headless-agent-kind.ts';

export type PatientProfileQueryHostPort = Readonly<{
    executeProfileQuery(input: ProfileQuery, signal?: AbortSignal): Promise<ProfileResult>;
    dispose(): boolean;
}>;

export function acquirePatientProfileQueryHostPort(projection: ProfileProjection, expiresAt: number,
    release: ProfileRelease): Promise<PatientProfileQueryHostPort | null> {
    return acquireScopedPatientProfileHostPort(projection, expiresAt, release);
}

export function headlessProfileRelease(environment: Readonly<Record<string, string | undefined>>): ProfileRelease {
    return environment[HEADLESS_AGENT_KIND_ENV] === 'mini' ? 'identified' : 'pseudonymized';
}

export const isCurrentPatientProfileQueryResult = isCurrentScopedPatientProfileResult;
