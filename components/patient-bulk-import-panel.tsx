'use client';

/* @Codex: only preview metadata fetch; patient writes use the existing encrypted client. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { db, type Patient } from '@/lib/db';
import { useSecurity } from '@/components/security-provider';
import { useRuntimeTwinPendingForm } from '@/components/runtime-twin-design';
import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import PrivacyBlur from '@/components/privacy-blur';
import { isPatientCsvRowEligible, PATIENT_CSV_TEMPLATE } from '@/lib/patient-bulk-import';
import {
    emptyPatientBulkSnapshot, hasUnresolvedPatientBulkReceipt, PatientBulkImportSession,
    type PatientBulkContext, type PatientBulkOutcome, type PatientBulkPrecondition,
} from '@/lib/patient-bulk-import-session';
import styles from './patient-bulk-import-panel.module.css';

function selectionCookie(): string | null {
    const values = document.cookie.split(';').map(value => value.trim()).filter(value => value.startsWith('ambulatory_id='));
    if (values.length > 1) throw new Error('Ambulatory selection ambiguous.');
    return values.length ? decodeURIComponent(values[0].slice('ambulatory_id='.length)) : null;
}
const outcomes: Record<PatientBulkOutcome, string> = {
    excluded: 'Esclusa', 'not-sent': 'Non inviata', 'in-flight': 'In corso', confirmed: 'Confermata', unknown: 'Esito sconosciuto',
};

// Public, constant header-only template. No object URL allocation or effect state.
const templateUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(PATIENT_CSV_TEMPLATE)}`;
const emptySnapshot = emptyPatientBulkSnapshot();

/** React subscribes after mount; cleanup destroys this exact controller. StrictMode
 * resubscription creates a fresh one, never revives an invalidated preview/job. */
function createImportBinding(operatorId: string, initialAmbulatoryCookie: string | null) {
    let controllerRef: PatientBulkImportSession | null = null;
    return {
        getSnapshot: () => controllerRef?.getSnapshot() ?? emptySnapshot,
        getServerSnapshot: () => emptySnapshot,
        getSession: () => controllerRef,
        subscribe: (notify: () => void) => {
            let documentActive = true;
            const isCurrent = (context: PatientBulkContext) => {
                try {
                    return documentActive && db.isKeySet() && !context.signal.aborted
                        && db.getSessionReadSignal() === context.signal && context.operatorId === operatorId
                        && selectionCookie() === context.cookie && context.cookie === initialAmbulatoryCookie;
                } catch { return false; }
            };
            const controller = new PatientBulkImportSession({
                captureContext: async () => {
                    const signal = db.getSessionReadSignal();
                    const cookie = selectionCookie();
                    if (!documentActive || signal.aborted || !db.isKeySet() || cookie !== initialAmbulatoryCookie) {
                        throw new Error('Ambulatory context unavailable.');
                    }
                    const ambulatories = await db.ambulatories.toArray();
                    const candidates = cookie ? ambulatories.filter(item => item.id === cookie) : ambulatories.filter(item => item.isDefault);
                    if (candidates.length !== 1) throw new Error('Ambulatory context not unique.');
                    const context: PatientBulkContext = { operatorId, signal, cookie,
                        ambulatoryId: candidates[0].id, ambulatoryName: candidates[0].name };
                    if (!isCurrent(context)) throw new Error('Ambulatory context changed.');
                    return context;
                },
                isCurrent,
                captureCreateContext: async context => {
                    if (!isCurrent(context)) throw new Error('Context changed.');
                    const response = await fetch('/api/patients/create-context', { cache: 'no-store', signal: context.signal });
                    if (!response.ok || !isCurrent(context)) throw new Error('Preview context unavailable.');
                    const value: unknown = await response.json();
                    if (!isCurrent(context) || !value || typeof value !== 'object') throw new Error('Preview context unavailable.');
                    const preview = value as PatientBulkPrecondition;
                    if (preview.version !== 1 || typeof preview.nonce !== 'string' || !/^[a-f0-9]{64}$/u.test(preview.nonce)
                        || preview.ambulatoryId !== context.ambulatoryId || typeof preview.ambulatoryName !== 'string'
                        || !preview.ambulatoryName || preview.ambulatoryName.length > 512
                        || !Number.isSafeInteger(preview.expiresAt) || preview.expiresAt <= Date.now()) {
                        throw new Error('Preview context unavailable.');
                    }
                    return { version: 1, nonce: preview.nonce, ambulatoryId: preview.ambulatoryId,
                        ambulatoryName: preview.ambulatoryName, expiresAt: preview.expiresAt };
                },
                listPatients: () => db.patients.toArray(),
                getPatient: (id, signal) => db.patients.get(id, { signal }),
                // Patient's legacy read type requires address/phone, although the existing
                // create normalizer accepts their omission. Keep blanks ABSENT at runtime.
                // This single boundary assertion changes no schema, crypto mapping or API.
                addPatient: (patient, guard) => db.patients.add(patient as Patient, { createContext: {
                    nonce: guard.precondition.nonce, ambulatoryId: guard.precondition.ambulatoryId,
                    expiresAt: guard.precondition.expiresAt, signal: guard.signal, isCurrent: guard.isCurrent,
                } }),
            });
            controllerRef = controller;
            const unsubscribe = controller.subscribe(notify);
            void controller.observeReceipt();
            const checkContext = () => controller.checkCurrent();
            const retire = () => { documentActive = false; controller.invalidate('navigation'); };
            const restore = () => { documentActive = true; }; // Fresh file/review required; never resume.
            const leave = (event: BeforeUnloadEvent) => {
                const state = controller.getSnapshot();
                if (state.phase === 'idle' && !hasUnresolvedPatientBulkReceipt(state.receipt)) return;
                if (['applying', 'stopping'].includes(state.phase)) controller.cancel();
                if (['reading', 'preview', 'rechecking', 'applying', 'stopping', 'reconciling'].includes(state.phase)
                    || hasUnresolvedPatientBulkReceipt(state.receipt)) {
                    event.preventDefault(); event.returnValue = '';
                }
            };
            window.addEventListener('pagehide', retire);
            window.addEventListener('pageshow', restore);
            window.addEventListener('focus', checkContext);
            window.addEventListener('beforeunload', leave);
            document.addEventListener('visibilitychange', checkContext);
            document.addEventListener('click', checkContext, true);
            document.addEventListener('keydown', checkContext, true);
            return () => {
                documentActive = false;
                unsubscribe();
                controller.dispose();
                if (controllerRef === controller) controllerRef = null;
                window.removeEventListener('pagehide', retire);
                window.removeEventListener('pageshow', restore);
                window.removeEventListener('focus', checkContext);
                window.removeEventListener('beforeunload', leave);
                document.removeEventListener('visibilitychange', checkContext);
                document.removeEventListener('click', checkContext, true);
                document.removeEventListener('keydown', checkContext, true);
            };
        },
    };
}

export default function PatientBulkImportPanel({ initialAmbulatoryCookie }: { initialAmbulatoryCookie: string | null }) {
    const { isAuthenticated, isLocked, user, authRecoveryState } = useSecurity();
    if (!isAuthenticated || isLocked || !user?.id || authRecoveryState !== 'ready') {
        return <p role="status">Sblocca l’accesso per preparare una nuova anteprima.</p>;
    }
    return <ActivePatientBulkImport key={JSON.stringify([user.id, initialAmbulatoryCookie])}
        operatorId={user.id} initialAmbulatoryCookie={initialAmbulatoryCookie} />;
}

function ActivePatientBulkImport({ operatorId, initialAmbulatoryCookie }: {
    operatorId: string; initialAmbulatoryCookie: string | null;
}) {
    const [binding] = useState(() => createImportBinding(operatorId, initialAmbulatoryCookie));
    const snapshot = useSyncExternalStore(binding.subscribe, binding.getSnapshot, binding.getServerSnapshot);
    const session = binding.getSession();
    const [consentRevision, setConsentRevision] = useState<number | null>(null);
    const previewTitle = useRef<HTMLHeadingElement>(null);
    const resultTitle = useRef<HTMLHeadingElement>(null);
    const busy = ['reading', 'rechecking', 'applying', 'stopping', 'reconciling'].includes(snapshot.phase);
    const unresolved = hasUnresolvedPatientBulkReceipt(snapshot.receipt);
    const pending = busy || snapshot.phase === 'preview' || unresolved;
    useRuntimeTwinPendingForm(pending);

    useEffect(() => {
        if (snapshot.phase === 'preview') previewTitle.current?.focus();
        if (snapshot.phase === 'complete') resultTitle.current?.focus();
    }, [snapshot.phase, snapshot.previewRevision]);

    const eligible = snapshot.preview?.rows.filter(isPatientCsvRowEligible).length ?? 0;
    const receipt = snapshot.receipt;
    const counts = { confirmed: 0, unknown: 0, 'not-sent': 0, excluded: 0, 'in-flight': 0 };
    receipt?.rows.forEach(row => { counts[row.outcome] += 1; });
    const reviewed = consentRevision === snapshot.previewRevision;
    const showReceipt = receipt && (snapshot.phase !== 'preview' || unresolved);

    return (
        <Kree8WorkspaceShell eyebrow="Pazienti" title="Importa elenco"
            subtitle="Aggiungi più schede da un CSV, dopo averle controllate."
            backHref="/?area=incarico" backLabel="Torna alla lista"
            statusLabel="Le schede esistenti non vengono modificate.">
            <div className={styles.panel} data-testid="patient-bulk-import" data-phase={snapshot.phase}>
                <section className={styles.section} aria-labelledby="bulk-file-title">
                    <h2 id="bulk-file-title">1. Scegli l’elenco</h2>
                    <p>Compila il modello con nome, cognome e codice fiscale. Data di nascita, indirizzo e telefono sono facoltativi.</p>
                    <p className={styles.muted}>CSV UTF-8, separatore punto e virgola (;), massimo 2 MiB e 500 righe. Per le date usa YYYY-MM-DD.</p>
                    <div className={styles.actions}>
                        <a className={styles.secondary} href={templateUrl} download="mediflow-modello-pazienti.csv">Scarica modello CSV</a>
                        <label className={styles.fileLabel}>
                            <span>Scegli file CSV</span>
                            <input type="file" accept=".csv,text/csv" data-testid="patient-bulk-file"
                                disabled={busy || unresolved || !session} onChange={event => {
                                    const file = event.currentTarget.files?.[0];
                                    event.currentTarget.value = '';
                                    setConsentRevision(null);
                                    if (file) void session?.prepare(file);
                                }} />
                        </label>
                    </div>
                    {snapshot.ambulatoryName ? <p>Ambulatorio: <strong>{snapshot.ambulatoryName}</strong></p> : null}
                    <details className={styles.disclosure}>
                        <summary>Formato e limiti della verifica</summary>
                        <p>Mantieni le sei intestazioni del modello, nello stesso ordine. Nome e cognome: 2–100 caratteri; indirizzo: massimo 500; telefono: massimo 80. Le celle vuote restano assenti.</p>
                        <p>Nome e cognome non sono modificati. Il codice fiscale viene convertito in maiuscolo dopo la verifica dei 16 caratteri; si rimuovono solo gli spazi esterni. Non si verifica l’attribuzione del codice fiscale.</p>
                        <p>I duplicati nel file e nelle schede accessibili dell’ambulatorio sono esclusi. Non è una verifica globale: importazioni contemporanee possono creare duplicati.</p>
                        <p>La destinazione è fissata nell’anteprima: ogni scheda viene salvata solo nell’ambulatorio indicato oppure l’invio è negato. Un cambio osservato qui interrompe le righe successive; non annulla salvataggi già conclusi, neppure da altre schede.</p>
                        <p>Il salvataggio usa la cifratura già prevista per indirizzo e telefono; non cambia la protezione degli altri campi. Il file non viene caricato su servizi esterni.</p>
                    </details>
                </section>
                {snapshot.notice ? <p className={styles.notice} role="status" aria-live="polite">{snapshot.notice}</p> : null}
                {snapshot.phase === 'reading' ? <p role="status">Lettura e validazione locale. Nessuna scheda viene salvata.</p> : null}
                {snapshot.preview ? (
                    <section className={styles.section} aria-labelledby="bulk-preview-title">
                        <h2 id="bulk-preview-title" tabIndex={-1} ref={previewTitle}>2. Controlla l’anteprima</h2>
                        <p data-testid="patient-bulk-destination">Destinazione dell’anteprima: <strong>{snapshot.ambulatoryName}</strong>. L’anteprima scade entro 5 minuti; dopo la scadenza seleziona nuovamente il file.</p>
                        <p data-testid="patient-bulk-preview-count">{eligible} da aggiungere · {snapshot.preview.rows.length - eligible} escluse · {snapshot.preview.rows.length} righe totali</p>
                        <table className={styles.table} role="table">
                            <caption>Anteprima delle righe del file: nessun salvataggio prima della conferma.</caption>
                            <thead><tr><th scope="col">Riga</th><th scope="col">Anagrafica</th><th scope="col">Codice fiscale</th><th scope="col">Controllo</th></tr></thead>
                            <tbody>{snapshot.preview.rows.map(row => (
                                <tr key={row.row} role="row" data-testid={`patient-bulk-preview-row-${row.row}`}>
                                    <td role="cell" data-label="Riga">{row.row}<small className={styles.muted}>Linea {row.line}</small></td>
                                    <td role="cell" data-label="Anagrafica">
                                        <PrivacyBlur>{row.cells[0]} {row.cells[1]}</PrivacyBlur>
                                        <details className={styles.disclosure}>
                                            <summary>Altri dati riga {row.row}</summary>
                                            <dl><dt>Data di nascita</dt><dd><PrivacyBlur>{row.cells[3] || 'Assente'}</PrivacyBlur></dd>
                                                <dt>Indirizzo</dt><dd><PrivacyBlur>{row.cells[4] || 'Assente'}</PrivacyBlur></dd>
                                                <dt>Telefono</dt><dd><PrivacyBlur>{row.cells[5] || 'Assente'}</PrivacyBlur></dd></dl>
                                        </details>
                                    </td>
                                    <td role="cell" data-label="Codice fiscale"><PrivacyBlur>{row.values?.taxCode ?? row.cells[2]}</PrivacyBlur></td>
                                    <td role="cell" data-label="Controllo">
                                        <strong>{isPatientCsvRowEligible(row) ? 'Da aggiungere' : 'Esclusa'}</strong>
                                        {row.issues.map((issue, index) => <p key={`${issue.code}-${index}`}>{issue.field ? `${issue.field}: ` : ''}{issue.message}</p>)}
                                        {row.duplicateInFile ? <p>Codice fiscale ripetuto nel file: tutte le occorrenze escluse.</p> : null}
                                        {row.duplicateExisting ? <p>Codice fiscale già presente nell’ambulatorio.</p> : null}
                                    </td>
                                </tr>
                            ))}</tbody>
                        </table>
                        {snapshot.phase === 'preview' ? <>
                            <p>Verranno aggiunte solo le {eligible} righe valide e non duplicate. In caso di errore, le schede già salvate restano presenti.</p>
                            <label className={styles.consent}>
                                <input type="checkbox" checked={reviewed} disabled={eligible === 0}
                                    onChange={event => setConsentRevision(event.currentTarget.checked ? snapshot.previewRevision : null)} />
                                <span>Ho controllato l’anteprima e confermo le righe da aggiungere.</span>
                            </label>
                            <div className={styles.actions}>
                                <button type="button" className={styles.primary} disabled={!reviewed || eligible === 0 || !session}
                                    onClick={() => { void session?.confirm(snapshot.previewRevision, reviewed); }}>
                                    Conferma e aggiungi {eligible} pazienti
                                </button>
                                <button type="button" className={styles.secondary} onClick={() => session?.cancel()}>Annulla anteprima</button>
                            </div>
                        </> : null}
                    </section>
                ) : null}
                {busy && snapshot.phase !== 'reconciling' ? <div className={styles.actions}>
                    <button type="button" className={styles.secondary} disabled={snapshot.phase === 'stopping'}
                        onClick={() => session?.cancel()}>{snapshot.phase === 'stopping' ? 'Interruzione in corso…' : 'Annulla importazione'}</button>
                </div> : null}
                {showReceipt ? (
                    <section className={styles.section} aria-labelledby="bulk-result-title">
                        <h2 id="bulk-result-title" tabIndex={-1} ref={resultTitle}>3. Esiti dell’importazione</h2>
                        <p data-testid="patient-bulk-result-count">{counts.confirmed} confermate · {counts.unknown} sconosciute · {counts['not-sent']} non inviate · {counts.excluded} escluse</p>
                        {receipt.active ? <progress aria-label="Avanzamento importazione" max={Math.max(1, receipt.rows.length - counts.excluded)}
                            value={counts.confirmed + counts.unknown} /> : null}
                        <p>Non è un ripristino né un’operazione unica: le schede confermate rimangono salvate anche dopo un’interruzione.</p>
                        <table className={styles.table} role="table">
                            <caption>Esiti osservati e identificativi delle righe tentate</caption>
                            <thead><tr><th scope="col">Riga</th><th scope="col">Esito</th><th scope="col">Identificativo</th></tr></thead>
                            <tbody>{receipt.rows.map(row => <tr key={row.row} role="row">
                                <td role="cell" data-label="Riga">{row.row}</td>
                                <td role="cell" data-label="Esito">{receipt.active && row.outcome === 'not-sent' ? 'Non ancora inviata' : outcomes[row.outcome]}
                                    {row.evidence === 'read-only' ? <small>Osservata durante la verifica successiva</small> : null}</td>
                                <td role="cell" data-label="Identificativo"><code>{row.id ?? '—'}</code></td>
                            </tr>)}</tbody>
                        </table>
                        {counts.unknown > 0 ? <>
                            <p className={styles.notice}>Non ripetere l’importazione: una scheda potrebbe essere già salvata. Torna nello stesso ambulatorio e verifica gli identificativi.</p>
                            <button type="button" className={styles.secondary} disabled={busy || receipt.active || !session}
                                onClick={() => { void session?.reconcile(); }}>Verifica esiti sconosciuti</button>
                        </> : null}
                        <p className={styles.muted}>Questo promemoria resta solo in memoria nella finestra corrente. Ricaricare o chiudere completamente la pagina lo perde; prima annota gli identificativi ancora da verificare. Un identificativo non trovato non dimostra un annullamento.</p>
                    </section>
                ) : null}
            </div>
        </Kree8WorkspaceShell>
    );
}
