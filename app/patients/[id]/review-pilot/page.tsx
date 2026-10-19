import { notFound } from 'next/navigation';
import { PatientProfileReviewPilot } from '@/components/patient-profile-review-pilot';

export default async function ProfileReviewPilotPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
    if (process.env.NODE_ENV !== 'development') notFound();
    return <PatientProfileReviewPilot patientId={(await params).id} />;
}
