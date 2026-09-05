/* @Codex */
/** The editable projection is also the form's default-value source. No I/O. */
type DateInput = Date | string;
type CheckupStatus = 'pending' | 'completed' | 'cancelled';
type CheckupSource = 'manual' | 'ai_suggestion';

type DiagnosisInput = { code: string; description: string; system: string; date: DateInput };
export type CheckupFormInput = {
    id?: string;
    patientId?: string;
    version?: number;
    date: DateInput;
    title: string;
    notes?: string | null;
    status?: CheckupStatus;
    source?: CheckupSource;
    deletedAt?: DateInput | null;
};
export type PatientFormSeed = {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    taxCode?: string | null;
    birthDate?: DateInput | null;
    address?: string | null;
    phone?: string | null;
    caregiver?: string | null;
    notes?: string | null;
    isAdi?: boolean;
    monitoringProfile?: string | null;
    statusReason?: string | null;
    exemptions?: string[];
    diagnoses?: DiagnosisInput[];
    checkups?: CheckupFormInput[];
};
export type PatientEditRecord = Omit<PatientFormSeed, 'id' | 'checkups'> & {
    id: string;
    version?: number;
    deletedAt?: DateInput | null;
    checkups: Array<CheckupFormInput & { id: string; patientId: string }>;
};

function isoDate(value: DateInput): string {
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new Error('Data non valida nel modulo.');
    return parsed.toISOString();
}

// Only fields owned by the form participate in equality; date representations share an instant.
function diagnosisFormValue(diagnosis: DiagnosisInput) {
    return {
        code: diagnosis.code,
        description: diagnosis.description,
        system: diagnosis.system,
        date: isoDate(diagnosis.date),
    };
}

/** Preserve opaque snapshot fields, never schema-stripped metadata from the draft. */
function diagnosesForWrite(initial: DiagnosisInput[], next: ReturnType<typeof diagnosisFormValue>[]) {
    const byValue = new Map<string, DiagnosisInput[]>();
    for (const row of initial) {
        const key = JSON.stringify(diagnosisFormValue(row));
        const rows = byValue.get(key) ?? [];
        rows.push(row);
        byValue.set(key, rows);
    }
    const nextCounts = new Map<string, number>();
    for (const row of next) {
        const key = JSON.stringify(row);
        nextCounts.set(key, (nextCounts.get(key) ?? 0) + 1);
    }
    for (const [key, rows] of byValue) {
        const hasOpaqueFields = rows.some(row => {
            const editable = diagnosisFormValue(row);
            return Object.keys(row).some(field => !Object.prototype.hasOwnProperty.call(editable, field));
        });
        // Diagnoses have no stable row ID. Do not guess by index/date which opaque
        // fields to transfer on an edit/removal or which identical duplicate survived.
        if (hasOpaqueFields && nextCounts.get(key) !== rows.length) {
            throw new Error('La modifica delle diagnosi coinvolge metadati non gestiti dal modulo. '
                + 'Impossibile conservarne con certezza l’associazione: nessuna scrittura eseguita.');
        }
    }
    return next.map(row => {
        const original = byValue.get(JSON.stringify(row))?.shift();
        return { ...structuredClone(original ?? {}), ...row, date: new Date(row.date) };
    });
}

export function patientFormDefaults(seed: PatientFormSeed = {}) {
    return {
        firstName: seed.firstName ?? '',
        lastName: seed.lastName ?? '',
        taxCode: seed.taxCode ?? '',
        birthDate: seed.birthDate ? isoDate(seed.birthDate).slice(0, 10) : '',
        address: seed.address ?? '',
        phone: seed.phone ?? '',
        caregiver: seed.caregiver ?? '',
        notes: seed.notes ?? '',
        isAdi: seed.isAdi ?? false,
        monitoringProfile: seed.monitoringProfile ?? 'taken_in_charge',
        statusReason: seed.statusReason ?? '',
        exemptions: [...(seed.exemptions ?? [])],
        diagnoses: (seed.diagnoses ?? []).map(diagnosisFormValue),
        checkups: (seed.checkups ?? []).map(checkup => ({
            id: checkup.id,
            date: isoDate(checkup.date).slice(0, 10),
            title: checkup.title,
            notes: checkup.notes ?? '',
            status: checkup.status ?? 'pending',
            source: checkup.source ?? 'manual',
        })),
    };
}

export type CheckupEditPatch = {
    version: number;
    date?: Date;
    title?: string;
    notes?: string;
    status?: CheckupStatus;
    source?: CheckupSource;
};
export type CheckupCreate = {
    id: string;
    patientId: string;
    date: Date;
    title: string;
    notes: string;
    status: CheckupStatus;
    source: CheckupSource;
    createdAt: Date;
};
export type PatientEditPort = {
    updatePatient: (id: string, changes: Record<string, unknown> & { version: number }) => Promise<void>;
    updateCheckup: (id: string, changes: CheckupEditPatch) => Promise<void>;
    deleteCheckup: (id: string, version: number) => Promise<void>;
    createCheckup: (item: CheckupCreate) => Promise<string>;
};
type Operation =
    | { kind: 'patient'; id: string; changes: Record<string, unknown> & { version: number } }
    | { kind: 'update'; id: string; changes: CheckupEditPatch }
    | { kind: 'delete'; id: string; version: number }
    | { kind: 'create'; item: CheckupCreate };
export type PatientEditResult =
    | { status: 'complete'; confirmed: number; total: number }
    | { status: 'interrupted'; confirmed: number; total: number; error: unknown };

function validId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
function requireVersion(value: unknown): asserts value is number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Versione iniziale non disponibile. Rileggi i dati prima di modificare.');
    }
}
function equal(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/** A journal of acknowledged effects, not a server transaction or durable receipt. */
export class PatientEditSession {
    private readonly initial: PatientEditRecord;
    private readonly defaults: ReturnType<typeof patientFormDefaults>;
    private operations: Operation[] | null = null;
    private confirmed = 0;
    private running = false;

    constructor(record: PatientEditRecord) {
        if (!validId(record.id) || record.deletedAt) throw new Error('Scheda non disponibile per la modifica.');
        requireVersion(record.version);
        const ids = new Set<string>();
        for (const checkup of record.checkups) {
            if (!validId(checkup.id) || ids.has(checkup.id) || checkup.patientId !== record.id || checkup.deletedAt) {
                throw new Error('Identità o appartenenza dei controlli non valida. Rileggi i dati.');
            }
            requireVersion(checkup.version);
            ids.add(checkup.id);
        }
        this.initial = structuredClone(record);
        this.defaults = patientFormDefaults(this.initial);
    }

    getDefaultValues(): ReturnType<typeof patientFormDefaults> {
        return structuredClone(this.defaults);
    }

    get locked(): boolean { return this.operations !== null; }

    async submit(draft: PatientFormSeed, port: PatientEditPort, newId: () => string): Promise<PatientEditResult> {
        if (this.operations !== null) throw new Error('Riprendi il tentativo sospeso o rileggi i dati.');
        this.operations = this.plan(draft, newId);
        return this.resume(port);
    }

    async resume(port: PatientEditPort): Promise<PatientEditResult> {
        if (this.running) throw new Error('Salvataggio già in corso.');
        if (this.operations === null) throw new Error('Nessun tentativo da riprendere.');
        this.running = true;
        try {
            for (; this.confirmed < this.operations.length; this.confirmed += 1) {
                // A transport must not be able to mutate the frozen retry payload.
                const operation = structuredClone(this.operations[this.confirmed]);
                if (operation.kind === 'patient') await port.updatePatient(operation.id, operation.changes);
                else if (operation.kind === 'update') await port.updateCheckup(operation.id, operation.changes);
                else if (operation.kind === 'delete') await port.deleteCheckup(operation.id, operation.version);
                else {
                    const id = await port.createCheckup(operation.item);
                    if (id !== operation.item.id) throw new Error('Identità della nuova riga non confermata. Rileggi i dati.');
                }
            }
            return { status: 'complete', confirmed: this.confirmed, total: this.operations.length };
        } catch (error) {
            return { status: 'interrupted', confirmed: this.confirmed, total: this.operations.length, error };
        } finally {
            this.running = false;
        }
    }

    private plan(draft: PatientFormSeed, newId: () => string): Operation[] {
        if (draft.id !== undefined && draft.id !== this.initial.id) throw new Error('Identità paziente non valida.');
        // A missing list must not be interpreted as a request to delete every row.
        if (!Array.isArray(draft.checkups)) throw new Error('Elenco dei controlli mancante.');
        const byId = new Map(this.initial.checkups.map(row => [row.id, row]));
        const submittedIds = new Set<string>();
        for (const row of draft.checkups) {
            if (row.patientId !== undefined && row.patientId !== this.initial.id) throw new Error('Controllo di un altro paziente.');
            if (row.id === undefined || row.id === '') continue;
            if (!validId(row.id) || !byId.has(row.id) || submittedIds.has(row.id)) {
                throw new Error('ID controllo duplicato o estraneo allo snapshot iniziale.');
            }
            submittedIds.add(row.id);
        }
        const next = patientFormDefaults(draft);
        const operations: Operation[] = [];
        const changes: Record<string, unknown> & { version: number } = { version: this.initial.version! };
        for (const key of Object.keys(this.defaults) as Array<keyof typeof this.defaults>) {
            if (key === 'checkups' || equal(this.defaults[key], next[key])) continue;
            changes[key] = key === 'birthDate' ? (next.birthDate ? new Date(next.birthDate) : null)
                : key === 'diagnoses' ? diagnosesForWrite(this.initial.diagnoses ?? [], next.diagnoses)
                    : structuredClone(next[key]);
        }
        if (Object.keys(changes).length > 1) operations.push({ kind: 'patient', id: this.initial.id, changes });

        const generatedIds = new Set(byId.keys());
        for (const row of next.checkups) {
            if (!row.title.trim()) throw new Error('Titolo del controllo richiesto.');
            const original = row.id ? byId.get(row.id) : undefined;
            if (original) {
                const displayed = this.defaults.checkups.find(item => item.id === row.id)!;
                const patch: CheckupEditPatch = { version: original.version! };
                if (row.date !== displayed.date) patch.date = new Date(row.date);
                if (row.title !== displayed.title) patch.title = row.title;
                if (row.notes !== displayed.notes) patch.notes = row.notes;
                if (row.status !== displayed.status) patch.status = row.status;
                if (row.source !== displayed.source) patch.source = row.source;
                if (Object.keys(patch).length > 1) operations.push({ kind: 'update', id: original.id, changes: patch });
            } else {
                const id = newId();
                if (!validId(id) || generatedIds.has(id)) throw new Error('Identità nuova riga non univoca.');
                generatedIds.add(id);
                operations.push({ kind: 'create', item: {
                    ...row, id, patientId: this.initial.id, date: new Date(row.date), createdAt: new Date(),
                } });
            }
        }
        // Only rows from the displayed snapshot are eligible for deletion.
        for (const row of this.initial.checkups) {
            if (!submittedIds.has(row.id)) operations.push({ kind: 'delete', id: row.id, version: row.version! });
        }
        return operations;
    }
}
