/*
 * Dove sta la citazione del modello nel testo della fonte.
 *
 * Prima si cerca la citazione identica, presente una sola volta (anche contando le occorrenze
 * sovrapposte). Se non c'e', si ripete il confronto ignorando SOLO la forma degli spazi bianchi:
 * ogni sequenza di spazi, tabulazioni e a capo vale come un solo spazio, e gli spazi all'inizio e
 * alla fine della citazione non contano. Misura dell'11/11/2026 con qwen3.5:35b-a3b: 4 scarti su 6
 * erano titoli seguiti da due a capo che il modello aveva fuso in uno spazio.
 *
 * Il confronto tollerante non accetta mai una parola mancante, aggiunta o cambiata: i caratteri
 * diversi dagli spazi devono coincidere uno per uno e nello stesso ordine, e uno spazio non puo'
 * sparire ne' comparire dove l'altro testo non ne ha. La citazione restituita e' sempre il tratto
 * della fonte, mai il testo del modello: e' quello che il medico vede e che la ricevuta firma.
 */

/**
 * Limite sulla citazione grezza, uguale per il controllo del tentativo locale e per il legame
 * dell'envelope: fino al doppio della fonte, perché gli spazi in più non contano. Il tratto
 * restituito non supera mai la fonte.
 */
export function documentSynthesisQuoteRawLimit(sourceText: string): number { return sourceText.length * 2; }

export type DocumentSynthesisQuoteLocation = Readonly<{ start: number; end: number; quote: string; exact: boolean }>;

const StringCharCodeAt = String.prototype.charCodeAt;
const StringSlice = String.prototype.slice;
const StringIndexOf = String.prototype.indexOf;
const ReflectApply = Reflect.apply;
const ObjectFreeze = Object.freeze;

function whitespace(code: number): boolean { return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d; }

/** Testo con gli spazi compattati e, per ogni carattere, la sua posizione nel testo originale. */
function collapse(text: string): Readonly<{ text: string; origin: readonly number[] }> {
    let output = ''; const origin: number[] = []; let pendingSpace = -1;
    for (let index = 0; index < text.length; index += 1) {
        const code = ReflectApply(StringCharCodeAt, text, [index]) as number;
        if (whitespace(code)) { if (pendingSpace < 0) pendingSpace = index; continue; }
        if (pendingSpace >= 0) { if (output.length > 0) { output += ' '; origin[origin.length] = pendingSpace; } pendingSpace = -1; }
        output += text[index]; origin[origin.length] = index;
    }
    return ObjectFreeze({ text: output, origin: ObjectFreeze(origin) });
}

function uniqueIndex(needle: string, haystack: string): number | null {
    if (needle.length === 0 || needle.length > haystack.length) return null;
    const first = ReflectApply(StringIndexOf, haystack, [needle]) as number;
    if (first < 0) return null;
    const second = ReflectApply(StringIndexOf, haystack, [needle, first + 1]) as number;
    return second < 0 ? first : null;
}

export function locateDocumentSynthesisQuote(quote: string, sourceText: string): DocumentSynthesisQuoteLocation | null {
    if (typeof quote !== 'string' || typeof sourceText !== 'string' || quote.length === 0 || quote.length > documentSynthesisQuoteRawLimit(sourceText)) return null;
    const exact = uniqueIndex(quote, sourceText);
    if (exact !== null) return ObjectFreeze({ start: exact, end: exact + quote.length, quote, exact: true });
    const needle = collapse(quote).text; const source = collapse(sourceText);
    const found = uniqueIndex(needle, source.text);
    if (found === null) return null;
    const start = source.origin[found]!; const last = source.origin[found + needle.length - 1]!;
    // Il carattere finale non e' mai uno spazio: `collapse` scrive uno spazio solo prima di un carattere pieno.
    const end = last + 1;
    return ObjectFreeze({ start, end, quote: ReflectApply(StringSlice, sourceText, [start, end]) as string, exact: false });
}
