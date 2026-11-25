/**
 * Estrazione preparata per il dossier (ADR 0176). Solo proposte: questo modulo non scrive.
 *
 * Una estrazione preparata è un file JSON prodotto fuori da MediFlow (la skill
 * `mediflow-dossier-import`) che, per ogni fonte riconosciuta dallo sha256 dei byte,
 * propone paziente, fatti clinici con una citazione testuale e una sintesi. MediFlow la
 * tratta come dato non fidato:
 *
 * - la fonte si abbina solo per sha256, mai per nome;
 * - la citazione (almeno tre parole) si cerca nel testo che MediFlow stessa ha estratto;
 *   in lettura approssimata ogni parola può differire al più di una lettera, i numeri mai;
 * - i campi clinici del fatto (farmaco e dose, esame, valore e unità, descrizione, codici)
 *   si controllano sul passo del documento trovato, non sulla citazione proposta;
 * - i testi descrittivi passano solo se sono passi del documento; una riformulazione e la
 *   sintesi restano a una decisione esplicita del medico;
 * - LOINC/UCUM solo dal catalogo locale; date solo ISO, mai future; una terapia «in corso»
 *   di un documento non recente torna storica;
 * - il codice fiscale dell'estrazione serve solo a raggruppare: non entra nel controllo
 *   d'identità, che resta sui codici letti da MediFlow.
 */

import { clinicalFactContext, clinicalSentence, clinicalTokens, contextReview, isHistoricalTherapy, legacyPreparedFamily, legacyPreparedNegation, structuredContextApplies, type ClinicalContext } from './clinical-context-lexicon';
import { isValidItalianTaxCodeChecksum } from './document-identity-resolution';
import { catalogObservationCode } from './dossier-sections';
import { anchorTabularQuote } from './dossier-tabular-quote';
import {
    DOSSIER_FACT_TARGET, dossierFactBlockers, dossierFactId, latestAppliedOutcome, unitText,
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
/** Testi descrittivi: verificabili solo se il testo proposto è un passo del documento. */
const NARRATIVE = new Set<DossierFactKind>(['anamnesis', 'assessment', 'imaging_report', 'care_context', 'document_entry', 'invalidity']);
const NARRATIVE_TITLES: Partial<Record<DossierFactKind, string>> = {
    anamnesis: 'Anamnesi da documento', assessment: 'Valutazione da documento', imaging_report: 'Referto di imaging',
    care_context: 'Contesto assistenziale da documento', invalidity: 'Invalidità da documento', document_entry: 'Passo del documento',
};
export const PREPARED_MIN_QUOTE_WORDS = 3;
export const PREPARED_MIN_QUOTE_CHARS = 12;

export const PREPARED_CHECK_LABELS = {
    verified: 'Citazione e valori trovati nel testo del documento',
    approximate: 'Citazione e valori trovati, con una lettera diversa in qualche parola (lettura OCR)',
    not_found: 'Citazione non trovata nel testo del documento: verifica prima di accettare',
    value_missing: 'Un valore proposto non è scritto nel passo del documento accanto al suo esame o farmaco: verifica prima di accettare',
    status_conflict: 'Il passo parla di sospensione o interruzione ma la proposta è «in corso»: verifica prima di accettare',
    subject_conflict: 'Il passo si riferisce a un familiare: verifica a chi appartiene prima di accettare',
    short_quote: 'Citazione troppo breve per essere verificata: verifica sull’originale',
    paraphrase: 'Testo riformulato, non un passo del documento: leggilo prima di accettare',
    no_text: 'Testo del documento non disponibile in MediFlow: verifica sull’originale',
    no_quote: 'Proposta senza citazione: verifica sull’originale',
    summary: 'Sintesi dell’estrazione preparata: testo non verificabile, si accetta solo leggendola',
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
            if (!isRecord(item) || typeof item.kind !== 'string' || !Object.hasOwn(DOSSIER_FACT_TARGET, item.kind) || !isRecord(item.values)) {
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
/**
 * Chiave di raggruppamento per paziente: CF valido, altrimenti cognome, nome e nascita.
 * Vale solo ciò che MediFlow legge nel testo del documento: un CF o un nome proposti
 * dall'estrazione e non scritti nel documento non raggruppano la fonte sotto quel paziente.
 */
export function preparedPatientKey(patient: PreparedPatient | null, text: string | null): string | null {
    if (!patient || !text) return null;
    const written = preparedTokens(text).map((token) => token.text);
    const inText = (value: string | undefined) => {
        const wanted = preparedTokens(value ?? '').map((token) => token.text);
        return wanted.length > 0 && contiguous(written, wanted) >= 0;
    };
    if (patient.taxCode && isValidItalianTaxCodeChecksum(patient.taxCode)) {
        if (new RegExp(`(?:^|[^A-Z0-9])${patient.taxCode}(?:[^A-Z0-9]|$)`, 'u').test(text.toUpperCase())) return `cf:${patient.taxCode}`;
    }
    const name = [patient.lastName, patient.firstName].map((part) => (part ?? '').toLocaleLowerCase('it-IT').replace(/\s+/gu, ' ').trim());
    if (name[0] && name[1] && inText(patient.lastName) && inText(patient.firstName)) return `nome:${name[0]}|${name[1]}|${patient.birthDate ?? ''}`;
    return null;
}

export function preparedPatientLabel(patient: PreparedPatient | null): string {
    if (!patient) return '';
    return [[patient.lastName, patient.firstName].filter(Boolean).join(' '), patient.taxCode, patient.birthDate].filter(Boolean).join(' · ');
}


// ---------------------------------------------------------------------------
// Citazioni: confronto per parole, sugli offset del testo conservato
// ---------------------------------------------------------------------------

type Token = ReturnType<typeof clinicalTokens>[number];

export function preparedTokens(text: string): Token[] {
    return clinicalTokens(text);
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

/** Esatta, oppure (lettura approssimata) una lettera di differenza in una parola di almeno cinque lettere senza cifre. */
function sameWord(doc: string, wanted: string, approximate: boolean): boolean {
    if (doc === wanted) return true;
    if (!approximate || /[0-9]/u.test(doc) || /[0-9]/u.test(wanted) || wanted.length < 5 || doc.length < 5) return false;
    return withinOneEdit(doc, wanted);
}

export interface PreparedAnchor { evidence: DossierEvidence; match: 'exact' | 'approximate'; words: string[] }

export function quoteLongEnough(quote: string): boolean {
    return preparedTokens(quote).length >= PREPARED_MIN_QUOTE_WORDS && quote.replace(/[^\p{L}\p{N}]/gu, '').length >= PREPARED_MIN_QUOTE_CHARS;
}

/**
 * Trova la citazione nel testo, unità per unità. Esatta per parole; altrimenti ogni parola
 * deve coincidere o differire al più di una lettera (parole lunghe, mai numeri), con non
 * più di una parola diversa ogni sei. Una citazione troppo breve non si cerca.
 */
export function anchorPreparedQuote(text: string, units: readonly DossierUnit[], quote: string): PreparedAnchor | null {
    if (!quoteLongEnough(quote)) return null;
    const wanted = preparedTokens(quote).map((token) => token.text);
    const allowed = Math.max(1, Math.floor(wanted.length / 6));
    let best: { unit: DossierUnit; from: number; tokens: Token[]; differences: number } | null = null;
    for (const unit of units) {
        const tokens = preparedTokens(unitText(text, unit));
        for (let start = 0; start + wanted.length <= tokens.length; start += 1) {
            let differences = 0; let ok = true;
            for (let k = 0; k < wanted.length && ok; k += 1) {
                const doc = tokens[start + k].text;
                if (doc === wanted[k]) continue;
                if (sameWord(doc, wanted[k], true)) differences += 1; else ok = false;
            }
            if (!ok || differences > allowed) continue;
            if (!best || differences < best.differences) best = { unit, from: start, tokens, differences };
            if (differences === 0) break;
        }
        if (best?.differences === 0) break;
    }
    if (best?.differences === 0) {
        const body = unitText(text, best.unit);
        const first = best.tokens[best.from]; const last = best.tokens[best.from + wanted.length - 1];
        return { match: 'exact', words: best.tokens.slice(best.from, best.from + wanted.length).map((token) => token.text),
            evidence: { unit: best.unit.index, start: first.start, end: last.end, excerpt: body.slice(first.start, last.end).replace(/\s+/gu, ' ').trim() } };
    }
    const tabular = anchorTabularQuote(text, units, quote);
    if (tabular) return { match: tabular.match, words: tabular.words, evidence: tabular.evidence };
    if (!best) return null;
    const body = unitText(text, best.unit);
    const first = best.tokens[best.from]; const last = best.tokens[best.from + wanted.length - 1];
    return { match: 'approximate', words: best.tokens.slice(best.from, best.from + wanted.length).map((token) => token.text),
        evidence: { unit: best.unit.index, start: first.start, end: last.end, excerpt: body.slice(first.start, last.end).replace(/\s+/gu, ' ').trim() } };
}

const words = (value: string | undefined) => preparedTokens(value ?? '').map((token) => token.text);
const isNumber = (word: string) => /^[0-9]/u.test(word);
/** Cifre non ASCII (frazioni, apici, numeri romani Unicode): nel testo di MediFlow non diventano numeri. */
const FOREIGN_DIGITS = /[^\P{N}0-9]/u;

/** Prima posizione da `from` in cui `wanted` compare contiguo; restituisce l'indice dopo l'ultima parola, -1 se assente. */
function contiguous(passage: readonly string[], wanted: readonly string[], from = 0): number {
    if (!wanted.length) return from;
    for (let start = from; start + wanted.length <= passage.length; start += 1) {
        if (wanted.every((word, k) => passage[start + k] === word)) return start + wanted.length;
    }
    return -1;
}

function inOrder(passage: readonly string[], wanted: readonly string[]): number {
    const long = wanted.filter((word) => isNumber(word) || word.length >= 4);
    if (!long.length) return contiguous(passage, wanted);
    for (let start = 0; start < passage.length; start += 1) {
        if (passage[start] !== long[0]) continue;
        let at = start + 1; let k = 1;
        const limit = start + long.length * 3 + 2;
        while (k < long.length && at < passage.length && at < limit) { if (passage[at] === long[k]) k += 1; at += 1; }
        if (k === long.length) return at;
    }
    return -1;
}

/** Ogni parola lunga (non numerica) di `wanted` compare nel passo, in qualsiasi ordine: per nomi di ausili e prestazioni. */
function allNameWords(passage: readonly string[], wanted: readonly string[]): boolean {
    const long = wanted.filter((word) => !isNumber(word) && word.length >= 4);
    return long.length > 0 ? long.every((word) => passage.includes(word)) : wanted.every((word) => passage.includes(word));
}

/** I numeri `wanted` sono, nell'ordine, i primi numeri del passo dopo la posizione `from`. */
function firstNumbersAfter(passage: readonly string[], from: number, wanted: readonly string[]): number {
    let at = from;
    for (const number of wanted) {
        while (at < passage.length && !isNumber(passage[at])) at += 1;
        if (passage[at] !== number) return -1;
        at += 1;
    }
    return at;
}

export interface PreparedFieldCheck { check: 'ok' | 'value_missing' | 'status_conflict' | 'subject_conflict'; negated: boolean; notes: string[]; drop: string[] }

/**
 * Controllo posizionale dei campi sul passo del documento (parole del testo di MediFlow):
 * il soggetto del fatto (farmaco, esame, scala, diagnosi) e poi i suoi valori, nell'ordine
 * in cui il documento li scrive. Un valore preso da una riga vicina non passa.
 */
export function verifyPreparedFields(kind: DossierFactKind, values: Readonly<Record<string, string>>, passage: readonly string[]): PreparedFieldCheck {
    return verifyFields(kind, values, passage);
}

function verifyFields(kind: DossierFactKind, values: Readonly<Record<string, string>>, passage: readonly string[], source?: { body: string; start: number; end: number; context: ClinicalContext }): PreparedFieldCheck {
    const out: PreparedFieldCheck = { check: 'ok', negated: false, notes: [], drop: [] };
    const fail = (check: PreparedFieldCheck['check']) => ({ ...out, check });
    const foreign = Object.entries(values).some(([field, value]) => ['dosage', 'value', 'scaleTotal', 'scaleMax', 'percentage'].includes(field) && FOREIGN_DIGITS.test(value));
    if (foreign) return fail('value_missing');
    let subjectAt = -1;
    let drugEnd = 0;
    switch (kind) {
        case 'therapy': {
            const drug = words(values.drugName);
            const end = contiguous(passage, drug);
            if (!drug.length || end < 0) return fail('value_missing');
            subjectAt = end - drug.length;
            drugEnd = end;
            if (firstNumbersAfter(passage, end, words(values.dosage).filter(isNumber)) < 0) return fail('value_missing');
            const principle = words(values.activePrinciple);
            if (principle.length && contiguous(drug, principle) < 0) {
                const near = contiguous(passage.slice(Math.max(0, subjectAt - 6), end + 6), principle) >= 0;
                if (!near) { out.notes.push(`Principio attivo proposto, non scritto nel documento accanto al farmaco: ${values.activePrinciple}.`); out.drop.push('activePrinciple'); }
            }
            break;
        }
        case 'observation': {
            const display = words(values.display);
            const end = contiguous(passage, display);
            if (!display.length || end < 0) return fail('value_missing');
            const value = words(values.value);
            const valueEnd = value.some(isNumber) ? firstNumbersAfter(passage, end, value.filter(isNumber)) : contiguous(passage.slice(0, end + 4), value, end);
            if (valueEnd < 0 || (value.some(isNumber) && passage.slice(end, valueEnd).filter(isNumber).length !== value.filter(isNumber).length)) return fail('value_missing');
            const unit = words(values.unit);
            if (unit.length && contiguous(passage.slice(0, valueEnd + unit.length + 2), unit, valueEnd) < 0) return fail('value_missing');
            break;
        }
        case 'reported_scale': {
            const scale = inOrder(passage, words(values.scaleName));
            if (scale < 0) return fail('value_missing');
            const numbers = [...words(values.scaleTotal).filter(isNumber), ...words(values.scaleMax).filter(isNumber)];
            if (firstNumbersAfter(passage, scale, numbers) < 0) return fail('value_missing');
            break;
        }
        case 'diagnosis': {
            const code = words(values.code);
            const codeEnd = contiguous(passage, code);
            const description = inOrder(passage, words(values.description));
            if (codeEnd < 0 || description < 0) return fail('value_missing');
            break;
        }
        case 'exemption':
            if (contiguous(passage, words(values.code)) < 0) return fail('value_missing');
            break;
        case 'service_prescription':
            // Nomi di prestazioni e ausili: si controllano le parole; quantità e frequenze non sono valori verificati.
            if (!allNameWords(passage, words(values.serviceName))) return fail('value_missing');
            if (values.requestReference && contiguous(passage, words(values.requestReference)) < 0) return fail('value_missing');
            break;
        case 'prosthetic':
            if (!allNameWords(passage, words(values.description))) return fail('value_missing');
            if (values.isoCode && contiguous(passage, words(values.isoCode)) < 0) return fail('value_missing');
            break;
        default:
            break;
    }
    if (!structuredContextApplies(kind)) return out;
    const body = source?.body ?? passage.join(' ');
    const quoteStart = source?.start ?? 0;
    const quoteEnd = source?.end ?? body.length;
    const context = source?.context ?? clinicalFactContext(kind, values, body, quoteStart, quoteEnd);
    if (kind === 'therapy') {
        const tokens = clinicalTokens(body.slice(quoteStart, quoteEnd));
        const start = quoteStart + tokens[subjectAt].start;
        const end = quoteStart + tokens[drugEnd - 1].end;
        const { after } = clinicalSentence(body, start, end);
        if (firstNumbersAfter(words(after), 0, words(values.dosage).filter(isNumber)) < 0) return fail('value_missing');
        if (values.status === 'active' && context.suspended) return fail('status_conflict');
    }
    if ((kind === 'therapy' || kind === 'diagnosis') && values.subject !== 'familiare' && context.family) return fail('subject_conflict');
    out.negated = context.negated;
    return out;
}

function sentenceBefore(text: string, units: readonly DossierUnit[], evidence: DossierEvidence): string[] {
    const unit = units.find((candidate) => candidate.index === evidence.unit);
    if (!unit) return [];
    const head = unitText(text, unit).slice(0, evidence.start);
    const boundary = Math.max(head.lastIndexOf('\n'), ...[...head.matchAll(/[.;!?](?=\s)/gu)].map((match) => match.index!));
    return words(head.slice(boundary + 1));
}

/** Percentuale d'invalidità: scritta come «N%» o «N per cento» nel testo del passo. */
function percentageWritten(percentage: string, excerpt: string): boolean {
    const number = words(percentage).find(isNumber);
    if (!number) return false;
    return new RegExp(`(?:^|[^0-9.,])${number.replace(/[.,]/gu, '[.,]')}\\s*(?:%|per\\s*cento)`, 'iu').test(excerpt);
}
// ---------------------------------------------------------------------------
// Fatti dall'estrazione preparata
// ---------------------------------------------------------------------------

export interface PreparedFactsInput {
    source: PreparedSource;
    /** Testo estratto da MediFlow; null se l'estrazione non è riuscita. */
    text: string | null;
    units: readonly DossierUnit[];
    /** Data letta da MediFlow nel testo o nel nome: prevale su quella dell'estrazione. */
    documentDate: string | null;
    /** Proposte dei parser locali per la stessa fonte: restano tutte. */
    parserFacts: readonly DossierFact[];
    now: Date;
}

export interface PreparedFactsResult { facts: DossierFact[]; notes: string[]; documentDate: string | null }

function daysBetween(fromIso: string, to: Date): number {
    return Math.floor((to.getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86_400_000);
}

/** Una data dell'estrazione vale solo se valida e non futura. */
function notFuture(value: string | null | undefined, now: Date): string | null {
    return value && validIso(value) && daysBetween(value, now) >= 0 ? value : null;
}

/** Data del documento: quella letta da MediFlow, altrimenti quella dell'estrazione se non futura. */
export function preparedDocumentDate(source: PreparedSource, appDate: string | null, now: Date): string | null {
    return appDate ?? notFuture(source.documentDate, now);
}

/** Identità stabile del fatto: fonte, tipo, valori e citazione così come proposti, non i valori derivati. */
function stableFactId(sha: string, item: PreparedFactInput): string {
    const raw: Record<string, string> = { ...item.values, quote: item.quote ?? '', source: sha };
    return `p-${dossierFactId(item.kind, 0, 0, raw)}`;
}

/**
 * Converte le proposte preparate in fatti del dossier. Le proposte dei parser restano
 * tutte: l'accettazione in blocco rifiuta solo quelle che un fatto preparato accettato
 * sostituisce. Le proposte preparate uguali a una proposta codificata del parser non si ripetono.
 */
export function preparedDossierFacts(input: PreparedFactsInput): PreparedFactsResult {
    const { source, text, units, now } = input;
    const documentDate = preparedDocumentDate(source, input.documentDate, now);
    const date = documentDate ?? '';
    const notes: string[] = [];
    if (!input.documentDate && source.documentDate && !documentDate) notes.push('La data del documento proposta dall’estrazione è futura o non valida: ignorata.');
    const codedParser = input.parserFacts.filter((fact) => fact.origin === 'parser:icd' || fact.origin === 'parser:exemption'
        || (fact.origin === 'parser:lab' && Boolean(fact.values.code)));
    const facts: DossierFact[] = [];
    const ids = new Set<string>();
    const uncoded = new Set<string>();
    for (const item of source.facts) {
        const factId = stableFactId(source.sha256, item);
        if (ids.has(factId)) continue;
        ids.add(factId);
        const values: Record<string, string> = { ...item.values };
        if (structuredContextApplies(item.kind)) {
            delete values.contextReview;
            delete values.documentedSuspension;
        }
        const factNotes: string[] = [];
        for (const field of Object.keys(values)) if (DATE_FIELDS.has(field) && !notFuture(values[field], now)) delete values[field];
        switch (item.kind) {
            case 'therapy': {
                values.startDate ||= date;
                // Un farmaco citato senza dose resta un farmaco: la posologia lo dichiara, non la inventa.
                values.dosage ||= 'non indicata nel documento';
                if (!['active', 'suspended', 'completed'].includes(values.status ?? '')) values.status = 'completed';
                if (values.status === 'active' && (!date || daysBetween(date, now) > PREPARED_ACTIVE_THERAPY_MAX_AGE_DAYS)) {
                    values.status = 'completed';
                    values.temporality = [values.temporality, `indicata in corso dal documento, non recente`].filter(Boolean).join('; ');
                }
                break;
            }
            case 'observation': {
                values.observedAt ||= date;
                // Codice e unità solo dal catalogo locale, qualunque cosa proponga il file.
                delete values.code; delete values.unitCode;
                const coded = catalogObservationCode(values.display ?? '', values.unit ?? '', values.value ?? '');
                if (!coded) {
                    uncoded.add(values.display?.trim() || 'Esame senza nome');
                    continue;
                }
                values.code = coded.code; values.unitCode = coded.unitCode; values.codeSource = 'catalogo locale: nome e unità coincidenti';
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
        let negated = false;
        if (text === null || !units.length) check = 'no_text';
        else if (NARRATIVE.has(item.kind)) {
            // Un testo descrittivo è verificato solo se è esso stesso un passo del documento; il titolo è quello del tipo.
            values.title = NARRATIVE_TITLES[item.kind] ?? values.title ?? '';
            const textAnchor = values.text ? anchorPreparedQuote(text, units, values.text) : null;
            const passage = textAnchor && textAnchor.words.length === preparedTokens(values.text).length ? textAnchor : null;
            const quoted = item.quote ? anchorPreparedQuote(text, units, item.quote) : null;
            evidence = passage?.evidence ?? quoted?.evidence ?? null;
            check = passage ? (passage.match === 'exact' ? 'verified' : 'approximate') : 'paraphrase';
            if (passage && item.kind === 'invalidity' && values.percentage && !percentageWritten(values.percentage, passage.evidence.excerpt)) check = 'value_missing';
            if (passage && item.kind === 'anamnesis' && values.subject !== 'familiare'
                && passage.words.some((word) => legacyPreparedFamily.test(word))) check = 'subject_conflict';
        } else if (!item.quote) check = 'no_quote';
        else if (!quoteLongEnough(item.quote)) check = 'short_quote';
        else {
            const anchor = anchorPreparedQuote(text, units, item.quote);
            if (!anchor) check = 'not_found';
            else {
                evidence = anchor.evidence;
                // I valori si confrontano con le parole del documento senza tolleranza, anche in lettura approssimata.
                const { start, end, unit: unitIndex } = anchor.evidence;
                const unit = units.find((candidate) => candidate.index === unitIndex)!;
                const body = unitText(text, unit);
                const structured = structuredContextApplies(item.kind);
                const context = structured ? clinicalFactContext(item.kind, values, body, start, end) : undefined;
                const fields = verifyFields(item.kind, values, anchor.words, context && { body, start, end, context });
                negated = context?.negated ?? sentenceBefore(text, units, evidence).some((word) => legacyPreparedNegation.has(word));
                if (context) {
                    const declaredSuspension = item.kind === 'therapy' && isHistoricalTherapy(item.values.status);
                    if (context.suspended && declaredSuspension) values.documentedSuspension = 'true';
                    const review = contextReview(context, declaredSuspension);
                    if (review) values.contextReview = review;
                }
                for (const field of fields.drop) delete values[field];
                factNotes.push(...fields.notes);
                check = fields.check === 'ok' ? (anchor.match === 'exact' ? 'verified' : 'approximate') : fields.check;
            }
        }
        if (item.kind === 'therapy' && values.activePrinciple && check !== 'verified' && check !== 'approximate') {
            factNotes.push(`Principio attivo proposto: ${values.activePrinciple}.`);
            delete values.activePrinciple;
        }
        values.preparedCheck = check;
        if (factNotes.length) values.preparedNotes = factNotes.join(' ');
        if (codedParser.some((fact) => fact.kind === item.kind && sameIdentity(fact, values))) continue;
        facts.push({ factId, kind: item.kind, origin: 'prepared', evidence, negated, values, decision: 'pending' });
    }
    if (uncoded.size) notes.push(`Esami senza codice LOINC: ${[...uncoded].join(', ')}.`);
    if (source.summary) {
        const values: Record<string, string> = { title: source.summary.title, date: notFuture(source.summary.date, now) ?? date, text: source.summary.text,
            textSource: 'prepared', preparedCheck: 'summary', preparedCoverage: source.coverage.complete ? 'complete' : 'partial',
            ...(source.coverage.pages ? { preparedPages: String(source.coverage.pages) } : {}),
            ...(notes.length ? { preparedNotes: notes.join(' ') } : {}) };
        facts.push({ factId: `p-${dossierFactId('document_entry', 0, 0, { title: values.title, text: values.text, source: source.sha256 })}`, kind: 'document_entry',
            origin: 'prepared', evidence: null, negated: false, values, decision: 'pending' });
    } else {
        notes.push('L’estrazione preparata non contiene una sintesi: resta la voce di diario col testo completo.');
    }
    return { facts: [...input.parserFacts, ...facts], notes, documentDate };
}

const SUBJECT_FIELD: Partial<Record<DossierFactKind, string>> = {
    therapy: 'drugName', diagnosis: 'description', observation: 'display', service_prescription: 'serviceName', prosthetic: 'description', reported_scale: 'scaleName',
};

/** Stesso soggetto clinico: le parole lunghe di uno contengono quelle dell'altro. */
function sameSubject(left: DossierFact, right: DossierFact): boolean {
    const field = SUBJECT_FIELD[left.kind];
    if (!field) return false;
    const a = words(left.values[field]).filter((word) => word.length >= 4); const b = words(right.values[field]).filter((word) => word.length >= 4);
    if (!a.length || !b.length) return false;
    return a.every((word) => b.includes(word)) || b.every((word) => a.includes(word));
}

function sameIdentity(fact: DossierFact, values: Record<string, string>): boolean {
    const v = fact.values;
    const words = (value: string | undefined) => preparedTokens(value ?? '').map((token) => token.text).join(' ');
    switch (fact.kind) {
        case 'diagnosis': return Boolean(v.code && values.code) && v.code.toUpperCase() === values.code.toUpperCase();
        case 'exemption': return v.code?.toUpperCase() === values.code?.toUpperCase();
        case 'observation': return v.code === values.code && v.observedAt === values.observedAt && words(v.value) === words(values.value);
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
    /** Riferimenti di fatti che la stessa operazione mette da parte in altri documenti. */
    setAsideElsewhere: ReadonlySet<string>;
    /** Riferimenti di fatti in conflitto o confrontati con un conflitto, in qualunque documento. */
    conflicted: ReadonlySet<string>;
    /** Nome della fonte per chiave di documento, per il motivo dei doppioni. */
    documentNames: Readonly<Record<string, string>>;
    /** Il medico ha letto le sintesi e chiede di accettarle; la stessa dichiarazione conferma il residuo. */
    includeSummaries: boolean;
}

export interface PreparedBulkResult {
    facts: DossierFact[];
    acknowledgeResidual: boolean;
    accepted: string[];
    setAside: string[];
    counts: { accepted: number; alreadyPresent: number; superseded: number; setAside: number; leftPending: number };
}

const PARSER_ELIGIBLE = new Set<DossierFact['origin']>(['parser:lab', 'parser:icd', 'parser:exemption']);
const PARSER_ELIGIBLE_KINDS = new Set<DossierFactKind>(['diagnosis', 'exemption', 'observation']);
const SUPERSEDABLE = new Set<DossierFact['origin']>(['parser:section', 'parser:scale']);
const AUTOMATIC_READING = new Set<DossierFact['origin']>(['parser:lab', 'parser:icd', 'parser:exemption', 'parser:section', 'parser:scale']);

export const BULK_NOTE = {
    automaticReading: 'Lettura automatica non verificata.',
    supersededByPrepared: 'Sostituita dall’estrazione preparata verificata dello stesso tipo.',
    supersededBySummary: 'Sostituita dalla sintesi accettata; il testo completo resta nell’allegato.',
} as const;

export function isPreparedSummary(fact: DossierFact): boolean {
    return fact.origin === 'prepared' && fact.values.preparedCheck === 'summary';
}

/** Una proposta entra nel blocco solo se verificabile sulla fonte (la sintesi solo su richiesta esplicita). */
export function preparedFactEligible(fact: DossierFact, exemptionCodes: ReadonlySet<string>, includeSummaries = false): boolean {
    if (fact.negated || dossierFactBlockers(fact, { exemptionCodes }).length) return false;
    if (fact.origin === 'prepared') {
        if (isPreparedSummary(fact)) return includeSummaries;
        return Boolean(fact.evidence) && (fact.values.preparedCheck === 'verified' || fact.values.preparedCheck === 'approximate');
    }
    return PARSER_ELIGIBLE.has(fact.origin) && PARSER_ELIGIBLE_KINDS.has(fact.kind) && Boolean(fact.evidence);
}

/** Unità di testo di MediFlow, se contate per pagina: servono a confrontare la copertura dichiarata. */
function appPageCount(record: DossierRecord): number | null {
    return record.extraction.state === 'extracted' && record.extraction.unitBasis === 'pages' ? record.extraction.units.length : null;
}

/**
 * La regola di «Accetta il verificato» (WUL-927), solo per i documenti con estrazione preparata.
 * Accetta i fatti preparati con citazione ritrovata, le proposte codificate trovate nel testo e la voce
 * di diario col documento intero; mette da parte doppioni e altre letture automatiche, con il motivo;
 * lascia al medico sintesi, conflitti, negazioni e tutto ciò che non rientra con certezza in una classe.
 * Il residuo si conferma solo con la dichiarazione del medico sulle sintesi.
 */
export function preparedBulkDecisions(input: PreparedBulkInput): PreparedBulkResult {
    const { record, documentKey } = input;
    const counts = { accepted: 0, alreadyPresent: 0, superseded: 0, setAside: 0, leftPending: 0 };
    const accepted: string[] = [];
    const setAside: string[] = [];
    if (!record.facts.some((fact) => fact.origin === 'prepared')) {
        return { facts: record.facts, acknowledgeResidual: false, accepted, setAside, counts: { ...counts, leftPending: record.facts.filter((fact) => fact.decision === 'pending').length } };
    }
    const refOf = (fact: DossierFact) => `${documentKey}#${fact.factId}`;
    const acceptedNow = new Set(input.acceptedElsewhere);
    const setAsideNow = new Set(input.setAsideElsewhere);
    const supersedableHere = new Set(record.facts.filter((fact) => SUPERSEDABLE.has(fact.origin) && fact.decision === 'pending').map(refOf));
    const heldForPhysician = (fact: DossierFact) => fact.negated || input.conflicted.has(refOf(fact)) || input.assessment(refOf(fact))?.status === 'conflict';
    const decide = (fact: DossierFact, decision: DossierFact['decision'], note?: string): DossierFact =>
        ({ ...fact, decision, decidedBy: 'accept_verified', ...(note ? { note } : {}) });
    const accept = (fact: DossierFact) => { counts.accepted += 1; accepted.push(refOf(fact)); acceptedNow.add(refOf(fact)); return decide(fact, 'accepted'); };
    const reject = (fact: DossierFact, note: string) => { setAside.push(refOf(fact)); setAsideNow.add(refOf(fact)); return decide(fact, 'rejected', note); };
    const putAside = (fact: DossierFact, note: string) => { counts.setAside += 1; return reject(fact, note); };
    const supersede = (fact: DossierFact, note: string) => { counts.superseded += 1; return reject(fact, note); };
    const sourceOf = (ref: string) => {
        const key = ref.slice(0, ref.indexOf('#'));
        return key === documentKey ? null : input.documentNames[key] ?? '';
    };
    const duplicateNote = (ref: string, acceptedTwin: boolean) => {
        const source = sourceOf(ref);
        const voice = acceptedTwin ? 'una voce accettata' : 'una voce';
        return source === null ? `Doppione di ${voice} di questo documento.` : source ? `Doppione di ${voice} di «${source}».` : `Doppione di ${voice} di un altro documento.`;
    };
    const first = record.facts.map((fact) => {
        if (fact.decision !== 'pending' || fact.origin === 'parser:document' || fact.origin === 'manual' || heldForPhysician(fact)) return fact;
        const assessment = input.assessment(refOf(fact));
        if (assessment?.status === 'already_present') { counts.alreadyPresent += 1; return decide(fact, 'already_present'); }
        if (assessment?.status === 'duplicate_in_dossier') {
            const twins = assessment.relatedFactRefs.filter((related) => !setAsideNow.has(related) && !(fact.origin === 'prepared' && supersedableHere.has(related)));
            if (twins.length && twins.every((related) => acceptedNow.has(related))) {
                counts.alreadyPresent += 1;
                return decide(fact, 'already_present', duplicateNote(twins[0], true));
            }
            if (twins.length) return putAside(fact, duplicateNote(twins[0], false));
        }
        if (SUPERSEDABLE.has(fact.origin)) return fact;
        return preparedFactEligible(fact, input.exemptionCodes, input.includeSummaries) ? accept(fact) : fact;
    });
    const written = (fact: DossierFact) => { const outcome = latestAppliedOutcome(record, fact.factId)?.outcome; return outcome === 'applied' || outcome === 'already_present'; };
    const summaryAccepted = first.some((fact) => isPreparedSummary(fact) && fact.decision === 'accepted');
    const summaryWritten = first.some((fact) => isPreparedSummary(fact) && fact.decision === 'accepted' && written(fact));
    const keptPrepared = first.filter((fact) => fact.origin === 'prepared' && (fact.decision === 'accepted' || fact.decision === 'already_present') && !isPreparedSummary(fact));
    const facts = first.map((fact) => {
        if (fact.decision !== 'pending') return fact;
        if (fact.origin === 'parser:document') {
            if (summaryWritten) return supersede(fact, BULK_NOTE.supersededBySummary);
            if (!summaryAccepted && !dossierFactBlockers(fact, { exemptionCodes: input.exemptionCodes }).length) {
                if (input.assessment(refOf(fact))?.status === 'already_present') { counts.alreadyPresent += 1; return decide(fact, 'already_present'); }
                return accept(fact);
            }
        } else if (SUPERSEDABLE.has(fact.origin) && keptPrepared.some((other) => other.kind === fact.kind && sameSubject(other, fact))) {
            return supersede(fact, BULK_NOTE.supersededByPrepared);
        } else if (!heldForPhysician(fact) && AUTOMATIC_READING.has(fact.origin)) {
            return putAside(fact, BULK_NOTE.automaticReading);
        }
        counts.leftPending += 1;
        return fact;
    });
    const summary = facts.find(isPreparedSummary);
    const pages = appPageCount(record);
    const acknowledgeResidual = Boolean(input.includeSummaries && summary && summary.decision === 'accepted' && written(summary) && summary.values.preparedCoverage === 'complete'
        && (pages === null || summary.values.preparedPages === String(pages)));
    return { facts, acknowledgeResidual, accepted, setAside, counts };
}
