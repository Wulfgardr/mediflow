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

import { LOINC_PENDING_VALIDATION, searchStaticTerminology } from '../../terminology';

export type DossierSectionKind =
    | 'diagnosis' | 'anamnesis' | 'anamnesis_family' | 'medication' | 'services' | 'clinical_question' | 'prosthetic'
    | 'invalidity' | 'assessment' | 'followup' | 'care_context';

export interface DossierSection { kind: DossierSectionKind; label: string; labelStart: number; start: number; end: number }

const LABELS: Array<{ kind: DossierSectionKind; source: string }> = [
    { kind: 'anamnesis_family', source: String.raw`anamnesi\s+familiare` },
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

function kindOf(label: string): DossierSectionKind {
    for (const entry of LABELS) if (new RegExp(`^(?:${entry.source})$`, 'iu').test(label.trim())) return entry.kind;
    return 'assessment';
}

/** Sezioni esplicite di un'unità di testo, con offset nel testo dell'unità. */
export function segmentDossierSections(text: string): DossierSection[] {
    const marks: Array<{ label: string; labelStart: number; start: number }> = [];
    for (const match of text.matchAll(LABEL_RE)) marks.push({ label: match[1], labelStart: match.index!, start: match.index! + match[0].length });
    for (const match of text.matchAll(HEADING_RE)) marks.push({ label: match[1], labelStart: match.index!, start: match.index! + match[0].length });
    marks.sort((a, b) => a.labelStart - b.labelStart);
    const unique = marks.filter((mark, index) => index === 0 || mark.labelStart >= marks[index - 1].start);
    return unique.map((mark, index) => {
        const next = index + 1 < unique.length ? unique[index + 1].labelStart : text.length;
        // Contenuto sulla stessa riga dell'etichetta: la sezione è quella riga. Contenuto a capo:
        // prosegue fino alla riga vuota. Un paragrafo unito dall'estrattore si ferma all'etichetta successiva.
        const lineEnd = text.indexOf('\n', mark.start);
        const inline = text.slice(mark.start, lineEnd === -1 ? text.length : lineEnd).trim().length > 0;
        const blank = /\n[ \t]*\n/gu; blank.lastIndex = mark.start;
        const paragraphEnd = blank.exec(text)?.index ?? text.length;
        const end = Math.min(next, inline ? (lineEnd === -1 ? text.length : lineEnd) : paragraphEnd);
        return { kind: kindOf(mark.label), label: mark.label.replace(/\s+/gu, ' ').trim(), labelStart: mark.labelStart, start: mark.start, end };
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

const NEGATION = /\b(?:non|nega|negano|negativ[oaie]|assenza\s+di|assente|esclus[oaie]|escludere|no)\b/iu;
const UNCERTAINTY = /\b(?:sospett[oaie]?|probabil[ei]|possibil[ei]|verosimil[ei]|da\s+escludere|in\s+corso\s+di\s+accertamento|da\s+confermare|dubbi[oa])\b|\?/iu;
const FAMILY = /\b(?:padre|madre|fratell[oi]|sorell[ae]|figli[oa]?|nonn[oaie]|zi[oa]|familiar[ei]|genitor[ei])\b/iu;

export interface DossierQualifiers { negated: boolean; subject: 'paziente' | 'familiare'; certainty: '' | 'incerta'; temporality: string }

export function qualifiersOf(item: string, sectionKind: DossierSectionKind, sectionLabel: string): DossierQualifiers {
    const label = sectionLabel.toLowerCase();
    const temporality = /remot|pregress|precedent/u.test(label) || /\b(?:pregress|in\s+passato|anni\s+fa|esiti\s+di)\w*/iu.test(item) ? 'storica'
        : /dimission|consigliat/u.test(label) ? 'consigliata alla dimissione'
            : /in atto|attuale|in corso|domiciliare/u.test(label) ? 'in atto secondo il documento'
                : sectionKind === 'followup' ? 'pianificata' : '';
    return {
        negated: NEGATION.test(item.split(/[,:]/u)[0] ?? item) || /^\s*(?:nega|non|no)\b/iu.test(item),
        subject: sectionKind === 'anamnesis_family' || FAMILY.test(item) ? 'familiare' : 'paziente',
        certainty: UNCERTAINTY.test(item) ? 'incerta' : '',
        temporality,
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

const SCALE = /\b(Barthel|MMSE|Mini[- ]?Mental(?:\s+State)?|IADL|ADL|Tinetti|Braden|Norton|NRS|VAS|GDS|CIRS|MNA|CDR|Karnofsky|ECOG)\b[^\d\n]{0,20}?(\d{1,3}(?:[.,]\d)?)(?:\s*(?:\/|su)\s*(\d{1,3}))?/giu;

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
    return { percentage: Number(percentage) <= 100 ? percentage : '', allowance: /indennit[àa]\s+di\s+accompagnamento/iu.test(text) ? (NEGATION.test(text) ? 'negata o non riconosciuta' : 'riconosciuta') : '' };
}

const normalizedName = (value: string) => value.toLocaleLowerCase('it-IT').normalize('NFKD').replace(/[̀-ͯ]/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Codice LOINC e unità UCUM solo per corrispondenza esatta col catalogo locale: nome
 * italiano (o sigla fra parentesi) uguale all'analita E unità uguale all'unità predefinita.
 * Le voci in validazione clinica non sono nel catalogo e non vengono mai proposte.
 */
export function catalogObservationCode(analyte: string, unit: string): { code: string; unitCode: string } | null {
    const wanted = normalizedName(analyte);
    if (!wanted) return null;
    // Un nome con una variante ancora in validazione clinica (matrice, unità, metodo) è ambiguo: nessuna proposta.
    if (LOINC_PENDING_VALIDATION.some((item) => normalizedName((item.displayIt ?? '').replace(/\(.*\)/u, '')) === wanted)) return null;
    for (const item of searchStaticTerminology('LOINC', '', 1000)) {
        const label = item.displayIt ?? '';
        const base = normalizedName(label.replace(/\(.*\)/u, ''));
        const abbreviation = normalizedName(/\(([^)]+)\)/u.exec(label)?.[1] ?? '');
        if ((base === wanted || (abbreviation && abbreviation === wanted)) && item.defaultUnit && item.defaultUnit === unit.trim()) {
            return { code: item.code, unitCode: item.defaultUnit };
        }
    }
    return null;
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
