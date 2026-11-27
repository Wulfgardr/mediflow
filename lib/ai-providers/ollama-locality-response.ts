import { NextResponse } from 'next/server';
import { OllamaLocalityError } from './ollama-locality';

export function ollamaLocalityErrorResponse(error: unknown): NextResponse | null {
    if (!(error instanceof OllamaLocalityError)) return null;
    return NextResponse.json(
        {
            error: 'Ollama local-only policy blocked the request',
            code: error.code,
            ...(error.code === 'provider_version_unsupported' ? { versionMismatch: error.versionMismatch } : {}),
            ...(error.code === 'provider_field_unknown' ? { unknownField: error.unknownField } : {}),
        },
        { status: error.code === 'provider_unready' ? 503
            : error.code === 'provider_version_unsupported' || error.code === 'provider_field_unknown' ? 409 : 400 },
    );
}
