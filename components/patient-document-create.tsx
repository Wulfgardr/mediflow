'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { FileUp } from 'lucide-react';
import { db } from '@/lib/db';
import { useToast } from '@/components/ui/toast-provider';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    PATIENT_DOCUMENT_ACCEPT,
    PatientDocumentFileRejected,
    parsePatientDocumentReceipt,
    patientDocumentMarker,
    patientDocumentScope,
    preparePatientDocumentFile,
    requestPatientDocument,
    type PatientDocumentReceipt,
    type PatientDocumentView,
} from '@/lib/patient-document-create-client';
import { OCR_MIN_SHORT_SIDE_PIXELS } from '@/lib/patient-document-image-geometry';
import { birthError, identifierError, IDENTIFIER_LABELS, IDENTIFIER_TYPES, PATIENT_IDENTIFIER_DUPLICATE, type PatientIdentifierType } from '@/lib/patient-identity';
import type { DossierIdentityProposal } from '@/lib/domain/documents/dossier-sections';
import type { PatientDocumentCreateReview } from '@/lib/patient-document-create-command';
import { focusPatientCreationTarget } from '@/lib/patient-creation-focus';
import { confirmationPinError, isValidConfirmationPin, validateConfirmationPinSubmission } from '@/lib/security/pin-input';

/** Dossier (ADR 0175): documento già scelto nel lotto e proposte d'identità con evidenza. */
export type PatientDocumentDossierSource = Readonly<{
    file: File;
    proposals: readonly DossierIdentityProposal[];
    onCreated: (created: { patientId: string; attachmentId: string }) => void;
}>;

type Fields = { firstName: string; lastName: string; identifierType: PatientIdentifierType; taxCode: string; birthDate: string; estimatedBirth: boolean; birthYear: string };
type Duplicate = 'possible' | 'identifier' | null;
type Source = { fileName: string; size: number; converted: boolean; reduction: number };
type Phase =
    | { kind: 'idle'; notice?: { tone: 'info' | 'critical'; text: string } }
    | { kind: 'reading'; fileName: string }
    | { kind: 'review'; view: PatientDocumentView; source: Source; markerKept: boolean; duplicate: Duplicate }
    | { kind: 'confirm'; view: PatientDocumentView; source: Source; markerKept: boolean; duplicate: Duplicate }
    | { kind: 'sending'; commandId: string }
    | { kind: 'applied'; patientId: string; verified: 'matched' | 'opened' | 'failed'; commandId: string }
    | { kind: 'uncertain'; commandId: string; text: string; forgettable?: boolean };

const EMPTY: Fields = { firstName: '', lastName: '', identifierType: 'cf', taxCode: '', birthDate: '', estimatedBirth: false, birthYear: '' };
const UNCERTAIN = 'Esito da verificare. Non ripetere la creazione: rileggi l’esito oppure ritira la lavorazione.';
const RETIRED = 'Lavorazione ritirata. Nessuna scheda creata.';
const EXPIRED = 'La revisione non è più valida: la lavorazione scade dopo cinque minuti o al cambio di sessione o ambulatorio.';

/** The cause of a refused stage, in the physician's terms: never a generic hint about the lock. */
function stageRefusal(status: number, code: unknown, detail: unknown, converted: boolean): string {
    if (status === 409 && code === 'review-required' && detail === 'image_or_scan') return converted
        // The browser already brought the image within the renderer limits: the cause is elsewhere.
        ? 'Documento non acquisito: l’OCR locale non ha letto testo nell’immagine. Può mancare l’OCR su questo computer, oppure la foto è sfocata, scura o troppo sgranata: riprova con più luce o con una scansione.'
        : 'Documento non acquisito: è una scansione e l’OCR locale non ha prodotto testo. Può mancare l’OCR su questo computer, oppure la pagina è troppo grande o troppo pesante per il lettore locale.';
    if (status === 409 && code === 'review-required') return 'Documento non acquisito: l’estrazione locale non ha prodotto un testo leggibile.';
    if (status === 409 && code === 'in-progress') return 'Questa sessione ha già una lavorazione da documento aperta, forse in un’altra scheda del browser: concludila o annullala, oppure attendi cinque minuti che scada.';
    if (status === 409 && code === 'scope-unavailable') return 'L’ambulatorio selezionato non esiste più: scegline un altro e riprova.';
    if (status === 503) return 'Il computer sta già leggendo due documenti: riprova tra poco.';
    if (status === 413) return 'Documento non acquisito: supera il limite di 10 MiB.';
    if (status === 401) return 'Sessione scaduta o bloccata: sblocca e riprova.';
    if (status === 409) return 'I dati sono stati ripristinati da un backup: ricarica la pagina prima di continuare.';
    if (status === 403) return 'Richiesta non ammessa: serve un operatore amministratore con la sessione sbloccata su questo computer.';
    return 'Documento non acquisito per un errore del server.';
}

function fieldError(fields: Fields): string | null {
    if (!fields.firstName.trim() || !fields.lastName.trim()) return 'Inserisci nome e cognome.';
    return identifierError(fields.identifierType, fields.taxCode) ?? birthError({
        identifierType: fields.identifierType, birthDate: fields.birthDate,
        birthDatePrecision: fields.estimatedBirth ? 'estimated' : fields.birthDate ? 'exact' : 'unknown',
        birthYear: fields.birthYear ? Number(fields.birthYear) : null,
    });
}

/** Creates a patient from one document through the shared command: local extraction, field-by-field
 * entry by the physician, explicit PIN confirmation, CAS and audit on the server, attachment readback here. */
export default function PatientDocumentCreate({ onActiveChange, dossier }: { onActiveChange?: (active: boolean) => void; dossier?: PatientDocumentDossierSource } = {}) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    // Una sola strada di creazione alla volta: con un documento in corso il modulo manuale si nasconde.
    useEffect(() => { onActiveChange?.(phase.kind !== 'idle'); }, [onActiveChange, phase.kind]);
    const [fields, setFields] = useState<Fields>(EMPTY);
    const [separate, setSeparate] = useState(false);
    const [pin, setPin] = useState('');
    const [dragging, setDragging] = useState(false);
    const [pinSubmitError, setPinSubmitError] = useState<string | null>(null);
    const pinError = confirmationPinError(pin) ?? pinSubmitError;
    // The ambulatory scope of the local reference, resolved like the server does (selected, else default).
    const scope = useRef('predefinito-non-letto');
    const resolveScope = useCallback(async () => {
        scope.current = await patientDocumentScope(async () => (await db.ambulatories.toArray()).find(item => item.isDefault)?.id ?? null);
        return scope.current;
    }, []);
    const work = useRef<{ epoch: number; controller: AbortController; original: Uint8Array | null }>({ epoch: 0, controller: new AbortController(), original: null });
    const heading = useRef<HTMLHeadingElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const dossierCreated = useRef(dossier?.onCreated);
    dossierCreated.current = dossier?.onCreated;

    const restart = useCallback(() => {
        work.current.controller.abort();
        work.current.original?.fill(0);
        work.current = { epoch: work.current.epoch + 1, controller: new AbortController(), original: null };
        setFields(EMPTY); setSeparate(false); setPin(''); setPinSubmitError(null);
        return work.current;
    }, []);
    const current = (token: { epoch: number }) => work.current.epoch === token.epoch && !work.current.controller.signal.aborted;

    const settle = useCallback(async (receipt: PatientDocumentReceipt | null, commandId: string, token: { epoch: number }, reason = '') => {
        if (work.current.epoch !== token.epoch) return;
        if (!receipt || receipt.outcome === 'unknown') { setPhase({ kind: 'uncertain', commandId, text: UNCERTAIN }); return; }
        if (receipt.outcome === 'retired') {
            patientDocumentMarker.clear(scope.current, commandId);
            restart();
            setPhase({ kind: 'idle', notice: { tone: reason ? 'critical' : 'info', text: `${reason ? `${reason} ` : ''}${RETIRED} Puoi scegliere di nuovo il documento.` } });
            return;
        }
        let verified: 'matched' | 'opened' | 'failed' = 'failed';
        try { verified = await db.verifyPatientDocumentAttachment(receipt.attachmentId, receipt.patientId, work.current.original, work.current.controller.signal); }
        catch { verified = 'failed'; }
        if (work.current.epoch !== token.epoch) return;
        // A failed comparison keeps the original: «Rileggi esito e allegato» must compare again, not
        // settle for a PDF that merely opens. It is erased after success, abandonment or a new document.
        if (verified !== 'failed') {
            patientDocumentMarker.clear(scope.current, commandId);
            work.current.original?.fill(0); work.current.original = null;
            // Il lotto dossier riprende con la scheda creata; l'allegato del comando viene riusato, non duplicato.
            dossierCreated.current?.({ patientId: receipt.patientId, attachmentId: receipt.attachmentId });
        }
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
        void resolveScope().then((resolved) => {
            const commandId = patientDocumentMarker.read(resolved);
            if (live && commandId) setPhase({ kind: 'uncertain', commandId, text: 'Una lavorazione da documento richiede verifica. Rileggi l’esito oppure ritira la lavorazione prima di iniziarne un’altra.' });
        });
        const owned = work;
        return () => { live = false; owned.current.controller.abort(); owned.current.original?.fill(0); };
    }, [resolveScope]);
    const previousPhase = useRef(phase.kind);
    useEffect(() => {
        if (previousPhase.current === phase.kind) return;
        previousPhase.current = phase.kind;
        if (heading.current) focusPatientCreationTarget(heading.current);
    }, [phase.kind]);

    async function choose(file: File | undefined) {
        if (!file) return;
        const token = restart();
        setPhase({ kind: 'reading', fileName: file.name });
        try {
            const stageScope = await resolveScope();
            const prepared = await preparePatientDocumentFile(file);
            // A document cancelled while it was being read is erased, never kept as the next work's original.
            if (!current(token)) { prepared.bytes.fill(0); return; }
            work.current.original = prepared.bytes;
            const source = await db.sealPatientDocumentSource(prepared.bytes, prepared.fileName);
            let response: Awaited<ReturnType<typeof requestPatientDocument>>;
            // The per-file key leaves this array once serialized; the request string itself is not erasable in the browser.
            try { response = await requestPatientDocument({ operation: 'stage', source }, token.controller.signal); }
            finally { source.fileKey.fill(0); }
            if (!current(token)) return;
            const view = response.body as PatientDocumentView | null;
            if (response.status === 200 && view && typeof view.commandId === 'string' && typeof view.viewId === 'string' && typeof view.text === 'string') {
                const markerKept = patientDocumentMarker.write(stageScope, view.commandId);
                setPhase({ kind: 'review', view, source: { fileName: prepared.fileName, size: prepared.bytes.length, converted: prepared.converted, reduction: prepared.reduction }, markerKept, duplicate: null });
                return;
            }
            restart();
            setPhase({ kind: 'idle', notice: { tone: 'critical', text: `${stageRefusal(response.status, response.body?.status, response.body?.detail, prepared.converted)} Nessuna scheda creata.` } });
        } catch (error) {
            if (work.current.epoch !== token.epoch) return;
            restart();
            const text = error instanceof PatientDocumentFileRejected
                ? error.reason === 'size' ? 'Il file supera il limite di 10 MiB. Nessuna scheda creata.'
                    : error.reason === 'empty' ? 'Il file è vuoto. Nessuna scheda creata.'
                        : error.reason === 'image-too-elongated' ? `Immagine troppo allungata per l’estrazione locale: ridotta entro i limiti del lettore, il lato corto resterebbe di ${error.shortSide ?? 0} px, sotto i ${OCR_MIN_SHORT_SIDE_PIXELS} px che servono a leggere il testo. Fotografa o scansiona il documento in più parti. Nessuna scheda creata.`
                            : error.reason === 'image-unreadable' ? 'Immagine non leggibile dal browser. Nessuna scheda creata.'
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
                setPhase({ kind: 'uncertain', commandId, forgettable: true, text: 'Questa sessione non può leggere né ritirare la lavorazione. Per verificare se la scheda è stata creata, cerca nome e cognome nell’elenco pazienti dell’ambulatorio in cui hai avviato la lavorazione.' });
                return;
            }
            if (receipt?.outcome === 'retired') showToast({ tone: 'info', title: RETIRED });
            await settle(receipt, commandId, token);
        } catch { await settle(null, commandId, token); }
    }

    function changeFields(changes: Partial<Fields>) {
        setFields((value) => ({ ...value, ...changes }));
        if (phase.kind === 'review' && phase.duplicate) {
            setSeparate(false);
            setPhase({ ...phase, duplicate: null });
        }
    }

    async function submit(back: Extract<Phase, { kind: 'confirm' }>) {
        const pinProblem = validateConfirmationPinSubmission(pin);
        if (pinProblem) { setPinSubmitError(pinProblem); return; }
        setPinSubmitError(null);
        const token = work.current, { commandId, viewId } = back.view;
        const entered = (value: string) => ({ action: 'correct' as const, value: value.trim() });
        const common = { firstName: entered(fields.firstName), lastName: entered(fields.lastName), duplicate: separate ? 'create-separate' as const : 'none' as const };
        const birth = fields.estimatedBirth ? { birthYear: Number(fields.birthYear) }
            : fields.birthDate ? { birthDate: entered(fields.birthDate) } : null;
        const identifierType = fields.identifierType;
        const review: PatientDocumentCreateReview | null = identifierType === 'none'
            ? birth && { ...common, identifierType, ...birth }
            : { ...common, identifierType, taxCode: entered(fields.taxCode), ...birth };
        if (!review) return;
        setPhase({ kind: 'sending', commandId });
        try {
            const previewed = await requestPatientDocument({ operation: 'preview', commandId, viewId, review }, token.controller.signal);
            if (!current(token)) return;
            const duplicate = previewed.body?.code === PATIENT_IDENTIFIER_DUPLICATE.code ? 'identifier'
                : previewed.body?.status === 'duplicate-review-required' ? 'possible' : null;
            if (previewed.status === 409 && duplicate) {
                setPin('');
                setSeparate(false);
                setPhase({ ...back, kind: 'review', duplicate });
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

    /** Only after the physician states that the list was checked: the outcome stays unknown to this session. */
    async function closeUnreadable(commandId: string) {
        const { confirmed } = await confirm({ title: 'Hai verificato l’elenco pazienti?',
            message: 'Da questa sessione l’esito non è leggibile: se la scheda è stata creata resta nell’archivio. Chiudendo l’avviso MediFlow non potrà più mostrarti l’esito di questa lavorazione.',
            confirmLabel: 'Ho verificato, chiudi', cancelLabel: 'Non ancora' });
        if (!confirmed) return;
        patientDocumentMarker.clear(scope.current, commandId); restart(); setPhase({ kind: 'idle' });
    }

    function drop(event: DragEvent<HTMLElement>) {
        event.preventDefault(); setDragging(false);
        if (event.dataTransfer.files.length !== 1) {
            setPhase({ kind: 'idle', notice: { tone: 'critical', text: 'Scegli un solo documento. Nessuna scheda creata.' } });
            return;
        }
        void choose(event.dataTransfer.files[0]);
    }

    const sourceLine = (source: Source) => `${source.fileName}, ${(source.size / 1024).toLocaleString('it-IT', { maximumFractionDigits: 0 })} KiB${source.converted
        ? `, immagine allegata come PDF di una pagina${source.reduction < 1 ? `, ridotta al ${Math.round(source.reduction * 100)}% per l’estrazione locale` : ''}` : ''}`;
    const identityError = fieldError(fields);
    const canConfirm = (phase.kind === 'review' || phase.kind === 'confirm') && phase.markerKept && !identityError
        && (phase.duplicate === null || (phase.duplicate === 'possible' && separate));

    return (
        <div className="space-y-5" data-testid="patient-document-create">
            <p role="status" aria-live="polite" className="sr-only">
                {phase.kind === 'reading' ? 'Lettura ed estrazione locale del documento in corso.' : phase.kind === 'sending' ? 'Richiesta in corso.' : ''}
            </p>

            {phase.kind === 'idle' && (
                <>
                    {phase.notice && <div className={`mf-alert ${phase.notice.tone === 'critical' ? 'mf-alert-critical' : 'mf-alert-info'}`} role="alert">{phase.notice.text}</div>}
                    {dossier && (
                        <div className="mf-alert mf-alert-info">
                            <p className="text-sm">Documento del lotto: {dossier.file.name}. La lettura locale avvia una lavorazione revisionabile; nessuna scheda viene creata senza PIN.</p>
                            <button type="button" className="mf-button-primary mt-3" onClick={() => { void choose(dossier.file); }}>Avvia la revisione del documento</button>
                        </div>
                    )}
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
                    event.preventDefault();
                    if (!canConfirm) return;
                    if (phase.kind === 'confirm') { void submit(phase); return; }
                    setPhase({ ...phase, kind: 'confirm' });
                }}>
                    <div className="mf-alert mf-alert-warning">
                        <h3 ref={heading} tabIndex={-1} className="font-semibold">{phase.kind === 'review' ? 'Revisione dei dati' : 'Conferma della creazione'}</h3>
                        <p className="text-sm">{dossier
                            ? 'Le proposte del dossier entrano nei campi solo con il tuo gesto: confronta ogni campo con il testo estratto.'
                            : 'MediFlow non compila i dati dal documento: leggi il testo estratto e scrivi tu ogni campo.'}</p>
                        <p className="mt-1 text-xs">Fonte: {sourceLine(phase.source)}</p>
                    </div>
                    {!phase.markerKept && (
                        <div className="mf-alert mf-alert-critical" role="alert">
                            Il browser non ha conservato il riferimento della lavorazione: senza riferimento una risposta persa non sarebbe recuperabile. Conferma bloccata; puoi solo annullare.
                        </div>
                    )}
                    {phase.duplicate === 'possible' && (
                        <div className="mf-alert mf-alert-warning" role="alert">
                            Esiste già una scheda con lo stesso identificativo o con lo stesso nome e cognome. Verifica che si tratti di un’altra persona prima di creare una scheda separata.
                        </div>
                    )}
                    {phase.duplicate === 'identifier' && <div className="mf-alert mf-alert-warning" role="alert">{PATIENT_IDENTIFIER_DUPLICATE.error}</div>}
                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                        <section aria-labelledby="patient-document-create-text" className="space-y-2 min-w-0">
                            <h4 id="patient-document-create-text" className="mf-eyebrow">Testo estratto</h4>
                            <pre className="mf-input max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed" tabIndex={0}>
                                {phase.view.text.trim() || 'Il documento non contiene testo leggibile.'}
                            </pre>
                        </section>
                        <fieldset className="space-y-4 min-w-0" disabled={phase.kind === 'confirm'}>
                            <legend className="mf-eyebrow mb-2">Dati della nuova scheda</legend>
                            {dossier?.proposals.length ? (
                                <div className="space-y-2" data-testid="patient-document-dossier-proposals">
                                    <p className="mf-field-helper">Proposte dal documento, con l’evidenza letta:</p>
                                    <ul className="space-y-2">{dossier.proposals.map((proposal) => (
                                        <li key={`${proposal.field}-${proposal.value}`} className="flex flex-wrap items-center gap-2 text-sm">
                                            <span>{proposal.excerpt}</span>
                                            <button type="button" className="mf-button-secondary"
                                                onClick={() => changeFields(proposal.field === 'taxCode' ? { identifierType: 'cf', taxCode: proposal.value }
                                                    : proposal.field === 'birthDate' ? { birthDate: proposal.value, birthYear: '', estimatedBirth: false }
                                                        : { [proposal.field]: proposal.value })}>
                                                Usa per {proposal.field === 'taxCode' ? 'codice fiscale' : proposal.field === 'firstName' ? 'nome' : proposal.field === 'lastName' ? 'cognome' : 'data di nascita'}
                                            </button>
                                        </li>))}</ul>
                                </div>) : null}
                            {([
                                ['firstName', 'Nome', 'given-name'],
                                ['lastName', 'Cognome', 'family-name'],
                            ] as const).map(([key, label, autoComplete]) => (
                                <div key={key} className="space-y-1">
                                    <label htmlFor={`patient-document-${key}`} className="mf-field-label">{label}</label>
                                    <input id={`patient-document-${key}`} className="mf-input" autoComplete={autoComplete}
                                        value={fields[key]} required maxLength={256} onChange={(event) => changeFields({ [key]: event.target.value })} />
                                </div>
                            ))}
                            <div className="space-y-1">
                                <label htmlFor="patient-document-identifierType" className="mf-field-label">Identificativo</label>
                                <select id="patient-document-identifierType" className="mf-input" value={fields.identifierType}
                                    onChange={(event) => changeFields({ identifierType: event.target.value as PatientIdentifierType, taxCode: '' })}>
                                    {IDENTIFIER_TYPES.map(type => <option key={type} value={type}>{type === 'none' ? 'La persona non ha un identificativo' : IDENTIFIER_LABELS[type]}</option>)}
                                </select>
                            </div>
                            {fields.identifierType !== 'none' && <div className="space-y-1">
                                <label htmlFor="patient-document-taxCode" className="mf-field-label">{IDENTIFIER_LABELS[fields.identifierType]}</label>
                                <input id="patient-document-taxCode" className="mf-input" autoComplete="off" value={fields.taxCode} required
                                    maxLength={['cf', 'stp', 'eni'].includes(fields.identifierType) ? 16 : 128}
                                    onChange={(event) => changeFields({ taxCode: event.target.value })} />
                            </div>}
                            <div className="space-y-1">
                                {fields.estimatedBirth ? <>
                                    <label htmlFor="patient-document-birthYear" className="mf-field-label">Anno di nascita stimato</label>
                                    <input id="patient-document-birthYear" className="mf-input" type="number" inputMode="numeric" value={fields.birthYear} required
                                        onChange={(event) => changeFields({ birthYear: event.target.value })} />
                                </> : <>
                                    <label htmlFor="patient-document-birthDate" className="mf-field-label">Data di nascita</label>
                                    <input id="patient-document-birthDate" className="mf-input" type="date" value={fields.birthDate}
                                        onChange={(event) => changeFields({ birthDate: event.target.value })} />
                                </>}
                                <label className="flex items-start gap-2 text-sm">
                                    <input type="checkbox" checked={fields.estimatedBirth} className="mt-1"
                                        onChange={(event) => changeFields({ estimatedBirth: event.target.checked, birthDate: '', birthYear: '' })} />
                                    <span>Conosco solo l’anno di nascita</span>
                                </label>
                            </div>
                            {phase.duplicate === 'possible' && (
                                <label className="flex items-start gap-2 text-sm">
                                    <input type="checkbox" checked={separate} onChange={(event) => setSeparate(event.target.checked)} className="mt-1" />
                                    <span>Crea una scheda separata: è una persona diversa da quella già presente.</span>
                                </label>
                            )}
                            {phase.kind === 'review' && identityError && <p className="mf-field-helper">{identityError}</p>}
                        </fieldset>
                    </div>

                    {phase.kind === 'confirm' && (
                        <div className="space-y-2">
                            <p className="text-sm">
                                {separate ? 'La conferma creerà una scheda separata con il documento allegato. Le schede non vengono unite.' : 'La conferma creerà una nuova scheda con il documento allegato, dopo il controllo dei duplicati.'}
                            </p>
                            <label htmlFor="patient-document-pin" className="mf-field-label">PIN di conferma</label>
                            <input id="patient-document-pin" className="mf-input max-w-48" type="password" inputMode="text" autoComplete="off"
                                aria-invalid={Boolean(pinError)} aria-describedby={pinError ? 'patient-document-pin-error' : undefined}
                                value={pin} onChange={(event) => {
                                    setPin(event.target.value); setPinSubmitError(null);
                                }} required />
                            {pinError && <p id="patient-document-pin-error" role="alert" className="text-sm text-[color:var(--lume-signal-critical)]">{pinError}</p>}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-3">
                        {phase.kind === 'review' && <button type="submit" className="mf-button-primary" disabled={!canConfirm}>Prosegui alla conferma</button>}
                        {phase.kind === 'confirm' && <button type="submit" className="mf-button-primary" disabled={!isValidConfirmationPin(pin)}>Conferma creazione con PIN</button>}
                        {phase.kind === 'confirm' && <button type="button" className="mf-button-secondary" onClick={() => { setPin(''); setPinSubmitError(null); setPhase({ ...phase, kind: 'review' }); }}>Torna alla revisione</button>}
                        <button type="button" className="mf-button-text" onClick={() => void withdraw(phase.view.commandId, fields !== EMPTY)}>Annulla e ritira</button>
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
                <div className={`mf-alert ${phase.verified !== 'failed' ? 'mf-alert-success' : 'mf-alert-warning'}`} role="alert">
                    <h3 ref={heading} tabIndex={-1} className="font-semibold">{phase.verified !== 'failed' ? 'Scheda creata' : 'Scheda creata, allegato da verificare'}</h3>
                    <p className="text-sm">
                        {phase.verified === 'matched' ? 'Il documento è allegato alla nuova scheda: è stato riletto, aperto e verificato.'
                            : phase.verified === 'opened' ? 'Il documento è allegato alla nuova scheda e si apre come PDF. Dopo il ricaricamento della pagina il file scelto non è più in memoria: il confronto byte per byte non è stato possibile.'
                                : 'La creazione risulta registrata, ma l’allegato non si apre o non corrisponde al documento scelto. Non ripetere la creazione; il riferimento resta conservato.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                        <Link href={`/patients/${phase.patientId}`} className="mf-button-primary">Apri la scheda</Link>
                        {phase.verified === 'failed' && <button type="button" className="mf-button-secondary" onClick={() => void readReceipt(phase.commandId, work.current)}>Rileggi esito e allegato</button>}
                        {phase.verified !== 'failed' && <button type="button" className="mf-button-secondary" onClick={() => { restart(); setPhase({ kind: 'idle' }); }}>Nuova scheda da documento</button>}
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
                        {phase.forgettable && <button type="button" className="mf-button-text" onClick={() => void closeUnreadable(phase.commandId)}>Ho verificato, chiudi l’avviso</button>}
                    </div>
                </div>
            )}
        </div>
    );
}
