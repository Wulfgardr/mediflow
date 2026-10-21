import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { PluginLocalUiRuntimeProvider } from '@/components/plugin-local-ui-navigation';
import { isPluginLocalUiRuntime } from '@/lib/security/plugin-local-ui-runtime';

export default async function PatientModulesLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return <PluginLocalUiRuntimeProvider enabled={isPluginLocalUiRuntime()}>{children}</PluginLocalUiRuntimeProvider>;
}
