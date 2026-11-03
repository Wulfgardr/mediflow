/* Test double for the neural redaction runner: finds synthetic corpus entities in a text.
 * Never imported by production.
 *
 * A token-level recognizer does not report an entity buried inside a longer alphanumeric
 * token. The card payload carries random 32-character hex identifiers (pseudonym, source
 * references), and a plain substring search found the corpus date "1972" inside them about
 * once in a thousand preparations, turning a clean card into a denial. An occurrence counts
 * only when no letter or digit touches it on either side. */
export type CorpusEntity = Readonly<{ type: string; text: string }>;
export type CorpusEntitySpan = { type: string; start: number; end: number; text: string; confidence: number };

const WORD = /[\p{L}\p{N}]/u;

export function corpusEntitySpans(text: string, entities: Iterable<CorpusEntity>, skip: ReadonlySet<string> = new Set()): CorpusEntitySpan[] {
    const spans: CorpusEntitySpan[] = [];
    for (const entity of entities) {
        if (skip.has(entity.text) || !entity.text) continue;
        let start = text.indexOf(entity.text);
        while (start >= 0) {
            const end = start + entity.text.length;
            const isolated = !WORD.test(text[start - 1] ?? '') && !WORD.test(text[end] ?? '');
            if (isolated) spans.push({ type: entity.type, start, end, text: entity.text, confidence: 1 });
            start = text.indexOf(entity.text, isolated ? end : start + 1);
        }
    }
    return spans;
}
