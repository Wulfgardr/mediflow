/* @Codex: manual, sequential orchestration over existing client capabilities. */
import {
    isPatientCsvRowEligible, markExistingPatientDuplicates, parsePatientCsv, PATIENT_CSV_LIMITS,
    type CsvPatientFields, type ExistingPatientIdentity, type PatientCsvPreview,
} from './patient-bulk-import.ts';

export type PatientBulkContext = Readonly<{
    operatorId: string;
    ambulatoryId: string;
    ambulatoryName: string;
    /** A selection observation, NOT server authority. null means observed default. */
    cookie: string | null;
    signal: AbortSignal;
}>;
export type PatientBulkPrecondition = Readonly<{
    version: 1; nonce: string; ambulatoryId: string; ambulatoryName: string; expiresAt: number;
}>;
export type PatientBulkWriteGuard = Readonly<{
    precondition: PatientBulkPrecondition; signal: AbortSignal; isCurrent: () => boolean;
}>;
export type PatientBulkCreate = Omit<CsvPatientFields, 'birthDate'> & Readonly<{
    id: string; birthDate?: Date; createdAt: Date; updatedAt: Date;
}>;
export type PatientBulkObserved = Readonly<{
    id: string; ambulatoryId?: string | null;
    firstName: string; lastName: string; taxCode: string;
    birthDate?: Date | null; address?: string | null; phone?: string | null;
}>;
export type PatientBulkPorts = Readonly<{
    captureContext: () => Promise<PatientBulkContext>;
    isCurrent: (context: PatientBulkContext) => boolean;
    captureCreateContext: (context: PatientBulkContext) => Promise<PatientBulkPrecondition>;
    listPatients: () => Promise<readonly ExistingPatientIdentity[]>;
    getPatient: (id: string, signal: AbortSignal) => Promise<PatientBulkObserved | undefined>;
    addPatient: (patient: PatientBulkCreate, guard: PatientBulkWriteGuard) => Promise<string>;
    createId?: () => string;
    now?: () => Date;
}>;
export type PatientBulkOutcome = 'excluded' | 'not-sent' | 'in-flight' | 'confirmed' | 'unknown';
export type PatientBulkReceiptRow = Readonly<{
    row: number; line: number; id?: string; outcome: PatientBulkOutcome;
    evidence?: 'write-and-read' | 'read-only';
}>;
export type PatientBulkStopReason = 'cancelled' | 'session' | 'context' | 'navigation' | 'write' | 'verification' | 'identifier';
export type PatientBulkReceipt = Readonly<{
    batchId: string; operatorId: string; ambulatoryId: string; active: boolean;
    rows: readonly PatientBulkReceiptRow[];
    stopReason?: PatientBulkStopReason;
}>;

/** Metadata only. Volatile per document; never a cross-restart exactly-once journal. */
export class PatientBulkReceiptStore {
    private receipt: PatientBulkReceipt | undefined;
    private listeners = new Set<() => void>();
    read(): PatientBulkReceipt | undefined {
        const value = this.receipt;
        return value ? { ...value, rows: value.rows.map(row => ({ ...row })) } : undefined;
    }
    write(value: PatientBulkReceipt): void {
        // Explicit whitelist prevents accidental retention of CSV values in a receipt.
        this.receipt = {
            batchId: value.batchId, operatorId: value.operatorId, ambulatoryId: value.ambulatoryId, active: value.active,
            ...(value.stopReason ? { stopReason: value.stopReason } : {}),
            rows: value.rows.map(row => ({ row: row.row, line: row.line, outcome: row.outcome,
                ...(row.id ? { id: row.id } : {}), ...(row.evidence ? { evidence: row.evidence } : {}),
            })),
        };
        for (const listener of this.listeners) {
            // Rendering observers cannot change the outcome of an already started write.
            try { listener(); } catch { /* No input/error values are logged. */ }
        }
    }
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
}

/* Empty at module load. Production mutates this only from browser UI gestures. */
export const patientBulkReceiptStore = new PatientBulkReceiptStore();
export function hasUnresolvedPatientBulkReceipt(receipt: PatientBulkReceipt | undefined): boolean {
    return Boolean(receipt && (receipt.active || receipt.rows.some(row => row.outcome === 'in-flight' || row.outcome === 'unknown')));
}
export type PatientBulkPhase = 'idle' | 'reading' | 'preview' | 'rechecking' | 'applying' | 'stopping' | 'complete' | 'cancelled' | 'invalidated' | 'error' | 'reconciling';
export type PatientBulkSnapshot = Readonly<{
    phase: PatientBulkPhase;
    preview?: PatientCsvPreview;
    receipt?: PatientBulkReceipt;
    ambulatoryName?: string;
    notice?: string;
    /** Changes when the reviewed selection changes; consent is bound to this revision. */
    previewRevision: number;
}>;
const initialSnapshot = (): PatientBulkSnapshot => ({ phase: 'idle', previewRevision: 0 });
export function emptyPatientBulkSnapshot(): PatientBulkSnapshot { return initialSnapshot(); }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function sameContext(left: PatientBulkContext, right: PatientBulkContext): boolean {
    return left.operatorId === right.operatorId && left.ambulatoryId === right.ambulatoryId
        && left.cookie === right.cookie && left.signal === right.signal;
}
function sameScope(receipt: PatientBulkReceipt, context: PatientBulkContext): boolean {
    return receipt.operatorId === context.operatorId && receipt.ambulatoryId === context.ambulatoryId;
}
function recordMatches(record: PatientBulkObserved | undefined, input: PatientBulkCreate, context: PatientBulkContext): boolean {
    return record?.id === input.id && record.ambulatoryId === context.ambulatoryId
        && record.firstName === input.firstName && record.lastName === input.lastName && record.taxCode === input.taxCode
        && (record.address ?? undefined) === input.address && (record.phone ?? undefined) === input.phone
        && (record.birthDate?.getTime() ?? undefined) === input.birthDate?.getTime();
}

export class PatientBulkImportSession {
    private state: PatientBulkSnapshot = initialSnapshot();
    private context: PatientBulkContext | undefined;
    private precondition: PatientBulkPrecondition | undefined;
    private generation = 0;
    private stopped: PatientBulkStopReason | undefined;
    private disposed = false;
    private detachSignal: (() => void) | undefined;
    private detachStore: (() => void) | undefined;
    private listeners = new Set<(snapshot: PatientBulkSnapshot) => void>();
    constructor(private readonly ports: PatientBulkPorts, private readonly store: PatientBulkReceiptStore = patientBulkReceiptStore) {
    }
    getSnapshot(): PatientBulkSnapshot { return this.state; }
    subscribe(listener: (snapshot: PatientBulkSnapshot) => void): () => void {
        this.listeners.add(listener);
        this.detachStore ??= this.store.subscribe(() => this.publish({}));
        try { listener(this.state); } catch { /* A rendering observer cannot leak the subscription. */ }
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0) { this.detachStore?.(); this.detachStore = undefined; }
        };
    }
    private publish(change: Partial<PatientBulkSnapshot>): void {
        if (this.disposed) return;
        const receipt = this.store.read();
        this.state = { ...this.state, ...change,
            receipt: receipt && this.context && sameScope(receipt, this.context) ? receipt : undefined,
        };
        for (const listener of this.listeners) {
            try { listener(this.state); } catch { /* UI observers cannot interrupt orchestration. */ }
        }
    }
    private bind(context: PatientBulkContext): void {
        this.detachSignal?.();
        this.context = context;
        const revoke = () => this.invalidate('session');
        context.signal.addEventListener('abort', revoke, { once: true });
        this.detachSignal = () => context.signal.removeEventListener('abort', revoke);
        if (context.signal.aborted) revoke();
    }
    private current(context: PatientBulkContext, generation?: number): boolean {
        return !this.disposed && !context.signal.aborted && this.ports.isCurrent(context)
            && (generation === undefined || generation === this.generation);
    }
    private validPrecondition(context: PatientBulkContext, value = this.precondition): value is PatientBulkPrecondition {
        return Boolean(value && value.version === 1 && /^[a-f0-9]{64}$/u.test(value.nonce)
            && value.ambulatoryId === context.ambulatoryId && typeof value.ambulatoryName === 'string'
            && value.ambulatoryName.length > 0 && value.ambulatoryName.length <= 512
            && Number.isSafeInteger(value.expiresAt)
            && value.expiresAt > (this.ports.now ?? (() => new Date()))().getTime());
    }
    private busy(): boolean {
        return ['reading', 'rechecking', 'applying', 'stopping', 'reconciling'].includes(this.state.phase);
    }
    private id(): string {
        const id = (this.ports.createId ?? (() => globalThis.crypto.randomUUID()))();
        if (!uuidPattern.test(id)) throw new Error('Bulk identifier unavailable.');
        return id;
    }
    private alterReceipt(batchId: string, update: (receipt: PatientBulkReceipt) => PatientBulkReceipt): void {
        const receipt = this.store.read();
        if (receipt?.batchId === batchId) { this.store.write(update(receipt)); this.publish({}); }
    }
    private rowOutcome(batchId: string, rowNumber: number, outcome: PatientBulkOutcome, evidence?: PatientBulkReceiptRow['evidence']): void {
        this.alterReceipt(batchId, receipt => ({ ...receipt, rows: receipt.rows.map(row => row.row === rowNumber
            ? { ...row, outcome, evidence } : row) }));
    }
    private stopReceipt(batchId: string, stopReason: PatientBulkStopReason): void {
        this.alterReceipt(batchId, receipt => ({ ...receipt, stopReason }));
    }

    /** Mount/return only observes context and a RAM receipt. It never resumes a write. */
    async observeReceipt(): Promise<void> {
        if (this.disposed || this.busy() || this.state.phase === 'preview') return;
        const generation = ++this.generation;
        try {
            const context = await this.ports.captureContext();
            if (!this.current(context, generation)) return;
            this.bind(context);
            this.publish({ ambulatoryName: context.ambulatoryName });
        } catch {
            if (!this.disposed && generation === this.generation) this.publish({ notice: 'Contesto non verificabile. Torna alla lista e rinnova l’accesso prima di importare.' });
        }
    }

    async prepare(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<void> {
        if (this.disposed || this.busy()) return;
        if (hasUnresolvedPatientBulkReceipt(this.store.read())) {
            this.publish({ notice: 'Un’importazione precedente ha esiti da verificare. Non iniziare un nuovo invio.' });
            return;
        }
        const generation = ++this.generation;
        this.stopped = undefined;
        this.precondition = undefined;
        this.publish({ phase: 'reading', preview: undefined, notice: undefined });
        if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > PATIENT_CSV_LIMITS.fileBytes) {
            this.publish({ phase: 'error', notice: 'Il file supera 2 MiB o ha una dimensione non valida.' });
            return;
        }
        try {
            const context = await this.ports.captureContext();
            if (!this.current(context, generation)) { if (generation === this.generation) this.invalidate('context'); return; }
            this.bind(context);
            const buffer = await file.arrayBuffer();
            if (!this.current(context, generation)) { if (generation === this.generation) this.invalidate('context'); return; }
            const result = parsePatientCsv(new Uint8Array(buffer));
            if (!result.ok) {
                this.publish({ phase: 'error', notice: `${result.error.line ? `Riga ${result.error.line}: ` : ''}${result.error.message}` });
                return;
            }
            const existing = await this.ports.listPatients();
            if (!this.current(context, generation)) { if (generation === this.generation) this.invalidate('context'); return; }
            const precondition = await this.ports.captureCreateContext(context);
            if (!this.current(context, generation) || !this.validPrecondition(context, precondition)) {
                if (generation === this.generation) this.invalidate('context');
                return;
            }
            this.precondition = Object.freeze({ ...precondition });
            this.publish({ phase: 'preview', preview: markExistingPatientDuplicates(result.preview, existing),
                ambulatoryName: precondition.ambulatoryName, previewRevision: this.state.previewRevision + 1,
                notice: result.preview.rows.length === 0 ? 'Il file contiene solo l’intestazione: aggiungi almeno una riga di dati.' : undefined,
            });
        } catch {
            if (!this.disposed && generation === this.generation) this.publish({ phase: 'error', preview: undefined,
                notice: 'Impossibile leggere il file o verificare l’elenco. Nessuna scheda è stata inviata.' });
        }
    }

    /** Revision + true are issued only by the manual confirmation control. */
    async confirm(revision: number, reviewed: boolean): Promise<void> {
        const preview = this.state.preview;
        const context = this.context;
        if (this.disposed || !reviewed || this.state.phase !== 'preview' || !preview || !context
            || revision !== this.state.previewRevision || !preview.rows.some(isPatientCsvRowEligible)
            || hasUnresolvedPatientBulkReceipt(this.store.read())) return;
        if (!this.validPrecondition(context)) { this.invalidate('context'); return; }
        const precondition = this.precondition!;
        if (!this.current(context)) { this.invalidate('context'); return; }
        const generation = ++this.generation;
        this.stopped = undefined;
        // Synchronous latch: a second click cannot enter while reads are pending.
        this.publish({ phase: 'rechecking', notice: 'Ricontrollo dell’ambulatorio e delle schede già presenti…' });
        let existing: readonly ExistingPatientIdentity[];
        try {
            const freshContext = await this.ports.captureContext();
            if (!this.current(context, generation) || !sameContext(context, freshContext)) { if (generation === this.generation) this.invalidate('context'); return; }
            existing = await this.ports.listPatients();
            if (!this.current(context, generation)) { if (generation === this.generation) this.invalidate('context'); return; }
        } catch {
            if (generation === this.generation) this.publish({ phase: 'error', preview: undefined, notice: 'Ricontrollo non riuscito. Nessuna scheda è stata inviata; seleziona di nuovo il file.' });
            return;
        }
        const checked = markExistingPatientDuplicates(preview, existing);
        if (checked.rows.some((row, index) => row.duplicateExisting !== preview.rows[index].duplicateExisting)) {
            this.publish({ phase: 'preview', preview: checked, previewRevision: revision + 1,
                notice: 'L’elenco è cambiato. Controlla le nuove esclusioni e conferma nuovamente.' });
            return;
        }
        let batchId: string;
        try { batchId = this.id(); } catch {
            this.publish({ phase: 'error', preview: undefined, notice: 'Identificativi sicuri non disponibili. Nessuna scheda inviata.' });
            return;
        }
        if (hasUnresolvedPatientBulkReceipt(this.store.read())) {
            this.publish({ phase: 'error', preview: undefined, notice: 'Un altro invio è in corso o richiede verifica. Nessuna nuova scheda inviata.' });
            return;
        }
        const usedIds = new Set([...existing.map(patient => patient.id), batchId]);
        this.store.write({ batchId, operatorId: context.operatorId, ambulatoryId: context.ambulatoryId, active: true,
            rows: checked.rows.map(row => ({ row: row.row, line: row.line, outcome: isPatientCsvRowEligible(row) ? 'not-sent' : 'excluded' })),
        });
        this.publish({ phase: 'applying', notice: undefined });
        for (const row of checked.rows) {
            if (!isPatientCsvRowEligible(row) || !row.values) continue;
            if (this.stopped) break;
            if (!this.current(context, generation)) { this.invalidate('context'); break; }
            // Observe local changes without renewing the reviewed server precondition.
            if (!this.validPrecondition(context, precondition)) { this.invalidate('context'); break; }
            try {
                const freshContext = await this.ports.captureContext();
                if (!this.current(context, generation) || !sameContext(context, freshContext)) { this.invalidate('context'); break; }
            } catch { this.invalidate('context'); break; }
            if (this.stopped) break;
            let id: string;
            let input: PatientBulkCreate;
            try {
                id = this.id();
                if (usedIds.has(id)) throw new Error('Duplicate identifier.');
                usedIds.add(id);
                const { birthDate, ...fields } = row.values;
                const now = (this.ports.now ?? (() => new Date()))();
                input = { ...fields, id, createdAt: now, updatedAt: now,
                    ...(birthDate ? { birthDate: new Date(`${birthDate}T00:00:00.000Z`) } : {}),
                };
            } catch { this.stopped = 'identifier'; this.stopReceipt(batchId, 'identifier'); break; }
            this.alterReceipt(batchId, receipt => ({ ...receipt, rows: receipt.rows.map(item => item.row === row.row
                ? { ...item, id, outcome: 'in-flight' } : item) }));
            // Even an observer/re-entrant cancellation cannot start the next write.
            if (this.stopped || !this.current(context, generation)) { this.rowOutcome(batchId, row.row, 'not-sent'); break; }
            try {
                const returnedId = await this.ports.addPatient(input, { precondition, signal: context.signal,
                    isCurrent: () => this.current(context, generation) && this.validPrecondition(context, precondition),
                });
                if (returnedId !== id || !this.current(context, generation)) {
                    this.rowOutcome(batchId, row.row, 'unknown');
                    if (!this.current(context, generation) && generation === this.generation) this.invalidate('context');
                    this.stopped ??= 'verification';
                    break;
                }
                const saved = await this.ports.getPatient(id, context.signal);
                if (!this.current(context, generation) || !recordMatches(saved, input, context)) {
                    this.rowOutcome(batchId, row.row, 'unknown');
                    if (!this.current(context, generation) && generation === this.generation) this.invalidate('context');
                    this.stopped ??= 'verification';
                    break;
                }
                this.rowOutcome(batchId, row.row, 'confirmed', 'write-and-read');
            } catch {
                // The existing add() does not disclose dispatch/commit certainty. Never echo its error text.
                this.rowOutcome(batchId, row.row, 'unknown');
                this.stopped ??= 'write';
                break;
            }
        }
        if (this.stopped) this.stopReceipt(batchId, this.stopped);
        else if (!this.current(context, generation)) this.stopReceipt(batchId, 'context');
        this.alterReceipt(batchId, receipt => ({ ...receipt, active: false }));
        const unresolved = hasUnresolvedPatientBulkReceipt(this.store.read());
        if (!this.disposed) this.publish({ phase: this.getSnapshot().phase === 'invalidated' ? 'invalidated' : 'complete',
            notice: unresolved ? 'Importazione interrotta: un esito è sconosciuto. Verifica prima di ripetere qualsiasi invio.'
                : this.stopped ? 'Importazione interrotta. Le schede confermate restano salvate; le altre non sono state inviate.'
                    : 'Importazione conclusa. Le schede confermate sono state rilette dopo il salvataggio.',
        });
    }

    cancel(): void {
        if (this.disposed) return;
        this.stopped = 'cancelled';
        if (this.state.phase === 'applying' || this.state.phase === 'stopping') {
            this.publish({ phase: 'stopping', notice: 'Interruzione richiesta: attendo l’esito della scheda in corso. Nessuna altra riga partirà.' });
        } else {
            this.generation += 1;
            this.precondition = undefined;
            this.publish({ phase: 'cancelled', preview: undefined, notice: 'Anteprima annullata. Nessuna nuova scheda inviata.' });
        }
    }
    /** Retirement stops continuations/future rows, never rolls back a dispatched create. */
    invalidate(reason: 'context' | 'session' | 'navigation'): void {
        if (this.disposed) return;
        this.stopped = reason;
        this.precondition = undefined;
        this.generation += 1;
        this.publish({ phase: 'invalidated', preview: undefined,
            notice: 'Anteprima scaduta: accesso, ambulatorio o pagina sono cambiati. Verifica gli eventuali esiti e seleziona nuovamente il file.',
        });
    }
    checkCurrent(): void {
        if (this.context && !this.current(this.context) && this.state.phase !== 'invalidated') this.invalidate('context');
    }

    async reconcile(): Promise<void> {
        const receipt = this.store.read();
        if (this.disposed || this.busy() || !receipt || receipt.active || receipt.rows.some(row => row.outcome === 'in-flight')) return;
        const generation = ++this.generation;
        this.publish({ phase: 'reconciling', notice: 'Verifica degli identificativi tentati, senza nuovi invii…' });
        try {
            const context = await this.ports.captureContext();
            if (generation !== this.generation || this.disposed) return;
            if (!this.current(context, generation) || !sameScope(receipt, context)) {
                this.publish({ phase: 'error', preview: undefined, notice: 'La verifica richiede lo stesso operatore e lo stesso ambulatorio dell’importazione.' });
                return;
            }
            this.bind(context);
            const existing = await this.ports.listPatients();
            if (!this.current(context, generation)) { if (generation === this.generation) this.invalidate('context'); return; }
            const visibleIds = new Set(existing.map(patient => patient.id));
            for (const row of receipt.rows) {
                if (row.outcome !== 'unknown' || !row.id) continue;
                if (!this.current(context, generation)) break;
                const observed = await this.ports.getPatient(row.id, context.signal);
                if (!this.current(context, generation)) break;
                // Absence, including 404, never establishes that the old create cannot still commit.
                if (visibleIds.has(row.id) && observed?.id === row.id && observed.ambulatoryId === context.ambulatoryId) {
                    this.rowOutcome(receipt.batchId, row.row, 'confirmed', 'read-only');
                }
            }
            if (this.current(context, generation)) this.publish({ phase: 'complete', preview: undefined,
                ambulatoryName: context.ambulatoryName,
                notice: hasUnresolvedPatientBulkReceipt(this.store.read())
                    ? 'Verifica incompleta: gli identificativi non osservati restano sconosciuti. Non ripetere l’invio alla cieca.'
                    : 'Verifica conclusa sugli identificativi osservati. Nessuna nuova scheda inviata.',
            });
        } catch {
            if (!this.disposed && generation === this.generation) this.publish({ phase: 'error', preview: undefined,
                notice: 'Verifica non riuscita. Gli esiti sconosciuti restano tali; nessun invio è stato ripetuto.' });
        }
    }
    dispose(): void {
        if (this.disposed) return;
        this.invalidate('navigation');
        this.disposed = true;
        this.detachSignal?.();
        this.detachStore?.();
        this.detachStore = undefined;
        this.listeners.clear();
        this.state = initialSnapshot();
    }
}
