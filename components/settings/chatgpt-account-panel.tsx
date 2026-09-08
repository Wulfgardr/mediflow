'use client';
/* @Codex: local visibility follows the existing security lifecycle; API owns authority. */
import { useSecurity } from '@/components/security-provider';
import { ChatGptAccountCard } from './chatgpt-account-card';

export function ChatGptAccountPanel() {
    const { isAuthenticated, isLocked, authRecoveryState, user } = useSecurity();
    return <ChatGptAccountCard key={user?.id ?? 'no-user'} active={user !== null && isAuthenticated && !isLocked && authRecoveryState === 'ready'} />;
}
