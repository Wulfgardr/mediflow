/**
 * Uguaglianza clinica per il dossier (ADR 0175). Non è uguaglianza lessicale:
 * segno, qualificatori (<, >, ≤, ≥), unità, date e dosi restano significativi.
 * Nel dubbio due valori sono diversi: un falso conflitto chiede una decisione,
 * una falsa equivalenza la sottrae al medico.
 */

export interface ClinicalQuantity { qualifier: '<' | '<=' | '>' | '>=' | '='; value: number }

const QUANTITY = /^(<=|>=|≤|≥|<|>|=)?\s*([+-]?)(\d+(?:[.,]\d+)?)$/u;

/** Numero clinico con qualificatore. Virgola o punto decimale, mai separatori delle migliaia. */
export function parseClinicalQuantity(raw: string | undefined | null): ClinicalQuantity | null {
    const text = (raw ?? '').trim().replace(/\s+/gu, ' ');
    const match = QUANTITY.exec(text);
    if (!match) return null;
    const qualifier = match[1] === '≤' ? '<=' : match[1] === '≥' ? '>=' : (match[1] as ClinicalQuantity['qualifier'] | undefined) ?? '=';
    const value = Number(`${match[2]}${match[3].replace(',', '.')}`);
    return Number.isFinite(value) ? { qualifier, value } : null;
}

const collapse = (value: string | undefined | null) => (value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();

/** Testo clinico: spazi e maiuscole non contano, punteggiatura e segni sì. */
export function sameClinicalText(left: string | undefined | null, right: string | undefined | null): boolean {
    return collapse(left).toLocaleLowerCase('it-IT') === collapse(right).toLocaleLowerCase('it-IT');
}

export function sameClinicalValue(left: string | number | undefined | null, right: string | number | undefined | null): boolean {
    const a = parseClinicalQuantity(left === undefined || left === null ? '' : String(left));
    const b = parseClinicalQuantity(right === undefined || right === null ? '' : String(right));
    if (a && b) return a.qualifier === b.qualifier && a.value === b.value;
    if (a || b) return false;
    return sameClinicalText(left === undefined || left === null ? '' : String(left), right === undefined || right === null ? '' : String(right));
}

/** Unità: UCUM distingue maiuscole (mg/dL, mmol/L). Assente da un solo lato = diversa. */
export function sameUnit(left: string | undefined | null, right: string | undefined | null): boolean {
    return collapse(left) === collapse(right);
}

export function clinicalDay(value: unknown): string {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
    const text = typeof value === 'string' ? value.trim() : '';
    return /^\d{4}-\d{2}-\d{2}/u.test(text) ? text.slice(0, 10) : '';
}

export function sameDay(left: unknown, right: unknown): boolean { return clinicalDay(left) === clinicalDay(right); }

/** Posologia: «5mg» e «5 mg» coincidono, «5 mg» e «10 mg» no; ogni altra parola resta. */
export function normalizeDosage(value: string | undefined | null): string {
    return collapse(value).toLocaleLowerCase('it-IT')
        .replace(/(\d),(\d)/gu, '$1.$2')
        .replace(/(\d)\s+(?=[a-zµμ%])/gu, '$1')
        .replace(/\s*\/\s*/gu, '/');
}

export function sameDosage(left: string | undefined | null, right: string | undefined | null): boolean {
    return normalizeDosage(left) === normalizeDosage(right);
}

/** Nome di farmaco o prestazione per riconoscere lo stesso soggetto, non per dire che il contenuto coincide. */
export function identityName(value: string | undefined | null): string {
    return collapse(value).toLocaleLowerCase('it-IT').normalize('NFKD').replace(/[̀-ͯ]/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function sameOptional(left: unknown, right: unknown): boolean {
    const a = left === undefined || left === null ? '' : String(left);
    const b = right === undefined || right === null ? '' : String(right);
    return collapse(a) === collapse(b);
}
