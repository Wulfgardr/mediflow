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
/** Testi descrittivi: verificabili solo se il testo proposto è un passo del documento. */
const NARRATIVE = new Set<DossierFactKind>(['anamnesis', 'assessment', 'imaging_report', 'care_context', 'document_entry', 'invalidity']);
/**
 * Campi da ritrovare nel passo del documento. `all`: ogni parola; `long`: le parole di almeno
 * quattro lettere; `numbers`: i soli numeri (una posologia si scrive in tanti modi, le dosi no).
 */
const FIELD_CHECKS: Partial<Record<DossierFactKind, ReadonlyArray<readonly [string, 'all' | 'long' | 'numbers']>>> = {
    therapy: [['drugName', 'all'], ['dosage', 'numbers']],
    observation: [['display', 'long'], ['value', 'all'], ['unit', 'all']],
    diagnosis: [['code', 'all'], ['description', 'long']],
    exemption: [['code', 'all']],
    service_prescription: [['serviceName', 'long'], ['requestReference', 'all']],
    prosthetic: [['description', 'long'], ['isoCode', 'all']],
    reported_scale: [['scaleName', 'long'], ['scaleTotal', 'all'], ['scaleMax', 'all']],
    invalidity: [['percentage', 'numbers']],
};
export const PREPARED_MIN_QUOTE_WORDS = 3;
export const PREPARED_MIN_QUOTE_CHARS = 12;

export const PREPARED_CHECK_LABELS = {
    verified: 'Citazione e valori trovati nel testo del documento',
    approximate: 'Citazione e valori trovati, con una lettera diversa in qualche parola (lettura OCR)',
    not_found: 'Citazione non trovata nel testo del documento: verifica prima di accettare',
    value_missing: 'Un valore proposto non compare nel passo del documento: verifica prima di accettare',
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

interface Token { text: string; start: number; end: number; numeric: boolean }

/**
 * Parole: sequenze di lettere (con diacritici), oppure numeri con i loro separatori («1,25»,
 * «12.06.06»). Cifre e lettere attaccate si separano: «5mg» vale «5» e «mg».
 */
const WORD = /[0-9]+(?:[.,][0-9]+)*|[\p{L}\p{M}]+/gu;

export function preparedTokens(text: string): Token[] {
    const tokens: Token[] = [];
    for (const match of text.matchAll(WORD)) {
        const normalized = match[0].normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('it-IT');
        tokens.push({ text: normalized, start: match.index!, end: match.index! + match[0].length, numeric: /[0-9]/u.test(normalized) });
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
    if (!best) return null;
    const body = unitText(text, best.unit);
    const first = best.tokens[best.from]; const last = best.tokens[best.from + wanted.length - 1];
    return { match: best.differences === 0 ? 'exact' : 'approximate', words: best.tokens.slice(best.from, best.from + wanted.length).map((token) => token.text),
        evidence: { unit: best.unit.index, start: first.start, end: last.end, excerpt: body.slice(first.start, last.end).replace(/\s+/gu, ' ').trim() } };
}

/** Il valore si ritrova nelle parole del passo del documento, secondo la regola del campo. */
export function valueInWords(value: string, words: readonly string[], rule: 'all' | 'long' | 'numbers', approximate = false): boolean {
    const wanted = preparedTokens(value).filter((token) => rule === 'all' ? true : rule === 'numbers' ? token.numeric : token.numeric || token.text.length >= 4);
    return wanted.every((token) => words.some((word) => sameWord(word, token.text, approximate && !token.numeric)));
}

/** Compatibilità: il valore compare, in ordine e contiguo, nel testo dato. */
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
    let uncoded = 0;
    for (const item of source.facts) {
        const factId = stableFactId(source.sha256, item);
        if (ids.has(factId)) continue;
        ids.add(factId);
        const values: Record<string, string> = { ...item.values };
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
                const coded = catalogObservationCode(values.display ?? '', values.unit ?? '');
                if (!coded) { uncoded += 1; continue; }
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
        if (text === null || !units.length) check = 'no_text';
        else if (NARRATIVE.has(item.kind)) {
            // Un testo descrittivo è verificato solo se è esso stesso un passo del documento.
            const passage = values.text ? anchorPreparedQuote(text, units, values.text) : null;
            const quoted = item.quote ? anchorPreparedQuote(text, units, item.quote) : null;
            evidence = passage?.evidence ?? quoted?.evidence ?? null;
            check = passage ? (passage.match === 'exact' ? 'verified' : 'approximate') : 'paraphrase';
            if (passage && item.kind === 'invalidity' && values.percentage && !valueInWords(values.percentage, passage.words, 'numbers')) check = 'value_missing';
        } else if (!item.quote) check = 'no_quote';
        else if (!quoteLongEnough(item.quote)) check = 'short_quote';
        else {
            const anchor = anchorPreparedQuote(text, units, item.quote);
            if (!anchor) check = 'not_found';
            else {
                evidence = anchor.evidence;
                const approximate = anchor.match === 'approximate';
                const checks = (FIELD_CHECKS[item.kind] ?? []).filter(([field]) => values[field]);
                check = checks.every(([field, rule]) => valueInWords(values[field], anchor.words, rule, approximate)) ? (approximate ? 'approximate' : 'verified') : 'value_missing';
                // Un principio attivo non scritto nel passo resta una nota per il medico, non un dato.
                if (item.kind === 'therapy' && values.activePrinciple && !valueInWords(values.activePrinciple, anchor.words, 'all', approximate)
                    && !valueInWords(values.activePrinciple, preparedTokens(values.drugName ?? '').map((token) => token.text), 'all')) {
                    factNotes.push(`Principio attivo proposto, non scritto nel documento: ${values.activePrinciple}.`);
                    delete values.activePrinciple;
                }
            }
        }
        if (item.kind === 'therapy' && values.activePrinciple && check !== 'verified' && check !== 'approximate') {
            factNotes.push(`Principio attivo proposto: ${values.activePrinciple}.`);
            delete values.activePrinciple;
        }
        values.preparedCheck = check;
        if (factNotes.length) values.preparedNotes = factNotes.join(' ');
        if (codedParser.some((fact) => fact.kind === item.kind && sameIdentity(fact, values))) continue;
        facts.push({ factId, kind: item.kind, origin: 'prepared', evidence, negated: false, values, decision: 'pending' });
    }
    if (uncoded) notes.push(`${uncoded} ${uncoded === 1 ? 'valore di laboratorio senza codice LOINC verificato resta' : 'valori di laboratorio senza codice LOINC verificato restano'} nella sintesi e nel testo conservato.`);
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
    /** Il medico ha letto le sintesi e chiede di accettarle: testo non verificabile. */
    includeSummaries: boolean;
}

export interface PreparedBulkResult {
    facts: DossierFact[];
    acknowledgeResidual: boolean;
    accepted: string[];
    counts: { accepted: number; alreadyPresent: number; superseded: number; leftPending: number };
}

const PARSER_ELIGIBLE = new Set<DossierFact['origin']>(['parser:lab', 'parser:icd', 'parser:exemption']);
const PARSER_ELIGIBLE_KINDS = new Set<DossierFactKind>(['diagnosis', 'exemption', 'observation']);
const SUPERSEDABLE = new Set<DossierFact['origin']>(['parser:section', 'parser:scale']);

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

export function preparedBulkDecisions(input: PreparedBulkInput): PreparedBulkResult {
    const { record, documentKey } = input;
    const counts = { accepted: 0, alreadyPresent: 0, superseded: 0, leftPending: 0 };
    const accepted: string[] = [];
    // Solo i documenti con un'estrazione preparata: senza, nulla cambia rispetto ad ADR 0175.
    if (!record.facts.some((fact) => fact.origin === 'prepared')) {
        return { facts: record.facts, acknowledgeResidual: false, accepted, counts: { ...counts, leftPending: record.facts.filter((fact) => fact.decision === 'pending').length } };
    }
    const acceptedNow = new Set(input.acceptedElsewhere);
    const supersedableHere = new Set(record.facts.filter((fact) => SUPERSEDABLE.has(fact.origin) && fact.decision === 'pending').map((fact) => `${documentKey}#${fact.factId}`));
    // 1. Proposte preparate e proposte codificate del parser.
    const first = record.facts.map((fact) => {
        if (fact.decision !== 'pending' || SUPERSEDABLE.has(fact.origin) || fact.origin === 'parser:document') return fact;
        const ref = `${documentKey}#${fact.factId}`;
        let assessment = input.assessment(ref);
        // Un fatto preparato «doppio» di una proposta per sezione dello stesso documento non è un doppione:
        // è la stessa informazione, verificata; la proposta per sezione verrà sostituita.
        if (fact.origin === 'prepared' && assessment?.status === 'duplicate_in_dossier') {
            const others = assessment.relatedFactRefs.filter((related) => !supersedableHere.has(related));
            if (!others.length) assessment = { status: 'new', detail: assessment.detail, relatedFactRefs: [] };
            else assessment = { ...assessment, relatedFactRefs: others };
        }
        if (assessment?.status === 'already_present') { counts.alreadyPresent += 1; return { ...fact, decision: 'already_present' as const }; }
        if (assessment?.status === 'duplicate_in_dossier' && assessment.relatedFactRefs.length
            && assessment.relatedFactRefs.every((related) => acceptedNow.has(related))) {
            counts.alreadyPresent += 1;
            return { ...fact, decision: 'already_present' as const, note: 'Stesso contenuto di un’altra fonte accettata.' };
        }
        if ((!assessment || assessment.status === 'new') && preparedFactEligible(fact, input.exemptionCodes, input.includeSummaries)) {
            counts.accepted += 1; accepted.push(ref); acceptedNow.add(ref);
            return { ...fact, decision: 'accepted' as const };
        }
        return fact;
    });
    // 2. Sostituzioni: la voce col testo intero solo se la sintesi è accettata; le proposte per sezione
    //    solo se un fatto preparato dello stesso tipo è accettato in questo documento.
    const summaryAccepted = first.some((fact) => isPreparedSummary(fact) && fact.decision === 'accepted');
    const acceptedKinds = new Set(first.filter((fact) => fact.origin === 'prepared' && fact.decision === 'accepted' && !isPreparedSummary(fact)).map((fact) => fact.kind));
    const facts = first.map((fact) => {
        if (fact.decision !== 'pending') return fact;
        if ((fact.origin === 'parser:document' && summaryAccepted) || (SUPERSEDABLE.has(fact.origin) && acceptedKinds.has(fact.kind))) {
            counts.superseded += 1;
            return { ...fact, decision: 'rejected' as const, note: fact.origin === 'parser:document' ? 'Sostituita dalla sintesi accettata; il testo completo resta nell’allegato.'
                : 'Sostituita dall’estrazione preparata verificata dello stesso tipo.' };
        }
        counts.leftPending += 1;
        return fact;
    });
    // 3. Il residuo si conferma solo con la sintesi accettata e la copertura dichiarata coerente con MediFlow.
    const summary = facts.find(isPreparedSummary);
    const pages = appPageCount(record);
    const acknowledgeResidual = Boolean(summary && summary.decision === 'accepted' && summary.values.preparedCoverage === 'complete'
        && (pages === null || summary.values.preparedPages === String(pages)));
    return { facts, acknowledgeResidual, accepted, counts };
}
