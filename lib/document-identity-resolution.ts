/* @Codex */
import {
    createDocumentDecisionEvidenceRef,
    type DocumentDecisionEvidenceRef,
    type DocumentDecisionIdentity,
    type DocumentDecisionIdentityRole,
    type DocumentDecisionTaxCodeRole,
} from './document-decision';

/* @Codex */
export interface ResolveDocumentTaxCodeRolesInput {
    text: string;
    sourceId?: string;
    contextWindow?: number;
}

/* @Codex */
export interface ResolveDocumentTaxCodeRolesResult {
    evidenceRefs: DocumentDecisionEvidenceRef[];
    taxCodes: DocumentDecisionTaxCodeRole[];
    humanRequired: boolean;
    rationale: string;
}

// Case-insensitive: l'OCR restituisce spesso il CF in minuscolo. Il flag `i`
// non altera indici o lunghezza, quindi context/snippet restano allineati.
const ITALIAN_TAX_CODE_REGEX = /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi;

// Carattere di controllo del codice fiscale (algoritmo pubblico, tutto in-house).
// Le tabelle danno un valore a ciascun carattere per posizione dispari/pari
// (1-indexed) e includono le lettere di omocodia, quindi si calcola direttamente
// sui 16 caratteri come scritti, senza deconvertire l'omocodia.
const CF_ODD_VALUES: Record<string, number> = {
    '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
    K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
    U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
const CF_EVEN_VALUES: Record<string, number> = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9,
    K: 10, L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19,
    U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
};
const CF_STRUCTURE_REGEX = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

export function isValidItalianTaxCodeChecksum(taxCode: string): boolean {
    const cf = taxCode.trim().toUpperCase();
    if (cf.length !== 16 || !CF_STRUCTURE_REGEX.test(cf)) return false;
    let sum = 0;
    for (let i = 0; i < 15; i += 1) {
        const char = cf[i];
        // posizione 1-indexed dispari -> tabella dispari
        const value = (i % 2 === 0) ? CF_ODD_VALUES[char] : CF_EVEN_VALUES[char];
        if (value === undefined) return false;
        sum += value;
    }
    const expected = String.fromCharCode(65 + (sum % 26));
    return expected === cf[15];
}

// Specific prescriber/operator labels must be evaluated before generic physician or patient prose.
const ROLE_PATTERNS: Array<{
    role: DocumentDecisionIdentityRole;
    high: RegExp;
    medium: RegExp;
}> = [
    {
        role: 'patient_cf',
        high: /\b(?:codice\s+fiscale|cf)\s+(?:assistit[oa]|paziente|cittadin[oa]|intestatari[oa])\b|\b(?:assistit[oa]|paziente|cittadin[oa]|intestatari[oa])\s+(?:codice\s+fiscale|cf)\b/i,
        medium: /\b(?:assistit[oa]|paziente|cittadin[oa]|intestatari[oa]|utente)\b/i,
    },
    {
        role: 'prescriber_cf',
        high: /\b(?:codice\s+fiscale|cf)\s+(?:medico\s+prescrittore|prescrittore|richiedente)\b|\b(?:medico\s+prescrittore|prescrittore|richiedente)\s+(?:codice\s+fiscale|cf)\b/i,
        medium: /\b(?:medico\s+prescrittore|prescrittore|richiedente)\b/i,
    },
    {
        role: 'physician_cf',
        high: /\b(?:codice\s+fiscale|cf)\s+(?:medico|dott(?:\.|ore|oressa)?)\b|\b(?:medico|dott(?:\.|ore|oressa)?)\s+(?:codice\s+fiscale|cf)\b/i,
        medium: /\b(?:medico|dott(?:\.|ore|oressa)?)\b/i,
    },
    {
        role: 'operator_cf',
        high: /\b(?:codice\s+fiscale|cf)\s+(?:operatore|operatrice|compilatore|compilatrice)\b|\b(?:operatore|operatrice|compilatore|compilatrice)\s+(?:codice\s+fiscale|cf)\b/i,
        medium: /\b(?:operatore|operatrice|compilatore|compilatrice)\b/i,
    },
    {
        role: 'facility_tax_code',
        high: /\b(?:codice\s+fiscale|cf|partita\s+iva|p\.?\s*iva)\s+(?:struttura|azienda|ente|erogatore|ambulatorio)\b|\b(?:struttura|azienda|ente|erogatore|ambulatorio)\s+(?:codice\s+fiscale|cf|partita\s+iva|p\.?\s*iva)\b/i,
        medium: /\b(?:struttura|azienda|ente|erogatore|ambulatorio|asl|ats|asst)\b/i,
    },
];

function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function contextAround(text: string, start: number, end: number, contextWindow: number): { snippet: string; taxCodeIndex: number } {
    const left = Math.max(0, start - contextWindow);
    const right = Math.min(text.length, end + contextWindow);
    const rawSnippet = text.slice(left, right);
    // The snippet is whitespace-collapsed, so the tax-code index must be computed on the
    // same normalized representation or irregular OCR spacing skews the label distances.
    const normalizedPrefix = text.slice(left, start).replace(/\s+/g, ' ').trimStart();
    return {
        snippet: normalizeText(rawSnippet),
        taxCodeIndex: normalizedPrefix.length,
    };
}

function regexDistanceFromTaxCode(pattern: RegExp, context: string, taxCodeIndex: number): number | undefined {
    const matches = Array.from(context.matchAll(new RegExp(pattern.source, `${pattern.flags}g`)));
    if (matches.length === 0) return undefined;

    return matches.reduce<number | undefined>((closest, match) => {
        if (match.index === undefined) return closest;
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        const distance = taxCodeIndex >= matchStart && taxCodeIndex <= matchEnd
            ? 0
            : Math.min(Math.abs(taxCodeIndex - matchStart), Math.abs(taxCodeIndex - matchEnd));
        return closest === undefined || distance < closest ? distance : closest;
    }, undefined);
}

function inferRole(context: string, taxCodeIndex: number): Pick<DocumentDecisionTaxCodeRole, 'role' | 'confidence'> {
    const candidates: Array<{
        role: DocumentDecisionIdentityRole;
        confidence: DocumentDecisionTaxCodeRole['confidence'];
        priority: number;
        distance: number;
    }> = [];

    for (const pattern of ROLE_PATTERNS) {
        const highDistance = regexDistanceFromTaxCode(pattern.high, context, taxCodeIndex);
        if (highDistance !== undefined) {
            candidates.push({
                role: pattern.role,
                confidence: 'high',
                priority: 0,
                distance: highDistance,
            });
        }
        const mediumDistance = regexDistanceFromTaxCode(pattern.medium, context, taxCodeIndex);
        if (mediumDistance !== undefined) {
            candidates.push({
                role: pattern.role,
                confidence: 'medium',
                priority: 1,
                distance: mediumDistance,
            });
        }
    }

    candidates.sort((left, right) => left.priority - right.priority || left.distance - right.distance);
    if (candidates[0]) {
        return {
            role: candidates[0].role,
            confidence: candidates[0].confidence,
        };
    }
    return { role: 'unknown_cf', confidence: 'low' };
}

/* @Codex */
export function resolveDocumentTaxCodeRoles(
    input: ResolveDocumentTaxCodeRolesInput,
): ResolveDocumentTaxCodeRolesResult {
    const sourceId = input.sourceId ?? 'document';
    const contextWindow = input.contextWindow ?? 90;
    const matches = Array.from(input.text.matchAll(ITALIAN_TAX_CODE_REGEX));
    const evidenceRefs: DocumentDecisionEvidenceRef[] = [];
    const taxCodes: DocumentDecisionTaxCodeRole[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
        if (match.index === undefined) continue;
        const value = match[0].toUpperCase();
        const start = match.index;
        const end = start + match[0].length;
        const context = contextAround(input.text, start, end, contextWindow);
        const evidenceId = `tax-code:${taxCodes.length + 1}`;
        const role = inferRole(context.snippet, context.taxCodeIndex);

        // Un CF con checksum non valido (tipico dei falsi positivi OCR O/0, I/1)
        // non puo mai essere high confidence: viene declassato a medium, cosi
        // il merge automatico paziente resta gated dietro review.
        const checksumValid = isValidItalianTaxCodeChecksum(value);
        const confidence = (role.confidence === 'high' && !checksumValid) ? 'medium' : role.confidence;

        if (seen.has(`${value}:${role.role}`)) continue;
        seen.add(`${value}:${role.role}`);
        evidenceRefs.push(createDocumentDecisionEvidenceRef(evidenceId, context.snippet, sourceId));
        taxCodes.push({
            value,
            role: role.role,
            confidence,
            evidenceRefs: [evidenceId],
        });
    }

    const patientTaxCodes = taxCodes.filter((taxCode) => taxCode.role === 'patient_cf');
    const highConfidencePatientTaxCodes = patientTaxCodes.filter((taxCode) => taxCode.confidence === 'high');
    const unknownTaxCodes = taxCodes.filter((taxCode) => taxCode.role === 'unknown_cf');
    const conflictingTaxCodeValues = conflictingRoleTaxCodeValues(taxCodes);
    const humanRequired = highConfidencePatientTaxCodes.length !== 1
        || patientTaxCodes.length !== 1
        || unknownTaxCodes.length > 0
        || conflictingTaxCodeValues.length > 0;

    return {
        evidenceRefs,
        taxCodes,
        humanRequired,
        rationale: humanRequired
            ? reviewRationale(taxCodes, conflictingTaxCodeValues)
            : 'Un solo codice fiscale paziente esplicito identificato; eventuale link/create resta soggetto a review.',
    };
}

/* @Codex */
export function buildDocumentDecisionIdentityFromTaxCodes(
    result: ResolveDocumentTaxCodeRolesResult,
    action: DocumentDecisionIdentity['action'] = 'review_identity',
    patientId?: string,
): DocumentDecisionIdentity {
    const patientTaxCodes = result.taxCodes.filter((taxCode) => taxCode.role === 'patient_cf');
    const highConfidencePatientTaxCodes = patientTaxCodes.filter((taxCode) => taxCode.confidence === 'high');
    const unknownTaxCodes = result.taxCodes.filter((taxCode) => taxCode.role === 'unknown_cf');
    const taxCodesAreSafe = patientTaxCodes.length === 1
        && highConfidencePatientTaxCodes.length === 1
        && unknownTaxCodes.length === 0
        && conflictingRoleTaxCodeValues(result.taxCodes).length === 0;

    const requestedActionIsSafe = taxCodesAreSafe
        && (action !== 'link_existing_patient' || Boolean(patientId));
    const safeAction: DocumentDecisionIdentity['action'] = requestedActionIsSafe ? action : 'review_identity';
    const humanRequired = result.humanRequired || safeAction === 'review_identity';
    const common = {
        candidatePatientIds: [] as string[],
        taxCodes: result.taxCodes,
        rationale: result.rationale,
        humanRequired,
    };

    if (safeAction === 'link_existing_patient') {
        return {
            ...common,
            action: 'link_existing_patient',
            patientId: patientId!,
        };
    }
    if (safeAction === 'create_patient_candidate') {
        return { ...common, action: 'create_patient_candidate', patientId };
    }
    if (safeAction === 'review_identity') {
        return { ...common, action: 'review_identity', patientId };
    }
    return { ...common, action: 'attach_without_patient', patientId };
}

function conflictingRoleTaxCodeValues(taxCodes: DocumentDecisionTaxCodeRole[]): string[] {
    const rolesByValue = new Map<string, Set<DocumentDecisionIdentityRole>>();
    for (const taxCode of taxCodes) {
        const roles = rolesByValue.get(taxCode.value) ?? new Set<DocumentDecisionIdentityRole>();
        roles.add(taxCode.role);
        rolesByValue.set(taxCode.value, roles);
    }

    return Array.from(rolesByValue.entries())
        .filter(([, roles]) => roles.size > 1)
        .map(([value]) => value);
}

function reviewRationale(
    taxCodes: DocumentDecisionTaxCodeRole[],
    conflictingTaxCodeValues: string[],
): string {
    const roles = Array.from(new Set(taxCodes.map((taxCode) => taxCode.role))).join(', ') || 'nessun CF';
    const conflict = conflictingTaxCodeValues.length > 0
        ? ` Conflitto di ruolo per: ${conflictingTaxCodeValues.join(', ')}.`
        : '';
    return `Identità da revisionare: il ruolo dei codici fiscali (${roles}) non consente link/create deterministico.${conflict}`;
}
