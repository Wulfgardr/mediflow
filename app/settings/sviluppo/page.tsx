import { SettingsMigrationPlaceholder } from '@/components/settings/settings-ui';

// WUL-297 — skeleton sub-route, populated in a later migration phase.
export default function Page() {
    return (
        <SettingsMigrationPlaceholder
            kicker="Avanzate"
            title="Sviluppo"
            legacyHref="/settings#operations"
            legacyLabel="Apri strumenti avanzati nelle impostazioni complete"
        />
    );
}
