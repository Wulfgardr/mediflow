import { SettingsMigrationPlaceholder } from '@/components/settings/settings-ui';

// WUL-297 — skeleton sub-route, populated in a later migration phase.
export default function Page() {
    return (
        <SettingsMigrationPlaceholder
            kicker="Generale"
            title="Aspetto"
            legacyHref="/settings#appearance"
            legacyLabel="Apri aspetto nelle impostazioni complete"
        />
    );
}
