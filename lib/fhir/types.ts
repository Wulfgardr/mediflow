export interface FhirDiagnosisInput {
    id?: string;
    code: string;
    description: string;
    system: string;
    date: Date | string;
}

export interface FhirPatientInput {
    id: string;
    firstName: string;
    lastName: string;
    taxCode: string;
    birthDate?: Date | string;
    address?: string;
    phone?: string;
    isArchived?: boolean;
    caregiver?: string;
    exemptions?: string[];
    diagnoses?: FhirDiagnosisInput[];
}

export interface FhirClinicalEntryInput {
    id: string;
    patientId: string;
    date: Date | string;
    type: 'visit' | 'phone' | 'exam' | 'hospitalization' | 'access' | 'note' | 'scale' | 'remote';
    title?: string;
    content: string;
    deletedAt?: Date | string | null;
    metadata?: Record<string, unknown>;
    setting?: 'home' | 'hospital' | 'ambulatory';
}

export interface FhirTherapyInput {
    id: string;
    patientId: string;
    drugName: string;
    dosage: string;
    motivation?: string;
    status: 'active' | 'suspended' | 'completed';
    startDate: Date | string;
    endDate?: Date | string | null;
}

export interface FhirCheckupInput {
    id: string;
    patientId: string;
    date: Date | string;
    title: string;
    status?: string;
}

export interface FhirObservationInput {
    id: string;
    patientId: string;
    codeSystem: 'LOINC';
    code: string;
    display: string;
    unitSystem: 'UCUM';
    unitCode: string;
    value: number | string;
    notes?: string;
    observedAt: Date | string;
}

export interface FhirBundleInput {
    generatedAt: Date | string;
    patient: FhirPatientInput;
    entries: FhirClinicalEntryInput[];
    therapies: FhirTherapyInput[];
    checkups: FhirCheckupInput[];
    observations: FhirObservationInput[];
}
