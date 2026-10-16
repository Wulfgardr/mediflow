import { NextResponse } from 'next/server';
import { OllamaLocalityError } from './ollama-locality';

export function ollamaLocalityErrorResponse(error: unknown): NextResponse | null {
    if (!(error instanceof OllamaLocalityError)) return null;
    return NextResponse.json(
        {
            error: 'Ollama local-only policy blocked the request',
            code: error.code,
            ...(error.code === 'provider_version_unsupported' ? { versionMismatch: error.versionMismatch } : {}),
        },
        { status: error.code === 'provider_unready' ? 503 : error.code === 'provider_version_unsupported' ? 409 : 400 },
    );
}
