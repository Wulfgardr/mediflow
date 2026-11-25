import styles from '@/components/patient-entry-composer.module.css';
import { PatientEntryComposer } from '@/components/patient-entry-composer';

export default function NewEntryPage() {
    return <div className={styles.entryRoute} data-record-page><PatientEntryComposer /></div>;
}
