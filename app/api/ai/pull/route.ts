import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { NextResponse } from 'next/server';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { OllamaLocalityError } from '@/lib/ai-providers/ollama-locality';
import { ollamaLocalityErrorResponse } from '@/lib/ai-providers/ollama-locality-response';

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    return ollamaLocalityErrorResponse(
        new OllamaLocalityError('model_pull_disabled'),
    ) as NextResponse;
}
