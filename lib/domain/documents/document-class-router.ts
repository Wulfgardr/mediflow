/**
 * Router deterministico di classe documentale, pre-LLM.
 *
 * Il corpus reale mostra che la maggioranza dei documenti e classificabile senza
 * modello combinando tre segnali a costo zero: il token di classe nel nome file
 * (schema DATA__classe__descrizione, presente nel ~71% dei file), il metadato PDF
 * Producer/Creator (fortemente correlato alla classe emittente) e la testata nel
 * primo testo. Questo modulo NON chiama alcun LLM e non dipende da servizi esterni
 * (coerente con il principio in-house-first): produce una classificazione con
 * confidence motivata, da usare come segnale prima della sintesi.
 *
 * Le tabelle sono dati configurabili (non if hardcoded) proprio perche i producer
 * e le testate del corpus sono lombardi: vanno estese, non trattate come verita.
 */

import type {
    DocumentDecisionClassification,
    DocumentDecisionConfidence,
} from './document-decision';

export interface DocumentClassRouterInput {
    fileName?: string;
    /** Metadato PDF `Producer` (pdf.getMetadata().info.Producer). */
    producer?: string;
    /** Metadato PDF `Creator`. */
    creator?: string;
    /** Primi ~2000 caratteri del text layer, per testata ed euristiche. */
    textSample?: string;
}

export interface DocumentClassRouterResult {
    classification: DocumentDecisionClassification;
    confidence: DocumentDecisionConfidence;
    /** Data documento estratta dal nome file (ISO), se presente. */
    documentDate?: string;
    /** Producer riconosciuto come fase di post-processing: classe dal contenuto. */
    postProcessed: boolean;
    /** Segnali che hanno contribuito, per audit e debug. */
    signals: string[];
    rationale: string;
}

/**
 * Classi con struttura abbastanza certa da usare la sintesi di fallback senza
 * invocare il modello, ma solo quando il router ha confidence `high`.
 */
export const DETERMINISTIC_SYNTHESIS_CLASSES: ReadonlySet<DocumentDecisionClassification> = new Set([
    // Referti di laboratorio: ammessi solo con testata riconosciuta e testo utile.
    'lab_report',
]);

export function isDeterministicSynthesisRoute(
    routed: Pick<DocumentClassRouterResult, 'classification' | 'confidence' | 'signals'>,
    normalizedText: string,
): boolean {
    const hasUsableText = normalizedText.trim().length >= 80;
    const hasContentSignal = routed.signals.some((signal) => signal.startsWith('content:'));
    return routed.confidence === 'high'
        && hasUsableText
        && hasContentSignal
        && DETERMINISTIC_SYNTHESIS_CLASSES.has(routed.classification);
}

// Vocabolario controllato del campo classe nel nome file -> classificazione.
// Alcuni token (ricetta, promemoria) sono intrinsecamente ambigui tra farmaco e
// prestazione: mappati alla classe piu probabile ma con confidence contenuta.
const FILENAME_CLASS_MAP: Record<string, { classification: DocumentDecisionClassification; confident: boolean }> = {
    ricetta: { classification: 'medication_prescription', confident: false },
    prescrizione_medica: { classification: 'medication_prescription', confident: true },
    promemoria: { classification: 'specialist_service_prescription', confident: false },
    referto: { classification: 'specialist_report', confident: false },
    laboratorio: { classification: 'lab_report', confident: true },
    imaging: { classification: 'imaging_report', confident: true },
    verbale_ps: { classification: 'specialist_report', confident: true },
    lettera_dimissione: { classification: 'specialist_report', confident: true },
    relazione_clinica: { classification: 'specialist_report', confident: true },
    cartella_clinica: { classification: 'specialist_report', confident: true },
    visita_specialistica: { classification: 'specialist_report', confident: true },
    visita: { classification: 'specialist_report', confident: false },
    protesica: { classification: 'prosthetic_prescription', confident: true },
    certificato_malattia: { classification: 'administrative', confident: true },
    certificato_medico_introduttivo: { classification: 'administrative', confident: true },
    invalidita_civile: { classification: 'administrative', confident: true },
    refertocittadino: { classification: 'specialist_report', confident: false },
    modulo: { classification: 'unknown', confident: false },
};

// Producer/Creator -> classe. Tabella lombarda, estendibile.
const PRODUCER_PATTERNS: Array<{ pattern: RegExp; classification: DocumentDecisionClassification; confident: boolean; note: string }> = [
    { pattern: /apache\s*fop/i, classification: 'medication_prescription', confident: false, note: 'Apache FOP = ricetta/promemoria SSN (farmaco o prestazione, ambiguo)' },
    { pattern: /livecycle|experience\s*manager|adobe\s*aem|aem\b/i, classification: 'administrative', confident: false, note: 'AEM/LiveCycle = modulo INPS (invalidita)' },
    { pattern: /jasper/i, classification: 'lab_report', confident: false, note: 'JasperReports = referti lab/ospedalieri' },
    { pattern: /openpdf/i, classification: 'specialist_report', confident: false, note: 'OpenPDF = lettera di dimissione' },
];

// Producer di scansione: il documento e verosimilmente muto/immagine.
const SCAN_PRODUCER_PATTERN = /img2pdf|xerox|altalink|ricoh|brother|quartz|scanner|kyocera|canon/i;

// Producer di post-processing: la classe NON deriva dal producer ma dal contenuto.
const POST_PROCESSING_PRODUCER_PATTERN = /pdf-lib|pypdf|ilovepdf|ghostscript|pdftk|itext(?!.*fop)/i;

// Testate/keyword di contenuto come tie-breaker (bassa priorita).
const CONTENT_PATTERNS: Array<{ pattern: RegExp; classification: DocumentDecisionClassification }> = [
    { pattern: /quesito\s+diagnostico|nre\b|numero\s+ricetta\s+elettronica|promemoria\s+per\s+l['e]assistito/i, classification: 'specialist_service_prescription' },
    { pattern: /limiti\s+di\s+riferimento|ematologia|referto\s+di\s+laboratorio|determinazione\s+risultato/i, classification: 'lab_report' },
    { pattern: /lettera\s+di\s+dimissione|diagnosi\s+alla\s+dimissione|reparto\s+di\s+degenza/i, classification: 'specialist_report' },
    { pattern: /verbale\s+di\s+pronto\s+soccorso|triage|codice\s+(?:bianco|verde|giallo|rosso)/i, classification: 'specialist_report' },
    { pattern: /codice\s+iso|prescrizione\s+protesica|ausili\s+e\s+presidi/i, classification: 'prosthetic_prescription' },
    { pattern: /carta\s+d['e]identita|documento\s+di\s+riconoscimento/i, classification: 'identity_document' },
    { pattern: /certificato\s+di\s+malattia|prognosi\s+di\s+giorni/i, classification: 'administrative' },
];

const FILENAME_DATE_REGEX = /(\d{4})-(\d{2})-(\d{2})/;
const PROVENANCE_MARKERS = ['signed', 'firmato', 'non_firmato', 'compressed', 'pag'];

function normalizeFilenameToken(token: string): string {
    return token.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Estrae data ISO, token di classe e marcatori dal nome file (schema a 3 campi). */
export function parseFileNameHints(fileName: string | undefined): {
    documentDate?: string;
    classToken?: string;
    provenance: string[];
} {
    if (!fileName) return { provenance: [] };
    const base = fileName.replace(/\.[a-z0-9]+$/i, '');
    const lower = base.toLowerCase();

    let documentDate: string | undefined;
    const dateMatch = base.match(FILENAME_DATE_REGEX);
    if (dateMatch) {
        const [, year, month, day] = dateMatch;
        const monthNum = Number.parseInt(month, 10);
        const dayNum = Number.parseInt(day, 10);
        if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
            documentDate = `${year}-${month}-${day}`;
        }
    }

    // Campo classe: secondo segmento dello schema DATA__classe__descrizione, o il
    // primo segmento non-data nel naming legacy a underscore singolo.
    let classToken: string | undefined;
    if (base.includes('__')) {
        const parts = base.split('__');
        const candidate = parts[1] ? normalizeFilenameToken(parts[1]) : undefined;
        if (candidate && FILENAME_CLASS_MAP[candidate]) classToken = candidate;
    }
    if (!classToken) {
        for (const token of Object.keys(FILENAME_CLASS_MAP)) {
            if (lower.includes(token)) {
                classToken = token;
                break;
            }
        }
    }

    const provenance = PROVENANCE_MARKERS.filter((marker) => lower.includes(marker));
    return { documentDate, classToken, provenance };
}

/**
 * Classifica un documento combinando nome file, producer e testata. Deterministico,
 * nessun LLM. Restituisce sempre un risultato; su segnali deboli o assenti torna
 * 'unknown' con confidence 'low' (i guardrail a valle declassano comunque).
 */
export function routeDocumentClass(input: DocumentClassRouterInput): DocumentClassRouterResult {
    const signals: string[] = [];
    const producerText = `${input.producer ?? ''} ${input.creator ?? ''}`.trim();
    const fileHints = parseFileNameHints(input.fileName);

    const postProcessed = POST_PROCESSING_PRODUCER_PATTERN.test(producerText);
    if (postProcessed) signals.push('producer:post-processing');

    // 1) Token di classe nel nome file: il segnale piu affidabile del corpus.
    if (fileHints.classToken) {
        const mapped = FILENAME_CLASS_MAP[fileHints.classToken];
        signals.push(`filename:${fileHints.classToken}`);
        // Un token forte del filename vince anche sui producer di scansione.
        if (mapped.confident) {
            const contentMatch = matchContent(input.textSample);
            if (contentMatch && contentMatch.classification === mapped.classification) {
                signals.push(`content:${contentMatch.pattern}`);
            }
            return finalize(mapped.classification, 'high', fileHints, postProcessed, signals,
                `Token di classe "${fileHints.classToken}" nel nome file.`);
        }
        // Token ambiguo: prova a rinforzare col contenuto prima di decidere.
        const contentMatch = matchContent(input.textSample);
        if (contentMatch && contentMatch.classification === mapped.classification) {
            signals.push(`content:${contentMatch.pattern}`);
            return finalize(mapped.classification, 'high', fileHints, postProcessed, signals,
                `Token "${fileHints.classToken}" confermato dalla testata.`);
        }
        if (contentMatch) {
            signals.push(`content:${contentMatch.pattern}`);
            return finalize(contentMatch.classification, 'medium', fileHints, postProcessed, signals,
                `Token "${fileHints.classToken}" ambiguo, contenuto indica altra classe.`);
        }
        return finalize(mapped.classification, 'medium', fileHints, postProcessed, signals,
            `Token di classe "${fileHints.classToken}" (ambiguo, non confermato dal contenuto).`);
    }

    // 2) Producer di scansione: probabile documento muto (salvo post-processing).
    if (!postProcessed && SCAN_PRODUCER_PATTERN.test(producerText)) {
        signals.push('producer:scan');
        // Se c'e comunque testo con testata riconoscibile, usalo.
        const contentMatch = matchContent(input.textSample);
        if (contentMatch) {
            signals.push(`content:${contentMatch.pattern}`);
            return finalize(contentMatch.classification, 'medium', fileHints, postProcessed, signals,
                'Producer di scansione ma testata leggibile nel testo.');
        }
        return finalize('mute_or_scanned', 'medium', fileHints, postProcessed, signals,
            'Producer di scansione senza testata leggibile.');
    }

    // 3) Producer noto (non post-processing).
    if (!postProcessed) {
        for (const entry of PRODUCER_PATTERNS) {
            if (entry.pattern.test(producerText)) {
                signals.push('producer:known');
                const contentMatch = matchContent(input.textSample);
                if (contentMatch) {
                    signals.push(`content:${contentMatch.pattern}`);
                    return finalize(contentMatch.classification, 'medium', fileHints, postProcessed, signals,
                        `${entry.note}; classe rifinita dal contenuto.`);
                }
                return finalize(entry.classification, entry.confident ? 'medium' : 'low', fileHints, postProcessed, signals, entry.note);
            }
        }
    }

    // 4) Solo contenuto.
    const contentMatch = matchContent(input.textSample);
    if (contentMatch) {
        signals.push(`content:${contentMatch.pattern}`);
        return finalize(contentMatch.classification, 'medium', fileHints, postProcessed, signals,
            'Classe dedotta dalla testata del testo.');
    }

    return finalize('unknown', 'low', fileHints, postProcessed, signals,
        'Nessun segnale affidabile: classe da determinare in review.');
}

function matchContent(textSample: string | undefined): { classification: DocumentDecisionClassification; pattern: string } | null {
    if (!textSample) return null;
    const sample = textSample.slice(0, 2000);
    for (const entry of CONTENT_PATTERNS) {
        if (entry.pattern.test(sample)) {
            return { classification: entry.classification, pattern: entry.pattern.source.slice(0, 24) };
        }
    }
    return null;
}

function finalize(
    classification: DocumentDecisionClassification,
    confidence: DocumentDecisionConfidence,
    fileHints: { documentDate?: string; provenance: string[] },
    postProcessed: boolean,
    signals: string[],
    rationale: string,
): DocumentClassRouterResult {
    return {
        classification,
        confidence,
        documentDate: fileHints.documentDate,
        postProcessed,
        signals: [...signals, ...fileHints.provenance.map((marker) => `provenance:${marker}`)],
        rationale,
    };
}
