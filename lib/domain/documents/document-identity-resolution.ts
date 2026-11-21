import { isValidItalianTaxCode, identifierError, inferIdentifierType } from '../../patient-identity';
import {
    createDocumentDecisionEvidenceRef,
    type DocumentDecisionEvidenceRef,
    type DocumentDecisionIdentity,
    type DocumentDecisionIdentityRole,
    type DocumentDecisionTaxCodeRole,
} from './document-decision';

export interface ResolveDocumentTaxCodeRolesInput {
    text: string;
    sourceId?: string;
    contextWindow?: number;
}

export interface ResolveDocumentTaxCodeRolesResult {
    evidenceRefs: DocumentDecisionEvidenceRef[];
    taxCodes: DocumentDecisionTaxCodeRole[];
    humanRequired: boolean;
    rationale: string;
}

// Case-insensitive: l'OCR restituisce spesso il CF in minuscolo. Il flag `i`
// non altera indici o lunghezza, quindi context/snippet restano allineati.
const ITALIAN_TAX_CODE_REGEX = /\b(?:(?:STP|ENI)\d{13}|[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z])\b/gi;

export const isValidItalianTaxCodeChecksum = isValidItalianTaxCode;

const CF_LABEL_SOURCE = String.raw`(?:codice\s+fiscale\b|c\.?\s*f\.?(?![a-z0-9]))`;
const PREP_SOURCE = String.raw`(?:dell['’]\s*|del(?:la|lo)?\s+)?`;
const PHYSICIAN_ROLE_SOURCE = String.raw`(?:medico\s+refertante|dirigente\s+medico|medico\s+specialista|specialista|il\s+medico|medico|dott(?:\.ssa|\.|ore|oressa)?|dr(?:\.ssa|\.)?)`;
const SIGNATURE_ROLE_SOURCE = String.raw`(?:(?:documento\s+)?(?:firmato|sottoscritto)(?:\s+digitalmente)?(?:\s+ai\s+sensi\s+[^:\n]{1,40})?\s+da|refertato\s+da|validato\s+da|firma\s+(?:digitale|del(?:lo)?\s+(?:medico|specialista|dirigente\s+medico)))`;

const ROLE_PATTERNS: Array<{
    role: DocumentDecisionIdentityRole;
    high: RegExp;
    medium: RegExp;
}> = [
    {
        role: 'patient_cf',
        high: new RegExp(
            String.raw`(?:\b${CF_LABEL_SOURCE}\s+${PREP_SOURCE}(?:assistit[oa]|paziente|cittadin[oa]|intestatari[oa])\b|\b(?:assistit[oa]|paziente|cittadin[oa]|intestatari[oa])\s*[:,-]?\s*${CF_LABEL_SOURCE})`,
            'i',
        ),
        medium: /\b(?:assistit[oa]|paziente|cittadin[oa]|intestatari[oa]|utente)\b/i,
    },
    {
        role: 'prescriber_cf',
        high: new RegExp(
            String.raw`(?:\b${CF_LABEL_SOURCE}\s+${PREP_SOURCE}(?:medico\s+prescrittore|prescrittore|richiedente)\b|\b(?:medico\s+prescrittore|prescrittore|richiedente)\s*[:,-]?\s*${CF_LABEL_SOURCE})`,
            'i',
        ),
        medium: /\b(?:medico\s+prescrittore|prescrittore|richiedente)\b/i,
    },
    {
        role: 'physician_cf',
        high: new RegExp(
            String.raw`(?:\b${CF_LABEL_SOURCE}\s+${PREP_SOURCE}${PHYSICIAN_ROLE_SOURCE}\b|\b${PHYSICIAN_ROLE_SOURCE}\s*[:,-]?\s*${CF_LABEL_SOURCE}|\b${SIGNATURE_ROLE_SOURCE}\b)`,
            'i',
        ),
        medium: new RegExp(String.raw`\b(?:${PHYSICIAN_ROLE_SOURCE}|${SIGNATURE_ROLE_SOURCE})\b`, 'i'),
    },
    {
        role: 'operator_cf',
        high: new RegExp(
            String.raw`(?:\b${CF_LABEL_SOURCE}\s+${PREP_SOURCE}(?:operatore|operatrice|compilatore|compilatrice)\b|\b(?:operatore|operatrice|compilatore|compilatrice)\s*[:,-]?\s*${CF_LABEL_SOURCE})`,
            'i',
        ),
        medium: /\b(?:operatore|operatrice|compilatore|compilatrice)\b/i,
    },
    {
        role: 'facility_tax_code',
        high: new RegExp(
            String.raw`(?:\b(?:${CF_LABEL_SOURCE}|partita\s+iva\b|p\.?\s*iva\b)\s+${PREP_SOURCE}(?:struttura|azienda|ente|erogatore|ambulatorio)\b|\b(?:struttura|azienda|ente|erogatore|ambulatorio)\s*[:,-]?\s*(?:${CF_LABEL_SOURCE}|partita\s+iva\b|p\.?\s*iva\b))`,
            'i',
        ),
        medium: /\b(?:struttura|azienda|ente|erogatore|ambulatorio|asl|ats|asst)\b/i,
    },
];

function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function contextAround(
    text: string,
    start: number,
    end: number,
    contextWindow: number,
    minLeft: number,
    maxRight: number,
): { snippet: string; taxCodeStart: number; taxCodeEnd: number } {
    const left = Math.max(minLeft, start - contextWindow);
    const right = Math.min(maxRight, end + contextWindow);
    const rawSnippet = text.slice(left, right);
    const normalizedPrefix = text.slice(left, start).replace(/\s+/g, ' ').trimStart();
    const taxCodeStart = normalizedPrefix.length;
    return {
        snippet: normalizeText(rawSnippet),
        taxCodeStart,
        taxCodeEnd: taxCodeStart + (end - start),
    };
}

function roleFamily(role: DocumentDecisionIdentityRole): 'patient' | 'physician' | 'operator' | 'facility' | 'unknown' {
    if (role === 'patient_cf') return 'patient';
    if (role === 'prescriber_cf' || role === 'physician_cf') return 'physician';
    if (role === 'operator_cf') return 'operator';
    if (role === 'facility_tax_code') return 'facility';
    return 'unknown';
}

interface RoleCandidate {
    role: DocumentDecisionIdentityRole;
    confidence: DocumentDecisionTaxCodeRole['confidence'];
    priority: number;
    direction: 0 | 1;
    distance: number;
    start: number;
    end: number;
}

function patternCandidates(
    pattern: RegExp,
    role: DocumentDecisionIdentityRole,
    confidence: DocumentDecisionTaxCodeRole['confidence'],
    priority: number,
    context: string,
    taxCodeStart: number,
    taxCodeEnd: number,
): RoleCandidate[] {
    const candidates: RoleCandidate[] = [];
    for (const match of context.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
        if (match.index === undefined) continue;
        const start = match.index;
        const end = start + match[0].length;
        const isAfter = start >= taxCodeEnd;
        const direction: 0 | 1 = isAfter ? 1 : 0;
        const distance = end <= taxCodeStart
            ? taxCodeStart - end
            : isAfter
                ? start - taxCodeEnd
                : 0;
        candidates.push({ role, confidence, priority, direction, distance, start, end });
    }
    return candidates;
}

function inferRole(context: string, taxCodeStart: number, taxCodeEnd: number): Pick<DocumentDecisionTaxCodeRole, 'role' | 'confidence'> {
    const candidates: RoleCandidate[] = [];

    for (const pattern of ROLE_PATTERNS) {
        candidates.push(...patternCandidates(pattern.high, pattern.role, 'high', 0, context, taxCodeStart, taxCodeEnd));
        candidates.push(...patternCandidates(pattern.medium, pattern.role, 'medium', 1, context, taxCodeStart, taxCodeEnd));
    }

    const active = candidates.filter((candidate) => !candidates.some((other) => (
        other.direction === candidate.direction
        && roleFamily(other.role) !== roleFamily(candidate.role)
        && (candidate.direction === 0 ? other.start >= candidate.end : other.end <= candidate.start)
    )));

    active.sort((left, right) => left.direction - right.direction || left.priority - right.priority || left.distance - right.distance);
    if (active[0]) {
        return {
            role: active[0].role,
            confidence: active[0].confidence,
        };
    }
    return { role: 'unknown_cf', confidence: 'low' };
}

const GENERIC_TAX_CODE_LINE = /^(?:codice[ \t\u00a0]+fiscale|c\.?[ \t\u00a0]*f\.?)[ \t\u00a0]*[:=]?[ \t\u00a0]*$/iu;
const PATIENT_SECTION_HEADER = /^(?:dati(?:\s+(?:anagrafici|personali))?\s+(?:dell['’]\s*|del(?:la)?\s+)?(?:assistit[oa]|paziente|cittadin[oa])|(?:assistit[oa]|paziente|cittadin[oa])\s*:)/iu;
const NON_PATIENT_BLOCK_CUE = /\b(?:medico|prescrittore|refertante|specialista|dirigente|operatore|operatrice|compilatore|compilatrice|firmato|sottoscritto|firma|struttura|azienda|asl|ats|asst)\b/iu;

function inferPatientSectionFallback(
    text: string,
    start: number,
    minLeft: number,
): Pick<DocumentDecisionTaxCodeRole, 'role' | 'confidence'> | null {
    const windowStart = Math.max(minLeft, start - 280);
    const prefix = text.slice(windowStart, start);
    const lines = prefix.split(/[\r\n\v\f\u0085\u2028\u2029]/u);
    const current = (lines.pop() ?? '').trim();
    if (!GENERIC_TAX_CODE_LINE.test(current)) return null;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index].trim();
        if (!line) break;
        if (NON_PATIENT_BLOCK_CUE.test(line)) return null;
        if (PATIENT_SECTION_HEADER.test(line)) return { role: 'patient_cf', confidence: 'medium' };
    }
    return null;
}

export function resolveDocumentTaxCodeRoles(
    input: ResolveDocumentTaxCodeRolesInput,
): ResolveDocumentTaxCodeRolesResult {
    const sourceId = input.sourceId ?? 'document';
    const contextWindow = input.contextWindow ?? 90;
    const matches = Array.from(input.text.matchAll(ITALIAN_TAX_CODE_REGEX));
    const evidenceRefs: DocumentDecisionEvidenceRef[] = [];
    const taxCodes: DocumentDecisionTaxCodeRole[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        if (match.index === undefined) continue;
        const value = match[0].toUpperCase();
        const start = match.index;
        const end = start + match[0].length;
        const previous = index > 0 ? matches[index - 1] : undefined;
        const next = index + 1 < matches.length ? matches[index + 1] : undefined;
        const minLeft = previous?.index !== undefined ? previous.index + previous[0].length : 0;
        const maxRight = next?.index !== undefined ? next.index : input.text.length;
        const context = contextAround(input.text, start, end, contextWindow, minLeft, maxRight);
        const evidenceId = `tax-code:${taxCodes.length + 1}`;
        const inferred = inferRole(context.snippet, context.taxCodeStart, context.taxCodeEnd);
        const role = inferred.role === 'unknown_cf'
            ? (inferPatientSectionFallback(input.text, start, minLeft) ?? inferred)
            : inferred;

        // Un CF con checksum non valido (tipico dei falsi positivi OCR O/0, I/1)
        // non puo mai essere high confidence: viene declassato a medium, cosi
        // il merge automatico paziente resta gated dietro review.
        const identifierType = inferIdentifierType(value);
        const checksumValid = identifierError(identifierType, value) === null;
        const confidence = (role.confidence === 'high' && !checksumValid) ? 'medium' : role.confidence;

        if (seen.has(`${value}:${role.role}`)) continue;
        seen.add(`${value}:${role.role}`);
        evidenceRefs.push(createDocumentDecisionEvidenceRef(evidenceId, context.snippet, sourceId));
        taxCodes.push({
            value,
            identifierType,
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
