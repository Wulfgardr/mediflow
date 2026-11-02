import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';
import {
    isLocalOllamaModelDescriptor,
    OllamaLocalityError,
    strictOllamaLoopbackBaseUrl,
} from '@/lib/ai-providers/ollama-locality';
import { ollamaLocalityErrorResponse } from '@/lib/ai-providers/ollama-locality-response';

// The settings page stops waiting after 15 s: the server answers before it.
const OLLAMA_INVENTORY_TIMEOUT_MS = 10_000;

export async function GET(req: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(req);
    if (!session) return unauthorizedResponse();

    // The client may select an endpoint, but the server reduces it to an HTTP loopback.
    const targetUrl = req.headers.get('x-target-url') || 'http://127.0.0.1:11434';
    try {
        const baseUrl = strictOllamaLoopbackBaseUrl(targetUrl);
        const response = await fetch(`${baseUrl}/api/tags`, {
            redirect: 'error', signal: AbortSignal.timeout(OLLAMA_INVENTORY_TIMEOUT_MS),
        });
        if (!response.ok) {
            return NextResponse.json({ error: `Ollama Error: ${response.statusText}` }, { status: response.status });
        }
        // A body that is not JSON is an unready provider, not an internal error.
        const data = await response.json().catch(() => {
            throw new OllamaLocalityError('provider_unready');
        });
        /* @Codex */
        // Return a stable, minimal contract across web/native clients.
        const rawModels = Array.isArray(data?.models) ? data.models : [];
        const models = rawModels
            .filter(isLocalOllamaModelDescriptor)
            .map((model: unknown) => {
                const descriptor = model as Record<string, unknown>;
                return {
                    name: typeof descriptor.name === 'string' ? descriptor.name : '',
                    size: typeof descriptor.size === 'number' ? descriptor.size : null,
                };
            })
            .filter((model: { name: string }) => model.name.length > 0);
        return NextResponse.json({ models });
    } catch (error) {
        const localityResponse = ollamaLocalityErrorResponse(error);
        if (localityResponse) return localityResponse;
        // Without AI, an absent, refused or silent local provider is an expected state.
        console.warn('Ollama non raggiungibile durante la lettura dei modelli:', error instanceof Error ? error.name : 'unknown');
        return ollamaLocalityErrorResponse(new OllamaLocalityError('provider_unready'))!;
    }
}
