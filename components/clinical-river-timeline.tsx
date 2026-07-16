'use client';

import { CalendarClock, FileText, ScanText, Stethoscope } from 'lucide-react';

/* @Codex */
import { compactClinicalRichText } from '@/lib/clinical-rich-text';
import type { Checkup, ClinicalEntry, DocumentInsight } from '@/lib/db';
import { LumeFilo } from '@/components/ui/lume-filo';

interface ClinicalRiverTimelineProps {
    entries: ClinicalEntry[];
    checkups: Checkup[];
    documentInsights: DocumentInsight[];
}

type RiverItem = {
    id: string;
    title: string;
    summary: string;
    typeLabel?: string;
    date: Date;
    kind: 'entry' | 'checkup' | 'document';
};

const ENTRY_TYPE_LABELS: Record<string, string> = {
    visit: 'Visita',
    phone: 'Telefonata',
    exam: 'Esame',
    hospitalization: 'Ricovero',
    access: 'Accesso',
    note: 'Nota',
    scale: 'Scala',
    remote: 'Da remoto',
};

/*
 * @Codex Niente meta-testo: il riassunto usa SEMPRE il contenuto reale della voce
 * (compactClinicalRichText). Il tipo viaggia come etichetta, non sostituisce il
 * testo, cosi un esame patologico non appare identico a uno normale.
 */
function getEntrySummary(entry: ClinicalEntry): string {
    return compactClinicalRichText(entry.content, 220);
}

const ENTRY_LIMIT = 4;
const CHECKUP_LIMIT = 2;
const DOCUMENT_LIMIT = 2;
const RIVER_LIMIT = 6;

function buildRiverItems(
    entries: ClinicalEntry[],
    checkups: Checkup[],
    documentInsights: DocumentInsight[],
): RiverItem[] {
    const entryItems = entries
        .filter((entry) => !entry.deletedAt)
        .slice(0, ENTRY_LIMIT)
        .map((entry) => ({
            id: `entry-${entry.id}`,
            title: entry.title || 'Voce clinica',
            summary: getEntrySummary(entry),
            typeLabel: ENTRY_TYPE_LABELS[entry.type] ?? 'Clinico',
            date: new Date(entry.date),
            kind: 'entry' as const,
        }));

    const checkupItems = checkups.slice(0, CHECKUP_LIMIT).map((checkup) => ({
        id: `checkup-${checkup.id}`,
        title: checkup.title,
        summary: checkup.notes?.trim() ?? '',
        date: new Date(checkup.date),
        kind: 'checkup' as const,
    }));

    const documentItems = documentInsights.slice(0, DOCUMENT_LIMIT).map((insight) => ({
        id: `document-${insight.id}`,
        title: insight.fileName,
        summary: insight.summary,
        date: new Date(insight.date),
        kind: 'document' as const,
    }));

    return [...entryItems, ...checkupItems, ...documentItems]
        .sort((left, right) => right.date.getTime() - left.date.getTime())
        .slice(0, RIVER_LIMIT);
}

function formatDate(date: Date) {
    return date.toLocaleDateString('it-IT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function getItemPresentation(kind: RiverItem['kind']) {
    if (kind === 'checkup') {
        return {
            icon: CalendarClock,
            tint: 'text-[color:var(--lume-accent)]',
            label: 'Follow-up',
        };
    }
    if (kind === 'document') {
        return {
            icon: ScanText,
            tint: 'text-[color:var(--lume-ink)]',
            label: 'Evidenza',
        };
    }
    return {
        icon: Stethoscope,
        tint: 'text-[color:var(--lume-accent)]',
        label: 'Clinico',
    };
}

export function ClinicalRiverTimeline({
    entries,
    checkups,
    documentInsights,
}: ClinicalRiverTimelineProps) {
    const items = buildRiverItems(entries, checkups, documentInsights);
    /* @Codex Conteggio onesto: la river e una anteprima, non l'elenco completo. */
    const totalAvailable =
        entries.filter((entry) => !entry.deletedAt).length + checkups.length + documentInsights.length;
    const hiddenCount = Math.max(totalAvailable - items.length, 0);

    if (items.length === 0) {
        return (
            <div className="rounded-[var(--lume-radius-card)] border border-[color:var(--lume-border-color)] px-5 py-8 text-sm text-[color:var(--lume-ink-muted)]">
                Nessun evento recente: visite, documenti e controlli compariranno qui.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="relative space-y-3" role="feed" aria-label="Timeline clinica del paziente">
                <LumeFilo
                    variant="spina"
                    nodeCount={items.length}
                    anchorSelector="[data-lume-river-node]"
                    className="absolute left-[13.5px] w-px"
                />
                {items.map((item, index) => {
                    const presentation = getItemPresentation(item.kind);
                    const Icon = presentation.icon;

                    return (
                        <div key={item.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-4">
                            <div className="flex flex-col items-center">
                                <div data-lume-river-node className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--lume-accent)] bg-[color:var(--lume-surface-field)] ${presentation.tint}`}>
                                    <Icon className="h-4 w-4" />
                                </div>
                            </div>
                            <article
                                className="rounded-[var(--lume-radius-card)] bg-[color:var(--lume-surface-field)] p-4 outline-none focus-visible:bg-[color:var(--lume-surface-focal)] focus-visible:shadow-[var(--lume-focus-ring)]"
                                aria-posinset={index + 1}
                                aria-setsize={items.length}
                                tabIndex={0}
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--lume-ink-muted)]">
                                        {item.typeLabel ?? presentation.label}
                                    </span>
                                    <span className="lume-registro inline-flex items-center gap-1 text-[12px] text-[color:var(--lume-ink-muted)]">
                                        <FileText className="h-3.5 w-3.5" />
                                        {formatDate(item.date)}
                                    </span>
                                </div>
                                <h3 className="mt-2 text-base font-semibold text-[color:var(--lume-ink)]">{item.title}</h3>
                                {item.summary ? (
                                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                                        {item.summary}
                                    </p>
                                ) : null}
                            </article>
                        </div>
                    );
                })}
            </div>

            {hiddenCount > 0 ? (
                <p className="pl-[44px] text-[12px] text-[color:var(--lume-ink-muted)]">
                    Mostrati gli ultimi {items.length} eventi di {totalAvailable}. La cronologia completa è nel diario e nei documenti del paziente.
                </p>
            ) : null}
        </div>
    );
}
