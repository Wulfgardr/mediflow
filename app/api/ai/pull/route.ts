import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import {
    assertLocalOllamaModelReference,
    strictOllamaLoopbackBaseUrl,
} from '@/lib/ai-providers/ollama-locality';
import { ollamaLocalityErrorResponse } from '@/lib/ai-providers/ollama-locality-response';

export async function POST(req: NextRequest) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await req.json();
        const { model } = body;
        const targetUrl = req.headers.get('x-target-url') || "http://127.0.0.1:11434";
        assertLocalOllamaModelReference(model);
        const baseUrl = strictOllamaLoopbackBaseUrl(targetUrl);
        const apiUrl = `${baseUrl}/api/pull`;

        // We need to stream the response from Ollama back to the client
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true }),
            redirect: 'error',
        });

        if (!response.ok || !response.body) {
            const errText = await response.text();
            return NextResponse.json({ error: `Ollama Pull Error: ${errText}` }, { status: response.status });
        }

        // Return a stream
        return new NextResponse(response.body);

    } catch (error) {
        const localityResponse = ollamaLocalityErrorResponse(error);
        if (localityResponse) return localityResponse;
        console.error("Pull Model Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
