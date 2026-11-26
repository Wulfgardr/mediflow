export const AGENT_PATIENT_CONTEXT_SCHEMA = 'mediflow.agent_patient_context.v1' as const;
export const AGENT_PATIENT_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
export const AGENT_PATIENT_CONTEXT_MAX_BYTES = 128 * 1024;

export type AgentPatientContextDiagnosis = {
    description: string;
    code?: string;
    system?: string;
    date?: string;
};

export type AgentPatientContextTherapy = {
    drugName: string;
    activePrinciple?: string;
    dosage: string;
    status: 'active' | 'suspended' | 'completed';
    startDate?: string;
};

export type AgentPatientContextExemption = {
    code: string;
};

export type AgentPatientContextAllergy = {
    substance: string;
    reaction?: string;
    severity?: string;
};

export type AgentPatientContextObservation = {
    display: string;
    value: string;
    unit: string;
    code?: string;
    observedAt?: string;
};

export type AgentPatientContextNote = {
    date: string;
    title?: string;
    text: string;
};

export type AgentPatientContextCheckup = {
    title: string;
    status?: string;
};

export type AgentPatientContextInput = {
    patient: {
        cfHash: string;
        taxCodeLast4: string;
        birthYear?: number;
        isAdi?: boolean;
    };
    diagnoses: AgentPatientContextDiagnosis[];
    therapies: AgentPatientContextTherapy[];
    exemptions: AgentPatientContextExemption[];
    allergies: AgentPatientContextAllergy[];
    observations: AgentPatientContextObservation[];
    recentNotes: AgentPatientContextNote[];
    openCheckups: AgentPatientContextCheckup[];
};

export type AgentPatientContextEnvelope = AgentPatientContextInput & {
    schema: typeof AGENT_PATIENT_CONTEXT_SCHEMA;
    exportedAt: number;
    expiresAt: number;
};

const CF_HASH_RE = /^[a-f0-9]{64}$/u;
const LAST4_RE = /^[A-Z0-9]{4}$/u;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const ALLOWED_TOP_KEYS = 'allergies,diagnoses,exemptions,observations,openCheckups,patient,recentNotes,therapies';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown, max: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, '').trim();
    if (!trimmed) return null;
    return trimmed.slice(0, max);
};

const optionalIsoDate = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().slice(0, 10);
    return ISO_DATE_RE.test(trimmed) ? trimmed : undefined;
};

export function parseAgentPatientContextInput(value: unknown): AgentPatientContextInput | null {
    if (!isRecord(value)) return null;
    const keys = Object.keys(value).sort().join(',');
    if (keys !== ALLOWED_TOP_KEYS) return null;
    if (!isRecord(value.patient)) return null;

    const cfHash = typeof value.patient.cfHash === 'string' ? value.patient.cfHash.trim().toLowerCase() : '';
    const taxCodeLast4 = typeof value.patient.taxCodeLast4 === 'string' ? value.patient.taxCodeLast4.trim().toUpperCase() : '';
    if (!CF_HASH_RE.test(cfHash) || !LAST4_RE.test(taxCodeLast4)) return null;

    const patient: AgentPatientContextInput['patient'] = { cfHash, taxCodeLast4 };
    if (value.patient.birthYear !== undefined) {
        if (typeof value.patient.birthYear !== 'number' || !Number.isInteger(value.patient.birthYear)
            || value.patient.birthYear < 1900 || value.patient.birthYear > 2100) return null;
        patient.birthYear = value.patient.birthYear;
    }
    if (value.patient.isAdi !== undefined) {
        if (typeof value.patient.isAdi !== 'boolean') return null;
        patient.isAdi = value.patient.isAdi;
    }

    if (!Array.isArray(value.diagnoses) || value.diagnoses.length > 50) return null;
    const diagnoses: AgentPatientContextDiagnosis[] = [];
    for (const item of value.diagnoses) {
        if (!isRecord(item)) return null;
        const description = cleanText(item.description, 300);
        if (!description) return null;
        const entry: AgentPatientContextDiagnosis = { description };
        const code = cleanText(item.code, 40);
        const system = cleanText(item.system, 24);
        const date = optionalIsoDate(item.date);
        if (code) entry.code = code;
        if (system) entry.system = system;
        if (date) entry.date = date;
        diagnoses.push(entry);
    }

    if (!Array.isArray(value.therapies) || value.therapies.length > 60) return null;
    const therapies: AgentPatientContextTherapy[] = [];
    for (const item of value.therapies) {
        if (!isRecord(item)) return null;
        const drugName = cleanText(item.drugName, 200);
        const dosage = cleanText(item.dosage, 300);
        const status = item.status;
        if (!drugName || !dosage || (status !== 'active' && status !== 'suspended' && status !== 'completed')) return null;
        const entry: AgentPatientContextTherapy = { drugName, dosage, status };
        const activePrinciple = cleanText(item.activePrinciple, 200);
        const startDate = optionalIsoDate(item.startDate);
        if (activePrinciple) entry.activePrinciple = activePrinciple;
        if (startDate) entry.startDate = startDate;
        therapies.push(entry);
    }

    if (!Array.isArray(value.exemptions) || value.exemptions.length > 30) return null;
    const exemptions: AgentPatientContextExemption[] = [];
    for (const item of value.exemptions) {
        if (!isRecord(item)) return null;
        const code = cleanText(item.code, 40);
        if (!code) return null;
        exemptions.push({ code });
    }

    if (!Array.isArray(value.allergies) || value.allergies.length > 30) return null;
    const allergies: AgentPatientContextAllergy[] = [];
    for (const item of value.allergies) {
        if (!isRecord(item)) return null;
        const substance = cleanText(item.substance, 200);
        if (!substance) return null;
        const entry: AgentPatientContextAllergy = { substance };
        const reaction = cleanText(item.reaction, 200);
        const severity = cleanText(item.severity, 60);
        if (reaction) entry.reaction = reaction;
        if (severity) entry.severity = severity;
        allergies.push(entry);
    }

    if (!Array.isArray(value.observations) || value.observations.length > 60) return null;
    const observations: AgentPatientContextObservation[] = [];
    for (const item of value.observations) {
        if (!isRecord(item)) return null;
        const display = cleanText(item.display, 160);
        const val = cleanText(item.value, 80);
        const unit = cleanText(item.unit, 40);
        if (!display || !val || !unit) return null;
        const entry: AgentPatientContextObservation = { display, value: val, unit };
        const code = cleanText(item.code, 40);
        const observedAt = optionalIsoDate(item.observedAt);
        if (code) entry.code = code;
        if (observedAt) entry.observedAt = observedAt;
        observations.push(entry);
    }

    if (!Array.isArray(value.recentNotes) || value.recentNotes.length > 10) return null;
    const recentNotes: AgentPatientContextNote[] = [];
    for (const item of value.recentNotes) {
        if (!isRecord(item)) return null;
        const date = optionalIsoDate(item.date);
        const text = cleanText(item.text, 4000);
        if (!date || !text) return null;
        const entry: AgentPatientContextNote = { date, text };
        const title = cleanText(item.title, 200);
        if (title) entry.title = title;
        recentNotes.push(entry);
    }

    if (!Array.isArray(value.openCheckups) || value.openCheckups.length > 30) return null;
    const openCheckups: AgentPatientContextCheckup[] = [];
    for (const item of value.openCheckups) {
        if (!isRecord(item)) return null;
        const title = cleanText(item.title, 240);
        if (!title) return null;
        const entry: AgentPatientContextCheckup = { title };
        const status = cleanText(item.status, 40);
        if (status) entry.status = status;
        openCheckups.push(entry);
    }

    const parsed: AgentPatientContextInput = {
        patient,
        diagnoses,
        therapies,
        exemptions,
        allergies,
        observations,
        recentNotes,
        openCheckups,
    };
    if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > AGENT_PATIENT_CONTEXT_MAX_BYTES) return null;
    return parsed;
}

export type AgentPatientContextIdentity = {
    firstName: string;
    lastName: string;
    taxCode: string;
    birthDate: string | null;
    address: string | null;
    phone: string | null;
    caregiver: string | null;
};

export type AgentPatientContextRequest = {
    context: AgentPatientContextInput;
    identity: AgentPatientContextIdentity;
};

const IDENTITY_KEYS = 'address,birthDate,caregiver,firstName,lastName,phone,taxCode';
const IDENTITY_VALUE_LIMIT = 256;

const identityValue = (value: unknown): string | null | undefined => {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > IDENTITY_VALUE_LIMIT) return undefined;
    return value;
};

function parseAgentPatientContextIdentity(value: unknown): AgentPatientContextIdentity | null {
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== IDENTITY_KEYS) return null;
    const fields = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, identityValue(item)]));
    if (Object.values(fields).some(item => item === undefined)) return null;
    if (typeof fields.firstName !== 'string' || typeof fields.lastName !== 'string' || typeof fields.taxCode !== 'string') return null;
    return fields as AgentPatientContextIdentity;
}

export function parseAgentPatientContextRequest(value: unknown): AgentPatientContextRequest | null {
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'context,identity') return null;
    const context = parseAgentPatientContextInput(value.context);
    const identity = parseAgentPatientContextIdentity(value.identity);
    return context && identity ? { context, identity } : null;
}

export function normalizeAgentPatientTaxCode(value: string): string {
    return value.replace(/\s+/gu, '').toUpperCase();
}

export function sealAgentPatientContextEnvelope(input: AgentPatientContextInput, nowMs = Date.now()): AgentPatientContextEnvelope {
    return {
        schema: AGENT_PATIENT_CONTEXT_SCHEMA,
        exportedAt: nowMs,
        expiresAt: nowMs + AGENT_PATIENT_CONTEXT_TTL_MS,
        ...input,
    };
}

export async function sha256HexClient(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value.trim().toUpperCase());
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
