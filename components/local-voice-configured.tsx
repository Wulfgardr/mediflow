'use client';

import { createContext, useContext, type ReactNode } from 'react';

const LocalVoiceConfigured = createContext(false);

export function LocalVoiceConfiguredProvider({ configured, children }: Readonly<{ configured: boolean; children: ReactNode }>) {
    return <LocalVoiceConfigured.Provider value={configured}>{children}</LocalVoiceConfigured.Provider>;
}

/** Whether this installation starts the local voice service: known by the server, read without any request. */
export function useLocalVoiceConfigured() {
    return useContext(LocalVoiceConfigured);
}
