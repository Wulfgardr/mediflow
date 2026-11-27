'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import PrivacyBlur from '@/components/privacy-blur';
import { db } from '@/lib/db';
import type { DossierBatchProposal } from '@/lib/dossier-batch-patients';
import { createDossierBatchPatient, dossierBatchReceipts, readDossierBatchOutcome, readDossierBatchScope, type DossierBatchOutcome } from '@/lib/dossier-batch-patient-client';
import { DOSSIER_BATCH_LIMIT, dossierBatchDigest, dossierBatchRowDigest, type DossierBatchIdentity, type DossierBatchRow } from '@/lib/patient-document-batch-contract';
import { requestPatientDocument } from '@/lib/patient-document-create-client';
import { confirmationPinError, isValidConfirmationPin } from '@/lib/security/pin-input';
import styles from './patient-bulk-import-panel.module.css';

const fields = [
    ['firstName', 'Nome'], ['lastName', 'Cognome'], ['taxCode', 'Codice fiscale'], ['birthDate', 'Data di nascita'],
] as const;

type Edit = { sourceKey: string; identity: DossierBatchIdentity; excluded: boolean };
type Row = DossierBatchRow & { proposal: DossierBatchProposal; excluded: boolean };
type Reviewed = { rows: Row[]; batchId: string; fingerprint: string; signature: string; scope: string };
type Outcome = { row: Row; result: DossierBatchOutcome };
const emptySnapshot = () => '';

function label(row: Row) {
    return [row.identity.firstName, row.identity.lastName].filter(Boolean).join(' ') || row.sourceName;
}

function resolveRow(proposal: DossierBatchProposal, edit: Edit | undefined): Row {
    const current = edit?.sourceKey === proposal.source.key ? edit : undefined;
    const segments = proposal.source.relativePath.split('/');
    const sourceName = segments.length > 2 ? segments.slice(1).join('/') : proposal.source.relativePath;
    return {
        proposal, excluded: current?.excluded ?? false,
        sourceName, sourceDigest: proposal.source.sha256,
        identity: current?.identity ?? proposal.identity,
    };
}

function submittedRow({ sourceName, sourceDigest, identity }: Row): DossierBatchRow {
    return { sourceName, sourceDigest, identity };
}

export default function DossierBatchPatients({ proposals, scope, revision, busy, onBusy, onCreated }: {
    proposals: readonly DossierBatchProposal[];
    scope: string | null;
    revision: number;
    busy: boolean;
    onBusy: (message: string | null) => void;
    onCreated: (links: Readonly<Record<string, string>>) => Promise<void>;
}) {
    const id = useId();
    const running = useRef(false);
    const [editing, setEditing] = useState(false);
    const [edits, setEdits] = useState<Record<string, Edit>>({});
    const [reviewed, setReviewed] = useState<Reviewed | null>(null);
    const [pin, setPin] = useState('');
    const [notice, setNotice] = useState('');
    const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
    const [recoveries, setRecoveries] = useState<Record<string, DossierBatchOutcome>>({});
    const [reading, setReading] = useState<string | null>(null);
    const stored = useSyncExternalStore(dossierBatchReceipts.subscribe, () => dossierBatchReceipts.snapshot(scope), emptySnapshot);
    const pending = stored ? stored.split(',') : [];
    const shownCommands = new Set(outcomes?.flatMap(({ result }) => result.kind === 'uncertain' ? [result.commandId] : []));
    const remaining = proposals.filter(proposal => !outcomes?.some(({ row, result }) =>
        result.kind === 'uncertain' && row.proposal.groupKey === proposal.groupKey));
    const rows = remaining.map(proposal => resolveRow(proposal, edits[proposal.groupKey]));
    const included = rows.filter(row => !row.excluded && !row.proposal.blocked);
    const signature = JSON.stringify([revision, rows.map(row => [row.proposal.groupKey, submittedRow(row), row.excluded, row.proposal.blocked])]);
    const currentReview = reviewed?.signature === signature ? reviewed : null;
    const pinError = confirmationPinError(pin);

    function edit(row: Row, changes: Partial<Omit<Edit, 'sourceKey'>>) {
        setEdits(current => ({ ...current, [row.proposal.groupKey]: {
            sourceKey: row.proposal.source.key, identity: row.identity, excluded: row.excluded, ...changes,
        } }));
    }

    function closeReview(value: Reviewed) {
        setPin('');
        setReviewed(null);
        void requestPatientDocument({ operation: 'batch-close', batchId: value.batchId }, db.getSessionReadSignal()).catch(() => null);
    }

    async function prepare() {
        if (running.current || !included.length || included.length > DOSSIER_BATCH_LIMIT) return;
        running.current = true;
        const signal = db.getSessionReadSignal();
        onBusy('Preparazione della conferma…');
        setNotice('');
        try {
            const scope = await readDossierBatchScope();
            const digests = await Promise.all(included.map(row => dossierBatchRowDigest(submittedRow(row))));
            const fingerprint = await dossierBatchDigest(digests);
            const response = await requestPatientDocument({ operation: 'batch-review', rows: digests }, signal);
            const batchId = response.body?.batchId;
            if (response.status !== 200 || response.body?.fingerprint !== fingerprint || typeof batchId !== 'string') {
                setNotice('Conferma non disponibile. Riprova.');
                return;
            }
            setReviewed({ rows: included, batchId, fingerprint, signature, scope });
        } catch { if (!signal.aborted) setNotice('Conferma non disponibile. Riprova.'); }
        finally { running.current = false; if (!signal.aborted) onBusy(null); }
    }

    async function create(value: Reviewed) {
        if (running.current || !isValidConfirmationPin(pin) || currentReview !== value) return;
        running.current = true;
        setPin('');
        setNotice('');
        const signal = db.getSessionReadSignal();
        onBusy('Conferma del lotto…');
        try {
            const response = await requestPatientDocument({
                operation: 'batch-confirm', batchId: value.batchId, fingerprint: value.fingerprint, pin,
            }, signal);
            if (response.status !== 200 || response.body?.status !== 'confirmed') {
                setNotice('PIN o conferma non validi. Rivedi l’elenco per riprovare.');
                return;
            }
            const results: Outcome[] = [];
            const links: Record<string, string> = {};
            for (const row of value.rows) {
                if (signal.aborted) break;
                onBusy(`Creazione schede: ${results.length + 1} di ${value.rows.length}…`);
                const result = await createDossierBatchPatient(value.batchId, value.scope, submittedRow(row), row.proposal.source, signal);
                if (result.kind === 'created') links[row.proposal.groupKey] = result.patientId;
                results.push({ row, result });
            }
            if (signal.aborted) return;
            setOutcomes(previous => {
                const byGroup = new Map(previous?.map(outcome => [outcome.row.proposal.groupKey, outcome]));
                for (const outcome of results) byGroup.set(outcome.row.proposal.groupKey, outcome);
                return [...byGroup.values()];
            });
            setEditing(false);
            await onCreated(links);
        } catch { if (!signal.aborted) setNotice('Conferma interrotta. Rivedi l’elenco per riprovare.'); }
        finally {
            running.current = false;
            if (!signal.aborted) { closeReview(value); onBusy(null); }
        }
    }

    async function recover(commandId: string, operation: 'receipt' | 'batch-revoke', row?: Row) {
        if (!scope || reading) return;
        setReading(commandId);
        const signal = db.getSessionReadSignal();
        try {
            const result = await readDossierBatchOutcome(operation, scope, commandId, signal);
            if (signal.aborted) return;
            if (row) {
                setOutcomes(current => current?.map(outcome => outcome.result.kind === 'uncertain' && outcome.result.commandId === commandId
                    ? { row, result } : outcome) ?? null);
            } else {
                setRecoveries(current => ({ ...current, [commandId]: result }));
            }
            if (result.kind === 'created') await onCreated(row ? { [row.proposal.groupKey]: result.patientId } : {});
        } finally { if (!signal.aborted) setReading(null); }
    }

    const recoveryActions = (commandId: string, row?: Row) => (
        <div className={styles.actions}>
            <button type="button" className="mf-button-secondary" disabled={Boolean(reading) || busy} onClick={() => void recover(commandId, 'receipt', row)}>Rileggi esito</button>
            <button type="button" className="mf-button-secondary" disabled={Boolean(reading) || busy} onClick={() => void recover(commandId, 'batch-revoke', row)}>Ritira</button>
        </div>
    );
    const recoveredIds = [...new Set([...pending, ...Object.keys(recoveries)])].filter(commandId => !shownCommands.has(commandId));
    const hasWork = rows.length > 0 || outcomes?.length || recoveredIds.length || editing;
    if (!hasWork) return null;
    const listedRows = currentReview?.rows ?? rows;
    const created = outcomes?.filter(({ result }) => result.kind === 'created').length ?? 0;
    const rejected = outcomes?.filter(({ result }) => result.kind === 'rejected').length ?? 0;
    const uncertain = (outcomes?.length ?? 0) - created - rejected;

    return <section className={styles.section} aria-labelledby={id} data-testid="dossier-batch">
        <h2 id={id}>Nuove schede</h2>
        {notice && <p role="alert">{notice}</p>}
        {!editing && rows.length > 0 && <button type="button" className="mf-button-secondary" disabled={busy}
            onClick={() => { setNotice(''); setEditing(true); }}>Rivedi le nuove schede ({rows.length})</button>}
        {editing && <>
            {reviewed && !currentReview && <p role="alert">L’elenco è cambiato. Prepara una nuova conferma.</p>}
            <table className={`${styles.table} ${styles.batchTable}`} role="table">
                <thead><tr><th scope="col">Documento</th>{fields.map(([key, title]) => <th scope="col" key={key}>{title}</th>)}{!currentReview && <th scope="col">Selezione</th>}</tr></thead>
                <tbody>{listedRows.map(row => <tr role="row" key={row.proposal.groupKey} data-testid="dossier-batch-row">
                    <td role="cell" data-label="Documento"><PrivacyBlur>{row.sourceName}</PrivacyBlur></td>
                    {fields.map(([key, title]) => <td role="cell" key={key} data-label={title}>
                        {currentReview || row.proposal.blocked ? <PrivacyBlur>{row.identity[key] || 'Non indicato'}</PrivacyBlur>
                            : <PrivacyBlur><input className="mf-input" aria-label={title} autoComplete="off" type={key === 'birthDate' ? 'date' : 'text'}
                                maxLength={256} disabled={busy || row.excluded} value={row.identity[key]}
                                onChange={event => edit(row, { identity: { ...row.identity, [key]: event.currentTarget.value } })} /></PrivacyBlur>}
                    </td>)}
                    {!currentReview && <td role="cell" data-label="Selezione">{row.proposal.blocked || (
                        <label className={styles.consent}>
                            <input type="checkbox" checked={row.excluded} disabled={busy} onChange={event => edit(row, { excluded: event.currentTarget.checked })} />
                            Escludi
                        </label>
                    )}</td>}
                </tr>)}</tbody>
            </table>
            {currentReview ? <form className={styles.actions} onSubmit={event => { event.preventDefault(); void create(currentReview); }}>
                <label className={styles.fileLabel}>PIN di conferma
                    <input className="mf-input" type="password" autoComplete="off" value={pin} required disabled={busy}
                        aria-invalid={Boolean(pinError)} onChange={event => setPin(event.currentTarget.value)} />
                </label>
                {pinError && <p role="alert">{pinError}</p>}
                <button type="submit" className="mf-button-primary" disabled={busy || !isValidConfirmationPin(pin)}>Conferma con PIN ({currentReview.rows.length})</button>
                <button type="button" className="mf-button-secondary" disabled={busy} onClick={() => closeReview(currentReview)}>Torna alla revisione</button>
            </form> : <div className={styles.actions}>
                {included.length > DOSSIER_BATCH_LIMIT && <p role="alert">Seleziona al massimo {DOSSIER_BATCH_LIMIT} schede per conferma.</p>}
                <button type="button" className="mf-button-primary" disabled={busy || !included.length || included.length > DOSSIER_BATCH_LIMIT}
                    onClick={() => { if (reviewed) closeReview(reviewed); void prepare(); }}>Prosegui alla conferma ({included.length})</button>
                <button type="button" className="mf-button-secondary" disabled={busy} onClick={() => { if (reviewed) closeReview(reviewed); setEditing(false); }}>Chiudi la revisione</button>
            </div>}
        </>}
        {outcomes && <div className={styles.section} data-testid="dossier-batch-results">
            <h3>Esito della creazione</h3>
            <p role="status">Create {created}, non create {rejected}{uncertain > 0 ? `, da verificare ${uncertain}` : ''}.</p>
            <ul>{outcomes.map(({ row, result }) => <li key={row.proposal.groupKey}>
                <PrivacyBlur>{label(row)}</PrivacyBlur>{' · '}{result.kind === 'created'
                    ? <><Link href={`/patients/${result.patientId}`}>Apri la scheda</Link>{result.warning && ` · ${result.warning}`}</>
                    : result.kind === 'rejected' ? result.reason : <>Esito da verificare{recoveryActions(result.commandId, row)}</>}
            </li>)}</ul>
        </div>}
        {recoveredIds.length > 0 && !busy && <ul aria-label="Lavorazioni da verificare">
            {recoveredIds.map(commandId => {
                const result = recoveries[commandId];
                return <li key={commandId}>{result?.kind === 'created'
                    ? <Link href={`/patients/${result.patientId}`}>Apri la scheda creata</Link>
                    : result?.kind === 'rejected' ? result.reason : <>Esito da verificare{recoveryActions(commandId)}</>}</li>;
            })}
        </ul>}
    </section>;
}
