/* @Codex */
'use client';

import type { ComponentType } from 'react';
import { FileText } from 'lucide-react';
import type { ExtractedPatientData } from '@/lib/pdf-service';
import disclosure from '@/components/patient-disclosure.module.css';

interface PdfImporterProps {
    onDataExtracted: (data: ExtractedPatientData) => void;
}

/** The existing pre-record interface has no persisted patient/source identity.
 * Keep its signature for callers, but do not offer a file chooser that discards
 * the selection or imply that an attachment was saved. No callback is invoked. */
function PdfImporterUnavailable() {
    return (
        <aside className="mb-8" aria-label="Documenti prima del salvataggio">
            <h3 className="flex items-center gap-2 font-semibold text-[color:var(--lume-ink)]">
                <FileText className="h-5 w-5" aria-hidden="true" /> Aggiungi documenti dopo il salvataggio
            </h3>
            <p className={disclosure.hint}>
                Salva prima il paziente. Nella sua scheda apri Documenti e usa Carica documenti;
                potrai poi aprire gli allegati, estrarre il testo localmente e richiedere una sintesi con conferma esplicita.
            </p>
            <p className={disclosure.hint}>Qui non viene selezionato, conservato o elaborato alcun file.</p>
            <details className={disclosure.disclosure}>
                <summary>Perché il caricamento avviene nella scheda</summary>
                <p className={disclosure.hint}>Anche un PDF con testo nativo deve essere salvato come allegato prima dell’estrazione. Immagini e scansioni restano soggette a revisione manuale.</p>
                <p className={disclosure.hint}>review_required · unsupported_local_extraction: nessuna fonte persistita è disponibile in questo passaggio.</p>
            </details>
        </aside>
    );
}

const PdfImporter: ComponentType<PdfImporterProps> = PdfImporterUnavailable;
export default PdfImporter;
