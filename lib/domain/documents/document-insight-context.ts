import type { DocumentInsight } from '../../db';

/* @Codex */
export type DedupedDocumentInsightsResult = {
    insights: DocumentInsight[];
    omittedCount: number;
};

/* @Codex */
function normalizeDocumentContextText(value: string | null | undefined): string {
    return (value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/* @Codex */
function buildDateKey(value: unknown): string {
    const parsed = value instanceof Date ? value : new Date(value as string | number | Date);
    if (Number.isNaN(parsed.getTime())) return 'unknown-day';
    return parsed.toISOString().slice(0, 10);
}

/* @Codex */
function buildSummaryAnchor(value: string | null | undefined): string {
    const normalized = normalizeDocumentContextText(value);
    if (!normalized) return '';
    return normalized
        .split(' ')
        .filter((token) => token.length > 2)
        .slice(0, 8)
        .join(' ');
}

/* @Codex */
function deriveInsightKind(insight: DocumentInsight): string {
    const signal = normalizeDocumentContextText([
        insight.fileName,
        insight.summary,
        insight.rawMarkdown,
    ].filter(Boolean).join(' '));

    if (/(pronto soccorso|\bps\b|verbale|accesso in ps)/.test(signal)) return 'emergency';
    if (/(dimission|cartella clinica|ricovero|degenza)/.test(signal)) return 'discharge';
    if (/(fisiatr|riabilit|programma riabil|fkt)/.test(signal)) return 'rehab';
    if (/(consulenz|visita specialistica|cardiolog|endocrinolog|urolog)/.test(signal)) return 'consult';
    if (/(laborator|esami ematici|chimico fisici|vaccin|istolog|biops)/.test(signal)) return 'lab';
    return 'generic';
}

/* @Codex */
function buildInsightAnchor(insight: DocumentInsight): string {
    const firstDiagnosis = insight.extractedData?.diagnoses?.[0];
    if (firstDiagnosis?.code?.trim()) {
        const system = normalizeDocumentContextText(firstDiagnosis.system || 'icd');
        return `${system}:${normalizeDocumentContextText(firstDiagnosis.code)}`;
    }

    const summaryAnchor = buildSummaryAnchor(insight.summary);
    if (summaryAnchor) return `summary:${summaryAnchor}`;

    return `file:${buildSummaryAnchor(insight.fileName) || 'generic-document'}`;
}

/* @Codex */
function scoreInsightForContext(insight: DocumentInsight): number {
    const medications = insight.extractedData?.medications?.length || 0;
    const diagnoses = insight.extractedData?.diagnoses?.length || 0;
    const rawMarkdownLength = insight.rawMarkdown?.length || 0;

    let total = 0;
    total += diagnoses * 30;
    total += medications * 12;
    total += Math.min(40, Math.floor(rawMarkdownLength / 120));
    total += Math.min(25, Math.floor((insight.summary?.length || 0) / 16));

    switch (deriveInsightKind(insight)) {
        case 'discharge':
            total += 35;
            break;
        case 'rehab':
            total += 22;
            break;
        case 'emergency':
            total += 20;
            break;
        case 'consult':
            total += 15;
            break;
        case 'lab':
            total += 10;
            break;
        default:
            total += 4;
    }

    return total;
}

/* @Codex */
function buildDedupKey(insight: DocumentInsight): string {
    return `${buildDateKey(insight.date)}|${buildInsightAnchor(insight)}`;
}

/* @Codex */
export function dedupeDocumentInsightsForContext(insights: DocumentInsight[]): DedupedDocumentInsightsResult {
    const buckets = new Map<string, { insight: DocumentInsight; score: number }>();

    for (const insight of insights) {
        const key = buildDedupKey(insight);
        const score = scoreInsightForContext(insight);
        const previous = buckets.get(key);

        if (!previous || score > previous.score) {
            buckets.set(key, { insight, score });
        }
    }

    const deduped = Array.from(buckets.values())
        .map((item) => item.insight)
        .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

    return {
        insights: deduped,
        omittedCount: Math.max(0, insights.length - deduped.length),
    };
}
