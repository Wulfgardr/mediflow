/*
 * Il riassunto della sintesi va al medico in italiano.
 *
 * Misura dell'11/11/2026 con qwen3.5:35b-a3b: sul referto di laboratorio 8 riassunti su 20 erano
 * in inglese («Patient ... underwent lab tests ... Results indicate ...»), 6 dei quali accettati.
 * Il prompt e' in inglese e il modello a volte ne copia la lingua.
 *
 * Criterio: si contano solo parole grammaticali, che non sono termini medici: articoli,
 * preposizioni, congiunzioni e ausiliari inglesi da una parte, italiani dall'altra. Il riassunto e'
 * scartato quando ha almeno tre parole grammaticali inglesi e piu' inglesi che italiane. I termini
 * medici inglesi che un referto italiano usa davvero (follow-up, screening, trend, target, LDL,
 * HbA1c, eGFR, CKD-EPI, nomi di farmaci) non sono nelle liste e quindi non pesano: una frase
 * italiana li porta sempre insieme a «il», «di», «con», «per», che pesano dall'altra parte.
 * Parole uguali nelle due lingue («in», «a», «non», «per» come latinismo) sono escluse.
 */

const ENGLISH = new Set([
    'the', 'and', 'of', 'with', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'been', 'be',
    'this', 'that', 'these', 'those', 'which', 'who', 'for', 'to', 'from', 'by', 'at', 'on', 'an',
    'its', 'their', 'his', 'her', 'than', 'without', 'within', 'should', 'shows', 'showed',
    'underwent', 'indicate', 'indicates', 'indicating', 'suggest', 'suggests', 'suggesting',
    'patient', 'presents', 'presented', 'results', 'levels', 'requires', 'recommended', 'further',
]);
const ITALIAN = new Set([
    'il', 'lo', 'la', 'gli', 'le', 'di', 'del', 'dello', 'della', 'dei', 'degli', 'delle', 'e', 'è',
    'ed', 'con', 'che', 'un', 'uno', 'una', 'sono', 'al', 'allo', 'alla', 'ai', 'agli', 'alle',
    'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'da', 'dal', 'dallo', 'dalla', 'dai', 'si',
    'sul', 'sulla', 'tra', 'fra', 'come', 'anche', 'paziente', 'presenta', 'evidenzia', 'nato', 'nata',
]);

export type DocumentSynthesisSummaryLanguage = Readonly<{ english: number; italian: number; acceptable: boolean }>;

export function documentSynthesisSummaryLanguage(summary: string): DocumentSynthesisSummaryLanguage {
    let english = 0; let italian = 0;
    const words = typeof summary === 'string' ? summary.toLowerCase().match(/[\p{L}]+/gu) ?? [] : [];
    for (const word of words) {
        if (ENGLISH.has(word)) english += 1;
        else if (ITALIAN.has(word)) italian += 1;
    }
    return Object.freeze({ english, italian, acceptable: !(english >= 3 && english > italian) });
}
