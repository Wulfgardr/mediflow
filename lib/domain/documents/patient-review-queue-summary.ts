/* WUL-262 review-queue summary for patient detail.
   Pure view model: aggregates EXISTING panel statuses (Patient Insight,
   evidence stack, Smart Import, document archive) into compact review-first
   rows. No persistence, no pipeline, no automatic clinical write. */

/* Structurally identical to DocumentQualityLevel in lib/db.ts; declared locally
   so the view model (and its unit test) stays free of the Dexie module graph. */
export type ReviewQueueQualityLevel = 'green' | 'yellow' | 'red';

export type ReviewQueueRowId = 'insight' | 'evidence' | 'smart-import' | 'archive';

export type ReviewQueueRowState =
    | 'da-rivedere'
    | 'bloccato'
    | 'serve-testo'
    | 'pronto-da-applicare'
    | 'gia-applicato'
    | 'disponibile'
    | 'vuoto';

export interface PatientReviewQueueRow {
    id: ReviewQueueRowId;
    panelLabel: string;
    state: ReviewQueueRowState;
    stateLabel: string;
    detail: string;
    /* Visible WHY when the system refuses to write anything by itself. */
    blockedReason?: string;
    /* Anchor of the existing panel; undefined when the panel is not rendered. */
    anchor?: string;
    actionLabel: string;
}

export interface PatientReviewQueueSummary {
    rows: PatientReviewQueueRow[];
    /* Rows that ask the clinician for an action right now. */
    attentionCount: number;
}

export interface SmartImportReviewSnapshot {
    hasAnalysis: boolean;
    reviewable: number;
    blocked: number;
    ready: number;
}

export interface ReviewQueueEvidenceItem {
    qualityLevel?: ReviewQueueQualityLevel;
    appliedDiagnosesCount: number;
}

export interface PatientReviewQueueInput {
    insight: {
        enabled: boolean;
        hasSummary: boolean;
        /* Insight presente ma piu vecchio dell'ultimo dato clinico. */
        stale?: boolean;
        /* Insight salvato ma non leggibile dal pannello (es. envelope JSON grezzo).
           Se false quando hasSummary e true, queue e pannello concordano. */
        readable?: boolean;
    };
    evidence: ReviewQueueEvidenceItem[];
    smartImport: {
        enabled: boolean;
        sourceCount: number;
        analysis?: SmartImportReviewSnapshot;
    };
    archive: {
        attachmentsCount: number;
        missingTextCount: number;
    };
}

export const REVIEW_QUEUE_STATE_LABELS: Record<ReviewQueueRowState, string> = {
    'da-rivedere': 'Da rivedere',
    'bloccato': 'Bloccato',
    'serve-testo': 'Serve testo',
    'pronto-da-applicare': 'Pronto da applicare',
    'gia-applicato': 'Già applicato',
    'disponibile': 'Disponibile',
    'vuoto': 'Niente in coda',
};

const ATTENTION_STATES: ReadonlySet<ReviewQueueRowState> = new Set([
    'da-rivedere',
    'bloccato',
    'serve-testo',
    'pronto-da-applicare',
]);

const OPEN_PANEL_LABEL = 'Apri pannello';
const PANEL_UNAVAILABLE_LABEL = 'Pannello non visibile';
/* @Codex */
const DOCUMENTS_PANEL_ANCHOR = '#documenti';

function row(
    id: ReviewQueueRowId,
    panelLabel: string,
    state: ReviewQueueRowState,
    detail: string,
    options: { anchor?: string; blockedReason?: string } = {},
): PatientReviewQueueRow {
    return {
        id,
        panelLabel,
        state,
        stateLabel: REVIEW_QUEUE_STATE_LABELS[state],
        detail,
        blockedReason: options.blockedReason,
        anchor: options.anchor,
        actionLabel: options.anchor ? OPEN_PANEL_LABEL : PANEL_UNAVAILABLE_LABEL,
    };
}

function buildInsightRow(input: PatientReviewQueueInput['insight']): PatientReviewQueueRow {
    const anchor = DOCUMENTS_PANEL_ANCHOR;

    if (!input.enabled) {
        return row(
            'insight',
            'Patient Insight',
            'bloccato',
            input.hasSummary
                ? "L'ultimo insight salvato resta consultabile, ma la rigenerazione è ferma."
                : 'Nessun insight salvato e generazione ferma.',
            {
                anchor,
                blockedReason:
                    "Interruttore AI locale spento: il sistema non genera né scrive nulla finché non lo riattivi in Impostazioni.",
            },
        );
    }

    if (!input.hasSummary) {
        return row(
            'insight',
            'Patient Insight',
            'vuoto',
            'Nessun insight generato: si avvia solo manualmente dal pannello.',
            { anchor },
        );
    }

    if (input.readable === false) {
        return row(
            'insight',
            'Patient Insight',
            'da-rivedere',
            'Insight salvato non leggibile: rigeneralo dal pannello.',
            { anchor },
        );
    }

    if (input.stale) {
        return row(
            'insight',
            'Patient Insight',
            'da-rivedere',
            'Insight non aggiornato: dati clinici modificati dopo la generazione. Rigeneralo dal pannello.',
            { anchor },
        );
    }

    return row(
        'insight',
        'Patient Insight',
        'disponibile',
        'Ultimo insight salvato pronto alla lettura nel pannello.',
        { anchor },
    );
}

function buildEvidenceRow(evidence: ReviewQueueEvidenceItem[]): PatientReviewQueueRow {
    const anchor = DOCUMENTS_PANEL_ANCHOR;
    const total = evidence.length;

    if (total === 0) {
        return row(
            'evidence',
            'Evidenze documentali',
            'vuoto',
            'Nessun referto analizzato: i nuovi documenti compariranno qui.',
            { anchor },
        );
    }

    const criticalCount = evidence.filter((item) => item.qualityLevel === 'red').length;
    const toReviewCount = evidence.filter((item) => item.qualityLevel !== 'green').length;
    const appliedDiagnoses = evidence.reduce((sum, item) => sum + item.appliedDiagnosesCount, 0);

    if (toReviewCount > 0) {
        const criticalNote = criticalCount > 0 ? ` (${criticalCount} con qualità critica)` : '';
        return row(
            'evidence',
            'Evidenze documentali',
            'da-rivedere',
            `${toReviewCount} referti su ${total} ancora in revisione${criticalNote}.`,
            { anchor },
        );
    }

    if (appliedDiagnoses > 0) {
        return row(
            'evidence',
            'Evidenze documentali',
            'gia-applicato',
            `${total} referti verificati · ${appliedDiagnoses} diagnosi già applicate alla scheda.`,
            { anchor },
        );
    }

    return row(
        'evidence',
        'Evidenze documentali',
        'disponibile',
        `${total} referti verificati, nessuna revisione in sospeso.`,
        { anchor },
    );
}

function buildSmartImportRow(input: PatientReviewQueueInput['smartImport']): PatientReviewQueueRow {
    const anchor = DOCUMENTS_PANEL_ANCHOR;

    if (input.sourceCount === 0) {
        return row(
            'smart-import',
            'Smart Import',
            'serve-testo',
            'Nessuna fonte testuale utilizzabile: aggiungi note, voci di diario o documenti con testo.',
        );
    }

    if (!input.enabled) {
        return row(
            'smart-import',
            'Smart Import',
            'bloccato',
            `${input.sourceCount} fonti presenti, ma analisi e applicazione sono ferme.`,
            {
                anchor,
                blockedReason:
                    'Smart Import è disattivato localmente: nessuna analisi parte e nessun suggerimento viene scritto in scheda.',
            },
        );
    }

    if (!input.analysis || !input.analysis.hasAnalysis) {
        return row(
            'smart-import',
            'Smart Import',
            'disponibile',
            `${input.sourceCount} fonti pronte: l'analisi parte solo su richiesta dal pannello.`,
            { anchor },
        );
    }

    const { reviewable, blocked, ready } = input.analysis;
    const blockedReason = blocked > 0
        ? 'I suggerimenti bloccati non coincidono con il profilo attuale: il sistema non li scrive senza correzione manuale.'
        : undefined;

    if (ready > 0) {
        return row(
            'smart-import',
            'Smart Import',
            'pronto-da-applicare',
            `${ready} suggerimenti selezionati · ${reviewable} da rivedere · ${blocked} bloccati.`,
            { anchor, blockedReason },
        );
    }

    if (reviewable > 0) {
        return row(
            'smart-import',
            'Smart Import',
            'da-rivedere',
            `${reviewable} suggerimenti da confermare · ${blocked} bloccati.`,
            { anchor, blockedReason },
        );
    }

    if (blocked > 0) {
        return row(
            'smart-import',
            'Smart Import',
            'bloccato',
            `${blocked} suggerimenti bloccati: correggili o scartali dal pannello.`,
            { anchor, blockedReason },
        );
    }

    return row(
        'smart-import',
        'Smart Import',
        'gia-applicato',
        'Nessun suggerimento residuo da rivedere.',
        { anchor },
    );
}

function buildArchiveRow(input: PatientReviewQueueInput['archive']): PatientReviewQueueRow {
    const anchor = DOCUMENTS_PANEL_ANCHOR;

    if (input.attachmentsCount === 0) {
        return row(
            'archive',
            'Archivio documenti',
            'vuoto',
            'Nessun allegato in archivio per questo paziente.',
            { anchor },
        );
    }

    if (input.missingTextCount > 0) {
        return row(
            'archive',
            'Archivio documenti',
            'serve-testo',
            `${input.missingTextCount} allegati su ${input.attachmentsCount} senza testo estratto: OCR o sintesi da completare.`,
            { anchor },
        );
    }

    return row(
        'archive',
        'Archivio documenti',
        'disponibile',
        `${input.attachmentsCount} allegati con testo disponibile per revisione e analisi.`,
        { anchor },
    );
}

export function buildPatientReviewQueueSummary(input: PatientReviewQueueInput): PatientReviewQueueSummary {
    const rows = [
        buildInsightRow(input.insight),
        buildEvidenceRow(input.evidence),
        buildSmartImportRow(input.smartImport),
        buildArchiveRow(input.archive),
    ];

    return {
        rows,
        attentionCount: rows.filter((item) => ATTENTION_STATES.has(item.state)).length,
    };
}
