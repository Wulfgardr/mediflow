'use client';

import { useParams } from 'next/navigation';

import { Kree8ClinicalCockpit } from '@/components/kree8/kree8-clinical-cockpit';

export default function PatientDetailPage() {
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params.id;
  const patientId = Array.isArray(rawId) ? rawId[0] : rawId;

  return (
    <Kree8ClinicalCockpit
      surface="live"
      initialArea="scheda"
      initialPatientId={patientId}
    />
  );
}
