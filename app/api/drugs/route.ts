import { AifaReductionError, AifaUpdateError } from '@/lib/aifa-catalog-lock';
import { buildAuditWriteInputFromRequest } from '@/lib/security/audit';
import { archiveReplacementResponse } from '@/lib/api-error-response';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { NextResponse } from 'next/server';
import {
    recordAifaCatalogRejection,
    clearAifaCatalog,
    getAifaCatalogStatus,
    replaceAifaCatalog,
    searchAifaCatalog,
} from '@/lib/aifa-catalog-server';
import { type AifaCatalogManifestInput } from '@/lib/aifa-catalog';
import { type AifaDrug } from '@/lib/db';
import { parseDrugSearchLimit } from '@/lib/drug-search-query';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

const CATALOG_STATUS_HEADER = 'X-MediFlow-Aifa-Catalog';

function toDrugPayload(
    row: Awaited<ReturnType<typeof searchAifaCatalog>>['rows'][number],
    priceStoredAsCents: boolean,
): AifaDrug {
    return {
        aic: row.aic,
        name: row.name,
        activePrinciple: row.activePrinciple || undefined,
        company: row.company || undefined,
        packaging: row.packaging || undefined,
        class: row.class || undefined,
        price: row.price === null ? undefined : priceStoredAsCents ? row.price / 100 : row.price,
        atc: row.atc || undefined,
    };
}

function manifestInputFromForm(form: FormData): AifaCatalogManifestInput {
    return {
        sourceUrl: String(form.get('sourceUrl') || ''),
        downloadedAt: String(form.get('downloadedAt') || ''),
        version: String(form.get('version') || ''),
    };
}

export async function GET(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    const countOnly = searchParams.get('count') === '1';

    try {
        if (countOnly) {
            const status = await getAifaCatalogStatus();
            return NextResponse.json(
                { count: status.count, manifest: status.manifest, state: status.state },
                { headers: { [CATALOG_STATUS_HEADER]: status.state } },
            );
        }
        if (!query) {
            return NextResponse.json(
                { error: 'q is required unless count=1' },
                { status: 400 },
            );
        }

        const limit = parseDrugSearchLimit(searchParams.get('limit'));
        const { rows, status } = await searchAifaCatalog(query, limit);
        return NextResponse.json(rows.map((row) => toDrugPayload(row, status.state === 'ready')), {
            headers: { [CATALOG_STATUS_HEADER]: status.state },
        });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('[MediFlow] AIFA catalog read failed:', error);
        return NextResponse.json({ error: 'Failed to read drug catalog' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File) || !file.name.toLocaleLowerCase('it-IT').endsWith('.csv')) {
            return NextResponse.json({ error: 'CSV AIFA richiesto' }, { status: 400 });
        }
        const confirmation = form.get('reductionConfirmation');
        if (confirmation !== null && (typeof confirmation !== 'string' || !/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(confirmation))) {
            return NextResponse.json({ error: 'Conferma della riduzione AIFA non valida' }, { status: 400 });
        }
        const result = await replaceAifaCatalog(file, manifestInputFromForm(form), undefined, {
            confirmedReduction: typeof confirmation === 'string' ? confirmation : undefined,
            audit: buildAuditWriteInputFromRequest(request, session, { eventType: 'reference_data.aifa.updated', subjectType: 'reference_data', subjectRef: 'aifa' }),
        });
        return NextResponse.json(result, {
            headers: { [CATALOG_STATUS_HEADER]: result.state },
        });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        const message = error instanceof AifaUpdateError ? error.message
            : error instanceof Error && /^(CSV AIFA non valido:|URL fonte AIFA|Data di scarico AIFA|Versione dataset AIFA|File AIFA)/.test(error.message)
                ? error.message : 'Importazione AIFA non riuscita; catalogo conservato';
        await recordAifaCatalogRejection(buildAuditWriteInputFromRequest(request, session, {
            eventType: 'reference_data.aifa.updated', subjectType: 'reference_data', subjectRef: 'aifa', outcome: 'failure',
            redactedMetadata: { flags: ['mode:manual'], reasonCode: 'import-rejected' },
        })).catch(() => undefined);
        return NextResponse.json({ error: message, ...(error instanceof AifaReductionError ? {
            code: 'AIFA_REDUCTION_CONFIRMATION_REQUIRED', confirmation: error.confirmation,
            previousCount: error.previousCount, nextCount: error.nextCount,
        } : {}) }, { status: error instanceof AifaUpdateError ? error.status : 400 });
    }
}

export async function DELETE(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;

    try {
        clearAifaCatalog();
        return NextResponse.json({ success: true });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        console.error('[MediFlow] AIFA catalog clear failed:', error);
        return NextResponse.json({ error: 'Failed to clear drug catalog' }, { status: 500 });
    }
}
