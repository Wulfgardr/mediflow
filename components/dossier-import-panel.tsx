'use client';

/*
 * Dossier da cartella (WUL-804, ADR 0175). Superficie Web locale, con la chiave nel
 * client. Ogni scrittura parte da un'azione esplicita del medico e passa da
 * lib/document-dossier-session.ts sui writer ordinari. Nessun modello coinvolto.
 */

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import PrivacyBlur from '@/components/privacy-blur';
import { useSecurity } from '@/components/security-provider';
import { db } from '@/lib/db';
import { createDossierPorts } from '@/lib/document-dossier-ports';
import {
    DossierAbortedError, DossierIdentityBlocked, DossierStaleError, acquireDossierGroup, applyDossierDocument, buildDossierInventory,
    evaluateDraftGroupIdentity, loadPatientDossier, saveDossierReview,
    type DossierAcquireOutcome, type DossierApplyResult, type DossierDocumentView, type DossierDraftGroup, type DossierInputFile,
    type DossierPatient, type DossierPatientView,
} from '@/lib/document-dossier-session';
import {
    DOSSIER_FACT_KIND_LABELS, DOSSIER_GAP_LABELS, buildDossierReceipt, createManualDossierFact, dossierFactBlockers, dossierFactRef,
    latestAppliedOutcome, unitText,
    type DossierFact, type DossierFactKind, type DossierRecord,
} from '@/lib/domain/documents/dossier-import';
import { formatCountLabel } from '@/lib/format-count';
import styles from './patient-bulk-import-panel.module.css';

type FieldSpec = { name: string; label: string; type?: 'date' | 'textarea' | 'select'; options?: Array<[string, string]> };
const TEXT_FIELDS: FieldSpec[] = [{ name: 'title', label: 'Titolo' }, { name: 'date', label: 'Data', type: 'date' }, { name: 'text', label: 'Testo', type: 'textarea' }];
const FIELDS: Record<DossierFactKind, FieldSpec[]> = {
    diagnosis: [{ name: 'description', label: 'Descrizione' }, { name: 'code', label: 'Codice (solo se scritto nel documento)' },
        { name: 'system', label: 'Sistema', type: 'select', options: [['', 'Nessun codice'], ['ICD-9', 'ICD-9'], ['ICD-10', 'ICD-10'], ['ICD-11', 'ICD-11']] },
        { name: 'date', label: 'Data', type: 'date' }],
    exemption: [{ name: 'code', label: 'Codice di esenzione' }],
    therapy: [{ name: 'drugName', label: 'Farmaco' }, { name: 'dosage', label: 'Posologia' },
        { name: 'status', label: 'Stato', type: 'select', options: [['completed', 'Storica, non in corso'], ['suspended', 'Sospesa'], ['active', 'In corso']] },
        { name: 'startDate', label: 'Inizio', type: 'date' }, { name: 'endDate', label: 'Fine', type: 'date' }],
    observation: [{ name: 'display', label: 'Esame' }, { name: 'value', label: 'Valore' }, { name: 'unit', label: 'Unità nel documento' },
        { name: 'code', label: 'Codice LOINC' }, { name: 'unitCode', label: 'Unità UCUM' }, { name: 'refText', label: 'Intervallo di riferimento' },
        { name: 'observedAt', label: 'Data del prelievo', type: 'date' }],
    service_prescription: [{ name: 'serviceName', label: 'Prestazione principale' },
        { name: 'category', label: 'Categoria', type: 'select', options: [['', 'Scegli'], ['lab', 'Laboratorio'], ['imaging', 'Imaging'], ['visit', 'Visita'], ['rehab', 'Riabilitazione'], ['screening', 'Screening'], ['procedure', 'Procedura'], ['other', 'Altro']] },
        { name: 'priority', label: 'Priorità', type: 'select', options: [['', 'Non indicata'], ['U', 'U'], ['B', 'B'], ['D', 'D'], ['P', 'P']] },
        { name: 'prescribedAt', label: 'Data della richiesta', type: 'date' }, { name: 'requestReference', label: 'Numero ricetta (NRE)' },
        { name: 'clinicalQuestion', label: 'Quesito' }, { name: 'items', label: 'Voci, una per riga', type: 'textarea' }],
    prosthetic: [{ name: 'description', label: 'Ausilio' },
        { name: 'category', label: 'Categoria', type: 'select', options: [['', 'Scegli'], ['standard', 'Standard'], ['oxygen', 'Ossigeno'], ['repair', 'Riparazione'], ['replacement', 'Sostituzione'], ['trial', 'Prova'], ['other', 'Altro']] },
        { name: 'status', label: 'Stato documentato', type: 'select', options: [['prescribed', 'Prescritto'], ['submitted', 'Presentato'], ['authorized', 'Autorizzato'], ['delivered', 'Consegnato'], ['tested', 'Collaudato']] },
        { name: 'isoCode', label: 'Codice ISO (solo se scritto)' }, { name: 'prescribedAt', label: 'Data', type: 'date' }],
    reported_scale: [{ name: 'scaleName', label: 'Scala' }, { name: 'scaleTotal', label: 'Totale trascritto' }, { name: 'date', label: 'Data', type: 'date' }, { name: 'text', label: 'Contesto', type: 'textarea' }],
    anamnesis: TEXT_FIELDS, assessment: TEXT_FIELDS, imaging_report: TEXT_FIELDS, invalidity: TEXT_FIELDS, care_context: TEXT_FIELDS, document_entry: TEXT_FIELDS,
};
const DEFAULT_VALUES: Partial<Record<DossierFactKind, Record<string, string>>> = {
    therapy: { status: 'completed' }, prosthetic: { status: 'prescribed' },
    anamnesis: { title: 'Anamnesi da documento' }, assessment: { title: 'Valutazione da documento' }, imaging_report: { title: 'Referto di imaging' },
    invalidity: { title: 'Invalidità da documento' }, care_context: { title: 'Contesto assistenziale da documento' },
};
const EXTRACTION_LABEL: Record<string, string> = {
    unsupported_format: 'formato non leggibile', image_or_scan: 'OCR non riuscito su almeno una pagina', malformed_document: 'file danneggiato',
    encrypted_document: 'file protetto da password', resource_limit: 'oltre i limiti di estrazione', incomplete_document: 'documento incompleto',
    io_failure: 'errore di lettura locale', empty_extraction: 'nessun testo riconosciuto', unavailable: 'estrazione non disponibile',
};
const ACQUIRE_LABEL: Record<string, string> = {
    stored: 'Originale salvato e riletto identico', reused: 'Già in MediFlow: riusato, non duplicato',
    duplicate_in_selection: 'Copia identica di un altro file selezionato', excluded: 'Escluso da te', unreadable: 'Non leggibile dal browser',
    source_changed: 'Il file è cambiato dopo la lettura: rileggi la cartella', too_large: 'Oltre il limite di dimensione dell’archivio',
    readback_mismatch: 'Rilettura diversa dall’originale', write_failed: 'Salvataggio non confermato', artifact_conflict: 'Artefatto esistente non compatibile o non leggibile',
};
const ASSESSMENT_LABEL: Record<string, string> = {
    new: 'Nuovo rispetto alla scheda', already_present: 'Già in scheda', duplicate_in_dossier: 'Duplicato di un’altra fonte', conflict: 'In conflitto',
};

function inputFiles(list: FileList): DossierInputFile[] {
    return [...list].map((file) => ({
        name: file.name, size: file.size, type: file.type, lastModified: file.lastModified,
        relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        read: async () => new Uint8Array(await file.arrayBuffer()),
    }));
}

function patientLabel(patient: DossierPatient): string {
    return `${patient.lastName} ${patient.firstName} · ${patient.taxCode || 'senza codice fiscale'}${patient.birthDate ? ` · ${patient.birthDate}` : ''}`;
}

function describeExtraction(record: Pick<DossierRecord, 'extraction'>): string {
    const extraction = record.extraction;
    if (extraction.state === 'extracted') {
        const units = extraction.unitBasis === 'pages' ? formatCountLabel(extraction.units.length, 'pagina', 'pagine') : 'documento intero';
        return `Testo letto: ${units}${extraction.ocrPageCount ? `, ${extraction.ocrPageCount} con OCR locale` : ''}`;
    }
    if (extraction.state === 'failed') return `Estrazione non riuscita: ${EXTRACTION_LABEL[extraction.detail] ?? extraction.detail}`;
    return 'Conservato senza estrazione';
}

export default function DossierImportPanel({ initialPatientId }: { initialPatientId: string | null }) {
    const { isAuthenticated, isLocked, user, authRecoveryState } = useSecurity();
    if (!isAuthenticated || isLocked || !user?.id || authRecoveryState !== 'ready') {
        return (
            <Kree8WorkspaceShell eyebrow="Pazienti" title="Importa documenti" subtitle="Dossier clinico da una cartella del Mac."
                backHref="/patients/import" backLabel="Torna all’importazione">
                <p role="status" className={styles.muted}>Sblocca MediFlow per leggere una cartella.</p>
            </Kree8WorkspaceShell>
        );
    }
    return <ActiveDossierImport key={user.id} initialPatientId={initialPatientId} />;
}

function ActiveDossierImport({ initialPatientId }: { initialPatientId: string | null }) {
    const ports = useMemo(() => createDossierPorts(), []);
    const folderInput = useRef<HTMLInputElement>(null);
    const filesInput = useRef<HTMLInputElement>(null);
    const ids = useId();
    const generation = useRef(0);
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [patients, setPatients] = useState<DossierPatient[]>([]);
    const [groups, setGroups] = useState<DossierDraftGroup[]>([]);
    const [links, setLinks] = useState<Record<string, string>>({});
    const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});
    const [outcomes, setOutcomes] = useState<Record<string, DossierAcquireOutcome>>({});
    const [measured, setMeasured] = useState<Record<string, { original: number; artifact: number }>>({});
    const [dossierPatientId, setDossierPatientId] = useState(initialPatientId ?? '');
    const [view, setView] = useState<DossierPatientView | null>(null);

    useEffect(() => () => { generation.current += 1; }, []);
    useEffect(() => {
        const signal = db.getSessionReadSignal();
        const retire = () => { generation.current += 1; setGroups([]); setView(null); setBusy(null); };
        signal.addEventListener('abort', retire, { once: true });
        window.addEventListener('pagehide', retire);
        return () => { signal.removeEventListener('abort', retire); window.removeEventListener('pagehide', retire); };
    }, []);

    const operation = useCallback(() => {
        generation.current += 1;
        const mine = generation.current;
        const signal = db.getSessionReadSignal();
        return { signal, isCurrent: () => generation.current === mine && !signal.aborted && db.isKeySet() };
    }, []);

    const refreshPatients = useCallback(async () => {
        const signal = db.getSessionReadSignal();
        try { setPatients(await ports.listPatients(signal)); } catch { if (!signal.aborted) setNotice('Elenco delle schede non disponibile. Riprova.'); }
    }, [ports]);
    useEffect(() => { void refreshPatients(); }, [refreshPatients]);

    const loadDossier = useCallback(async (patientId: string) => {
        if (!patientId) { setView(null); return; }
        const op = operation();
        setBusy('Lettura del dossier dalla scheda…');
        try {
            const next = await loadPatientDossier(ports, patientId, op.signal);
            if (op.isCurrent()) setView(next);
        } catch { if (op.isCurrent()) setNotice('Dossier non leggibile. Riprova.'); }
        finally { if (op.isCurrent()) setBusy(null); }
    }, [operation, ports]);
    useEffect(() => { if (initialPatientId) void loadDossier(initialPatientId); }, [initialPatientId, loadDossier]);

    const readSelection = async (list: FileList | null) => {
        if (!list?.length) return;
        const files = inputFiles(list);
        const op = operation();
        setGroups([]); setOutcomes({}); setMeasured({}); setNotice(null); setConfirmations({});
        setBusy(`Lettura locale di ${formatCountLabel(files.length, 'file', 'file')}…`);
        try {
            const next = await buildDossierInventory(ports, files, { ...op, onProgress: (done, total) => {
                if (op.isCurrent()) setBusy(`Lettura locale: ${done} di ${total}. Nessun file viene ancora salvato.`);
            } });
            if (!op.isCurrent()) return;
            setGroups(next);
            const suggestions: Record<string, string> = {};
            for (const group of next) {
                const identity = evaluateDraftGroupIdentity(group, patients, null);
                if (identity.status === 'suggested') suggestions[group.key] = identity.candidatePatientIds[0];
            }
            setLinks(suggestions);
        } catch (error) {
            if (op.isCurrent()) setNotice(error instanceof DossierAbortedError ? error.message : 'Lettura della cartella non riuscita.');
        } finally { if (op.isCurrent()) setBusy(null); }
    };

    const setExcluded = (groupKey: string, sourceKey: string, excluded: boolean) => {
        setGroups((current) => current.map((group) => group.key !== groupKey ? group : { ...group, sources: group.sources.map((source) =>
            source.key !== sourceKey || source.status === 'duplicate_in_selection' || source.status === 'unreadable' ? source
                : { ...source, status: excluded ? 'excluded' : 'ready' }) }));
        setConfirmations((current) => ({ ...current, [groupKey]: false }));
    };

    const acquire = async (group: DossierDraftGroup) => {
        const patientId = links[group.key];
        if (!patientId) return;
        const op = operation();
        setBusy('Salvataggio e rilettura degli originali…');
        try {
            await acquireDossierGroup(ports, { group, patientId, confirmed: confirmations[group.key] === true, ...op,
                onProgress: (outcome) => {
                    if (!op.isCurrent()) return;
                    setOutcomes((current) => ({ ...current, [outcome.key]: outcome }));
                    if ((outcome.status === 'stored') && outcome.measured) setMeasured((current) => ({ ...current, [outcome.key]: outcome.measured! }));
                } });
            if (op.isCurrent()) { setDossierPatientId(patientId); await loadDossierAfter(patientId, op); }
        } catch (error) {
            if (op.isCurrent()) setNotice(error instanceof DossierIdentityBlocked || error instanceof DossierAbortedError ? error.message : 'Acquisizione interrotta. Le fonti già rilette restano salvate; ripeti per completare senza duplicati.');
        } finally { if (op.isCurrent()) setBusy(null); }
    };

    const loadDossierAfter = async (patientId: string, op: { signal: AbortSignal; isCurrent: () => boolean }) => {
        const next = await loadPatientDossier(ports, patientId, op.signal);
        if (op.isCurrent()) setView(next);
    };

    return (
        <Kree8WorkspaceShell eyebrow="Pazienti" title="Importa documenti"
            subtitle="Collega i documenti di una cartella alle schede, conservando originali, testo e provenienza."
            backHref="/patients/import" backLabel="Torna all’importazione"
            statusLabel="Nessuna scrittura senza la tua conferma.">
            <div className={styles.panel} data-testid="dossier-import" aria-busy={busy ? 'true' : 'false'}>
                <section className={styles.section} aria-labelledby={`${ids}-pick`}>
                    <h2 id={`${ids}-pick`}>1. Scegli la cartella</h2>
                    <p>MediFlow legge i file su questo Mac, nei propri processi locali. In questa fase non salva nulla e non invia contenuti a servizi esterni.</p>
                    <p className={styles.muted}>PDF nativi e scansioni, immagini, documenti Office e testo vengono letti; buste firmate .p7m, archivi e messaggi di posta si conservano senza estrarne il contenuto.</p>
                    <div className={styles.actions}>
                        <button type="button" className="mf-button-secondary" disabled={Boolean(busy)} onClick={() => folderInput.current?.click()}>Scegli cartella</button>
                        <button type="button" className="mf-button-secondary" disabled={Boolean(busy)} onClick={() => filesInput.current?.click()}>Scegli file</button>
                        <input ref={folderInput} type="file" hidden multiple data-testid="dossier-folder"
                            {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(event) => { const list = event.currentTarget.files; void readSelection(list); event.currentTarget.value = ''; }} />
                        <input ref={filesInput} type="file" hidden multiple data-testid="dossier-files"
                            onChange={(event) => { const list = event.currentTarget.files; void readSelection(list); event.currentTarget.value = ''; }} />
                    </div>
                </section>
                {busy ? <p role="status" aria-live="polite">{busy}</p> : null}
                {notice ? <p className={styles.notice} role="alert">{notice}</p> : null}
                {groups.length ? (
                    <section className={styles.section} aria-labelledby={`${ids}-groups`}>
                        <h2 id={`${ids}-groups`}>2. Collega le fonti alle schede</h2>
                        <p className={styles.muted}>Il nome della cartella non sceglie il paziente. Un codice fiscale valido è un indizio, non una prova: conferma tu ogni collegamento.</p>
                        <div className={styles.actions}>
                            <Link className="mf-button-secondary" href="/patients/new" target="_blank" rel="noopener">Crea una nuova scheda</Link>
                            <button type="button" className="mf-button-secondary" onClick={() => { void refreshPatients(); }}>Aggiorna elenco schede</button>
                        </div>
                        {groups.map((group) => {
                            const linked = links[group.key] ?? '';
                            const identity = evaluateDraftGroupIdentity(group, patients, linked || null);
                            const ready = group.sources.filter((source) => source.status === 'ready').length;
                            return (
                                <article key={group.key} className={styles.section} data-testid="dossier-group" data-identity={identity.status}>
                                    <h3>Cartella <PrivacyBlur>{group.key === '.' ? 'principale' : group.key}</PrivacyBlur> · {formatCountLabel(group.sources.length, 'fonte', 'fonti')}</h3>
                                    <table className={styles.table} role="table">
                                        <caption>Inventario: ogni file selezionato ha uno stato.</caption>
                                        <thead><tr><th scope="col">N.</th><th scope="col">File</th><th scope="col">Lettura</th><th scope="col">Esito</th></tr></thead>
                                        <tbody>{group.sources.map((source, index) => {
                                            const outcome = outcomes[source.key];
                                            const patientCodes = source.taxCodes.filter((code) => code.role === 'patient_cf' && code.checksumValid).map((code) => code.value);
                                            return <tr key={source.key} role="row" data-testid="dossier-source" data-source-status={source.status}>
                                                <td role="cell" data-label="N.">{index + 1}</td>
                                                <td role="cell" data-label="File"><PrivacyBlur>{source.relativePath}</PrivacyBlur>
                                                    <small className={styles.muted}>{source.classification.reason}</small></td>
                                                <td role="cell" data-label="Lettura">{describeExtraction(source)}
                                                    <small>{source.documentDate ? `Data: ${source.documentDate.value}` : 'Nessuna data esplicita'}</small>
                                                    <small>{patientCodes.length ? <>CF paziente: <PrivacyBlur>{patientCodes.join(', ')}</PrivacyBlur></> : 'Nessun CF paziente leggibile'}</small>
                                                    <small>{formatCountLabel(source.facts.length, 'proposta', 'proposte')}</small></td>
                                                <td role="cell" data-label="Esito">
                                                    {outcome ? <strong data-testid="dossier-acquire-outcome">{ACQUIRE_LABEL[outcome.status === 'failed' || outcome.status === 'skipped' ? outcome.reason : outcome.status]}</strong>
                                                        : source.status === 'duplicate_in_selection' ? ACQUIRE_LABEL.duplicate_in_selection
                                                        : source.status === 'unreadable' ? ACQUIRE_LABEL.unreadable : null}
                                                    {measured[source.key] ? <small>Spazio misurato: originale {measured[source.key].original} byte cifrati, testo e artefatto {measured[source.key].artifact} byte cifrati</small> : null}
                                                    {source.status === 'ready' || source.status === 'excluded' ? <label className={styles.consent}>
                                                        <input type="checkbox" checked={source.status === 'excluded'} disabled={Boolean(busy)}
                                                            onChange={(event) => setExcluded(group.key, source.key, event.currentTarget.checked)} />
                                                        <span>Escludi questa fonte</span></label> : null}
                                                </td>
                                            </tr>;
                                        })}</tbody>
                                    </table>
                                    <p className={identity.blocking ? styles.notice : undefined} data-testid="dossier-identity" role={identity.blocking ? 'alert' : undefined}>{identity.message}</p>
                                    <div className={styles.fileLabel}>
                                        <label htmlFor={`${ids}-${group.key}-patient`}>Scheda di destinazione</label>
                                        <select id={`${ids}-${group.key}-patient`} value={linked} disabled={Boolean(busy)}
                                            onChange={(event) => { const value = event.currentTarget.value; setLinks((current) => ({ ...current, [group.key]: value })); setConfirmations((current) => ({ ...current, [group.key]: false })); }}>
                                            <option value="">Scegli una scheda</option>
                                            {patients.map((patient) => <option key={patient.id} value={patient.id}>{patientLabel(patient)}</option>)}
                                        </select>
                                    </div>
                                    <label className={styles.consent}>
                                        <input type="checkbox" checked={confirmations[group.key] === true} disabled={!linked || identity.blocking || Boolean(busy)}
                                            onChange={(event) => { const checked = event.currentTarget.checked; setConfirmations((current) => ({ ...current, [group.key]: checked })); }} />
                                        <span>Ho controllato le fonti e confermo che appartengono alla scheda scelta.</span>
                                    </label>
                                    <div className={styles.actions}>
                                        <button type="button" className={styles.primary} disabled={!linked || identity.blocking || !confirmations[group.key] || !ready || Boolean(busy)}
                                            onClick={() => { void acquire(group); }}>Salva {formatCountLabel(ready, 'originale', 'originali')} nella scheda</button>
                                    </div>
                                </article>
                            );
                        })}
                    </section>
                ) : null}
                <section className={styles.section} aria-labelledby={`${ids}-dossier`}>
                    <h2 id={`${ids}-dossier`}>3. Rivedi e applica il dossier</h2>
                    <p className={styles.muted}>Il dossier si rilegge dalla scheda: puoi chiudere la pagina e riprendere. Le proposte non diventano dati finché non le accetti e applichi.</p>
                    <div className={styles.fileLabel}>
                        <label htmlFor={`${ids}-dossier-patient`}>Scheda</label>
                        <select id={`${ids}-dossier-patient`} value={dossierPatientId} disabled={Boolean(busy)}
                            onChange={(event) => { const value = event.currentTarget.value; setDossierPatientId(value); void loadDossier(value); }}>
                            <option value="">Scegli una scheda</option>
                            {patients.map((patient) => <option key={patient.id} value={patient.id}>{patientLabel(patient)}</option>)}
                        </select>
                    </div>
                    {view ? <DossierReview view={view} busy={Boolean(busy)} ports={ports} operation={operation} setBusy={setBusy} setNotice={setNotice}
                        reload={() => loadDossier(view.patient.id)} measured={Object.values(measured)} /> : null}
                </section>
            </div>
        </Kree8WorkspaceShell>
    );
}

type ReviewProps = {
    view: DossierPatientView; busy: boolean; ports: ReturnType<typeof createDossierPorts>;
    operation: () => { signal: AbortSignal; isCurrent: () => boolean };
    setBusy: (value: string | null) => void; setNotice: (value: string | null) => void; reload: () => Promise<void>;
    measured: Array<{ original: number; artifact: number }>;
};

function DossierReview({ view, busy, ports, operation, setBusy, setNotice, reload, measured }: ReviewProps) {
    const [results, setResults] = useState<Record<string, DossierApplyResult>>({});
    const receipt = useMemo(() => {
        const value = buildDossierReceipt(view.documents.map((document) => ({ record: document.record, coverage: document.coverage })), new Date());
        return { ...value, measuredStoredBytes: { originals: measured.reduce((sum, item) => sum + item.original, 0), artifacts: measured.reduce((sum, item) => sum + item.artifact, 0) } };
    }, [view, measured]);
    const receiptUrl = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(receipt, null, 2))}`;
    if (!view.documents.length) {
        return <p role="status" data-testid="dossier-empty">Nessun documento acquisito come dossier per questa scheda{view.invalidDocuments ? `; ${view.invalidDocuments} con record non leggibile` : ''}.</p>;
    }
    const save = async (document: DossierDocumentView, change: (record: DossierRecord) => DossierRecord) => {
        const op = operation();
        setBusy('Salvataggio della revisione…');
        try {
            await saveDossierReview(ports, { patientId: view.patient.id, attachmentId: document.attachment.id, expected: document.attachment.currentness!, ...op, change });
            if (op.isCurrent()) await reload();
        } catch (error) {
            if (op.isCurrent()) setNotice(error instanceof DossierStaleError ? error.message : error instanceof Error ? error.message : 'Revisione non salvata.');
        } finally { if (op.isCurrent()) setBusy(null); }
    };
    const apply = async (document: DossierDocumentView) => {
        const op = operation();
        setBusy('Scrittura nella scheda e rilettura…');
        try {
            const result = await applyDossierDocument(ports, { patientId: view.patient.id, attachmentId: document.attachment.id, expected: document.attachment.currentness!, ...op });
            if (!op.isCurrent()) return;
            setResults((current) => ({ ...current, [document.attachment.id]: result }));
            await reload();
        } catch (error) {
            if (op.isCurrent()) setNotice(error instanceof DossierAbortedError ? `${error.message} Rileggi il dossier: le scritture già confermate restano registrate.` : 'Applicazione interrotta. Rileggi il dossier prima di riprovare.');
        } finally { if (op.isCurrent()) setBusy(null); }
    };
    const complete = view.documents.filter((document) => document.coverage.complete).length;
    return <>
        <p data-testid="dossier-summary"><strong>{complete} di {formatCountLabel(view.documents.length, 'documento', 'documenti')} completi.</strong> Un documento è completo solo con originale riletto, testo verificato, ogni proposta decisa, il residuo rivisto e le scritture confermate.</p>
        {view.invalidDocuments ? <p className={styles.notice}>{formatCountLabel(view.invalidDocuments, 'documento ha', 'documenti hanno')} un record dossier non leggibile e non {view.invalidDocuments === 1 ? 'viene' : 'vengono'} modificati.</p> : null}
        {view.documents.map((document) => <DossierDocument key={document.attachment.id} document={document} view={view} busy={busy}
            result={results[document.attachment.id]} onSave={(change) => save(document, change)} onApply={() => apply(document)} />)}
        <details className={styles.disclosure}>
            <summary>Ricevuta aggregata del dossier</summary>
            <p className={styles.muted}>Solo conteggi: nessun nome, testo, codice o identificativo. Gli spazi misurati riguardano gli originali salvati in questa sessione.</p>
            <dl data-testid="dossier-receipt">
                <dt>Fonti</dt><dd>{receipt.sources}</dd><dt>Originali riletti identici</dt><dd>{receipt.preservedVerified}</dd>
                <dt>Testo estratto</dt><dd>{receipt.extracted}</dd><dt>Estrazione non riuscita</dt><dd>{receipt.extractionFailed}</dd>
                <dt>Conservati senza estrazione</dt><dd>{receipt.notExtracted}</dd><dt>Completi</dt><dd>{receipt.complete}</dd>
                <dt>Fatti accettati / scritti</dt><dd>{receipt.factsAccepted} / {receipt.factsApplied}</dd>
            </dl>
            <a className="mf-button-secondary" href={receiptUrl} download="mediflow-ricevuta-dossier.json">Scarica ricevuta</a>
        </details>
    </>;
}

function DossierDocument({ document, view, busy, result, onSave, onApply }: {
    document: DossierDocumentView; view: DossierPatientView; busy: boolean; result?: DossierApplyResult;
    onSave: (change: (record: DossierRecord) => DossierRecord) => Promise<void>; onApply: () => Promise<void>;
}) {
    const ids = useId();
    const [draft, setDraft] = useState<DossierRecord>(document.record);
    const [newKind, setNewKind] = useState<DossierFactKind>('diagnosis');
    useEffect(() => { setDraft(document.record); }, [document.record]);
    const dirty = JSON.stringify(draft) !== JSON.stringify(document.record);
    const record = document.record;
    const written = (fact: DossierFact) => { const outcome = latestAppliedOutcome(record, fact.factId)?.outcome; return outcome === 'applied' || outcome === 'already_present'; };
    const updateFact = (factId: string, change: (fact: DossierFact) => DossierFact) =>
        setDraft((current) => ({ ...current, facts: current.facts.map((fact) => fact.factId === factId ? change(fact) : fact) }));
    const acceptedReady = record.facts.filter((fact) => fact.decision === 'accepted' && !written(fact) && !dossierFactBlockers(fact, { exemptionCodes: view.exemptionCodes }).length).length;
    const units = record.extraction.state === 'extracted' ? record.extraction.units : [];
    return (
        <article className={styles.section} data-testid="dossier-document" data-complete={document.coverage.complete ? 'true' : 'false'}>
            <h3><PrivacyBlur>{record.source.fileName}</PrivacyBlur> · {record.documentDate ? record.documentDate.value : 'data non indicata'}</h3>
            <p className={styles.muted}>{describeExtraction(record)} · originale {record.preservation.state === 'verified' ? 'riletto identico' : record.preservation.state === 'mismatch' ? 'diverso alla rilettura' : 'da rileggere'}
                {record.preservation.reusedExisting ? ' · già presente in MediFlow' : ''}</p>
            {document.coverage.gaps.length ? <ul data-testid="dossier-gaps">{document.coverage.gaps.map((gap) => <li key={gap}>{DOSSIER_GAP_LABELS[gap]}</li>)}</ul>
                : <p data-testid="dossier-gaps"><strong>Completo.</strong></p>}
            {document.text !== null ? <details className={styles.disclosure}>
                <summary>Testo completo{document.textVerified ? '' : ' (non verificato)'}</summary>
                <dl>{units.map((unit) => <div key={unit.index}><dt>{unit.kind === 'page' ? `Pagina ${unit.index}` : 'Documento'}</dt>
                    <dd><PrivacyBlur>{unitText(document.text!, unit)}</PrivacyBlur></dd></div>)}</dl>
            </details> : <p className={styles.muted}>Nessun testo conservato: consulta l’originale nella sezione Documenti della scheda e aggiungi qui ciò che serve.</p>}
            <table className={styles.table} role="table">
                <caption>Proposte e informazioni aggiunte. Il medico decide ciascuna.</caption>
                <thead><tr><th scope="col">Tipo</th><th scope="col">Contenuto</th><th scope="col">Confronto</th><th scope="col">Decisione</th></tr></thead>
                <tbody>{draft.facts.map((fact) => {
                    const assessment = view.assessments.get(dossierFactRef(document.attachment.id, fact.factId));
                    const blockers = dossierFactBlockers(fact, { exemptionCodes: view.exemptionCodes });
                    const applied = latestAppliedOutcome(record, fact.factId);
                    const locked = written(fact) || busy;
                    return <tr key={fact.factId} role="row" data-testid="dossier-fact" data-kind={fact.kind}>
                        <td role="cell" data-label="Tipo">{DOSSIER_FACT_KIND_LABELS[fact.kind]}<small className={styles.muted}>{fact.origin === 'manual' ? 'Aggiunta dal medico' : 'Proposta del parser locale'}</small></td>
                        <td role="cell" data-label="Contenuto">
                            {fact.evidence ? <small>Evidenza, unità {fact.evidence.unit}: <PrivacyBlur>{fact.evidence.excerpt}</PrivacyBlur></small> : null}
                            {fact.values.textSource === 'document' ? <small>Testo: il testo completo del documento, conservato sopra.</small> : null}
                            {FIELDS[fact.kind].filter((field) => !(field.name === 'text' && fact.values.textSource === 'document')).map((field) => <FactField key={field.name} spec={field} value={fact.values[field.name] ?? ''} disabled={locked}
                                id={`${ids}-${fact.factId}-${field.name}`} onChange={(value) => updateFact(fact.factId, (item) => ({ ...item, values: { ...item.values, [field.name]: value } }))} />)}
                            {fact.negated || fact.origin !== 'manual' ? <label className={styles.consent}>
                                <input type="checkbox" checked={fact.negated} disabled={locked} onChange={(event) => { const negated = event.currentTarget.checked; updateFact(fact.factId, (item) => ({ ...item, negated })); }} />
                                <span>Il testo nega questa informazione</span></label> : null}
                            {fact.decision === 'accepted' && blockers.length ? <ul>{blockers.map((item) => <li key={item}>{item}</li>)}</ul> : null}
                        </td>
                        <td role="cell" data-label="Confronto">{assessment ? <><strong>{ASSESSMENT_LABEL[assessment.status]}</strong><small>{assessment.detail}</small></> : null}
                            {applied ? <small data-testid="dossier-applied-outcome">Ultima scrittura: {applied.outcome}{applied.detail ? `, ${applied.detail}` : ''}</small> : null}</td>
                        <td role="cell" data-label="Decisione">
                            <label htmlFor={`${ids}-${fact.factId}-decision`} className={styles.muted}>Decisione</label>
                            <select id={`${ids}-${fact.factId}-decision`} value={fact.decision} disabled={locked}
                                onChange={(event) => { const decision = event.currentTarget.value as DossierFact['decision']; updateFact(fact.factId, (item) => ({ ...item, decision })); }}>
                                <option value="pending">Da decidere</option><option value="accepted">Accetta</option>
                                <option value="rejected">Rifiuta</option><option value="already_present">Già in scheda, non scrivere</option>
                            </select>
                        </td>
                    </tr>;
                })}</tbody>
            </table>
            <div className={styles.actions}>
                <label htmlFor={`${ids}-new-kind`}>Aggiungi un’informazione omessa</label>
                <select id={`${ids}-new-kind`} value={newKind} disabled={busy} onChange={(event) => setNewKind(event.currentTarget.value as DossierFactKind)}>
                    {(Object.keys(DOSSIER_FACT_KIND_LABELS) as DossierFactKind[]).map((kind) => <option key={kind} value={kind}>{DOSSIER_FACT_KIND_LABELS[kind]}</option>)}
                </select>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => setDraft((current) => ({ ...current,
                    facts: [...current.facts, createManualDossierFact(newKind, { ...Object.fromEntries(FIELDS[newKind].map((field) => [field.name, ''])), ...DEFAULT_VALUES[newKind] }, crypto.randomUUID())] }))}>Aggiungi</button>
            </div>
            <label className={styles.consent}>
                <input type="checkbox" checked={draft.residualReview.state === 'acknowledged'} disabled={busy}
                    onChange={(event) => { const checked = event.currentTarget.checked; setDraft((current) => ({ ...current, residualReview: checked ? { state: 'acknowledged', at: new Date().toISOString() } : { state: 'pending' } })); }} />
                <span>Ho letto il testo e le pagine non lette: ciò che non è strutturato resta nel documento e nel testo conservato.</span>
            </label>
            <div className={styles.actions}>
                <button type="button" className={styles.secondary} disabled={!dirty || busy}
                    onClick={() => { void onSave((fresh) => ({ ...fresh, facts: draft.facts, residualReview: draft.residualReview, documentDate: draft.documentDate })); }}>Salva revisione</button>
                <button type="button" className={styles.primary} disabled={dirty || busy || acceptedReady === 0} onClick={() => { void onApply(); }}>
                    Applica {formatCountLabel(acceptedReady, 'fatto accettato', 'fatti accettati')}
                </button>
            </div>
            {dirty ? <p className={styles.muted}>Salva la revisione prima di applicare.</p> : null}
            {result ? <p role="status" data-testid="dossier-apply-result" className={result.partial ? styles.notice : undefined}>
                {result.partial ? 'Applicazione parziale: ' : 'Applicazione completata: '}
                {formatCountLabel(result.outcomes.filter((entry) => entry.outcome === 'applied' || entry.outcome === 'already_present').length, 'scrittura confermata', 'scritture confermate')} su {formatCountLabel(result.outcomes.length, 'tentata', 'tentate')}
                {result.stopped ? `; interrotta (${result.stopped === 'stale' ? 'documento cambiato' : result.stopped === 'identity' ? 'identità da risolvere' : result.stopped === 'registry' ? 'registro non aggiornato' : 'sessione'}). Riprendi: le scritture confermate non vengono ripetute.` : '.'}
            </p> : null}
        </article>
    );
}

function FactField({ spec, value, disabled, id, onChange }: { spec: FieldSpec; value: string; disabled: boolean; id: string; onChange: (value: string) => void }) {
    return <div className={styles.fileLabel}>
        <label htmlFor={id}>{spec.label}</label>
        {spec.type === 'textarea' ? <textarea id={id} value={value} disabled={disabled} rows={4} onChange={(event) => onChange(event.currentTarget.value)} />
            : spec.type === 'select' ? <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)}>
                {spec.options!.map(([option, label]) => <option key={option} value={option}>{label}</option>)}</select>
            : <input id={id} type={spec.type === 'date' ? 'date' : 'text'} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} />}
    </div>;
}
