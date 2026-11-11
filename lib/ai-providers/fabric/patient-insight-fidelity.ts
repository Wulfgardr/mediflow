/*
 * Fedeltà dello stato delle decisioni nel Quadro paziente (ADR 0189).
 *
 * Unico elenco dei marcatori. Le regole leggono parole, non significati:
 * fermano le derive esplicite («come deciso» su una fonte «da decidere»,
 * «urgente» senza urgenza nella fonte) e lasciano passare le forme implicite.
 * Tutto il confronto avviene sul testo normalizzato: minuscolo, senza accenti,
 * apostrofi uniformati.
 */

type Marker = Readonly<{ key: string; pattern: RegExp }>;

const W = "[a-z0-9']+";
function marker(key: string, body: string): Marker {
    return Object.freeze({ key, pattern: new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, 'gu') });
}

const OPEN_VERBS = [
    'decidere', 'valutare', 'rivalutare', 'definire', 'discutere', 'concordare', 'confermare', 'prenotare',
    'programmare', 'avviare', 'iniziare', 'introdurre', 'eseguire', 'effettuare', 'richiedere', 'modificare',
    'aumentare', 'ridurre', 'sospendere', 'fare',
];
const THERAPY_CHANGES = 'aument[a-z]*|aggiunt[a-z]*|modific[a-z]*|intensificazion[a-z]*|titolazion[a-z]*|introduzion[a-z]*|sostituzion[a-z]*|riduzion[a-z]*|incremento';

/** Decisione ancora aperta, cercata nelle fonti citate. */
export const OPEN_DECISION_MARKERS: readonly Marker[] = Object.freeze([
    marker('da', `da (?:${OPEN_VERBS.join('|')})`),
    marker('in attesa', 'in attesa'),
    marker('propost', 'propost[oaie]'),
    marker('suggerit', 'suggerit[oaie]'),
    marker('consigliat', 'consigliat[oaie]'),
    marker('raccomandat', 'raccomandat[oaie]'),
    marker('valutare', 'valutare'),
    marker('considerare', 'considerare'),
    marker('eventual', 'eventual[ei]|eventualmente'),
    marker('ipotesi di', 'ipotesi di'),
]);

/** Decisione presa, cercata nella frase del modello. */
export const TAKEN_DECISION_MARKERS: readonly Marker[] = Object.freeze([
    marker('decis', 'decis[oaie]'),
    marker('stabilit', 'stabilit[oaie]'),
    marker('avviat', 'avviat[oaie]'),
    marker('iniziat', 'iniziat[oaie]'),
    marker('intensificat', 'intensificat[oaie]'),
    marker('introdott', 'introdott[oaie]'),
    marker('prescritt', 'prescritt[oaie]'),
    marker('prenotat', 'prenotat[oaie]'),
    marker('programmat', 'programmat[oaie]'),
    marker('in corso', `(?:${THERAPY_CHANGES})(?: ${W}){0,5}? in corso|in corso di (?:${THERAPY_CHANGES})`),
    marker('in fase di', 'in fase di (?:aggiustament[oi]|modific[a-z]*|titolazion[a-z]*|intensificazion[a-z]*|aument[oi])'),
]);

/** Urgenza, cercata nella frase e nelle fonti citate. */
export const URGENCY_MARKERS: readonly Marker[] = Object.freeze([
    marker('urgent', 'urgent[a-z]*'),
    marker('urgenz', 'urgenz[a-z]*'),
    marker('immediat', 'immediat[a-z]*'),
    marker('al piu presto', 'al piu presto'),
    marker('prima possibile', 'prima possibile'),
]);

/** Una di queste parole, entro tre parole prima del marcatore nella stessa proposizione, lo annulla. */
export const NEGATIONS: readonly string[] = Object.freeze(['non', 'senza', 'nessun', 'nessuna', 'nessuno', 'mai']);
const NEGATION_WINDOW = 3;

export function normalizeFidelityText(value: string): string {
    return value.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
        .replace(/[‘’ʼ`´]/gu, "'").replace(/\s+/gu, ' ').trim();
}

function negated(text: string, index: number): boolean {
    // La proposizione finisce a punteggiatura, parentesi o gruppo di citazione.
    const clause = text.slice(0, index).split(/[.,;:!?()[\]\n]/u).pop() ?? '';
    const words = clause.split(/[\s']+/u).filter(Boolean).slice(-NEGATION_WINDOW);
    return words.some((word) => NEGATIONS.includes(word));
}

/** Chiavi dei marcatori presenti e non negati in un testo già normalizzato. */
function present(text: string, markers: readonly Marker[]): readonly Readonly<{ key: string; match: string }>[] {
    const found: { key: string; match: string }[] = [];
    for (const item of markers) {
        item.pattern.lastIndex = 0;
        for (const match of text.matchAll(item.pattern)) {
            if (!negated(text, match.index ?? 0)) { found.push({ key: item.key, match: match[0] }); break; }
        }
    }
    return found;
}

export type PatientInsightFidelityFinding = Readonly<{
    rule: 'decision_state' | 'urgency';
    claimMarker: string;
    sourceMarker: string | null;
}>;

/** Indici 1-based delle fonti citate nei gruppi [S<n>] della frase. */
export function citedSourceIndexes(claim: string): readonly number[] {
    const groups = claim.match(/\[(?:S\d+|DATI-INCOMPLETI)(?:,\s*(?:S\d+|DATI-INCOMPLETI))*\]/gu) ?? [];
    const indexes = groups.flatMap((group) => group.slice(1, -1).split(',').map((token) => token.trim()))
        .filter((token) => /^S\d+$/u.test(token)).map((token) => Number(token.slice(1)));
    return Object.freeze([...new Set(indexes)]);
}

/**
 * Confronta una frase con il testo delle fonti che cita.
 * Restituisce il primo motivo di infedeltà, oppure null.
 */
export function claimFidelityFinding(claim: string, citedSources: readonly string[]): PatientInsightFidelityFinding | null {
    const line = normalizeFidelityText(claim.replace(/\[(?:S\d+|DATI-INCOMPLETI)(?:,\s*(?:S\d+|DATI-INCOMPLETI))*\]/gu, '.'));
    const sources = citedSources.map(normalizeFidelityText);
    const sourceOpen = sources.flatMap((source) => present(source, OPEN_DECISION_MARKERS));
    if (sourceOpen.length > 0) {
        const corroborated = new Set(sources.flatMap((source) => present(source, TAKEN_DECISION_MARKERS)).map((item) => item.key));
        const taken = present(line, TAKEN_DECISION_MARKERS).find((item) => !corroborated.has(item.key));
        if (taken) return Object.freeze({ rule: 'decision_state', claimMarker: taken.match, sourceMarker: sourceOpen[0].match });
    }
    const urgency = present(line, URGENCY_MARKERS);
    if (urgency.length > 0 && !sources.some((source) => present(source, URGENCY_MARKERS).length > 0)) {
        return Object.freeze({ rule: 'urgency', claimMarker: urgency[0].match, sourceMarker: null });
    }
    return null;
}

/**
 * Applica le regole a ogni frase di una proposta. `sources` sono i testi delle
 * fonti nell'ordine [S1], [S2], ... con cui il modello li ha ricevuti.
 */
export function proposalFidelityFindings(claims: readonly string[], sources: readonly string[]): readonly Readonly<{ claim: string; finding: PatientInsightFidelityFinding }>[] {
    const findings: Readonly<{ claim: string; finding: PatientInsightFidelityFinding }>[] = [];
    for (const claim of claims) {
        if (!claim) continue;
        const cited = citedSourceIndexes(claim).map((index) => sources[index - 1]).filter((value): value is string => typeof value === 'string');
        const finding = claimFidelityFinding(claim, cited);
        if (finding) findings.push(Object.freeze({ claim, finding }));
    }
    return Object.freeze(findings);
}
