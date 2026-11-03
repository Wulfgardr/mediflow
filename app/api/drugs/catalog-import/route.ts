import { NextResponse } from 'next/server';
import { AifaCatalogConflictError, AifaReductionError, AifaUpdateError } from '@/lib/aifa-catalog-lock';
import { archiveReplacementResponse } from '@/lib/api-error-response';
import { DRUG_CATALOG_MAX_BYTES, DrugCatalogImportError } from '@/lib/drug-catalog-import';
import { commitDrugCatalogFile, previewDrugCatalogFile } from '@/lib/drug-catalog-server';
import { archiveWriteRequestDenial } from '@/lib/security/archive-write-request';
import { buildAuditWriteInputFromRequest } from '@/lib/security/audit';
import { requireSession, unauthorizedResponse } from '@/lib/security/server-auth';

const headers = { 'Cache-Control': 'no-store' };

function json(form: FormData, name: string): unknown {
    const value = form.get(name);
    if (typeof value !== 'string' || !value) return undefined;
    try { return JSON.parse(value); } catch { throw new DrugCatalogImportError('Richiesta non valida.'); }
}

/** Anteprima e conferma dell'importazione di un catalogo farmaci di qualunque agenzia. */
export async function POST(request: Request) {
    const session = await requireSession();
    if (!session) return unauthorizedResponse();
    const archiveDenial = archiveWriteRequestDenial(request, session);
    if (archiveDenial) return archiveDenial;
    const audit = buildAuditWriteInputFromRequest(request, session, {
        eventType: 'reference_data.drug_catalog.updated', subjectType: 'reference_data', subjectRef: 'drug-catalog' });
    try {
        const form = await request.formData();
        const file = form.get('file');
        if (!(file instanceof File) || file.size < 1 || file.size > DRUG_CATALOG_MAX_BYTES) {
            return NextResponse.json({ error: 'Carica un file CSV fino a 100 MB.' }, { status: 400, headers });
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mode = form.get('mode');
        if (mode === 'preview') return NextResponse.json(previewDrugCatalogFile(bytes, json(form, 'mapping')), { headers });
        if (mode !== 'commit') return NextResponse.json({ error: 'Operazione non valida.' }, { status: 400, headers });
        const result = commitDrugCatalogFile({
            bytes, fileName: file.name, mapping: json(form, 'mapping'), source: json(form, 'source'),
            previewSha256: form.get('previewSha256'), expectedSnapshot: form.get('expectedSnapshot'),
            confirmedReduction: form.get('reductionConfirmation') ?? undefined, confirmed: form.get('confirmed') === 'true', audit,
        });
        return NextResponse.json(result, { headers });
    } catch (error) {
        const replacement = archiveReplacementResponse(error);
        if (replacement) return replacement;
        if (error instanceof AifaReductionError) {
            return NextResponse.json({ error: error.message, code: 'DRUG_CATALOG_REDUCTION_CONFIRMATION_REQUIRED',
                confirmation: error.confirmation, previousCount: error.previousCount, nextCount: error.nextCount }, { status: 409, headers });
        }
        if (error instanceof AifaCatalogConflictError) {
            return NextResponse.json({ error: 'Il catalogo è cambiato dopo l’anteprima: ripeti l’anteprima.', code: 'DRUG_CATALOG_CHANGED' }, { status: 409, headers });
        }
        if (error instanceof DrugCatalogImportError || error instanceof AifaUpdateError) {
            return NextResponse.json({ error: error.message }, { status: error.status, headers });
        }
        console.error('[MediFlow] drug catalog import failed:', error);
        return NextResponse.json({ error: 'Importazione non riuscita; catalogo conservato.' }, { status: 500, headers });
    }
}
