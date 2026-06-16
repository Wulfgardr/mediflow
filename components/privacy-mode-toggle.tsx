'use client';

// WUL-297: persistent header affordance for Privacy Mode. The header is the
// primary surface for the toggle; settings keeps only a pointer.

import { Eye, EyeOff } from 'lucide-react';
import { usePrivacyOptional } from '@/components/privacy-provider';
import { cn } from '@/lib/utils';

export function PrivacyModeToggle({
    showLabel = false,
    className,
}: {
    showLabel?: boolean;
    className?: string;
}) {
    const privacy = usePrivacyOptional();
    if (!privacy) return null;
    const { isPrivacyMode, togglePrivacyMode } = privacy;
    const title = isPrivacyMode ? 'Disattiva Privacy Mode' : 'Attiva Privacy Mode';

    return (
        <button
            type="button"
            onClick={togglePrivacyMode}
            aria-pressed={isPrivacyMode}
            aria-label={title}
            title={title}
            data-testid="privacy-mode-header-toggle"
            className={cn(
                'inline-flex h-7 items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-semibold transition-colors',
                isPrivacyMode
                    ? 'border-[color:rgba(15,123,104,0.28)] bg-[color:rgba(15,123,104,0.12)] text-[color:var(--mf-primary)]'
                    : 'border-[color:rgba(112,106,100,0.2)] bg-transparent text-[color:var(--mf-muted)] hover:text-[color:var(--mf-ink)]',
                className,
            )}
        >
            {isPrivacyMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showLabel ? <span>{isPrivacyMode ? 'Privacy attiva' : 'Privacy'}</span> : null}
        </button>
    );
}
