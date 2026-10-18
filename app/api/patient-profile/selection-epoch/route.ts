import { withArchiveRequestContext } from '@/lib/security/archive-request-context';
import { readPatientProfileSelectionEpochHttp } from '@/lib/patient-profile-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const scopedProfileHandler = withArchiveRequestContext((request: Request) => readPatientProfileSelectionEpochHttp(request, 'web'));

export async function GET(request: Request) {
    return scopedProfileHandler(request);
}
