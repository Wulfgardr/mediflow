/**
 * Estrazione preparata per il dossier (ADR 0176). Solo proposte: questo modulo non scrive.
 *
 * Una estrazione preparata è un file JSON prodotto fuori da MediFlow (la skill
 * `mediflow-dossier-import`) che, per ogni fonte riconosciuta dallo sha256 dei byte,
 * propone identità del paziente, fatti clinici con una citazione testuale e una sintesi.
 * MediFlow la tratta come dato non fidato:
 *
 * - la fonte si abbina solo per sha256, mai per nome;
 * - ogni citazione si cerca nel testo che MediFlow stessa ha estratto dall'originale;
 *   se manca, il fatto resta da decidere e non entra nell'accettazione in blocco;
 * - i valori chiave (farmaco, codice, valore, totale) devono comparire nella citazione;
 * - codici LOINC/UCUM solo dal catalogo locale; date solo ISO valide;
 * - una terapia «in corso» di un documento non recente torna storica.
 *
 * L'accettazione in blocco (`preparedBulkDecisions`) decide solo ciò che è verificato,
 * nuovo rispetto alla scheda e senza blocchi; conflitti e incertezze restano al medico.
 */

import { isValidItalianTaxCodeChecksum } from './document-identity-resolution';
import { catalogObservationCode } from './dossier-sections';
import {
    DOSSIER_FACT_TARGET, dossierFactBlockers, dossierFactId, unitText,
    type DossierEvidence, type DossierFact, type DossierFactAssessment, type DossierFactKind, type DossierRecord, type DossierUnit,
} from './dossier-import';

export const DOSSIER_PREPARED_SCHEMA = 'mediflow.dossier_prepared_extraction.v1' as const;
/** Limite del file letto dal browser. */
export const DOSSIER_PREPARED_MAX_BYTES = 20 * 1024 * 1024;
/** Una terapia «in corso» vale solo per documenti recenti rispetto all'importazione. */
export const PREPARED_ACTIVE_THERAPY_MAX_AGE_DAYS = 120;

export interface PreparedPatient { taxCode?: string; lastName?: string; firstName?: string; birthDate?: string }
export interface PreparedFactInput { kind: DossierFactKind; values: Record<string, string>; quote?: string }
export interface PreparedCoverage { pages: number | null; unreadablePages: number[]; complete: boolean; note: string }
export interface PreparedSource {
    sha256: string;
    fileName: string;
    patient: PreparedPatient | null;
    documentDate: string | null;
    documentType: string;
    summary: { title: string; text: string; date: string } | null;
    facts: PreparedFactInput[];
    coverage: PreparedCoverage;
}
export interface PreparedExtraction { schema: typeof DOSSIER_PREPARED_SCHEMA; preparedAt: string; preparedBy: string; sources: PreparedSource[] }

export type PreparedParseResult = { ok: true; value: PreparedExtraction; warnings: string[] } | { ok: false; error: string };

/** Campi ammessi per tipo: il resto viene scartato. I qualificatori sono comuni a tutti. */
const FIELDS: Record<DossierFactKind, readonly string[]> = {
    diagnosis: ['description', 'code', 'system', 'date'],
    exemption: ['code'],
    therapy: ['drugName', 'activePrinciple', 'dosage', 'status', 'startDate', 'endDate', 'aic', 'atc'],
    observation: ['display', 'value', 'unit', 'code', 'unitCode', 'refText', 'refLow', 'refHigh', 'observedAt'],
    service_prescription: ['serviceName', 'items', 'category', 'priority', 'prescribedAt', 'requestReference', 'clinicalQuestion'],
    prosthetic: ['description', 'isoCode', 'category', 'status', 'prescribedAt'],
    reported_scale: ['scaleName', 'scaleTotal', 'scaleMax', 'date', 'text'],
    invalidity: ['title', 'date', 'text', 'percentage', 'allowance'],
    anamnesis: ['title', 'date', 'text'], assessment: ['title', 'date', 'text'], imaging_report: ['title', 'date', 'text'],
    care_context: ['title', 'date', 'text'], document_entry: ['title', 'date', 'text'],
};
const QUALIFIERS = ['subject', 'temporality', 'certainty'] as const;
const DATE_FIELDS = new Set(['date', 'startDate', 'endDate', 'observedAt', 'prescribedAt', 'birthDate']);
/** Valori che devono comparire nella citazione, se presenti. */
const ANCHORS: Partial<Record<DossierFactKind, readonly string[]>> = {
    therapy: ['drugName'], diagnosis: ['code'], exemption: ['code'], observation: ['value'], prosthetic: ['isoCode'],
    reported_scale: ['scaleTotal'], invalidity: ['percentage'], service_prescription: ['requestReference'],
};

export const PREPARED_CHECK_LABELS = {
    verified: 'Citazione trovata nel testo del documento',
    approximate: 'Citazione trovata con piccole differenze di lettura',
    not_found: 'Citazione non trovata nel testo del documento: verifica prima di accettare',
    value_missing: 'Un valore proposto non compare nella citazione: verifica prima di accettare',
    no_text: 'Testo del documento non disponibile in MediFlow: verifica sull’originale',
    no_quote: 'Proposta senza citazione: verifica sull’originale',
    summary: 'Sintesi dell’estrazione preparata',
} as const;
export type PreparedCheck = keyof typeof PREPARED_CHECK_LABELS;

const SHA256 = /^[a-f0-9]{64}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}$/u;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max = 20000): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function validIso(value: string): boolean {
    if (!ISO.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// ---------------------------------------------------------------------------
// Lettura del file
// ---------------------------------------------------------------------------

export function parsePreparedExtraction(json: string): PreparedParseResult {
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { return { ok: false, error: 'Il file non è JSON valido.' }; }
    if (!isRecord(parsed) || parsed.schema !== DOSSIER_PREPARED_SCHEMA || !Array.isArray(parsed.sources)) {
        return { ok: false, error: `Il file non è un’estrazione preparata (${DOSSIER_PREPARED_SCHEMA}).` };
    }
    const warnings: string[] = [];
    const sources: PreparedSource[] = [];
    const seen = new Set<string>();
    parsed.sources.forEach((raw, index) => {
        if (!isRecord(raw)) { warnings.push(`Fonte ${index + 1}: formato non valido, ignorata.`); return; }
        const sha256 = str(raw.sha256).toLowerCase();
        if (!SHA256.test(sha256)) { warnings.push(`Fonte ${index + 1}: sha256 mancante o non valido, ignorata.`); return; }
        if (seen.has(sha256)) { warnings.push(`Fonte ${index + 1}: sha256 ripetuto, ignorata.`); return; }
        seen.add(sha256);
        const patientRaw = isRecord(raw.patient) ? raw.patient : null;
        const patient: PreparedPatient | null = patientRaw ? {
            taxCode: str(patientRaw.taxCode, 16).toUpperCase() || undefined,
            lastName: str(patientRaw.lastName, 120) || undefined,
            firstName: str(patientRaw.firstName, 120) || undefined,
            birthDate: validIso(str(patientRaw.birthDate, 10)) ? str(patientRaw.birthDate, 10) : undefined,
        } : null;
        const documentDate = validIso(str(raw.documentDate, 10)) ? str(raw.documentDate, 10) : null;
        const summaryRaw = isRecord(raw.summary) ? raw.summary : null;
        const summaryText = summaryRaw ? str(summaryRaw.text) : '';
        const summary = summaryText ? { title: str(summaryRaw!.title, 200) || 'Sintesi del documento', text: summaryText,
            date: validIso(str(summaryRaw!.date, 10)) ? str(summaryRaw!.date, 10) : documentDate ?? '' } : null;
        const facts: PreparedFactInput[] = [];
        (Array.isArray(raw.facts) ? raw.facts : []).forEach((item, factIndex) => {
            if (!isRecord(item) || typeof item.kind !== 'string' || !(item.kind in DOSSIER_FACT_TARGET) || !isRecord(item.values)) {
                warnings.push(`Fonte ${index + 1}, fatto ${factIndex + 1}: tipo o valori non validi, ignorato.`); return;
            }
            const kind = item.kind as DossierFactKind;
            const values: Record<string, string> = {};
            for (const field of [...FIELDS[kind], ...QUALIFIERS]) {
                const value = str((item.values as Record<string, unknown>)[field]);
                if (value) values[field] = value;
            }
            facts.push({ kind, values, quote: str(item.quote, 600) || undefined });
        });
        const coverageRaw = isRecord(raw.coverage) ? raw.coverage : {};
        const pages = Number.isSafeInteger(coverageRaw.pages) && (coverageRaw.pages as number) > 0 ? coverageRaw.pages as number : null;
        const unreadablePages = Array.isArray(coverageRaw.unreadablePages)
            ? coverageRaw.unreadablePages.filter((page): page is number => Number.isSafeInteger(page) && (page as number) > 0) : [];
        sources.push({
            sha256, fileName: str(raw.fileName, 400), patient, documentDate, documentType: str(raw.documentType, 80), summary, facts,
            coverage: { pages, unreadablePages, complete: coverageRaw.complete === true && unreadablePages.length === 0, note: str(coverageRaw.note, 2000) },
        });
    });
    return { ok: true, value: { schema: DOSSIER_PREPARED_SCHEMA, preparedAt: str(parsed.preparedAt, 40), preparedBy: str(parsed.preparedBy, 120), sources }, warnings };
}

export function preparedBySha(extraction: PreparedExtraction | null | undefined): Map<string, PreparedSource> {
    return new Map((extraction?.sources ?? []).map((source) => [source.sha256, source]));
}

/** Chiave di raggruppamento per paziente: CF valido, altrimenti cognome, nome e nascita. */
export function preparedPatientKey(patient: PreparedPatient | null): string | null {
    if (!patient) return null;
    if (patient.taxCode && isValidItalianTaxCodeChecksum(patient.taxCode)) return `cf:${patient.taxCode}`;
    const name = [patient.lastName, patient.firstName].map((part) => (part ?? '').toLocaleLowerCase('it-IT').replace(/\s+/gu, ' ').trim());
    if (name[0] && name[1]) return `nome:${name[0]}|${name[1]}|${patient.birthDate ?? ''}`;
    return null;
}

export function preparedPatientLabel(patient: PreparedPatient | null): string {
    if (!patient) return '';
    return [[patient.lastName, patient.firstName].filter(Boolean).join(' '), patient.taxCode, patient.birthDate].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Citazioni: confronto per parole, sugli offset del testo conservato
// ---------------------------------------------------------------------------

interface Token { text: string; start: number; end: number }

export function preparedTokens(text: string): Token[] {
    const tokens: Token[] = [];
    for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
        const normalized = match[0].normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('it-IT');
        tokens.push({ text: normalized, start: match.index!, end: match.index! + match[0].length });
    }
    return tokens;
}

function withinOneEdit(a: string, b: string): boolean {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0; let j = 0; let edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i += 1; j += 1; continue; }
        edits += 1;
        if (edits > 1) return false;
        if (a.length > b.length) i += 1; else if (b.length > a.length) j += 1; else { i += 1; j += 1; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Due parole coincidono; con lettura OCR imperfetta, una sola differenza per parole lunghe non numeriche. */
function tokenMatches(doc: string, quote: string, approximate: boolean): boolean {
    if (doc === quote) return true;
    if (!approximate || /\d/u.test(doc) || /\d/u.test(quote) || quote.length < 5) return false;
    return withinOneEdit(doc, quote);
}

export interface PreparedAnchor { evidence: DossierEvidence; match: 'exact' | 'approximate' }

/** Trova la citazione nel testo per unità. Esatta per parole, altrimenti approssimata (≥ 85% delle parole). */
export function anchorPreparedQuote(text: string, units: readonly DossierUnit[], quote: string): PreparedAnchor | null {
    const wanted = preparedTokens(quote).map((token) => token.text);
    if (!wanted.length) return null;
    let best: { unit: DossierUnit; from: Token; to: Token; score: number } | null = null;
    for (const approximate of [false, true]) {
        for (const unit of units) {
            const body = unitText(text, unit);
            const tokens = preparedTokens(body);
            for (let start = 0; start + wanted.length <= tokens.length; start += 1) {
                let hits = 0; let numericMiss = false;
                for (let k = 0; k < wanted.length; k += 1) {
                    if (tokenMatches(tokens[start + k].text, wanted[k], approximate)) hits += 1;
                    // Dosi, valori, date: una cifra diversa esclude la finestra, anche in lettura approssimata.
                    else if (/\d/u.test(wanted[k]) || /\d/u.test(tokens[start + k].text)) { numericMiss = true; break; }
                }
                if (numericMiss) continue;
                const score = hits / wanted.length;
                if (!approximate && score === 1) {
                    return { match: 'exact', evidence: { unit: unit.index, start: tokens[start].start, end: tokens[start + wanted.length - 1].end,
                        excerpt: body.slice(tokens[start].start, tokens[start + wanted.length - 1].end).replace(/\s+/gu, ' ').trim() } };
                }
                if (approximate && wanted.length >= 3 && score >= 0.85 && (!best || score > best.score)) {
                    best = { unit, from: tokens[start], to: tokens[start + wanted.length - 1], score };
                }
            }
        }
    }
    if (!best) return null;
    const body = unitText(text, best.unit);
    return { match: 'approximate', evidence: { unit: best.unit.index, start: best.from.start, end: best.to.end,
        excerpt: body.slice(best.from.start, best.to.end).replace(/\s+/gu, ' ').trim() } };
}

/** Le parole del valore compaiono, in ordine e contigue, nella citazione. */
export function valueInQuote(value: string, quote: string): boolean {
    const v = preparedTokens(value).map((token) => token.text);
    const q = preparedTokens(quote).map((token) => token.text);
    if (!v.length) return true;
    outer: for (let start = 0; start + v.length <= q.length; start += 1) {
        for (let k = 0; k < v.length; k += 1) if (q[start + k] !== v[k]) continue outer;
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Fatti dall'estrazione preparata
// ---------------------------------------------------------------------------

export interface PreparedFactsInput {
    source: PreparedSource;
    /** Testo estratto da MediFlow; null se l'estrazione non è riuscita. */
    text: string | null;
    units: readonly DossierUnit[];
    documentDate: string | null;
    /** Proposte dei parser locali per la stessa fonte. */
    parserFacts: readonly DossierFact[];
    now: Date;
}

export interface PreparedFactsResult { facts: DossierFact[]; notes: string[] }

function daysBetween(fromIso: string, to: Date): number {
    return Math.floor((to.getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
}

/**
 * Converte le proposte preparate in fatti del dossier. Le proposte deterministiche con
 * codice (ICD etichettati, esenzioni del catalogo, laboratorio codificato) restano; le
 * proposte per sezione e la voce di diario col testo intero lasciano il posto alla
 * sintesi preparata, perché descrivono lo stesso contenuto con meno precisione.
 */
export function preparedDossierFacts(input: PreparedFactsInput): PreparedFactsResult {
    const { source, text, units, now } = input;
    const date = source.documentDate ?? input.documentDate ?? '';
    const notes: string[] = [];
    const keptParser = input.parserFacts.filter((fact) => fact.origin === 'parser:icd' || fact.origin === 'parser:exemption'
        || (fact.origin === 'parser:lab' && Boolean(fact.values.code)));
    const facts: DossierFact[] = [];
    let uncoded = 0;
    source.facts.forEach((item, index) => {
        const values: Record<string, string> = { ...item.values };
        for (const field of Object.keys(values)) if (DATE_FIELDS.has(field) && !validIso(values[field])) delete values[field];
        // Date e stati di default, mai la data di oggi.
        switch (item.kind) {
            case 'therapy': {
                values.startDate ||= date;
                if (!['active', 'suspended', 'completed'].includes(values.status ?? '')) values.status = 'completed';
                if (values.status === 'active' && (!date || daysBetween(date, now) > PREPARED_ACTIVE_THERAPY_MAX_AGE_DAYS)) {
                    values.status = 'completed';
                    values.temporality = [values.temporality, `in corso alla data del documento, non oltre ${PREPARED_ACTIVE_THERAPY_MAX_AGE_DAYS} giorni fa`].filter(Boolean).join('; ');
                }
                break;
            }
            case 'observation': {
                values.observedAt ||= date;
                if (!values.code || !values.unitCode) {
                    const coded = catalogObservationCode(values.display ?? '', values.unit ?? '');
                    if (!coded) { uncoded += 1; return; }
                    values.code = coded.code; values.unitCode = coded.unitCode; values.codeSource = 'catalogo locale: nome e unità coincidenti';
                }
                break;
            }
            case 'diagnosis': values.date ||= date; if (values.code && !values.system) values.system = 'ICD-10'; break;
            case 'service_prescription': values.prescribedAt ||= date; break;
            case 'prosthetic': values.prescribedAt ||= date; values.status ||= 'prescribed'; break;
            case 'exemption': values.code = (values.code ?? '').toUpperCase(); break;
            default: values.date ||= date; break;
        }
        let evidence: DossierEvidence | null = null;
        let check: PreparedCheck;
        if (!item.quote) check = 'no_quote';
        else if (text === null || !units.length) check = 'no_text';
        else {
            const anchor = anchorPreparedQuote(text, units, item.quote);
            if (!anchor) check = 'not_found';
            else {
                evidence = anchor.evidence;
                const anchors = (ANCHORS[item.kind] ?? []).filter((field) => values[field]);
                check = anchors.every((field) => valueInQuote(values[field], item.quote!)) ? (anchor.match === 'exact' ? 'verified' : 'approximate') : 'value_missing';
            }
        }
        values.preparedCheck = check;
        const factId = `p-${dossierFactId(item.kind, evidence?.unit ?? 0, evidence?.start ?? index, values)}`;
        // Una proposta preparata uguale a una del parser codificato non si ripete.
        if (keptParser.some((fact) => fact.kind === item.kind && sameIdentity(fact, values))) return;
        facts.push({ factId, kind: item.kind, origin: 'prepared', evidence, negated: false, values, decision: 'pending' });
    });
    if (uncoded) notes.push(`${uncoded} ${uncoded === 1 ? 'valore di laboratorio senza codice LOINC verificato resta' : 'valori di laboratorio senza codice LOINC verificato restano'} nella sintesi e nel testo conservato.`);
    if (source.summary) {
        const values: Record<string, string> = { title: source.summary.title, date: source.summary.date || date, text: source.summary.text,
            textSource: 'prepared', preparedCheck: 'summary', preparedCoverage: source.coverage.complete ? 'complete' : 'partial',
            ...(notes.length ? { preparedNotes: notes.join(' ') } : {}) };
        facts.push({ factId: `p-${dossierFactId('document_entry', 0, 0, { title: values.title, text: values.text })}`, kind: 'document_entry', origin: 'prepared',
            evidence: null, negated: false, values, decision: 'pending' });
    } else {
        notes.push('L’estrazione preparata non contiene una sintesi: resta la voce di diario col testo completo.');
    }
    const parserKept = source.summary ? keptParser : [...keptParser, ...input.parserFacts.filter((fact) => fact.origin === 'parser:document')];
    return { facts: [...parserKept, ...facts], notes };
}

function sameIdentity(fact: DossierFact, values: Record<string, string>): boolean {
    const v = fact.values;
    switch (fact.kind) {
        case 'diagnosis': return Boolean(v.code && values.code) && v.code.toUpperCase() === values.code.toUpperCase();
        case 'exemption': return v.code?.toUpperCase() === values.code?.toUpperCase();
        case 'observation': return v.code === values.code && v.observedAt === values.observedAt && preparedTokens(v.value ?? '').map((t) => t.text).join(' ') === preparedTokens(values.value ?? '').map((t) => t.text).join(' ');
        default: return false;
    }
}

// ---------------------------------------------------------------------------
// Accettazione in blocco: solo il verificato, nuovo e senza blocchi
// ---------------------------------------------------------------------------

export interface PreparedBulkInput {
    record: DossierRecord;
    documentKey: string;
    assessment: (ref: string) => DossierFactAssessment | undefined;
    exemptionCodes: ReadonlySet<string>;
    /** Riferimenti di fatti che la stessa operazione accetta in altri documenti. */
    acceptedElsewhere: ReadonlySet<string>;
}

export interface PreparedBulkResult {
    facts: DossierFact[];
    acknowledgeResidual: boolean;
    accepted: string[];
    counts: { accepted: number; alreadyPresent: number; superseded: number; leftPending: number };
}

const SUPERSEDED_ORIGINS = new Set<DossierFact['origin']>(['parser:section', 'parser:scale', 'parser:document']);

/** Una proposta entra nel blocco solo se verificabile sulla fonte. */
export function preparedFactEligible(fact: DossierFact, exemptionCodes: ReadonlySet<string>): boolean {
    if (fact.negated || dossierFactBlockers(fact, { exemptionCodes }).length) return false;
    if (fact.origin === 'manual') return false;
    if (fact.origin === 'prepared') {
        if (fact.values.preparedCheck === 'summary') return true;
        return Boolean(fact.evidence) && (fact.values.preparedCheck === 'verified' || fact.values.preparedCheck === 'approximate');
    }
    return Boolean(fact.evidence) && !SUPERSEDED_ORIGINS.has(fact.origin);
}

export function preparedBulkDecisions(input: PreparedBulkInput): PreparedBulkResult {
    const { record, documentKey } = input;
    const hasPrepared = record.facts.some((fact) => fact.origin === 'prepared');
    const counts = { accepted: 0, alreadyPresent: 0, superseded: 0, leftPending: 0 };
    const accepted: string[] = [];
    // Anche un fatto accettato poco prima nello stesso documento rende «già presente» il suo duplicato.
    const acceptedNow = new Set(input.acceptedElsewhere);
    const facts = record.facts.map((fact) => {
        if (fact.decision !== 'pending') return fact;
        const ref = `${documentKey}#${fact.factId}`;
        if (hasPrepared && SUPERSEDED_ORIGINS.has(fact.origin)) {
            counts.superseded += 1;
            return { ...fact, decision: 'rejected' as const, note: 'Sostituita dall’estrazione preparata verificata.' };
        }
        const assessment = input.assessment(ref);
        if (assessment?.status === 'already_present') { counts.alreadyPresent += 1; return { ...fact, decision: 'already_present' as const }; }
        if (assessment?.status === 'duplicate_in_dossier' && assessment.relatedFactRefs.length
            && assessment.relatedFactRefs.every((related) => acceptedNow.has(related))) {
            counts.alreadyPresent += 1;
            return { ...fact, decision: 'already_present' as const, note: 'Stesso contenuto di un’altra fonte accettata.' };
        }
        if ((!assessment || assessment.status === 'new') && preparedFactEligible(fact, input.exemptionCodes)) {
            counts.accepted += 1; accepted.push(ref); acceptedNow.add(ref);
            return { ...fact, decision: 'accepted' as const };
        }
        counts.leftPending += 1;
        return fact;
    });
    const summary = facts.find((fact) => fact.origin === 'prepared' && fact.values.preparedCheck === 'summary');
    const acknowledgeResidual = Boolean(summary && summary.values.preparedCoverage === 'complete');
    return { facts, acknowledgeResidual, accepted, counts };
}
