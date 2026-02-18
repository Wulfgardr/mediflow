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
    /* @Codex */
    exemptions: string | null;
    /* @Codex */
    diagnoses: string | null;
    /* @Codex */
    monitoringProfile: string | null;
    /* @Codex */
    statusReason: string | null;
    notes: string | null;
    /* @Codex */
    aiSummary: string | null;
    /* @Codex */
    documentInsights: string | null;
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
    activePrinciple: string | null;
    dosage: string;
    motivation: string | null;
    diagnosisCode: string | null;
    diagnosisName: string | null;
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
    notes: string | null;
    status: string;
    source: string | null;
    createdAt: string | null;
};

/* @Codex */
export type DrugSummary = {
    aic: string;
    name: string;
    activePrinciple: string | null;
    company: string | null;
    packaging: string | null;
    class: string | null;
    price: number | null;
    atc: string | null;
};

/* @Codex */
export type ExemptionSummary = {
    code: string;
    description: string;
    type: string | null;
    source: string | null;
    startDate: string | null;
    endDate: string | null;
    isPharma: boolean | null;
    isSpecialist: boolean | null;
    isNational: boolean | null;
    updatedAt: string | null;
};
