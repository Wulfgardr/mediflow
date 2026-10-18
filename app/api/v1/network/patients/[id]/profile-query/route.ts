import { withArchiveRequestContext } from '@/lib/security/archive-request-context';
import { readScopedPatientProfileHttp } from '@/lib/patient-profile-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const scopedProfileHandler = withArchiveRequestContext((request: Request, context: { params: Promise<{ id: string }> }) =>
    readScopedPatientProfileHttp(request, 'network', async () => (await context.params).id));

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    return scopedProfileHandler(request, context);
}
