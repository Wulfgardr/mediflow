import { reviewPatientProfileHttp } from '@/lib/patient-profile-service';
import { withArchiveRequestContext } from '@/lib/security/archive-request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = withArchiveRequestContext(reviewPatientProfileHttp);
