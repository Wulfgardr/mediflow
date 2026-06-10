'use client';

/* WUL-262 compact "cosa rivedere adesso" summary for patient detail.
   Thin renderer over lib/patient-review-queue-summary: every row anchors to an
   existing panel (or states explicitly why the panel is not visible) without
   duplicating panel content. */

import { ListChecks } from 'lucide-react';

import type {
    PatientReviewQueueRow,
    PatientReviewQueueSummary,
    ReviewQueueRowState,
} from '@/lib/patient-review-queue-summary';

interface PatientReviewQueueSummaryProps {
    summary: PatientReviewQueueSummary;
}

const STATE_CHIP_CLASSES: Record<ReviewQueueRowState, string> = {
    'da-rivedere': 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-300',
    'bloccato': 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-950/20 dark:text-red-300',
    'serve-testo': 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-950/20 dark:text-blue-300',
    'pronto-da-applicare': 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-950/20 dark:text-emerald-300',
    'gia-applicato': 'border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-300',
    'disponibile': 'border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300',
    'vuoto': 'border-dashed border-slate-300 bg-transparent text-slate-500 dark:border-white/15 dark:text-slate-400',
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
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATE_CHIP_CLASSES[row.state]}`}>
                        {row.stateLabel}
                    </span>
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

export default function PatientReviewQueueSummaryPanel({ summary }: PatientReviewQueueSummaryProps) {
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
                        Stato di insight, evidenze, Smart Import e archivio in una sola lettura: ogni riga apre il pannello già esistente, nulla viene scritto in automatico.
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
