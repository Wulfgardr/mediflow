
import { NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import {
    assertLocalOllamaResponse,
    attestLocalOllamaModel,
    strictOllamaLoopbackBaseUrl,
} from '@/lib/ai-providers/ollama-locality';
import { ollamaLocalityErrorResponse } from '@/lib/ai-providers/ollama-locality-response';

/**
 * Proxy for Ollama Generate API
 * Addresses CORS and Mixed Content issues by routing requests through Next.js server.
 */
export async function POST(req: Request) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await req.json();
        const targetUrl = req.headers.get('x-target-url') || process.env.OLLAMA_URL || 'http://localhost:11434';
        const baseUrl = strictOllamaLoopbackBaseUrl(targetUrl);
        const attestation = await attestLocalOllamaModel(baseUrl, body?.model, req.signal);

        // Forward request to internal Ollama instance
        const res = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: req.signal,
            redirect: 'error',
        });

        if (!res.ok) {
            console.error(`[Proxy] Ollama Error: ${res.statusText}`);
            return NextResponse.json({ error: `Ollama Error: ${res.statusText}` }, { status: res.status });
        }

        const data = await res.json();
        assertLocalOllamaResponse(data, attestation);
        return NextResponse.json(data);

    } catch (e: unknown) {
        const localityResponse = ollamaLocalityErrorResponse(e);
        if (localityResponse) return localityResponse;
        console.error("[Proxy] Generate Failed:", e);
        return NextResponse.json({ error: "Proxy Error" }, { status: 500 });
    }
}
