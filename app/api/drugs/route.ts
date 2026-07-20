import { NextResponse } from 'next/server';
import {
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

/* @Codex */
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

/* @Codex */
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
        console.error('[MediFlow] AIFA catalog read failed:', error);
        return NextResponse.json({ error: 'Failed to read drug catalog' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File) || !file.name.toLocaleLowerCase('it-IT').endsWith('.csv')) {
            return NextResponse.json({ error: 'CSV AIFA richiesto' }, { status: 400 });
        }
        const result = await replaceAifaCatalog(file, manifestInputFromForm(form));
        return NextResponse.json(result, {
            headers: { [CATALOG_STATUS_HEADER]: result.state },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Importazione AIFA non riuscita';
        console.warn('[MediFlow] AIFA catalog import rejected:', message);
        return NextResponse.json({ error: message }, { status: 400 });
    }
}

export async function DELETE() {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();

    try {
        clearAifaCatalog();
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[MediFlow] AIFA catalog clear failed:', error);
        return NextResponse.json({ error: 'Failed to clear drug catalog' }, { status: 500 });
    }
}
