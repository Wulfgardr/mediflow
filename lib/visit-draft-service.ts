/* @Codex WUL-421 */
import { asc, sql } from 'drizzle-orm';
import { dbServer } from '@/lib/db-server';
import type { AifaDrug } from '@/lib/db';
import { drugs } from '@/lib/schema';
import { sortDrugCatalogSearchResults } from '@/lib/domain/documents/patient-smart-import-matching';
import {
    buildVisitTranscriptDraft,
    collectVisitTranscriptDrugSearchTerms,
    type VisitSessionEvent,
    type VisitTranscriptDraftResult,
    type VisitTranscriptSegment,
} from '@/lib/visit-transcript-draft';

export const MAX_VISIT_DRAFT_TRANSCRIPT_CHARS = 12_000;
const MAX_DRUG_TERMS = 8;
const MAX_DRUG_CANDIDATES_PER_TERM = 30;

export type VisitDraftRouteBody = {
    patientId?: unknown;
    transcript?: unknown;
    segments?: unknown;
    events?: unknown;
};

export type NormalizedVisitDraftBody = {
    patientId: string | undefined;
    transcript: string;
    segments: VisitTranscriptSegment[];
    events: VisitSessionEvent[];
};

export type VisitDraftResult =
    | { ok: true; value: VisitTranscriptDraftResult }
    | { ok: false; status: 400 | 413; error: string };

export type VisitDraftServiceDeps = {
    fetchDrugCatalogCandidates: (terms: string[]) => Promise<AifaDrug[]>;
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

export function normalizeVisitDraftRouteBody(body: VisitDraftRouteBody): NormalizedVisitDraftBody {
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

export async function fetchVisitDraftDrugCatalogCandidates(terms: string[]): Promise<AifaDrug[]> {
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

export async function createVisitDraft(
    rawBody: VisitDraftRouteBody,
    deps: VisitDraftServiceDeps = { fetchDrugCatalogCandidates: fetchVisitDraftDrugCatalogCandidates },
): Promise<VisitDraftResult> {
    const body = normalizeVisitDraftRouteBody(rawBody);
    const transcriptLength = body.transcript.length + body.segments.reduce((sum, segment) => sum + segment.text.length, 0);

    if (transcriptLength === 0) {
        return { ok: false, status: 400, error: 'Transcript required' };
    }
    if (transcriptLength > MAX_VISIT_DRAFT_TRANSCRIPT_CHARS) {
        return { ok: false, status: 413, error: 'Transcript too long' };
    }

    const terms = collectVisitTranscriptDrugSearchTerms(body);
    const drugCatalog = await deps.fetchDrugCatalogCandidates(terms);
    return { ok: true, value: buildVisitTranscriptDraft({ ...body, drugCatalog }) };
}
