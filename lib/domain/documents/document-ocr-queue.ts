export const DOCUMENT_OCR_QUEUE_STATES = [
    'pending',
    'processing',
    'ocr_done',
    'ocr_failed',
    'manual_review',
] as const;

export type DocumentOcrQueueState = (typeof DOCUMENT_OCR_QUEUE_STATES)[number];

export const DOCUMENT_OCR_QUEUE_REASONS = [
    'text_layer_absent',
    'text_too_short',
    'image_or_scan',
    'corrupted_pdf',
    'password_protected',
    'parser_failed',
    'resource_limit',
    /* @Codex: WUL-194 W5 S1, paired client upload entering the OCR queue. */
    'paired_upload',
] as const;

export type HostDocumentOcrQueueReason = (typeof DOCUMENT_OCR_QUEUE_REASONS)[number];

export type DocumentOcrQueueReason = Exclude<
    HostDocumentOcrQueueReason,
    'parser_failed' | 'resource_limit'
>;

export type DocumentOcrQueueFailureReason = Extract<
    HostDocumentOcrQueueReason,
    'corrupted_pdf' | 'password_protected' | 'parser_failed' | 'resource_limit'
>;

/**
 * Allineato alla soglia low-signal della evidence queue (MIN_SIGNAL_CHARS in
 * evidence-queue-contract): sotto questa soglia il testo non abilita
 * classificazione ne proposte cliniche.
 */
export const DOCUMENT_OCR_QUEUE_MIN_USABLE_TEXT_CHARS = 24;

export const DOCUMENT_OCR_QUEUE_STATE_LABELS_IT: Record<DocumentOcrQueueState, string> = {
    pending: 'in attesa',
    processing: 'in elaborazione',
    ocr_done: 'OCR completato',
    ocr_failed: 'OCR fallito',
    manual_review: 'revisione manuale',
};

export const DOCUMENT_OCR_QUEUE_REASON_LABELS_IT: Record<HostDocumentOcrQueueReason, string> = {
    text_layer_absent: 'testo assente',
    text_too_short: 'testo insufficiente',
    image_or_scan: 'immagine/scansione',
    corrupted_pdf: 'PDF corrotto',
    password_protected: 'PDF protetto da password',
    parser_failed: 'ispezione PDF fallita',
    resource_limit: 'limite locale PDF superato',
    paired_upload: 'caricato da client di rete',
};

export function isDocumentOcrQueueState(value: unknown): value is DocumentOcrQueueState {
    return typeof value === 'string' && (DOCUMENT_OCR_QUEUE_STATES as readonly string[]).includes(value);
}

export function isDocumentOcrQueueReason(value: unknown): value is HostDocumentOcrQueueReason {
    return typeof value === 'string' && (DOCUMENT_OCR_QUEUE_REASONS as readonly string[]).includes(value);
}

export function describeDocumentOcrQueueEntry(state: string, reason?: string | null): string {
    const stateLabel = isDocumentOcrQueueState(state) ? DOCUMENT_OCR_QUEUE_STATE_LABELS_IT[state] : state;
    const reasonLabel = isDocumentOcrQueueReason(reason) ? DOCUMENT_OCR_QUEUE_REASON_LABELS_IT[reason] : reason;
    return reasonLabel ? `${stateLabel} · ${reasonLabel}` : stateLabel;
}

/**
 * Euristica low-signal condivisa con la pipeline OCR (extractUsableOcrText in
 * pdf-service): scarta output OCR composti da rumore o token ripetuti.
 */
export function looksLikeLowSignalOcrText(value: string): boolean {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact) return true;

    const alphaChars = compact.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g)?.length || 0;
    if (compact.length >= 24 && alphaChars < 12) return true;
    if (/^(?:\d+\.){10,}\d*$/u.test(compact.replace(/\s+/g, ''))) return true;

    const tokens = compact.split(/\s+/).filter(Boolean);
    const uniqueTokens = new Set(tokens.map((token) => token.toLowerCase()));
    return tokens.length >= 12 && uniqueTokens.size <= 2;
}

/**
 * Un documento ha testo sufficiente per classificazione/estrazione solo se il
 * testo compatto supera la soglia minima e non è rumore OCR a basso segnale.
 */
export function hasUsableDocumentOcrText(value: string): boolean {
    const compact = value.replace(/\s+/g, ' ').trim();
    return compact.length >= DOCUMENT_OCR_QUEUE_MIN_USABLE_TEXT_CHARS && !looksLikeLowSignalOcrText(value);
}

export interface DocumentOcrQueueCandidateInput {
    inputKind: 'pdf' | 'image';
    extractedText: string;
    extractionFailure?: DocumentOcrQueueFailureReason;
}

export type DocumentOcrQueueCandidate =
    | { queued: false }
    | { queued: true; state: 'pending'; reason: HostDocumentOcrQueueReason };

export function evaluateDocumentOcrQueueCandidate(input: DocumentOcrQueueCandidateInput): DocumentOcrQueueCandidate {
    if (input.extractionFailure) {
        return { queued: true, state: 'pending', reason: input.extractionFailure };
    }

    if (hasUsableDocumentOcrText(input.extractedText)) {
        return { queued: false };
    }

    if (input.inputKind === 'image') {
        return { queued: true, state: 'pending', reason: 'image_or_scan' };
    }

    const compact = input.extractedText.replace(/\s+/g, ' ').trim();
    return { queued: true, state: 'pending', reason: compact ? 'text_too_short' : 'text_layer_absent' };
}

const DOCUMENT_OCR_QUEUE_TRANSITIONS: Record<DocumentOcrQueueState, readonly DocumentOcrQueueState[]> = {
    pending: ['processing', 'manual_review'],
    processing: ['ocr_done', 'ocr_failed'],
    ocr_done: [],
    ocr_failed: ['processing', 'manual_review'],
    manual_review: ['processing'],
};

export function canTransitionDocumentOcrQueueState(from: DocumentOcrQueueState, to: DocumentOcrQueueState): boolean {
    if (from === to) return true;
    return DOCUMENT_OCR_QUEUE_TRANSITIONS[from].includes(to);
}
