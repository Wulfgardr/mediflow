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
                    <div className="rounded-2xl bg-amber-100 p-2 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
                        <CircleAlert className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div>
                        <p className="section-kicker">Limite del claim</p>
                        <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
                            Nessun verdetto legale
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
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
                            <div className="rounded-2xl bg-slate-100 p-2 text-slate-700 dark:bg-white/10 dark:text-slate-200">
                                {record.status === 'external_assessment_required'
                                    ? <Scale className="h-4 w-4" aria-hidden="true" />
                                    : <FileCheck2 className="h-4 w-4" aria-hidden="true" />}
                            </div>
                            <div className="min-w-0">
                                <p className="section-kicker">{STATUS_COPY[record.status]}</p>
                                <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-white">{record.label}</h2>
                                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{record.summary}</p>
                            </div>
                        </div>

                        <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                                <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
                                Evidenze consultabili nel repository
                            </div>
                            <ul className="mt-3 space-y-1 font-mono text-xs text-slate-700 dark:text-slate-200">
                                {record.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}
                            </ul>
                        </div>

                        <dl className="space-y-3 text-sm">
                            <div>
                                <dt className="font-semibold text-slate-900 dark:text-white">Limite</dt>
                                <dd className="mt-1 leading-6 text-slate-600 dark:text-slate-300">{record.limitation}</dd>
                            </div>
                            <div>
                                <dt className="font-semibold text-slate-900 dark:text-white">Owner della verifica</dt>
                                <dd className="mt-1 text-slate-600 dark:text-slate-300">{record.owner}</dd>
                            </div>
                        </dl>

                        {record.externalReferences.length > 0 ? (
                            <div className="border-t border-slate-200 pt-4 dark:border-white/10">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                                    Fonti ufficiali esterne
                                </p>
                                <ul className="mt-2 space-y-2 text-sm">
                                    {record.externalReferences.map((reference) => (
                                        <li key={reference.href}>
                                            <a
                                                href={reference.href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-semibold text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
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
