'use client';

import { useEffect, useRef, useState } from 'react';
import { createIntelligentHostBrowserAdapter, IntelligentHostBrowserAdapterError } from '@/lib/security/intelligent-host-browser-adapter';
import workspaceStyles from './kree8/kree8-workspace-shell.module.css';

export function PatientProfileAccessAction({ patientId, ambulatoryId }: Readonly<{ patientId: string; ambulatoryId: string | null }>) {
    const [client] = useState(() => createIntelligentHostBrowserAdapter());
    const [projection, setProjection] = useState<'none' | 'notes' | 'profile'>('none');
    const [busy, setBusy] = useState(false), [active, setActive] = useState(false);
    const [message, setMessage] = useState('Scegli quali dati consentire nella sessione dell’assistente collegato.');
    const lifecycle = useRef({ active: true });
    useEffect(() => {
        const token = { active: true }; lifecycle.current = token; client.reset(); setProjection('none'); setBusy(false); setActive(false);
        setMessage('Senza consenso aggiuntivo, profilo e note non vengono concessi.');
        return () => { token.active = false; client.reset(); };
    }, [patientId, ambulatoryId, client]);
    const activate = async () => {
        if (!ambulatoryId || busy || active) return;
        const current = lifecycle.current; setBusy(true);
        try {
            await client.initialize();
            if (!current.active) return;
            await client.activate({ patientId, ambulatoryId }, true, projection === 'none' ? undefined : { projection });
            if (!current.active) return;
            setActive(true); setMessage(projection === 'none' ? 'Assistente attivo senza accesso aggiuntivo a profilo o note.'
                : projection === 'notes' ? 'Assistente attivo con accesso alle sole note del paziente selezionato.'
                    : 'Assistente attivo con accesso al profilo del paziente selezionato, comprese le note.');
        } catch (error) {
            if (!current.active) return;
            setMessage(error instanceof IntelligentHostBrowserAdapterError && error.code === 'session_unavailable'
                ? 'Sblocca MediFlow prima di attivare l’assistente.'
                : 'Attivazione non confermata. Se esiste già una sessione assistente, chiudila e riavviala prima di cambiare accesso.');
        } finally { if (current.active) setBusy(false); }
    };
    return <details className={`${workspaceStyles.headerActionsMenu} print:hidden`} data-testid="patient-profile-access-action">
        <summary className={`${workspaceStyles.headerActionButton} cursor-pointer min-h-11`}>Accesso assistente</summary>
        <div className="mf-popover fixed left-2 right-2 top-20 z-40 max-h-[75dvh] overflow-y-auto space-y-3 p-4 text-sm sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:max-w-[calc(100vw-1rem)]">
            <p>Autorizza una lettura del paziente selezionato. Non consente modifiche né abilita provider AI.</p>
            <label className="mf-field-label">Dati consentiti
                <select className="mf-input w-full mt-1" value={projection} disabled={busy || active}
                    onChange={event => setProjection(event.target.value as 'none' | 'notes' | 'profile')}>
                    <option value="none">Nessun accesso aggiuntivo</option><option value="notes">Solo note</option><option value="profile">Profilo completo e note</option>
                </select>
            </label>
            <button type="button" className={workspaceStyles.headerPrimaryAction} disabled={busy || active || !ambulatoryId} onClick={() => void activate()}>{busy ? 'Attivazione…' : 'Conferma e attiva assistente'}</button>
            <p role="status">{ambulatoryId ? message : 'Accesso non disponibile: manca l’ambulatorio del paziente.'}</p>
        </div>
    </details>;
}
