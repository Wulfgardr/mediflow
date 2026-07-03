/* @Codex WUL-421 */
import { NextResponse } from 'next/server';
import { asc, sql } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import type { AifaDrug } from '@/lib/db';
import { requireSession, unauthorizedResponse } from '@/lib/server-auth';
import { drugs } from '@/lib/schema';
import {
    buildVisitTranscriptDraft,
    collectVisitTranscriptDrugSearchTerms,
    type VisitSessionEvent,
    type VisitTranscriptSegment,
} from '@/lib/visit-transcript-draft';
import { sortDrugCatalogSearchResults } from '@/lib/patient-smart-import-matching';

const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_DRUG_TERMS = 8;
const MAX_DRUG_CANDIDATES_PER_TERM = 30;

type VisitDraftRouteBody = {
    patientId?: unknown;
    transcript?: unknown;
    segments?: unknown;
    events?: unknown;
};

function normalizeSegment(value: unknown): VisitTranscriptSegment | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    if (typeof item.text !== 'string' || !item.text.trim()) return null;
    return {
        text: item.text,
        speaker: typeof item.speaker === 'string' ? item.speaker : undefined,
        atMs: typeof item.atMs === 'number' && Number.isFinite(item.atMs) ? item.atMs : undefined,
    };
}

function normalizeEvent(value: unknown): VisitSessionEvent | null {
    if (!value || typeof value !== 'object') return null;
    const item = value as Record<string, unknown>;
    if (item.type !== 'start' && item.type !== 'pause' && item.type !== 'resume' && item.type !== 'stop') return null;
    if (typeof item.atMs !== 'number' || !Number.isFinite(item.atMs) || item.atMs < 0) return null;
    return { type: item.type, atMs: item.atMs };
}

function normalizeRouteBody(body: VisitDraftRouteBody) {
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    const segments = Array.isArray(body.segments)
        ? body.segments.map(normalizeSegment).filter((item): item is VisitTranscriptSegment => Boolean(item))
        : [];
    const events = Array.isArray(body.events)
        ? body.events.map(normalizeEvent).filter((item): item is VisitSessionEvent => Boolean(item))
        : [];

    return {
        patientId: typeof body.patientId === 'string' ? body.patientId.trim() : undefined,
        transcript,
        segments,
        events,
    };
}

function serializeDrug(row: typeof drugs.$inferSelect): AifaDrug {
    return {
        aic: row.aic,
        name: row.name,
        activePrinciple: row.activePrinciple || undefined,
        company: row.company || undefined,
        packaging: row.packaging || undefined,
        class: row.class || undefined,
        price: row.price ?? undefined,
        atc: row.atc || undefined,
    };
}

async function fetchDrugCatalogCandidates(terms: string[]): Promise<AifaDrug[]> {
    const byAic = new Map<string, AifaDrug>();

    for (const term of terms.slice(0, MAX_DRUG_TERMS)) {
        const query = term.trim();
        if (query.length < 2) continue;

        const rows = await dbServer.select().from(drugs)
            .where(sql`
                ${drugs.name} LIKE ${`%${query}%`}
                OR ${drugs.activePrinciple} LIKE ${`%${query}%`}
                OR ${drugs.packaging} LIKE ${`%${query}%`}
                OR ${drugs.aic} LIKE ${`%${query}%`}
                OR ${drugs.atc} LIKE ${`%${query}%`}
            `)
            .orderBy(asc(drugs.name), asc(drugs.packaging))
            .limit(MAX_DRUG_CANDIDATES_PER_TERM);

        for (const row of sortDrugCatalogSearchResults(query, rows.map(serializeDrug))) {
            byAic.set(row.aic, row);
        }
    }

    return Array.from(byAic.values());
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const body = normalizeRouteBody(await request.json() as VisitDraftRouteBody);
        const transcriptLength = body.transcript.length + body.segments.reduce((sum, segment) => sum + segment.text.length, 0);

        if (transcriptLength === 0) {
            return NextResponse.json({ error: 'Transcript required' }, { status: 400 });
        }
        if (transcriptLength > MAX_TRANSCRIPT_CHARS) {
            return NextResponse.json({ error: 'Transcript too long' }, { status: 413 });
        }

        const terms = collectVisitTranscriptDrugSearchTerms(body);
        const drugCatalog = await fetchDrugCatalogCandidates(terms);
        const result = buildVisitTranscriptDraft({ ...body, drugCatalog });

        return NextResponse.json(result);
    } catch (_error) {
        return NextResponse.json({ error: 'Visit transcript draft failed' }, { status: 500 });
    }
}
