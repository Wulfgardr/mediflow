'use client';

/*
 * Dossier da cartella (WUL-804, ADR 0175). Superficie Web locale, con la chiave nel
 * client. Ogni scrittura parte da un'azione esplicita del medico e passa da
 * lib/document-dossier-session.ts sui writer ordinari. L'app non chiama modelli:
 * un'estrazione preparata (ADR 0176) è un file scelto dal medico, verificato sul testo locale.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Kree8WorkspaceShell } from '@/components/kree8/kree8-workspace-shell';
import PrivacyBlur from '@/components/privacy-blur';
import { useSecurity } from '@/components/security-provider';
import PatientDocumentCreate from '@/components/patient-document-create';
import { proposeIdentityFields } from '@/lib/domain/documents/dossier-sections';
import { db } from '@/lib/db';
import { createDossierPorts } from '@/lib/document-dossier-ports';
import {
    DossierAbortedError, DossierIdentityBlocked, DossierStaleError, DossierWriteInFlight, acceptVerifiedAndApply, acquireDossierGroup, applyDossierDocument, buildDossierInventory,
    evaluateDraftGroupIdentity, loadPatientDossier, retryDossierExtraction, saveDossierReview,
    type DossierAcquireOutcome, type DossierApplyResult, type DossierBulkResult, type DossierDocumentView, type DossierDraftGroup, type DossierInputFile,
    type DossierPatient, type DossierPatientView,
} from '@/lib/document-dossier-session';
import {
    DOSSIER_FACT_KIND_LABELS, DOSSIER_GAP_LABELS, buildDossierReceipt, createManualDossierFact, dossierFactBlockers, dossierFactRef,
    latestAppliedOutcome, unitText,
    type DossierFact, type DossierFactKind, type DossierRecord,
} from '@/lib/domain/documents/dossier-import';
import {
    DOSSIER_PREPARED_MAX_BYTES, PREPARED_CHECK_LABELS, parsePreparedExtraction, type PreparedCheck, type PreparedExtraction,
} from '@/lib/domain/documents/dossier-prepared';
import { formatCountLabel } from '@/lib/format-count';
import styles from './patient-bulk-import-panel.module.css';

type FieldSpec = { name: string; label: string; type?: 'date' | 'textarea' | 'select'; options?: Array<[string, string]> };
const TEXT_FIELDS: FieldSpec[] = [{ name: 'title', label: 'Titolo' }, { name: 'date', label: 'Data', type: 'date' }, { name: 'text', label: 'Testo', type: 'textarea' }];
const FIELDS: Record<DossierFactKind, FieldSpec[]> = {
    diagnosis: [{ name: 'description', label: 'Descrizione' }, { name: 'code', label: 'Codice (solo se scritto nel documento)' },
        { name: 'system', label: 'Sistema', type: 'select', options: [['', 'Nessun codice'], ['ICD-9', 'ICD-9'], ['ICD-10', 'ICD-10'], ['ICD-11', 'ICD-11']] },
        { name: 'date', label: 'Data', type: 'date' }],
    exemption: [{ name: 'code', label: 'Codice di esenzione' }],
    therapy: [{ name: 'drugName', label: 'Farmaco' }, { name: 'activePrinciple', label: 'Principio attivo' }, { name: 'dosage', label: 'Posologia (dose, frequenza, via, durata)' },
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
        { name: 'status', label: 'Stato documentato', type: 'select', options: [['', 'Non indicato'], ['prescribed', 'Prescritto'], ['submitted', 'Presentato'], ['authorized', 'Autorizzato'], ['delivered', 'Consegnato'], ['tested', 'Collaudato']] },
        { name: 'isoCode', label: 'Codice ISO (solo se scritto)' }, { name: 'prescribedAt', label: 'Data', type: 'date' }],
    reported_scale: [{ name: 'scaleName', label: 'Scala' }, { name: 'scaleTotal', label: 'Totale trascritto' }, { name: 'scaleMax', label: 'Massimo (se scritto)' },
        { name: 'date', label: 'Data', type: 'date' }, { name: 'text', label: 'Contesto', type: 'textarea' }],
    invalidity: [...TEXT_FIELDS, { name: 'percentage', label: 'Percentuale (se scritta)' }, { name: 'allowance', label: 'Indennità di accompagnamento (se scritta)' }],
    anamnesis: TEXT_FIELDS, assessment: TEXT_FIELDS, imaging_report: TEXT_FIELDS, care_context: TEXT_FIELDS, document_entry: TEXT_FIELDS,
};
const DEFAULT_VALUES: Partial<Record<DossierFactKind, Record<string, string>>> = {
    therapy: { status: 'completed' }, prosthetic: { status: 'prescribed' },
    anamnesis: { title: 'Anamnesi da documento' }, assessment: { title: 'Valutazione da documento' }, imaging_report: { title: 'Referto di imaging' },
    invalidity: { title: 'Invalidità da documento' }, care_context: { title: 'Contesto assistenziale da documento' },
};
/** Qualificatori letti nel testo: si mostrano accanto alla proposta e finiscono nella voce scritta. */
function qualifierNotes(fact: DossierFact): string[] {
    const v = fact.values;
    return [
        v.subject && v.subject !== 'paziente' ? `Riferito a: ${v.subject}` : '',
        v.temporality ? `Tempo: ${v.temporality}` : '',
        v.certainty ? 'Formulazione incerta nel documento' : '',
        v.sectionLabel ? `Sezione: ${v.sectionLabel}` : '',
        v.codeSource ? `Codice: ${v.codeSource}` : '',
        v.rowSource ? v.rowSource : '',
        fact.kind === 'reported_scale' ? 'Totale trascritto: non diventa una scala somministrata' : '',
        fact.kind === 'therapy' && v.status !== 'active' ? 'Resta storica finché non scegli «In corso»' : '',
        v.preparedCheck ? PREPARED_CHECK_LABELS[v.preparedCheck as PreparedCheck] ?? '' : '',
        v.preparedCoverage === 'partial' ? 'L’estrazione preparata non dichiara coperte tutte le pagine: il residuo resta da rivedere' : '',
        v.preparedNotes ?? '',
    ].filter(Boolean);
}

const EXTRACTION_LABEL: Record<string, string> = {
    unsupported_format: 'formato non leggibile', image_or_scan: 'OCR non riuscito su almeno una pagina', malformed_document: 'file danneggiato',
    encrypted_document: 'file protetto da password', resource_limit: 'oltre i limiti di estrazione', incomplete_document: 'documento incompleto',
    io_failure: 'errore di lettura locale', empty_extraction: 'nessun testo riconosciuto', unavailable: 'estrazione non disponibile',
};
const ACQUIRE_LABEL: Record<string, string> = {
    stored: 'Originale salvato e riletto identico', reused: 'Già in MediFlow: riusato, non duplicato',
    duplicate_in_selection: 'Copia identica di un altro file selezionato', excluded: 'Escluso da te', unreadable: 'Non leggibile dal browser',
    unsupported_format: 'Formato non ammesso',
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

const ORIGIN_LABEL: Record<DossierFact['origin'], string> = {
    manual: 'Aggiunta dal medico', prepared: 'Estrazione preparata', 'parser:lab': 'Parser locale: laboratorio', 'parser:exemption': 'Parser locale: esenzione',
    'parser:icd': 'Parser locale: codice ICD', 'parser:section': 'Parser locale: sezione', 'parser:scale': 'Parser locale: scala', 'parser:document': 'Parser locale: documento intero',
};

function groupTitle(key: string, sources: DossierDraftGroup['sources']): string {
    if (key.startsWith('cf:') || key.startsWith('nome:')) return `Paziente secondo l’estrazione preparata: ${sources.find((source) => source.prepared?.patientLabel)?.prepared?.patientLabel ?? key}`;
    return `Cartella ${key === '.' ? 'principale' : key}`;
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
    // Creazione di una scheda da un documento del gruppo: una sola alla volta, nessun dato nell'URL o nello storage.
    const [creating, setCreating] = useState<{ groupKey: string; sourceKey: string } | null>(null);
    const [dossierPatientId, setDossierPatientId] = useState(initialPatientId ?? '');
    const [view, setView] = useState<DossierPatientView | null>(null);
    // Estrazione preparata (ADR 0176): solo in memoria, mai nello storage del browser.
    const preparedInput = useRef<HTMLInputElement>(null);
    const [prepared, setPrepared] = useState<{ extraction: PreparedExtraction; warnings: string[]; fileName: string } | null>(null);
    const lastSelection = useRef<DossierInputFile[] | null>(null);

    useEffect(() => () => { generation.current += 1; }, []);
    useEffect(() => {
        const signal = db.getSessionReadSignal();
        // Al blocco della sessione si dimenticano anche estrazione e selezione: niente dati clinici in memoria.
        const retire = () => { generation.current += 1; setGroups([]); setView(null); setBusy(null); setPrepared(null); lastSelection.current = null; };
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
        await readFiles(inputFiles(list), prepared?.extraction ?? null);
    };

    const loadPrepared = async (list: FileList | null) => {
        const file = list?.[0];
        if (!file) return;
        if (file.size > DOSSIER_PREPARED_MAX_BYTES) { setNotice('Estrazione preparata oltre il limite di 20 MiB.'); return; }
        let parsed: ReturnType<typeof parsePreparedExtraction>;
        try { parsed = parsePreparedExtraction(await file.text()); } catch { setNotice('Estrazione preparata non leggibile.'); return; }
        if (!parsed.ok) { setNotice(parsed.error); return; }
        setPrepared({ extraction: parsed.value, warnings: parsed.warnings, fileName: file.name });
        // Una cartella già letta si rilegge con le nuove proposte: nessun dato salvato nel frattempo.
        if (lastSelection.current) await readFiles(lastSelection.current, parsed.value);
    };

    const readFiles = async (files: DossierInputFile[], extraction: PreparedExtraction | null) => {
        lastSelection.current = files;
        const op = operation();
        setGroups([]); setOutcomes({}); setMeasured({}); setNotice(null); setConfirmations({});
        setBusy(`Lettura locale di ${formatCountLabel(files.length, 'file', 'file')}…`);
        try {
            const next = await buildDossierInventory(ports, files, { ...op, prepared: extraction, onProgress: (done, total) => {
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
            source.key !== sourceKey || source.status === 'duplicate_in_selection' || source.status === 'unreadable' || source.status === 'unsupported_format' ? source
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
                    <p className={styles.muted}>Facoltativo: un’estrazione preparata (file .json della skill di importazione) propone per ogni documento identità, fatti clinici e una sintesi. MediFlow abbina i documenti per impronta dei byte e cerca ogni citazione nel proprio testo: ciò che non trova resta da decidere.</p>
                    <div className={styles.actions}>
                        <button type="button" className="mf-button-secondary" disabled={Boolean(busy)} onClick={() => preparedInput.current?.click()}>
                            {prepared ? 'Sostituisci estrazione preparata' : 'Carica estrazione preparata'}</button>
                        {prepared ? <button type="button" className="mf-button-secondary" disabled={Boolean(busy)}
                            onClick={() => { setPrepared(null); if (lastSelection.current) void readFiles(lastSelection.current, null); }}>Rimuovi estrazione</button> : null}
                        <input ref={preparedInput} type="file" hidden accept="application/json,.json" data-testid="dossier-prepared"
                            onChange={(event) => { const list = event.currentTarget.files; void loadPrepared(list); event.currentTarget.value = ''; }} />
                    </div>
                    {prepared ? <p role="status" data-testid="dossier-prepared-status">Estrazione preparata: {formatCountLabel(prepared.extraction.sources.length, 'documento', 'documenti')}
                        {prepared.extraction.preparedAt ? `, preparata il ${prepared.extraction.preparedAt.slice(0, 10)}` : ''}
                        {prepared.warnings.length ? `; ${formatCountLabel(prepared.warnings.length, 'voce ignorata', 'voci ignorate')}: ${prepared.warnings.slice(0, 3).join(' ')}` : '.'}</p> : null}
                </section>
                {busy ? <p role="status" aria-live="polite">{busy}</p> : null}
                {notice ? <p className={styles.notice} role="alert">{notice}</p> : null}
                {groups.length ? (
                    <section className={styles.section} aria-labelledby={`${ids}-groups`}>
                        <h2 id={`${ids}-groups`}>2. Collega le fonti alle schede</h2>
                        <p className={styles.muted}>Il nome della cartella non sceglie il paziente. Un codice fiscale valido è un indizio, non una prova: conferma tu ogni collegamento.</p>
                        <div className={styles.actions}>
                            <button type="button" className="mf-button-secondary" onClick={() => { void refreshPatients(); }}>Aggiorna elenco schede</button>
                        </div>
                        {groups.map((group) => {
                            const linked = links[group.key] ?? '';
                            const identity = evaluateDraftGroupIdentity(group, patients, linked || null);
                            const ready = group.sources.filter((source) => source.status === 'ready').length;
                            return (
                                <article key={group.key} className={styles.section} data-testid="dossier-group" data-group={group.key} data-identity={identity.status}>
                                    <h3><PrivacyBlur>{groupTitle(group.key, group.sources)}</PrivacyBlur> · {formatCountLabel(group.sources.length, 'fonte', 'fonti')}</h3>
                                    <table className={styles.table} role="table">
                                        <caption>Inventario: ogni file selezionato ha uno stato.</caption>
                                        <thead><tr><th scope="col">N.</th><th scope="col">File</th><th scope="col">Lettura</th><th scope="col">Esito</th></tr></thead>
                                        <tbody>{group.sources.map((source, index) => {
                                            const outcome = outcomes[source.key];
                                            const taxCodes = source.taxCodes.map((code) => `${code.value} (${!code.checksumValid ? 'controllo formale non valido'
                                                : code.role === 'professional_cf' && code.explicitProfessional && code.professionalLabelScope === 'same_line' ? 'professionista esplicito'
                                                    : code.role === 'patient_cf' ? 'paziente' : 'attribuzione da verificare'})`);
                                            return <tr key={source.key} role="row" data-testid="dossier-source" data-source-status={source.status}>
                                                <td role="cell" data-label="N.">{index + 1}</td>
                                                <td role="cell" data-label="File"><PrivacyBlur>{source.relativePath}</PrivacyBlur>
                                                    <small className={styles.muted}>{source.classification.reason}</small></td>
                                                <td role="cell" data-label="Lettura">{describeExtraction(source)}
                                                    <small>{source.documentDate ? `Data: ${source.documentDate.value}` : 'Nessuna data esplicita'}</small>
                                                    <small>{taxCodes.length ? <>CF letti: <PrivacyBlur>{taxCodes.join(', ')}</PrivacyBlur></> : 'Nessun CF leggibile'}</small>
                                                    <small>{formatCountLabel(source.facts.length, 'proposta', 'proposte')}</small>
                                                    {source.prepared ? <small data-testid="dossier-source-prepared">Estrazione preparata: {formatCountLabel(source.prepared.facts, 'proposta', 'proposte')}{source.prepared.patientLabel ? <>, paziente <PrivacyBlur>{source.prepared.patientLabel}</PrivacyBlur></> : ''}{source.prepared.notes.length ? `. ${source.prepared.notes.join(' ')}` : ''}</small>
                                                        : prepared && source.status === 'ready' ? <small className={styles.notice} data-testid="dossier-source-prepared">Assente dall’estrazione preparata: solo proposte del parser locale.</small> : null}</td>
                                                <td role="cell" data-label="Esito">
                                                    {outcome ? <strong data-testid="dossier-acquire-outcome">{ACQUIRE_LABEL[outcome.status === 'failed' || outcome.status === 'skipped' ? outcome.reason : outcome.status]}</strong>
                                                        : source.status === 'duplicate_in_selection' ? ACQUIRE_LABEL.duplicate_in_selection
                                                        : source.status === 'unreadable' || source.status === 'unsupported_format' ? ACQUIRE_LABEL[source.status] : null}
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
                                    <NewPatientFromDocument group={group} identityBlocking={identity.blocking} busy={Boolean(busy)}
                                        creating={creating?.groupKey === group.key ? creating.sourceKey : null}
                                        onStart={(sourceKey) => setCreating({ groupKey: group.key, sourceKey })}
                                        onCancel={() => setCreating(null)}
                                        onCreated={async (patientId) => {
                                            await refreshPatients();
                                            setLinks((current) => ({ ...current, [group.key]: patientId }));
                                            setConfirmations((current) => ({ ...current, [group.key]: false }));
                                            setNotice('Scheda creata dal documento. Conferma il collegamento e salva gli originali: il documento già allegato viene riusato, non duplicato.');
                                        }} />
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
                    {view ? <DossierReview key={view.patient.id} view={view} busy={Boolean(busy)} ports={ports} operation={operation} setBusy={setBusy} setNotice={setNotice}
                        reload={() => loadDossier(view.patient.id)} /> : null}
                </section>
            </div>
        </Kree8WorkspaceShell>
    );
}

type ReviewProps = {
    view: DossierPatientView; busy: boolean; ports: ReturnType<typeof createDossierPorts>;
    operation: () => { signal: AbortSignal; isCurrent: () => boolean };
    setBusy: (value: string | null) => void; setNotice: (value: string | null) => void; reload: () => Promise<void>;
};

function DossierReview({ view, busy, ports, operation, setBusy, setNotice, reload }: ReviewProps) {
    const [results, setResults] = useState<Record<string, DossierApplyResult>>({});
    const [bulkResult, setBulkResult] = useState<DossierBulkResult | null>(null);
    const [includeSummaries, setIncludeSummaries] = useState(false);
    const receipt = useMemo(() => {
        // Solo i documenti di questa scheda; le misure stanno nel record di ciascuna fonte.
        return buildDossierReceipt(view.documents.map((document) => ({ record: document.record, coverage: document.coverage,
            artifactCiphertextChars: document.artifactCiphertextChars })), new Date());
    }, [view]);
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
            if (op.isCurrent()) setNotice(error instanceof DossierStaleError || error instanceof DossierWriteInFlight ? error.message : error instanceof Error ? error.message : 'Revisione non salvata.');
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
    const retry = async (document: DossierDocumentView) => {
        const op = operation();
        setBusy('Nuova estrazione locale dall’originale conservato…');
        try {
            const outcome = await retryDossierExtraction(ports, { patientId: view.patient.id, attachmentId: document.attachment.id, expected: document.attachment.currentness!, ...op });
            if (!op.isCurrent()) return;
            setNotice(outcome === 'extracted' ? 'Testo letto: le nuove proposte sono da decidere; le decisioni precedenti restano.'
                : outcome === 'failed' ? 'Estrazione ancora non riuscita: il tentativo è registrato, l’originale resta conservato.'
                    : outcome === 'source_changed' ? 'L’originale riletto non coincide con la fonte registrata: nessuna estrazione.'
                        : outcome === 'stale' ? 'Il documento è cambiato: rileggi il dossier.' : 'Questo documento non si può estrarre di nuovo.');
            await reload();
        } catch (error) {
            if (op.isCurrent()) setNotice(error instanceof DossierAbortedError ? error.message : 'Nuova estrazione interrotta.');
        } finally { if (op.isCurrent()) setBusy(null); }
    };
    const bulk = async () => {
        const op = operation();
        setBusy('Accettazione del verificato e scrittura nella scheda…');
        try {
            const outcome = await acceptVerifiedAndApply(ports, { patientId: view.patient.id, includeSummaries, ...op });
            if (!op.isCurrent()) return;
            setBulkResult(outcome);
            await reload();
        } catch (error) {
            if (op.isCurrent()) setNotice(error instanceof DossierStaleError || error instanceof DossierAbortedError ? `${error.message} Rileggi il dossier: le scritture confermate restano registrate.`
                : 'Accettazione interrotta. Rileggi il dossier prima di riprovare: nulla viene ripetuto.');
        } finally { if (op.isCurrent()) setBusy(null); }
    };
    const complete = view.documents.filter((document) => document.coverage.complete).length;
    const withPrepared = view.documents.some((document) => document.record.facts.some((fact) => fact.origin === 'prepared'));
    return <>
        {withPrepared ? <div className={styles.section} data-testid="dossier-bulk-panel">
            <p className={styles.muted}>Per i documenti con estrazione preparata: accetta le proposte la cui citazione e i cui valori si ritrovano nel testo del documento, nuove rispetto alla scheda e complete, e le scrive. Rifiuta le proposte del parser dello stesso tipo che sostituiscono. Conflitti, negazioni, riformulazioni e citazioni non trovate restano a te.</p>
            <label className={styles.consent}>
                <input type="checkbox" checked={includeSummaries} disabled={busy} data-testid="dossier-bulk-summaries" onChange={(event) => setIncludeSummaries(event.currentTarget.checked)} />
                <span>Ho letto le sintesi dei documenti e accetto anche quelle: sono testo riassunto, non verificabile parola per parola. Con la sintesi accettata, il residuo si considera rivisto solo se le pagine lette coincidono.</span>
            </label>
            <div className={styles.actions}>
                <button type="button" className={styles.primary} disabled={busy || complete === view.documents.length} data-testid="dossier-bulk" onClick={() => { void bulk(); }}>Accetta il verificato e applica</button>
            </div>
        </div> : null}
        {bulkResult ? <p role="status" data-testid="dossier-bulk-result">
            {formatCountLabel(bulkResult.accepted, 'proposta accettata', 'proposte accettate')}, {formatCountLabel(bulkResult.alreadyPresent, 'già presente', 'già presenti')}, {formatCountLabel(bulkResult.superseded, 'proposta del parser sostituita', 'proposte del parser sostituite')}; {formatCountLabel(bulkResult.leftPending, 'resta da decidere', 'restano da decidere')}.
            {' '}{formatCountLabel(bulkResult.applied.reduce((sum, item) => sum + item.outcomes.filter((entry) => entry.outcome === 'applied' || entry.outcome === 'already_present').length, 0), 'scrittura confermata', 'scritture confermate')}
            {bulkResult.applied.some((item) => item.partial) ? '; alcune applicazioni sono parziali: controlla i documenti segnati.' : '.'}</p> : null}
        <p data-testid="dossier-summary"><strong>{complete} di {formatCountLabel(view.documents.length, 'documento', 'documenti')} completi.</strong> Un documento è completo solo con originale riletto, testo verificato, ogni proposta decisa, il residuo rivisto e le scritture confermate.</p>
        {view.invalidDocuments ? <p className={styles.notice}>{formatCountLabel(view.invalidDocuments, 'documento ha', 'documenti hanno')} un record dossier non leggibile e non {view.invalidDocuments === 1 ? 'viene' : 'vengono'} modificati.</p> : null}
        {view.documents.map((document) => <DossierDocument key={`${document.attachment.id}:${document.attachment.currentness?.revision ?? 0}:${document.attachment.currentness?.freshnessEpoch ?? 0}`} document={document} view={view} busy={busy}
            result={results[document.attachment.id]} onSave={(change) => save(document, change)} onApply={() => apply(document)} onRetry={() => retry(document)} />)}
        <details className={styles.disclosure}>
            <summary>Ricevuta aggregata del dossier</summary>
            <p className={styles.muted}>Solo conteggi: nessun nome, testo, codice o identificativo. Gli spazi misurati riguardano gli originali salvati in questa sessione.</p>
            <dl data-testid="dossier-receipt">
                <dt>Fonti</dt><dd>{receipt.sources}</dd><dt>Originali riletti identici</dt><dd>{receipt.preservedVerified}</dd>
                <dt>Testo estratto</dt><dd>{receipt.extracted}</dd><dt>Estrazione non riuscita</dt><dd>{receipt.extractionFailed}</dd>
                <dt>Conservati senza estrazione</dt><dd>{receipt.notExtracted}</dd><dt>Completi</dt><dd>{receipt.complete}</dd>
                <dt>Fatti accettati / scritti</dt><dd>{receipt.factsAccepted} / {receipt.factsApplied}</dd>
                <dt>Originali cifrati misurati</dt><dd>{receipt.measuredStoredBytes.originals} caratteri{receipt.measuredStoredBytes.originalsUnmeasured
                    ? `; ${formatCountLabel(receipt.measuredStoredBytes.originalsUnmeasured, 'originale non misurato', 'originali non misurati')} (già presenti in MediFlow)` : ''}</dd>
                <dt>Artefatti cifrati (testo, proposte, registro)</dt><dd>{receipt.measuredStoredBytes.artifacts} caratteri{receipt.measuredStoredBytes.artifactsUnmeasured
                    ? `; ${formatCountLabel(receipt.measuredStoredBytes.artifactsUnmeasured, 'non misurato', 'non misurati')}` : ''}</dd>
            </dl>
            <p className={styles.muted}>Misure della serializzazione cifrata del client: non includono l’ingombro di SQLite, indici o backup.</p>
            <a className="mf-button-secondary" href={receiptUrl} download="mediflow-ricevuta-dossier.json">Scarica ricevuta</a>
        </details>
    </>;
}

function DossierDocument({ document, view, busy, result, onSave, onApply, onRetry }: {
    document: DossierDocumentView; view: DossierPatientView; busy: boolean; result?: DossierApplyResult;
    onSave: (change: (record: DossierRecord) => DossierRecord) => Promise<void>; onApply: () => Promise<void>; onRetry: () => Promise<void>;
}) {
    const ids = useId();
    const [draft, setDraft] = useState<DossierRecord>(document.record);
    const [newKind, setNewKind] = useState<DossierFactKind>('diagnosis');
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
            <p className={styles.muted} data-testid="dossier-storage">{record.storage
                ? `Originale cifrato: ${record.storage.originalCiphertextChars} caratteri, misurati all’acquisizione.` : 'Originale già presente in MediFlow: spazio non misurato da questo flusso.'}
                {document.artifactCiphertextChars !== null ? ` Artefatto cifrato: ${document.artifactCiphertextChars} caratteri.` : ' Artefatto non misurato.'}</p>
            {record.pendingWrites?.length ? <p className={styles.notice} role="status">{formatCountLabel(record.pendingWrites.length, 'scrittura ha', 'scritture hanno')} esito da verificare: applica di nuovo per rileggerle, senza duplicare.</p> : null}
            {record.extraction.state === 'failed' ? <div className={styles.actions}>
                <span>{record.extractionAttempts?.length ? formatCountLabel(record.extractionAttempts.length, 'tentativo registrato', 'tentativi registrati') : ''}</span>
                <button type="button" className={styles.secondary} disabled={busy || dirty} onClick={() => { void onRetry(); }}>Riprova l’estrazione dall’originale</button>
            </div> : null}
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
                    const locked = written(fact) || busy || Boolean(record.pendingWrites?.some((claim) => claim.factId === fact.factId));
                    return <tr key={fact.factId} role="row" data-testid="dossier-fact" data-kind={fact.kind} data-origin={fact.origin} data-decision={fact.decision}>
                        <td role="cell" data-label="Tipo">{DOSSIER_FACT_KIND_LABELS[fact.kind]}<small className={styles.muted}>{ORIGIN_LABEL[fact.origin] ?? fact.origin}</small></td>
                        <td role="cell" data-label="Contenuto">
                            {fact.evidence ? <small>Evidenza, unità {fact.evidence.unit}: <PrivacyBlur>{fact.evidence.excerpt}</PrivacyBlur></small> : null}
                            {fact.values.textSource === 'document' ? <small>Testo: il testo completo del documento, conservato sopra.</small> : null}
                            {qualifierNotes(fact).map((note) => <small key={note} data-testid="dossier-qualifier">{note}</small>)}
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
            {document.residual.length ? <details className={styles.disclosure} data-testid="dossier-residual">
                <summary>Testo non strutturato: {formatCountLabel(document.residual.length, 'segmento', 'segmenti')} senza proposta</summary>
                <p className={styles.muted}>Questi passaggi restano nel testo conservato. Aggiungi un’informazione se contengono dati utili, poi conferma il residuo.</p>
                <dl>{document.residual.map((segment) => <div key={`${segment.unit}-${segment.start}`}><dt>Unità {segment.unit}</dt>
                    <dd><PrivacyBlur>{segment.excerpt}</PrivacyBlur></dd></div>)}</dl>
            </details> : null}
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
                <button type="button" className={styles.primary} disabled={dirty || busy || acceptedReady === 0 || document.coverage.gaps.includes('identity_conflict')} onClick={() => { void onApply(); }}>
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

/** Nuova scheda da un documento PDF del gruppo, con il comando documentale esistente (stage, revisione, PIN). */
function NewPatientFromDocument({ group, identityBlocking, busy, creating, onStart, onCancel, onCreated }: {
    group: DossierDraftGroup; identityBlocking: boolean; busy: boolean; creating: string | null;
    onStart: (sourceKey: string) => void; onCancel: () => void; onCreated: (patientId: string) => Promise<void>;
}) {
    const ids = useId();
    const candidates = group.sources.filter((source) => source.status === 'ready' && source.classification.kind === 'pdf' && source.size <= 10 * 1024 * 1024);
    const [choice, setChoice] = useState(candidates[0]?.key ?? '');
    const [prepared, setPrepared] = useState<{ key: string; file: File } | null>(null);
    const source = group.sources.find((item) => item.key === creating);
    const file = prepared && prepared.key === creating ? prepared.file : null;
    useEffect(() => {
        let live = true;
        if (!source) return;
        void source.file.read().then((bytes) => {
            // Il comando riceve gli stessi byte già inventariati: l'allegato creato verrà riconosciuto e riusato.
            if (live) setPrepared({ key: source.key, file: new File([new Uint8Array(bytes)], source.fileName, { type: 'application/pdf' }) });
        }).catch(() => undefined);
        return () => { live = false; };
    }, [source]);
    if (identityBlocking || !candidates.length) return null;
    const patientCode = source?.taxCodes.find((code) => code.role === 'patient_cf' && code.checksumValid)?.value ?? null;
    if (!creating) {
        return <div className={styles.actions} data-testid="dossier-new-patient">
            <label htmlFor={`${ids}-source`}>Nessuna scheda adatta? Crea la scheda da</label>
            <select id={`${ids}-source`} value={choice} disabled={busy} onChange={(event) => setChoice(event.currentTarget.value)}>
                {candidates.map((item) => <option key={item.key} value={item.key}>{item.fileName}</option>)}
            </select>
            <button type="button" className={styles.secondary} disabled={busy || !choice} onClick={() => onStart(choice)}>Crea la scheda da questo documento</button>
        </div>;
    }
    return <div className={styles.section} data-testid="dossier-new-patient">
        {file && source ? <PatientDocumentCreate dossier={{ file, proposals: withPreparedIdentity(proposeIdentityFields(source.text ?? '', patientCode), source),
            onCreated: ({ patientId }) => { void onCreated(patientId); } }} /> : <p role="status">Preparazione del documento…</p>}
        <div className={styles.actions}><button type="button" className={styles.secondary} onClick={onCancel}>Chiudi la creazione</button></div>
    </div>;
}

/** Campi d'anagrafica dell'estrazione preparata dove il testo non ne propone: restano proposte, inserite solo con un gesto. */
function withPreparedIdentity(proposals: ReturnType<typeof proposeIdentityFields>, source: DossierDraftGroup['sources'][number]): ReturnType<typeof proposeIdentityFields> {
    const patient = source.prepared?.patient;
    if (!patient) return proposals;
    const have = new Set(proposals.map((proposal) => proposal.field));
    const extra = (['taxCode', 'lastName', 'firstName', 'birthDate'] as const)
        .filter((field) => !have.has(field) && patient[field])
        .map((field) => ({ field, value: patient[field]!, excerpt: `Dall’estrazione preparata: ${patient[field]}` }));
    return [...proposals, ...extra];
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
