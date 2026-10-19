import { commitPatientProfileNotesHttp } from '@/lib/patient-profile-service';
import { withArchiveRequestContext } from '@/lib/security/archive-request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = withArchiveRequestContext((request: Request, context: Readonly<{ params: Promise<{ id: string }> }>) =>
    commitPatientProfileNotesHttp(request, async () => (await context.params).id));
