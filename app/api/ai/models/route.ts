import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';
import {
    isLocalOllamaModelDescriptor,
    strictOllamaLoopbackBaseUrl,
} from '@/lib/ai-providers/ollama-locality';
import { ollamaLocalityErrorResponse } from '@/lib/ai-providers/ollama-locality-response';

export async function GET(req: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(req);
    if (!session) return unauthorizedResponse();

    // The client may select an endpoint, but the server reduces it to an HTTP loopback.
    const targetUrl = req.headers.get('x-target-url') || 'http://127.0.0.1:11434';
    try {
        const baseUrl = strictOllamaLoopbackBaseUrl(targetUrl);
        const response = await fetch(`${baseUrl}/api/tags`, { redirect: 'error' });
        if (!response.ok) {
            return NextResponse.json({ error: `Ollama Error: ${response.statusText}` }, { status: response.status });
        }
        const data = await response.json();
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
        console.error("Failed to fetch models:", error);
        return NextResponse.json({ error: "Failed to connect to AI provider" }, { status: 500 });
    }
}
