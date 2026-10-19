import { PatientProfileNotesReview } from '@/components/patient-profile-review-pilot';

export default async function ProfileNotesReviewPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
    return <PatientProfileNotesReview patientId={(await params).id} mode="commit" />;
}
