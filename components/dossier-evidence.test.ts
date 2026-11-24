import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DossierEvidenceText, splitDossierPassage } from './dossier-evidence';
import { PrivacyProvider } from './privacy-provider';
import { DOSSIER_SCHEMA_VERSION, extractDossierCandidates, splitDossierUnits, unitText, type DossierRecord } from '../lib/domain/documents/dossier-import';
import { loadPatientDossier, type DossierDocumentView, type DossierPatientView, type DossierPorts } from '../lib/document-dossier-session';
import { anchorPreparedQuote } from '../lib/domain/documents/dossier-prepared';

const { registerHooks } = nodeModule as unknown as {
    registerHooks(hooks: { load: nodeModule.LoadHook; resolve: nodeModule.ResolveHook }): { deregister(): void };
};

const before = '## Pagina 2\nIl paziente ';
const passage = 'riferisce dispnea da sforzo\nda circa due mesi';
const after = '.\nControllo programmato.';
const page = before + passage + after;
const text = '## Pagina 1\nReferto sintetico.\n' + page;
const { units } = splitDossierUnits(text, 2);
const unitTexts = new Map(units.map((unit) => [unit.index, unitText(text, unit)]));
const evidence = { unit: 2, start: before.length, end: before.length + passage.length, excerpt: 'riferisce dispnea da sforzo da circa due mesi' };

test('evidenzia il passo esatto agli offset della seconda pagina', () => {
    const anchor = anchorPreparedQuote(text, units, evidence.excerpt);
    assert.equal(anchor?.match, 'exact');
    assert.deepEqual(anchor.evidence, evidence);
    const selection = splitDossierPassage(unitTexts, anchor.evidence);
    assert.deepEqual(selection, { before, passage, after });

    const html = renderToStaticMarkup(createElement(PrivacyProvider, null,
        createElement(DossierEvidenceText, { text: page, selection })));
    assert.equal(html, `<span>${before}<mark tabindex="-1">${passage}</mark>${after}</span>`);
});

test('per una citazione approssimata evidenzia la grafia originale del documento', () => {
    const anchor = anchorPreparedQuote(text, units, 'riferisce dispnaa da sforzo da circa due mesi');
    assert.equal(anchor?.match, 'approximate');
    assert.deepEqual(splitDossierPassage(unitTexts, anchor.evidence), { before, passage, after });
});

test('un’unità assente o un intervallo invalido lascia il testo senza evidenziazione', () => {
    for (const invalid of [
        { ...evidence, unit: 3 },
        { ...evidence, start: -1 },
        { ...evidence, start: 0.5 },
        { ...evidence, end: NaN },
        { ...evidence, end: evidence.start },
        { ...evidence, end: evidence.start - 1 },
        { ...evidence, end: page.length + 1 },
    ]) {
        const selection = splitDossierPassage(unitTexts, invalid);
        assert.equal(selection, null);
        assert.equal(renderToStaticMarkup(createElement(PrivacyProvider, null,
            createElement(DossierEvidenceText, { text: page, selection }))), `<span>${page}</span>`);
    }
});


async function renderStoredDocument(source: string, updateRecord: (record: DossierRecord) => void): Promise<string> {
    const panelPath = '/components/dossier-import-panel.tsx';
    const stub = 'data:text/javascript,export%20default%20%7B%7D';
    const unrelated = new Set(['@/lib/db', '@/lib/document-dossier-ports', '@/components/security-provider',
        '@/components/patient-document-create', '@/components/dossier-backup-proposal', '@/components/kree8/kree8-workspace-shell', './patient-bulk-import-panel.module.css']);
    const hooks = registerHooks({
        resolve(specifier, context, next) {
            if (context.parentURL?.endsWith(panelPath) && unrelated.has(specifier)) return { url: stub, shortCircuit: true };
            return next(specifier, context);
        },
        load(url, context, next) {
            if (url === stub) return { format: 'commonjs', source: 'module.exports = {};', shortCircuit: true };
            const loaded = next(url, context) as Awaited<ReturnType<nodeModule.LoadHook>>;
            if (url.endsWith(panelPath)) return { ...loaded, source: String(loaded.source) + '\nexports.DossierDocument = DossierDocument;' };
            return loaded;
        },
    });
    let DossierDocument: (props: { document: DossierDocumentView; view: DossierPatientView; busy: boolean }) => ReactElement;
    try {
        ({ DossierDocument } = nodeModule.createRequire(import.meta.url)('./dossier-import-panel.tsx'));
    } finally {
        hooks.deregister();
    }

    const { units, unitBasis } = splitDossierUnits(source, 2);
    const exemptionCodes = new Set(['013', '048']);
    const { facts, classification } = extractDossierCandidates({ fileName: 'referto.pdf', text: source, units, documentDate: null, exemptionCodes });
    const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
    const record: DossierRecord = {
        schemaVersion: DOSSIER_SCHEMA_VERSION, importId: 'import-sintetico', updatedAt: '2026-01-01',
        source: { fileName: 'referto.pdf', kind: 'pdf', sha256: sha('PDF sintetico'), byteLength: 13, mediaType: 'application/pdf', relativePath: 'referto.pdf' },
        identity: { taxCodes: [], status: 'no_document_cf', confirmedAt: '2026-01-01' }, documentDate: null,
        preservation: { state: 'verified', verifiedSourceRef: 'originale', reusedExisting: false },
        extraction: { state: 'extracted', engine: 'anydoc_ocr', pageCount: 2, ocrPageCount: 2, unitBasis, units,
            text: { location: 'inline', inline: source, sha256: sha(source), chars: source.length } },
        classification, facts, residualReview: { state: 'pending' }, applied: [],
    };
    updateRecord(record);
    const patient = { id: 'scheda', firstName: 'Lunia', lastName: 'Veloria', taxCode: '', diagnoses: [], exemptions: [] };
    const attachment = { id: 'allegato', patientId: patient.id, name: 'referto.pdf', size: 13, type: 'application/pdf',
        currentness: { sourceRef: 'originale', revision: 1, freshnessEpoch: 1 },
        parseEvidenceArtifactSnapshot: JSON.stringify({ dossier: record }) };
    const ports = {
        getPatient: async () => patient,
        listAttachments: async () => [attachment],
        exemptionCodes: async () => exemptionCodes,
        sha256: async (bytes: Uint8Array) => sha(bytes),
        measureArtifact: async () => 0,
        currentRecords: async () => ({ diagnoses: [], exemptions: [], therapies: [], observations: [], entries: [], servicePrescriptions: [], prostheticPrescriptions: [] }),
    } satisfies Pick<DossierPorts, 'getPatient' | 'listAttachments' | 'exemptionCodes' | 'sha256' | 'measureArtifact' | 'currentRecords'>;
    const view = await loadPatientDossier(ports as unknown as DossierPorts, patient.id, new AbortController().signal);
    assert.equal(view?.documents.length, 1);
    const [document] = view.documents;
    assert.equal(document.textVerified, true);
    return renderToStaticMarkup(createElement(PrivacyProvider, null, createElement(DossierDocument, { document, view, busy: false })));
}

test('indici ripetuti nel record riletto conservano entrambe le pagine e bloccano il passo ambiguo', async () => {
    const html = await renderStoredDocument('## Pagina 1\nEsenzione 013\n## Pagina 2\nEsenzione 013', (record) => {
        assert.equal(record.extraction.state, 'extracted');
        record.extraction.units[1].index = 1;
        for (const fact of record.facts) {
            if (fact.evidence) fact.evidence.excerpt = '013';
        }
    });
    assert.match(html, /## Pagina 1\nEsenzione 013/u);
    assert.match(html, /## Pagina 2\nEsenzione 013/u);
    assert.doesNotMatch(html, /Mostra nel testo/u);
});

test('il pannello mostra il pulsante solo quando il passo coincide con l’estratto', async () => {
    const html = await renderStoredDocument('## Pagina 1\nEsenzione 013\n## Pagina 2\nEsenzione 048', (record) => {
        const first = record.facts.find((fact) => fact.values.code === '013');
        const second = record.facts.find((fact) => fact.values.code === '048');
        assert.ok(first?.evidence && second?.evidence);
        first.evidence.excerpt = '048';
        second.evidence.excerpt = '  048\t';
    });
    assert.equal((html.match(/Mostra nel testo/gu) ?? []).length, 1);
    assert.doesNotMatch(html.split('</tr>').find((row) => row.includes('value="013"')) ?? '', /Mostra nel testo/u);
    assert.match(html.split('</tr>').find((row) => row.includes('value="048"')) ?? '', /Mostra nel testo/u);
});


test('un vecchio estratto di laboratorio calcolato sul passo sbagliato non offre l’evidenziazione', async () => {
    const glucose = 'Glucosio 110 mg/dL 70-99 H';
    const secondPage = ['## Pagina 2', 'Città 🧪', 'Riga α', 'Riga β', glucose, 'Creatinina 0,9 mg/dL 0,6-1,2'].join('\r\n');
    const html = await renderStoredDocument('## Pagina 1\r\nCopertina\r\n' + secondPage, (record) => {
        const glucoseFact = record.facts.find((fact) => fact.values.display === 'Glucosio');
        assert.ok(glucoseFact?.evidence);
        const start = secondPage.replace(/\r/gu, '').indexOf(glucose);
        const end = start + glucose.length;
        glucoseFact.evidence = { unit: 2, start, end, excerpt: secondPage.slice(start, end).trim() };
    });
    assert.equal((html.match(/Mostra nel testo/gu) ?? []).length, 1);
    assert.doesNotMatch(html.split('</tr>').find((row) => row.includes('value="Glucosio"')) ?? '', /Mostra nel testo/u);
    assert.match(html.split('</tr>').find((row) => row.includes('value="Creatinina"')) ?? '', /Mostra nel testo/u);
});
