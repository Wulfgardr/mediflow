'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveQueryState } from '@/lib/live-query';
import { readCockpitRows } from '@/components/kree8/cockpit-read-snapshot';
import { subscribeClientAccountAuthority } from '@/lib/security/client-auth-api';
import type { CockpitSnapshot } from '@/components/kree8/cockpit-read-snapshot';
import type { Patient } from '@/lib/db';
import localStyles from './runner.module.css';
import { db, ScaleEntryWriteError, type PreparedScaleEntryCreate } from '@/lib/db';
import { useParams, useRouter } from 'next/navigation';
import ScaleEngine from '@/components/scale-engine';
import { SCALES } from '@/lib/scale-definitions';
import { submitScale } from '@/lib/scale-submission';
import { v4 as uuidv4 } from 'uuid';
import styles from '@/components/scales/scale-workspace.module.css';
import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import workspaceStyles from '@/components/kree8/kree8-workspace-shell.module.css';
import { useToast } from '@/components/ui/toast-provider';

export default function ScaleRunnerPage() {
    const params = useParams();
    const patientId = params.id as string;
    const scaleId = params.scaleId as string;
    return <ScaleRunner key={`${patientId}:${scaleId}`} patientId={patientId} scaleId={scaleId} />;
}

function ScaleRunner({ patientId, scaleId }: { patientId: string; scaleId: string }) {
    const router = useRouter();
    const { showToast } = useToast();
    const [answersLocked, setAnswersLocked] = useState(false);
    const [draftEntryId] = useState(() => uuidv4());
    const pendingWrite = useRef<Promise<PreparedScaleEntryCreate> | null>(null);
    const [setting, setSetting] = useState<'ambulatory' | 'home'>('ambulatory');

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
    const identity = `${patientId}:${scaleId}`;
    const [anchor, setAnchor] = useState<{ identity: string; snapshot: CockpitSnapshot<Patient>; suspended: boolean } | null>(null);
    const latestRead = useRef<CockpitSnapshot<Patient> | null>(null);
    const readSequence = useRef(0);
    const patientRead = useLiveQueryState(async () => {
        const sequence = ++readSequence.current;
        latestRead.current = null;
        setAnchor(previous => previous?.identity === identity ? !previous.snapshot.retainOnRefresh ? { ...previous, suspended: true } : previous : null);
        const snapshot = await readCockpitRows(async ({ signal }) => {
            const row = await db.patients.get(patientId, { signal });
            return row?.id === patientId ? [row] : [];
        }, snapshotVisibility.current);
        if (sequence === readSequence.current) {
            latestRead.current = snapshot;
            if (snapshot.rows[0]) setAnchor(previous => previous?.identity === identity ? previous : { identity, snapshot, suspended: false });
        }
        return { identity, snapshot };
    }, [identity], undefined, ['patients', 'patients_to_ambulatories']);
    const { refresh } = patientRead;
    useEffect(() => subscribeClientAccountAuthority(() => {
        invalidateSnapshot(value => value + 1);
        refresh();
    }), [refresh]);
    const draft = anchor?.identity === identity ? anchor : null;
    const currentRead = patientRead.data?.identity === identity && patientRead.data.snapshot.isCurrent() ? patientRead.data.snapshot : undefined;
    const readFailed = !patientRead.loading && Boolean(patientRead.error || !currentRead);
    const patient = currentRead?.rows[0];
    const canComplete = useRef<(expectedIdentity: string) => boolean>(() => false);
    const enabled = !patientRead.loading && !readFailed && Boolean(patient) && Boolean(draft && !draft.suspended && draft.snapshot.isCurrent());
    useLayoutEffect(() => {
        canComplete.current = expectedIdentity => Boolean(enabled && identity === expectedIdentity
            && draft?.snapshot.isCurrent() && currentRead && latestRead.current === currentRead
            && currentRead.isCurrent() && currentRead.rows[0]?.id === patientId);
        return () => { canComplete.current = () => false; };
    }, [enabled, identity, draft, currentRead, patientId]);
    const draftPatient = draft?.snapshot.rows[0];
    const contextRetired = draft && !draft.snapshot.isCurrent();
    const message = contextRetired ? 'Il contesto della compilazione non è più valido. Torna alle scale e riaprila per iniziare una nuova compilazione.'
        : draft?.suspended ? 'Non è possibile confermare il contesto della bozza. Torna alle scale e riaprila per iniziare una nuova compilazione.'
        : patientRead.loading ? draft ? 'Lettura del paziente in corso. La compilazione resta sospesa.' : 'Caricamento paziente…'
        : readFailed ? draft ? 'La bozza è conservata in questa schermata, ma la compilazione è sospesa. Riprova la lettura.' : 'Impossibile leggere la scheda del paziente. Riprova.'
        : !patient ? 'Scheda del paziente non disponibile.' : null;
    const scaleDef = Object.prototype.hasOwnProperty.call(SCALES, scaleId) ? SCALES[scaleId] : undefined;

    const handleComplete = async (result: { score: number; answers: Record<string, string | number>; interpretation: string }) => {
        try {
            if (!scaleDef || !canComplete.current(identity)) return;
            const receipt = await submitScale(scaleId, result.answers, async submission => {
                if (!canComplete.current(identity)) throw new ScaleEntryWriteError('UNCONFIRMED');
                setAnswersLocked(true);
                if (!pendingWrite.current) {
                    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
                    pendingWrite.current = db.entries.prepareScaleCreate({
                        id: draftEntryId, patientId, date: now, type: 'scale', title: submission.title,
                        setting, content: submission.content, metadata: submission.metadata,
                        createdAt: now, updatedAt: now, attachments: [],
                    }, () => canComplete.current(identity)).catch(error => {
                        pendingWrite.current = null;
                        throw error;
                    });
                }
                return (await pendingWrite.current).submit();
            });
            if (receipt.alreadyRegistered) showToast({ tone: 'success', title: 'Valutazione già registrata', description: 'È stato recuperato lo stesso esito, senza duplicarlo.' });

            // Land on the independent reread of the saved evaluation.
            router.push(`/patients/${patientId}/modules#scale`);
        } catch (error) {
            console.error("Failed to save scale", error);
            showToast({ tone: 'error', title: 'Errore nel salvataggio della valutazione', description: error instanceof ScaleEntryWriteError ? error.message : 'Registrazione non confermata. La bozza è conservata: premi Completa per verificare lo stesso invio.' });
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
                {/* a retirement notice is clinical content, not optional header copy. */}
                <div className={workspaceStyles.loadingCard} role="status">
                    {scaleId === 'tinetti'
                        ? 'Versione Tinetti precedente ritirata. I risultati storici restano invariati; per una nuova valutazione scegliere POMA-28 v1.'
                        : 'La scala richiesta non è presente nella libreria locale di MediFlow.'}
                </div>
            </Kree8WorkspaceShell></div>
        );
    }

    const patientLabel = draftPatient ? `${draftPatient.lastName} ${draftPatient.firstName}` : patient ? `${patient.lastName} ${patient.firstName}` : undefined;

    return (
        <div className={styles.screen}><Kree8WorkspaceShell
            eyebrow="Valutazione"
            title={scaleDef.title}
            subtitle="Compila la scala nel contesto della visita e salva il punteggio come voce del diario clinico."
            backHref={`/patients/${patientId}/scales`}
            backLabel="Torna alle scale"
            patientLabel={patientLabel}
            statusLabel={enabled ? 'Scrittura locale: il risultato resta nella cartella del paziente.' : undefined}
            navItems={[]}
        >
            {/* WUL-678: context stays selectable without secondary panels. */}
            <section id="scala" className={styles.workspace}>
                {message && <div><p role={readFailed ? 'alert' : 'status'}>{message}</p>
                    {readFailed && !contextRetired && !draft?.suspended && <button type="button" className={styles.control} onClick={refresh}>Riprova</button>}
                </div>}
                <fieldset disabled={!enabled} inert={!enabled} className={localStyles.form}>
                <label className={styles.context}>
                    Contesto
                    <select disabled={answersLocked} value={setting} onChange={event => setSetting(event.target.value as 'ambulatory' | 'home')}>
                        <option value="ambulatory">Ambulatorio</option>
                        <option value="home">Domicilio</option>
                    </select>
                </label>
                <details className={styles.details}>
                    <summary>Informazioni sulla compilazione</summary>
                    <p>{scaleDef.description}</p>
                    <p>Con Completa salvi punteggio, interpretazione e risposte nel diario del paziente.</p>
                </details>
                {draft && (
                    <ScaleEngine key={`${patientId}:${scaleDef.id}`} scale={scaleDef} showHeading={false} patientLabel={patientLabel}
                        answersLocked={answersLocked} onComplete={handleComplete} onCancel={handleCancel} />
                )}
                </fieldset>
            </section>
        </Kree8WorkspaceShell></div>
    );
}
