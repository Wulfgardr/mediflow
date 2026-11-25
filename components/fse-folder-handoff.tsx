'use client';

import { useRouter } from 'next/navigation';

import FseFolderButton from '@/components/fse-folder-button';
import styles from '@/components/siss-workspace.module.css';
import { db } from '@/lib/db';
import { stageDossierSelection } from '@/lib/dossier-pending-selection';

export default function FseFolderHandoff({ patientId, patientTaxCode }: { patientId: string; patientTaxCode: string | null | undefined }) {
    const router = useRouter();
    return <div className={styles.actions} data-testid="fse-folder-handoff">
        <FseFolderButton patient={{ taxCode: patientTaxCode }} onReady={(reading) => {
            stageDossierSelection({ patientId, files: reading.files, declaredTaxCode: reading.taxCode, unread: reading.malformed.length }, db.getSessionReadSignal());
            router.push(`/patients/import/dossier?patientId=${encodeURIComponent(patientId)}`);
        }} />
    </div>;
}
