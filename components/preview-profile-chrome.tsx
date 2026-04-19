'use client';

/* @Codex */
import { useEffect, useMemo, useState } from 'react';
/* @Codex */
import { FlaskConical, RefreshCw } from 'lucide-react';
/* @Codex */
import { useSecurity } from '@/components/security-provider';
/* @Codex */
import { db } from '@/lib/db';
/* @Codex */
import { useLiveQuery } from '@/lib/live-query';
/* @Codex */
import {
    getPreviewProfileById,
    PREVIEW_PROFILES,
    PREVIEW_PROFILES_ENABLED,
    PREVIEW_PROFILE_FLAG_LABELS,
    PREVIEW_PROFILE_SETTING_KEY,
    type PreviewProfileFlag,
    type PreviewProfileId,
} from '@/lib/preview-profiles';

/* @Codex */
export function usePreviewProfileState() {
    const { isAuthenticated, isLocked, requiresSetup } = useSecurity();
    const [isApplying, setIsApplying] = useState(false);

    const storedProfile = useLiveQuery(async () => {
        if (!PREVIEW_PROFILES_ENABLED || !isAuthenticated || isLocked || requiresSetup) {
            return undefined;
        }

        try {
            return await db.settings.get(PREVIEW_PROFILE_SETTING_KEY);
        } catch {
            return undefined;
        }
    }, [isAuthenticated, isLocked, requiresSetup]);

    const activeProfile = useMemo(
        () => getPreviewProfileById(storedProfile?.value),
        [storedProfile?.value]
    );

    const applyProfile = async (profileId: PreviewProfileId) => {
        if (!PREVIEW_PROFILES_ENABLED) return;

        const nextProfile = getPreviewProfileById(profileId);
        setIsApplying(true);

        try {
            await db.settings.put({ key: PREVIEW_PROFILE_SETTING_KEY, value: nextProfile.id });

            if (nextProfile.targetUrl) {
                const targetUrl = new URL(nextProfile.targetUrl, window.location.origin).toString();
                if (targetUrl !== window.location.href) {
                    window.location.assign(targetUrl);
                    return;
                }
            }

            window.location.reload();
        } catch (error) {
            console.error('Failed to apply preview profile', error);
            alert('Impossibile applicare il preview profile selezionato.');
            setIsApplying(false);
        }
    };

    const hasFeature = (flag: PreviewProfileFlag) => activeProfile.featureFlags.includes(flag);

    return {
        isEnabled: PREVIEW_PROFILES_ENABLED,
        availableProfiles: PREVIEW_PROFILES,
        activeProfile,
        isApplying,
        applyProfile,
        hasFeature,
        activeFlagLabels: activeProfile.featureFlags.map((flag) => PREVIEW_PROFILE_FLAG_LABELS[flag]),
    };
}

/* @Codex */
export default function PreviewProfileChrome() {
    const { isEnabled, activeProfile, activeFlagLabels } = usePreviewProfileState();

    useEffect(() => {
        const body = document.body;
        if (!body) return;

        if (!isEnabled) {
            delete body.dataset.previewProfileId;
            delete body.dataset.previewProfileKind;
            return;
        }

        body.dataset.previewProfileId = activeProfile.id;
        body.dataset.previewProfileKind = activeProfile.kind;

        return () => {
            delete body.dataset.previewProfileId;
            delete body.dataset.previewProfileKind;
        };
    }, [activeProfile.id, activeProfile.kind, isEnabled]);

    if (!isEnabled || activeProfile.id === 'base') return null;

    return (
        <div className="mb-6">
            <div className="rounded-[28px] border border-sky-200/70 bg-[linear-gradient(135deg,rgba(239,246,255,0.9),rgba(255,255,255,0.74))] p-4 shadow-[0_18px_34px_rgba(14,165,233,0.1)] backdrop-blur-2xl dark:border-sky-500/20 dark:bg-sky-950/10">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-3">
                        <div className="rounded-[18px] bg-sky-500/10 p-2.5 text-sky-600 dark:bg-sky-500/15 dark:text-sky-200">
                            <FlaskConical className="h-5 w-5" />
                        </div>
                        <div className="space-y-2">
                            <div>
                                <p className="section-kicker">Preview attiva</p>
                                <h2 className="text-base font-semibold text-slate-900 dark:text-white">{activeProfile.label}</h2>
                                <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                                    {activeProfile.description}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className="apple-chip">Origine {activeProfile.sourceBranch}</span>
                                {activeFlagLabels.map((flagLabel) => (
                                    <span key={flagLabel} className="apple-chip">{flagLabel}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="inline-flex items-center gap-2 self-start rounded-full border border-sky-200/70 bg-white/80 px-4 py-2.5 text-sm font-medium text-sky-700 transition-colors hover:bg-white dark:border-sky-500/20 dark:bg-white/5 dark:text-sky-200 dark:hover:bg-white/10"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Ricarica shell
                    </button>
                </div>
            </div>
        </div>
    );
}
