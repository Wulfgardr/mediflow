/* @Codex */
import { NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import { validateLocalTarget } from '@/lib/local-target';
import {
    buildOpenMedUpstreamCall,
    normalizeOpenMedHealth,
    normalizeOpenMedResponse,
    OPENMED_REDACTION_SETTINGS_KEYS,
    parseSystemRedactionRequest,
    REDACTION_VERSION,
    resolveOpenMedRedactionConfig,
} from '@/lib/openmed-redaction';
import { settings } from '@/lib/schema';
import { requireSessionOrLocalToken, unauthorizedResponse } from '@/lib/security/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    const config = await loadOpenMedRedactionConfig();
    const validation = validateLocalTarget(config.baseUrl);
    if (!validation.ok) {
        return NextResponse.json({
            version: REDACTION_VERSION,
            provider: 'openmed',
            available: false,
            message: `Configured OpenMed endpoint not allowed: ${validation.reason}`,
        });
    }

    try {
        const response = await fetch(`${validation.url.toString().replace(/\/$/, '')}/health`, {
            cache: 'no-store',
            signal: request.signal,
        });

        if (!response.ok) {
            return NextResponse.json({
                version: REDACTION_VERSION,
                provider: 'openmed',
                available: false,
                message: 'OpenMed health check failed.',
            });
        }

        const body = await response.json();
        return NextResponse.json({
            version: REDACTION_VERSION,
            provider: 'openmed',
            available: true,
            service: normalizeOpenMedHealth(body),
            config: {
                baseUrl: validation.url.toString().replace(/\/$/, ''),
                defaultLanguage: config.defaultLanguage,
                defaultMethod: config.defaultMethod,
                defaultConfidenceThreshold: config.defaultConfidenceThreshold,
            },
        });
    } catch (error) {
        console.error('[OpenMed] Health check failed:', error instanceof Error ? error.message : 'unknown');
        return NextResponse.json({
            version: REDACTION_VERSION,
            provider: 'openmed',
            available: false,
            message: 'OpenMed not reachable.',
        });
    }
}

export async function POST(request: Request) {
    const session = await requireSessionOrLocalToken(request);
    if (!session) return unauthorizedResponse();

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body.', code: 'REDACTION_INVALID_INPUT' }, { status: 400 });
    }

    const parsed = parseSystemRedactionRequest(body);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, code: 'REDACTION_INVALID_INPUT' }, { status: 400 });
    }

    const config = await loadOpenMedRedactionConfig();
    const validation = validateLocalTarget(config.baseUrl);
    if (!validation.ok) {
        return NextResponse.json(
            {
                error: `Configured OpenMed endpoint not allowed: ${validation.reason}`,
                code: 'REDACTION_CONFIGURATION',
            },
            { status: 503 },
        );
    }

    const upstream = buildOpenMedUpstreamCall(parsed.value, config);

    try {
        const response = await fetch(`${validation.url.toString().replace(/\/$/, '')}${upstream.pathname}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(upstream.payload),
            cache: 'no-store',
            signal: request.signal,
        });

        if (!response.ok) {
            console.error(`[OpenMed] Upstream ${parsed.value.action} failed with status ${response.status}`);
            return NextResponse.json(
                { error: 'OpenMed upstream error.', code: 'REDACTION_UPSTREAM_ERROR' },
                { status: response.status >= 500 ? 502 : response.status },
            );
        }

        const responseBody = await response.json();
        return NextResponse.json(normalizeOpenMedResponse(parsed.value, config, responseBody));
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return NextResponse.json({ error: 'Request aborted.', code: 'REDACTION_ABORTED' }, { status: 499 });
        }

        console.error('[OpenMed] Request failed:', error instanceof Error ? error.message : 'unknown');
        return NextResponse.json(
            { error: 'OpenMed not reachable.', code: 'REDACTION_UNAVAILABLE' },
            { status: 503 },
        );
    }
}

async function loadOpenMedRedactionConfig() {
    const rows = await dbServer
        .select()
        .from(settings)
        .where(inArray(settings.key, [...OPENMED_REDACTION_SETTINGS_KEYS]));

    const getValue = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
    return resolveOpenMedRedactionConfig({
        baseUrl: getValue('openmedUrl'),
        defaultLanguage: getValue('openmedRedactionLang'),
        defaultMethod: getValue('openmedRedactionMethod'),
        defaultConfidenceThreshold: getValue('openmedRedactionConfidenceThreshold'),
    });
}
