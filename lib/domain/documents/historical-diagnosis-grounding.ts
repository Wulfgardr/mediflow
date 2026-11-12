/*
 * Riscontro delle diagnosi estratte salvate nei `documentInsights` storici (WUL-831).
 *
 * Ogni diagnosi (codice ICD e descrizione) si cerca nel testo del documento da cui viene
 * (`rawMarkdown`). Quattro esiti:
 *   - explicit: il codice completo compare nel testo, oppure tutte le parole significative
 *     della descrizione compaiono vicine (entro una finestra stretta, in qualsiasi ordine);
 *   - partial: compare solo la categoria del codice (I50 per I50.1), oppure almeno metà
 *     delle parole significative della descrizione;
 *   - none: nessuna delle due cose;
 *   - no_text: il documento non ha testo su cui cercare.
 *
 * Normalizzazione: minuscole, senza accenti (parole di `preparedTokens`), numeri romani dopo
 * «tipo» in cifre, sigle cliniche comuni sciolte se scritte in maiuscolo (BPCO, IRC, DM...),
 * formule di comodo ICD tolte («non specificata», «senza menzione di complicanze», NAS),
 * parole brevi e articoli ignorati, desinenze vocaliche finali tolte (cronica = cronico).
 * I codici solo numerici (ICD-9) contano solo con la parte decimale: «428» da solo è un
 * numero qualsiasi del referto.
 */

import type { DocumentInsight } from '../../db';
import { preparedTokens } from './dossier-prepared';

export type DiagnosisGroundingClass = 'explicit' | 'partial' | 'none' | 'no_text';
export type DiagnosisGroundingBasis = 'code' | 'description' | 'code_and_description' | 'code_category' | 'description_words' | null;

export interface DiagnosisGrounding {
    class: DiagnosisGroundingClass;
    basis: DiagnosisGroundingBasis;
}

/** Sigle sciolte solo se il documento (o la descrizione) le scrive in maiuscolo. */
const ABBREVIATIONS: Readonly<Record<string, string>> = Object.freeze({
    bpco: 'broncopneumopatia cronica ostruttiva',
    irc: 'insufficienza renale cronica',
    ira: 'insufficienza renale acuta',
    scc: 'scompenso cardiaco cronico',
    icc: 'insufficienza cardiaca congestizia',
    fa: 'fibrillazione atriale',
    ipa: 'ipertensione arteriosa',
    dm: 'diabete mellito',
    tvp: 'trombosi venosa profonda',
    tep: 'tromboembolia polmonare',
    ima: 'infarto miocardico acuto',
    sca: 'sindrome coronarica acuta',
    cic: 'cardiopatia ischemica cronica',
    tia: 'attacco ischemico transitorio',
    mrge: 'malattia reflusso gastroesofageo',
    ipb: 'ipertrofia prostatica benigna',
    aocp: 'arteriopatia obliterante cronica periferica',
    osas: 'sindrome apnee ostruttive sonno',
});

const ROMAN: Readonly<Record<string, string>> = Object.freeze({ i: '1', ii: '2', iii: '3', iv: '4' });

const STOPWORDS = new Set([
    'di', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'da', 'dal', 'dalla', 'dai', 'in', 'nel', 'nella',
    'con', 'per', 'su', 'sul', 'sulla', 'al', 'alla', 'allo', 'ai', 'agli', 'alle', 'ed', 'il', 'lo', 'la',
    'gli', 'le', 'un', 'uno', 'una', 'tipo', 'non', 'altro', 'altra', 'altri', 'altre', 'forma', 'forme',
]);

const ICD_BOILERPLATE = /\b(?:non (?:altrimenti )?specificat[oaie]|non classificat[oaie] altrove|senza menzione di complicanz[ae]|nas|nca)\b/giu;

/** «tre anni FA» in un referto tutto maiuscolo non è fibrillazione atriale. */
const TIME_WORDS = new Set(['anni', 'anno', 'mesi', 'mese', 'giorni', 'giorno', 'settimane', 'settimana', 'ore', 'ora', 'tempo', 'poco']);

function stem(word: string): string {
    if (/^[0-9]/u.test(word) || word.length < 5) return word;
    return word.replace(/[aeiou]+$/u, '');
}

/** Parole significative di un testo, normalizzate e con le sigle sciolte. */
export function groundingWords(value: string): string[] {
    const cleaned = value.normalize('NFKD').replace(/\p{M}/gu, '').replace(ICD_BOILERPLATE, ' ');
    const out: string[] = [];
    let previous = '';
    for (const token of preparedTokens(cleaned)) {
        const original = cleaned.slice(token.start, token.end);
        const expansion = ABBREVIATIONS[token.text];
        const expand = expansion && original.length >= 2 && original === original.toUpperCase()
            && !(token.text === 'fa' && TIME_WORDS.has(previous));
        const words = expand
            ? expansion.split(' ')
            : [previous === 'tipo' && ROMAN[token.text] ? ROMAN[token.text] : token.text];
        previous = token.text;
        for (const word of words) {
            if (STOPWORDS.has(word)) continue;
            if (!/^[0-9]/u.test(word) && word.length < 3) continue;
            out.push(stem(word.replace(/,/gu, '.')));
        }
    }
    return out;
}

/** Tutte le parole cercate compaiono entro una finestra di 3 posizioni per parola (più 2). */
function allWithinWindow(passage: readonly string[], wanted: readonly string[]): boolean {
    const span = wanted.length * 3 + 2;
    const need = new Set(wanted);
    for (let start = 0; start < passage.length; start += 1) {
        if (!need.has(passage[start])) continue;
        const seen = new Set<string>();
        for (let at = start; at < passage.length && at < start + span; at += 1) {
            if (need.has(passage[at])) seen.add(passage[at]);
            if (seen.size === need.size) return true;
        }
    }
    return false;
}

function describe(passage: readonly string[], description: string): 'explicit' | 'partial' | 'none' {
    const wanted = [...new Set(groundingWords(description))];
    if (wanted.length === 0) return 'none';
    if (allWithinWindow(passage, wanted)) return 'explicit';
    const present = new Set(passage);
    const found = wanted.filter((word) => present.has(word)).length;
    return found > 0 && found * 2 >= wanted.length ? 'partial' : 'none';
}

interface ParsedCode { stem: string; sub: string; numeric: boolean }

export function parseDiagnosisCode(code: string): ParsedCode | null {
    const compact = code.normalize('NFKD').toUpperCase().replace(/^ICD[\s-]*(?:9|10|11)(?:[\s-]*CM)?\s*:?\s*/u, '').replace(/\s+/gu, '');
    const dotted = /^([A-Z0-9]{3,4})[.,]([A-Z0-9]{1,4})$/u.exec(compact);
    if (dotted) return { stem: dotted[1], sub: dotted[2], numeric: /^[0-9]+$/u.test(dotted[1]) };
    if (/^[A-Z][0-9]{2}[0-9A-Z]{1,2}$/u.test(compact)) return { stem: compact.slice(0, 3), sub: compact.slice(3), numeric: false };
    if (/^[0-9]{4,5}$/u.test(compact)) return { stem: compact.slice(0, 3), sub: compact.slice(3), numeric: true };
    if (/^[A-Z0-9]{3,4}$/u.test(compact)) return { stem: compact, sub: '', numeric: /^[0-9]+$/u.test(compact) };
    return null;
}

function stemPattern(value: string): string {
    // «I 50» e «I50» valgono uguale: spazio facoltativo fra lettera iniziale e cifre.
    return value.replace(/^([A-Z])(?=[0-9])/u, '$1\\s?');
}

const BEFORE = '(?<![A-Z0-9])(?<![0-9][.,])';

function codeInText(upperText: string, parsed: ParsedCode): 'full' | 'category' | 'absent' {
    const head = BEFORE + stemPattern(parsed.stem);
    if (parsed.numeric) {
        if (!parsed.sub) return 'absent';
        return new RegExp(`${head}\\s?[.,]\\s?${parsed.sub}(?![0-9A-Z])`, 'u').test(upperText) ? 'full' : 'absent';
    }
    if (parsed.sub) {
        if (new RegExp(`${head}(?:\\s?[.,]\\s?)?${parsed.sub}(?![0-9A-Z])`, 'u').test(upperText)) return 'full';
        return new RegExp(`${head}(?![0-9A-Z])`, 'u').test(upperText) ? 'category' : 'absent';
    }
    return new RegExp(`${head}(?![0-9A-Z])`, 'u').test(upperText) ? 'full' : 'absent';
}

function hasText(text: string | undefined | null): text is string {
    return typeof text === 'string' && /[\p{L}\p{N}]/u.test(text);
}

/** Cerca una diagnosi nel testo del suo documento. */
export function groundDiagnosisInText(text: string | undefined | null, diagnosis: { code?: string; description?: string }): DiagnosisGrounding {
    if (!hasText(text)) return { class: 'no_text', basis: null };
    const upperText = text.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase();
    const parsed = diagnosis.code ? parseDiagnosisCode(diagnosis.code) : null;
    const code = parsed ? codeInText(upperText, parsed) : 'absent';
    const words = describe(groundingWords(text), diagnosis.description ?? '');
    if (code === 'full' && words === 'explicit') return { class: 'explicit', basis: 'code_and_description' };
    if (code === 'full') return { class: 'explicit', basis: 'code' };
    if (words === 'explicit') return { class: 'explicit', basis: 'description' };
    if (code === 'category') return { class: 'partial', basis: 'code_category' };
    if (words === 'partial') return { class: 'partial', basis: 'description_words' };
    return { class: 'none', basis: null };
}

export interface HistoricalDiagnosisAuditPatient {
    patientId: string;
    insights: readonly DocumentInsight[];
}

export interface HistoricalDiagnosisAuditRow {
    patientId: string;
    insightId: string;
    fileName: string;
    system: string;
    code: string;
    description: string;
    grounding: DiagnosisGrounding;
}

export interface HistoricalDiagnosisAuditTotals {
    diagnoses: number;
    explicit: number;
    partial: number;
    none: number;
    noText: number;
    emptySkipped: number;
    insights: number;
    insightsWithDiagnoses: number;
    patientsWithDiagnoses: number;
    patientsWithNone: number;
    explicitByBasis: Record<'code' | 'description' | 'code_and_description', number>;
}

/** Applica il controllo a tutte le diagnosi estratte salvate di un insieme di pazienti. */
export function auditHistoricalDiagnoses(patients: Iterable<HistoricalDiagnosisAuditPatient>): { totals: HistoricalDiagnosisAuditTotals; rows: HistoricalDiagnosisAuditRow[] } {
    const totals: HistoricalDiagnosisAuditTotals = {
        diagnoses: 0, explicit: 0, partial: 0, none: 0, noText: 0, emptySkipped: 0,
        insights: 0, insightsWithDiagnoses: 0, patientsWithDiagnoses: 0, patientsWithNone: 0,
        explicitByBasis: { code: 0, description: 0, code_and_description: 0 },
    };
    const rows: HistoricalDiagnosisAuditRow[] = [];
    for (const patient of patients) {
        let patientDiagnoses = 0;
        let patientNone = 0;
        for (const insight of patient.insights) {
            totals.insights += 1;
            const diagnoses = Array.isArray(insight.extractedData?.diagnoses) ? insight.extractedData.diagnoses : [];
            let counted = 0;
            for (const diagnosis of diagnoses) {
                const code = typeof diagnosis?.code === 'string' ? diagnosis.code.trim() : '';
                const description = typeof diagnosis?.description === 'string' ? diagnosis.description.trim() : '';
                if (!code && !description) { totals.emptySkipped += 1; continue; }
                const grounding = groundDiagnosisInText(insight.rawMarkdown, { code, description });
                counted += 1;
                totals.diagnoses += 1;
                if (grounding.class === 'explicit') {
                    totals.explicit += 1;
                    totals.explicitByBasis[grounding.basis as 'code' | 'description' | 'code_and_description'] += 1;
                } else if (grounding.class === 'partial') totals.partial += 1;
                else if (grounding.class === 'none') { totals.none += 1; patientNone += 1; }
                else totals.noText += 1;
                rows.push({
                    patientId: patient.patientId,
                    insightId: String(insight.id ?? ''),
                    fileName: String(insight.fileName ?? ''),
                    system: String(diagnosis.system ?? ''),
                    code,
                    description,
                    grounding,
                });
            }
            if (counted > 0) totals.insightsWithDiagnoses += 1;
            patientDiagnoses += counted;
        }
        if (patientDiagnoses > 0) totals.patientsWithDiagnoses += 1;
        if (patientNone > 0) totals.patientsWithNone += 1;
    }
    return { totals, rows };
}
