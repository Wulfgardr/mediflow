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
const DRUG_DOSAGE_OR_FORM_REGEX = /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|ui|u|cp|cps|cpr|caps(?:ule)?|compress(?:a|e)|gtt|fial(?:a|e)|spruzzi?)\b|\b(?:farmaco|farmaci|principio\s+attivo|posologia|compress(?:a|e)|capsul(?:a|e)|gocce|fial(?:a|e)|aifa|aic|atc|terapia\s+farmacologica)\b/i;

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
export function isServicePrescriptionLikeTherapy(candidate: PrescriptionBoundaryCandidate): boolean {
    const identityText = [
        candidate.drugMention,
        candidate.drugQuery,
        candidate.activePrinciple,
    ].filter(Boolean).join(' ');
    const fullText = [
        identityText,
        candidate.dosage,
        candidate.motivation,
        candidate.reviewNote,
        candidate.evidence,
    ].filter(Boolean).join(' ');

    if (!fullText.trim()) return false;

    const normalizedIdentity = normalizeText(identityText);
    const identityLooksService = SERVICE_IDENTITY_REGEX.test(identityText)
        || /\bvisita\b|\bprestazione\b|\besame\b|\bconsulenza\b/.test(normalizedIdentity);
    if (identityLooksService) return true;

    const identityOrDosageText = [
        identityText,
        candidate.dosage,
    ].filter(Boolean).join(' ');
    if (DRUG_DOSAGE_OR_FORM_REGEX.test(identityOrDosageText)) return false;

    return false;
}

/* @Codex */
export function filterServicePrescriptionTherapyCandidates<TCandidate extends PrescriptionBoundaryCandidate>(
    candidates: TCandidate[],
): TCandidate[] {
    return candidates.filter((candidate) => !isServicePrescriptionLikeTherapy(candidate));
}
