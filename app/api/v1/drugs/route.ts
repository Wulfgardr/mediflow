// Codex: created 2026-02-06
import { NextResponse } from 'next/server';
import { AifaCatalogConflictError, AifaUpdateError } from '@/lib/aifa-catalog-lock';
import { AIFA_LEGACY_REPLACE_CONFIRMATION, normalizeAifaSearchText } from '@/lib/aifa-catalog';
import { AifaLegacyReplaceDeniedError, replaceLegacyDrugCatalogWithAuthority } from '@/lib/aifa-catalog-server';
import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { buildAuditWriteInputFromRequest } from '@/lib/security/audit';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';
import { drugs } from '@/lib/schema';
import { requireLocalApiToken } from '@/lib/security/local-api-auth';
import { readDrugCatalog } from '@/lib/network-catalog-read';

type DrugPayload = {
    aic?: string;
    name?: string;
    activePrinciple?: string | null;
    company?: string | null;
    packaging?: string | null;
    class?: string | null;
    price?: number | null;
    atc?: string | null;
};

const OPTIONAL_TEXT_FIELDS = ['activePrinciple', 'company', 'packaging', 'class', 'atc'] as const;

/** A malformed item (wrong field types included) is refused as a whole, never coerced or thrown. */
function hasValidDrugFieldTypes(item: Record<string, unknown>): boolean {
    if (typeof item.aic !== 'string' || typeof item.name !== 'string') return false;
    if (item.price !== undefined && item.price !== null && typeof item.price !== 'number') return false;
    return OPTIONAL_TEXT_FIELDS.every((field) => item[field] === undefined || item[field] === null || typeof item[field] === 'string');
}

function normalizeDrug(item: DrugPayload): typeof drugs.$inferInsert | null {
    if (!hasValidDrugFieldTypes(item as Record<string, unknown>)) return null;
    const aic = (item.aic || '').trim();
    const name = (item.name || '').trim();
    if (!aic || !name) return null;

    const numericPrice = typeof item.price === 'number' && Number.isFinite(item.price)
        ? Math.round(item.price)
        : null;

    return {
        aic,
        name,
        activePrinciple: item.activePrinciple?.trim() || null,
        company: item.company?.trim() || null,
        packaging: item.packaging?.trim() || null,
        class: item.class?.trim() || null,
        price: numericPrice,
        atc: item.atc?.trim() || null,
        aicSearch: normalizeAifaSearchText(aic),
        nameSearch: normalizeAifaSearchText(name),
        activePrincipleSearch: normalizeAifaSearchText(item.activePrinciple || ''),
    };
}

export async function GET(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const result = await readDrugCatalog(searchParams);
        return NextResponse.json(result.body, { status: result.status ?? 200 });
    } catch (error) {
        console.error('API GET /api/v1/drugs error:', error);
        return NextResponse.json({ error: 'Failed to fetch drugs' }, { status: 500 });
    }
}

/*
 * Legacy whole-catalog replacement (WUL-802, ADR 0125). The rows carry no source file, so the
 * catalog becomes `unverified`. Same authority as the administrative clear on /api/drugs:
 * local token plus web administrator session, the snapshot read before the change, the
 * versioned confirmation, and the audit row in the same transaction. A bare array or a
 * single object (the pre-0.9.1 shape) is refused with an explicit code, never applied.
 */
export async function POST(request: Request) {
    const authError = requireLocalApiToken(request);
    if (authError) return authError;
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    const body = await request.json().catch(() => null) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray((body as { items?: unknown }).items)) {
        return NextResponse.json({
            error: 'Sostituzione del catalogo AIFA: servono items, expectedSnapshot e conferma',
            code: 'AIFA_LEGACY_REPLACE_COMMAND_REQUIRED',
            confirmation: AIFA_LEGACY_REPLACE_CONFIRMATION,
        }, { status: 400 });
    }
    const command = body as { items: DrugPayload[]; expectedSnapshot?: unknown; confirmation?: unknown };
    const items = command.items.map((item) => (item && typeof item === 'object' ? normalizeDrug(item) : null));
    if (!items.length || items.some((item) => item === null)) {
        return NextResponse.json({ error: 'No valid drugs payload' }, { status: 400 });
    }

    try {
        const result = replaceLegacyDrugCatalogWithAuthority({
            session,
            items: items as (typeof drugs.$inferInsert)[],
            expectedSnapshot: command.expectedSnapshot,
            confirmation: command.confirmation,
            audit: buildAuditWriteInputFromRequest(request, session, { eventType: 'reference_data.aifa.updated', subjectType: 'reference_data', subjectRef: 'aifa' }),
        });
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        if (error instanceof AifaLegacyReplaceDeniedError) {
            return NextResponse.json({ error: 'Sostituzione del catalogo riservata all’amministratore', code: 'AIFA_LEGACY_REPLACE_ADMIN_REQUIRED' }, { status: 403 });
        }
        if (error instanceof AifaCatalogConflictError) {
            return NextResponse.json({ error: 'Catalogo AIFA modificato dopo l’ultima lettura; nessuna voce sostituita', code: 'AIFA_CATALOG_CHANGED' }, { status: 409 });
        }
        if (error instanceof AifaUpdateError && error.status === 409) {
            return NextResponse.json({ error: 'Operazione AIFA già in corso' }, { status: 409 });
        }
        if (error instanceof AifaUpdateError && error.status === 400) {
            return NextResponse.json({ error: 'Versione attesa o conferma della sostituzione AIFA assente o non valida' }, { status: 400 });
        }
        console.error('API POST /api/v1/drugs error:', error);
        return NextResponse.json({ error: 'Sostituzione AIFA non riuscita; catalogo conservato' }, { status: 500 });
    }
}

/* No DELETE here: clearing the catalog needs the audited administrative path on /api/drugs. */
