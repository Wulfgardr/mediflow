'use client';

/* WUL-262 compact "cosa rivedere adesso" summary for patient detail.
   Thin renderer over lib/patient-review-queue-summary: every row anchors to an
   existing panel (or states explicitly why the panel is not visible) without
   duplicating panel content. */

import { ListChecks } from 'lucide-react';

import { Badge, type BadgePalette } from '@/components/ui/badge';
import type {
    PatientReviewQueueRow,
    PatientReviewQueueSummary,
    ReviewQueueRowState,
} from '@/lib/patient-review-queue-summary';

interface PatientReviewQueueSummaryProps {
    summary: PatientReviewQueueSummary;
    /* @Codex WUL-UIUX: senza card e header propri, per vivere dentro una
       CollapsibleSection che fornisce gia superficie e intestazione. */
    embedded?: boolean;
}

/* @Codex WUL-UIUX (STREAM W2-B): le sette tinte legacy mappate 1:1 sulla
   dimensione `palette` di Badge (stessa resa, dark-mode inclusa). */
const STATE_PALETTE: Record<ReviewQueueRowState, BadgePalette> = {
    'da-rivedere': 'amber',
    'bloccato': 'red',
    'serve-testo': 'blue',
    'pronto-da-applicare': 'emerald',
    'gia-applicato': 'slate',
    'disponibile': 'slate-plain',
    'vuoto': 'dashed',
};

function ReviewQueueRow({ row }: { row: PatientReviewQueueRow }) {
    return (
        <li
            className="flex flex-col gap-2 rounded-[12px] border border-[color:rgba(112,106,100,0.12)] bg-white/82 px-4 py-3 dark:border-[color:rgba(255,247,240,0.08)] dark:bg-white/5 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            data-testid={`review-queue-row-${row.id}`}
        >
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[color:var(--mf-ink)]">{row.panelLabel}</span>
                    <Badge palette={STATE_PALETTE[row.state]} size="xs">
                        {row.stateLabel}
                    </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-[color:var(--mf-muted)]">{row.detail}</p>
                {row.blockedReason ? (
                    <p className="mt-1 text-xs leading-5 text-red-700 dark:text-red-300">
                        Perché non scrive da solo: {row.blockedReason}
                    </p>
                ) : null}
            </div>

            {row.anchor ? (
                <a
                    href={row.anchor}
                    className="shrink-0 self-start text-xs font-semibold text-[color:var(--mf-ink)] underline decoration-[color:rgba(112,106,100,0.35)] underline-offset-4 transition-colors hover:decoration-[color:var(--mf-ink)] sm:self-center"
                >
                    {row.actionLabel}
                </a>
            ) : (
                <span className="shrink-0 self-start text-xs font-medium italic text-[color:var(--mf-muted)] sm:self-center">
                    {row.actionLabel}
                </span>
            )}
        </li>
    );
}

export default function PatientReviewQueueSummaryPanel({ summary, embedded = false }: PatientReviewQueueSummaryProps) {
    if (embedded) {
        return (
            <ul className="grid gap-2" data-testid="patient-review-queue-summary">
                {summary.rows.map((row) => (
                    <ReviewQueueRow key={row.id} row={row} />
                ))}
            </ul>
        );
    }

    return (
        <section
            id="coda-revisione"
            className="patient-detail-section border p-5 md:p-6"
            data-testid="patient-review-queue-summary"
        >
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <p className="section-kicker">Coda di revisione</p>
                    <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-[color:var(--mf-ink)]">
                        <ListChecks className="h-5 w-5 text-[color:var(--mf-muted)]" />
                        Cosa rivedere adesso
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--mf-muted)]">
                        Riepilogo in sola lettura: nulla viene scritto in automatico nella scheda, ogni modifica passa dal pannello dedicato.
                    </p>
                </div>
                <span className="apple-chip self-start md:self-auto">
                    {summary.attentionCount > 0
                        ? `${summary.attentionCount} punti di attenzione`
                        : 'Nessuna azione richiesta'}
                </span>
            </div>

            <ul className="grid gap-2">
                {summary.rows.map((row) => (
                    <ReviewQueueRow key={row.id} row={row} />
                ))}
            </ul>
        </section>
    );
}
