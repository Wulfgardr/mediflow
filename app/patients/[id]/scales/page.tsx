'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Activity, ArrowRight, Brain, ClipboardCheck, HeartPulse, ListChecks } from 'lucide-react';

/* @Codex */
import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import styles from '@/components/scales/scale-workspace.module.css';
import { db } from '@/lib/db';
import { useLiveQuery } from '@/lib/live-query';
import { SCALES } from '@/lib/scale-definitions';

function getScaleArea(scaleId: string): string {
    if (scaleId === 'tinetti-poma28-v1') return 'Equilibrio';
    if (scaleId === 'adl' || scaleId === 'iadl') return 'Autonomia';
    if (scaleId === 'mmse') return 'Cognitivo';
    if (scaleId === 'gds') return 'Umore';
    return 'Valutazione';
}

function getScaleIcon(scaleId: string) {
    if (scaleId === 'mmse') return Brain;
    if (scaleId === 'gds') return HeartPulse;
    if (scaleId === 'adl' || scaleId === 'iadl') return ClipboardCheck;
    if (scaleId === 'tinetti-poma28-v1') return Activity;
    return ListChecks;
}

export default function ScalesPage() {
    const params = useParams();
    const id = params.id as string;
    /* @Codex */
    const patient = useLiveQuery(() => db.patients.get(id), [id], undefined, ['patients']);
    const scales = Object.values(SCALES);

    return (
        <div className={styles.screen}><Kree8WorkspaceShell
            eyebrow="Valutazioni"
            title="Scale cliniche"
            subtitle="Scegli una scala, somministrala nel contesto giusto e salva il risultato come voce del diario del paziente."
            backHref={`/patients/${id}/modules#scale`}
            backLabel="Torna alla scheda paziente"
            patientLabel={patient ? `${patient.lastName} ${patient.firstName}` : undefined}
            statusLabel={`${scales.length} scale disponibili dalla libreria locale.`}
            navItems={[]}
        >
            {/* @Codex WUL-678: each instrument is one complete, keyboard-accessible target. */}
            <section id="libreria" className={styles.workspace} aria-label="Scegli una scala">
                <div className={styles.catalog}>
                    {scales.map(scale => {
                        const Icon = getScaleIcon(scale.id);
                        return (
                            <Link key={scale.id} href={`/patients/${id}/scales/${scale.id}`} className={styles.catalogLink}>
                                <Icon size={20} aria-hidden="true" />
                                <span>
                                    <span className={styles.catalogTitle}>{scale.title}</span>
                                    <span className={styles.catalogDescription}>{getScaleArea(scale.id)} · {scale.questions.length} domande</span>
                                </span>
                                <ArrowRight size={18} aria-hidden="true" />
                            </Link>
                        );
                    })}
                </div>
            </section>
        </Kree8WorkspaceShell></div>
    );
}
