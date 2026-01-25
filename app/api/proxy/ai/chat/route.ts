import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const targetUrl = req.headers.get('x-target-url');

        if (!targetUrl) {
            return NextResponse.json({ error: "Missing x-target-url header" }, { status: 400 });
        }

        console.log(`[Proxy] Forwarding AI request to ${targetUrl}`);

        const res = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add Authorization header if needed in future (e.g. for remote OpenAI)
            },
            body: JSON.stringify(body),
            signal: req.signal // Propagate abort signal
        });

        if (!res.ok) {
            console.error(`[Proxy] AI Error: ${res.status} ${res.statusText}`);
            return NextResponse.json({ error: `Provider Error: ${res.statusText}` }, { status: res.status });
        }

        const data = await res.json();
        return NextResponse.json(data);

    } catch (e: any) {
        if (e.name === 'AbortError') {
            return NextResponse.json({ error: "Request aborted" }, { status: 499 });
        }
        console.error("[Proxy] AI Request Failed:", e);
        return NextResponse.json({ error: "Proxy Error: " + e.message }, { status: 500 });
    }
}
