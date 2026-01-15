import { NextRequest, NextResponse } from 'next/server';

const ICD_LOCAL_URL = 'http://localhost:8888';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    if (!query) {
        // Just a status check if no query
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1000);
            await fetch(ICD_LOCAL_URL, {
                method: 'HEAD',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return NextResponse.json({ status: 'online' }, { status: 200 });
        } catch {
            return NextResponse.json({ status: 'offline' }, { status: 503 });
        }
    }

    // Perform Search Proxy
    try {
        // Use the MMS Linearization specific endpoint (2024-01) to ensure we get valid billing codes (theCode).
        // Foundation search (/icd/entity/search) often lacks codes.
        const targetUrl = `${ICD_LOCAL_URL}/icd/release/11/2024-01/mms/search?q=${encodeURIComponent(query)}&includeKeywordResult=true&useaperiodic=false`;

        const res = await fetch(targetUrl, {
            headers: {
                'Accept': 'application/json',
                'API-Version': 'v2',
                'Accept-Language': 'en'
            }
        });

        if (!res.ok) {
            throw new Error(`Upstream error: ${res.status}`);
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("ICD Proxy Error:", error);
        return NextResponse.json({ error: 'Failed to fetch from ICD Local API' }, { status: 500 });
    }
}
