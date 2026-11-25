import { clinicalFactContext, clinicalSentence, contextReview, isHistoricalTherapy } from './domain/documents/clinical-context-lexicon';
import { dossierFactBlockers } from './domain/documents/dossier-import';
import { preparedTokens, verifyPreparedFields } from './domain/documents/dossier-prepared';
import { catalogObservationCode } from './domain/documents/dossier-sections';
import { SERVICE_PRESCRIPTION_CATEGORIES } from './prescription-domain';

type Kind = 'therapy' | 'diagnosis' | 'observation' | 'exemption' | 'service_prescription';
const therapyInUse = /\b(?:prescriv\w*|prescritt\w*|assume|inizia|prosegue|in\s+terapia)\b/iu;
const factDateFields = { therapy: 'startDate', service_prescription: 'prescribedAt', diagnosis: 'date', observation: 'observedAt' } as const;
const categories = [
    ['lab', /\b(?:esam[ei]\s+(?:ematici|del\s+sangue|di\s+laboratorio)|emocromo|emoglobina|glicemia|creatinin\w*|urino?coltura|laboratorio)\b/iu],
    ['imaging', /\b(?:tc|tac|rmn?|rx|radiografi\w*|ecografi\w*|risonanza\s+magnetica|tomografi\w*|mammografi\w*)\b/iu],
    ['visit', /\bvisit[ae]\b/iu],
    ['rehab', /\b(?:riabilitazione|fisioterapia|fisiokinesiterapia)\b/iu],
    ['screening', /\bscreening\b/iu],
    ['procedure', /\b(?:endoscopia|colonscopia|gastroscopia|biopsia|infiltrazione)\b/iu],
] as const;

function literalQuote(source: string, quote: string): RegExpExecArray[] {
    if (quote.length < 12 || quote.length > 600) return [];
    const pattern = quote.split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+');
    const start = /^[\p{L}\p{N}]/u.test(quote) ? '(?<![\\p{L}\\p{N}])' : '';
    const end = /[\p{L}\p{N}]$/u.test(quote) ? '(?![\\p{L}\\p{N}])' : '';
    return [...source.matchAll(new RegExp(start + pattern + end, 'giu'))];
}

const comparable = (value: string) => value.normalize('NFC').replace(/[’‘]/gu, "'").replace(/[‐‑]/gu, '-').replace(/\u00ad/gu, '');
const normalized = (value: string) => comparable(value).replace(/\s+/gu, ' ').trim().toLocaleLowerCase('it-IT');

const labelledDate = /\bdata(?:\s+(?:(?:del|della|di)\s+)?(?:prescrizione|visita|prelievo|referto|esame|emissione|dimissione|documento|accettazione|refertazione))?\s*[:.]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4})\b/giu;

function documentDate(text: string): string | undefined {
    const dates = new Set([...text.matchAll(labelledDate)].map(([, raw]) => {
        if (/^\d{4}-/u.test(raw)) return raw;
        const [day, month, year] = raw.split(/[./-]/u);
        return year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
    }).filter(value => {
        const date = new Date(value + 'T00:00:00Z');
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }));
    return dates.size === 1 ? dates.values().next().value : undefined;
}

export function reviewAgentFact(kind: Kind, input: Record<string, string>, pdfText: string, literal: string) {
    const source = comparable(pdfText), quote = comparable(literal);
    const matches = literalQuote(source, quote);
    if (!matches.length) return null;
    const values = { ...input };
    const written = (value: string | undefined) => Boolean(value && normalized(quote).includes(normalized(value)));
    const context = matches.map(match => clinicalFactContext(kind, values, source, match.index, match.index + match[0].length));
    const blockers: string[] = [];
    const date = documentDate(source);
    if (kind !== 'exemption') {
        const key = factDateFields[kind];
        values[key] ||= date ?? '';
    }
    if (kind === 'therapy') {
        if (!values.status && matches.every(match => therapyInUse.test(clinicalSentence(source, match.index, match.index + match[0].length).passage))) {
            values.status = 'active';
        }
    }
    if (kind === 'service_prescription') {
        values.category ||= categories.find(([, pattern]) => pattern.test(values.serviceName ?? ''))?.[0] ?? 'other';
        if (!SERVICE_PRESCRIPTION_CATEGORIES.some(category => category === values.category)) blockers.push('Controlla la categoria della prestazione.');
        if ((values.items ?? '').split('\n').map(line => line.trim()).filter(Boolean).some(line => !written(line))) {
            blockers.push('Voci della prestazione da verificare sulla fonte.');
        }
        for (const field of ['clinicalQuestion', 'priority'] as const) {
            if (values[field] && !written(values[field])) blockers.push('Controlla quesito e priorità della prestazione sulla fonte.');
        }
    }
    if (kind === 'diagnosis' && (values.code || values.system) && (!values.system || !written(values.code) || !written(values.system))) {
        blockers.push('Codice della diagnosi da verificare sulla fonte.');
    }
    if (kind === 'observation') {
        const coded = catalogObservationCode(values.display ?? '', values.unit ?? '', values.value ?? '');
        if (coded && (!values.code || values.code === coded.code) && (!values.unitCode || values.unitCode === coded.unitCode)) {
            values.code = coded.code;
            values.unitCode = coded.unitCode;
        } else if (!values.unitCode || !written(values.code) || (coded && values.code !== coded.code)) {
            blockers.push('Codice dell’osservazione da verificare sulla fonte.');
        }
        if ([values.refLow, values.refHigh, values.refText].some(value => value && !written(value))) {
            blockers.push('Intervallo di riferimento da verificare sulla fonte.');
        }
    }
    if (kind === 'exemption') {
        values.code = (values.code ?? '').toUpperCase();
        if (!/^[A-Z0-9]{2,8}(?:\.[A-Z0-9]{1,8}){0,2}$/u.test(values.code)
            || !/\besen(?:zione|zioni|te)\b/iu.test(quote) || !written(values.code)) {
            blockers.push('Codice di esenzione da verificare sulla fonte.');
        }
    }
    const verified = verifyPreparedFields(kind, values, preparedTokens(matches[0][0]).map(token => token.text));
    if (verified.check !== 'ok' || verified.drop.length || values.subject && values.subject !== 'paziente') {
        blockers.push('Valori o soggetto della proposta da verificare sulla fonte.');
    }
    if (kind === 'therapy') values.dosage ||= 'non indicata nel documento';
    for (const evidence of context) {
        const contextualValues = { ...values, contextReview: contextReview(evidence, kind === 'therapy' && isHistoricalTherapy(values.status)) };
        blockers.push(...dossierFactBlockers({ factId: '', kind, values: contextualValues, negated: evidence.negated, origin: 'prepared', evidence: null, decision: 'pending' }));
    }
    return { values, blockers: [...new Set(blockers)] };
}
