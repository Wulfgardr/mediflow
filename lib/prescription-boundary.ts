/* @Codex */
export interface PrescriptionBoundaryCandidate {
    drugMention?: string;
    drugQuery?: string;
    activePrinciple?: string;
    dosage?: string;
    motivation?: string;
    reviewNote?: string;
    evidence?: string;
}

/* @Codex */
const SERVICE_IDENTITY_REGEX = /\b(?:visita|prestazion(?:e|i)|specialistic(?:a|he|o|i)|consulenza|consulto|controllo\s+specialistic(?:o|a)|esame|accertamento|prelievo|ecografia|eco(?:grafia|color\s*doppler|colordoppler|doppler)?|color\s*doppler|colordoppler|doppler|radiografia|rx|tc|tac|rm|risonanza|ecg|elettrocardiogramma|spirometria|otorinolaringoiatric(?:a|o|he|i)|orl|cardiologic(?:a|o|he|i)|endocrinologic(?:a|o|he|i)|neurologic(?:a|o|he|i)|dermatologic(?:a|o|he|i)|oculistic(?:a|o|he|i)|fisiatric(?:a|o|he|i)|ortopedic(?:a|o|he|i)|gastroenterologic(?:a|o|he|i)|urologic(?:a|o|he|i)|pneumologic(?:a|o|he|i)|angiologic(?:a|o|he|i)|vascolar(?:e|i)|fisioterapi(?:a|e|co|ca|ci|che)|riabilitazion(?:e|i)|riabilitativ(?:a|o|he|i)|emocromo|hba1c|emoglobina\s+glic(?:ata|osilata))\b/i;

/* @Codex */
function normalizeText(value: string | undefined): string {
    return (value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/* @Codex */
// La decisione dipende solo dall'identità del candidato: `drugMention`, `drugQuery` e
// `activePrinciple`. `dosage`, `motivation`, `reviewNote` ed `evidence` sono dichiarati
// da `PrescriptionBoundaryCandidate` ma non influenzano il risultato.
//
// Non è una semplificazione introdotta qui: lo era già alla prima comparsa del file
// (`1804b698c`, export OSS 0.7). La coda della funzione — un marker prescrittivo e un
// controllo su dosaggio e forma farmaceutica — era irraggiungibile per costruzione,
// perché arrivarci richiedeva `SERVICE_IDENTITY_REGEX` falso mentre entrambi i rami
// residui la richiedevano vera o tornavano comunque `false`. Rimossa in due passi
// (`5de97b5fe` e questo commit); recuperabile da git se servisse.
//
// Resta aperta una domanda di contratto che questo commit **non** decide, perché la
// storia del file non conserva l'intento: se una terapia con posologia esplicita debba
// restare un farmaco anche quando l'identità cita una prestazione (`Visita di controllo
// 500 mg`), il controllo sul dosaggio andrebbe *prima* della classificazione, non dopo.
// Oggi non lo è, e spostarlo cambierebbe il comportamento di un confine clinico: serve
// una decisione, non un'inferenza.
export function isServicePrescriptionLikeTherapy(candidate: PrescriptionBoundaryCandidate): boolean {
    const identityText = [
        candidate.drugMention,
        candidate.drugQuery,
        candidate.activePrinciple,
    ].filter(Boolean).join(' ');

    return SERVICE_IDENTITY_REGEX.test(identityText)
        || /\bvisita\b|\bprestazione\b|\besame\b|\bconsulenza\b/.test(normalizeText(identityText));
}

/* @Codex */
export function filterServicePrescriptionTherapyCandidates<TCandidate extends PrescriptionBoundaryCandidate>(
    candidates: TCandidate[],
): TCandidate[] {
    return candidates.filter((candidate) => !isServicePrescriptionLikeTherapy(candidate));
}
