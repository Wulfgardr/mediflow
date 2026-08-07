'use client';

import AiModelParliamentPanel from '@/components/settings/ai-model-parliament-panel';
import AiRolloutReadinessPanel from '@/components/settings/ai-rollout-readiness-panel';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsAiGovernancePage() {
    return (
        <section className="space-y-4" data-testid="settings-ai-governance-section">
            <SettingsSectionIntro
                kicker="Intelligenza locale"
                title="Governance e rollout"
                description="Parliament dei modelli e prontezza al rilascio."
            />

            <div className="space-y-6">
                <AiModelParliamentPanel />
                <AiRolloutReadinessPanel />
            </div>
        </section>
    );
}
