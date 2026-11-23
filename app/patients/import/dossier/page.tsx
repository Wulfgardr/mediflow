/* WUL-804: dossier from a Mac folder. The query parameter only preselects a sheet to resume; it grants nothing. */
import styles from '@/components/patient-bulk-import-panel.module.css';
import DossierImportPanel from '@/components/dossier-import-panel';

export default async function PatientDossierImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const value = (await searchParams).patientId;
    const patientId = typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null;
    return <div className={styles.importWorkspace}>
        <DossierImportPanel initialPatientId={patientId} />
    </div>;
}
