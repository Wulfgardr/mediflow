'use client';

/* @Codex */
import { useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ApiConflictError, db } from '@/lib/db';
import {
    PatientEditSession,
    type PatientEditPort,
    type PatientEditRecord,
    type PatientEditResult,
} from '@/lib/patient-edit-session';
import type { PatientFormValues } from '@/lib/schemas';
import PatientForm from '@/components/patient-form';
import { useConfirm } from '@/components/ui/confirm-dialog';

/* @Codex: reuse the existing encryption, session and versioned-write facade. */
const editPort: PatientEditPort = {
    updatePatient: (id, changes) => db.patients.update(id, changes),
    updateCheckup: (id, changes) => db.checkups.update(id, changes),
    deleteCheckup: (id, version) => db.checkups.delete(id, { version }),
    createCheckup: item => db.checkups.add(item),
};

// An error can coexist with the session; keep its draft and acknowledged-write journal.
type PatientEditorState = {
    session: PatientEditSession | null;
    error: string | null;
};

function initialize(record: PatientEditRecord): PatientEditorState {
    try {
        return { session: new PatientEditSession(record), error: null };
    } catch {
        return { session: null, error: 'Snapshot non valido o versione assente. Rileggi i dati prima di modificare.' };
    }
}

/** initialRecord is intentionally consumed once; live-query rerenders are not a rebase. */
export default function PatientEditForm({ initialRecord, onSaved }: {
    initialRecord: PatientEditRecord;
    onSaved: () => void;
}) {
    const [editor, setEditor] = useState<PatientEditorState>(() => initialize(initialRecord));
    const [generation, setGeneration] = useState(0);
    const [result, setResult] = useState<PatientEditResult | null>(null);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const confirm = useConfirm();
    // The route keys this component by patient ID. Props cannot retarget a draft.
    const [patientId] = useState(initialRecord.id);

    async function save(data?: PatientFormValues) {
        if (inFlight.current || !editor.session) return;
        inFlight.current = true;
        setBusy(true);
        try {
            const outcome = data
                ? await editor.session.submit(data, editPort, uuidv4)
                : await editor.session.resume(editPort);
            setResult(outcome);
            if (outcome.status === 'complete') onSaved();
        } catch (error) {
            setEditor(current => ({
                ...current,
                error: error instanceof Error ? error.message : 'Modulo non valido. Nessuna nuova operazione confermata.',
            }));
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }

    async function reload() {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        try {
            const { confirmed } = await confirm({
                title: 'Rileggere i dati salvati?',
                message: 'Le modifiche non salvate saranno abbandonate. Le scritture già applicate non verranno annullate. Controlla i dati riletti prima di un nuovo salvataggio.',
                confirmLabel: 'Abbandona le modifiche residue e rileggi',
                cancelLabel: 'Mantieni il modulo',
            });
            if (!confirmed) return;
            const patient = await db.patients.get(patientId);
            if (!patient || patient.id !== patientId) throw new Error('Scheda non disponibile.');
            const checkups = await db.checkups.query({ patientId }).toArray();
            const refreshed = initialize({ ...patient, checkups });
            if (!refreshed.session) throw new Error(refreshed.error ?? 'Snapshot non valido.');
            setEditor(refreshed);
            setResult(null);
            setGeneration(previous => previous + 1);
        } catch {
            // Keep the old draft/journal if the reread fails; never reset it first.
            setEditor(current => ({ ...current, error: 'Rilettura non riuscita. Il modulo e il tentativo precedente sono conservati; verifica la sessione e riprova.' }));
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }

    const interrupted = result?.status === 'interrupted' ? result : null;
    const conflict = interrupted?.error instanceof ApiConflictError;
    return (
        <div className="space-y-5" aria-busy={busy}>
            {editor.error && <p role="alert" className="mf-alert mf-alert-critical">{editor.error}</p>}
            {interrupted && (
                <section role="alert" className="mf-alert mf-alert-warning space-y-3">
                    <h3 className="font-semibold">Salvataggio non completato</h3>
                    <p>{interrupted.confirmed} di {interrupted.total} operazioni confermate. Il salvataggio non è atomico e le scritture applicate non sono state annullate.</p>
                    <p>{conflict
                        ? 'Un record è cambiato altrove. Rileggi i dati salvati e rivedi le modifiche: non verranno riapplicate con versioni nuove.'
                        : 'L’esito dell’operazione interrotta non è confermato. Il retry mantiene ID e versioni originali e salta le operazioni confermate. Una risposta persa può richiedere la rilettura.'}</p>
                    {!conflict && <button type="button" onClick={() => void save()} disabled={busy} className="mf-btn-secondary">Riprova operazioni residue</button>}
                </section>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">Il modulo conserva i dati dell’apertura. La rilettura richiede una conferma.</p>
                <button type="button" onClick={() => void reload()} disabled={busy} className="mf-btn-secondary">Rileggi i dati salvati</button>
            </div>
            {editor.session && (
                <PatientForm
                    key={generation}
                    defaultValues={editor.session.getDefaultValues()}
                    onSubmit={save}
                    isSubmitting={busy}
                    disabled={editor.session.locked}
                    isEditMode
                />
            )}
        </div>
    );
}
