/* @Codex */
const MAX_STORED_DOCUMENT_CHARS = 3000;
const LONG_DOCUMENT_LINE_CHARS = 240;

/* @Codex */
const DOCUMENT_SIGNAL_KEYWORDS = [
    'anamnesi',
    'allerg',
    'diagnosi',
    'esito',
    'ricovero',
    'ingresso',
    'dimission',
    'terapia',
    'farmac',
    'domiciliar',
    'prescr',
    'indicazioni',
    'follow',
    'controll',
    'riabilit',
    'deambul',
    'cammino',
    'barthel',
    'tinetti',
    'nrs',
    'adi',
    'caregiver',
    'assist',
    'esami',
    'ematic',
    'laborator',
    'ecg',
    'referto',
    'valutazione',
    'conclusioni',
    'quesito',
    'istolog',
    'biops',
    'vaccin',
    'patologia',
    'icd',
    'codice',
];

const DOCUMENT_HEADING_SPLIT_REGEX = new RegExp(
    `\\s{2,}(?=(?:${DOCUMENT_SIGNAL_KEYWORDS.join('|')})\\w*)`,
    'iu',
);
const DOCUMENT_SENTENCE_SPLIT_REGEX = /(?<=[.;!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9])/u;

function splitLongDocumentLine(line: string): string[] {
    let parts = [line.trim()];

    for (const splitter of [DOCUMENT_HEADING_SPLIT_REGEX, DOCUMENT_SENTENCE_SPLIT_REGEX]) {
        parts = parts.flatMap((part) => {
            const trimmed = part.trim();
            if (!trimmed) return [];
            if (trimmed.length <= LONG_DOCUMENT_LINE_CHARS) return [trimmed];

            const fragments = trimmed
                .split(splitter)
                .map((fragment) => fragment.trim())
                .filter(Boolean);

            return fragments.length > 1 ? fragments : [trimmed];
        });
    }

    return parts;
}

/* @Codex */
export function splitDocumentIntoLines(text: string): string[] {
    return text
        .replace(/\r/g, '\n')
        .split(/\n+/)
        .flatMap((line) => splitLongDocumentLine(line))
        .map((line) => line.trim())
        .filter(Boolean);
}

/* @Codex */
function isSignalHeading(line: string): boolean {
    const normalized = line.toLowerCase().trim().replace(/[:;\-–]+$/, '');
    if (!normalized) return false;
    if (normalized.length > 72) return false;
    if (/\b\d{1,3}[,\.]\d+\b/.test(normalized)) return false;
    if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(normalized)) return false;

    const tokenCount = normalized.split(/\s+/).length;
    return tokenCount <= 7
        && DOCUMENT_SIGNAL_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/* @Codex */
export function buildDocumentExcerpt(text: string, maxChars: number): string {
    if (!text) return '';
    if (text.length <= maxChars) return text;

    const lines = splitDocumentIntoLines(text);
    const scored = lines.map((line, index) => {
        const lower = line.toLowerCase();
        let score = Math.min(lower.length, 180);

        for (const keyword of DOCUMENT_SIGNAL_KEYWORDS) {
            if (lower.includes(keyword)) score += 180;
        }
        if (isSignalHeading(line)) score += 220;
        if (index > 0 && isSignalHeading(lines[index - 1])) score += 280;
        if (/\b(icd[\s:-]*\d{0,2}|\d[A-Z0-9\.]{2,})\b/i.test(lower)) score += 220;
        if (/\b\d{1,3}(?:[,.]\d+)?\s*(?:mg|mcg|g|ui|gtt|cp|cps|fl|ml)\b/i.test(lower)) score += 140;
        if (/\b(?:sospend|riduc|introdu|prosegu|stop|follow|controll|adi|ambul|deambul)\w*/i.test(lower)) score += 120;
        if (/\d{1,3}[,\.]\d+/.test(lower)) score += 80;

        return { line, score, index };
    });

    scored.sort((left, right) => right.score - left.score || left.index - right.index);

    const pickedIndexes = new Set<number>();
    let total = 0;
    for (const item of scored) {
        const candidateIndexes = [
            item.index,
            isSignalHeading(item.line) ? item.index + 1 : -1,
            isSignalHeading(item.line) ? item.index + 2 : -1,
            item.index > 0 && isSignalHeading(lines[item.index - 1]) ? item.index - 1 : -1,
            item.index > 0 && isSignalHeading(lines[item.index - 1]) ? item.index + 1 : -1,
        ]
            .filter((candidate, position, source) => (
                candidate >= 0
                && candidate < lines.length
                && source.indexOf(candidate) === position
            ))
            .sort((left, right) => left - right);

        for (const candidateIndex of candidateIndexes) {
            if (pickedIndexes.has(candidateIndex)) continue;

            const candidateLine = lines[candidateIndex];
            const nextTotal = total + candidateLine.length + (pickedIndexes.size > 0 ? 1 : 0);
            if (pickedIndexes.size > 0 && nextTotal > maxChars) continue;

            pickedIndexes.add(candidateIndex);
            total = nextTotal;
            if (total >= maxChars) break;
        }

        if (total >= maxChars * 0.9) break;
    }

    if (total < maxChars * 0.35) {
        const head = text.slice(0, Math.floor(maxChars * 0.55));
        const tail = text.slice(-Math.floor(maxChars * 0.2));
        return `${head}\n...\n${tail}`;
    }

    return Array.from(pickedIndexes)
        .sort((left, right) => left - right)
        .map((index) => lines[index])
        .join('\n');
}

/* @Codex */
export function buildStoredDocumentExcerpt(text: string): string {
    return buildDocumentExcerpt(text, MAX_STORED_DOCUMENT_CHARS);
}
