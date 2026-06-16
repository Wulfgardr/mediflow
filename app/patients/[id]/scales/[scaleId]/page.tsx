'use client';

import { useState } from 'react';
import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';
import { useParams, useRouter } from 'next/navigation';
import ScaleEngine from '@/components/scale-engine';
import { SCALES } from '@/lib/scale-definitions';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '@/lib/utils';
import { Home, Building2, Activity, BookOpenCheck, Save } from 'lucide-react';
/* @Codex */
import { Kree8WorkspaceShell, type Kree8WorkspaceNavItem } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';

export default function ScaleRunnerPage() {
    const params = useParams();
    const router = useRouter();
    const patientId = params.id as string;
    const scaleId = params.scaleId as string;
    const [setting, setSetting] = useState<'ambulatory' | 'home'>('ambulatory');

    const patient = useLiveQuery(() => db.patients.get(patientId), [patientId]);
    const scaleDef = SCALES[scaleId];

    const handleComplete = async (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => {
        try {
            if (!scaleDef) return;
            await db.entries.add({
                id: uuidv4(),
                patientId,
                date: new Date(),
                type: 'scale',
                title: scaleDef.title,
                setting,
                content: `Valutazione ${scaleDef.title} completata.\nPunteggio: ${result.score}\nInterpretazione: ${result.interpretation}`,
                metadata: {
                    title: scaleDef.title,
                    scaleId,
                    score: result.score,
                    interpretation: result.interpretation,
                    answers: result.answers
                },
                createdAt: new Date(),
                updatedAt: new Date(),
                attachments: []
            });

            router.push(`/patients/${patientId}`);
        } catch (error) {
            console.error("Failed to save scale", error);
            alert("Errore nel salvataggio della valutazione.");
        }
    };

    const handleCancel = () => {
        router.back();
    };

    const workspaceNavItems: Kree8WorkspaceNavItem[] = [
        { href: '#scala', label: 'Scala', meta: scaleDef ? String(scaleDef.questions.length) : undefined },
        { href: '#contesto', label: 'Contesto', meta: setting === 'home' ? 'domicilio' : 'ambulatorio' },
        { href: '#salvataggio', label: 'Salvataggio' },
    ];

    if (!scaleDef) {
        return (
            <Kree8WorkspaceShell
                eyebrow="Valutazioni"
                title="Scala non disponibile"
                subtitle="La scala richiesta non è presente nella libreria locale di MediFlow."
                backHref={`/patients/${patientId}/scales`}
                backLabel="Torna alle scale"
                patientLabel={patient ? `${patient.lastName} ${patient.firstName}` : undefined}
                statusLabel="Nessun dato è stato modificato."
                navItems={[]}
            >
                <div className={workspaceStyles.loadingCard}>
                    Scegli una scala dalla libreria del paziente.
                </div>
            </Kree8WorkspaceShell>
        );
    }

    const patientLabel = patient ? `${patient.lastName} ${patient.firstName}` : undefined;

    return (
        <Kree8WorkspaceShell
            eyebrow="Valutazione"
            title={scaleDef.title}
            subtitle="Compila la scala nel contesto della visita e salva il punteggio come voce del diario clinico."
            backHref={`/patients/${patientId}/scales`}
            backLabel="Torna alle scale"
            patientLabel={patientLabel}
            statusLabel={patient ? 'Scrittura locale: il risultato resta nella cartella del paziente.' : 'Caricamento dati paziente...'}
            navItems={workspaceNavItems}
        >
            <div className={workspaceStyles.workspaceGrid}>
                <section id="scala" className={workspaceStyles.primaryStack}>
                    {!patient ? (
                        <div className={workspaceStyles.loadingCard}>Caricamento paziente...</div>
                    ) : (
                        <ScaleEngine
                            scale={scaleDef}
                            onComplete={handleComplete}
                            onCancel={handleCancel}
                        />
                    )}
                </section>

                <aside className={workspaceStyles.secondaryStack}>
                    <section id="contesto" className="patient-detail-side-section border p-5">
                        <p className="section-kicker">Contesto</p>
                        <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                            <Activity className="h-5 w-5 text-[color:var(--mf-primary)]" />
                            Dove viene somministrata
                        </h3>

                        <div className="mt-4 grid gap-3">
                            <button
                                type="button"
                                onClick={() => setSetting('ambulatory')}
                                className={cn(
                                    'flex min-h-[54px] items-center justify-between gap-3 rounded-[16px] border px-4 text-sm font-semibold transition-[border-color,background-color,color,box-shadow]',
                                    setting === 'ambulatory'
                                        ? 'border-[color:rgba(15,123,104,0.22)] bg-[color:rgba(15,123,104,0.08)] text-[color:var(--mf-primary)] shadow-[0_12px_24px_rgba(15,123,104,0.08)]'
                                        : 'border-[color:rgba(112,106,100,0.14)] bg-white text-[color:var(--mf-muted)] hover:border-[color:rgba(112,106,100,0.2)]'
                                )}
                            >
                                <span className="inline-flex items-center gap-2">
                                    <Building2 className="h-4 w-4" />
                                    Ambulatorio
                                </span>
                                <span className="text-xs font-medium">studio</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setSetting('home')}
                                className={cn(
                                    'flex min-h-[54px] items-center justify-between gap-3 rounded-[16px] border px-4 text-sm font-semibold transition-[border-color,background-color,color,box-shadow]',
                                    setting === 'home'
                                        ? 'border-[color:rgba(182,106,60,0.24)] bg-[color:rgba(182,106,60,0.08)] text-[color:var(--mf-accent)] shadow-[0_12px_24px_rgba(182,106,60,0.08)]'
                                        : 'border-[color:rgba(112,106,100,0.14)] bg-white text-[color:var(--mf-muted)] hover:border-[color:rgba(112,106,100,0.2)]'
                                )}
                            >
                                <span className="inline-flex items-center gap-2">
                                    <Home className="h-4 w-4" />
                                    Domicilio
                                </span>
                                <span className="text-xs font-medium">ADI</span>
                            </button>
                        </div>
                    </section>

                    <section id="salvataggio" className="patient-detail-side-section border p-5">
                        <p className="section-kicker">Salvataggio</p>
                        <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                            <Save className="h-5 w-5 text-[color:var(--mf-primary)]" />
                            Voce diario automatica
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-[color:var(--mf-muted)]">
                            Al completamento vengono salvati punteggio, interpretazione e risposte. Il risultato rientra nella timeline e nei report del paziente.
                        </p>
                    </section>

                    <section className="patient-detail-side-section border p-5">
                        <p className="section-kicker">Scala</p>
                        <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold text-[color:var(--mf-ink)]">
                            <BookOpenCheck className="h-5 w-5 text-[color:var(--mf-primary)]" />
                            {scaleDef.questions.length} domande
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-[color:var(--mf-muted)]">
                            {scaleDef.description}
                        </p>
                    </section>
                </aside>
            </div>
        </Kree8WorkspaceShell>
    );
}
