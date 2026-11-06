import { TREATMENT_REASONING_UNAVAILABLE_CODE, TREATMENT_REASONING_UNAVAILABLE_LABEL } from './ai-function-availability';
import { requireSession, unauthorizedResponse } from './security/server-auth';

export async function treatmentReasoningUnavailableResponse() {
    if (!await requireSession()) return unauthorizedResponse();
    return Response.json({ error: TREATMENT_REASONING_UNAVAILABLE_LABEL, code: TREATMENT_REASONING_UNAVAILABLE_CODE },
        { status: 403, headers: { 'Cache-Control': 'no-store' } });
}
