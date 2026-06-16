'use client';

import { Kree8ClinicalCockpit } from '@/components/kree8/kree8-clinical-cockpit';
import { useSecurity } from '@/components/security-provider';

export default function Home() {
  const { user } = useSecurity();

  return <Kree8ClinicalCockpit surface="live" operatorName={user?.displayName} />;
}
