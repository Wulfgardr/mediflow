import { SettingsMigrationPlaceholder } from '@/components/settings/settings-ui';

// WUL-297 — skeleton sub-route, populated in a later migration phase.
export default function Page() {
    return (
        <SettingsMigrationPlaceholder
            kicker="Generale"
            title="Profilo"
            legacyHref="/settings#account"
            legacyLabel="Apri profilo nelle impostazioni complete"
        />
    );
}
