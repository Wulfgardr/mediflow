/* @Codex */
import { AlertTriangle, CheckCircle2, FileSearch, ShieldAlert, UserRound } from 'lucide-react';
/* @Codex */
import type { DocumentDecision } from '../lib/domain/documents/document-decision';
/* @Codex */
import { buildDocumentDecisionReviewViewModel, type DocumentDecisionReviewActionView } from '../lib/domain/documents/document-decision-review-view-model';
import { confidenceLabel } from '../lib/ai-labels';

function ActionList({
    title,
    items,
    tone,
}: {
    title: string;
    items: DocumentDecisionReviewActionView[];
    tone: 'allowed' | 'blocked' | 'forbidden';
}) {
    const toneClass = tone === 'allowed'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-950/10 dark:text-emerald-100'
        : tone === 'blocked'
            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-950/10 dark:text-amber-100'
            : 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/20 dark:bg-red-950/10 dark:text-red-100';

    return (
        <section className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</h4>
            <div className="space-y-2">
                {items.length > 0 ? items.map((item) => (
                    <div key={item.id} className={`rounded-2xl border p-3 ${toneClass}`}>
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold">{item.label}</p>
                            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-white/10 dark:text-slate-200">
                                {confidenceLabel(item.confidence)}
                            </span>
                            {item.blockedReason && (
                                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:bg-white/10 dark:text-slate-200">
                                    {item.blockedReason}
                                </span>
                            )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed opacity-80">{item.rationale}</p>
                    </div>
                )) : (
                    <p className="rounded-2xl border border-dashed border-slate-200 p-3 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
                        Nessuna azione in questa categoria.
                    </p>
                )}
            </div>
        </section>
    );
}

/* @Codex */
export default function DocumentDecisionReviewCard({ decision }: { decision: DocumentDecision }) {
    const view = buildDocumentDecisionReviewViewModel(decision);

    return (
        <div className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 dark:border-white/10 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-200">
                        <FileSearch className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{view.documentType}</p>
                        <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{view.title}</h3>
                        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                            {view.patientCandidate}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600 dark:bg-white/10 dark:text-slate-200">
                        confidence {view.confidence}
                    </span>
                    {view.humanRequiredFor.map((item) => (
                        <span key={item} className="rounded-full bg-amber-100 px-3 py-1 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                            {item}
                        </span>
                    ))}
                </div>
            </div>

            {view.nonWriteSummary.length > 0 && (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-500/20 dark:bg-amber-950/10 dark:text-amber-100">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="text-xs leading-relaxed">
                        Non verrà scritto automaticamente: {view.nonWriteSummary.join(', ')}.
                    </p>
                </div>
            )}

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <ActionList title="Cosa può essere proposto" items={view.allowedActions} tone="allowed" />
                <ActionList title="Cosa resta bloccato" items={view.blockedActions} tone="blocked" />
                <ActionList title="Cosa è vietato" items={view.forbiddenActions} tone="forbidden" />
            </div>

            <section className="mt-5 space-y-2">
                <div className="flex items-center gap-2">
                    <UserRound className="h-4 w-4 text-slate-400" />
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Evidenze cliccabili</h4>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                    {view.evidence.length > 0 ? view.evidence.map((evidence) => (
                        <button
                            key={evidence.id}
                            type="button"
                            className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-left text-xs leading-relaxed text-slate-600 transition-[border-color,background-color] hover:border-blue-200 hover:bg-blue-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:border-blue-500/30 dark:hover:bg-blue-950/20"
                            aria-label={`Evidenza ${evidence.id}`}
                        >
                            <span className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                <CheckCircle2 className="h-3 w-3" />
                                {evidence.id}
                            </span>
                            {evidence.snippet}
                        </button>
                    )) : (
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-950/10 dark:text-red-200">
                            <AlertTriangle className="mb-2 h-4 w-4" />
                            Nessuna evidenza disponibile: le azioni cliniche devono restare bloccate.
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
