
import { NextResponse } from 'next/server';

/**
 * Proxy for Ollama Chat API
 * Addresses CORS and Mixed Content issues by routing requests through Next.js server.
 */
export async function POST(req: Request) {
    try {
        const body = await req.json();

        // Hardcoded or Env-based internal URL
        // If running in Docker, 'host.docker.internal' might be needed, or just 'localhost' if host networking
        // The user configured URL in settings is usually for the CLIENT.
        // For the SERVER, we might need a different one if they differ.
        // For now, let's respect the body's intent but force the destination.
        // wait, we can't easily get the settings from DB here without decrypting if it's encrypted.
        // Let's assume standard localhost for now as fallback.

        const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

        console.log(`[Proxy] Forwarding chat request to ${OLLAMA_URL}/api/chat`);

        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
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
        console.error("[Proxy] Chat Failed:", e);
        return NextResponse.json({ error: "Proxy Error: " + e.message }, { status: 500 });
    }
}
