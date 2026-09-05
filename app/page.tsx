'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { AREA_ID_VALUES, Kree8ClinicalCockpit, type AreaId } from '@/components/kree8/kree8-clinical-cockpit';
import { useSecurity } from '@/components/security-provider';
/* @Codex */
import { WorkProfileOnboarding } from '@/components/work-profile-onboarding';
import { useWorkProfile } from '@/lib/hooks/use-work-profile';
import { workProfileStartArea } from '@/lib/work-profile';

/* @Codex WUL-UIUX: legge ?area= e ?paziente= cosi refresh, back e i link
   "Torna ai pazienti" (/?area=incarico) riaprono il cockpit sul punto giusto.
   Il cockpit riflette lo stato nella query via history.replaceState. */
function HomeCockpit() {
  const { user } = useSecurity();
  const params = useSearchParams();
  const workProfile = useWorkProfile();
  const areaParam = params.get('area');
  const explicitArea = AREA_ID_VALUES.includes(areaParam as AreaId) ? (areaParam as AreaId) : undefined;
  const initialArea = explicitArea ?? workProfileStartArea(workProfile.state?.active ?? null);
  const initialPatientId = params.get('paziente') ?? undefined;

  /* @Codex: explicit clinical links remain usable even if preferences cannot be read. */
  if (!explicitArea && !initialPatientId && (!workProfile.state?.active || workProfile.state.draft || workProfile.error)) {
    return <div className="mx-auto max-w-2xl p-4 py-8"><WorkProfileOnboarding controller={workProfile} /></div>;
  }

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
