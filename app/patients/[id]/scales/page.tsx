'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Activity, ArrowRight, Brain, ClipboardCheck, HeartPulse, ListChecks } from 'lucide-react';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import styles from '@/components/scales/scale-workspace.module.css';
import { readCockpitRows } from '@/components/kree8/cockpit-read-snapshot';
import { subscribeClientAccountAuthority } from '@/lib/security/client-auth-api';
import { db } from '@/lib/db';
import { useLiveQueryState } from '@/lib/live-query';
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
    const snapshotVisibility = useRef({ valid: true });
    const [, invalidateSnapshot] = useState(0);
    useEffect(() => {
        snapshotVisibility.current = { valid: true };
        const hide = () => { snapshotVisibility.current.valid = false; invalidateSnapshot(value => value + 1); };
        const show = () => { if (!snapshotVisibility.current.valid) snapshotVisibility.current = { valid: true }; };
        window.addEventListener('pagehide', hide);
        window.addEventListener('pageshow', show);
        return () => {
            snapshotVisibility.current.valid = false;
            window.removeEventListener('pagehide', hide);
            window.removeEventListener('pageshow', show);
        };
    }, []);
    const patientRead = useLiveQueryState(async () => ({
        id,
        snapshot: await readCockpitRows(async ({ signal }) => {
            const row = await db.patients.get(id, { signal });
            return row?.id === id ? [row] : [];
        }, snapshotVisibility.current),
    }), [id], undefined, ['patients', 'patients_to_ambulatories']);
    const { refresh } = patientRead;
    useEffect(() => subscribeClientAccountAuthority(() => {
        invalidateSnapshot(value => value + 1);
        refresh();
    }), [refresh]);
    const currentRead = patientRead.data?.id === id && patientRead.data.snapshot.isCurrent() ? patientRead.data.snapshot : undefined;
    const readFailed = !patientRead.loading && Boolean(patientRead.error || !currentRead);
    const patient = !patientRead.loading && !readFailed ? currentRead?.rows[0] : undefined;
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
            {/* WUL-678: each instrument is one complete, keyboard-accessible target. */}
            <section id="libreria" className={styles.workspace} aria-label="Scegli una scala">
                {patientRead.loading ? <p role="status">Caricamento paziente…</p> : readFailed ? <div>
                    <p role="alert">Impossibile leggere la scheda del paziente. Riprova.</p>
                    <button type="button" onClick={refresh} className={styles.control}>Riprova</button>
                </div> : !patient ? <p role="status">Scheda del paziente non disponibile.</p> : <div className={styles.catalog}>
                    {scales.map(scale => {
                        const Icon = getScaleIcon(scale.id);
                        return (
                            <Link key={scale.id} href={`/patients/${id}/scales/${scale.id}`} onClick={event => { if (!currentRead?.isCurrent()) event.preventDefault(); }} className={styles.catalogLink}>
                                <Icon size={20} aria-hidden="true" />
                                <span>
                                    <span className={styles.catalogTitle}>{scale.title}</span>
                                    <span className={styles.catalogDescription}>{getScaleArea(scale.id)} · {scale.questions.length} domande</span>
                                </span>
                                <ArrowRight size={18} aria-hidden="true" />
                            </Link>
                        );
                    })}
                </div>}
            </section>
        </Kree8WorkspaceShell></div>
    );
}
