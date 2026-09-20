/* @Codex: server-readable selection is an observation, never an auth grant. */
import { cookies } from 'next/headers';
import PatientBulkImportPanel from '@/components/patient-bulk-import-panel';

export default async function PatientImportPage() {
    const cookieStore = await cookies();
    return <PatientBulkImportPanel initialAmbulatoryCookie={cookieStore.get('ambulatory_id')?.value ?? null} />;
}
