import type { DocumentInsight, Patient } from '../../db';

type DocumentInsightsArchivePatient = Pick<Patient, 'id' | 'version'>;

type DocumentInsightsArchiveDependencies = {
    updatePatient: (
        patientId: string,
        changes: Pick<Partial<Patient>, 'documentInsights' | 'updatedAt' | 'version'>,
    ) => Promise<void>;
    now?: () => Date;
};

export async function persistDocumentInsightsArchive(
    dependencies: DocumentInsightsArchiveDependencies,
    patient: DocumentInsightsArchivePatient,
    nextInsights: DocumentInsight[],
): Promise<void> {
    await dependencies.updatePatient(patient.id, {
        documentInsights: nextInsights,
        version: patient.version,
        updatedAt: (dependencies.now ?? (() => new Date()))(),
    });
}
