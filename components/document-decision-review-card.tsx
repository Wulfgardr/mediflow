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
        ? 'border-[color:color-mix(in_srgb,var(--lume-signal-success)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-success)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-success)_60%,var(--lume-ink))]'
        : tone === 'blocked'
            ? 'border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]'
            : 'border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]';

    return (
        <section className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">{title}</h4>
            <div className="space-y-2">
                {items.length > 0 ? items.map((item) => (
                    <div key={item.id} className={`rounded-2xl border p-3 ${toneClass}`}>
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold">{item.label}</p>
                            <span className="rounded-full bg-[color:var(--lume-surface-field)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                {confidenceLabel(item.confidence)}
                            </span>
                            {item.blockedReason && (
                                <span className="rounded-full bg-[color:var(--lume-surface-field)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                    {item.blockedReason}
                                </span>
                            )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed">{item.rationale}</p>
                    </div>
                )) : (
                    <p className="rounded-2xl border border-dashed border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] p-3 text-xs text-[color:var(--lume-ink-muted)]">
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
        <div className="rounded-[28px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-5 shadow-sm">
            <div className="flex flex-col gap-4 border-b border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] pb-4 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:color-mix(in_srgb,var(--lume-accent)_11%,var(--lume-surface-field))] text-[color:var(--lume-accent)]">
                        <FileSearch className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">{view.documentType}</p>
                        <h3 className="text-lg font-black tracking-tight text-[color:var(--lume-ink)]">{view.title}</h3>
                        <p className="text-sm leading-relaxed text-[color:var(--lume-ink-muted)]">
                            {view.patientCandidate}
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide">
                    <span className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] px-3 py-1 text-[color:var(--lume-ink-muted)]">
                        confidence {view.confidence}
                    </span>
                    {view.humanRequiredFor.map((item) => (
                        <span key={item} className="rounded-full bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] px-3 py-1 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]">
                            {item}
                        </span>
                    ))}
                </div>
            </div>

            {view.nonWriteSummary.length > 0 && (
                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-signal-warning)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] p-3 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_60%,var(--lume-ink))]">
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
                    <UserRound className="h-4 w-4 text-[color:var(--lume-ink-muted)]" />
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--lume-ink-muted)]">Evidenze cliccabili</h4>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                    {view.evidence.length > 0 ? view.evidence.map((evidence) => (
                        <button
                            key={evidence.id}
                            type="button"
                            className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:var(--lume-surface-field)] p-3 text-left text-xs leading-relaxed text-[color:var(--lume-ink-muted)] transition-[border-color,background-color] hover:border-[color:color-mix(in_srgb,var(--lume-accent)_30%,transparent)] hover:bg-[color:var(--lume-surface-focal)]"
                            aria-label={`Evidenza ${evidence.id}`}
                        >
                            <span className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lume-ink-muted)]">
                                <CheckCircle2 className="h-3 w-3" />
                                {evidence.id}
                            </span>
                            {evidence.snippet}
                        </button>
                    )) : (
                        <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--lume-signal-critical)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-signal-critical)_11%,var(--lume-surface-field))] p-3 text-xs text-[color:color-mix(in_srgb,var(--lume-signal-critical)_60%,var(--lume-ink))]">
                            <AlertTriangle className="mb-2 h-4 w-4" />
                            Nessuna evidenza disponibile: le azioni cliniche devono restare bloccate.
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
