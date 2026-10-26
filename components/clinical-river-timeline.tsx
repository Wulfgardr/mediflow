'use client';

import { compactClinicalRichText } from '@/lib/clinical-rich-text';
import type { Checkup, ClinicalEntry, DocumentInsight } from '@/lib/db';
import { InkState } from '@/components/ui/ink-state';
import styles from './clinical-river-timeline.module.css';

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
 * Niente meta-testo: il riassunto usa SEMPRE il contenuto reale della voce
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
    if (kind === 'checkup') return { label: 'Follow-up', href: '#follow-up' };
    if (kind === 'document') return { label: 'Sintesi archiviata', href: '#document-insights' };
    return { label: 'Diario', href: '#diario' };
}

function HistoryAccess() {
    return <nav className={styles.history} aria-label="Storia completa del paziente">
        <a className={`mf-button-text ${styles.diaryLink}`} href="#diario">Apri il Diario</a>
        <span className={styles.otherHistory}>
            <a className="mf-button-text" href="#follow-up">Controlli</a>
            <a className="mf-button-text" href="#documenti">Documenti</a>
        </span>
    </nav>;
}

export function ClinicalRiverTimeline({
    entries,
    checkups,
    documentInsights,
}: ClinicalRiverTimelineProps) {
    const items = buildRiverItems(entries, checkups, documentInsights);
    /* Conteggio onesto: la river e una anteprima, non l'elenco completo. */
    const totalAvailable =
        entries.filter((entry) => !entry.deletedAt).length + checkups.length + documentInsights.length;
    const hiddenCount = Math.max(totalAvailable - items.length, 0);

    return (
        <div className={styles.timeline}>
            <HistoryAccess />
            {items.length === 0 ? (
                <p className={styles.notice}>Nessun evento recente: visite, documenti e controlli compariranno qui.</p>
            ) : (
                <>
                    <div className={styles.feed} role="feed" aria-label="Timeline clinica del paziente">
                        {items.map((item, index) => {
                            const presentation = getItemPresentation(item.kind);
                            return (
                                <article key={item.id} className={styles.item} aria-posinset={index + 1} aria-setsize={items.length}>
                                    <time className={styles.date} dateTime={Number.isNaN(item.date.getTime()) ? undefined : item.date.toISOString()}>{formatDate(item.date)}</time>
                                    <div className={styles.content}>
                                        <div className={styles.origin}>
                                            {item.kind === 'document' ? <InkState state="pencil">Sintesi archiviata · da rivedere</InkState>
                                                : <span>{presentation.label}{item.typeLabel ? ` · ${item.typeLabel}` : ''}</span>}
                                        </div>
                                        <h3 className={styles.title}>
                                            <a href={presentation.href} aria-label={`Apri ${item.title} · ${presentation.label}`}>{item.title}</a>
                                        </h3>
                                        {item.kind !== 'entry' && item.summary ? <p className={styles.summary}>{item.summary}</p> : null}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                    {hiddenCount > 0 ? <p className={styles.notice}>Anteprima: {items.length} eventi di {totalAvailable}. La storia completa resta nelle rispettive sezioni.</p> : null}
                </>
            )}
        </div>
    );
}
