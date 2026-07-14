'use client';

import { usePrivacy } from '@/components/privacy-provider';
import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface PrivacyBlurProps {
    children: ReactNode;
    className?: string;
    intensity?: 'sm' | 'md' | 'lg';
}

export default function PrivacyBlur({ children, className, intensity = 'md' }: PrivacyBlurProps) {
    const { isPrivacyMode } = usePrivacy();

    if (!isPrivacyMode) {
        return <span className={className}>{children}</span>;
    }

    return (
        <span
            className={cn(
                "liquid-blur select-none transition-[filter] [transition-duration:var(--lume-dur-fuoco)] [transition-timing-function:var(--lume-ease)]",
                intensity === 'sm' && "blur-[3px]",
                intensity === 'md' && "blur-[5px]",
                intensity === 'lg' && "blur-[8px]",
                className
            )}
            title="Privacy Mode Attiva"
        >
            {children}
        </span>
    );
}
