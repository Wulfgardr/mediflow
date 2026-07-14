'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Activity, ArrowRight, Brain, ClipboardCheck, HeartPulse, ListChecks } from 'lucide-react';

/* @Codex */
import { Kree8WorkspaceShell, type Kree8WorkspaceNavItem } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import { db } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import { SCALES } from '@/lib/scale-definitions';

function getScaleArea(scaleId: string): string {
    if (scaleId === 'tinetti') return 'Equilibrio';
    if (scaleId === 'adl' || scaleId === 'iadl') return 'Autonomia';
    if (scaleId === 'mmse') return 'Cognitivo';
    if (scaleId === 'gds') return 'Umore';
    return 'Valutazione';
}

function getScaleIcon(scaleId: string) {
    if (scaleId === 'mmse') return Brain;
    if (scaleId === 'gds') return HeartPulse;
    if (scaleId === 'adl' || scaleId === 'iadl') return ClipboardCheck;
    if (scaleId === 'tinetti') return Activity;
    return ListChecks;
}

export default function ScalesPage() {
    const params = useParams();
    const id = params.id as string;
    const patient = useLiveQuery(() => db.patients.get(id), [id]);
    const scales = Object.values(SCALES);

    const workspaceNavItems: Kree8WorkspaceNavItem[] = [
        { href: '#libreria', label: 'Libreria', meta: String(scales.length) },
        { href: '#uso', label: 'Uso' },
        { href: '#salvataggio', label: 'Salvataggio' },
    ];

    return (
        <Kree8WorkspaceShell
            eyebrow="Valutazioni"
            title="Scale cliniche"
            subtitle="Scegli una scala, somministrala nel contesto giusto e salva il risultato come voce del diario del paziente."
            backHref={`/patients/${id}/modules#scale`}
            backLabel="Torna alla scheda paziente"
            patientLabel={patient ? `${patient.lastName} ${patient.firstName}` : undefined}
            statusLabel={`${scales.length} scale disponibili dalla libreria locale.`}
            navItems={workspaceNavItems}
        >
            <div className={workspaceStyles.workspaceGrid}>
                <section id="libreria" className={`${workspaceStyles.primaryStack} patient-detail-section border p-5 md:p-6`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div>
                            <p className="section-kicker">Libreria locale</p>
                            <h2 className="mt-1 text-xl font-semibold text-[color:var(--mf-ink)]">
                                Valutazioni pronte da somministrare
                            </h2>
                        </div>
                        <span className="apple-chip self-start md:self-auto">
                            {scales.length} strumenti
                        </span>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        {scales.map((scale) => {
                            const Icon = getScaleIcon(scale.id);
                            return (
                                <Link
                                    key={scale.id}
                                    href={`/patients/${id}/scales/${scale.id}`}
                                    className="lume-press glass-card group p-4 text-left transition-[border-color,background-color] duration-[var(--lume-dur-riga)] hover:bg-[color:var(--lume-surface-focal)]"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <span className="inline-flex h-11 w-11 items-center justify-center rounded-[15px] border border-[color:rgba(15,23,42,0.07)] bg-white text-[color:var(--mf-primary)]">
                                            <Icon className="h-5 w-5" />
                                        </span>
                                        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[color:var(--mf-muted)]">
                                            {getScaleArea(scale.id)}
                                            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                                        </span>
                                    </div>
                                    <h3 className="mt-4 text-base font-semibold leading-snug text-[color:var(--mf-ink)]">
                                        {scale.title}
                                    </h3>
                                    <p className="mt-2 text-sm leading-6 text-[color:var(--mf-muted)]">
                                        {scale.description}
                                    </p>
                                    <p className="mt-4 text-xs font-semibold text-[color:var(--mf-muted)]">
                                        {scale.questions.length} domande
                                    </p>
                                </Link>
                            );
                        })}
                    </div>
                </section>

                <aside className={workspaceStyles.secondaryStack}>
                    <section id="uso" className="patient-detail-side-section border p-5">
                        <p className="section-kicker">Uso</p>
                        <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                            <ListChecks className="h-5 w-5 text-[color:var(--mf-primary)]" />
                            Una scala alla volta
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-[color:var(--mf-muted)]">
                            La somministrazione resta lineare: scegli la scala, indica ambulatorio o domicilio, rispondi alle domande e conferma il risultato.
                        </p>
                    </section>

                    <section id="salvataggio" className="patient-detail-side-section border p-5">
                        <p className="section-kicker">Salvataggio</p>
                        <h3 className="mt-1 text-lg font-semibold text-[color:var(--mf-ink)]">
                            Risultato nel diario
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-[color:var(--mf-muted)]">
                            Il punteggio salvato diventa una voce clinica di tipo scala, riutilizzabile nella timeline, nei report e negli strumenti clinici della scheda paziente.
                        </p>
                    </section>
                </aside>
            </div>
        </Kree8WorkspaceShell>
    );
}
