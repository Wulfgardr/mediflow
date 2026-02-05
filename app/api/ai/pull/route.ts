import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
import { validateLocalTarget } from '@/lib/local-target';

export async function POST(req: NextRequest) {
    /* @Codex */
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = await req.json();
        const { model } = body;
        const targetUrl = req.headers.get('x-target-url') || "http://127.0.0.1:11434";
        /* @Codex */
        const validation = validateLocalTarget(targetUrl);
        if (!validation.ok) {
            return NextResponse.json({ error: `Target not allowed: ${validation.reason}` }, { status: 400 });
        }

        if (!model) {
            return NextResponse.json({ error: "Model name required" }, { status: 400 });
        }

        const baseUrl = validation.url.toString().replace(/\/v1\/?$/, '');
        const apiUrl = `${baseUrl}/api/pull`;

        // We need to stream the response from Ollama back to the client
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true }) // streaming enabled
        });

        if (!response.ok || !response.body) {
            const errText = await response.text();
            return NextResponse.json({ error: `Ollama Pull Error: ${errText}` }, { status: response.status });
        }

        // Return a stream
        return new NextResponse(response.body);

    } catch (error) {
        console.error("Pull Model Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
