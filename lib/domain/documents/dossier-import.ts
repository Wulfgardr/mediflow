/**
 * Dossier clinico da cartella (WUL-804, ADR 0175): solo proposte deterministiche.
 *
 * Questo modulo non scrive nulla. Classifica le fonti, divide il testo estratto in
 * unità, raccoglie i codici fiscali, propone fatti candidati con evidenza, li confronta
 * con la scheda e con le altre fonti e calcola la copertura. Le scritture passano
 * soltanto da `lib/document-dossier-session.ts`, su decisione esplicita del medico.
 *
 * Il record dossier vive come chiave aggiuntiva `dossier` dentro l'artefatto
 * `mediflow.document_parse_evidence_artifact.v1` già cifrato in
 * `attachments.parseEvidenceArtifactSnapshot`: i consumer esistenti continuano a
 * leggere il formato v1 senza cambiamenti.
 */

import { routeDocumentClass, parseFileNameHints } from './document-class-router';
import type { DocumentDecisionClassification } from './document-decision';
import { isValidItalianTaxCodeChecksum, resolveDocumentTaxCodeRoles } from './document-identity-resolution';
import { parseItalianLabReport } from './lab-report-parser';
import {
    catalogObservationCode, findInvalidityMentions, findIsoCode, findPrescriptionReference, findPriority, findScaleMentions, invalidityDetails,
    parseMedicationItem, prostheticStatusOf, qualifiersOf, segmentDossierSections, splitSectionItems, type DossierSection,
} from './dossier-sections';
import { clinicalDay, identityName, sameClinicalText, sameClinicalValue, sameDay, sameDosage, sameOptional, sameUnit } from './dossier-clinical-equality';
import {
    DOCUMENT_PARSE_EVIDENCE_ARTIFACT_SCHEMA_VERSION,
    buildDocumentParseEvidenceArtifact,
    parseDocumentParseEvidenceArtifactSnapshot,
} from './document-parse-evidence-artifact';

export const DOSSIER_SCHEMA_VERSION = 'mediflow.document_dossier.v1' as const;
export const DOSSIER_RECEIPT_SCHEMA_VERSION = 'mediflow.document_dossier_receipt.v1' as const;

// ---------------------------------------------------------------------------
// Inventario delle fonti
// ---------------------------------------------------------------------------

export type DossierSourceKind =
    | 'pdf' | 'image' | 'office' | 'text' | 'signed_p7m' | 'archive' | 'email' | 'empty' | 'unknown';

export interface DossierSourceClassification {
    kind: DossierSourceKind;
    mediaType: string;
    /** Inviata all'estrazione locale. Le altre fonti si conservano senza estrazione. */
    extractable: boolean;
    reason: string;
}

const OFFICE_EXTENSIONS = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'doc', 'xls', 'rtf']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'html', 'htm', 'xml', 'json']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'heic', 'heif', 'bmp', 'gif', 'webp']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz']);
const EMAIL_EXTENSIONS = new Set(['eml', 'msg']);
const MEDIA_TYPES: Record<string, string> = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff',
    heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', gif: 'image/gif', webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
    doc: 'application/msword', xls: 'application/vnd.ms-excel', rtf: 'application/rtf',
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html', xml: 'application/xml', json: 'application/json',
    p7m: 'application/pkcs7-mime', zip: 'application/zip', eml: 'message/rfc822', msg: 'application/vnd.ms-outlook',
};

function extensionOf(name: string): string {
    const match = /\.([a-z0-9]{1,8})$/iu.exec(name.trim());
    return match ? match[1].toLowerCase() : '';
}

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
    return head.length >= offset + bytes.length && bytes.every((byte, index) => head[offset + index] === byte);
}

/** Classifica dal nome e dai primi byte. Il tipo dichiarato dal browser non decide da solo. */
export function classifyDossierSource(input: { name: string; size: number; declaredType?: string; head: Uint8Array }): DossierSourceClassification {
    const extension = extensionOf(input.name);
    const declared = (input.declaredType ?? '').toLowerCase();
    const mediaType = MEDIA_TYPES[extension] ?? (declared || 'application/octet-stream');
    if (input.size === 0) return { kind: 'empty', mediaType, extractable: false, reason: 'File vuoto: nessun contenuto da conservare o leggere.' };
    if (extension === 'p7m' || extension === 'p7s') {
        return { kind: 'signed_p7m', mediaType: MEDIA_TYPES.p7m, extractable: false,
            reason: 'Busta firmata CAdES: l’originale si conserva, il contenuto non viene estratto né la firma verificata.' };
    }
    if (startsWith(input.head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: 'pdf', mediaType: 'application/pdf', extractable: true, reason: 'PDF' };
    const zipLike = startsWith(input.head, [0x50, 0x4b, 0x03, 0x04]);
    if (zipLike && OFFICE_EXTENSIONS.has(extension)) return { kind: 'office', mediaType, extractable: true, reason: 'Documento Office' };
    if (zipLike || ARCHIVE_EXTENSIONS.has(extension)) {
        return { kind: 'archive', mediaType: MEDIA_TYPES[extension] ?? 'application/zip', extractable: false,
            reason: 'Archivio compresso: si conserva l’originale; i file interni non vengono aperti.' };
    }
    if (EMAIL_EXTENSIONS.has(extension)) {
        return { kind: 'email', mediaType, extractable: false, reason: 'Messaggio di posta: si conserva l’originale; allegati e corpo non vengono estratti.' };
    }
    const image = startsWith(input.head, [0xff, 0xd8, 0xff]) || startsWith(input.head, [0x89, 0x50, 0x4e, 0x47])
        || startsWith(input.head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(input.head, [0x4d, 0x4d, 0x00, 0x2a])
        || startsWith(input.head, [0x66, 0x74, 0x79, 0x70], 4);
    if (image || IMAGE_EXTENSIONS.has(extension)) return { kind: 'image', mediaType, extractable: true, reason: 'Immagine' };
    if (OFFICE_EXTENSIONS.has(extension)) return { kind: 'office', mediaType, extractable: true, reason: 'Documento Office' };
    if (TEXT_EXTENSIONS.has(extension) || declared.startsWith('text/')) return { kind: 'text', mediaType: MEDIA_TYPES[extension] ?? 'text/plain', extractable: true, reason: 'Testo' };
    return { kind: 'unknown', mediaType, extractable: false, reason: 'Formato non riconosciuto: si conserva l’originale senza estrazione.' };
}

// ---------------------------------------------------------------------------
// Estrazione: unità di testo senza troncamenti nascosti
// ---------------------------------------------------------------------------

export type DossierExtractionFailureDetail =
    | 'unsupported_format' | 'image_or_scan' | 'malformed_document' | 'encrypted_document'
    | 'resource_limit' | 'incomplete_document' | 'io_failure' | 'empty_extraction' | 'unavailable';

/** Esito dell'estrazione host (route in sola lettura). */
export type DossierHostExtraction =
    | { status: 'extracted'; markdown: string; ocr: { pageCount: number; ocrPageCount: number } | null }
    | { status: 'failed'; detail: DossierExtractionFailureDetail };

export interface DossierUnit { index: number; kind: 'page' | 'document'; start: number; end: number }

export type DossierExtraction =
    | {
        state: 'extracted';
        engine: 'anydoc' | 'anydoc_ocr';
        /** Numero di pagine solo quando lo dichiara l'estrattore; mai stimato. */
        pageCount: number | null;
        ocrPageCount: number;
        unitBasis: 'pages' | 'document';
        units: DossierUnit[];
        text: { location: 'parse_bundle' | 'inline'; sha256: string; chars: number; inline?: string };
    }
    | { state: 'failed'; detail: DossierExtractionFailureDetail }
    | { state: 'not_extracted'; reason: DossierSourceKind | 'too_large' };

const PAGE_MARKER = /^## Pagina (\d+)$/gmu;

/**
 * Le pagine si riconoscono solo dai marcatori dell'OCR locale e solo se sono
 * esattamente 1..pageCount in ordine. Altrimenti il documento è una sola unità.
 */
export function splitDossierUnits(text: string, pageCount: number | null): { units: DossierUnit[]; unitBasis: 'pages' | 'document' } {
    if (pageCount && pageCount > 1) {
        const markers = [...text.matchAll(PAGE_MARKER)];
        const sequential = markers.length === pageCount && markers.every((match, index) => Number(match[1]) === index + 1);
        if (sequential) {
            const units = markers.map((match, index) => ({
                index: index + 1, kind: 'page' as const, start: match.index!,
                end: index + 1 < markers.length ? markers[index + 1].index! : text.length,
            }));
            return { units, unitBasis: 'pages' };
        }
    }
    if (pageCount === 1) return { units: [{ index: 1, kind: 'page', start: 0, end: text.length }], unitBasis: 'pages' };
    return { units: [{ index: 1, kind: 'document', start: 0, end: text.length }], unitBasis: 'document' };
}

export function unitText(text: string, unit: DossierUnit): string { return text.slice(unit.start, unit.end); }

// ---------------------------------------------------------------------------
// Identità: un codice fiscale valido non prova l'identità
// ---------------------------------------------------------------------------

export interface DossierTaxCodeEvidence {
    value: string; role: 'patient_cf' | 'professional_cf' | 'unknown_cf'; checksumValid: boolean;
    /** Ogni occorrenza ha un'etichetta professionale direttamente prima del codice. I vecchi artefatti non lo attestano. */
    explicitProfessional?: boolean;
    /** Distingue la regola sulla stessa riga dalle vecchie attribuzioni multilinea. */
    professionalLabelScope?: 'same_line';
    /** Letto dall'estrazione preparata perché il testo di MediFlow non ne contiene uno valido: partecipa al confronto. */
    origin?: 'prepared';
}

const CF_LABEL = String.raw`(?:codice[ \t\u00a0]+fiscale|c\.?[ \t\u00a0]*f\.?)`;
const PROFESSIONAL_LABEL = String.raw`(?:medico(?:[ \t\u00a0]+prescrittore)?|prescrittore|operatore|operatrice|compilatore|compilatrice)`;
const EXPLICIT_PROFESSIONAL_CF = new RegExp(String.raw`^[ \t\u00a0]*(?:${CF_LABEL}[ \t\u00a0]+(?:del(?:la)?[ \t\u00a0]+)?${PROFESSIONAL_LABEL}|${PROFESSIONAL_LABEL}[ \t\u00a0]+${CF_LABEL})[ \t\u00a0]*[:=]?[ \t\u00a0]*$`, 'iu');

function professionalCodeOnSameLine(code: DossierTaxCodeEvidence): boolean {
    return code.role === 'professional_cf' && code.explicitProfessional === true && code.professionalLabelScope === 'same_line';
}

export function collectDossierTaxCodes(text: string): DossierTaxCodeEvidence[] {
    const resolved = resolveDocumentTaxCodeRoles({ text });
    const seen = new Set<string>();
    const result: DossierTaxCodeEvidence[] = [];
    for (const code of resolved.taxCodes) {
        // La vicinanza ad ASST/medico non basta: può essere l'intestazione sopra i dati del paziente.
        // Verifica tutte le occorrenze: una ripetizione non attribuita deve restare nel confronto.
        const occurrences = [...text.matchAll(new RegExp(`\\b${code.value}\\b`, 'giu'))];
        const explicitProfessional = occurrences.length > 0 && occurrences.every((match) => {
            const prefix = text.slice(0, match.index!);
            const line = /[^\r\n\v\f\u0085\u2028\u2029]*$/u.exec(prefix)![0];
            return EXPLICIT_PROFESSIONAL_CF.test(line);
        });
        const role = explicitProfessional ? 'professional_cf' : code.role === 'patient_cf' ? 'patient_cf' : 'unknown_cf';
        const key = `${code.value}:${role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ value: code.value, role, checksumValid: isValidItalianTaxCodeChecksum(code.value),
            ...(explicitProfessional ? { explicitProfessional: true, professionalLabelScope: 'same_line' as const } : {}) });
    }
    return result;
}

export type DossierIdentityStatus =
    | 'mixed' | 'discordant' | 'matched' | 'no_document_cf' | 'unmatched_cf' | 'ambiguous_cf' | 'suggested';

export interface DossierIdentityEvaluation {
    status: DossierIdentityStatus;
    /** Impedisce acquisizione e scrittura del gruppo finché non viene risolto. */
    blocking: boolean;
    /** Serve una conferma esplicita del medico prima dell'acquisizione. */
    confirmationRequired: boolean;
    documentPatientCodes: string[];
    candidatePatientIds: string[];
    message: string;
}

export interface DossierPatientIdentity { id: string; taxCode: string }

function normalizedCode(value: string): string { return value.trim().toUpperCase(); }

/**
 * Valuta un gruppo di documenti. Il nome della cartella non partecipa mai.
 * - tutti i CF validi, anche non attribuiti, partecipano al confronto;
 * - solo un CF esplicitamente del professionista viene escluso;
 * - più CF distinti o CF diverso dalla scheda collegata: blocco;
 * - nessun CF: collegamento solo con conferma esplicita.
 */
export function evaluateDossierGroupIdentity(
    documents: ReadonlyArray<{ taxCodes: readonly DossierTaxCodeEvidence[] }>,
    patients: readonly DossierPatientIdentity[],
    linkedPatientId?: string | null,
): DossierIdentityEvaluation {
    const patientCodes = [...new Set(documents.flatMap((document) => document.taxCodes
        .filter((code) => code.checksumValid && !professionalCodeOnSameLine(code))
        .map((code) => normalizedCode(code.value))))].sort();
    const unattributed = documents.some((document) => document.taxCodes.some((code) => code.checksumValid
        && code.role !== 'patient_cf' && !professionalCodeOnSameLine(code)));
    const linked = linkedPatientId ? patients.find((patient) => patient.id === linkedPatientId) : undefined;
    const holders = (code: string) => patients.filter((patient) => normalizedCode(patient.taxCode) === code).map((patient) => patient.id);
    if (patientCodes.length > 1) {
        return { status: 'mixed', blocking: true, confirmationRequired: true, documentPatientCodes: patientCodes, candidatePatientIds: [],
            message: 'I documenti contengono più codici fiscali distinti, inclusi quelli di attribuzione incerta. Controlla a chi si riferiscono ed escludi le fonti discordanti prima di procedere.' };
    }
    const [code] = patientCodes;
    if (linked) {
        if (code && normalizedCode(linked.taxCode) !== code) {
            return { status: 'discordant', blocking: true, confirmationRequired: true, documentPatientCodes: patientCodes, candidatePatientIds: holders(code),
                message: 'Il codice fiscale nei documenti non corrisponde alla scheda scelta. Nessuna fonte verrà salvata su questa scheda.' };
        }
        if (code) {
            return { status: 'matched', blocking: false, confirmationRequired: true, documentPatientCodes: patientCodes, candidatePatientIds: [linked.id],
                message: unattributed ? 'Il codice fiscale letto coincide con la scheda scelta, ma la sua attribuzione nel documento è incerta. Verifica a chi si riferisce prima di confermare.'
                    : 'Il codice fiscale nei documenti coincide con la scheda scelta. Conferma comunque il collegamento.' };
        }
        return { status: 'no_document_cf', blocking: false, confirmationRequired: true, documentPatientCodes: [], candidatePatientIds: [linked.id],
            message: 'Nessun codice fiscale paziente leggibile: verifica i documenti e conferma il collegamento.' };
    }
    if (!code) {
        return { status: 'no_document_cf', blocking: false, confirmationRequired: true, documentPatientCodes: [], candidatePatientIds: [],
            message: 'Nessun codice fiscale paziente leggibile: scegli la scheda dopo aver controllato i documenti.' };
    }
    const owners = holders(code);
    if (owners.length === 0) {
        return { status: 'unmatched_cf', blocking: false, confirmationRequired: true, documentPatientCodes: patientCodes, candidatePatientIds: [],
            message: 'Nessuna scheda con questo codice fiscale: crea una nuova scheda o scegline una esistente.' };
    }
    if (owners.length > 1) {
        return { status: 'ambiguous_cf', blocking: false, confirmationRequired: true, documentPatientCodes: patientCodes, candidatePatientIds: owners,
            message: 'Più schede hanno lo stesso codice fiscale: scegli quella corretta.' };
    }
    return { status: 'suggested', blocking: false, confirmationRequired: true, documentPatientCodes: patientCodes, candidatePatientIds: owners,
        message: 'Una scheda ha lo stesso codice fiscale. Il codice non prova l’identità: conferma il collegamento.' };
}

// ---------------------------------------------------------------------------
// Fatti candidati
// ---------------------------------------------------------------------------

export type DossierFactKind =
    | 'diagnosis' | 'anamnesis' | 'exemption' | 'therapy' | 'observation' | 'service_prescription'
    | 'prosthetic' | 'reported_scale' | 'assessment' | 'imaging_report' | 'invalidity' | 'care_context' | 'document_entry';

export const DOSSIER_FACT_KIND_LABELS: Record<DossierFactKind, string> = {
    diagnosis: 'Diagnosi', anamnesis: 'Anamnesi', exemption: 'Esenzione', therapy: 'Farmaco', observation: 'Osservazione',
    service_prescription: 'Prestazioni richieste', prosthetic: 'Ausilio', reported_scale: 'Scala riportata',
    assessment: 'Valutazione', imaging_report: 'Referto di imaging', invalidity: 'Invalidità', care_context: 'Contesto assistenziale',
    document_entry: 'Documento nel diario',
};

/** Destinazione ordinaria di ogni tipo. */
export const DOSSIER_FACT_TARGET: Record<DossierFactKind, 'patient_diagnoses' | 'patient_exemptions' | 'therapies' | 'observations' | 'service_prescriptions' | 'prosthetic_prescriptions' | 'entries'> = {
    diagnosis: 'patient_diagnoses', exemption: 'patient_exemptions', therapy: 'therapies', observation: 'observations',
    service_prescription: 'service_prescriptions', prosthetic: 'prosthetic_prescriptions',
    anamnesis: 'entries', reported_scale: 'entries', assessment: 'entries', imaging_report: 'entries', invalidity: 'entries',
    care_context: 'entries', document_entry: 'entries',
};

export type DossierFactValues = Record<string, string>;
export type DossierFactDecision = 'pending' | 'accepted' | 'rejected' | 'already_present';

export interface DossierEvidence { unit: number; start: number; end: number; excerpt: string }

export interface DossierFact {
    factId: string;
    kind: DossierFactKind;
    /** `prepared`: dall'estrazione preparata fuori da MediFlow (ADR 0176), con citazione verificata sul testo conservato. */
    origin: 'parser:lab' | 'parser:exemption' | 'parser:icd' | 'parser:section' | 'parser:scale' | 'parser:document' | 'prepared' | 'manual';
    evidence: DossierEvidence | null;
    /** Il testo nega l'informazione: non si applica senza correzione esplicita. */
    negated: boolean;
    values: DossierFactValues;
    decision: DossierFactDecision;
    note?: string;
    /** Identità opaca del record, persistita nell'artefatto prima della scrittura. */
    recordId?: string;
}

const NEGATION = /\b(?:non|nega|negano|negativ[oaie]|assenza\s+di|assente|esclus[oaie]|escludere|no)\b/iu;

function hashText(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function dossierFactId(kind: DossierFactKind, unit: number, start: number, values: DossierFactValues): string {
    const body = Object.keys(values).sort().map((key) => `${key}=${values[key]}`).join('|');
    return `f-${kind}-${unit}-${start}-${hashText(body)}`;
}

function lineAround(text: string, start: number, end: number): { lineStart: number; line: string } {
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEnd = text.indexOf('\n', end);
    return { lineStart, line: text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd) };
}

/** Negazione nella stessa frase, dopo l'eventuale fatto precedente (`boundary`). */
function negatedBefore(text: string, start: number, boundary = 0): boolean {
    const { lineStart } = lineAround(text, start, start);
    const prefix = text.slice(Math.max(lineStart, boundary), start);
    const sentence = prefix.slice(Math.max(prefix.lastIndexOf('.'), prefix.lastIndexOf(';')) + 1);
    return NEGATION.test(sentence);
}

const DAY_MONTH_YEAR = String.raw`(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})`;
const LABELED_DATE = new RegExp(String.raw`\b(?:data(?:\s+(?:del|della|di))?(?:\s+(?:referto|prelievo|visita|esame|emissione|prescrizione|dimissione|documento|accettazione|refertazione))?)\s*[:.]?\s*${DAY_MONTH_YEAR}`, 'iu');

function isoDate(day: string, month: string, year: string): string | null {
    const d = Number(day); const m = Number(month); const y = Number(year);
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Data del documento solo da etichetta esplicita nel testo o dal nome file (schema AAAA-MM-GG). */
export function findExplicitDocumentDate(text: string, fileName: string): { date: string; source: 'text' | 'file_name' } | null {
    const match = LABELED_DATE.exec(text);
    if (match) {
        const value = isoDate(match[1], match[2], match[3]);
        if (value) return { date: value, source: 'text' };
    }
    const hint = parseFileNameHints(fileName).documentDate;
    return hint ? { date: hint, source: 'file_name' } : null;
}

// La descrizione si ferma al codice successivo o a fine frase: AnyDoc può unire righe.
const LAB_RANGE = /-?\d+(?:[.,]\d+)?\s*[-–]\s*-?\d+(?:[.,]\d+)?/gu;
const LAB_ROW_BREAK = /-?\d+(?:[.,]\d+)?\s*[-–]\s*-?\d+(?:[.,]\d+)?(?:\s+(?:H|L|ALTO|BASSO|\*{1,2}|↑|↓))?\s(?=\p{Lu})/gu;

const ICD_EXPLICIT = /\bICD[-\s]?(9|10)(?:[-\s]?CM)?\s*[:.]?\s*([A-Z]?\d{2,3}(?:\.\d{1,2})?)\b\s*[-–:]?\s*((?:(?!\bICD\b|\bICD[-\s]?\d|\b(?:nega|non|esclus)\w*\b)[^\n.;]){0,160})/giu;
const EXEMPTION_LINE = /\besen(?:zione|zioni|te)\b/iu;
const CODE_TOKEN = /\b[A-Z0-9]{1,6}(?:\.[A-Z0-9]{1,4})?\b/giu;

function entryKindForClass(classification: DocumentDecisionClassification): { kind: DossierFactKind; title: string } {
    switch (classification) {
        case 'imaging_report': return { kind: 'imaging_report', title: 'Referto di imaging' };
        case 'lab_report': return { kind: 'document_entry', title: 'Referto di laboratorio' };
        case 'specialist_report': return { kind: 'document_entry', title: 'Referto specialistico' };
        case 'prosthetic_prescription': return { kind: 'document_entry', title: 'Documentazione protesica' };
        case 'administrative': return { kind: 'document_entry', title: 'Documento amministrativo' };
        case 'specialist_service_prescription': case 'lab_prescription': case 'imaging_prescription':
            return { kind: 'document_entry', title: 'Richiesta di prestazioni' };
        case 'medication_prescription': return { kind: 'document_entry', title: 'Prescrizione farmaci' };
        default: return { kind: 'document_entry', title: 'Documento' };
    }
}

export interface DossierCandidateInput {
    fileName: string;
    text: string;
    units: readonly DossierUnit[];
    documentDate: string | null;
    /** Codici del catalogo esenzioni locale (ADR 0127): solo questi diventano candidati. */
    exemptionCodes: ReadonlySet<string>;
}

/**
 * Candidati solo dove esiste un parser affidabile: righe di laboratorio, codici ICD
 * esplicitamente etichettati, codici di esenzione del catalogo vicino alla parola
 * «esenzione». Il resto del contenuto resta testo integrale, proposto come voce di
 * diario e revisionabile; il medico aggiunge a mano ciò che i parser non coprono.
 */
export function extractDossierCandidates(input: DossierCandidateInput): { facts: DossierFact[]; classification: DocumentDecisionClassification } {
    const facts: DossierFact[] = [];
    const routed = routeDocumentClass({ fileName: input.fileName, textSample: input.text.slice(0, 2000) });
    const date = input.documentDate ?? '';
    for (const unit of input.units) {
        const text = unitText(input.text, unit);
        // Marcatura markdown di AnyDoc (titoli, elenchi, citazioni) sostituita da spazi
        // della stessa lunghezza: gli offset delle evidenze restano quelli del testo conservato.
        const unmarked = text.replace(/^([ \t]*)(#{1,6}|[-*+>])(?=[ \t])/gmu, (_match, lead: string, mark: string) => lead + ' '.repeat(mark.length));
        // Righe di una tabella unite in un paragrafo dall'estrattore: solo se la riga contiene almeno due
        // intervalli di riferimento, lo spazio dopo ciascun intervallo (ed eventuale segno H/L) diventa un a capo.
        const rebuilt = new Set<number>();
        const plain = unmarked.split('\n').map((line, index, all) => {
            if ((line.match(LAB_RANGE) ?? []).length < 2) return line;
            const offset = all.slice(0, index).reduce((sum, item) => sum + item.length + 1, 0);
            return line.replace(LAB_ROW_BREAK, (match, ...rest) => {
                const at = rest[rest.length - 2] as number;
                rebuilt.add(offset + at + match.length);
                return `${match.slice(0, -1)}\n`;
            });
        }).join('\n');
        // Laboratorio: parser esistente, riga per riga.
        const lines = plain.replace(/\r/gu, '').split('\n');
        const offsets: number[] = [];
        let cursor = 0;
        for (const line of lines) { offsets.push(cursor); cursor += line.length + 1; }
        for (const result of parseItalianLabReport(plain)) {
            const start = offsets[result.lineNumber - 1] ?? 0;
            // Codice e unità solo da corrispondenza esatta col catalogo locale; altrimenti restano da inserire.
            const coded = catalogObservationCode(result.analyte, result.unit);
            const fromParagraph = rebuilt.has(start);
            const values: DossierFactValues = {
                display: result.analyte, value: result.value, unit: result.unit, code: coded?.code ?? '', unitCode: coded?.unitCode ?? '',
                ...(coded ? { codeSource: 'catalogo locale: nome e unità coincidenti' } : {}),
                ...(fromParagraph ? { rowSource: 'riga ricostruita da un paragrafo dell’estrattore: verifica esame e valore' } : {}),
                refText: result.referenceRange.text, refLow: result.referenceRange.low ?? '', refHigh: result.referenceRange.high ?? '',
                observedAt: date,
            };
            facts.push({ factId: dossierFactId('observation', unit.index, start, values), kind: 'observation', origin: 'parser:lab',
                evidence: { unit: unit.index, start, end: start + (lines[result.lineNumber - 1] ?? '').length,
                    excerpt: text.slice(start, start + (lines[result.lineNumber - 1] ?? '').length).trim() },
                negated: false, values, decision: 'pending' });
        }
        let previousEnd = 0;
        for (const match of text.matchAll(ICD_EXPLICIT)) {
            const start = match.index ?? 0;
            const boundary = previousEnd;
            previousEnd = start + match[0].length;
            const section = segmentDossierSections(text).find((item) => item.start <= start && item.end >= start);
            const line = lineAround(text, start, start + match[0].length);
            // Un punto (abbreviativo o meno) o un altro ICD non provano un cambio
            // di soggetto. Nella stessa riga il familiare resta nel contesto fino
            // a una nuova sezione esplicita, ad esempio «Diagnosi:».
            const contextStart = Math.max(line.lineStart, section?.start ?? 0);
            const contextEnd = Math.min(start + match[0].length, section?.end ?? text.length);
            const context = text.slice(contextStart, contextEnd).trim();
            const qualifiers = qualifiersOf(context, section?.kind ?? 'diagnosis', section?.label ?? '');
            if (qualifiers.subject === 'familiare') {
                facts.push({ factId: dossierFactId('anamnesis', unit.index, start, { text: context }), kind: 'anamnesis', origin: 'parser:icd',
                    evidence: { unit: unit.index, start: contextStart, end: contextEnd, excerpt: context }, negated: false,
                    values: { title: 'Anamnesi familiare', text: context, subject: 'familiare', date, certainty: qualifiers.certainty }, decision: 'pending' });
                continue;
            }
            const values: DossierFactValues = {
                code: match[2].toUpperCase(), system: match[1] === '9' ? 'ICD-9' : 'ICD-10',
                description: match[3].trim(), date, certainty: qualifiers.certainty, temporality: qualifiers.temporality,
            };
            facts.push({ factId: dossierFactId('diagnosis', unit.index, start, values), kind: 'diagnosis', origin: 'parser:icd',
                evidence: { unit: unit.index, start, end: start + match[0].length, excerpt: lineAround(text, start, start + match[0].length).line.trim() },
                negated: negatedBefore(text, start, boundary), values, decision: 'pending' });
        }
        let lineStart = 0;
        for (const line of lines) {
            if (EXEMPTION_LINE.test(line)) {
                for (const token of line.matchAll(CODE_TOKEN)) {
                    const code = token[0].toUpperCase();
                    if (!input.exemptionCodes.has(code)) continue;
                    const start = lineStart + (token.index ?? 0);
                    const values: DossierFactValues = { code };
                    facts.push({ factId: dossierFactId('exemption', unit.index, start, values), kind: 'exemption', origin: 'parser:exemption',
                        evidence: { unit: unit.index, start, end: start + code.length, excerpt: line.trim() },
                        negated: negatedBefore(text, start), values, decision: 'pending' });
                }
            }
            lineStart += line.length + 1;
        }
        facts.push(...sectionCandidates(text, unit.index, date, routed.classification));
    }
    // Il documento intero come voce di diario: conserva tutto ciò che non è strutturabile.
    const entry = entryKindForClass(routed.classification);
    const fullText = input.text.trim();
    if (fullText) {
        // Il testo resta uno solo, nell'artefatto: la voce lo rilegge e ne verifica lo sha256 all'applicazione.
        const values: DossierFactValues = { title: entry.title, date, text: '', textSource: 'document' };
        facts.push({ factId: dossierFactId(entry.kind, 0, 0, { title: entry.title }), kind: entry.kind, origin: 'parser:document',
            evidence: null, negated: false, values, decision: 'pending' });
    }
    return { facts: dedupeFactIds(facts), classification: routed.classification };
}

function serviceCategory(classification: DocumentDecisionClassification): string {
    return classification === 'lab_prescription' ? 'lab' : classification === 'imaging_prescription' ? 'imaging' : '';
}

const capitalized = (value: string) => value ? value[0].toLocaleUpperCase('it-IT') + value.slice(1) : value;

/** Proposte dalle sezioni esplicite e dalle menzioni puntuali (scale, invalidità) di un'unità. */
function sectionCandidates(text: string, unit: number, date: string, classification: DocumentDecisionClassification): DossierFact[] {
    const facts: DossierFact[] = [];
    const sections = segmentDossierSections(text);
    const add = (kind: DossierFactKind, origin: DossierFact['origin'], span: { start: number; end: number }, values: DossierFactValues, negated: boolean) => {
        facts.push({ factId: dossierFactId(kind, unit, span.start, values), kind, origin,
            evidence: { unit, start: span.start, end: span.end, excerpt: text.slice(span.start, span.end).replace(/\s+/gu, ' ').trim() },
            negated, values, decision: 'pending' });
    };
    const content = (section: DossierSection) => text.slice(section.start, section.end).trim();
    const whole = (section: DossierSection) => ({ start: section.labelStart, end: section.end });
    const question = sections.find((section) => section.kind === 'clinical_question');
    const reference = findPrescriptionReference(text);
    const priority = findPriority(text);
    for (const section of sections) {
        const label = section.label.toLocaleLowerCase('it-IT');
        switch (section.kind) {
            case 'diagnosis':
                for (const item of splitSectionItems(text, section.start, section.end)) {
                    if (/\bICD[-\s]?\d/iu.test(item.text)) continue; // coperto dal parser ICD esplicito
                    const q = qualifiersOf(item.text, section.kind, section.label);
                    if (q.subject === 'familiare') {
                        add('anamnesis', 'parser:section', item, { title: 'Anamnesi familiare', date, text: item.text, subject: q.subject, temporality: q.temporality, certainty: q.certainty }, q.negated);
                    } else {
                        add('diagnosis', 'parser:section', item, { description: item.text, code: '', system: '', date, certainty: q.certainty, temporality: q.temporality, sectionLabel: section.label }, q.negated);
                    }
                }
                break;
            case 'anamnesis': case 'anamnesis_family': {
                const q = qualifiersOf(content(section), section.kind, section.label);
                add('anamnesis', 'parser:section', whole(section), { title: capitalized(section.label), date, text: content(section), subject: q.subject,
                    temporality: q.temporality || (section.kind === 'anamnesis' ? 'storica' : ''), certainty: q.certainty }, false);
                break;
            }
            case 'medication':
                for (const item of splitSectionItems(text, section.start, section.end)) {
                    const q = qualifiersOf(item.text, section.kind, section.label);
                    const parsed = parseMedicationItem(item.text);
                    // Una terapia letta da documento resta storica finché il medico non sceglie altrimenti.
                    const status = /\bsospes|sospend|interrott/iu.test(`${label} ${item.text}`) ? 'suspended' : 'completed';
                    add('therapy', 'parser:section', item, { drugName: parsed.drugName, dosage: parsed.dosage, status, startDate: '', endDate: '',
                        temporality: q.temporality, sectionLabel: section.label, certainty: q.certainty }, q.negated);
                }
                break;
            case 'services': {
                const items = splitSectionItems(text, section.start, section.end);
                if (!items.length) break;
                add('service_prescription', 'parser:section', whole(section), { serviceName: items[0].text, items: items.map((item) => item.text).join('\n'),
                    category: serviceCategory(classification), priority: priority?.value ?? '', requestReference: reference?.value ?? '',
                    clinicalQuestion: question ? content(question) : '', prescribedAt: date }, false);
                break;
            }
            case 'prosthetic':
                for (const item of splitSectionItems(text, section.start, section.end)) {
                    const isoCode = findIsoCode(item.text);
                    add('prosthetic', 'parser:section', item, { description: item.text.replace(/\b(?:cod(?:ice)?\.?\s*)?ISO\s*[:.]?\s*[\d.\s]+/iu, '').trim() || item.text,
                        isoCode, category: '', status: prostheticStatusOf(`${section.label} ${item.text}`), prescribedAt: date }, qualifiersOf(item.text, section.kind, section.label).negated);
                }
                break;
            case 'invalidity': {
                const details = invalidityDetails(content(section));
                add('invalidity', 'parser:section', whole(section), { title: capitalized(section.label), date, text: content(section), ...details }, false);
                break;
            }
            case 'assessment': case 'followup': {
                const q = qualifiersOf(content(section), section.kind, section.label);
                add(classification === 'imaging_report' && /conclusion/u.test(label) ? 'imaging_report' : 'assessment', 'parser:section', whole(section),
                    { title: capitalized(section.label), date, text: content(section), temporality: q.temporality, certainty: q.certainty }, false);
                break;
            }
            case 'care_context':
                add('care_context', 'parser:section', whole(section), { title: capitalized(section.label), date, text: content(section) }, false);
                break;
            default:
                break;
        }
    }
    if (!sections.some((section) => section.kind === 'services') && reference && /prescription/u.test(classification)) {
        // Ricetta riconosciuta senza elenco esplicito: la prestazione va completata dal medico.
        add('service_prescription', 'parser:section', reference, { serviceName: '', items: '', category: serviceCategory(classification), priority: priority?.value ?? '',
            requestReference: reference.value, clinicalQuestion: question ? content(question) : '', prescribedAt: date }, false);
    }
    for (const mention of findScaleMentions(text)) {
        // La frase della menzione, non la riga: un paragrafo unito non estende la negazione ad altre scale.
        const from = Math.max(text.lastIndexOf('.', mention.start - 1), text.lastIndexOf(';', mention.start - 1), text.lastIndexOf('\n', mention.start - 1)) + 1;
        const stops = ['.', ';', '\n'].map((mark) => text.indexOf(mark, mention.end)).filter((index) => index >= 0);
        const sentence = text.slice(from, stops.length ? Math.min(...stops) : text.length);
        add('reported_scale', 'parser:scale', mention, { scaleName: mention.scaleName, scaleTotal: mention.total, scaleMax: mention.max, date, text: sentence.trim() },
            NEGATION.test(sentence.slice(0, mention.start - from)) || /non\s+(?:eseguit|somministrat|valutabil)/iu.test(sentence));
    }
    if (!sections.some((section) => section.kind === 'invalidity')) {
        for (const mention of findInvalidityMentions(text)) {
            add('invalidity', 'parser:section', mention, { title: 'Invalidità', date, text: mention.text, ...invalidityDetails(mention.text) }, false);
        }
    }
    return facts;
}

export interface DossierResidualSegment { unit: number; start: number; end: number; excerpt: string }

/**
 * Testo che nessuna proposta con evidenza copre: resta visibile come residuo da rivedere.
 * Offset relativi all'unità, come le evidenze. Marcatori di pagina e separatori esclusi.
 */
export function dossierResidualSegments(text: string, units: readonly DossierUnit[], facts: readonly DossierFact[]): DossierResidualSegment[] {
    const residual: DossierResidualSegment[] = [];
    for (const unit of units) {
        const body = unitText(text, unit);
        // Coperti: le evidenze delle proposte e le etichette di sezione già interpretate.
        const covered = [...facts.filter((fact) => fact.evidence?.unit === unit.index).map((fact) => [fact.evidence!.start, fact.evidence!.end] as const),
            ...segmentDossierSections(body).map((section) => [section.labelStart, section.start] as const)].sort((a, b) => a[0] - b[0]);
        let cursor = 0;
        const push = (from: number, to: number) => {
            const raw = body.slice(from, to).replace(/^## Pagina \d+$/gmu, '').replace(/^-{3,}$/gmu, '');
            if (raw.replace(/[^\p{L}\p{N}]/gu, '').length >= 3) {
                const lead = body.slice(from, to).length - body.slice(from, to).trimStart().length;
                residual.push({ unit: unit.index, start: from + lead, end: to, excerpt: raw.replace(/\s+/gu, ' ').trim() });
            }
        };
        for (const [start, end] of covered) {
            if (start > cursor) push(cursor, start);
            cursor = Math.max(cursor, end);
        }
        if (cursor < body.length) push(cursor, body.length);
    }
    return residual;
}

function dedupeFactIds(facts: DossierFact[]): DossierFact[] {
    const seen = new Set<string>();
    return facts.filter((fact) => (seen.has(fact.factId) ? false : (seen.add(fact.factId), true)));
}

/** Fatto aggiunto o corretto dal medico. */
export function createManualDossierFact(kind: DossierFactKind, values: DossierFactValues, nonce: string): DossierFact {
    return { factId: `m-${kind}-${nonce}`, kind, origin: 'manual', evidence: null, negated: false, values, decision: 'pending' };
}

// ---------------------------------------------------------------------------
// Validazione per l'applicazione: nessuna data o codice inventato
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
function validIsoDate(value: string | undefined): boolean {
    if (!value || !ISO_DATE.test(value)) return false;
    const [y, m, d] = value.split('-');
    return isoDate(d, m, y) === value;
}

export const DOSSIER_REQUIRED_FIELDS: Record<DossierFactKind, readonly string[]> = {
    diagnosis: ['description', 'date'], exemption: ['code'], therapy: ['drugName', 'dosage', 'status', 'startDate'],
    observation: ['display', 'value', 'code', 'unitCode', 'observedAt'], service_prescription: ['serviceName', 'category', 'prescribedAt'],
    prosthetic: ['description', 'category', 'status', 'prescribedAt'], anamnesis: ['text', 'date'], reported_scale: ['scaleName', 'scaleTotal', 'date'],
    assessment: ['text', 'date'], imaging_report: ['text', 'date'], invalidity: ['text', 'date'], care_context: ['text', 'date'],
    document_entry: ['text', 'date'],
};

const DATE_FIELDS = new Set(['date', 'startDate', 'endDate', 'observedAt', 'prescribedAt']);

/** Motivi che impediscono di applicare un fatto accettato. Vuoto = applicabile. */
export function dossierFactBlockers(fact: DossierFact, context: { exemptionCodes?: ReadonlySet<string> } = {}): string[] {
    const blockers: string[] = [];
    if (fact.negated) blockers.push('Il testo nega questa informazione: correggi il fatto o rifiutalo.');
    for (const field of DOSSIER_REQUIRED_FIELDS[fact.kind]) {
        if (field === 'text' && fact.values.textSource === 'document') continue;
        const value = (fact.values[field] ?? '').trim();
        if (!value) blockers.push(DATE_FIELDS.has(field) ? 'Data mancante nel documento: inseriscila solo se nota.' : `Campo obbligatorio mancante: ${field}.`);
    }
    for (const field of DATE_FIELDS) {
        const value = (fact.values[field] ?? '').trim();
        if (value && !validIsoDate(value)) blockers.push(`Data non valida: ${field}.`);
    }
    if (fact.kind === 'diagnosis' && fact.values.code && !['ICD-9', 'ICD-10', 'ICD-11'].includes(fact.values.system ?? '')) {
        blockers.push('Un codice di diagnosi richiede il sistema di codifica.');
    }
    if (fact.kind === 'exemption' && context.exemptionCodes && !context.exemptionCodes.has((fact.values.code ?? '').toUpperCase())) {
        blockers.push('Codice di esenzione assente dal catalogo locale.');
    }
    if (fact.kind === 'therapy' && !['active', 'suspended', 'completed'].includes(fact.values.status ?? '')) {
        blockers.push('Stato della terapia non valido.');
    }
    if (fact.kind === 'reported_scale' && !/^-?\d+(?:[.,]\d+)?$/u.test((fact.values.scaleTotal ?? '').trim())) {
        blockers.push('Il totale della scala deve essere un numero trascritto dal documento.');
    }
    return [...new Set(blockers)];
}

// ---------------------------------------------------------------------------
// Confronto con la scheda e con le altre fonti
// ---------------------------------------------------------------------------

export interface DossierCurrentRecords {
    diagnoses: ReadonlyArray<{ code?: string; system?: string; description?: string; date?: string }>;
    exemptions: readonly string[];
    therapies: ReadonlyArray<{ id: string; drugName: string; dosage: string; status: string; startDate?: string; endDate?: string }>;
    observations: ReadonlyArray<{ id: string; code?: string; display: string; value: string; unitCode?: string; observedAt?: string }>;
    entries: ReadonlyArray<{ id: string; dossierFactRef?: string }>;
    servicePrescriptions: ReadonlyArray<{ id: string; serviceName: string; prescribedAt?: string; requestReference?: string; priority?: string; clinicalQuestion?: string }>;
    prostheticPrescriptions: ReadonlyArray<{ id: string; description: string; prescribedAt?: string; status?: string; isoCode?: string }>;
}

export type DossierAssessmentStatus = 'new' | 'already_present' | 'duplicate_in_dossier' | 'conflict';
export interface DossierFactAssessment { status: DossierAssessmentStatus; detail: string; relatedFactRefs: string[] }

export function dossierFactRef(documentKey: string, factId: string): string { return `${documentKey}#${factId}`; }

/** Stesso soggetto clinico (non stesso contenuto): farmaco e data, esame e data, codice. */
function identityKey(fact: DossierFact): string | null {
    const v = fact.values;
    switch (fact.kind) {
        case 'diagnosis': return v.code ? `dx:${(v.system ?? '').toUpperCase()}:${v.code.toUpperCase()}` : v.description ? `dx-text:${identityName(v.description)}` : null;
        case 'exemption': return v.code ? `ex:${v.code.toUpperCase()}` : null;
        case 'therapy': return v.drugName ? `rx:${identityName(v.drugName)}:${clinicalDay(v.startDate)}` : null;
        case 'observation': return (v.code || v.display) ? `obs:${identityName(v.code || v.display)}:${clinicalDay(v.observedAt)}` : null;
        case 'service_prescription': return v.requestReference ? `sp-ref:${identityName(v.requestReference)}` : v.serviceName ? `sp:${identityName(v.serviceName)}:${clinicalDay(v.prescribedAt)}` : null;
        case 'prosthetic': return v.description ? `pr:${identityName(v.description)}:${clinicalDay(v.prescribedAt)}` : null;
        case 'reported_scale': return v.scaleName ? `scale:${identityName(v.scaleName)}:${clinicalDay(v.date)}` : null;
        default: return null;
    }
}

const observationUnit = (values: DossierFactValues) => values.unitCode || values.unit || '';
const itemList = (value: string | undefined) => (value ?? '').split('\n').map((item) => identityName(item)).filter(Boolean).sort().join('|');

/** Campi clinicamente diversi fra due fatti dello stesso soggetto. Vuoto = stesso contenuto. */
export function dossierFactDifferences(left: DossierFact, right: DossierFact): string[] {
    const a = left.values; const b = right.values;
    const differences: string[] = [];
    const check = (label: string, same: boolean) => { if (!same) differences.push(label); };
    switch (left.kind) {
        case 'therapy':
            check('posologia', sameDosage(a.dosage, b.dosage)); check('stato', sameOptional(a.status, b.status)); check('fine', sameDay(a.endDate, b.endDate));
            break;
        case 'observation':
            check('valore', sameClinicalValue(a.value, b.value)); check('unità', sameUnit(observationUnit(a), observationUnit(b)));
            break;
        case 'diagnosis':
            if (!a.code) check('descrizione', sameClinicalText(a.description, b.description));
            break;
        case 'service_prescription':
            check('voci', itemList(a.items) === itemList(b.items)); check('priorità', sameOptional(a.priority, b.priority));
            check('quesito', sameClinicalText(a.clinicalQuestion, b.clinicalQuestion)); check('data', sameDay(a.prescribedAt, b.prescribedAt));
            break;
        case 'prosthetic':
            check('stato', sameOptional(a.status, b.status)); check('codice ISO', sameOptional(a.isoCode, b.isoCode));
            break;
        case 'reported_scale':
            check('totale', sameClinicalValue(a.scaleTotal, b.scaleTotal)); check('massimo', sameOptional(a.scaleMax, b.scaleMax));
            break;
        default:
            break;
    }
    return differences;
}

/**
 * Classifica ogni fatto rispetto alla scheda corrente e alle fonti precedenti del dossier
 * (ordinate per data del documento; senza data restano dopo). Non decide nulla: segnala.
 * Stesso soggetto con contenuto diverso è sempre un conflitto, mai un duplicato.
 */
export function reconcileDossierFacts(
    documents: ReadonlyArray<{ documentKey: string; documentDate: string | null; facts: readonly DossierFact[] }>,
    current: DossierCurrentRecords,
): Map<string, DossierFactAssessment> {
    const result = new Map<string, DossierFactAssessment>();
    const ordered = [...documents].sort((a, b) => (a.documentDate ?? '9999').localeCompare(b.documentDate ?? '9999') || a.documentKey.localeCompare(b.documentKey));
    const seenByKey = new Map<string, Array<{ ref: string; fact: DossierFact }>>();
    for (const document of ordered) {
        for (const fact of document.facts) {
            const ref = dossierFactRef(document.documentKey, fact.factId);
            if (fact.decision === 'rejected') { result.set(ref, { status: 'new', detail: 'Rifiutato', relatedFactRefs: [] }); continue; }
            const presence = currentPresence(fact, ref, current);
            if (presence) { result.set(ref, presence); continue; }
            const key = identityKey(fact);
            if (key) {
                const earlier = seenByKey.get(key) ?? [];
                seenByKey.set(key, [...earlier, { ref, fact }]);
                const different = earlier.map((item) => ({ item, differences: dossierFactDifferences(item.fact, fact) })).filter((entry) => entry.differences.length);
                if (different.length) {
                    result.set(ref, { status: 'conflict', detail: `Stesso soggetto in un’altra fonte con ${[...new Set(different.flatMap((entry) => entry.differences))].join(', ')} diversi.`,
                        relatedFactRefs: different.map((entry) => entry.item.ref) });
                    continue;
                }
                if (earlier.length) {
                    result.set(ref, { status: 'duplicate_in_dossier', detail: 'Stesso contenuto in un’altra fonte del dossier.', relatedFactRefs: earlier.map((item) => item.ref) });
                    continue;
                }
            }
            result.set(ref, { status: 'new', detail: 'Non presente in scheda.', relatedFactRefs: [] });
        }
    }
    return result;
}

function currentPresence(fact: DossierFact, ref: string, current: DossierCurrentRecords): DossierFactAssessment | null {
    const v = fact.values;
    const present = (detail: string): DossierFactAssessment => ({ status: 'already_present', detail, relatedFactRefs: [] });
    const conflict = (detail: string): DossierFactAssessment => ({ status: 'conflict', detail, relatedFactRefs: [] });
    switch (fact.kind) {
        case 'diagnosis': {
            const match = current.diagnoses.find((diagnosis) => v.code
                ? (diagnosis.code ?? '').toUpperCase() === v.code.toUpperCase() && (diagnosis.system ?? '').toUpperCase() === (v.system ?? '').toUpperCase()
                : Boolean(v.description) && sameClinicalText(diagnosis.description, v.description));
            return match ? present('Diagnosi già in scheda.') : null;
        }
        case 'exemption':
            return current.exemptions.some((code) => code.toUpperCase() === (v.code ?? '').toUpperCase()) ? present('Esenzione già in scheda.') : null;
        case 'therapy': {
            const sameDrug = current.therapies.filter((therapy) => identityName(therapy.drugName) === identityName(v.drugName));
            if (!sameDrug.length) return null;
            const identical = sameDrug.find((therapy) => sameDosage(therapy.dosage, v.dosage) && sameOptional(therapy.status, v.status)
                && sameDay(therapy.startDate, v.startDate) && sameDay(therapy.endDate, v.endDate));
            if (identical) return present('Terapia già in scheda con stessa posologia, stato e date.');
            const other = sameDrug[0];
            return conflict(`Farmaco già in scheda (stato ${other.status}, posologia ${other.dosage}) con posologia, stato o date diversi. Valuta se è una terapia storica.`);
        }
        case 'observation': {
            if (!clinicalDay(v.observedAt)) return null;
            const sameExam = current.observations.filter((observation) => identityName(observation.code || observation.display) === identityName(v.code || v.display)
                && sameDay(observation.observedAt, v.observedAt));
            if (!sameExam.length) return null;
            if (sameExam.some((observation) => sameClinicalValue(observation.value, v.value) && sameUnit(observation.unitCode, observationUnit(v)))) return present('Osservazione già in scheda.');
            return conflict('In scheda c’è lo stesso esame alla stessa data con valore o unità diversi.');
        }
        case 'service_prescription': {
            const match = current.servicePrescriptions.find((item) => (v.requestReference && sameOptional(item.requestReference, v.requestReference))
                || (identityName(item.serviceName) === identityName(v.serviceName) && clinicalDay(v.prescribedAt) !== '' && sameDay(item.prescribedAt, v.prescribedAt)));
            if (!match) return null;
            return identityName(match.serviceName) === identityName(v.serviceName) && sameOptional(match.priority, v.priority)
                ? present('Prescrizione già in scheda.') : conflict('In scheda c’è una prescrizione con lo stesso riferimento e contenuto diverso.');
        }
        case 'prosthetic': {
            const match = current.prostheticPrescriptions.find((item) => identityName(item.description) === identityName(v.description) && sameDay(item.prescribedAt, v.prescribedAt));
            if (!match) return null;
            return sameOptional(match.status, v.status) && sameOptional(match.isoCode, v.isoCode) ? present('Ausilio già in scheda.')
                : conflict('In scheda c’è lo stesso ausilio alla stessa data con stato o codice diversi.');
        }
        default:
            return current.entries.some((entry) => entry.dossierFactRef === ref) ? present('Voce già nel diario.') : null;
    }
}

// ---------------------------------------------------------------------------
// Record dossier nell'artefatto cifrato
// ---------------------------------------------------------------------------

export type DossierAppliedOutcome = 'applied' | 'already_present' | 'conflict' | 'failed' | 'uncertain';

export interface DossierAppliedEntry {
    factId: string;
    target: (typeof DOSSIER_FACT_TARGET)[DossierFactKind];
    recordId: string | null;
    outcome: DossierAppliedOutcome;
    at: string;
    detail?: string;
    /** Impronta del fatto (decisione e valori) per cui è avvenuta la scrittura. */
    factFingerprint?: string;
}

/** Autorizzazione a scrivere un fatto, persistita con CAS prima di ogni invio. */
export interface DossierWriteClaim { factId: string; recordId: string | null; factFingerprint: string; at: string }

export interface DossierExtractionAttempt { at: string; outcome: 'extracted' | 'failed'; detail?: DossierExtractionFailureDetail }

export interface DossierRecord {
    schemaVersion: typeof DOSSIER_SCHEMA_VERSION;
    /** Identità opaca stabile della fonte, creata prima del primo invio. */
    importId: string;
    source: { sha256: string; byteLength: number; mediaType: string; kind: DossierSourceKind; relativePath: string; fileName: string };
    /** `verifiedSourceRef`: la currentness host dell'allegato confrontato; una sorgente diversa annulla l'attestazione. */
    preservation: { state: 'pending_readback' | 'verified' | 'mismatch'; verifiedAt?: string; verifiedSourceRef?: string; reusedExisting: boolean };
    /** Byte cifrati dell'originale misurati prima dell'invio; assente se l'originale era già in MediFlow. */
    storage?: { originalCiphertextChars: number; measuredAt: string };
    extractionAttempts?: DossierExtractionAttempt[];
    pendingWrites?: DossierWriteClaim[];
    extraction: DossierExtraction;
    identity: { taxCodes: DossierTaxCodeEvidence[]; status: DossierIdentityStatus; confirmedAt: string };
    documentDate: { value: string; source: 'text' | 'file_name' | 'physician' } | null;
    classification: DocumentDecisionClassification;
    facts: DossierFact[];
    residualReview: { state: 'pending' | 'acknowledged'; at?: string; note?: string };
    applied: DossierAppliedEntry[];
    updatedAt: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Impronta sincrona del contenuto deciso di un fatto (non è una firma: rileva cambiamenti). */
export function dossierFactFingerprint(fact: DossierFact): string {
    const canonical = JSON.stringify([fact.factId, fact.kind, fact.decision, fact.negated, fact.recordId ?? null,
        Object.keys(fact.values).sort().map((key) => [key, fact.values[key]])]);
    const hash = (seed: number) => {
        let h1 = 0xdeadbeef ^ seed; let h2 = 0x41c6ce57 ^ seed;
        for (let index = 0; index < canonical.length; index += 1) {
            const code = canonical.charCodeAt(index);
            h1 = Math.imul(h1 ^ code, 2654435761); h2 = Math.imul(h2 ^ code, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
    };
    return `${hash(1)}${hash(2)}${canonical.length.toString(16)}`;
}

/** L'attestazione di conservazione vale solo per la sorgente host con cui è stata fatta. */
export function preservationIsCurrent(record: DossierRecord, sourceRef: string | undefined): boolean {
    return record.preservation.state === 'verified' && Boolean(sourceRef) && record.preservation.verifiedSourceRef === sourceRef;
}

function validFact(value: unknown): value is DossierFact {
    if (!isRecord(value) || typeof value.factId !== 'string' || typeof value.kind !== 'string' || !(value.kind in DOSSIER_FACT_TARGET)
        || typeof value.negated !== 'boolean' || !isRecord(value.values) || typeof value.decision !== 'string') return false;
    return Object.values(value.values).every((entry) => typeof entry === 'string')
        && ['pending', 'accepted', 'rejected', 'already_present'].includes(value.decision)
        && (value.recordId === undefined || typeof value.recordId === 'string');
}

/** Legge la chiave `dossier` dall'artefatto. Un record malformato vale come assente-ma-presente: `invalid`. */
export function readDossierRecord(snapshot: string | null | undefined): { status: 'absent' } | { status: 'invalid' } | { status: 'present'; record: DossierRecord } {
    if (!snapshot) return { status: 'absent' };
    let parsed: unknown;
    try { parsed = JSON.parse(snapshot); } catch { return { status: 'absent' }; }
    if (!isRecord(parsed) || parsed.dossier === undefined) return { status: 'absent' };
    const record = parsed.dossier;
    if (!isRecord(record) || record.schemaVersion !== DOSSIER_SCHEMA_VERSION || typeof record.importId !== 'string'
        || !isRecord(record.source) || typeof record.source.sha256 !== 'string' || !SHA256.test(record.source.sha256)
        || !Number.isSafeInteger(record.source.byteLength) || !isRecord(record.preservation) || !isRecord(record.extraction)
        || !Array.isArray(record.facts) || !record.facts.every(validFact) || !Array.isArray(record.applied)
        || !isRecord(record.residualReview) || !isRecord(record.identity)) return { status: 'invalid' };
    return { status: 'present', record: record as unknown as DossierRecord };
}

/** Testo completo del record, dove è conservato. Il chiamante ne verifica lo sha256. */
export function resolveDossierText(snapshot: string, record: DossierRecord): string | null {
    if (record.extraction.state !== 'extracted') return null;
    const text = record.extraction.text;
    if (text.location === 'inline') return typeof text.inline === 'string' ? text.inline : null;
    const v1 = parseDocumentParseEvidenceArtifactSnapshot(snapshot);
    return v1 ? v1.parseBundle.rawMarkdownExcerpt : null;
}

/**
 * Scrive il record nella chiave `dossier` conservando ogni altro campo. Un artefatto
 * esistente non v1 non viene sovrascritto: è un errore esplicito.
 */
export function writeDossierRecordIntoSnapshot(
    existing: string | null | undefined,
    record: DossierRecord,
    base: { attachmentId: string; fileName: string; text: string | null },
): string {
    if (existing) {
        let parsed: unknown;
        try { parsed = JSON.parse(existing); } catch { throw new DossierArtifactConflictError(); }
        if (!isRecord(parsed) || parsed.schemaVersion !== DOCUMENT_PARSE_EVIDENCE_ARTIFACT_SCHEMA_VERSION
            || !parseDocumentParseEvidenceArtifactSnapshot(existing)) throw new DossierArtifactConflictError();
        return JSON.stringify({ ...parsed, dossier: record });
    }
    const artifact = buildDocumentParseEvidenceArtifact({
        documentInsightId: `dossier:${record.importId}`,
        attachmentId: base.attachmentId,
        fileName: base.fileName,
        documentDate: record.documentDate?.value ?? '',
        summary: '',
        rawMarkdown: base.text ?? '',
        diagnoses: [],
        medications: [],
    });
    return JSON.stringify({ ...artifact, dossier: record });
}

export class DossierArtifactConflictError extends Error {
    constructor() { super('Existing parse evidence artifact is not v1 and is left untouched.'); }
}

// ---------------------------------------------------------------------------
// Copertura: nessun claim su ciò che non è stato letto o deciso
// ---------------------------------------------------------------------------

export type DossierGap =
    | 'not_preserved' | 'readback_mismatch' | 'not_extracted' | 'extraction_failed' | 'text_unverified'
    | 'facts_pending' | 'residual_pending' | 'apply_pending' | 'apply_uncertain' | 'apply_conflict' | 'apply_failed' | 'identity_conflict';

export const DOSSIER_GAP_LABELS: Record<DossierGap, string> = {
    not_preserved: 'Originale non ancora riletto', readback_mismatch: 'Originale riletto diverso dalla fonte',
    not_extracted: 'Formato senza estrazione', extraction_failed: 'Estrazione non riuscita',
    text_unverified: 'Testo conservato non verificabile', facts_pending: 'Fatti da decidere',
    residual_pending: 'Testo residuo da rivedere', apply_pending: 'Scritture da eseguire',
    apply_uncertain: 'Esito di scrittura incerto', apply_conflict: 'Conflitto in scrittura', apply_failed: 'Scrittura non riuscita',
    identity_conflict: 'Il codice fiscale letto non corrisponde alla scheda o identifica più pazienti: applicazione bloccata.',
};

export interface DossierCoverage { complete: boolean; gaps: DossierGap[] }

export function evaluateDossierCoverage(record: DossierRecord, textVerified: boolean, sourceRef?: string): DossierCoverage {
    const gaps: DossierGap[] = [];
    if (['mixed', 'discordant'].includes(record.identity.status)) gaps.push('identity_conflict');
    if (record.preservation.state === 'pending_readback') gaps.push('not_preserved');
    // Un'attestazione fatta su un'altra sorgente host non vale più.
    if (record.preservation.state === 'verified' && sourceRef !== undefined && !preservationIsCurrent(record, sourceRef)) gaps.push('not_preserved');
    if (record.preservation.state === 'mismatch') gaps.push('readback_mismatch');
    if (record.extraction.state === 'not_extracted') gaps.push('not_extracted');
    if (record.extraction.state === 'failed') gaps.push('extraction_failed');
    if (record.extraction.state === 'extracted' && !textVerified) gaps.push('text_unverified');
    if (record.facts.some((fact) => fact.decision === 'pending')) gaps.push('facts_pending');
    if (record.residualReview.state !== 'acknowledged') gaps.push('residual_pending');
    for (const fact of record.facts.filter((item) => item.decision === 'accepted')) {
        if (record.pendingWrites?.some((claim) => claim.factId === fact.factId)) { gaps.push('apply_uncertain'); continue; }
        const last = latestAppliedOutcome(record, fact.factId);
        const outcome = last?.outcome;
        // Una scrittura vale per la revisione con cui è avvenuta, non per contenuti decisi dopo.
        if ((outcome === 'applied' || outcome === 'already_present') && last?.factFingerprint && last.factFingerprint !== dossierFactFingerprint(fact)) {
            gaps.push('apply_conflict'); continue;
        }
        if (outcome === 'applied' || outcome === 'already_present') continue;
        gaps.push(outcome === 'uncertain' ? 'apply_uncertain' : outcome === 'conflict' ? 'apply_conflict' : outcome === 'failed' ? 'apply_failed' : 'apply_pending');
    }
    const unique = [...new Set(gaps)];
    return { complete: unique.length === 0, gaps: unique };
}

export function latestAppliedOutcome(record: DossierRecord, factId: string): DossierAppliedEntry | undefined {
    for (let index = record.applied.length - 1; index >= 0; index -= 1) if (record.applied[index].factId === factId) return record.applied[index];
    return undefined;
}

// ---------------------------------------------------------------------------
// Ricevuta aggregata: conteggi, nessun nome, testo, codice o identificativo
// ---------------------------------------------------------------------------

export interface DossierReceipt {
    schemaVersion: typeof DOSSIER_RECEIPT_SCHEMA_VERSION;
    generatedAt: string;
    sources: number;
    byKind: Partial<Record<DossierSourceKind, number>>;
    preservedVerified: number;
    extracted: number;
    extractionFailed: number;
    notExtracted: number;
    complete: number;
    factsAccepted: number;
    factsApplied: number;
    gaps: Partial<Record<DossierGap, number>>;
    /** Caratteri cifrati misurati sulla serializzazione effettiva; non sono byte SQLite né backup. */
    measuredStoredBytes: { originals: number; originalsUnmeasured: number; artifacts: number; artifactsUnmeasured: number };
}

export function buildDossierReceipt(
    entries: ReadonlyArray<{ record: DossierRecord; coverage: DossierCoverage; artifactCiphertextChars?: number | null }>,
    now: Date,
): DossierReceipt {
    const byKind: Partial<Record<DossierSourceKind, number>> = {};
    const gaps: Partial<Record<DossierGap, number>> = {};
    let originals = 0; let artifacts = 0; let originalsUnmeasured = 0; let artifactsUnmeasured = 0;
    for (const { record, coverage, artifactCiphertextChars } of entries) {
        byKind[record.source.kind] = (byKind[record.source.kind] ?? 0) + 1;
        for (const gap of coverage.gaps) gaps[gap] = (gaps[gap] ?? 0) + 1;
        if (record.storage) originals += record.storage.originalCiphertextChars; else originalsUnmeasured += 1;
        if (typeof artifactCiphertextChars === 'number') artifacts += artifactCiphertextChars; else artifactsUnmeasured += 1;
    }
    const accepted = entries.flatMap(({ record }) => record.facts.filter((fact) => fact.decision === 'accepted').map((fact) => ({ record, fact })));
    return {
        schemaVersion: DOSSIER_RECEIPT_SCHEMA_VERSION,
        generatedAt: now.toISOString(),
        sources: entries.length,
        byKind,
        preservedVerified: entries.filter(({ record, coverage }) => record.preservation.state === 'verified'
            && !coverage.gaps.includes('not_preserved') && !coverage.gaps.includes('readback_mismatch')).length,
        extracted: entries.filter(({ record }) => record.extraction.state === 'extracted').length,
        extractionFailed: entries.filter(({ record }) => record.extraction.state === 'failed').length,
        notExtracted: entries.filter(({ record }) => record.extraction.state === 'not_extracted').length,
        complete: entries.filter(({ coverage }) => coverage.complete).length,
        factsAccepted: accepted.length,
        factsApplied: accepted.filter(({ record, fact }) => {
            const outcome = latestAppliedOutcome(record, fact.factId)?.outcome;
            return outcome === 'applied' || outcome === 'already_present';
        }).length,
        gaps,
        measuredStoredBytes: { originals, originalsUnmeasured, artifacts, artifactsUnmeasured },
    };
}
