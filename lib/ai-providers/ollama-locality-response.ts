/* @Codex */
import { NextResponse } from 'next/server';
import { OllamaLocalityError } from './ollama-locality';

export function ollamaLocalityErrorResponse(error: unknown): NextResponse | null {
    if (!(error instanceof OllamaLocalityError)) return null;
    return NextResponse.json(
        {
            error: 'Ollama local-only policy blocked the request',
            code: error.code,
        },
        { status: error.code === 'provider_unready' ? 503 : 400 },
    );
}
