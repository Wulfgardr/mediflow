'use client';

import { useState } from 'react';
import { useLiveQuery } from '@/lib/live-query';
import { db } from '@/lib/db';
import { useParams, useRouter } from 'next/navigation';
import ScaleEngine from '@/components/scale-engine';
import { SCALES } from '@/lib/scale-definitions';
import { submitScale } from '@/lib/scale-submission';
import { v4 as uuidv4 } from 'uuid';
import styles from '@/components/scales/scale-workspace.module.css';
/* @Codex */
import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import { useToast } from '@/components/ui/toast-provider';

export default function ScaleRunnerPage() {
    const params = useParams();
    const router = useRouter();
    const { showToast } = useToast();
    const patientId = params.id as string;
    const scaleId = params.scaleId as string;
    const [setting, setSetting] = useState<'ambulatory' | 'home'>('ambulatory');

    /* @Codex */
    const patient = useLiveQuery(() => db.patients.get(patientId), [patientId], undefined, ['patients']);
    const scaleDef = Object.prototype.hasOwnProperty.call(SCALES, scaleId) ? SCALES[scaleId] : undefined;

    const handleComplete = async (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => {
        try {
            if (!scaleDef) return;
            // @Codex MF085-003: validation and canonical metadata precede db.entries.add.
            await submitScale(scaleId, result.answers, submission => db.entries.add({
                id: uuidv4(),
                patientId,
                date: new Date(),
                type: 'scale',
                title: submission.title,
                setting,
                content: submission.content,
                metadata: submission.metadata,
                createdAt: new Date(),
                updatedAt: new Date(),
                attachments: []
            }));

            // @Codex: Land on the independent reread of the saved evaluation.
            router.push(`/patients/${patientId}/modules#scale`);
        } catch (error) {
            console.error("Failed to save scale", error);
            showToast({ tone: 'error', title: 'Errore nel salvataggio della valutazione', description: 'Il punteggio non è stato registrato. Riprova.' });
        }
    };

    const handleCancel = () => {
        router.push(`/patients/${patientId}/scales`);
    };

    if (!scaleDef) {
        return (
            <div className={styles.screen}><Kree8WorkspaceShell
                eyebrow="Valutazioni"
                title="Scala non disponibile"
                subtitle="Scegli una scala dalla libreria del paziente."
                backHref={`/patients/${patientId}/scales`}
                backLabel="Torna alle scale"
                patientLabel={patient ? `${patient.lastName} ${patient.firstName}` : undefined}
                statusLabel="Nessun dato è stato modificato."
                navItems={[]}
            >
                {/* @Codex: a retirement notice is clinical content, not optional header copy. */}
                <div className={workspaceStyles.loadingCard} role="status">
                    {scaleId === 'tinetti'
                        ? 'Versione Tinetti precedente ritirata. I risultati storici restano invariati; per una nuova valutazione scegliere POMA-28 v1.'
                        : 'La scala richiesta non è presente nella libreria locale di MediFlow.'}
                </div>
            </Kree8WorkspaceShell></div>
        );
    }

    const patientLabel = patient ? `${patient.lastName} ${patient.firstName}` : undefined;

    return (
        <div className={styles.screen}><Kree8WorkspaceShell
            eyebrow="Valutazione"
            title={scaleDef.title}
            subtitle="Compila la scala nel contesto della visita e salva il punteggio come voce del diario clinico."
            backHref={`/patients/${patientId}/scales`}
            backLabel="Torna alle scale"
            patientLabel={patientLabel}
            statusLabel={patient ? 'Scrittura locale: il risultato resta nella cartella del paziente.' : 'Caricamento dati paziente...'}
            navItems={[]}
        >
            {/* @Codex WUL-678: context stays selectable without secondary panels. */}
            <section id="scala" className={styles.workspace}>
                <label className={styles.context}>
                    Contesto
                    <select value={setting} onChange={event => setSetting(event.target.value as 'ambulatory' | 'home')}>
                        <option value="ambulatory">Ambulatorio</option>
                        <option value="home">Domicilio</option>
                    </select>
                </label>
                <details className={styles.details}>
                    <summary>Informazioni sulla compilazione</summary>
                    <p>{scaleDef.description}</p>
                    <p>Con Completa salvi punteggio, interpretazione e risposte nel diario del paziente.</p>
                </details>
                {!patient ? <p role="status">Caricamento paziente…</p> : (
                    <ScaleEngine key={`${patientId}:${scaleDef.id}`} scale={scaleDef} showHeading={false}
                        onComplete={handleComplete} onCancel={handleCancel} />
                )}
            </section>
        </Kree8WorkspaceShell></div>
    );
}
