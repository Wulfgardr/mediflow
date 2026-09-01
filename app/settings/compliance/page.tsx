/* @Codex */
import { BookOpenCheck, CircleAlert, FileCheck2, Scale } from 'lucide-react';

import { SETTINGS_CARD_CLASS, SettingsSectionIntro } from '@/components/settings/settings-ui';
import {
    COMPLIANCE_EVIDENCE_INVENTORY,
    type ComplianceEvidenceStatus,
} from '@/lib/compliance-evidence-inventory';

const STATUS_COPY: Readonly<Record<ComplianceEvidenceStatus, string>> = Object.freeze({
    source_evidence: 'Evidenza nel sorgente',
    source_evidence_with_limit: 'Evidenza con limite esplicito',
    external_assessment_required: 'Valutazione esterna necessaria',
});

export default function SettingsCompliancePage() {
    return (
        <section className="space-y-4" data-testid="settings-compliance-section">
            <SettingsSectionIntro
                kicker="Dati e sicurezza"
                title="Evidenze e conformità"
                description="Inventario di evidenze, non attestazione: mostra cosa documenta il sorgente e cosa resta da valutare nel deployment."
            />

            <div className={`${SETTINGS_CARD_CLASS} space-y-4`}>
                <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-[color:color-mix(in_srgb,var(--lume-signal-warning)_11%,var(--lume-surface-field))] p-2 text-[color:color-mix(in_srgb,var(--lume-signal-warning)_65%,var(--lume-ink))]">
                        <CircleAlert className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div>
                        <p className="section-kicker">Limite del claim</p>
                        <h2 className="mt-1 text-base font-semibold text-[color:var(--lume-ink)]">
                            Nessun verdetto legale
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-[color:var(--lume-ink-muted)]">
                            Lo stato legale non è valutato. Le evidenze tecniche possono supportare una verifica,
                            ma non determinano applicabilità, ruoli, adempimenti o certificazioni.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {COMPLIANCE_EVIDENCE_INVENTORY.records.map((record) => (
                    <article key={record.id} className={`${SETTINGS_CARD_CLASS} space-y-4`} data-testid={`compliance-evidence-${record.id}`}>
                        <div className="flex items-start gap-3">
                            <div className="rounded-2xl bg-[color:color-mix(in_srgb,var(--lume-ink)_6%,var(--lume-surface-field))] p-2 text-[color:var(--lume-ink-muted)]">
                                {record.status === 'external_assessment_required'
                                    ? <Scale className="h-4 w-4" aria-hidden="true" />
                                    : <FileCheck2 className="h-4 w-4" aria-hidden="true" />}
                            </div>
                            <div className="min-w-0">
                                <p className="section-kicker">{STATUS_COPY[record.status]}</p>
                                <h2 className="mt-1 text-base font-semibold text-[color:var(--lume-ink)]">{record.label}</h2>
                                <p className="mt-2 text-sm leading-6 text-[color:var(--lume-ink-muted)]">{record.summary}</p>
                            </div>
                        </div>

                        <div className="rounded-[22px] border border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--lume-ink)_4%,var(--lume-surface-field))] p-4">
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[color:var(--lume-ink-muted)]">
                                <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
                                Evidenze consultabili nel repository
                            </div>
                            <ul className="mt-3 space-y-1 font-mono text-xs text-[color:var(--lume-ink)]">
                                {record.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}
                            </ul>
                        </div>

                        <dl className="space-y-3 text-sm">
                            <div>
                                <dt className="font-semibold text-[color:var(--lume-ink)]">Limite</dt>
                                <dd className="mt-1 leading-6 text-[color:var(--lume-ink-muted)]">{record.limitation}</dd>
                            </div>
                            <div>
                                <dt className="font-semibold text-[color:var(--lume-ink)]">Owner della verifica</dt>
                                <dd className="mt-1 text-[color:var(--lume-ink-muted)]">{record.owner}</dd>
                            </div>
                        </dl>

                        {record.externalReferences.length > 0 ? (
                            <div className="border-t border-[color:color-mix(in_srgb,var(--lume-ink)_12%,transparent)] pt-4">
                                <p className="text-xs font-bold uppercase tracking-wider text-[color:var(--lume-ink-muted)]">
                                    Fonti ufficiali esterne
                                </p>
                                <ul className="mt-2 space-y-2 text-sm">
                                    {record.externalReferences.map((reference) => (
                                        <li key={reference.href}>
                                            <a
                                                href={reference.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-semibold text-[color:var(--lume-accent)] underline-offset-2 hover:underline"
                                            >
                                                {reference.label}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </article>
                ))}
            </div>
        </section>
    );
}
