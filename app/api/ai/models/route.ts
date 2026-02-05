import { NextRequest, NextResponse } from 'next/server';
/* @Codex */
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/server-auth';
import { validateLocalTarget } from '@/lib/local-target';

export async function GET(req: NextRequest) {
    /* @Codex */
    const session = await requireSessionOrLocalToken(req);
    if (!session) return unauthorizedResponse();

    // Default to localhost Ollama if not specified in env, but usually frontend passes target or we read from DB settings in a real app.
    // For now, let's assume standard Ollama port or use the proxy logic.
    // Actually, we can reuse the same logic as the chat proxy but targeting /api/tags

    // We'll trust the client to tell us WHERE to look (via headers) or just default to localhost:11434 
    // BUT the client settings page knows the URL.
    // Let's allow passing the target URL via a header 'x-target-url' just like our other proxy
    // OR deeper: The frontend settings page has the URL. 

    const targetUrl = req.headers.get('x-target-url') || "http://127.0.0.1:11434"; // Default
    /* @Codex */
    const validation = validateLocalTarget(targetUrl);
    if (!validation.ok) {
        return NextResponse.json({ error: `Target not allowed: ${validation.reason}` }, { status: 400 });
    }

    // Construct the tags endpoint
    // If targetUrl ends with /v1 (OpenAI compat), we need to strip it to get to the base Ollama API
    const baseUrl = validation.url.toString().replace(/\/v1\/?$/, '');
    const apiUrl = `${baseUrl}/api/tags`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            return NextResponse.json({ error: `Ollama Error: ${response.statusText}` }, { status: response.status });
        }
        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Failed to fetch models:", error);
        return NextResponse.json({ error: "Failed to connect to AI provider" }, { status: 500 });
    }
}
