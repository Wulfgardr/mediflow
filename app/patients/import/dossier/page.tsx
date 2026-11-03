/* WUL-804: dossier from a Mac folder. The query parameter only preselects a sheet to resume; it grants nothing. */
import DossierImportPanel from '@/components/dossier-import-panel';

export default async function PatientDossierImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const value = (await searchParams).patientId;
    const patientId = typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null;
    return <DossierImportPanel initialPatientId={patientId} />;
}
