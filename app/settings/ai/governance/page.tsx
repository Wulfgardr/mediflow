'use client';

import AiModelParliamentPanel from '@/components/settings/ai-model-parliament-panel';
import AiRolloutReadinessPanel from '@/components/settings/ai-rollout-readiness-panel';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsAiGovernancePage() {
    return (
        <section className="grid min-w-0 gap-[10px]" data-testid="settings-ai-governance-section">
            <SettingsSectionIntro
                title="Governance e rollout"
                description="Parliament dei modelli e prontezza al rilascio."
            />

            <AiModelParliamentPanel />
            <AiRolloutReadinessPanel />
        </section>
    );
}
