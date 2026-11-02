'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { FileUp } from 'lucide-react';
import { db } from '@/lib/db';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    PATIENT_DOCUMENT_ACCEPT,
    PatientDocumentFileRejected,
    parsePatientDocumentReceipt,
    patientDocumentMarker,
    preparePatientDocumentFile,
    requestPatientDocument,
    type PatientDocumentReceipt,
    type PatientDocumentView,
} from '@/lib/patient-document-create-client';

type Fields = { firstName: string; lastName: string; taxCode: string; birthDate: string };
type Source = { fileName: string; size: number; converted: boolean };
type Phase =
    | { kind: 'idle'; notice?: { tone: 'info' | 'critical'; text: string } }
    | { kind: 'reading'; fileName: string }
    | { kind: 'review'; view: PatientDocumentView; source: Source; markerKept: boolean; duplicate: boolean }
    | { kind: 'confirm'; view: PatientDocumentView; source: Source; markerKept: boolean; duplicate: boolean }
    | { kind: 'sending'; commandId: string }
    | { kind: 'applied'; patientId: string; verified: boolean; commandId: string }
    | { kind: 'uncertain'; commandId: string; text: string; forgettable?: boolean };

const EMPTY: Fields = { firstName: '', lastName: '', taxCode: '', birthDate: '' };
const UNCERTAIN = 'Esito da verificare. Non ripetere la creazione: rileggi l’esito oppure ritira la lavorazione.';
const RETIRED = 'Lavorazione ritirata. Nessuna scheda creata.';
const EXPIRED = 'La revisione non è più valida: la lavorazione scade dopo cinque minuti o al cambio di sessione o ambulatorio.';

function fieldError(fields: Fields): string | null {
    if (!fields.firstName.trim() || !fields.lastName.trim() || !fields.taxCode.trim()) return 'Inserisci nome, cognome e codice fiscale.';
    if (fields.birthDate && !/^\d{4}-\d{2}-\d{2}$/u.test(fields.birthDate)) return 'La data di nascita deve avere il formato AAAA-MM-GG.';
    return null;
}

/** Creates a patient from one document through the shared command: local extraction, field-by-field
 * entry by the physician, explicit PIN confirmation, CAS and audit on the server, attachment readback here. */
export default function PatientDocumentCreate({ onActiveChange }: { onActiveChange?: (active: boolean) => void } = {}) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    // Una sola strada di creazione alla volta: con un documento in corso il modulo manuale si nasconde.
    useEffect(() => { onActiveChange?.(phase.kind !== 'idle'); }, [onActiveChange, phase.kind]);
    const [fields, setFields] = useState<Fields>(EMPTY);
    const [separate, setSeparate] = useState(false);
    const [pin, setPin] = useState('');
    const [dragging, setDragging] = useState(false);
    const work = useRef<{ epoch: number; controller: AbortController; original: Uint8Array | null }>({ epoch: 0, controller: new AbortController(), original: null });
    const heading = useRef<HTMLHeadingElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const restart = useCallback(() => {
        work.current.controller.abort();
        work.current.original?.fill(0);
        work.current = { epoch: work.current.epoch + 1, controller: new AbortController(), original: null };
        setFields(EMPTY); setSeparate(false); setPin('');
        return work.current;
    }, []);
    const current = (token: { epoch: number }) => work.current.epoch === token.epoch && !work.current.controller.signal.aborted;

    const settle = useCallback(async (receipt: PatientDocumentReceipt | null, commandId: string, token: { epoch: number }, reason = '') => {
        if (work.current.epoch !== token.epoch) return;
        if (!receipt || receipt.outcome === 'unknown') { setPhase({ kind: 'uncertain', commandId, text: UNCERTAIN }); return; }
        if (receipt.outcome === 'retired') {
            patientDocumentMarker.clear(commandId);
            restart();
            setPhase({ kind: 'idle', notice: { tone: reason ? 'critical' : 'info', text: `${reason ? `${reason} ` : ''}${RETIRED} Puoi scegliere di nuovo il documento.` } });
            return;
        }
        let verified = false;
        try { verified = await db.verifyPatientDocumentAttachment(receipt.attachmentId, receipt.patientId, work.current.original, work.current.controller.signal); }
        catch { verified = false; }
        if (work.current.epoch !== token.epoch) return;
        if (verified) patientDocumentMarker.clear(commandId);
        work.current.original?.fill(0); work.current.original = null;
        setPin('');
        setPhase({ kind: 'applied', patientId: receipt.patientId, verified, commandId });
    }, [restart]);

    const readReceipt = useCallback(async (commandId: string, token: { epoch: number }, reason = '') => {
        try {
            const response = await requestPatientDocument({ operation: 'receipt', commandId }, work.current.controller.signal);
            await settle(response.status === 200 ? parsePatientDocumentReceipt(response.body) : null, commandId, token, reason);
        } catch { await settle(null, commandId, token, reason); }
    }, [settle]);

    useEffect(() => {
        // The marker lives in browser storage, read after hydration so server and client render the same first frame.
        let live = true;
        void Promise.resolve().then(() => {
            const commandId = patientDocumentMarker.read();
            if (live && commandId) setPhase({ kind: 'uncertain', commandId, text: 'Una lavorazione da documento richiede verifica. Rileggi l’esito oppure ritira la lavorazione prima di iniziarne un’altra.' });
        });
        const owned = work;
        return () => { live = false; owned.current.controller.abort(); owned.current.original?.fill(0); };
    }, []);
    const moved = useRef(false);
    useEffect(() => {
        // Focus follows the work after the first change of step, never on page load.
        if (moved.current) heading.current?.focus();
        moved.current = true;
    }, [phase.kind]);

    async function choose(file: File | undefined) {
        if (!file) return;
        const token = restart();
        setPhase({ kind: 'reading', fileName: file.name });
        try {
            const prepared = await preparePatientDocumentFile(file);
            work.current.original = prepared.bytes;
            const source = await db.sealPatientDocumentSource(prepared.bytes, prepared.fileName);
            const response = await requestPatientDocument({ operation: 'stage', source }, token.controller.signal);
            if (!current(token)) return;
            const view = response.body as PatientDocumentView | null;
            if (response.status === 200 && view && typeof view.commandId === 'string' && typeof view.viewId === 'string' && typeof view.text === 'string') {
                const markerKept = patientDocumentMarker.write(view.commandId);
                setPhase({ kind: 'review', view, source: { fileName: prepared.fileName, size: prepared.bytes.length, converted: prepared.converted }, markerKept, duplicate: false });
                return;
            }
            restart();
            setPhase({ kind: 'idle', notice: { tone: 'critical', text: response.status === 409 && response.body?.status === 'review-required'
                ? 'Documento non acquisito: l’estrazione locale non ha prodotto un testo leggibile. Nessuna scheda creata.'
                : response.status === 413 ? 'Documento non acquisito: supera il limite di 10 MiB. Nessuna scheda creata.'
                    : 'Documento non acquisito. Controlla di aver sbloccato la sessione e riprova. Nessuna scheda creata.' } });
        } catch (error) {
            if (work.current.epoch !== token.epoch) return;
            restart();
            const text = error instanceof PatientDocumentFileRejected
                ? error.reason === 'size' ? 'Il file supera il limite di 10 MiB. Nessuna scheda creata.'
                    : error.reason === 'empty' ? 'Il file è vuoto. Nessuna scheda creata.'
                        : 'Formato non ammesso: scegli un PDF, un JPEG o un PNG. Nessuna scheda creata.'
                : 'Lettura del documento interrotta. Nessuna scheda creata.';
            setPhase({ kind: 'idle', notice: { tone: 'critical', text } });
        }
    }

    async function withdraw(commandId: string, ask: boolean) {
        if (ask) {
            const { confirmed } = await confirm({ title: 'Annullare la lavorazione?', message: 'I dati inseriti vengono scartati e nessuna scheda viene creata.',
                confirmLabel: 'Annulla e ritira', cancelLabel: 'Continua la revisione', tone: 'danger' });
            if (!confirmed) return;
        }
        const token = work.current;
        setPhase({ kind: 'sending', commandId });
        try {
            const response = await requestPatientDocument({ operation: 'revoke', commandId }, token.controller.signal);
            const receipt = response.status === 200 ? parsePatientDocumentReceipt(response.body) : null;
            if (receipt?.outcome === 'unknown') {
                if (work.current.epoch !== token.epoch) return;
                setPhase({ kind: 'uncertain', commandId, forgettable: true, text: 'Il server non conserva più questa lavorazione e non ha registrato alcuna creazione: non può più essere completata. Puoi dimenticare il riferimento e ricominciare dal documento.' });
                return;
            }
            if (receipt?.outcome === 'retired') showToast({ tone: 'info', title: RETIRED });
            await settle(receipt, commandId, token);
        } catch { await settle(null, commandId, token); }
    }

    async function submit(event: FormEvent, view: PatientDocumentView) {
        event.preventDefault();
        const token = work.current, commandId = view.commandId;
        const entered = (value: string) => ({ action: 'correct' as const, value: value.trim() });
        const body = { firstName: entered(fields.firstName), lastName: entered(fields.lastName), taxCode: entered(fields.taxCode.toUpperCase()),
            ...(fields.birthDate ? { birthDate: entered(fields.birthDate) } : {}), duplicate: separate ? 'create-separate' : 'none' };
        const back = phase.kind === 'confirm' ? phase : null;
        setPhase({ kind: 'sending', commandId });
        try {
            const previewed = await requestPatientDocument({ operation: 'preview', commandId, viewId: view.viewId, review: body }, token.controller.signal);
            if (!current(token)) return;
            if (previewed.status === 409 && previewed.body?.status === 'duplicate-review-required' && back) {
                setPin('');
                setPhase({ ...back, kind: 'review', duplicate: true });
                return;
            }
            if (previewed.status !== 200) { setPin(''); await readReceipt(commandId, token, EXPIRED); return; }
            const executed = await requestPatientDocument({ operation: 'execute', commandId, pin }, token.controller.signal);
            setPin('');
            if (executed.status === 200) await settle(parsePatientDocumentReceipt(executed.body), commandId, token);
            else await readReceipt(commandId, token, 'PIN non confermato o lavorazione scaduta.');
        } catch {
            setPin('');
            if (work.current.epoch === token.epoch) await readReceipt(commandId, token);
        }
    }

    function drop(event: DragEvent<HTMLElement>) {
        event.preventDefault(); setDragging(false);
        if (event.dataTransfer.files.length !== 1) {
            setPhase({ kind: 'idle', notice: { tone: 'critical', text: 'Scegli un solo documento. Nessuna scheda creata.' } });
            return;
        }
        void choose(event.dataTransfer.files[0]);
    }

    const sourceLine = (source: Source) => `${source.fileName}, ${(source.size / 1024).toLocaleString('it-IT', { maximumFractionDigits: 0 })} KiB${source.converted ? ', immagine allegata come PDF di una pagina' : ''}`;

    return (
        <div className="space-y-5" data-testid="patient-document-create">
            <p role="status" aria-live="polite" className="sr-only">
                {phase.kind === 'reading' ? 'Lettura ed estrazione locale del documento in corso.' : phase.kind === 'sending' ? 'Richiesta in corso.' : ''}
            </p>

            {phase.kind === 'idle' && (
                <>
                    {phase.notice && <div className={`mf-alert ${phase.notice.tone === 'critical' ? 'mf-alert-critical' : 'mf-alert-info'}`} role="alert">{phase.notice.text}</div>}
                    <section
                        aria-labelledby="patient-document-create-title"
                        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                        onDragLeave={() => setDragging(false)}
                        onDrop={drop}
                        className={`mf-section mf-section-tight flex flex-col items-center justify-center gap-3 border-dashed px-6 py-8 text-center ${dragging ? 'ring-2 ring-[color:var(--lume-ink-fresh)]' : ''}`}
                    >
                        <FileUp className="h-6 w-6 text-[color:var(--lume-ink-muted)]" aria-hidden="true" />
                        <h3 id="patient-document-create-title" ref={heading} tabIndex={-1} className="font-semibold text-[color:var(--lume-ink)]">Nuova scheda da documento</h3>
                        <p className="max-w-xl text-sm text-[color:var(--lume-ink-muted)]">
                            Trascina qui un PDF o un’immagine (JPEG, PNG) fino a 10 MiB, oppure sceglilo.
                        </p>
                        <input ref={fileInput} type="file" accept={PATIENT_DOCUMENT_ACCEPT} className="sr-only" id="patient-document-create-file"
                            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }} />
                        <button type="button" className="mf-button-secondary" onClick={() => fileInput.current?.click()}>Scegli un documento</button>
                    </section>
                </>
            )}

            {phase.kind === 'reading' && (
                <div className="mf-alert mf-alert-info" aria-busy="true">
                    <h3 ref={heading} tabIndex={-1} className="font-semibold">Lettura ed estrazione locale del documento…</h3>
                    <p className="text-sm">{phase.fileName}</p>
                    <button type="button" className="mf-button-secondary mt-3" onClick={() => { restart(); setPhase({ kind: 'idle', notice: { tone: 'info', text: 'Lettura annullata. Nessuna scheda creata.' } }); }}>Annulla</button>
                </div>
            )}

            {(phase.kind === 'review' || phase.kind === 'confirm') && (
                <form className="space-y-5" onSubmit={(event) => {
                    if (phase.kind === 'confirm') { void submit(event, phase.view); return; }
                    event.preventDefault();
                    if (!fieldError(fields)) setPhase({ ...phase, kind: 'confirm' });
                }}>
                    <div className="mf-alert mf-alert-warning">
                        <h3 ref={heading} tabIndex={-1} className="font-semibold">{phase.kind === 'review' ? 'Revisione dei dati' : 'Conferma della creazione'}</h3>
                        <p className="text-sm">MediFlow non compila i dati dal documento: leggi il testo estratto e scrivi tu ogni campo.</p>
                        <p className="mt-1 text-xs">Fonte: {sourceLine(phase.source)}</p>
                    </div>
                    {!phase.markerKept && (
                        <div className="mf-alert mf-alert-critical" role="alert">
                            Il browser non ha conservato il riferimento della lavorazione: senza riferimento una risposta persa non sarebbe recuperabile. Conferma bloccata; puoi solo annullare.
                        </div>
                    )}
                    {phase.duplicate && (
                        <div className="mf-alert mf-alert-warning" role="alert">
                            Esiste già una scheda con lo stesso codice fiscale o lo stesso nome e cognome. Verifica l’identità: se è una persona diversa, scegli di creare una scheda separata. Le schede non vengono unite.
                        </div>
                    )}
                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                        <section aria-labelledby="patient-document-create-text" className="space-y-2 min-w-0">
                            <h4 id="patient-document-create-text" className="mf-eyebrow">Testo estratto</h4>
                            <pre className="mf-input max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed" tabIndex={0}>
                                {phase.view.text.trim() || 'Il documento non contiene testo leggibile.'}
                            </pre>
                        </section>
                        <fieldset className="space-y-4 min-w-0" disabled={phase.kind === 'confirm'}>
                            <legend className="mf-eyebrow mb-2">Dati della nuova scheda</legend>
                            {([
                                ['firstName', 'Nome', 'given-name'],
                                ['lastName', 'Cognome', 'family-name'],
                                ['taxCode', 'Codice fiscale', 'off'],
                                ['birthDate', 'Data di nascita (facoltativa)', 'off'],
                            ] as const).map(([key, label, autoComplete]) => (
                                <div key={key} className="space-y-1">
                                    <label htmlFor={`patient-document-${key}`} className="mf-field-label">{label}</label>
                                    <input id={`patient-document-${key}`} className="mf-input" type={key === 'birthDate' ? 'date' : 'text'} autoComplete={autoComplete}
                                        value={fields[key]} required={key !== 'birthDate'} maxLength={256}
                                        onChange={(event) => setFields((value) => ({ ...value, [key]: event.target.value }))} />
                                </div>
                            ))}
                            {phase.duplicate && (
                                <label className="flex items-start gap-2 text-sm">
                                    <input type="checkbox" checked={separate} onChange={(event) => setSeparate(event.target.checked)} className="mt-1" />
                                    <span>Crea una scheda separata: è una persona diversa da quella già presente.</span>
                                </label>
                            )}
                            {phase.kind === 'review' && fieldError(fields) && <p className="mf-field-helper">{fieldError(fields)}</p>}
                        </fieldset>
                    </div>

                    {phase.kind === 'confirm' && (
                        <div className="space-y-2">
                            <p className="text-sm">
                                {separate ? 'La conferma creerà una scheda separata con il documento allegato. Le schede non vengono unite.' : 'La conferma creerà una nuova scheda con il documento allegato, dopo il controllo dei duplicati.'}
                            </p>
                            <label htmlFor="patient-document-pin" className="mf-field-label">PIN di conferma</label>
                            <input id="patient-document-pin" className="mf-input max-w-48" type="password" inputMode="numeric" autoComplete="off"
                                value={pin} onChange={(event) => setPin(event.target.value)} minLength={4} maxLength={8} required />
                        </div>
                    )}

                    <div className="flex flex-wrap gap-3">
                        {phase.kind === 'review' && <button type="submit" className="mf-button-primary" disabled={!!fieldError(fields) || !phase.markerKept}>Prosegui alla conferma</button>}
                        {phase.kind === 'confirm' && <button type="submit" className="mf-button-primary" disabled={pin.length < 4}>Conferma creazione con PIN</button>}
                        {phase.kind === 'confirm' && <button type="button" className="mf-button-secondary" onClick={() => { setPin(''); setPhase({ ...phase, kind: 'review' }); }}>Torna alla revisione</button>}
                        <button type="button" className="mf-button-text" onClick={() => void withdraw(phase.view.commandId, Object.values(fields).some(Boolean))}>Annulla e ritira</button>
                    </div>
                </form>
            )}

            {phase.kind === 'sending' && (
                <div className="mf-alert mf-alert-info" aria-busy="true">
                    <h3 ref={heading} tabIndex={-1} className="font-semibold">Richiesta in corso…</h3>
                    <p className="text-sm">Attendi l’esito: non ripetere l’operazione.</p>
                </div>
            )}

            {phase.kind === 'applied' && (
                <div className={`mf-alert ${phase.verified ? 'mf-alert-success' : 'mf-alert-warning'}`} role="alert">
                    <h3 ref={heading} tabIndex={-1} className="font-semibold">{phase.verified ? 'Scheda creata' : 'Scheda creata, allegato da verificare'}</h3>
                    <p className="text-sm">
                        {phase.verified ? 'Il documento è allegato alla nuova scheda: è stato riletto, aperto e verificato.'
                            : 'La creazione risulta registrata, ma l’allegato non si apre o non corrisponde al documento scelto. Non ripetere la creazione; il riferimento resta conservato.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                        <Link href={`/patients/${phase.patientId}`} className="mf-button-primary">Apri la scheda</Link>
                        {!phase.verified && <button type="button" className="mf-button-secondary" onClick={() => void readReceipt(phase.commandId, work.current)}>Rileggi esito e allegato</button>}
                        {phase.verified && <button type="button" className="mf-button-secondary" onClick={() => { restart(); setPhase({ kind: 'idle' }); }}>Nuova scheda da documento</button>}
                    </div>
                </div>
            )}

            {phase.kind === 'uncertain' && (
                <div className="mf-alert mf-alert-warning" role="alert">
                    <h3 ref={heading} tabIndex={-1} className="font-semibold">Esito da verificare</h3>
                    <p className="text-sm">{phase.text}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                        <button type="button" className="mf-button-secondary" onClick={() => void readReceipt(phase.commandId, work.current)}>Rileggi esito</button>
                        {!phase.forgettable && <button type="button" className="mf-button-secondary" onClick={() => void withdraw(phase.commandId, false)}>Ritira la lavorazione</button>}
                        {phase.forgettable && <button type="button" className="mf-button-text" onClick={() => { patientDocumentMarker.clear(phase.commandId); restart(); setPhase({ kind: 'idle' }); }}>Dimentica il riferimento</button>}
                    </div>
                </div>
            )}
        </div>
    );
}
