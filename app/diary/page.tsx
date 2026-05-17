'use client';

import { Kree8ClinicalCockpit } from '@/components/kree8/kree8-clinical-cockpit';

export default function GlobalDiaryPage() {
  return (
    <Kree8ClinicalCockpit
      surface="live"
      initialArea="diario"
    />
  );
}
