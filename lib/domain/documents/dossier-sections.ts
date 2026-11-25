/**
 * Proposte strutturate del dossier (ADR 0175), solo da etichette esplicite del documento.
 *
 * La segmentazione è conservativa: una sezione inizia solo con un'etichetta del
 * vocabolario seguita da «:» oppure con un titolo markdown di AnyDoc, e finisce alla
 * sezione successiva. Funziona anche quando l'estrattore unisce le righe in un
 * paragrafo. Ogni proposta porta l'evidenza (offset nel testo conservato), la
 * negazione, il soggetto (paziente o familiare), il riferimento temporale e
 * l'incertezza dichiarati nel testo. Nessuna data o codice è dedotto: un campo
 * mancante resta vuoto e blocca l'applicazione finché il medico non lo completa.
 * Il testo che nessuna proposta copre resta un residuo esplicito.
 */

import { clinicalHeadingPattern, contextReview, familyHeadings, headingQualifiers, legacySectionFamily, legacySectionNegation, suspensionHeadings } from './clinical-context-lexicon';
import { loincObservationNames } from '../../terminology';

export type DossierSectionKind =
    | 'diagnosis' | 'anamnesis' | 'anamnesis_family' | 'medication' | 'services' | 'clinical_question' | 'prosthetic'
    | 'invalidity' | 'assessment' | 'followup' | 'care_context';

export interface DossierSection { kind: DossierSectionKind; label: string; labelStart: number; start: number; end: number }

const labelSource = (label: string) => label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/ /gu, '\\s+');
const LABELS: Array<{ kind: DossierSectionKind; source: string }> = [
    ...familyHeadings.map((label) => ({ kind: 'anamnesis_family' as const, source: labelSource(label) })),
    { kind: 'anamnesis', source: String.raw`anamnesi(?:\s+(?:patologica\s+(?:remota|prossima)|fisiologica|remota|prossima|clinica))?` },
    { kind: 'diagnosis', source: String.raw`diagnosi(?:\s+(?:principale|secondari[ae]|alla\s+dimissione|di\s+dimissione|clinica|di\s+ingresso))?` },
    { kind: 'medication', source: String.raw`(?:terapia(?:\s+(?:domiciliare|in\s+atto|attuale|in\s+corso|alla\s+dimissione|consigliata|farmacologica|pregressa|precedente))?|farmaci(?:\s+in\s+uso)?)` },
    { kind: 'services', source: String.raw`(?:(?:esami|prestazioni|accertamenti|indagini)(?:\s+(?:richiest[ie]|da\s+eseguire|consigliat[ie]|prescritt[ie]))?|si\s+richiede|prestazione\s+richiesta)` },
    { kind: 'clinical_question', source: String.raw`quesito(?:\s+(?:diagnostico|clinico))?` },
    { kind: 'prosthetic', source: String.raw`(?:ausili|ausilio|presidi|presidio|dispositivi|dispositivo|protesi|ortesi)(?:\s+(?:prescritt[oi]|richiest[oi]|forniti|consegnat[oi]))?` },
    { kind: 'invalidity', source: String.raw`(?:invalidit[àa](?:\s+civile)?|esito\s+(?:della\s+)?(?:commissione|visita\s+collegiale)|giudizio\s+(?:medico[- ]legale|finale|della\s+commissione))` },
    { kind: 'assessment', source: String.raw`(?:esame\s+obiettivo|obiettivit[àa]|valutazione(?:\s+(?:clinica|funzionale|multidimensionale|geriatrica))?|conclusioni|giudizio\s+clinico)` },
    { kind: 'followup', source: String.raw`(?:indicazioni|raccomandazioni|controlli|follow[- ]?up|si\s+consiglia)` },
    { kind: 'care_context', source: String.raw`(?:contesto\s+(?:sociale|assistenziale|familiare)|situazione\s+(?:sociale|familiare|abitativa)|caregiver|assistenza\s+domiciliare|rete\s+assistenziale)` },
];
const LABEL_RE = new RegExp(String.raw`(?<![\p{L}\p{N}])(${LABELS.map((label) => `(?:${label.source})`).join('|')})\s*:`, 'giu');
const HEADING_RE = new RegExp(String.raw`^[ \t]*#{1,6}[ \t]*(${LABELS.map((label) => `(?:${label.source})`).join('|')})[ \t]*:?[ \t]*$`, 'gimu');

const suspensionLabels = suspensionHeadings.map(labelSource);
const SUSPENSION_LABEL_RE = new RegExp(String.raw`(?<![\p{L}\p{N}])(${suspensionLabels.join('|')})[ \t]*:`, 'giu');

function kindOf(label: string, structured: boolean): DossierSectionKind | undefined {
    if (structured && suspensionLabels.some((source) => new RegExp(`^(?:${source})$`, 'iu').test(label))) return 'medication';
    const hasCue = structured && contextReview(headingQualifiers(label));
    return LABELS.find(({ kind, source }) => {
        const ending = hasCue && (kind === 'medication' || kind === 'diagnosis') ? String.raw`(?:[ \t].*)?$` : '$';
        return new RegExp(`^(?:${source})${ending}`, 'iu').test(label);
    })?.kind;
}

export function segmentDossierSections(text: string, structured = false): DossierSection[] {
    const marks: Array<{ label: string; labelStart: number; start: number }> = [];
    for (const match of [...text.matchAll(LABEL_RE), ...text.matchAll(HEADING_RE)]) {
        marks.push({ label: match[1], labelStart: match.index, start: match.index + match[0].length });
    }
    const headings = structured ? [...text.matchAll(clinicalHeadingPattern)] : [];
    if (structured) {
        for (const match of text.matchAll(SUSPENSION_LABEL_RE)) {
            marks.push({ label: match[1], labelStart: match.index, start: match.index + match[0].length });
        }
        for (const match of headings) {
            const label = match[1] ?? match[2];
            if (kindOf(label, true)) marks.push({ label, labelStart: match.index + match[0].indexOf(label), start: match.index + match[0].length });
        }
    }
    marks.sort((a, b) => a.labelStart - b.labelStart);
    const unique = marks.filter((mark, index) => index === 0 || mark.labelStart >= marks[index - 1].start);
    return unique.map((mark, index) => {
        const next = unique[index + 1]?.labelStart ?? text.length;
        const lineEnd = text.indexOf('\n', mark.start);
        const endOfLine = lineEnd === -1 ? text.length : lineEnd;
        const inline = text.slice(mark.start, endOfLine).trim().length > 0;
        const blank = structured ? /\r?\n[ \t]*\r?\n/gu : /\n[ \t]*\n/gu;
        blank.lastIndex = mark.start;
        const paragraphEnd = blank.exec(text)?.index ?? text.length;
        const nextHeading = headings.find((heading) => heading.index >= mark.start)?.index ?? text.length;
        const end = Math.min(next, nextHeading, inline ? endOfLine : paragraphEnd);
        return { kind: kindOf(mark.label, structured) ?? 'assessment', label: mark.label.replace(/\s+/gu, ' ').trim(), labelStart: mark.labelStart, start: mark.start, end };
    }).filter((section) => text.slice(section.start, section.end).trim().length > 0);
}

export interface DossierSpan { text: string; start: number; end: number }

/** Voci di una sezione: a capo, punto e virgola, elenchi puntati o numerati. Offset assoluti. */
export function splitSectionItems(text: string, start: number, end: number): DossierSpan[] {
    const items: DossierSpan[] = [];
    const separator = /\n+|;|•|(?:^|\s)-\s|\s\d{1,2}[).]\s/gu;
    const body = text.slice(start, end);
    let cursor = 0;
    const push = (from: number, to: number) => {
        const raw = body.slice(from, to);
        // Marcatori di elenco (-, *, •, 1), 2.) e titoli markdown non fanno parte della voce.
        const marker = /^\s*(?:#{1,6}\s*|[-*•]\s+|\d{1,2}[).]\s+)?/u.exec(raw)?.[0].length ?? 0;
        const rest = raw.slice(marker);
        const lead = marker + (rest.length - rest.trimStart().length);
        const trimmed = rest.trim().replace(/[.,]\s*$/u, '');
        if (trimmed.replace(/[^\p{L}\p{N}]/gu, '').length >= 2) items.push({ text: trimmed, start: start + from + lead, end: start + from + lead + rest.trim().length });
    };
    for (const match of body.matchAll(separator)) { push(cursor, match.index!); cursor = match.index! + match[0].length; }
    push(cursor, body.length);
    return items;
}

const UNCERTAINTY = /\b(?:sospett[oaie]?|probabil[ei]|possibil[ei]|verosimil[ei]|da\s+escludere|in\s+corso\s+di\s+accertamento|da\s+confermare|dubbi[oa])\b|\?/iu;

export interface DossierQualifiers { negated: boolean; subject: 'paziente' | 'familiare'; certainty: '' | 'incerta'; temporality: string }

export function legacyQualifiersOf(item: string, sectionKind: DossierSectionKind, sectionLabel: string): DossierQualifiers {
    const label = sectionLabel.toLowerCase();
    const temporality = /remot|pregress|precedent/u.test(label) || /\b(?:pregress|in\s+passato|anni\s+fa|esiti\s+di)\w*/iu.test(item) ? 'storica'
        : /dimission|consigliat/u.test(label) ? 'consigliata alla dimissione'
            : /in atto|attuale|in corso|domiciliare/u.test(label) ? 'in atto secondo il documento'
                : sectionKind === 'followup' ? 'pianificata' : '';
    return {
        negated: legacySectionNegation.test(item.split(/[,:]/u)[0] ?? item) || /^\s*(?:nega|non|no)\b/iu.test(item),
        subject: sectionKind === 'anamnesis_family' || legacySectionFamily.test(item) ? 'familiare' : 'paziente',
        certainty: UNCERTAINTY.test(item) ? 'incerta' : '',
        temporality,
    };
}

export function qualifiersOf(item: string, sectionKind: DossierSectionKind, sectionLabel: string, context = headingQualifiers(sectionLabel + '\n' + item)) {
    const legacy = legacyQualifiersOf(item, sectionKind, sectionLabel);
    return {
        ...legacy,
        negated: context.negated,
        subject: context.family ? 'familiare' as const : 'paziente' as const,
        temporality: context.suspended ? '' : legacy.temporality,
        suspended: context.suspended,
        contextReview: contextReview(context),
    };
}

const DOSE = /\b(\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|g|ml|mL|UI|U\.I\.|ui|gtt|gocce|cp|cpr|cps|compress[ae]|bustin[ae]|fl|puff|unità)\b.*)$/iu;

/** Farmaco e posologia solo se la posologia è scritta; altrimenti il nome resta e la dose va completata. */
export function parseMedicationItem(item: string): { drugName: string; dosage: string } {
    const match = DOSE.exec(item);
    if (!match || match.index === 0) return { drugName: item.trim(), dosage: '' };
    return { drugName: item.slice(0, match.index).replace(/[,:\s]+$/u, '').trim(), dosage: match[1].trim() };
}

const ISO_CODE = /\b(?:cod(?:ice)?\.?\s*)?ISO\s*[:.]?\s*(\d{2}[.\s]\d{2}(?:[.\s]\d{2,3})?)\b/iu;
const NRE = /\b(?:NRE|n(?:umero)?\.?\s*ricetta(?:\s+elettronica)?)\s*[:.]?\s*([0-9A-Z]{10,20})\b/u;
const PRIORITY = /\b(?:classe\s+di\s+)?priorit[àa]\s*[:.]?\s*([UBDP])\b/iu;

export function findPrescriptionReference(text: string): { value: string; start: number; end: number } | null {
    const match = NRE.exec(text);
    return match ? { value: match[1], start: match.index, end: match.index + match[0].length } : null;
}
export function findPriority(text: string): { value: string; start: number; end: number } | null {
    const match = PRIORITY.exec(text);
    return match ? { value: match[1].toUpperCase(), start: match.index, end: match.index + match[0].length } : null;
}
export function findIsoCode(item: string): string { return ISO_CODE.exec(item)?.[1].replace(/\s/gu, '.') ?? ''; }

export function prostheticStatusOf(text: string): string {
    if (/collaudat/iu.test(text)) return 'tested';
    if (/consegnat|fornit/iu.test(text)) return 'delivered';
    if (/autorizzat/iu.test(text)) return 'authorized';
    if (/presentat|inoltrat/iu.test(text)) return 'submitted';
    if (/prescri/iu.test(text)) return 'prescribed';
    return '';
}

const SCALE_NAMES = String.raw`Barthel|MMSE|Mini[- ]?Mental(?:\s+State)?|IADL|ADL|Tinetti|Braden|Norton|NRS|VAS|GDS|CIRS|MNA|CDR|Karnofsky|ECOG`;
const SCALE_DATE = String.raw`(?:\d{1,2}/)?\d{1,2}/\d{4}`;
const SCORE_LABEL = String.raw`(?:punteggio|totale|score)(?:\s+di)?`;
// Una data richiede un separatore/etichetta prima del punteggio. Se il ramo data
// non trova un punteggio, il ramo ordinario non può consumarne soltanto il mese.
const SCALE = new RegExp(String.raw`\b(${SCALE_NAMES})\b\s*(?:${SCALE_DATE}\s*(?:[:=]\s*(?:${SCORE_LABEL}\s*)?|${SCORE_LABEL}\s*[:=]?\s*)|(?:${SCORE_LABEL}\s*)?[:=]?\s*)(?!${SCALE_DATE}\b)(\d{1,3}(?:[.,]\d+)?)(?![\d.,])(?:\s*(?:/|su)\s*(\d{1,3})(?!\d))?`, 'giu');

export interface DossierScaleMention { scaleName: string; total: string; max: string; start: number; end: number }

/** Totali di scale nominate con un numero vicino: valori trascritti, non scale somministrate. */
export function findScaleMentions(text: string): DossierScaleMention[] {
    return [...text.matchAll(SCALE)].map((match) => ({ scaleName: match[1], total: match[2], max: match[3] ?? '',
        start: match.index!, end: match.index! + match[0].length }));
}

const INVALIDITY_SENTENCE = /[^.;\n]*\binvalidit[àa](?![\p{L}\p{N}])[^.;\n]*/giu;
export function findInvalidityMentions(text: string): DossierSpan[] {
    return [...text.matchAll(INVALIDITY_SENTENCE)].map((match) => ({ text: match[0].trim(), start: match.index! + (match[0].length - match[0].trimStart().length),
        end: match.index! + match[0].trimEnd().length }));
}
export function invalidityDetails(text: string): { percentage: string; allowance: string } {
    const percentage = /\b(\d{1,3})\s*%/u.exec(text)?.[1] ?? '';
    return { percentage: Number(percentage) <= 100 ? percentage : '', allowance: /indennit[àa]\s+di\s+accompagnamento/iu.test(text) ? (legacySectionNegation.test(text) ? 'negata o non riconosciuta' : 'riconosciuta') : '' };
}

const normalizedName = (value: string) => value.toLocaleLowerCase('it-IT').normalize('NFKD').replace(/[̀-ͯ]/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const NUMERIC_VALUE = /^-?[0-9]+(?:[.,][0-9]+)?$/u;
const observationKey = (name: string, unit: string) => `${normalizedName(name)}\u0000${unit}`;
const OBSERVATION_NAMES = loincObservationNames();
const PENDING_NAMES = new Set(OBSERVATION_NAMES.filter((entry) => !entry.active).map((entry) => normalizedName(entry.name)));
const OBSERVATION_CODES = OBSERVATION_NAMES.filter((entry) => entry.active).reduce((index, entry) => {
    const key = observationKey(entry.name, entry.unit);
    index.set(key, new Set([...(index.get(key) ?? []), entry.code]));
    return index;
}, new Map<string, Set<string>>());

export function catalogObservationCode(analyte: string, unit: string, value: string): { code: string; unitCode: string } | null {
    const unitCode = unit.trim();
    const name = normalizedName(analyte);
    if (!name || PENDING_NAMES.has(name) || !unitCode || !NUMERIC_VALUE.test(value.trim())) return null;
    const [only, ...others] = OBSERVATION_CODES.get(observationKey(analyte, unitCode)) ?? [];
    return only && others.length === 0 ? { code: only, unitCode } : null;
}

export interface DossierIdentityProposal { field: 'taxCode' | 'firstName' | 'lastName' | 'birthDate'; value: string; excerpt: string }

const LABEL_WORD = String.raw`(?:Nome|Cognome|Data|Codice|Nato|Nata|CF|Sesso|Indirizzo|Residenza)\b`;
const NAME_TOKEN = String.raw`(?!${LABEL_WORD})[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+(?:\s+(?!${LABEL_WORD})[A-ZÀ-Ý][A-Za-zÀ-ÿ'’]+){0,2}`;
const SURNAME = new RegExp(String.raw`\b[Cc]ognome\s*[:.]\s*(${NAME_TOKEN})`, 'u');
const GIVEN = new RegExp(String.raw`(?<![Cc]og)\b[Nn]ome\s*[:.]\s*(${NAME_TOKEN})`, 'u');
const BIRTH = /\b(?:nat[oa]\s+il|data\s+di\s+nascita\s*[:.]?)\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/iu;

/** Proposte d'anagrafica da etichette esplicite: il medico le inserisce solo con un gesto. */
export function proposeIdentityFields(text: string, patientTaxCode: string | null): DossierIdentityProposal[] {
    const proposals: DossierIdentityProposal[] = [];
    if (patientTaxCode) proposals.push({ field: 'taxCode', value: patientTaxCode, excerpt: `Codice fiscale paziente nel documento: ${patientTaxCode}` });
    const surname = SURNAME.exec(text); const given = GIVEN.exec(text); const birth = BIRTH.exec(text);
    if (surname) proposals.push({ field: 'lastName', value: surname[1].trim(), excerpt: surname[0].trim() });
    if (given) proposals.push({ field: 'firstName', value: given[1].trim(), excerpt: given[0].trim() });
    if (birth) {
        const [, d, m, y] = birth;
        const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        const date = new Date(`${iso}T00:00:00Z`);
        if (Number.isFinite(date.getTime()) && date.toISOString().startsWith(iso)) proposals.push({ field: 'birthDate', value: iso, excerpt: birth[0].trim() });
    }
    return proposals;
}
