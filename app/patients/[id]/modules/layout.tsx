import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { PluginLocalUiRuntimeProvider } from '@/components/plugin-local-ui-navigation';
import { isPluginLocalUiRuntime } from '@/lib/security/plugin-local-ui-runtime';
import { LocalVoiceConfiguredProvider } from '@/components/local-voice-configured';
import { localVoiceEndpointFromEnv } from '@/lib/local-voice/client.mjs';

export default async function PatientModulesLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  return <PluginLocalUiRuntimeProvider enabled={isPluginLocalUiRuntime()}>
    <LocalVoiceConfiguredProvider configured={localVoiceEndpointFromEnv() !== null}>{children}</LocalVoiceConfiguredProvider>
  </PluginLocalUiRuntimeProvider>;
}
