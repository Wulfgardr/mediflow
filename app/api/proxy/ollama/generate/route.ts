
import { NextResponse } from 'next/server';

/**
 * Proxy for Ollama Generate API
 * Addresses CORS and Mixed Content issues by routing requests through Next.js server.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();

        const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

        console.log(`[Proxy] Forwarding generate request to ${OLLAMA_URL}/api/generate`);

        // Forward request to internal Ollama instance
        const res = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: req.signal // Propagate client abort to Ollama
        });

        if (!res.ok) {
            console.error(`[Proxy] Ollama Error: ${res.statusText}`);
            return NextResponse.json({ error: `Ollama Error: ${res.statusText}` }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);

    } catch (e: any) {
        console.error("[Proxy] Generate Failed:", e);
        return NextResponse.json({ error: "Proxy Error: " + e.message }, { status: 500 });
    }
}
