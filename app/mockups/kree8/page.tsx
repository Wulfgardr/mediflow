'use client';

/* @Codex */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Kree8ClinicalCockpit } from '@/components/kree8/kree8-clinical-cockpit';

function Kree8SyntheticReviewSurface() {
  const searchParams = useSearchParams();
  const requestedState = searchParams.get('patientState');
  const reviewPatientStatus = requestedState === 'loading'
    || requestedState === 'stale'
    || requestedState === 'error'
    ? requestedState
    : 'ready';

  return (
    <Kree8ClinicalCockpit
      surface="review"
      reviewPatientStatus={reviewPatientStatus}
      reviewNetworkOffline={searchParams.get('network') === 'offline'}
    />
  );
}

export default function Kree8ReviewPage() {
  return (
    <Suspense fallback={<div className="mf-alert mf-alert-info" role="status">Preparazione review sintetica.</div>}>
      <Kree8SyntheticReviewSurface />
    </Suspense>
  );
}
