'use client';

/* @Codex */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Kree8ClinicalCockpit } from '@/components/kree8/kree8-clinical-cockpit';

function Kree8KeyboardReview() {
  const searchParams = useSearchParams();
  const requestedCount = Number(searchParams.get('patientCount'));
  const reviewPatientCount = Number.isFinite(requestedCount) ? requestedCount : undefined;

  return (
    <Kree8ClinicalCockpit
      surface="review"
      initialArea={searchParams.get('area') === 'incarico' ? 'incarico' : 'turno'}
      reviewPatientCount={reviewPatientCount}
    />
  );
}

export default function Kree8ReviewPage() {
  return (
    <Suspense fallback={<div className="mf-alert mf-alert-info" role="status">Preparazione review sintetica.</div>}>
      <Kree8KeyboardReview />
    </Suspense>
  );
}
