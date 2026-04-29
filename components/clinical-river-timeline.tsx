'use client';

import { CalendarClock, FileText, ScanText, Stethoscope } from 'lucide-react';

/* @Codex */
import { compactClinicalRichText } from '@/lib/clinical-rich-text';
import type { Checkup, ClinicalEntry, DocumentInsight } from '@/lib/db';

interface ClinicalRiverTimelineProps {
    entries: ClinicalEntry[];
    checkups: Checkup[];
    documentInsights: DocumentInsight[];
}

type RiverItem = {
    id: string;
    title: string;
    summary: string;
    date: Date;
    kind: 'entry' | 'checkup' | 'document';
};

function getEntrySummary(entry: ClinicalEntry): string {
    if (entry.type === 'phone') return 'Contatto telefonico e riallineamento del percorso.';
    if (entry.type === 'exam') return 'Evento diagnostico o esame con follow-up clinico.';
    if (entry.type === 'hospitalization') return 'Passaggio ospedaliero rilevante per la timeline.';
    if (entry.type === 'remote') return 'Interazione remota con elementi utili al contesto.';
    if (entry.type === 'scale') return 'Valutazione strutturata inserita nel caso.';
    /* @Codex */
    return compactClinicalRichText(entry.content, 220) || 'Voce del diario clinico pronta alla revisione.';
}

function buildRiverItems(
    entries: ClinicalEntry[],
    checkups: Checkup[],
    documentInsights: DocumentInsight[],
): RiverItem[] {
    const entryItems = entries
        .filter((entry) => !entry.deletedAt)
        .slice(0, 4)
        .map((entry) => ({
            id: `entry-${entry.id}`,
            title: entry.title || 'Voce clinica',
            summary: getEntrySummary(entry),
            date: new Date(entry.date),
            kind: 'entry' as const,
        }));

    const checkupItems = checkups.slice(0, 2).map((checkup) => ({
        id: `checkup-${checkup.id}`,
        title: checkup.title,
        summary: checkup.notes?.trim() || 'Controllo programmato in agenda clinica.',
        date: new Date(checkup.date),
        kind: 'checkup' as const,
    }));

    const documentItems = documentInsights.slice(0, 2).map((insight) => ({
        id: `document-${insight.id}`,
        title: insight.fileName,
        summary: insight.summary,
        date: new Date(insight.date),
        kind: 'document' as const,
    }));

    return [...entryItems, ...checkupItems, ...documentItems]
        .sort((left, right) => right.date.getTime() - left.date.getTime())
        .slice(0, 6);
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
            tint: 'text-[color:var(--mf-accent)]',
            line: 'bg-[color:rgba(182,106,60,0.28)]',
            label: 'Follow-up',
        };
    }
    if (kind === 'document') {
        return {
            icon: ScanText,
            tint: 'text-[color:var(--mf-plum)]',
            line: 'bg-[color:rgba(94,53,95,0.24)]',
            label: 'Evidence',
        };
    }
    return {
        icon: Stethoscope,
        tint: 'text-[color:var(--mf-primary)]',
        line: 'bg-[color:rgba(15,123,104,0.26)]',
        label: 'Clinical',
    };
}

export function ClinicalRiverTimeline({
    entries,
    checkups,
    documentInsights,
}: ClinicalRiverTimelineProps) {
    const items = buildRiverItems(entries, checkups, documentInsights);

    if (items.length === 0) {
        return (
            <div className="rounded-[26px] border border-dashed border-[color:rgba(112,106,100,0.18)] px-5 py-8 text-sm text-[color:var(--mf-muted)]">
                Nessun evento recente: la river timeline comparirà qui appena il caso accumula visite, documenti o controlli.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {items.map((item, index) => {
                const presentation = getItemPresentation(item.kind);
                const Icon = presentation.icon;

                return (
                    <div key={item.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-4">
                        <div className="flex flex-col items-center">
                            <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-white/72 ${presentation.tint} dark:bg-white/6`}>
                                <Icon className="h-4 w-4" />
                            </div>
                            {index < items.length - 1 ? (
                                <div className={`mt-2 h-full min-h-10 w-px ${presentation.line}`} />
                            ) : null}
                        </div>
                        <article className="clinical-river-card rounded-[22px] border border-[color:rgba(112,106,100,0.12)] bg-white/68 p-4 shadow-[0_12px_24px_rgba(35,27,22,0.05)] dark:bg-white/4">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--mf-muted)]">
                                    {presentation.label}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[12px] text-[color:var(--mf-muted)]">
                                    <FileText className="h-3.5 w-3.5" />
                                    {formatDate(item.date)}
                                </span>
                            </div>
                            <h3 className="mt-2 text-base font-semibold text-[color:var(--mf-ink)]">{item.title}</h3>
                            <p className="mt-2 line-clamp-3 text-sm leading-6 text-[color:var(--mf-muted)]">
                                {item.summary}
                            </p>
                        </article>
                    </div>
                );
            })}
        </div>
    );
}
