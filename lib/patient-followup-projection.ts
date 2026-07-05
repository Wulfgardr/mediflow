/**
 * Proiezione read-only dei follow-up suggeriti dai documenti (S6, ADR 0057).
 *
 * Legge i fatti `followup` gia estratti e persistiti dentro
 * `patient.documentInsights[].evidencePack.facts` (nessuna nuova estrazione, nessun
 * accesso a DB/rete). Serve alla UI righe read-only "trovato nel documento X, da
 * valutare", con citazione della fonte. NESSUN auto-write: la promozione a checkup
 * avviene solo dietro conferma manuale, altrove.
 *
 * Attenzione (nota dai verificatori): il tag `planned` deriva da euristiche regex
 * fragili con default sempre-planned, NON e un tag clinico autorevole. Percio la UI
 * deve presentare questi elementi come "trovati nei documenti, da valutare", mai
 * come azioni dovute. Questo modulo si limita a proiettare; l'onesta e nella UI.
 */

import type { DocumentInsight } from '@/lib/db';

export interface FollowupSuggestion {
    id: string;
    label: string;
    excerpt: string;
    status: string;
    temporality: string;
    origin: string;
    citation: {
        sourceId: string;
        documentInsightId: string;
        fileName: string;
        documentDate?: string;
        snippet: string;
    };
}

const DEFAULT_MAX = 4;

function insightTime(insight: DocumentInsight): number {
    const raw = insight.evidencePack?.source?.documentDate ?? insight.date;
    const t = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(t) ? t : 0;
}

function normalizeLabel(label: string): string {
    return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Estrae i follow-up pianificati citabili dagli evidencePack degli insight.
 * Ordine: documenti piu recenti prima; dedup per label normalizzato; cap a max.
 */
export function projectFollowupSuggestions(
    documentInsights: DocumentInsight[] | undefined | null,
    options: { max?: number } = {},
): FollowupSuggestion[] {
    if (!Array.isArray(documentInsights) || documentInsights.length === 0) return [];
    const max = options.max ?? DEFAULT_MAX;

    const insights = [...documentInsights]
        .filter((insight) => insight?.evidencePack?.facts?.length)
        .sort((a, b) => insightTime(b) - insightTime(a));

    const seen = new Set<string>();
    const suggestions: FollowupSuggestion[] = [];

    for (const insight of insights) {
        const pack = insight.evidencePack;
        if (!pack) continue;
        const source = pack.source;
        // Solo follow-up pianificati; esclude resolved/suspended/historical taggati
        // dal layer (non re-inventiamo euristiche, ADR 0057).
        const followups = pack.facts.filter((fact) =>
            fact.kind === 'followup'
            && (fact.temporality === 'planned' || fact.status === 'planned'),
        );

        for (const fact of followups) {
            const key = normalizeLabel(fact.label);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            suggestions.push({
                id: `${source.documentInsightId}:${fact.id}`,
                label: fact.label,
                excerpt: fact.excerpt,
                status: fact.status,
                temporality: fact.temporality,
                origin: fact.origin,
                citation: {
                    sourceId: fact.sourceId,
                    documentInsightId: source.documentInsightId,
                    fileName: source.fileName,
                    documentDate: source.documentDate,
                    snippet: fact.excerpt,
                },
            });
            if (suggestions.length >= max) return suggestions;
        }
    }

    return suggestions;
}
