'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { AREA_ID_VALUES, Kree8ClinicalCockpit, type AreaId } from '@/components/kree8/kree8-clinical-cockpit';
import { useSecurity } from '@/components/security-provider';

/* @Codex WUL-UIUX: legge ?area= e ?paziente= cosi refresh, back e i link
   "Torna ai pazienti" (/?area=incarico) riaprono il cockpit sul punto giusto.
   Il cockpit riflette lo stato nella query via history.replaceState. */
function HomeCockpit() {
  const { user } = useSecurity();
  const params = useSearchParams();
  const areaParam = params.get('area');
  const initialArea = AREA_ID_VALUES.includes(areaParam as AreaId) ? (areaParam as AreaId) : undefined;
  const initialPatientId = params.get('paziente') ?? undefined;

  return (
    <Kree8ClinicalCockpit
      surface="live"
      operatorName={user?.displayName}
      initialArea={initialArea}
      initialPatientId={initialPatientId}
    />
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeCockpit />
    </Suspense>
  );
}
