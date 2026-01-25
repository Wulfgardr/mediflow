import { NextRequest, NextResponse } from 'next/server';

const ICD_LOCAL_URL = process.env.ICD_BASE_URL || 'http://127.0.0.1:8888';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q');

    if (!query) {
        // Status check
        try {
            const controller = new AbortController();
            // Increase timeout to 5s to handle container cold starts or network latency
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            // Check a known valid endpoint instead of root, with required headers
            const checkUrl = `${ICD_LOCAL_URL}/icd/release/11/2024-01/mms`;

            const res = await fetch(checkUrl, {
                method: 'HEAD',
                headers: {
                    'API-Version': 'v2',
                    'Accept': 'application/json'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            // Accept 200 (OK) or 405 (Method Not Allowed - implies server is up)
            // 404 might mean wrong URL but server up.
            if (res.ok || res.status === 405 || res.status === 404) {
                return NextResponse.json({ status: 'online' }, { status: 200 });
            }
            // If we get here, something else is wrong (e.g. 500)
            return NextResponse.json({ status: 'offline' }, { status: 503 });

        } catch (error) {
            console.error("ICD Status Check Failed:", error);
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
