// Codex: created 2026-02-01

export type PatientSummary = {
    id: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    taxCode: string;
    isAdi: boolean | null;
    isArchived: boolean | null;
    updatedAt: string | null;
};

export type PatientDetail = {
    id: string;
    firstName: string;
    lastName: string;
    birthDate: string | null;
    taxCode: string;
    address: string | null;
    phone: string | null;
    caregiver: string | null;
    notes: string | null;
    isAdi: boolean | null;
    isArchived: boolean | null;
    ambulatoryId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
};

export type AmbulatorySummary = {
    id: string;
    name: string;
    address: string | null;
    type: string | null;
    isDefault: boolean | null;
    createdAt: string | null;
};

export type EntrySummary = {
    id: string;
    patientId: string;
    type: string;
    date: string;
    content: string;
    createdAt: string | null;
};

export type TherapySummary = {
    id: string;
    patientId: string;
    drugName: string;
    dosage: string;
    status: string;
    startDate: string;
    endDate: string | null;
    createdAt: string | null;
};

export type CheckupSummary = {
    id: string;
    patientId: string;
    date: string;
    title: string;
    status: string;
    createdAt: string | null;
};
