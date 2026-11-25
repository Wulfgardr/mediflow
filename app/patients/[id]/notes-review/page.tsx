import surface from '@/components/record-surface.module.css';
import styles from '@/components/patient-entry-composer.module.css';
import { PatientProfileNotesReview } from '@/components/patient-profile-review-pilot';

export default async function ProfileNotesReviewPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
    return <div className={surface.page} data-record-page>
        <div className={`${surface.tray} ${styles.notesReview}`} data-record-tray="note">
            <PatientProfileNotesReview patientId={(await params).id} mode="commit" />
        </div>
    </div>;
}
