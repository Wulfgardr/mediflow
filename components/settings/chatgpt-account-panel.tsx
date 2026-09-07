'use client';
/* @Codex: local visibility follows the existing security lifecycle; API owns authority. */
import { useSecurity } from '@/components/security-provider';
import { ChatGptAccountCard } from './chatgpt-account-card';

export function ChatGptAccountPanel() {
    const { isAuthenticated, isLocked, authRecoveryState } = useSecurity();
    return <ChatGptAccountCard active={isAuthenticated && !isLocked && authRecoveryState === 'ready'} />;
}
